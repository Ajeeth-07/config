/**
 * AI Processing Service
 * Handles interaction with Gemini AI for batch processing
 * Now with RAG enhancement for better accuracy and token savings
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
async function processRowBatch(
  model,
  batchRows,
  sheetName,
  jsonRef,
  columnHeaders,
  ragContext = "",
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

  // Build prompt with RAG context if available
  let prompt = "";

  if (ragContext) {
    prompt += `${ragContext}\n`;
    prompt += `IMPORTANT: Follow the naming patterns and conventions shown in the examples above!\n\n`;
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

  // Determine thinking level based on whether RAG context is provided
  // With RAG context, we can use lower thinking as context provides guidance
  // Without RAG, use higher thinking for better reasoning
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
) {
  const allConfigs = [];
  let totalTokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  // First, add all direct matches from RAG
  ragResult.directMatches.forEach((match) => {
    allConfigs[match.rowIndex] = {
      ...match.config,
      _source: "rag_direct",
      _similarity: match.similarity,
    };
  });

  // Then process rows that need LLM
  if (ragResult.needsLLM.length > 0) {
    const needsLLMRows = ragResult.needsLLM.map(
      (item) => batchRows[item.rowIndex],
    );

    // Build RAG context from similar examples
    let ragContext = "";
    const hasContext = ragResult.needsLLM.some(
      (item) => item.context?.hasContext,
    );

    if (hasContext) {
      ragContext =
        "## REFERENCE: Similar configurations from knowledge base\n\n";
      ragContext += "| Keyword | Caption | Type | Mandatory |\n";
      ragContext += "|---------|---------|------|----------|\n";

      const seenPatterns = new Set();
      ragResult.needsLLM.forEach((item) => {
        if (item.context?.similarConfigs) {
          item.context.similarConfigs.slice(0, 2).forEach((sim) => {
            const key = sim.metadata.keyword;
            if (!seenPatterns.has(key)) {
              seenPatterns.add(key);
              ragContext += `| ${sim.metadata.keyword} | ${sim.metadata.keywordcaption} | ${sim.metadata.keywordtype} | ${sim.metadata.ismandatory} |\n`;
            }
          });
        }
      });
      ragContext += "\n";
    }

    // Process with LLM
    const llmResult = await processRowBatch(
      model,
      needsLLMRows,
      sheetName,
      jsonRef,
      columnHeaders,
      ragContext,
    );

    totalTokenUsage = llmResult.tokenUsage;

    // Map LLM results back to correct indices
    llmResult.configs.forEach((config, llmIdx) => {
      const originalIdx = ragResult.needsLLM[llmIdx].rowIndex;
      allConfigs[originalIdx] = {
        ...config,
        _source: "llm",
      };
    });
  }

  // Fill any gaps and convert sparse array to dense
  const finalConfigs = [];
  for (let i = 0; i < batchRows.length; i++) {
    if (allConfigs[i]) {
      finalConfigs.push(allConfigs[i]);
    }
  }

  return {
    configs: finalConfigs,
    tokenUsage: totalTokenUsage,
    ragStats: ragResult.stats,
  };
}

/**
 * Log processing summary before starting batch processing
 * @param {Object} params - Processing parameters
 */
function logProcessingSummary({
  model,
  totalRows,
  batchSize,
  delayBetweenBatches,
  ragEnabled = false,
}) {
  const estimatedBatches = Math.ceil(totalRows / batchSize);
  const estimatedTime = (estimatedBatches * delayBetweenBatches) / 1000;

  console.log(`\n📊 Processing Summary:`);
  console.log(`   Model: ${model}`);
  console.log(`   Total input fields (rows): ${totalRows}`);
  console.log(`   Batch size: ${batchSize} rows per request`);
  console.log(`   Estimated batches/requests: ${estimatedBatches}`);
  console.log(
    `   Estimated processing time: ~${Math.ceil(estimatedTime / 60)} minutes`,
  );
  console.log(`   Delay between batches: ${delayBetweenBatches / 1000}s`);
  console.log(`   RAG Enhancement: ${ragEnabled ? "ENABLED" : "Disabled"}`);

  // Warning if exceeding free tier limits
  if (estimatedBatches > 20 && !ragEnabled) {
    console.log(
      `\n⚠️  WARNING: This will require ~${estimatedBatches} API requests.`,
    );
    console.log(`   Gemini 3 Free Tier limit: 20 requests/day`);
    console.log(`   Consider enabling RAG or increasing BATCH_SIZE.\n`);
  }

  return { estimatedBatches, estimatedTime };
}

module.exports = {
  processRowBatch,
  processRowBatchWithRAG,
  logProcessingSummary,
};
