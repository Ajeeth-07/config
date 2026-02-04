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
 * Main function with progress callback for real-time updates
 * @param {string} jsonFilePath - Path to JSON API structure file
 * @param {string} mappingFilePath - Path to Excel/CSV mapping file
 * @param {Function} onProgress - Callback for progress updates (message, type)
 * @returns {Object} Processing result with configurations and metadata
 */
async function processFilesWithProgress(
  jsonFilePath,
  mappingFilePath,
  onProgress = () => {},
) {
  const startTime = Date.now();
  const log = (msg, type = "log") => {
    console.log(msg);
    onProgress(msg, type);
  };

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
  log(`Mapping file parsed: ${mappingResult.sheetNames.length} sheet(s) found`);
  log(`Sheets: ${mappingResult.sheetNames.join(", ")}`);

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

  // Step 3: Calculate totals
  const totalRows = Object.values(mappingResult.allSheetsData).reduce(
    (acc, sheetData) => acc + sheetData.length,
    0,
  );
  const estimatedBatches = Math.ceil(totalRows / CONFIG.BATCH_SIZE);

  log("-------------------------------------------");
  log(`Total input fields to process: ${totalRows}`);
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

  for (const sheetName of mappingResult.sheetNames) {
    const sheetData = mappingResult.allSheetsData[sheetName];
    const fingerprint = mappingResult.structuralFingerprint[sheetName];
    const columnHeaders = fingerprint.columns;
    const rowCount = sheetData.length;

    log(`\n> Processing sheet: "${sheetName}"`);
    log(`  Rows: ${rowCount} | Columns: ${columnHeaders.length}`);

    for (let i = 0; i < rowCount; i += BATCH_SIZE) {
      const batchRows = sheetData.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      globalBatchCount++;

      log(
        `  [Batch ${globalBatchCount}] Processing rows ${i + 1}-${Math.min(
          i + BATCH_SIZE,
          rowCount,
        )}...`,
      );

      try {
        const batchResult = await processRowBatch(
          model,
          batchRows,
          sheetName,
          flattenedJson,
          columnHeaders,
        );

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
        });

        log(
          `  [Batch ${globalBatchCount}] Generated ${batchResult.configs.length} configs | Tokens: ${batchResult.tokenUsage.totalTokens}`,
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

      // Delay between batches
      if (i + BATCH_SIZE < rowCount) {
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
    message: "Input configurations generated successfully",
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
