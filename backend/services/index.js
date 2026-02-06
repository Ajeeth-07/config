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
const { getOrCreateCache, getModel, cleanupCache } = require("./cacheService");
const { generateExcelFile, setupOutputDirectory } = require("./excelGenerator");
const { processRowBatch, logProcessingSummary } = require("./aiProcessor");

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

  // Step 6: Generate output Excel
  log("\nGenerating output Excel file...");
  const { outputDir, generatePath } = setupOutputDirectory();
  const { fileName: outputFileName, fullPath: outputPath } = generatePath();

  generateExcelFile(uniqueConfigs, outputPath);
  log(`Excel file created: ${outputFileName}`);

  // Step 7: Cleanup
  await cleanupCache();

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
    generatedConfigs: uniqueConfigs,
    configCount: uniqueConfigs.length,
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
  cleanupCache,
  CONFIG,
};
