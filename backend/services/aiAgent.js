const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Hardcoded API key for testing
const GEMINI_API_KEY = 'AIzaSyBRw06FY4gBbG2o_seTkUf638iD_q10_1o';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

/**
 * Validates and reads JSON file
 */
function readJsonFile(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const jsonData = JSON.parse(fileContent);
    return { valid: true, data: jsonData };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Reads and parses Excel file
 */
function readExcelFile(filePath) {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    return { valid: true, data: data };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Flattens nested JSON object to dot notation
 */
function flattenJson(obj, prefix = '') {
  const flattened = {};
  
  for (const key in obj) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
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
  
  // Set column widths for better readability
  worksheet['!cols'] = [
    { wch: 25 },  // uniqueIdentifier
    { wch: 35 },  // fieldPath
    { wch: 25 },  // label
    { wch: 12 },  // dataType
    { wch: 10 },  // required
    { wch: 50 },  // regex
    { wch: 30 },  // listValues
    { wch: 20 },  // sampleValue
    { wch: 30 },  // validation
  ];
  
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Input Configurations');
  XLSX.writeFile(workbook, outputPath);
  
  return outputPath;
}

/**
 * Main function to process files using Gemini AI
 */
async function processFiles(jsonFilePath, excelFilePath) {
  // Step 1: Validate and read JSON
  const jsonResult = readJsonFile(jsonFilePath);
  if (!jsonResult.valid) {
    throw new Error(`Invalid JSON file: ${jsonResult.error}`);
  }

  // Step 2: Read Excel file
  const excelResult = readExcelFile(excelFilePath);
  if (!excelResult.valid) {
    throw new Error(`Invalid Excel file: ${excelResult.error}`);
  }

  // Step 3: Flatten JSON to get all field paths
  const flattenedJson = flattenJson(jsonResult.data);

  // Step 4: Use Gemini AI to generate input configurations
  const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

  const prompt = `You are an expert AI assistant helping to generate input configurations for an insurance API mapping system.

Given the following JSON structure and Excel metadata, generate a comprehensive list of input configurations for API mapping.

JSON Data (flattened):
${JSON.stringify(flattenedJson, null, 2)}

Excel Metadata (field definitions):
${JSON.stringify(excelResult.data, null, 2)}

Original JSON Structure:
${JSON.stringify(jsonResult.data, null, 2)}

Your task:
1. Analyze the JSON structure to identify all fields
2. Match each field with its metadata from the Excel file (if available)
3. Generate a UNIQUE IDENTIFIER for each field following these rules:
   - All UPPERCASE with NO SPACES
   - For simple fields: PRODUCTCODE, SUMINSURED
   - For nested fields use prefix: INSURED_GENDER, INSURED_DOB, PROPOSER_NAME, PROPOSER_EMAIL
   - For coverage/policy fields use short prefix: COV_SUMINSURED, COV_POLICYTERM or PR_PT (policy term)
   - Keep identifiers concise but meaningful

4. Generate input configurations with these EXACT columns:
   - uniqueIdentifier: The unique ID (e.g., "PRODUCTCODE", "INSURED_GENDER", "PR_PT")
   - fieldPath: The JSON path (e.g., "productCode", "basicDetails.insured.gender")
   - label: Human-readable label (e.g., "Product Code", "Insured Gender")
   - dataType: One of: STRING, NUMBER, DATE, BOOLEAN, LIST, EMAIL, PHONE, ALPHANUMERIC
   - required: YES or NO
   - regex: Regular expression pattern where applicable:
     * EMAIL: ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$
     * PHONE: ^[0-9]{10}$
     * DATE (DD/MM/YYYY): ^(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[012])/\\d{4}$
     * ALPHANUMERIC: ^[a-zA-Z0-9]+$
     * Leave empty if no specific pattern needed
   - listValues: Comma-separated values for LIST type (e.g., "male,female,other")
   - sampleValue: The value from JSON or a sample value
   - validation: Any additional validation rules or constraints

Return ONLY a valid JSON array. Do not include any markdown formatting or explanation.
Example format:
[
  {
    "uniqueIdentifier": "PRODUCTCODE",
    "fieldPath": "productCode",
    "label": "Product Code",
    "dataType": "ALPHANUMERIC",
    "required": "YES",
    "regex": "^[a-zA-Z0-9]+$",
    "listValues": "",
    "sampleValue": "B07",
    "validation": "Must be alphanumeric"
  },
  {
    "uniqueIdentifier": "INSURED_GENDER",
    "fieldPath": "basicDetails.insured.gender",
    "label": "Insured Gender",
    "dataType": "LIST",
    "required": "YES",
    "regex": "",
    "listValues": "male,female,other",
    "sampleValue": "female",
    "validation": ""
  },
  {
    "uniqueIdentifier": "PROPOSER_EMAIL",
    "fieldPath": "basicDetails.proposer.email",
    "label": "Proposer Email",
    "dataType": "EMAIL",
    "required": "YES",
    "regex": "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{2,}$",
    "listValues": "",
    "sampleValue": "john@example.com",
    "validation": "Valid email format required"
  },
  {
    "uniqueIdentifier": "PR_PT",
    "fieldPath": "coverageDetails.policyTerm",
    "label": "Policy Term",
    "dataType": "NUMBER",
    "required": "YES",
    "regex": "^[0-9]+$",
    "listValues": "",
    "sampleValue": "20",
    "validation": "Between 5 and 30 years"
  }
]`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();
    
    // Clean up the response - remove markdown code blocks if present
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const generatedConfigs = JSON.parse(text);

    // Generate Excel file
    const outputDir = path.join(__dirname, '..', 'outputs');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const timestamp = Date.now();
    const outputFileName = `input_configurations_${timestamp}.xlsx`;
    const outputPath = path.join(outputDir, outputFileName);
    
    generateExcelFile(generatedConfigs, outputPath);

    return {
      success: true,
      message: 'Input configurations generated successfully',
      outputFile: outputFileName,
      outputPath: outputPath,
      generatedConfigs: generatedConfigs,
      configCount: generatedConfigs.length,
      originalJson: jsonResult.data,
      flattenedJson: flattenedJson,
      excelMetadata: excelResult.data
    };
  } catch (error) {
    console.error('Gemini AI Error:', error);
    throw new Error(`AI processing failed: ${error.message}`);
  }
}

module.exports = {
  processFiles,
  readJsonFile,
  readExcelFile,
  flattenJson,
  generateExcelFile
};
