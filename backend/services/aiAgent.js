const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAICacheManager } = require("@google/generative-ai/server");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

// Load API key from environment variable
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const cacheManager = new GoogleAICacheManager(process.env.GEMINI_API_KEY);

// Configuration for rate limiting and retries
// Gemini 3 Limits: 5 req/min, 1M input tokens, 65k output tokens, 20 req/day (free)
const CONFIG = {
  MODEL: "gemini-3-pro-preview",
  CACHE_MODEL: "gemini-3-pro-preview",
  BATCH_SIZE: 100, // 100 rows per batch (each row = one input field)
  DELAY_BETWEEN_BATCHES_MS: 3000, // 3 seconds between batches
  MAX_RETRIES: 3,
  INITIAL_RETRY_DELAY_MS: 5000,
  ENABLE_CACHING: true,
  CACHE_TTL_SECONDS: 3600,
};

// In-memory cache for current session
let currentCache = null;

/**
 * System instructions for input configuration generation
 */
const SYSTEM_INSTRUCTIONS = `You are an expert AI assistant for insurance API integration.
Your task is to analyze mapping sheets and generate standardized input configurations.

## OUTPUT FORMAT:
Return ONLY a valid JSON array with these EXACT fields:
[{
  "uniqueIdentifier": "FIELD_NAME_UPPERCASE_NO_SPACES",
  "fieldPath": "path.to.field",
  "label": "Human Readable Label",
  "dataType": "STRING|NUMBER|DATE|BOOLEAN|LIST|EMAIL|PHONE|ALPHANUMERIC",
  "required": "YES|NO",
  "regex": "pattern or empty string",
  "listValues": "comma,separated,values or empty string",
  "sampleValue": "example value",
  "validation": "validation rules",
  "mappedFrom": "original column name",
  "sourceSheet": "sheet name"
}]

## RULES:
1. Generate ONE configuration per column
2. uniqueIdentifier: UPPERCASE, underscores, no spaces (e.g., INSURED_DOB, PROPOSER_EMAIL)
3. Apply appropriate regex patterns:
   - EMAIL: ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$
   - PHONE: ^[0-9]{10}$
   - DATE (DD/MM/YYYY): ^(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[012])/\\d{4}$
   - PAN: ^[A-Z]{5}[0-9]{4}[A-Z]{1}$
   - AADHAAR: ^[2-9]{1}[0-9]{11}$
   - PINCODE: ^[1-9][0-9]{5}$
4. For LIST type, include all dropdown values in listValues
5. Return ONLY JSON array, no markdown, no explanation`;

/**
 * Create or retrieve cached content
 */
async function getOrCreateCache(jsonRef, structuralFingerprint) {
  if (!CONFIG.ENABLE_CACHING) {
    return null;
  }

  try {
    // Create cache content with system instructions and JSON reference
    const cacheContent = `${SYSTEM_INSTRUCTIONS}

## JSON API Reference (for field path mapping):
${JSON.stringify(jsonRef, null, 2)}

## Structural Overview:
${JSON.stringify(
  Object.entries(structuralFingerprint).map(([sheet, fp]) => ({
    sheet,
    columnCount: fp.columns.length,
    clusters: Object.entries(fp.clusters)
      .filter(([_, cols]) => cols.length > 0)
      .map(([name, cols]) => `${name}: ${cols.length}`),
  })),
  null,
  2,
)}`;

    console.log("  📦 Creating context cache...");

    const cache = await cacheManager.create({
      model: CONFIG.CACHE_MODEL,
      displayName: `input-config-cache-${Date.now()}`,
      systemInstruction: SYSTEM_INSTRUCTIONS,
      contents: [
        {
          role: "user",
          parts: [
            { text: `JSON Reference:\n${JSON.stringify(jsonRef, null, 2)}` },
          ],
        },
      ],
      ttlSeconds: CONFIG.CACHE_TTL_SECONDS,
    });

    console.log(
      `  ✅ Cache created: ${cache.name} (TTL: ${CONFIG.CACHE_TTL_SECONDS}s)`,
    );
    currentCache = cache;
    return cache;
  } catch (error) {
    console.log(`  ⚠️  Caching not available: ${error.message}`);
    console.log("  📝 Falling back to non-cached mode");
    return null;
  }
}

/**
 * Get model - either from cache or regular
 */
