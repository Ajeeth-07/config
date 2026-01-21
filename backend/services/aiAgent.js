const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const XLSX = require('xlsx');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

  // Step 4: Use Gemini AI to generate input field definitions
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `You are an expert AI assistant helping to generate input field definitions for an insurance form builder.

Given the following JSON structure and Excel metadata, generate a comprehensive list of input field configurations.

JSON Data (flattened):
${JSON.stringify(flattenedJson, null, 2)}

Excel Metadata (field definitions):
${JSON.stringify(excelResult.data, null, 2)}

Original JSON Structure:
${JSON.stringify(jsonResult.data, null, 2)}

Your task:
1. Analyze the JSON structure to identify all required fields
2. Match each field with its metadata from the Excel file (if available)
3. Generate input field configurations with the following properties:
   - fieldName: The field path (e.g., "productCode", "basicDetails.insured.gender")
   - label: A human-readable label
   - dataType: The type of input (text, number, date, select, boolean, etc.)
   - required: Whether the field is required
   - options: For select/dropdown fields, provide the list of values
   - validation: Any validation rules
   - defaultValue: The current value from JSON (if any)

Return ONLY a valid JSON array of field configurations. Do not include any markdown formatting or explanation.
Example format:
[
  {
    "fieldName": "productCode",
    "label": "Product Code",
    "dataType": "text",
    "required": true,
    "defaultValue": "B07"
  },
  {
    "fieldName": "basicDetails.insured.gender",
    "label": "Gender",
    "dataType": "select",
    "required": true,
    "options": ["male", "female", "other"],
    "defaultValue": "female"
  }
]`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();
    
    // Clean up the response - remove markdown code blocks if present
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const generatedFields = JSON.parse(text);

    return {
      success: true,
      originalJson: jsonResult.data,
      flattenedJson: flattenedJson,
      excelMetadata: excelResult.data,
      generatedFields: generatedFields,
      fieldCount: generatedFields.length
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
  flattenJson
};
