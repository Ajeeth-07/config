/**
 * RAG Module - Main Entry Point
 * Exports all RAG-related functionality
 */

const { RAG_CONFIG, INPUT_CONFIG_SCHEMA } = require("./config");
const {
  embedText,
  embedBatch,
  configToSearchableText,
  cosineSimilarity,
} = require("./embeddingService");
const {
  initVectorStore,
  getCollection,
  addConfigs,
  searchSimilar,
  findSimilarConfigs,
  getStats,
  clearCollection,
  deleteByInsurer,
} = require("./vectorStore");
const {
  loadExcelFile,
  loadCsvFile,
  normalizeColumns,
  filterValidRows,
  ingestExcelFile,
  ingestFromJson,
  ingestOutputFile,
} = require("./ingestionService");
const {
  getConfigContext,
  getBatchContext,
  buildRAGPrompt,
  getDirectMatch,
  processWithRAG,
  getKnowledgeBaseStats,
} = require("./retrievalService");

module.exports = {
  // Configuration
  RAG_CONFIG,
  INPUT_CONFIG_SCHEMA,

  // Embedding
  embedText,
  embedBatch,
  configToSearchableText,
  cosineSimilarity,

  // Vector Store
  initVectorStore,
  getCollection,
  addConfigs,
  searchSimilar,
  findSimilarConfigs,
  getStats,
  clearCollection,
  deleteByInsurer,

  // Ingestion
  loadExcelFile,
  loadCsvFile,
  normalizeColumns,
  filterValidRows,
  ingestExcelFile,
  ingestFromJson,
  ingestOutputFile,

  // Retrieval
  getConfigContext,
  getBatchContext,
  buildRAGPrompt,
  getDirectMatch,
  processWithRAG,
  getKnowledgeBaseStats,
};
