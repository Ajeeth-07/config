/**
 * AI Agent - Main Entry Point
 * Orchestrates the input configuration generation pipeline
 * Uses AI-powered sheet classification for intelligent processing
 */

const path = require("path");

// Import configuration
const { CONFIG } = require("./config");

// Import utilities
const { sleep } = require("./utils/helpers");
const { flattenJson } = require("./utils/dataProcessing");
const { readJsonFile, readMappingFile } = require("./utils/fileReaders");
const {
  classifyAllSheets,
  buildReferenceContext,
  SHEET_TYPES,
} = require("./utils/sheetClassifier");

// Import services
const { getOrCreateCache, getModel, purgeCache } = require("./cacheService");
const {
  generateExcelFile,
  generateListValuesFile,
  setupOutputDirectory,
  normalizeDataType,
} = require("./excelGenerator");
const {
  processRowBatch,
  processListValuesBatch,
  logProcessingSummary,
} = require("./aiProcessor");

/**
 * Main function with progress callback for real-time updates
 * @param {string} jsonFilePath - Path to JSON API structure file
 * @param {string} mappingFilePath - Path to Excel/CSV mapping file
 * @param {Function} onProgress - Callback for progress updates (message, type)
 * @param {Object} options - Processing options
 * @returns {Object} Processing result with configurations and metadata
 */
