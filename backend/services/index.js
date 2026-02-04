/**
 * AI Agent - Main Entry Point
 * Orchestrates the input configuration generation pipeline
 */

const path = require("path");

// Import configuration
const { CONFIG } = require("./config");

// Import utilities
const { sleep } = require("./utils/helpers");
const { flattenJson } = require("./utils/dataProcessing");
const { readJsonFile, readMappingFile } = require("./utils/fileReaders");

// Import services
const { getOrCreateCache, getModel, cleanupCache } = require("./cacheService");
const { generateExcelFile, setupOutputDirectory } = require("./excelGenerator");
const { processRowBatch, logProcessingSummary } = require("./aiProcessor");

/**
 * Main function: Two-Stage Semantic Compression with Token Tracking
 * Processes JSON and mapping files to generate input configurations
 *
 * @param {string} jsonFilePath - Path to JSON API structure file
 * @param {string} mappingFilePath - Path to Excel/CSV mapping file
 * @returns {Object} Processing result with configurations and metadata
 */
async function processFiles(jsonFilePath, mappingFilePath) {
  const startTime = Date.now();

  // Step 1: Read and validate files
  console.log("\n📂 Reading input files...");

  const jsonResult = readJsonFile(jsonFilePath);
  if (!jsonResult.valid) {
    throw new Error(`Invalid JSON file: ${jsonResult.error}`);
  }
  console.log("  ✅ JSON file validated");

  const mappingResult = readMappingFile(mappingFilePath);
  if (!mappingResult.valid) {
    throw new Error(`Invalid mapping file: ${mappingResult.error}`);
  }
  console.log(
    `  ✅ Mapping file parsed: ${mappingResult.sheetNames.length} sheet(s)`,
  );

  const flattenedJson = flattenJson(jsonResult.data);

  // Step 2: Initialize caching and model
  console.log("\n🤖 Initializing AI model...");
  const cache = await getOrCreateCache(
    flattenedJson,
    mappingResult.structuralFingerprint,
  );
  const model = await getModel(cache);

  // Step 3: Calculate totals and log summary
  const totalRows = Object.values(mappingResult.allSheetsData).reduce(
    (acc, sheetData) => acc + sheetData.length,
    0,
  );

  logProcessingSummary({
    model: CONFIG.MODEL,
    totalRows,
    batchSize: CONFIG.BATCH_SIZE,
    delayBetweenBatches: CONFIG.DELAY_BETWEEN_BATCHES_MS,
  });

  // Step 4: Process each sheet in batches
  let allConfigs = [];
  const BATCH_SIZE = CONFIG.BATCH_SIZE;

  // Token usage tracking
  let totalTokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    batchBreakdown: [],
  };

  console.log("\n🔄 Processing sheets...");

  for (const sheetName of mappingResult.sheetNames) {
    const sheetData = mappingResult.allSheetsData[sheetName];
    const fingerprint = mappingResult.structuralFingerprint[sheetName];
    const columnHeaders = fingerprint.columns;
    const rowCount = sheetData.length;

    console.log(
      `\n📋 Processing sheet "${sheetName}": ${rowCount} input fields (rows)`,
    );

    // Process ROWS in batches (each row = one input field)
    for (let i = 0; i < rowCount; i += BATCH_SIZE) {
      const batchRows = sheetData.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

      console.log(
        `  📦 Batch ${batchNumber}: rows ${i + 1}-${Math.min(
          i + BATCH_SIZE,
          rowCount,
        )} (${batchRows.length} input fields)`,
      );

      try {
        const batchResult = await processRowBatch(
          model,
          batchRows,
          sheetName,
          flattenedJson,
          columnHeaders,
        );

        // Add configs
        allConfigs = allConfigs.concat(batchResult.configs);

        // Accumulate token usage
        totalTokenUsage.promptTokens += batchResult.tokenUsage.promptTokens;
        totalTokenUsage.completionTokens +=
          batchResult.tokenUsage.completionTokens;
        totalTokenUsage.totalTokens += batchResult.tokenUsage.totalTokens;

        // Track per-batch usage
        totalTokenUsage.batchBreakdown.push({
          batch: batchNumber,
          sheet: sheetName,
          rows: batchRows.length,
          ...batchResult.tokenUsage,
        });

        console.log(
          `    📊 Tokens: ${batchResult.tokenUsage.totalTokens} (prompt: ${batchResult.tokenUsage.promptTokens}, completion: ${batchResult.tokenUsage.completionTokens})`,
        );
      } catch (error) {
        console.error(`  ❌ Batch error: ${error.message}`);

        // Check if it's a quota exhausted error (daily limit)
        if (
          error.message?.includes("quota") &&
          error.message?.includes("limit: 0")
        ) {
          console.error(
            `  ⚠️  Daily quota exhausted. Please wait or upgrade your plan.`,
          );
        }
        // Continue with next batch
      }

      // Delay between batches to respect rate limits
      if (i + BATCH_SIZE < rowCount) {
        console.log(
          `    ⏸️  Waiting ${
            CONFIG.DELAY_BETWEEN_BATCHES_MS / 1000
          }s before next batch...`,
        );
        await sleep(CONFIG.DELAY_BETWEEN_BATCHES_MS);
      }
    }
  }

  // Step 5: Deduplicate configs
  console.log("\n🔍 Deduplicating configurations...");
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

  console.log(
    `  ✅ ${allConfigs.length} → ${uniqueConfigs.length} unique configurations`,
  );

  // Step 6: Generate output Excel
  console.log("\n📄 Generating output Excel...");
  const { outputDir, generatePath } = setupOutputDirectory();
  const { fileName: outputFileName, fullPath: outputPath } = generatePath();

  generateExcelFile(uniqueConfigs, outputPath);

  // Step 7: Cleanup
  await cleanupCache();

  const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✨ Processing complete in ${processingTime}s`);

  // Prepare summary stats
  const stats = {
    totalSheets: mappingResult.sheetNames.length,
    sheetsProcessed: mappingResult.sheetNames,
    totalInputFieldsProcessed: totalRows,
    configurationsGenerated: uniqueConfigs.length,
    batchesProcessed: totalTokenUsage.batchBreakdown.length,
    processingTimeSeconds: parseFloat(processingTime),
    cachingEnabled: CONFIG.ENABLE_CACHING,
    cacheUsed: cache !== null,
  };

  return {
    success: true,
    message:
      "Input configurations generated successfully using Two-Stage Semantic Compression" +
      (cache ? " with Context Caching" : ""),
    outputFile: outputFileName,
    outputPath,
    generatedConfigs: uniqueConfigs,
    configCount: uniqueConfigs.length,
    originalJson: jsonResult.data,
    flattenedJson,
    mappingData: Object.values(mappingResult.allSheetsData).flat().slice(0, 50),
    sheetsAnalyzed: mappingResult.sheetNames,
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

// Re-export utilities for external use
const {
  extractColumnMetadata,
  clusterColumns,
  toMarkdownTable,
} = require("./utils/dataProcessing");

module.exports = {
  // Main function
  processFiles,

  // File readers
  readJsonFile,
  readMappingFile,

  // Data processing
  flattenJson,
  extractColumnMetadata,
  clusterColumns,
  toMarkdownTable,

  // Excel generation
  generateExcelFile,

  // Cache management
  getOrCreateCache,
  cleanupCache,

  // Configuration
  CONFIG,
};