async function getModel(cache = null) {
  if (cache && CONFIG.ENABLE_CACHING) {
    try {
      return genAI.getGenerativeModelFromCachedContent(cache);
    } catch (error) {
      console.log(`  ⚠️  Could not use cache: ${error.message}`);
    }
  }
  return genAI.getGenerativeModel({ model: CONFIG.MODEL });
}

/**
 * Clean up cache when done
 */
async function cleanupCache() {
  if (currentCache) {
    try {
      await cacheManager.delete(currentCache.name);
      console.log("  🗑️  Cache cleaned up");
      currentCache = null;
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Sleep utility
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry with exponential backoff
 */
async function retryWithBackoff(
  fn,
  maxRetries = CONFIG.MAX_RETRIES,
  initialDelay = CONFIG.INITIAL_RETRY_DELAY_MS,
) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if it's a quota/rate limit error
      const isRateLimitError =
        error.message?.includes("429") ||
        error.message?.includes("quota") ||
        error.message?.includes("Too Many Requests");

      if (isRateLimitError && attempt < maxRetries) {
        // Extract retry delay from error if available
        const retryMatch = error.message?.match(/retry in (\d+\.?\d*)s/i);
        let waitTime = retryMatch
          ? parseFloat(retryMatch[1]) * 1000
          : initialDelay * Math.pow(2, attempt);

        console.log(
          `    ⏳ Rate limited. Waiting ${(waitTime / 1000).toFixed(
            1,
          )}s before retry ${attempt + 1}/${maxRetries}...`,
        );
        await sleep(waitTime);
      } else if (!isRateLimitError) {
        // Non-rate-limit error, don't retry
        throw error;
      }
    }
  }

  throw lastError;
}

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
 * Get current date in YYYY-MM-DD format
 */
function getCurrentDate() {
  const now = new Date();
  return now.toISOString().split("T")[0];
}

/**
 * Transform AI output to final Excel format with all 33 columns
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
 */
