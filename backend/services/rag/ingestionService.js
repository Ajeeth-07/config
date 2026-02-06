/**
 * Ingestion Service
 * Handles loading, parsing, and ingesting data into the knowledge base
 * Supports Parent-Child hierarchy: groups children under LOB parent documents
 */

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { addConfigs, addParent, makeParentId } = require("./vectorStore");
const { RAG_CONFIG } = require("./config");

/**
 * Load and parse an Excel file containing input configurations
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
 */
function loadCsvFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const workbook = XLSX.read(content, { type: "string" });
  const sheetName = workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
}

/**
 * Detect and normalize column names to our standard schema
 */
function normalizeColumns(data) {
  if (!data || data.length === 0) return [];

  const columnMappings = {
    keyword: "keyword",
    uniqueidentifier: "keyword",
    unique_identifier: "keyword",
    field_name: "keyword",
    fieldname: "keyword",
    field: "keyword",
    key: "keyword",
    inputname: "keyword",
    parameter: "keyword",
    keywordcaption: "keywordcaption",
    caption: "keywordcaption",
    label: "keywordcaption",
    description: "keywordcaption",
    displayname: "keywordcaption",
    display_name: "keywordcaption",
    keywordtype: "keywordtype",
    type: "keywordtype",
    datatype: "keywordtype",
    data_type: "keywordtype",
    format: "keywordtype",
    ismandatory: "ismandatory",
    mandatory: "ismandatory",
    required: "ismandatory",
    is_required: "ismandatory",
    regex: "regex",
    pattern: "regex",
    validation: "regex",
    validationpattern: "regex",
    minlength: "minlength",
    min_length: "minlength",
    maxlength: "maxlength",
    max_length: "maxlength",
    keyminvalue: "keyminvalue",
    minvalue: "keyminvalue",
    min_value: "keyminvalue",
    keymaxvalue: "keymaxvalue",
    maxvalue: "keymaxvalue",
    max_value: "keymaxvalue",
    // List value columns
    keyworddisplay: "keyworddisplay",
    display: "keyworddisplay",
    display_name: "keyworddisplay",
    option_label: "keyworddisplay",
    optionlabel: "keyworddisplay",
    keywordvalue: "keywordvalue",
    value: "keywordvalue",
    option_value: "keywordvalue",
    optionvalue: "keywordvalue",
    code: "keywordvalue",
    keyvalsequence: "keyvalsequence",
    sequence: "keyvalsequence",
    sort_order: "keyvalsequence",
    sortorder: "keyvalsequence",
    defaultselected: "defaultselected",
    default_selected: "defaultselected",
    isdefault: "defaultselected",
    is_default: "defaultselected",
    keywordvaluecaption: "keywordvaluecaption",
    value_caption: "keywordvaluecaption",
    valuecaption: "keywordvaluecaption",
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
 * Detect whether a dataset represents list values (dropdown options)
 * rather than input field configurations.
 *
 * List value files have columns like keyworddisplay, keywordvalue, keyvalsequence.
 * Input config files have columns like keywordtype, ismandatory, regex.
 *
 * @param {Object[]} data - Array of row objects
 * @returns {string} "list_value" or "input_config"
 */
function detectDocType(data) {
  if (!data || data.length === 0) return "input_config";

  const sampleRow = data[0];
  const keys = Object.keys(sampleRow).map((k) =>
    k.toLowerCase().replace(/[\s_-]/g, ""),
  );

  const listValueIndicators = [
    "keyworddisplay",
    "keywordvalue",
    "keyvalsequence",
    "defaultselected",
    "keywordvaluecaption",
  ];

  const inputConfigIndicators = [
    "keywordtype",
    "ismandatory",
    "regex",
    "minlength",
    "maxlength",
    "datatype",
    "mandatory",
    "required",
  ];

  const listScore = listValueIndicators.filter((ind) =>
    keys.includes(ind),
  ).length;
  const inputScore = inputConfigIndicators.filter((ind) =>
    keys.includes(ind),
  ).length;

  return listScore >= 2 ? "list_value" : "input_config";
}

/**
 * Filter out empty or invalid rows
 */
function filterValidRows(data) {
  return data.filter((row) => {
    const hasKeyword = row.keyword || row.fieldname || row.field || row.key;
    const hasAnyData = Object.values(row).some(
      (v) => v !== "" && v !== null && v !== undefined,
    );
    return hasKeyword && hasAnyData;
  });
}

/**
 * Build a parent summary from a collection of child configs
 * @param {Object[]} configs - All normalized child configs for this parent
 * @param {string} lob - Line of business
 * @param {string} insurer - Insurer name
 * @param {string} product - Product name
 * @returns {Object} Parent metadata object
 */
function buildParentSummary(configs, lob, insurer, product) {
  const keywords = configs.map((c) => c.keyword).filter(Boolean);

  const uniqueKeywords = [...new Set(keywords)];
  const sampleKeywords = uniqueKeywords.slice(
    0,
    RAG_CONFIG.PARENT_CHILD.PARENT_SUMMARY_MAX_KEYWORDS,
  );

  // Derive categories from source sheets
  const categories = [
    ...new Set(configs.map((c) => c.sourceSheet).filter(Boolean)),
  ];

  // Build a readable summary
  const summaryParts = [`${lob} insurance fields from ${insurer}`];
  if (product && product !== "general") summaryParts[0] += ` (${product})`;
  if (categories.length > 0) {
    summaryParts.push(`sections: ${categories.join(", ")}`);
  }
  summaryParts.push(`sample fields: ${sampleKeywords.slice(0, 10).join(", ")}`);

  return {
    lob,
    insurer,
    product,
    fieldCount: configs.length,
    sampleKeywords,
    fieldCategories: categories,
    summary: summaryParts.join(" | "),
  };
}

/**
 * Ingest an Excel file into the knowledge base
 * Creates a parent document for the LOB+insurer+product, then adds children.
 *
 * @param {string} filePath
 * @param {string} insurer
 * @param {string} product
 * @param {string} lob - Line of Business (defaults to "general")
 * @param {Function} onProgress
 */
async function ingestExcelFile(
  filePath,
  insurer,
  product = "general",
  lob = "general",
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

  // Auto-detect whether this file contains list values or input configs
  const detectedDocType = detectDocType(allConfigs);
  allConfigs.forEach((row) => {
    row.docType = detectedDocType;
  });
  log(`Document type detected: ${detectedDocType}`);
  log(`Total configurations to ingest: ${allConfigs.length}`);

  // Build and store parent document
  const parentSummary = buildParentSummary(allConfigs, lob, insurer, product);
  log(
    `Creating parent document: ${lob}/${insurer}/${product} (${parentSummary.fieldCount} fields, ${parentSummary.fieldCategories.length} categories)`,
  );
  const parentId = await addParent(parentSummary);
  log(`Parent created: ${parentId}`);

  // Add children linked to parent
  const result = await addConfigs(
    allConfigs,
    insurer,
    product,
    lob,
    parentId,
    onProgress,
  );

  return {
    success: true,
    insurer,
    product,
    lob,
    parentId,
    configurationsIngested: allConfigs.length,
    ...result,
  };
}

/**
 * Ingest from JSON data directly
 */
async function ingestFromJson(
  configs,
  insurer,
  product = "general",
  lob = "general",
  onProgress = null,
) {
  const normalized = normalizeColumns(configs);
  const filtered = filterValidRows(normalized);

  if (filtered.length === 0) {
    return { success: false, error: "No valid configurations in data" };
  }

  // Auto-detect doc type
  const detectedDocType = detectDocType(filtered);
  filtered.forEach((row) => {
    row.docType = detectedDocType;
  });

  // Build and store parent document
  const parentSummary = buildParentSummary(filtered, lob, insurer, product);
  const parentId = await addParent(parentSummary);

  const result = await addConfigs(
    filtered,
    insurer,
    product,
    lob,
    parentId,
    onProgress,
  );

  return {
    success: true,
    insurer,
    product,
    lob,
    parentId,
    configurationsIngested: filtered.length,
    ...result,
  };
}

/**
 * Ingest the output Excel file we generate (feedback loop)
 */
async function ingestOutputFile(
  outputFilePath,
  insurer,
  product,
  lob = "general",
  onProgress = null,
) {
  return ingestExcelFile(outputFilePath, insurer, product, lob, onProgress);
}

module.exports = {
  loadExcelFile,
  loadCsvFile,
  normalizeColumns,
  filterValidRows,
  buildParentSummary,
  ingestExcelFile,
  ingestFromJson,
  ingestOutputFile,
};
