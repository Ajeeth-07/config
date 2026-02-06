/**
 * Embedding Service
 * Handles text to vector conversion using Gemini Embedding API
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { RAG_CONFIG } = require("./config");

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Generate embeddings for a single text
 * @param {string} text - Text to embed
 * @param {string} taskType - Task type for optimization
 * @returns {Promise<number[]|null>} Embedding vector or null if text is empty
 */
async function embedText(
  text,
  taskType = RAG_CONFIG.EMBEDDING.TASK_TYPES.STORE,
) {
  // Handle empty or invalid text
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    console.warn("Skipping empty text for embedding");
    return null;
  }

  try {
    const model = genAI.getGenerativeModel({
      model: RAG_CONFIG.EMBEDDING.MODEL,
    });

    const result = await model.embedContent({
      content: { parts: [{ text: text.trim() }] },
      taskType: taskType,
    });

    return result.embedding.values;
  } catch (error) {
    console.error("Embedding error:", error.message);
    // Return null instead of throwing - allows batch processing to continue
    return null;
  }
}

/**
 * Generate embeddings for multiple texts in batch
 * Handles empty/null texts gracefully - returns null for those
 * @param {string[]} texts - Array of texts to embed
 * @param {string} taskType - Task type for optimization
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<(number[]|null)[]>} Array of embedding vectors (null for failed texts)
 */
async function embedBatch(
  texts,
  taskType = RAG_CONFIG.EMBEDDING.TASK_TYPES.STORE,
  onProgress = null,
) {
  const embeddings = [];
  const batchSize = RAG_CONFIG.BATCH.SIZE;
  const totalBatches = Math.ceil(texts.length / batchSize);
  let successCount = 0;
  let skipCount = 0;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batchNum = Math.floor(i / batchSize) + 1;
    const batch = texts.slice(i, i + batchSize);

    if (onProgress) {
      onProgress(
        `Embedding batch ${batchNum}/${totalBatches} (${batch.length} texts)...`,
      );
    }

    // Process each text in the batch - handle null results
    const batchEmbeddings = await Promise.all(
      batch.map(async (text) => {
        const embedding = await embedText(text, taskType);
        if (embedding) {
          successCount++;
        } else {
          skipCount++;
        }
        return embedding;
      }),
    );

    embeddings.push(...batchEmbeddings);

    // Rate limiting delay between batches
    if (i + batchSize < texts.length) {
      await new Promise((resolve) =>
        setTimeout(resolve, RAG_CONFIG.BATCH.DELAY_MS),
      );
    }
  }

  if (onProgress && skipCount > 0) {
    onProgress(
      `Embedded ${successCount} texts, skipped ${skipCount} empty/invalid texts`,
    );
  }

  return embeddings;
}

/**
 * Get a value from an object trying multiple possible keys (case-insensitive)
 * @param {Object} obj - Object to search
 * @param {string[]} keys - Array of possible key names
 * @returns {string|null} Found value or null
 */
function getValueByKeys(obj, keys) {
  if (!obj) return null;

  // Create lowercase key map for case-insensitive lookup
  const lowerKeys = {};
  Object.keys(obj).forEach((k) => {
    lowerKeys[k.toLowerCase().replace(/[_\s]/g, "")] = obj[k];
  });

  for (const key of keys) {
    // Try exact match first
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
      return String(obj[key]);
    }
    // Try case-insensitive match
    const normalizedKey = key.toLowerCase().replace(/[_\s]/g, "");
    if (
      lowerKeys[normalizedKey] !== undefined &&
      lowerKeys[normalizedKey] !== null &&
      lowerKeys[normalizedKey] !== ""
    ) {
      return String(lowerKeys[normalizedKey]);
    }
  }
  return null;
}

/**
 * Values that are clearly data types, NOT labels/field names
 * Used to avoid misidentifying a data type column value as a field name
 */
const DATA_TYPE_VALUES = new Set([
  "alpha",
  "numeric",
  "alphanumeric",
  "alpha numeric",
  "string",
  "number",
  "date",
  "boolean",
  "list",
  "email",
  "phone",
  "text",
  "integer",
  "float",
  "decimal",
  "na",
  "n/a",
  "dropdown",
  "checkbox",
  "radio",
  "textarea",
  "free text",
  "freetext",
  "yes/no",
]);

/**
 * Check if a value looks like a data type rather than a meaningful label
 */
function isDataTypeValue(val) {
  if (!val) return false;
  const lower = String(val).toLowerCase().trim();
  return DATA_TYPE_VALUES.has(lower) || lower.length < 3;
}

/**
 * Create a searchable text representation of an input configuration
 * PRIORITY: Label/Caption is the MOST important field for semantic matching
 * across different insurers. "First Name" from Kotak should match "First Name" from IPRU.
 *
 * @param {Object} config - Input configuration object (from KB or input row)
 * @returns {string} Searchable text optimized for semantic matching
 */
