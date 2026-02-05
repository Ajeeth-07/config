/**
 * Ingestion Service
 * Handles loading, parsing, and ingesting data into the knowledge base
 */

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { addConfigs } = require("./vectorStore");
const { RAG_CONFIG } = require("./config");

/**
 * Load and parse an Excel file containing input configurations
 * @param {string} filePath - Path to Excel file
 * @returns {Object} Parsed data with sheets
 */
function loadExcelFile(filePath) {
  const workbook = XLSX.readFile(filePath);
  const result = {
    sheetNames: workbook.SheetNames,
    sheets: {},
  };

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
    result.sheets[sheetName] = data;
  });

  return result;
}

/**
 * Load and parse a CSV file
 * @param {string} filePath - Path to CSV file
 * @returns {Object[]} Array of row objects
 */
function loadCsvFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const workbook = XLSX.read(content, { type: "string" });
  const sheetName = workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
}

/**
 * Detect and normalize column names to our standard schema
 * Different insurers may use different column names
 * @param {Object[]} data - Array of row objects
 * @returns {Object[]} Normalized data
 */
function normalizeColumns(data) {
  if (!data || data.length === 0) return [];

  // Column name mappings (source -> target)
  const columnMappings = {
    // Keyword variations
    keyword: "keyword",
    uniqueidentifier: "keyword",
    unique_identifier: "keyword",
    field_name: "keyword",
    fieldname: "keyword",
    field: "keyword",
    key: "keyword",
    inputname: "keyword",
    parameter: "keyword",

    // Caption variations
    keywordcaption: "keywordcaption",
    caption: "keywordcaption",
    label: "keywordcaption",
    description: "keywordcaption",
    displayname: "keywordcaption",
    display_name: "keywordcaption",

    // Type variations
    keywordtype: "keywordtype",
    type: "keywordtype",
    datatype: "keywordtype",
    data_type: "keywordtype",
    format: "keywordtype",

    // Mandatory variations
    ismandatory: "ismandatory",
    mandatory: "ismandatory",
    required: "ismandatory",
    is_required: "ismandatory",

    // Regex variations
    regex: "regex",
    pattern: "regex",
    validation: "regex",
    validationpattern: "regex",

    // Length variations
    minlength: "minlength",
    min_length: "minlength",
    maxlength: "maxlength",
    max_length: "maxlength",

    // Value variations
    keyminvalue: "keyminvalue",
    minvalue: "keyminvalue",
    min_value: "keyminvalue",
    keymaxvalue: "keymaxvalue",
    maxvalue: "keymaxvalue",
    max_value: "keymaxvalue",
  };

  return data.map((row) => {
    const normalized = {};

    Object.entries(row).forEach(([key, value]) => {
      const normalizedKey = key
        .toLowerCase()
        .replace(/[\s-]/g, "_")
        .replace(/_+/g, "_");
      const targetKey = columnMappings[normalizedKey] || key;
      normalized[targetKey] = value;
    });

    // Normalize mandatory field to TRUE/FALSE
    if (normalized.ismandatory) {
      const val = String(normalized.ismandatory).toLowerCase();
      if (
        val === "yes" ||
        val === "y" ||
        val === "true" ||
        val === "1" ||
        val === "m"
      ) {
        normalized.ismandatory = "TRUE";
      } else {
        normalized.ismandatory = "FALSE";
      }
    }

    return normalized;
  });
}

/**
 * Filter out empty or invalid rows
 * @param {Object[]} data - Array of row objects
 * @returns {Object[]} Filtered data
 */
function filterValidRows(data) {
  return data.filter((row) => {
    // Must have at least a keyword or field name
    const hasKeyword = row.keyword || row.fieldname || row.field || row.key;

    // Skip completely empty rows
    const hasAnyData = Object.values(row).some(
      (v) => v !== "" && v !== null && v !== undefined,
    );

    return hasKeyword && hasAnyData;
  });
}

/**
 * Ingest an Excel file into the knowledge base
 * @param {string} filePath - Path to Excel file
 * @param {string} insurer - Insurer name
 * @param {string} product - Product name (optional)
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Object>} Ingestion result
 */
async function ingestExcelFile(
  filePath,
  insurer,
  product = "general",
  onProgress = null,
) {
  const log = (msg) => {
    console.log(msg);
    if (onProgress) onProgress(msg);
  };

  log(`Loading file: ${path.basename(filePath)}`);

  const ext = path.extname(filePath).toLowerCase();
  let allConfigs = [];

  if (ext === ".csv") {
    const data = loadCsvFile(filePath);
    const normalized = normalizeColumns(data);
    const filtered = filterValidRows(normalized);
    allConfigs = filtered;
    log(`Loaded ${filtered.length} configurations from CSV`);
  } else {
    const { sheetNames, sheets } = loadExcelFile(filePath);
    log(`Found ${sheetNames.length} sheets: ${sheetNames.join(", ")}`);

    for (const sheetName of sheetNames) {
      const data = sheets[sheetName];
      const normalized = normalizeColumns(data);
      const filtered = filterValidRows(normalized);

      // Add source sheet info
      filtered.forEach((row) => {
        row.sourceSheet = sheetName;
      });

      allConfigs.push(...filtered);
      log(`Sheet "${sheetName}": ${filtered.length} configurations`);
    }
  }

  if (allConfigs.length === 0) {
    return { success: false, error: "No valid configurations found in file" };
  }

  log(`Total configurations to ingest: ${allConfigs.length}`);

  // Add to vector store
  const result = await addConfigs(allConfigs, insurer, product, onProgress);

  return {
    success: true,
    insurer,
    product,
    configurationsIngested: allConfigs.length,
    ...result,
  };
}

/**
 * Ingest from JSON data directly
 * @param {Object[]} configs - Array of configuration objects
 * @param {string} insurer - Insurer name
 * @param {string} product - Product name
 * @param {Function} onProgress - Progress callback
 */
async function ingestFromJson(
  configs,
  insurer,
  product = "general",
  onProgress = null,
) {
  const normalized = normalizeColumns(configs);
  const filtered = filterValidRows(normalized);

  if (filtered.length === 0) {
    return { success: false, error: "No valid configurations in data" };
  }

  const result = await addConfigs(filtered, insurer, product, onProgress);

  return {
    success: true,
    insurer,
    product,
    configurationsIngested: filtered.length,
    ...result,
  };
}

/**
 * Ingest the output Excel file we generate (feedback loop)
 * This allows the system to learn from its own outputs
 * @param {string} outputFilePath - Path to generated output Excel
 * @param {string} insurer - Insurer name
 * @param {string} product - Product name
 * @param {Function} onProgress - Progress callback
 */
async function ingestOutputFile(
  outputFilePath,
  insurer,
  product,
  onProgress = null,
) {
  return ingestExcelFile(outputFilePath, insurer, product, onProgress);
}

module.exports = {
  loadExcelFile,
  loadCsvFile,
  normalizeColumns,
  filterValidRows,
  ingestExcelFile,
  ingestFromJson,
  ingestOutputFile,
};
