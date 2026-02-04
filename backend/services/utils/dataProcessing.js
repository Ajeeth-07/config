/**
 * Data processing utilities for transforming and analyzing data
 */

/**
 * Detect data type from array of values
 * @param {Array} values - Array of values to analyze
 * @returns {string} Detected data type
 */
function detectDataType(values) {
  const nonEmptyValues = values.filter(
    (v) => v !== "" && v !== null && v !== undefined,
  );
  if (nonEmptyValues.length === 0) return "STRING";

  const sample = nonEmptyValues.slice(0, 10);

  // Check for boolean
  const booleanValues = ["true", "false", "yes", "no", "y", "n", "1", "0"];
  if (sample.every((v) => booleanValues.includes(String(v).toLowerCase()))) {
    return "BOOLEAN";
  }

  // Check for date patterns
  const datePatterns = [
    /^\d{2}\/\d{2}\/\d{4}$/, // DD/MM/YYYY
    /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
    /^\d{2}-\d{2}-\d{4}$/, // DD-MM-YYYY
  ];
  if (sample.every((v) => datePatterns.some((p) => p.test(String(v))))) {
    return "DATE";
  }

  // Check for email
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (sample.every((v) => emailPattern.test(String(v)))) {
    return "EMAIL";
  }

  // Check for phone (10 digits)
  if (sample.every((v) => /^\d{10}$/.test(String(v)))) {
    return "PHONE";
  }

  // Check for number
  if (sample.every((v) => !isNaN(Number(v)) && String(v).trim() !== "")) {
    return "NUMBER";
  }

  // Check for list (limited distinct values)
  const uniqueValues = [...new Set(nonEmptyValues.map((v) => String(v)))];
  if (
    uniqueValues.length <= 10 &&
    uniqueValues.length < nonEmptyValues.length * 0.5
  ) {
    return "LIST";
  }

  return "STRING";
}

/**
 * Extract column metadata with data type inference and distinct values
 * @param {Array} data - Array of row objects
 * @param {string} columnName - Column name to analyze
 * @returns {Object} Column metadata
 */
function extractColumnMetadata(data, columnName) {
  const values = data.map((row) => row[columnName]);
  const nonEmptyValues = values.filter(
    (v) => v !== "" && v !== null && v !== undefined,
  );
  const uniqueValues = [...new Set(nonEmptyValues.map((v) => String(v)))];
  const dataType = detectDataType(values);

  return {
    columnName,
    dataType,
    distinctCount: uniqueValues.length,
    sampleValues: uniqueValues.slice(0, 5),
    isDropdown: dataType === "LIST" || uniqueValues.length <= 15,
    listValues: uniqueValues.length <= 15 ? uniqueValues : [],
    hasData: nonEmptyValues.length > 0,
  };
}

/**
 * Cluster columns into logical groups based on naming patterns
 * @param {Array} columns - Array of column names
 * @returns {Object} Clustered columns by category
 */
function clusterColumns(columns) {
  const clusters = {
    identity: [], // Name, DOB, Gender, PAN, Aadhaar
    contact: [], // Email, Phone, Address
    insured: [], // Life Assured / Insured person details
    proposer: [], // Proposer / Policyholder details
    coverage: [], // Sum Insured, Premium, Policy Term
    product: [], // Product Code, Plan, LOB
    bank: [], // Bank details, NEFT, Account
    nominee: [], // Nominee details
    medical: [], // Health, Medical history
    other: [], // Everything else
  };

  const patterns = {
    identity:
      /name|dob|birth|gender|sex|pan|aadhaar|aadhar|kyc|age|occupation/i,
    contact: /email|mail|phone|mobile|contact|address|city|state|pin|country/i,
    insured: /insured|life.?assured|la_|la\.|assured|member/i,
    proposer: /proposer|policy.?holder|ph_|ph\.|owner|applicant/i,
    coverage: /sum|premium|cover|term|tenure|amount|benefit|rider/i,
    product: /product|plan|lob|scheme|variant|code|type/i,
    bank: /bank|account|ifsc|neft|branch|upi/i,
    nominee: /nominee|beneficiary/i,
    medical: /health|medical|disease|history|habit|smoke|alcohol|bmi/i,
  };

  columns.forEach((col) => {
    let assigned = false;
    for (const [cluster, pattern] of Object.entries(patterns)) {
      if (pattern.test(col)) {
        clusters[cluster].push(col);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      clusters.other.push(col);
    }
  });

  return clusters;
}

/**
 * Convert data to Markdown table format (LLMs understand this better)
 * @param {Array} headers - Column headers
 * @param {Array} rows - Data rows
 * @returns {string} Markdown table string
 */
function toMarkdownTable(headers, rows) {
  if (headers.length === 0) return "";

  let md = "| " + headers.join(" | ") + " |\n";
  md += "| " + headers.map(() => "---").join(" | ") + " |\n";

  rows.forEach((row) => {
    const values = headers.map((h) => {
      const val = row[h];
      return val !== undefined && val !== null
        ? String(val).substring(0, 50)
        : "";
    });
    md += "| " + values.join(" | ") + " |\n";
  });

  return md;
}

/**
 * Flattens nested JSON object to dot notation
 * @param {Object} obj - Nested object to flatten
 * @param {string} prefix - Key prefix for recursion
 * @returns {Object} Flattened object with dot notation keys
 */
function flattenJson(obj, prefix = "") {
  const flattened = {};
  for (const key in obj) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (
      typeof obj[key] === "object" &&
      obj[key] !== null &&
      !Array.isArray(obj[key])
    ) {
      Object.assign(flattened, flattenJson(obj[key], newKey));
    } else {
      flattened[newKey] = obj[key];
    }
  }
  return flattened;
}

module.exports = {
  detectDataType,
  extractColumnMetadata,
  clusterColumns,
  toMarkdownTable,
  flattenJson,
};
