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
 * Create a searchable text representation of an input configuration
 * Handles varied column names from different insurers' mapping sheets
 * Focus on SEMANTIC content, not insurer-specific metadata
 * @param {Object} config - Input configuration object (from KB or input row)
 * @returns {string} Searchable text optimized for semantic matching
 */
function configToSearchableText(config) {
  const parts = [];

  // Field name/identifier - try multiple possible column names
  const fieldName = getValueByKeys(config, [
    "keyword",
    "Keyword",
    "KEYWORD",
    "Field",
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
    "Name",
    "name",
    "uniqueIdentifier",
    "UniqueIdentifier",
    "Key",
    "key",
    "Column",
    "column",
    "Attribute",
    "attribute",
  ]);
  if (fieldName) parts.push(`Field: ${fieldName}`);

  // Label/Caption/Description - semantic meaning
  const label = getValueByKeys(config, [
    "keywordcaption",
    "KeywordCaption",
    "Label",
    "label",
    "Caption",
    "caption",
    "Description",
    "description",
    "desc",
    "Display",
    "DisplayName",
    "display_name",
    "Title",
    "title",
    "Question",
    "question", // For questionnaire sheets
  ]);
  if (label) parts.push(`Label: ${label}`);

  // Data type - important for matching similar fields
  const dataType = getValueByKeys(config, [
    "keywordtype",
    "KeywordType",
    "keyworddatatype",
    "KeywordDataType",
    "Type",
    "type",
    "DataType",
    "dataType",
    "data_type",
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
    "M/O", // Common in insurance sheets
    "Optional",
    "optional", // Inverse
  ]);
  if (mandatory) parts.push(`Mandatory: ${mandatory}`);

  // Validation - regex pattern
  const regex = getValueByKeys(config, [
    "regex",
    "Regex",
    "REGEX",
    "Pattern",
    "pattern",
    "Validation",
    "validation",
    "ValidationPattern",
    "validation_pattern",
  ]);
  if (regex) parts.push(`Pattern: ${regex}`);

  // List values for dropdowns - IMPORTANT for matching similar dropdowns
  const listValues = getValueByKeys(config, [
    "listValues",
    "ListValues",
    "Values",
    "values",
    "Options",
    "options",
    "Master",
    "master", // Common in insurance for master data
    "Dropdown",
    "dropdown",
    "Choices",
    "choices",
    "Enum",
    "enum",
  ]);
  if (listValues) parts.push(`Options: ${listValues}`);

  // Min/Max constraints
  const minVal = getValueByKeys(config, [
    "keyminvalue",
    "MinValue",
    "minvalue",
    "Min",
    "min",
  ]);
  const maxVal = getValueByKeys(config, [
    "keymaxvalue",
    "MaxValue",
    "maxvalue",
    "Max",
    "max",
  ]);
  const minLen = getValueByKeys(config, [
    "minlength",
    "MinLength",
    "minlength",
    "MinLen",
  ]);
  const maxLen = getValueByKeys(config, [
    "maxlength",
    "MaxLength",
    "maxlength",
    "MaxLen",
  ]);

  if (minVal) parts.push(`MinValue: ${minVal}`);
  if (maxVal) parts.push(`MaxValue: ${maxVal}`);
  if (minLen) parts.push(`MinLength: ${minLen}`);
  if (maxLen) parts.push(`MaxLength: ${maxLen}`);

  // Category/Section - helps match similar fields
  const category = getValueByKeys(config, [
    "category",
    "Category",
    "Section",
    "section",
    "Group",
    "group",
    "Tab",
    "tab",
    "Panel",
    "panel",
    "sourceSheet", // From our ingestion
  ]);
  if (category) parts.push(`Category: ${category}`);

  // If we found nothing, try to use ALL values from the row
  if (parts.length === 0) {
    // Last resort: concatenate all non-empty values
    Object.values(config).forEach((val) => {
      if (
        val !== undefined &&
        val !== null &&
        val !== "" &&
        typeof val !== "object"
      ) {
        const strVal = String(val).trim();
        if (strVal.length > 0 && strVal.length < 200) {
          parts.push(strVal);
        }
      }
    });
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
  cosineSimilarity,
};
