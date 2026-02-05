/**
 * AI-Powered Sheet Classifier
 * Uses Gemini to intelligently classify Excel sheets
 * Determines which sheets contain input field definitions vs reference data
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Sheet classification types
 */
const SHEET_TYPES = {
  INPUT_FIELDS: "input_fields", // Contains form field definitions - PROCESS these
  REFERENCE_CONTEXT: "reference_context", // Useful context (regex, codes) - USE as context
  IRRELEVANT: "irrelevant", // Reports, compatibility - IGNORE
};

/**
 * Use AI to classify a sheet based on its structure and sample data
 * @param {string} sheetName - Name of the sheet
 * @param {string[]} columns - Column headers
 * @param {Object[]} sampleRows - First few rows of data (max 5)
 * @returns {Promise<Object>} Classification result
 */
async function classifySheetWithAI(sheetName, columns, sampleRows) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    // Prepare sample data for AI analysis
    const sampleDataStr = sampleRows
      .slice(0, 3)
      .map((row, i) => {
        const values = columns
          .slice(0, 10)
          .map((col) => `${col}: "${String(row[col] || "").substring(0, 50)}"`)
          .join(", ");
        return `Row ${i + 1}: {${values}}`;
      })
      .join("\n");

    const prompt = `You are analyzing an Excel sheet from an insurance company's system to determine its purpose.

Sheet Name: "${sheetName}"
Columns (${columns.length} total): ${columns.slice(0, 15).join(", ")}${
      columns.length > 15 ? "..." : ""
    }
Sample Data:
${sampleDataStr}

Classify this sheet into ONE of these categories:

1. "input_fields" - Sheet contains FORM FIELD DEFINITIONS that need to be configured
   - Has columns like: Label, Field Name, Data Type, Required/Mandatory, Min/Max Length, Regex, etc.
   - Each row represents a form input field (e.g., "First Name", "PAN Number", "Date of Birth")
   - This is the PRIMARY data we need to process

2. "reference_context" - Sheet contains REFERENCE DATA useful for understanding the input fields
   - Regex patterns (validation rules for fields like PAN, mobile, email)
   - Code mappings (question codes, product codes)
   - Dropdown values/master lists
   - Validation rules or business rules
   - This data provides CONTEXT but doesn't define input fields directly

3. "irrelevant" - Sheet is not useful for input configuration
   - Compatibility reports
   - System logs or audit data
   - Metadata about the file itself
   - Empty or test data

Respond with ONLY a JSON object (no markdown):
{
  "type": "input_fields|reference_context|irrelevant",
  "confidence": 0.0-1.0,
  "reason": "Brief explanation",
  "contextValue": "If reference_context, describe what context it provides"
}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    // Parse JSON response (handle potential markdown wrapping)
    let jsonStr = responseText;
    if (responseText.includes("```")) {
      jsonStr = responseText.replace(/```json?\n?/g, "").replace(/```/g, "");
    }

    const classification = JSON.parse(jsonStr.trim());

    return {
      sheetName,
      type: classification.type || SHEET_TYPES.INPUT_FIELDS,
      confidence: classification.confidence || 0.5,
      reason: classification.reason || "AI classification",
      contextValue: classification.contextValue || null,
      aiClassified: true,
    };
  } catch (error) {
    console.error(
      `AI classification failed for "${sheetName}":`,
      error.message,
    );
    // Fall back to heuristic classification
    return classifySheetHeuristic(sheetName, columns, sampleRows);
  }
}

/**
 * Heuristic-based sheet classification (fallback when AI fails)
 * @param {string} sheetName - Name of the sheet
 * @param {string[]} columns - Column headers
 * @param {Object[]} sampleRows - Sample rows
 * @returns {Object} Classification result
 */
function classifySheetHeuristic(sheetName, columns, sampleRows) {
  const lowerName = sheetName.toLowerCase();
  const lowerColumns = columns.map((c) =>
    c.toLowerCase().replace(/[_\s]/g, ""),
  );

  // Check for irrelevant patterns first
  const irrelevantPatterns = [
    "compatibility",
    "report",
    "log",
    "audit",
    "test",
  ];
  if (irrelevantPatterns.some((p) => lowerName.includes(p))) {
    return {
      sheetName,
      type: SHEET_TYPES.IRRELEVANT,
      confidence: 0.8,
      reason: "Sheet name suggests non-data content",
      contextValue: null,
      aiClassified: false,
    };
  }

  // Check for reference/context patterns
  const referencePatterns = [
    "regex",
    "pattern",
    "validation",
    "code",
    "dropdown",
    "values",
    "list",
  ];
  const isReferenceLike = referencePatterns.some((p) => lowerName.includes(p));

  // Check for input field indicators in columns
  const fieldIndicators = [
    "label",
    "caption",
    "field",
    "name",
    "description",
    "question",
  ];
  const typeIndicators = ["type", "datatype", "format", "control"];
  const validationIndicators = ["required", "mandatory", "min", "max", "regex"];

  const hasFieldIndicator = lowerColumns.some((c) =>
    fieldIndicators.some((ind) => c.includes(ind)),
  );
  const hasTypeIndicator = lowerColumns.some((c) =>
    typeIndicators.some((ind) => c.includes(ind)),
  );
  const hasValidationIndicator = lowerColumns.some((c) =>
    validationIndicators.some((ind) => c.includes(ind)),
  );

  // Score-based classification
  let inputScore = 0;
  if (hasFieldIndicator) inputScore += 0.4;
  if (hasTypeIndicator) inputScore += 0.3;
  if (hasValidationIndicator) inputScore += 0.2;

  // Sheets with field+type indicators are likely input definitions
  if (inputScore >= 0.5) {
    return {
      sheetName,
      type: SHEET_TYPES.INPUT_FIELDS,
      confidence: Math.min(inputScore + 0.2, 0.9),
      reason: "Contains field definition columns",
      contextValue: null,
      aiClassified: false,
    };
  }

  // Reference-like sheets without field definitions
  if (
    isReferenceLike ||
    lowerColumns.some((c) => c.includes("regex") || c.includes("pattern"))
  ) {
    return {
      sheetName,
      type: SHEET_TYPES.REFERENCE_CONTEXT,
      confidence: 0.7,
      reason: "Contains reference/validation data",
      contextValue: "Validation patterns or lookup values",
      aiClassified: false,
    };
  }

  // Empty sheets
  if (!sampleRows || sampleRows.length === 0) {
    return {
      sheetName,
      type: SHEET_TYPES.IRRELEVANT,
      confidence: 1.0,
      reason: "Empty sheet",
      contextValue: null,
      aiClassified: false,
    };
  }

  // Default: treat as input fields (conservative)
  return {
    sheetName,
    type: SHEET_TYPES.INPUT_FIELDS,
    confidence: 0.5,
    reason: "Unable to determine - treating as input fields",
    contextValue: null,
    aiClassified: false,
  };
}