function generateExcelFile(inputConfigs, outputPath) {
  // Transform to final format
  const finalConfigs = transformToFinalFormat(inputConfigs);

  const workbook = XLSX.utils.book_new();

  // Define column order explicitly
  const columnOrder = [
    "keyword",
    "keywordcaption",
    "keywordtype",
    "keyworddatatype",
    "parentkeyword",
    "keysequence",
    "defaultvalue",
    "ismandatory",
    "inputoroutput",
    "reversecalctype",
    "addonstype",
    "controlgivento",
    "seporagg",
    "defaultuibehaviour",
    "maxrepeatercount",
    "keyminvalue",
    "keymaxvalue",
    "minlength",
    "maxlength",
    "regex",
    "lookupcondition",
    "addlcondition",
    "metadata",
    "chkfieldsource",
    "defaultadditionstep",
    "fromeffectivedate",
    "toeffectivedate",
    "fromversionid",
    "toversionid",
    "keywordsection",
    "coveragecode",
    "riskitemcode",
    "coverageriskcategory",
  ];

  const worksheet = XLSX.utils.json_to_sheet(finalConfigs, {
    header: columnOrder,
  });

  // Set column widths
  worksheet["!cols"] = [
    { wch: 25 }, // keyword
    { wch: 30 }, // keywordcaption
    { wch: 15 }, // keywordtype
    { wch: 15 }, // keyworddatatype
    { wch: 20 }, // parentkeyword
    { wch: 12 }, // keysequence
    { wch: 15 }, // defaultvalue
    { wch: 12 }, // ismandatory
    { wch: 15 }, // inputoroutput
    { wch: 15 }, // reversecalctype
    { wch: 12 }, // addonstype
    { wch: 15 }, // controlgivento
    { wch: 10 }, // seporagg
    { wch: 18 }, // defaultuibehaviour
    { wch: 15 }, // maxrepeatercount
    { wch: 12 }, // keyminvalue
    { wch: 12 }, // keymaxvalue
    { wch: 10 }, // minlength
    { wch: 10 }, // maxlength
    { wch: 50 }, // regex
    { wch: 20 }, // lookupcondition
    { wch: 20 }, // addlcondition
    { wch: 15 }, // metadata
    { wch: 15 }, // chkfieldsource
    { wch: 18 }, // defaultadditionstep
    { wch: 15 }, // fromeffectivedate
    { wch: 15 }, // toeffectivedate
    { wch: 12 }, // fromversionid
    { wch: 12 }, // toversionid
    { wch: 15 }, // keywordsection
    { wch: 15 }, // coveragecode
    { wch: 15 }, // riskitemcode
    { wch: 18 }, // coverageriskcategory
  ];

  XLSX.utils.book_append_sheet(workbook, worksheet, "Input Configurations");
  XLSX.writeFile(workbook, outputPath);
  console.log(
    `✅ Excel generated with ${finalConfigs.length} rows and 33 columns`,
  );
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
 * STAGE B: Process ROWS in batches (each ROW is an input field)
 * This is the correct approach - rows are input fields, columns are metadata
 */
async function processRowBatch(
  model,
  batchRows,
  sheetName,
  jsonRef,
  columnHeaders,
) {
  // Convert rows to markdown table for better LLM understanding
  let rowsTable = "| " + columnHeaders.join(" | ") + " |\n";
  rowsTable += "| " + columnHeaders.map(() => "---").join(" | ") + " |\n";

  batchRows.forEach((row) => {
    const values = columnHeaders.map((col) => {
      const val = row[col];
      return val !== undefined && val !== null
        ? String(val).substring(0, 100)
        : "";
    });
    rowsTable += "| " + values.join(" | ") + " |\n";
  });

  const prompt = `Analyze these ${
    batchRows.length
  } input field definitions from sheet "${sheetName}" and generate standardized configurations.

## INPUT FIELD DEFINITIONS (each row = one input field):
${rowsTable}

## Column Headers Explanation:
The columns in the table above represent metadata about each input field. Common patterns:
- Field name columns: "Field", "FieldName", "Parameter", "API Key", "InputName", "Keyword"
- Data type columns: "Type", "DataType", "Format"
- Required columns: "Required", "Mandatory", "M/O"
- Validation columns: "Validation", "Regex", "Pattern", "MinLength", "MaxLength", "MinValue", "MaxValue"
- List/Dropdown columns: "Values", "Options", "ListValues", "Master"
- Description columns: "Description", "Label", "Caption"

## JSON API Reference:
${JSON.stringify(jsonRef, null, 2)}

## TASK:
For EACH ROW in the table above, generate ONE configuration object.
Total expected outputs: ${batchRows.length} configurations.

## OUTPUT FORMAT - Generate these fields for each row:
1. keyword: UPPERCASE, underscores, no spaces (e.g., PRODUCT_CODE, INSURED_GENDER)
2. keywordcaption: Human-readable label/description
3. keywordtype: STRING|NUMBER|DATE|BOOLEAN|LIST|EMAIL|PHONE|ALPHANUMERIC
4. keyworddatatype: Same as keywordtype (duplicate for compatibility)
5. ismandatory: TRUE or FALSE (based on required/mandatory column)
6. inputoroutput: "System", "Input", or "Output" (default to "Input" if unclear)
7. defaultuibehaviour: "Show" or "Hide" (default to "Show")
8. keyminvalue: Minimum numeric value if applicable
9. keymaxvalue: Maximum numeric value if applicable
10. minlength: Minimum character length if applicable
11. maxlength: Maximum character length if applicable
12. regex: Apply standard patterns for special types:
    - EMAIL: ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$
    - PHONE: ^[0-9]{10}$
    - DATE: ^(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[012])/\\d{4}$
    - PAN: ^[A-Z]{5}[0-9]{4}[A-Z]{1}$
    - AADHAAR: ^[0-9]{12}$
    - PINCODE: ^[1-9][0-9]{5}$
13. chkfieldsource: "True" or "False" (default to "False")

Return ONLY a JSON array with ${batchRows.length} objects in this exact format:
[{
  "keyword": "",
  "keywordcaption": "",
  "keywordtype": "",
  "keyworddatatype": "",
  "ismandatory": "TRUE/FALSE",
  "inputoroutput": "Input",
  "defaultuibehaviour": "Show",
  "keyminvalue": "",
  "keymaxvalue": "",
  "minlength": "",
  "maxlength": "",
  "regex": "",
  "chkfieldsource": "False"
}]`;

  // Use retry with backoff for API calls
  return await retryWithBackoff(async () => {
    const result = await model.generateContent(prompt);
    const response = result.response;

    // Extract token usage from response
    const usageMetadata = response.usageMetadata || {};
    const tokenUsage = {
      promptTokens: usageMetadata.promptTokenCount || 0,
      completionTokens: usageMetadata.candidatesTokenCount || 0,
      totalTokens: usageMetadata.totalTokenCount || 0,
    };

    let text = response.text();
    text = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const configs = JSON.parse(text);

    return {
      configs,
      tokenUsage,
    };
  });
}

/**
 * Main function: Two-Stage Semantic Compression with Token Tracking
 */
async function processFiles(jsonFilePath, mappingFilePath) {
  const startTime = Date.now();

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

  // Try to create cache for better performance
  const cache = await getOrCreateCache(
    flattenedJson,
    mappingResult.structuralFingerprint,
  );
  const model = await getModel(cache);

  // Calculate total ROWS (input fields) and estimated requests
  // Each ROW in the Excel is an input field, NOT columns!
  const totalRows = Object.values(mappingResult.allSheetsData).reduce(
    (acc, sheetData) => acc + sheetData.length,
    0,
  );
  const estimatedBatches = Math.ceil(totalRows / CONFIG.BATCH_SIZE);
  const estimatedTime =
    (estimatedBatches * CONFIG.DELAY_BETWEEN_BATCHES_MS) / 1000;

  console.log(`\n📊 Processing Summary:`);
  console.log(`   Model: ${CONFIG.MODEL}`);
  console.log(`   Total input fields (rows): ${totalRows}`);
  console.log(`   Batch size: ${CONFIG.BATCH_SIZE} rows per request`);
  console.log(`   Estimated batches/requests: ${estimatedBatches}`);
  console.log(
    `   Estimated processing time: ~${Math.ceil(estimatedTime / 60)} minutes`,
  );
  console.log(
    `   Delay between batches: ${CONFIG.DELAY_BETWEEN_BATCHES_MS / 1000}s`,
  );

  // Warning if exceeding free tier limits
  if (estimatedBatches > 20) {
    console.log(
      `\n⚠️  WARNING: This will require ~${estimatedBatches} API requests.`,
    );
    console.log(`   Gemini 3 Free Tier limit: 20 requests/day`);
    console.log(`   Consider increasing BATCH_SIZE or using paid tier.\n`);
  }

  let allConfigs = [];
  const BATCH_SIZE = CONFIG.BATCH_SIZE;

  // Token usage tracking
  let totalTokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    batchBreakdown: [],
  };

  // Process each sheet - ROWS are input fields
  for (const sheetName of mappingResult.sheetNames) {
    const sheetData = mappingResult.allSheetsData[sheetName];
    const fingerprint = mappingResult.structuralFingerprint[sheetName];
    const columnHeaders = fingerprint.columns;
    const rowCount = sheetData.length;

    console.log(
      `Processing sheet "${sheetName}": ${rowCount} input fields (rows)`,
    );

    // Process ROWS in batches (each row = one input field)
    for (let i = 0; i < rowCount; i += BATCH_SIZE) {
      const batchRows = sheetData.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      console.log(
        `  Batch ${batchNumber}: rows ${i + 1}-${Math.min(
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
          `    Tokens: ${batchResult.tokenUsage.totalTokens} (prompt: ${batchResult.tokenUsage.promptTokens}, completion: ${batchResult.tokenUsage.completionTokens})`,
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
      console.log(
        `    ⏸️  Waiting ${
          CONFIG.DELAY_BETWEEN_BATCHES_MS / 1000
        }s before next batch...`,
      );
      await sleep(CONFIG.DELAY_BETWEEN_BATCHES_MS);
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

  // Cleanup cache after processing
  await cleanupCache();

  const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);

  // Prepare summary stats
  const stats = {
    totalSheets: mappingResult.sheetNames.length,
    sheetsProcessed: mappingResult.sheetNames,
    totalInputFieldsProcessed: Object.values(
      mappingResult.allSheetsData,
    ).reduce((acc, sheetData) => acc + sheetData.length, 0),
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

module.exports = {
  processFiles,
  readJsonFile,
  readMappingFile,
  flattenJson,
  generateExcelFile,
  extractColumnMetadata,
  clusterColumns,
  toMarkdownTable,
  getOrCreateCache,
  cleanupCache,
  CONFIG,
};
