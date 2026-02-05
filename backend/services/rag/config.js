/**
 * RAG Configuration
 * Settings for embeddings, vector store, and retrieval
 */

const RAG_CONFIG = {
  // Embedding model settings
  // See: https://ai.google.dev/gemini-api/docs/models/gemini#text-embedding
  EMBEDDING: {
    MODEL: "text-embedding-004", // Latest Gemini embedding model (768 dimensions)
    DIMENSIONS: 768,

    // Task types for different operations
    TASK_TYPES: {
      STORE: "RETRIEVAL_DOCUMENT", // When storing documents in vector DB
      SEARCH: "RETRIEVAL_QUERY", // When searching for similar documents
      SIMILARITY: "SEMANTIC_SIMILARITY", // When comparing two texts
      CLASSIFY: "CLASSIFICATION", // When classifying inputs
      CLUSTER: "CLUSTERING", // When clustering similar inputs
    },
  },

  // Vector store settings (file-based)
  CHROMA: {
    COLLECTION_NAME: "input_configurations",
    PERSIST_PATH: "./chroma_db",
  },

  // Chunking settings for large documents
  CHUNKING: {
    MAX_CHUNK_SIZE: 500,
    OVERLAP: 50,
  },

  // Retrieval settings - RELAXED for cross-insurer semantic matching
  // "First name" should match "First Name" or "Name of applicant" etc.
  RETRIEVAL: {
    TOP_K: 10, // Number of similar results to retrieve
    MIN_SIMILARITY: 0.45, // Lower threshold - allows more semantic matches
    DIRECT_MATCH_THRESHOLD: 0.72, // Lowered - trust embeddings for semantic matching
  },

  // Batch processing for embeddings
  BATCH: {
    SIZE: 50, // Reduced batch size for stability
    DELAY_MS: 500, // Faster processing
  },
};

// Metadata schema for input configurations
const INPUT_CONFIG_SCHEMA = {
  // Required fields
  keyword: { type: "string", required: true },
  keywordcaption: { type: "string", required: true },
  keywordtype: { type: "string", required: true },

  // Optional fields for context
  insurer: { type: "string", required: false },
  product: { type: "string", required: false },
  category: { type: "string", required: false },

  // Validation fields
  ismandatory: { type: "string", required: false },
  regex: { type: "string", required: false },
  minlength: { type: "string", required: false },
  maxlength: { type: "string", required: false },
};

module.exports = {
  RAG_CONFIG,
  INPUT_CONFIG_SCHEMA,
};
