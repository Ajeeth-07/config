/**
 * RAG Module - Main Entry Point
 * Exports all RAG-related functionality (Parent-Child hierarchy)
 */

const { RAG_CONFIG, INPUT_CONFIG_SCHEMA, LOB_TYPES } = require("./config");
const {
  embedText,
  embedBatch,
  configToSearchableText,
  parentToSearchableText,
  cosineSimilarity,
} = require("./embeddingService");
const {
  initVectorStore,
  getCollection,
  addConfigs,
  addParent,
  getParent,
  getAllParents,
  makeParentId,
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
  buildParentSummary,
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
  LOB_TYPES,

  // Embedding
  embedText,
  embedBatch,
  configToSearchableText,
  parentToSearchableText,
  cosineSimilarity,

  // Vector Store
  initVectorStore,
  getCollection,
  addConfigs,
  addParent,
  getParent,
  getAllParents,
  makeParentId,
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
  buildParentSummary,
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