/**
 * Classify all sheets in a workbook
 * @param {Object} sheetsData - Map of sheet name to data
 * @param {Object} fingerprints - Map of sheet name to structural fingerprint
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Object>} Classification results
 */
async function classifyAllSheets(sheetsData, fingerprints, onProgress = null) {
  const log = (msg) => {
    console.log(msg);
    if (onProgress) onProgress(msg, "info");
  };

  const sheetNames = Object.keys(sheetsData);
  log(`Analyzing ${sheetNames.length} sheets with AI...`);

  const classifications = {};
  const inputSheets = [];
  const contextSheets = [];
  const irrelevantSheets = [];

  // Classify each sheet (can be parallelized, but sequential for rate limiting)
  for (const sheetName of sheetNames) {
    const data = sheetsData[sheetName];
    const fp = fingerprints[sheetName];
    const columns =
      fp?.columns || (data.length > 0 ? Object.keys(data[0]) : []);
    const sampleRows = data.slice(0, 5);

    // Use AI classification
    const classification = await classifySheetWithAI(
      sheetName,
      columns,
      sampleRows,
    );
    classifications[sheetName] = classification;

    // Categorize
    switch (classification.type) {
      case SHEET_TYPES.INPUT_FIELDS:
        inputSheets.push(sheetName);
        log(`  [INPUT] "${sheetName}" - ${classification.reason}`);
        break;
      case SHEET_TYPES.REFERENCE_CONTEXT:
        contextSheets.push(sheetName);
        log(`  [CONTEXT] "${sheetName}" - ${classification.reason}`);
        break;
      case SHEET_TYPES.IRRELEVANT:
        irrelevantSheets.push(sheetName);
        log(`  [SKIP] "${sheetName}" - ${classification.reason}`);
        break;
    }

    // Small delay between AI calls
    await new Promise((r) => setTimeout(r, 200));
  }

  log(`\nClassification complete:`);
  log(`  - Input field sheets: ${inputSheets.length}`);
  log(`  - Context/reference sheets: ${contextSheets.length}`);
  log(`  - Irrelevant sheets: ${irrelevantSheets.length}`);

  return {
    classifications,
    inputSheets,
    contextSheets,
    irrelevantSheets,
    summary: {
      total: sheetNames.length,
      inputCount: inputSheets.length,
      contextCount: contextSheets.length,
      irrelevantCount: irrelevantSheets.length,
    },
  };
}

/**
 * Build context string from reference sheets
 * This context is passed to the AI when generating input configurations
 * @param {Object} sheetsData - All sheets data
 * @param {string[]} contextSheetNames - Names of context sheets
 * @returns {string} Formatted context string
 */
function buildReferenceContext(sheetsData, contextSheetNames) {
  if (!contextSheetNames || contextSheetNames.length === 0) {
    return "";
  }

  let context = "## Reference Data from Supporting Sheets:\n\n";

  for (const sheetName of contextSheetNames) {
    const data = sheetsData[sheetName];
    if (!data || data.length === 0) continue;

    context += `### ${sheetName}:\n`;

    // For regex/pattern sheets, extract the patterns
    const columns = Object.keys(data[0]);
    const isRegexSheet = columns.some(
      (c) =>
        c.toLowerCase().includes("regex") ||
        c.toLowerCase().includes("pattern"),
    );

    if (isRegexSheet) {
      // Extract regex patterns
      const patterns = data.slice(0, 20).map((row) => {
        const entries = Object.entries(row)
          .filter(([k, v]) => v && String(v).length < 200)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        return `  - ${entries}`;
      });
      context += patterns.join("\n") + "\n\n";
    } else {
      // For other reference sheets, show column names and sample
      context += `Columns: ${columns.slice(0, 10).join(", ")}\n`;
      context += `Sample (${Math.min(data.length, 5)} of ${
        data.length
      } rows):\n`;

      data.slice(0, 5).forEach((row, i) => {
        const sample = columns
          .slice(0, 5)
          .map((c) => `${c}="${String(row[c] || "").substring(0, 30)}"`)
          .join(", ");
        context += `  ${i + 1}. ${sample}\n`;
      });
      context += "\n";
    }
  }

  return context;
}

module.exports = {
  SHEET_TYPES,
  classifySheetWithAI,
  classifySheetHeuristic,
  classifyAllSheets,
  buildReferenceContext,
};
