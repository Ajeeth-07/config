/**
 * AI Processing Service
 * Handles interaction with Gemini AI for batch processing
 * With RAG enhancement for better accuracy and token savings
 *
 * Gemini 3 Features:
 * - Thinking Level: Controls reasoning depth (low, medium, high)
 * - See: https://ai.google.dev/gemini-api/docs/gemini-3#thinking_level
 */

const { retryWithBackoff } = require("./utils/helpers");
const { CONFIG } = require("./config");

/**
 * Process a batch of rows through the AI model with RAG context
 * Each row represents one input field configuration
 *
 * @param {Object} model - Gemini model instance
 * @param {Array} batchRows - Array of row objects to process
 * @param {string} sheetName - Name of the source sheet
 * @param {Object} jsonRef - JSON reference for field path mapping
 * @param {Array} columnHeaders - Array of column header names
 * @param {string} ragContext - Optional RAG context with similar examples
 * @returns {Object} Object containing configs array and tokenUsage
 */
/**
 * @param {string} ragContext - RAG KB context (non-empty = has matches = low thinking)
 * @param {string} sheetRefContext - Reference context from context sheets (does NOT affect thinking)
 * @param {boolean} isCacheBacked - If true, jsonRef is already in the Gemini cache; skip embedding it in the prompt
 */