async function processFilesWithProgress(
  jsonFilePath,
  mappingFilePath,
  onProgress = () => {},
  options = {},
) {
  const { useRAG = false } = options;
  const startTime = Date.now();
  const log = (msg, type = "log") => {
    console.log(msg);
    onProgress(msg, type);
  };

  // Import RAG services if enabled
  let ragServices = null;
  let ragStats = null;

  if (useRAG) {
    try {
      ragServices = require("./rag");
      const kbStats = await ragServices.getKnowledgeBaseStats();
      log(
        `RAG Mode: ENABLED (${kbStats.totalDocuments} docs in knowledge base)`,
        "info",
      );
      ragStats = kbStats;
    } catch (e) {
      log(
        `RAG initialization failed: ${e.message}. Continuing without RAG.`,
        "error",
      );
    }
  }

  // Step 1: Read and validate files
  log("Reading input files...");

  const jsonResult = readJsonFile(jsonFilePath);
  if (!jsonResult.valid) {
    throw new Error(`Invalid JSON file: ${jsonResult.error}`);
  }
  log("JSON file validated successfully");

  const mappingResult = readMappingFile(mappingFilePath);
  if (!mappingResult.valid) {
    throw new Error(`Invalid mapping file: ${mappingResult.error}`);
  }

  log(
    `\nMapping file parsed: ${mappingResult.sheetNames.length} sheet(s) found`,
  );

  // Step 1.5: AI-Powered Sheet Classification
  log("\n--- AI Sheet Classification ---");
  const sheetClassification = await classifyAllSheets(
    mappingResult.allSheetsData,
    mappingResult.structuralFingerprint,
    onProgress,
  );

  // Build reference context from context sheets (regex patterns, codes, etc.)
  const referenceContext = buildReferenceContext(
    mappingResult.allSheetsData,
    sheetClassification.contextSheets,
  );

  if (referenceContext) {
    log(
      `\nReference context built from ${sheetClassification.contextSheets.length} context sheet(s)`,
    );
  }

  // Use only input_fields sheets for processing
  const sheetsToProcess = sheetClassification.inputSheets;

  if (sheetsToProcess.length === 0) {
    throw new Error(
      "No input field sheets found. AI classified all sheets as reference or irrelevant.",
    );
  }

  log(`\nSheets to process: ${sheetsToProcess.length}`);
  log(
    `Context sheets (used as reference): ${sheetClassification.contextSheets.length}`,
  );
  log(
    `Irrelevant sheets (skipped): ${sheetClassification.irrelevantSheets.length}`,
  );

  const flattenedJson = flattenJson(jsonResult.data);

  // Step 2: Initialize caching and model
  log("Initializing Gemini AI model...");
  const cache = await getOrCreateCache(
    flattenedJson,
    mappingResult.structuralFingerprint,
  );

  if (cache) {
    log("Context cache created successfully");
  } else {
    log("Running in non-cached mode");
  }

  const model = await getModel(cache);
  log(`Model initialized: ${CONFIG.MODEL}`);
  log(
    `Gemini 3 Thinking Level: ${CONFIG.THINKING_LEVEL} (with RAG: ${CONFIG.THINKING_LEVEL_WITH_RAG_CONTEXT})`,
  );

  // Step 3: Calculate totals (only from INPUT sheets)
  const totalRows = sheetsToProcess.reduce(
    (acc, sheetName) =>
      acc + (mappingResult.allSheetsData[sheetName]?.length || 0),
    0,
  );

  // Calculate context/skipped rows for transparency
  const contextRows = sheetClassification.contextSheets.reduce(
    (acc, name) => acc + (mappingResult.allSheetsData[name]?.length || 0),
    0,
  );
  const skippedRows = sheetClassification.irrelevantSheets.reduce(
    (acc, name) => acc + (mappingResult.allSheetsData[name]?.length || 0),
    0,
  );

  const estimatedBatches = Math.ceil(totalRows / CONFIG.BATCH_SIZE);

  log("-------------------------------------------");
  log(`Total input fields to process: ${totalRows}`);
  if (contextRows > 0) {
    log(`Context rows (used as reference): ${contextRows}`);
  }
  if (skippedRows > 0) {
    log(`Skipped rows (irrelevant): ${skippedRows}`);
  }
  log(`Batch size: ${CONFIG.BATCH_SIZE} rows per request`);
  log(`Estimated batches: ${estimatedBatches}`);
  log("-------------------------------------------");

  // Step 4: Process each sheet in batches
  let allConfigs = [];
  const BATCH_SIZE = CONFIG.BATCH_SIZE;

  let totalTokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    batchBreakdown: [],
  };

  let globalBatchCount = 0;

  for (const sheetName of sheetsToProcess) {
    const sheetData = mappingResult.allSheetsData[sheetName];
    const fingerprint = mappingResult.structuralFingerprint[sheetName];
    const columnHeaders = fingerprint.columns;
    const rowCount = sheetData.length;
    const classification = sheetClassification.classifications[sheetName];

    log(`\n> Processing sheet: "${sheetName}"`);
    log(`  Rows: ${rowCount} | Columns: ${columnHeaders.length}`);
    if (classification?.aiClassified) {
      log(`  AI Classification: ${classification.reason}`);
    }

    for (let i = 0; i < rowCount; i += BATCH_SIZE) {
      const batchRows = sheetData.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      globalBatchCount++;
      let madeAICall = true; // Track if LLM was called (for rate limiting)

      log(
        `  [Batch ${globalBatchCount}] Processing rows ${i + 1}-${Math.min(
          i + BATCH_SIZE,
          rowCount,
        )}...`,
      );

      try {
        let batchResult;

        // Use RAG if enabled and knowledge base has data
        if (ragServices && ragStats && ragStats.totalDocuments > 0) {
          // Process with RAG - find similar configs first
          const ragResult = await ragServices.processWithRAG(batchRows, {
            topK: 5,
          });

          log(
            `    RAG: ${ragResult.stats.directMatchCount} direct, ${ragResult.stats.needsLLMCount} need LLM (${ragResult.stats.ragUtilization} utilization)`,
          );

          // Get direct matches from RAG
          const directConfigs = ragResult.directMatches.map((m) => ({
            ...m.config,
            _source: "rag",
            _similarity: m.similarity,
          }));

          // Process remaining with LLM
          if (ragResult.needsLLM.length > 0) {
            const needsLLMRows = ragResult.needsLLM.map(
              (item) => batchRows[item.rowIndex],
            );

            // Build rich RAG context for LLM from similar matches
            let ragContext = "";
            const matchedPatterns = new Map();
            const matchedParents = new Map();

            ragResult.needsLLM.forEach((item) => {
              if (item.context?.hasContext && item.context?.similarConfigs) {
                item.context.similarConfigs.slice(0, 3).forEach((sim) => {
                  const meta = sim.metadata;
                  const key = meta.keyword;
                  if (key && !matchedPatterns.has(key)) {
                    matchedPatterns.set(key, {
                      keyword: meta.keyword,
                      keywordcaption: meta.keywordcaption,
                      keywordtype: meta.keywordtype,
                      ismandatory: meta.ismandatory,
                      regex: meta.regex || "",
                      minlength: meta.minlength || "",
                      maxlength: meta.maxlength || "",
                      similarity: sim.similarity,
                      insurer: meta.insurer,
                      lob: meta.lob || "general",
                    });
                  }
                  // Collect parent LOB context
                  if (sim.parent && !matchedParents.has(sim.parent.id)) {
                    matchedParents.set(sim.parent.id, sim.parent);
                  }
                });

                // Also collect parent context from the context object
                if (item.context.parentContext) {
                  Object.entries(item.context.parentContext).forEach(
                    ([pid, p]) => {
                      if (!matchedParents.has(pid)) {
                        matchedParents.set(pid, p.metadata);
                      }
                    },
                  );
                }
              }
            });

            // Only pass RAG KB context to LLM if we actually found patterns
            // This controls thinking level: ragContext present = low, absent = high
            if (matchedPatterns.size > 0) {
              // Add LOB Context header from parent documents
              if (matchedParents.size > 0) {
                ragContext += "## LOB Context (Line of Business):\n";
                matchedParents.forEach((parent, pid) => {
                  const lob = parent.lob || "general";
                  const ins = parent.insurer || "unknown";
                  const prod = parent.product || "general";
                  const fc = parent.fieldCount || "";
                  const cats = parent.fieldCategories
                    ? parent.fieldCategories.join(", ")
                    : "";
                  ragContext += `- ${lob} insurance (${ins}/${prod})`;
                  if (fc) ragContext += `: ${fc} fields`;
                  if (cats) ragContext += ` in [${cats}]`;
                  ragContext += "\n";
                });
                ragContext += "\n";
              }

              ragContext +=
                "## Similar fields from knowledge base (follow these naming patterns):\n";
              ragContext +=
                "| keyword | caption | type | mandatory | LOB | regex | insurer | similarity |\n";
              ragContext +=
                "|---------|---------|------|-----------|-----|-------|---------|------------|\n";
              Array.from(matchedPatterns.values())
                .sort(
                  (a, b) => parseFloat(b.similarity) - parseFloat(a.similarity),
                )
                .slice(0, 15)
                .forEach((p) => {
                  ragContext += `| ${p.keyword} | ${p.keywordcaption} | ${
                    p.keywordtype
                  } | ${p.ismandatory} | ${p.lob} | ${p.regex || "-"} | ${
                    p.insurer
                  } | ${p.similarity} |\n`;
                });
              ragContext += "\n";
              log(
                `    RAG context: ${matchedPatterns.size} patterns, ${matchedParents.size} LOB parent(s) -> thinking: low`,
              );
            } else {
              log(`    RAG: no KB patterns matched -> thinking: high`);
            }

            // ragContext controls thinking level:
            //   non-empty = RAG has matches = low thinking (fast)
            //   empty = no KB matches = high thinking (accurate)
            // sheetRefContext is always passed but does NOT affect thinking level
            const llmResult = await processRowBatch(
              model,
              needsLLMRows,
              sheetName,
              flattenedJson,
              columnHeaders,
              ragContext,
              referenceContext, // Sheet reference context (regex, codes) - always passed
              cache !== null, // Skip jsonRef in prompt when cached
            );

            // Merge results
            const mergedConfigs = [...directConfigs];
            llmResult.configs.forEach((config) => {
              mergedConfigs.push({
                ...config,
                _source: ragContext ? "llm+rag" : "llm",
              });
            });

            batchResult = {
              configs: mergedConfigs,
              tokenUsage: llmResult.tokenUsage,
              ragStats: ragResult.stats,
            };
          } else {
            // All configs from RAG direct matches - no LLM call needed
            madeAICall = false;
            batchResult = {
              configs: directConfigs,
              tokenUsage: {
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
              },
              ragStats: ragResult.stats,
            };
          }
        } else {
          // No RAG - standard processing with reference context only
          // Empty ragContext = high thinking level (no KB guidance)
          batchResult = await processRowBatch(
            model,
            batchRows,
            sheetName,
            flattenedJson,
            columnHeaders,
            "", // No RAG context = high thinking
            referenceContext, // Sheet reference context still passed
            cache !== null, // Skip jsonRef in prompt when cached
          );
        }

        allConfigs = allConfigs.concat(batchResult.configs);

        totalTokenUsage.promptTokens += batchResult.tokenUsage.promptTokens;
        totalTokenUsage.completionTokens +=
          batchResult.tokenUsage.completionTokens;
        totalTokenUsage.totalTokens += batchResult.tokenUsage.totalTokens;

        totalTokenUsage.batchBreakdown.push({
          batch: globalBatchCount,
          sheet: sheetName,
          rows: batchRows.length,
          ...batchResult.tokenUsage,
          ragStats: batchResult.ragStats,
        });

        const tokenInfo =
          batchResult.tokenUsage.totalTokens > 0
            ? ` | Tokens: ${batchResult.tokenUsage.totalTokens}`
            : " | Tokens: 0 (RAG direct)";

        log(
          `  [Batch ${globalBatchCount}] Generated ${batchResult.configs.length} configs${tokenInfo}`,
          "success",
        );
      } catch (error) {
        log(`  [Batch ${globalBatchCount}] ERROR: ${error.message}`, "error");

        if (
          error.message?.includes("quota") &&
          error.message?.includes("limit: 0")
        ) {
          log("  Daily quota exhausted. Please wait or upgrade.", "error");
        }
      }

      // Delay between batches - skip if no LLM call was made
      if (madeAICall && i + BATCH_SIZE < rowCount) {
        log(
          `  Waiting ${
            CONFIG.DELAY_BETWEEN_BATCHES_MS / 1000
          }s (rate limit)...`,
        );
        await sleep(CONFIG.DELAY_BETWEEN_BATCHES_MS);
      }
    }
  }

  // Step 5: Deduplicate configs
  log("\nDeduplicating configurations...");
  const uniqueConfigs = [];
  const seen = new Set();

  allConfigs.forEach((config) => {
    const key = `${config.keyword || config.uniqueIdentifier}_${
      config.sourceSheet || "default"
    }`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueConfigs.push(config);
    }
  });

  log(
    `Deduplicated: ${allConfigs.length} -> ${uniqueConfigs.length} unique configs`,
  );

  // Step 5.5: Generate list values for List-type configs
  log("\nGenerating list values for List-type fields...");
  let allListValues = [];
  let listValuesTokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  // Apply normalizeDataType to identify List fields accurately
  const listConfigs = uniqueConfigs.filter((c) => {
    const keyword = c.keyword || "";
    const caption = c.keywordcaption || "";
    const rawType = c.keywordtype || c.dataType || "";
    const normalized = normalizeDataType(rawType, keyword, caption);
    return normalized === "List";
  });

  if (listConfigs.length > 0) {
    log(`Found ${listConfigs.length} List-type fields needing values`);

    // Try RAG first for list values
    let ragListContext = "";
    if (ragServices && ragStats && ragStats.totalDocuments > 0) {
      try {
        const listKeywords = listConfigs
          .map((c) => c.keyword || c.keywordcaption || "")
          .filter(Boolean);
        const ragListMatches = [];

        // Search RAG for list values for each keyword
        for (const kw of listKeywords.slice(0, 30)) {
          // Cap at 30 to avoid too many API calls
          const results = await ragServices.searchSimilar(kw, {
            topK: 5,
            docType: "list_value",
            minSimilarity: 0.5,
          });
          if (results.length > 0) {
            results.forEach((r) => {
              if (r.metadata?.keyworddisplay && r.metadata?.keywordvalue) {
                ragListMatches.push(r.metadata);
              }
            });
          }
        }

        if (ragListMatches.length > 0) {
          ragListContext =
            "## List values from knowledge base (reuse these patterns):\n";
          ragListContext += "| keyword | display | value | sequence |\n";
          ragListContext += "|---------|---------|-------|----------|\n";
          ragListMatches.slice(0, 30).forEach((m) => {
            ragListContext += `| ${m.keyword} | ${m.keyworddisplay} | ${m.keywordvalue} | ${m.keyvalsequence} |\n`;
          });
          ragListContext += "\n";
          log(
            `  RAG: Found ${ragListMatches.length} list value references from KB`,
          );

          // Use RAG list values directly where keyword matches exactly
          const ragKeywordMap = {};
          ragListMatches.forEach((m) => {
            const kw = m.keyword;
            if (!ragKeywordMap[kw]) ragKeywordMap[kw] = [];
            ragKeywordMap[kw].push({
              keyword: kw,
              keyworddisplay: m.keyworddisplay,
              keywordvalue: m.keywordvalue,
              defaultselected: m.defaultselected || "False",
              keyvalsequence: m.keyvalsequence,
            });
          });

          // Separate into RAG-resolved and needs-LLM
          const resolvedKeywords = new Set();
          Object.entries(ragKeywordMap).forEach(([kw, values]) => {
            // Check if any of our list configs match this RAG keyword
            const matchingConfig = listConfigs.find(
              (c) =>
                c.keyword === kw ||
                (c.keyword &&
                  kw &&
                  c.keyword.toUpperCase() === kw.toUpperCase()),
            );
            if (matchingConfig) {
              // Use RAG values with the exact keyword from our generated config
              values.forEach((v) => {
                allListValues.push({ ...v, keyword: matchingConfig.keyword });
              });
              resolvedKeywords.add(matchingConfig.keyword);
            }
          });

          if (resolvedKeywords.size > 0) {
            log(
              `  RAG: Resolved list values for ${resolvedKeywords.size} keywords directly`,
            );
          }
        }
      } catch (e) {
        log(`  RAG list search error: ${e.message}`, "error");
      }
    }

    // Generate remaining list values via LLM
    const unresolvedConfigs = listConfigs.filter(
      (c) => !allListValues.some((lv) => lv.keyword === c.keyword),
    );

    if (unresolvedConfigs.length > 0) {
      log(
        `  Generating list values via LLM for ${unresolvedConfigs.length} keywords...`,
      );

      // Also extract any raw list values from the original mapping data
      // (e.g., "Male,Female" in a Values column)
      unresolvedConfigs.forEach((c) => {
        if (!c.rawListValues) {
          // Look in original config for list value hints
          const raw = c.listValues || c.values || c.options || c.dropdown || "";
          if (raw) c.rawListValues = String(raw);
        }
      });

      try {
        // Process in batches of 20 keywords to keep prompts manageable
        const LV_BATCH_SIZE = 20;
        for (let i = 0; i < unresolvedConfigs.length; i += LV_BATCH_SIZE) {
          const batch = unresolvedConfigs.slice(i, i + LV_BATCH_SIZE);

          const lvResult = await processListValuesBatch(
            model,
            batch,
            ragListContext,
            referenceContext,
          );

          allListValues.push(...lvResult.listValues);
          listValuesTokenUsage.promptTokens += lvResult.tokenUsage.promptTokens;
          listValuesTokenUsage.completionTokens +=
            lvResult.tokenUsage.completionTokens;
          listValuesTokenUsage.totalTokens += lvResult.tokenUsage.totalTokens;

          log(
            `  [LV Batch ${Math.floor(i / LV_BATCH_SIZE) + 1}] Generated ${
              lvResult.listValues.length
            } list values | Tokens: ${lvResult.tokenUsage.totalTokens}`,
          );

          if (i + LV_BATCH_SIZE < unresolvedConfigs.length) {
            await sleep(CONFIG.DELAY_BETWEEN_BATCHES_MS);
          }
        }
      } catch (e) {
        log(`  List values LLM error: ${e.message}`, "error");
      }
    }

    // Add list value tokens to total
    totalTokenUsage.promptTokens += listValuesTokenUsage.promptTokens;
    totalTokenUsage.completionTokens += listValuesTokenUsage.completionTokens;
    totalTokenUsage.totalTokens += listValuesTokenUsage.totalTokens;

    log(
      `Total list values generated: ${allListValues.length} for ${listConfigs.length} keywords`,
    );
  } else {
    log("No List-type fields found, skipping list values generation");
  }

  // Step 6: Generate output Excel files
  log("\nGenerating output Excel files...");
  const { outputDir, generatePath } = setupOutputDirectory();
  const { fileName: outputFileName, fullPath: outputPath } = generatePath();

  generateExcelFile(uniqueConfigs, outputPath);
  log(`Input configs Excel created: ${outputFileName}`);

  // Generate list values Excel if we have any
  let listValuesFileName = null;
  let listValuesPath = null;
  if (allListValues.length > 0) {
    const lvPath = generatePath("list_values");
    listValuesFileName = lvPath.fileName;
    listValuesPath = lvPath.fullPath;
    generateListValuesFile(allListValues, listValuesPath);
    log(`List values Excel created: ${listValuesFileName}`);
  }

  // Note: Cache is NOT deleted here — TTL handles natural expiration.
  // If jsonRef changes on next request, getOrCreateCache() will purge early.

  const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
  log("-------------------------------------------");
  log(`Processing complete in ${processingTime}s`);
  log(`Total tokens used: ${totalTokenUsage.totalTokens}`);
  log(`Configurations generated: ${uniqueConfigs.length}`);
  log("-------------------------------------------");

  const stats = {
    totalSheets: mappingResult.sheetNames.length,
    inputSheets: sheetsToProcess.length,
    contextSheets: sheetClassification.contextSheets.length,
    irrelevantSheets: sheetClassification.irrelevantSheets.length,
    sheetsProcessed: sheetsToProcess,
    sheetsUsedAsContext: sheetClassification.contextSheets,
    sheetsSkipped: sheetClassification.irrelevantSheets,
    sheetClassifications: sheetClassification.classifications,
    totalInputFieldsProcessed: totalRows,
    contextRows: contextRows,
    skippedRows: skippedRows,
    configurationsGenerated: uniqueConfigs.length,
    batchesProcessed: totalTokenUsage.batchBreakdown.length,
    processingTimeSeconds: parseFloat(processingTime),
    cachingEnabled: CONFIG.ENABLE_CACHING,
    cacheUsed: cache !== null,
    aiClassificationUsed: true,
  };

  return {
    success: true,
    message: "Input configurations generated successfully",
    outputFile: outputFileName,
    outputPath,
    listValuesFile: listValuesFileName,
    listValuesPath,
    generatedConfigs: uniqueConfigs,
    generatedListValues: allListValues,
    configCount: uniqueConfigs.length,
    listValuesCount: allListValues.length,
    originalJson: jsonResult.data,
    flattenedJson,
    mappingData: Object.values(mappingResult.allSheetsData).flat().slice(0, 50),
    sheetsAnalyzed: sheetsToProcess,
    sheetClassification: sheetClassification.summary,
    fileType: mappingResult.fileType,
    stats,
    tokenUsage: totalTokenUsage,
    structuralFingerprint: mappingResult.structuralFingerprint,
    modelInfo: {
      model: CONFIG.MODEL,
      batchSize: CONFIG.BATCH_SIZE,
      delayBetweenBatches: CONFIG.DELAY_BETWEEN_BATCHES_MS,
      maxRetries: CONFIG.MAX_RETRIES,
    },
  };
}

/**
 * Legacy function without progress callback
 */
async function processFiles(jsonFilePath, mappingFilePath) {
  return processFilesWithProgress(jsonFilePath, mappingFilePath, () => {});
}

// Re-export utilities for external use
const {
  extractColumnMetadata,
  clusterColumns,
  toMarkdownTable,
} = require("./utils/dataProcessing");

module.exports = {
  processFiles,
  processFilesWithProgress,
  readJsonFile,
  readMappingFile,
  flattenJson,
  extractColumnMetadata,
  clusterColumns,
  toMarkdownTable,
  generateExcelFile,
  getOrCreateCache,
  purgeCache,
  CONFIG,
};
