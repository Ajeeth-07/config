/**
 * File reading utilities for JSON and Excel/CSV files
 * Sheet classification is handled separately by sheetClassifier.js using AI
 */

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { extractColumnMetadata, clusterColumns } = require("./dataProcessing");

/**
 * Validates and reads JSON file
 * @param {string} filePath - Path to JSON file
 * @returns {Object} Result with valid flag and data/error
 */
function readJsonFile(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, "utf8");
    const jsonData = JSON.parse(fileContent);
    return { valid: true, data: jsonData };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Reads and parses Excel or CSV file with full metadata extraction
 * Returns ALL sheets - classification is done separately by AI
 * @param {string} filePath - Path to Excel/CSV file
 * @returns {Object} Result with sheet data and structural fingerprint
 */
function readMappingFile(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    let sheetNames = [];
    let allSheetsData = {};
    let structuralFingerprint = {};

    if (ext === ".csv") {
      const fileContent = fs.readFileSync(filePath, "utf8");
      const workbook = XLSX.read(fileContent, { type: "string" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

      sheetNames = [sheetName];
      allSheetsData[sheetName] = data;

      const columns = data.length > 0 ? Object.keys(data[0]) : [];
      structuralFingerprint[sheetName] = {
        columns,
        rowCount: data.length,
        columnMetadata: columns.map((col) => extractColumnMetadata(data, col)),
        clusters: clusterColumns(columns),
        sampleRows: data.slice(0, 5),
      };
    } else {
      const workbook = XLSX.readFile(filePath);
      sheetNames = workbook.SheetNames;

      for (const sheetName of sheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        const columns = data.length > 0 ? Object.keys(data[0]) : [];

        allSheetsData[sheetName] = data;
        structuralFingerprint[sheetName] = {
          columns,
          rowCount: data.length,
          columnMetadata: columns.map((col) =>
            extractColumnMetadata(data, col),
          ),
          clusters: clusterColumns(columns),
          sampleRows: data.slice(0, 5),
        };
      }
    }

    return {
      valid: true,
      sheetNames, // All sheet names
      allSheetsData, // All sheet data
      structuralFingerprint,
      fileType: ext,
    };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

module.exports = {
  readJsonFile,
  readMappingFile,
};