async function processRowBatch(
  model,
  batchRows,
  sheetName,
  jsonRef,
  columnHeaders,
  ragContext = "",
  sheetRefContext = "",
  isCacheBacked = false,
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

  // Build prompt
  let prompt = "";

  // Add reference context from supporting sheets (regex, codes, etc.)
  if (sheetRefContext) {
    prompt += `${sheetRefContext}\n`;
  }

  // Add RAG knowledge base context if available
  if (ragContext) {
    prompt += `${ragContext}\n`;
    prompt += `IMPORTANT: Follow the naming patterns and conventions shown in the knowledge base reference above. Use the same keyword naming style, data types, and validation patterns.\n\n`;
  }

  prompt += `Analyze these ${
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

${isCacheBacked ? "## JSON API Reference:\n(Provided via context cache — do not repeat here)" : `## JSON API Reference:\n${JSON.stringify(jsonRef, null, 2)}`}

## TASK:
For EACH ROW in the table above, generate ONE configuration object.
Total expected outputs: ${batchRows.length} configurations.

## OUTPUT FORMAT - Generate these fields for each row:
1. keyword: UPPERCASE, underscores, no spaces (e.g., PRODUCT_CODE, INSURED_GENDER)
2. keywordcaption: Human-readable label/description
3. keywordtype: MUST be one of these EXACT values only:
   - "String" - for text, alpha, alphanumeric, email, phone, PAN, Aadhaar, names, addresses, free text
   - "Integer" - for whole numbers (age, count, pin code, mobile number)
   - "Decimal" - for decimal/float numbers (height, weight, percentage, premium amounts)
   - "Boolean" - for yes/no, true/false, checkbox fields
   - "DOB" - ONLY for Date of Birth fields specifically
   - "Date" - for all other date fields (policy date, effective date, expiry date, etc.)
   - "List" - for dropdowns, radio buttons, select boxes, option lists, enums, multi-select
4. keyworddatatype: MUST be the same value as keywordtype (use the exact same standardized value)
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

  // Determine thinking level based on whether RAG context is provided
  // With RAG context, model has reference patterns - use low thinking for speed
  // Without RAG, use high thinking for deep reasoning
  const thinkingLevel = ragContext
    ? CONFIG.THINKING_LEVEL_WITH_RAG_CONTEXT
    : CONFIG.THINKING_LEVEL;

  // Use retry with backoff for API calls
  return await retryWithBackoff(async () => {
    // Gemini 3 generation config with thinking level
    // See: https://ai.google.dev/gemini-api/docs/gemini-3#thinking_level
    const generationConfig = {
      thinkingConfig: {
        thinkingLevel: thinkingLevel,
      },
    };

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
    });
    const response = result.response;

    // Extract token usage from response
    const usageMetadata = response.usageMetadata || {};
    const tokenUsage = {
      promptTokens: usageMetadata.promptTokenCount || 0,
      completionTokens: usageMetadata.candidatesTokenCount || 0,
      totalTokens: usageMetadata.totalTokenCount || 0,
      thinkingLevel: thinkingLevel, // Track which thinking level was used
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
 * Process rows with RAG - use direct matches and LLM for rest
 * @param {Object} model - Gemini model instance
 * @param {Array} batchRows - Array of row objects
 * @param {string} sheetName - Sheet name
 * @param {Object} jsonRef - JSON reference
 * @param {Array} columnHeaders - Column headers
 * @param {Object} ragResult - Result from processWithRAG
 * @returns {Object} Configs and token usage
 */
async function processRowBatchWithRAG(
  model,
  batchRows,
  sheetName,
  jsonRef,
  columnHeaders,
  ragResult,
  isCacheBacked = false,
) {
  const allConfigs = [];
  let totalTokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  // Direct matches from RAG - skip LLM entirely
  ragResult.directMatches.forEach((match) => {
    allConfigs[match.rowIndex] = {
      ...match.config,
      _source: "rag_direct",
      _similarity: match.similarity,
    };
  });

  // Process remaining rows through LLM with RAG context
  if (ragResult.needsLLM.length > 0) {
    const rows = ragResult.needsLLM.map((item) => batchRows[item.rowIndex]);

    // Build RAG context
    let ragContext = "";
    const contexts = ragResult.contexts;
    const patterns = new Set();

    ragResult.needsLLM.forEach((item) => {
      const ctx = contexts.get(item.rowIndex);
      if (ctx?.hasContext) {
        ctx.similarConfigs.forEach((sim) => {
          patterns.add(
            JSON.stringify({
              keyword: sim.metadata.keyword,
              keywordcaption: sim.metadata.keywordcaption,
              keywordtype: sim.metadata.keywordtype,
            }),
          );
        });
      }
    });

    if (patterns.size > 0) {
      ragContext = "## Reference patterns from knowledge base:\n";
      ragContext +=
        Array.from(patterns)
          .slice(0, 10)
          .map((p) => {
            const obj = JSON.parse(p);
            return `- ${obj.keyword}: ${obj.keywordcaption} (${obj.keywordtype})`;
          })
          .join("\n") + "\n\n";
    }

    const result = await processRowBatch(
      model,
      rows,
      sheetName,
      jsonRef,
      columnHeaders,
      ragContext,
      "",
      isCacheBacked,
    );

    result.configs.forEach((config, idx) => {
      const originalIdx = ragResult.needsLLM[idx].rowIndex;
      allConfigs[originalIdx] = config;
    });

    totalTokenUsage = result.tokenUsage;
  }

  // Filter nulls and return
  return {
    configs: allConfigs.filter(Boolean),
    tokenUsage: totalTokenUsage,
  };
}

/**
 * Log processing summary for a batch
 * @param {number} batchNum - Batch number
 * @param {Object} tokenUsage - Token usage stats
 * @param {number} configCount - Number of configs generated
 */
function logProcessingSummary(batchNum, tokenUsage, configCount) {
  console.log(`  Batch ${batchNum}: ${configCount} configs generated`);
  console.log(
    `    Tokens: ${tokenUsage.promptTokens} prompt + ${tokenUsage.completionTokens} completion = ${tokenUsage.totalTokens} total`,
  );
}

/**
 * Generate list values (dropdown options) for List-type configs via LLM.
 *
 * @param {Object} model - Gemini model instance
 * @param {Array} listConfigs - Array of configs with keywordtype "List".
 *   Each must have at least { keyword, keywordcaption }. May also carry
 *   rawListValues (comma-separated options from the mapping sheet).
 * @param {string} ragListContext - RAG context with similar list values from KB
 * @param {string} sheetRefContext - Reference context from context sheets
 * @returns {Object} { listValues: Array, tokenUsage: Object }
 */
async function processListValuesBatch(
  model,
  listConfigs,
  ragListContext = "",
  sheetRefContext = "",
) {
  // Build a summary table of the List fields we need values for
  let fieldsTable = "| keyword | caption | rawValues |\n";
  fieldsTable += "|---------|---------|----------|\n";
  listConfigs.forEach((c) => {
    const raw = c.rawListValues || c.listValues || "";
    fieldsTable += `| ${c.keyword} | ${c.keywordcaption || ""} | ${String(
      raw,
    ).substring(0, 200)} |\n`;
  });

  let prompt = "";

  if (sheetRefContext) {
    prompt += `${sheetRefContext}\n`;
  }

  if (ragListContext) {
    prompt += `${ragListContext}\n`;
    prompt += `IMPORTANT: Use the list values from the knowledge base reference above as a guide. Reuse exact keywordvalue codes and display names when the keyword/caption is similar.\n\n`;
  }

  prompt += `Generate dropdown/list option values for these ${listConfigs.length} List-type input fields.

## LIST FIELDS THAT NEED VALUES:
${fieldsTable}

## RULES:
1. For EACH keyword above, generate ALL reasonable option values
2. If "rawValues" already contains comma-separated options, use those EXACTLY
3. If no rawValues are given, generate sensible defaults based on the field name:
   - Gender fields: Male, Female, Transgender, Other
   - Salutation fields: Mr, Mrs, Miss, Ms, Dr
   - Yes/No fields: Yes, No
   - Marital Status: Single, Married, Divorced, Widowed
   - Occupation type: Salaried, Self Employed, Business, Professional, Retired, Student, Homemaker
   - Nationality: Indian, NRI, PIO, Foreign National
   - Use domain knowledge for insurance-specific fields
4. keywordvalue should be a short code: sequential number ("1","2","3") OR uppercase short code ("MR","MRS","MALE","FEMALE")
5. keyvalsequence must be sequential starting from 1 for each keyword
6. defaultselected should be "False" for all values unless it is an obvious default

## OUTPUT FORMAT:
Return ONLY a JSON array. Each element = one option value:
[{
  "keyword": "EXACT_KEYWORD_FROM_ABOVE",
  "keyworddisplay": "Human Readable Option Label",
  "keywordvalue": "CODE_OR_NUMBER",
  "defaultselected": "False",
  "keyvalsequence": 1
}]

Generate values for ALL ${listConfigs.length} keywords. Return a flat array (not nested).`;

  const thinkingLevel = ragListContext
    ? CONFIG.THINKING_LEVEL_WITH_RAG_CONTEXT
    : CONFIG.THINKING_LEVEL;

  return await retryWithBackoff(async () => {
    const generationConfig = {
      thinkingConfig: {
        thinkingLevel: thinkingLevel,
      },
    };

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
    });
    const response = result.response;

    const usageMetadata = response.usageMetadata || {};
    const tokenUsage = {
      promptTokens: usageMetadata.promptTokenCount || 0,
      completionTokens: usageMetadata.candidatesTokenCount || 0,
      totalTokens: usageMetadata.totalTokenCount || 0,
      thinkingLevel,
    };

    let text = response.text();
    text = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const listValues = JSON.parse(text);

    return {
      listValues: Array.isArray(listValues) ? listValues : [],
      tokenUsage,
    };
  });
}

module.exports = {
  processRowBatch,
  processRowBatchWithRAG,
  processListValuesBatch,
  logProcessingSummary,
};
