/**
 * Configuration constants for the AI Agent
 * Gemini 3 Pro Preview: 5 req/min, 1M input tokens, 65k output tokens
 * Gemini 3 Flash Preview: 15 req/min, 1M input tokens
 */

const CONFIG = {
  // Model settings - Gemini 3 Pro for high accuracy input generation
  MODEL: "gemini-3-pro-preview",
  CACHE_MODEL: "gemini-3-pro-preview",

  // Gemini 3 Thinking Level Configuration
  // See: https://ai.google.dev/gemini-api/docs/gemini-3#thinking_level
  // Options: "none" (disable), "low" (fast), "high" (deep reasoning)
  THINKING_LEVEL: "high", // Use high for complex insurance domain reasoning

  // When RAG provides high-confidence context, lower thinking saves time
  // The knowledge base already tells the model what patterns to follow
  THINKING_LEVEL_WITH_RAG_CONTEXT: "low",

  // Batch processing settings
  BATCH_SIZE: 100, // 100 rows per batch (each row = one input field)
  DELAY_BETWEEN_BATCHES_MS: 2000, // 2s between batches

  // Retry settings
  MAX_RETRIES: 3,
  INITIAL_RETRY_DELAY_MS: 5000,

  // Caching settings
  ENABLE_CACHING: true,
  CACHE_TTL_SECONDS: 3600,
};

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
 * Column order for output Excel (33 columns)
 */
const EXCEL_COLUMN_ORDER = [
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

/**
 * Column widths for output Excel
 */
const EXCEL_COLUMN_WIDTHS = [
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

module.exports = {
  CONFIG,
  SYSTEM_INSTRUCTIONS,
  EXCEL_COLUMN_ORDER,
  EXCEL_COLUMN_WIDTHS,
};
