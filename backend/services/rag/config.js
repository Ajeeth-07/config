/**
 * RAG Configuration
 * Settings for embeddings, vector store, retrieval, and parent-child hierarchy
 */

/**
 * Supported Lines of Business
 */
const LOB_TYPES = {
  LIFE: "life",
  MOTOR: "motor",
  MARINE: "marine",
  FIRE: "fire",
  HEALTH: "health",
  GENERAL: "general",
};

const RAG_CONFIG = {
  // Embedding model settings
  EMBEDDING: {
    MODEL: "gemini-embedding-001",
    DIMENSIONS: 768,

    TASK_TYPES: {
      STORE: "RETRIEVAL_DOCUMENT",
      SEARCH: "RETRIEVAL_QUERY",
      SIMILARITY: "SEMANTIC_SIMILARITY",
      CLASSIFY: "CLASSIFICATION",
      CLUSTER: "CLUSTERING",
    },
  },

  // Parent-Child retrieval settings
  PARENT_CHILD: {
    ENABLE: true,
    PARENT_SUMMARY_MAX_KEYWORDS: 20, // Top N keywords to include in parent summary
    CHILD_RESULTS_PER_PARENT: 5, // Max child results returned per parent
  },

  // Retrieval settings
  RETRIEVAL: {
    TOP_K: 10,
    MIN_SIMILARITY: 0.45,
    DIRECT_MATCH_THRESHOLD: 0.72,
    PARENT_BOOST: 0.1, // Similarity bonus when query LOB matches parent LOB
  },

  // Batch processing for embeddings
  BATCH: {
    SIZE: 50,
    DELAY_MS: 500,
  },
};

// Metadata schema for input configurations
const INPUT_CONFIG_SCHEMA = {
  keyword: { type: "string", required: true },
  keywordcaption: { type: "string", required: true },
  keywordtype: { type: "string", required: true },
  insurer: { type: "string", required: false },
  product: { type: "string", required: false },
  lob: { type: "string", required: false },
  category: { type: "string", required: false },
  ismandatory: { type: "string", required: false },
  regex: { type: "string", required: false },
  minlength: { type: "string", required: false },
  maxlength: { type: "string", required: false },
};

module.exports = {
  RAG_CONFIG,
  INPUT_CONFIG_SCHEMA,
  LOB_TYPES,
};
