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
 * Normalize a data type value to one of the standardized types:
 * String, Boolean, DOB, Date, List, Integer, Decimal
 *
 * @param {string} raw - Raw data type from AI or input
 * @param {string} keyword - The keyword name (helps detect DOB vs Date)
 * @param {string} caption - The caption (helps detect DOB vs Date)
 * @returns {string} Normalized data type
 */
function normalizeDataType(raw, keyword = "", caption = "") {
  if (!raw) return "String";

  const lower = String(raw).toLowerCase().trim();
  const kw = String(keyword).toLowerCase();
  const cap = String(caption).toLowerCase();

  // DOB detection - only for actual date-of-birth fields
  if (
    lower === "dob" ||
    kw.includes("dob") ||
    kw.includes("date_of_birth") ||
    kw.includes("dateofbirth") ||
    cap.includes("date of birth") ||
    cap.includes("dob")
  ) {
    // But not if it's clearly a generic date field that just mentions "birth"
    if (
      lower === "dob" ||
      kw.includes("dob") ||
      kw.includes("date_of_birth") ||
      cap.includes("date of birth")
    ) {
      return "DOB";
    }
  }

  // Date
  if (lower === "date" || lower === "datetime" || lower === "date/time") {
    return "Date";
  }

  // Boolean
  if (
    lower === "boolean" ||
    lower === "bool" ||
    lower === "yes/no" ||
    lower === "yesno" ||
    lower === "true/false" ||
    lower === "checkbox" ||
    lower === "flag"
  ) {
    return "Boolean";
  }

  // List (dropdowns, radio buttons, selects, enums)
  if (
    lower === "list" ||
    lower === "dropdown" ||
    lower === "drop down" ||
    lower === "select" ||
    lower === "radio" ||
    lower === "radio button" ||
    lower === "radiobutton" ||
    lower === "enum" ||
    lower === "multi-select" ||
    lower === "multiselect" ||
    lower === "combo" ||
    lower === "combobox" ||
    lower === "option" ||
    lower === "options" ||
    lower === "picklist"
  ) {
    return "List";
  }

  // Integer
  if (
    lower === "integer" ||
    lower === "int" ||
    lower === "whole number" ||
    lower === "long" ||
    lower === "short"
  ) {
    return "Integer";
  }

  // Decimal
  if (
    lower === "decimal" ||
    lower === "float" ||
    lower === "double" ||
    lower === "currency" ||
    lower === "amount" ||
    lower === "percentage" ||
    lower === "percent"
  ) {
    return "Decimal";
  }

  // Number - disambiguate to Integer or Decimal based on context
  if (lower === "number" || lower === "numeric" || lower === "num") {
    // Check if caption/keyword hints at decimal
    if (
      cap.includes("amount") ||
      cap.includes("premium") ||
      cap.includes("price") ||
      cap.includes("rate") ||
      cap.includes("percentage") ||
      cap.includes("height") ||
      cap.includes("weight") ||
      cap.includes("bmi") ||
      kw.includes("amount") ||
      kw.includes("premium") ||
      kw.includes("rate")
    ) {
      return "Decimal";
    }
    return "Integer";
  }

  // String - catch-all for text types
  if (
    lower === "string" ||
    lower === "text" ||
    lower === "alpha" ||
    lower === "alphanumeric" ||
    lower === "alpha numeric" ||
    lower === "alpha_numeric" ||
    lower === "varchar" ||
    lower === "char" ||
    lower === "email" ||
    lower === "phone" ||
    lower === "url" ||
    lower === "free text" ||
    lower === "freetext" ||
    lower === "na" ||
    lower === "n/a" ||
    lower === "textarea"
  ) {
    return "String";
  }

  // If it already matches one of our standard types (case-insensitive)
  const standardTypes = {
    string: "String",
    boolean: "Boolean",
    dob: "DOB",
    date: "Date",
    list: "List",
    integer: "Integer",
    decimal: "Decimal",
  };
  if (standardTypes[lower]) return standardTypes[lower];

  // Default fallback
  return "String";
}

/**
 * Transform AI output to final Excel format with all 33 columns
 * Handles both old format (uniqueIdentifier) and new format (keyword)
 * @param {Array} configs - Array of configuration objects from AI
 * @returns {Array} Transformed configurations with all 33 columns
 */
function transformToFinalFormat(configs) {
  const currentDate = getCurrentDate();

  return configs.map((config) => {
    const keyword = config.keyword || config.uniqueIdentifier || "";
    const caption = config.keywordcaption || config.label || "";
    const rawType = config.keywordtype || config.dataType || "";
    const normalizedType = normalizeDataType(rawType, keyword, caption);

    return {
      keyword,
      keywordcaption: caption,
      keywordtype: normalizedType,
      keyworddatatype: normalizedType,
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
    };
  });
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
