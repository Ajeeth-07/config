/**
 * Excel Generation Service
 * Handles transformation and generation of output Excel files
 */

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { getCurrentDate } = require("./utils/helpers");
const { toMarkdownTable } = require("./utils/dataProcessing");
const { EXCEL_COLUMN_ORDER, EXCEL_COLUMN_WIDTHS } = require("./config");

/**
 * Transform AI output to final Excel format with all 33 columns
 * Handles both old format (uniqueIdentifier) and new format (keyword)
 * @param {Array} configs - Array of configuration objects from AI
 * @returns {Array} Transformed configurations with all 33 columns
 */
function transformToFinalFormat(configs) {
  const currentDate = getCurrentDate();

  return configs.map((config) => ({
    keyword: config.keyword || config.uniqueIdentifier || "",
    keywordcaption: config.keywordcaption || config.label || "",
    keywordtype: config.keywordtype || config.dataType || "",
    keyworddatatype: config.keyworddatatype || config.dataType || "",
    parentkeyword: config.parentkeyword || "",
    keysequence: config.keysequence || "",
    defaultvalue: config.defaultvalue || "",
    ismandatory:
      config.ismandatory || (config.required === "YES" ? "TRUE" : "FALSE"),
    inputoroutput: config.inputoroutput || "Input",
    reversecalctype: config.reversecalctype || "",
    addonstype: config.addonstype || "",
    controlgivento: config.controlgivento || "",
    seporagg: config.seporagg || "",
    defaultuibehaviour: config.defaultuibehaviour || "Show",
    maxrepeatercount: config.maxrepeatercount || "",
    keyminvalue: config.keyminvalue || "",
    keymaxvalue: config.keymaxvalue || "",
    minlength: config.minlength || "",
    maxlength: config.maxlength || "",
    regex: config.regex || "",
    lookupcondition: config.lookupcondition || "",
    addlcondition: config.addlcondition || "",
    metadata: config.metadata || "",
    chkfieldsource: config.chkfieldsource || "False",
    defaultadditionstep: config.defaultadditionstep || "",
    fromeffectivedate: config.fromeffectivedate || currentDate,
    toeffectivedate: config.toeffectivedate || "",
    fromversionid: config.fromversionid || "1",
    toversionid: config.toversionid || "",
    keywordsection: config.keywordsection || "",
    coveragecode: config.coveragecode || "",
    riskitemcode: config.riskitemcode || "",
    coverageriskcategory: config.coverageriskcategory || "",
  }));
}

/**
 * Generate Excel file from input configurations with all 33 columns
 * @param {Array} inputConfigs - Array of configuration objects
 * @param {string} outputPath - Full path for output file
 * @returns {string} Output file path
 */
function generateExcelFile(inputConfigs, outputPath) {
  // Transform to final format
  const finalConfigs = transformToFinalFormat(inputConfigs);

  const workbook = XLSX.utils.book_new();

  const worksheet = XLSX.utils.json_to_sheet(finalConfigs, {
    header: EXCEL_COLUMN_ORDER,
  });

  // Set column widths
  worksheet["!cols"] = EXCEL_COLUMN_WIDTHS;

  XLSX.utils.book_append_sheet(workbook, worksheet, "Input Configurations");
  XLSX.writeFile(workbook, outputPath);

  console.log(
    `✅ Excel generated with ${finalConfigs.length} rows and 33 columns`,
  );

  return outputPath;
}

/**
 * Generate Structural Fingerprint Summary for AI context
 * @param {Object} fingerprint - Structural fingerprint from mapping file
 * @param {string} sheetName - Name of the sheet to summarize
 * @returns {string} Markdown formatted summary
 */
function generateStructuralSummary(fingerprint, sheetName) {
  const fp = fingerprint[sheetName];
  let summary = `\n## Sheet: "${sheetName}" (${fp.rowCount} rows, ${fp.columns.length} columns)\n\n`;

  // Column clusters
  summary += `### Column Groups:\n`;
  for (const [cluster, cols] of Object.entries(fp.clusters)) {
    if (cols.length > 0) {
      summary += `- **${cluster.toUpperCase()}** (${cols.length}): ${cols.join(
        ", ",
      )}\n`;
    }
  }

  // Column metadata in markdown table
  summary += `\n### Column Metadata:\n`;
  summary += "| Column | DataType | Distinct | Dropdown Values |\n";
  summary += "| --- | --- | --- | --- |\n";

  fp.columnMetadata.forEach((meta) => {
    const dropdownVals =
      meta.isDropdown && meta.listValues.length > 0
        ? meta.listValues.slice(0, 5).join(", ") +
          (meta.listValues.length > 5 ? "..." : "")
        : "-";
    summary += `| ${meta.columnName} | ${meta.dataType} | ${meta.distinctCount} | ${dropdownVals} |\n`;
  });

  // Sample data in markdown
  summary += `\n### Sample Data:\n`;
  summary += toMarkdownTable(fp.columns.slice(0, 20), fp.sampleRows);
  if (fp.columns.length > 20) {
    summary += `\n_(showing first 20 of ${fp.columns.length} columns)_\n`;
  }

  return summary;
}

/**
 * Ensure output directory exists and generate output path
 * @param {string} baseDir - Base directory for outputs
 * @returns {Object} Object with outputDir and generatePath function
 */
function setupOutputDirectory(baseDir = path.join(__dirname, "..", "outputs")) {
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  return {
    outputDir: baseDir,
    generatePath: (prefix = "input_configurations") => {
      const timestamp = Date.now();
      const fileName = `${prefix}_${timestamp}.xlsx`;
      return {
        fileName,
        fullPath: path.join(baseDir, fileName),
      };
    },
  };
}

module.exports = {
  transformToFinalFormat,
  generateExcelFile,
  generateStructuralSummary,
  setupOutputDirectory,
};
