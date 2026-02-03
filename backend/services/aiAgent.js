const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

// Load API key from environment variable
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Validates and reads JSON file
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
 * Detect data type from values
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
 * Convert data to Markdown table format (LLMs understand this better)
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
 * Cluster columns into logical groups based on naming patterns
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
 * Reads and parses Excel or CSV file with full metadata extraction
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
        sampleRows: data.slice(0, 3),
      };
    } else {
      const workbook = XLSX.readFile(filePath);
      sheetNames = workbook.SheetNames;

      for (const sheetName of sheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
        allSheetsData[sheetName] = data;

        const columns = data.length > 0 ? Object.keys(data[0]) : [];
        structuralFingerprint[sheetName] = {
          columns,
          rowCount: data.length,
          columnMetadata: columns.map((col) =>
            extractColumnMetadata(data, col),
          ),
          clusters: clusterColumns(columns),
          sampleRows: data.slice(0, 3),
        };
      }
    }

    return {
      valid: true,
      sheetNames,
      allSheetsData,
      structuralFingerprint,
      fileType: ext,
    };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Flattens nested JSON object to dot notation
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

/**
 * Generate Excel file from input configurations
 */
function generateExcelFile(inputConfigs, outputPath) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(inputConfigs);

  worksheet["!cols"] = [
    { wch: 25 },
    { wch: 35 },
    { wch: 25 },
    { wch: 12 },
    { wch: 10 },
    { wch: 50 },
    { wch: 30 },
    { wch: 20 },
    { wch: 30 },
    { wch: 20 },
    { wch: 15 },
  ];

  XLSX.utils.book_append_sheet(workbook, worksheet, "Input Configurations");
  XLSX.writeFile(workbook, outputPath);
  return outputPath;
}

/**
 * STAGE A: Generate Structural Fingerprint Summary for AI
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
 * STAGE B: Process columns in batches
 */
async function processColumnBatch(
  model,
  batchColumns,
  metadata,
  sheetName,
  jsonRef,
) {
  const batchMeta = metadata.filter((m) => batchColumns.includes(m.columnName));

  let metaTable =
    "| Column | DataType | Dropdown Values |\n| --- | --- | --- |\n";
  batchMeta.forEach((m) => {
    const vals = m.isDropdown ? m.listValues.join(", ") : "-";
    metaTable += `| ${m.columnName} | ${m.dataType} | ${vals} |\n`;
  });

  const prompt = `Generate input configurations for these ${
    batchColumns.length
  } fields from sheet "${sheetName}".

## Column Metadata:
${metaTable}

## JSON API Reference (for field path mapping):
${JSON.stringify(jsonRef, null, 2)}

## Rules:
1. Generate ONE configuration per column
2. uniqueIdentifier: UPPERCASE, no spaces (e.g., INSURED_DOB, PROPOSER_EMAIL)
3. Use detected dataType, apply appropriate regex
4. Standard regex: EMAIL=^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$, PHONE=^[0-9]{10}$, DATE=^(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[012])/\\d{4}$, PAN=^[A-Z]{5}[0-9]{4}[A-Z]{1}$
5. listValues: Include dropdown values if applicable

Return ONLY a JSON array:
[{"uniqueIdentifier":"","fieldPath":"","label":"","dataType":"","required":"YES/NO","regex":"","listValues":"","sampleValue":"","validation":"","mappedFrom":"","sourceSheet":"${sheetName}"}]`;

  const result = await model.generateContent(prompt);
  let text = result.response.text();
  text = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  return JSON.parse(text);
}

/**
 * Main function: Two-Stage Semantic Compression
 */
async function processFiles(jsonFilePath, mappingFilePath) {
  // Step 1: Read and validate files
  const jsonResult = readJsonFile(jsonFilePath);
  if (!jsonResult.valid) {
    throw new Error(`Invalid JSON file: ${jsonResult.error}`);
  }

  const mappingResult = readMappingFile(mappingFilePath);
  if (!mappingResult.valid) {
    throw new Error(`Invalid mapping file: ${mappingResult.error}`);
  }

  const flattenedJson = flattenJson(jsonResult.data);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  let allConfigs = [];
  const BATCH_SIZE = 20; // Process 20 columns at a time

  // Process each sheet
  for (const sheetName of mappingResult.sheetNames) {
    const fingerprint = mappingResult.structuralFingerprint[sheetName];
    const columns = fingerprint.columns;
    const metadata = fingerprint.columnMetadata;

    console.log(`Processing sheet "${sheetName}": ${columns.length} columns`);

    // STAGE A: Send structural summary first for context
    const structuralSummary = generateStructuralSummary(
      mappingResult.structuralFingerprint,
      sheetName,
    );

    // STAGE B: Process in batches
    for (let i = 0; i < columns.length; i += BATCH_SIZE) {
      const batchColumns = columns.slice(i, i + BATCH_SIZE);
      console.log(
        `  Batch ${Math.floor(i / BATCH_SIZE) + 1}: columns ${i + 1}-${Math.min(
          i + BATCH_SIZE,
          columns.length,
        )}`,
      );

      try {
        const batchConfigs = await processColumnBatch(
          model,
          batchColumns,
          metadata,
          sheetName,
          flattenedJson,
        );
        allConfigs = allConfigs.concat(batchConfigs);
      } catch (error) {
        console.error(`  Batch error: ${error.message}`);
        // Continue with next batch
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // Deduplicate configs (same field from different sheets)
  const uniqueConfigs = [];
  const seen = new Set();

  allConfigs.forEach((config) => {
    const key = `${config.uniqueIdentifier}_${config.sourceSheet}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueConfigs.push(config);
    }
  });

  // Generate output Excel
  const outputDir = path.join(__dirname, "..", "outputs");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  const outputFileName = `input_configurations_${timestamp}.xlsx`;
  const outputPath = path.join(outputDir, outputFileName);

  generateExcelFile(uniqueConfigs, outputPath);

  // Prepare summary stats
  const stats = {
    totalSheets: mappingResult.sheetNames.length,
    sheetsProcessed: mappingResult.sheetNames,
    totalColumnsProcessed: Object.values(
      mappingResult.structuralFingerprint,
    ).reduce((acc, fp) => acc + fp.columns.length, 0),
    configurationsGenerated: uniqueConfigs.length,
    batchesProcessed: Math.ceil(
      Object.values(mappingResult.structuralFingerprint).reduce(
        (acc, fp) => acc + fp.columns.length,
        0,
      ) / BATCH_SIZE,
    ),
  };

  return {
    success: true,
    message:
      "Input configurations generated successfully using Two-Stage Semantic Compression",
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
    structuralFingerprint: mappingResult.structuralFingerprint,
  };
}

module.exports = {
  processFiles,
  readJsonFile,
  readMappingFile,
  flattenJson,
  generateExcelFile,
  extractColumnMetadata,
  clusterColumns,
  toMarkdownTable,
};