function configToSearchableText(config) {
  const parts = [];

  // PRIORITY 1: Label/Caption/Description - this is the PRIMARY matching signal
  // "Gender", "First Name", "PAN Number", "Date of Birth" etc.
  // This is what makes semantic matching work across insurers
  const label = getValueByKeys(config, [
    "keywordcaption",
    "KeywordCaption",
    "Label",
    "label",
    "Caption",
    "caption",
    "Description",
    "description",
    "Display",
    "DisplayName",
    "display_name",
    "Title",
    "title",
    "Question",
    "question",
    "Health Details", // ICICI health sheets
    "Hazardous Question",
    "desc",
  ]);
  if (label) parts.push(`Label: ${label}`);

  // PRIORITY 2: Field name/identifier (keyword, field name, JSON tag)
  // But ONLY if it looks like an actual field name, not a data type
  const fieldName = getValueByKeys(config, [
    "keyword",
    "Keyword",
    "KEYWORD",
    "FieldName",
    "field_name",
    "fieldname",
    "Parameter",
    "parameter",
    "API Key",
    "APIKey",
    "api_key",
    "apikey",
    "InputName",
    "input_name",
    "inputname",
    "uniqueIdentifier",
    "UniqueIdentifier",
    "JSON Tag",
    "JSON Tags",
    "jsonTag",
    "Key",
    "key",
    "Code", // Question codes like HQ01, HZQ1
    "Column",
    "column",
    "Attribute",
    "attribute",
    "Field",
  ]);
  // Only use fieldName if it doesn't look like a data type value
  if (fieldName && !isDataTypeValue(fieldName)) {
    parts.push(`Field: ${fieldName}`);
  }

  // Data type
  const dataType = getValueByKeys(config, [
    "keywordtype",
    "KeywordType",
    "keyworddatatype",
    "KeywordDataType",
    "DataType",
    "dataType",
    "data_type",
    "Type",
    "type",
    "Format",
    "format",
    "InputType",
    "input_type",
    "FieldType",
    "field_type",
    "Control",
    "control",
  ]);
  if (dataType) parts.push(`Type: ${dataType}`);

  // Required/Mandatory flag
  const mandatory = getValueByKeys(config, [
    "ismandatory",
    "IsMandatory",
    "Required",
    "required",
    "Mandatory",
    "mandatory",
    "M/O",
  ]);
  if (mandatory) parts.push(`Mandatory: ${mandatory}`);

  // Validation - regex pattern (truncate long patterns)
  const regex = getValueByKeys(config, [
    "regex",
    "Regex",
    "REGEX",
    "Validation",
    "validation",
    "ValidationPattern",
    "validation_pattern",
  ]);
  if (regex) {
    // Truncate very long regex patterns - the field name matters more
    const truncated = String(regex).substring(0, 60);
    parts.push(`Pattern: ${truncated}`);
  }

  // List values for dropdowns
  const listValues = getValueByKeys(config, [
    "listValues",
    "ListValues",
    "Values",
    "values",
    "Options",
    "options",
    "Dropdown",
    "dropdown",
    "Choices",
    "choices",
  ]);
  if (listValues) {
    const truncated = String(listValues).substring(0, 80);
    parts.push(`Options: ${truncated}`);
  }

  // If we have NO label and NO field name, try to find the most descriptive
  // non-empty value in the row (likely the label in an unknown column)
  if (parts.length === 0) {
    // Look for the longest string value that isn't a data type or number
    let bestValue = null;
    let bestLength = 0;

    Object.entries(config).forEach(([key, val]) => {
      if (val === undefined || val === null || val === "") return;
      const strVal = String(val).trim();
      // Skip short values, numbers, and common non-label values
      if (strVal.length < 3 || strVal.length > 200) return;
      if (/^\d+$/.test(strVal)) return; // Pure numbers
      if (isDataTypeValue(strVal)) return;
      // Prefer longer descriptive strings
      if (strVal.length > bestLength) {
        bestLength = strVal.length;
        bestValue = strVal;
      }
    });

    if (bestValue) {
      parts.push(`Label: ${bestValue}`);
    }

    // Also add all other short values as supplementary info
    Object.values(config).forEach((val) => {
      if (val === undefined || val === null || val === "") return;
      const strVal = String(val).trim();
      if (strVal.length >= 3 && strVal.length < 100 && strVal !== bestValue) {
        if (!isDataTypeValue(strVal) && !/^\d+$/.test(strVal)) {
          parts.push(strVal);
        }
      }
    });
  }

  return parts.join(" | ");
}

/**
 * Create a searchable text representation of a PARENT document (LOB schema).
 * Used for embedding the parent so we can optionally search at the parent level.
 * @param {Object} parentMeta - Parent metadata object
 * @returns {string} Searchable text for the parent document
 */
function parentToSearchableText(parentMeta) {
  const parts = [];

  if (parentMeta.lob) parts.push(`LOB: ${parentMeta.lob}`);
  if (parentMeta.insurer) parts.push(`Insurer: ${parentMeta.insurer}`);
  if (parentMeta.product) parts.push(`Product: ${parentMeta.product}`);

  if (parentMeta.fieldCategories && parentMeta.fieldCategories.length > 0) {
    parts.push(`Categories: ${parentMeta.fieldCategories.join(", ")}`);
  }

  if (parentMeta.sampleKeywords && parentMeta.sampleKeywords.length > 0) {
    parts.push(`Fields: ${parentMeta.sampleKeywords.join(", ")}`);
  }

  if (parentMeta.summary) {
    parts.push(parentMeta.summary);
  }

  if (parentMeta.fieldCount) {
    parts.push(`Total fields: ${parentMeta.fieldCount}`);
  }

  return parts.join(" | ");
}

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} Similarity score (0-1)
 */
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error("Vectors must have same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = {
  embedText,
  embedBatch,
  configToSearchableText,
  parentToSearchableText,
  cosineSimilarity,
};
