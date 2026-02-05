/**
 * Vector Store Service
 * File-based vector storage for RAG system
 * Works out of the box without requiring a separate server
 */

const { RAG_CONFIG } = require("./config");
const {
  embedText,
  embedBatch,
  configToSearchableText,
  cosineSimilarity,
} = require("./embeddingService");
const path = require("path");
const fs = require("fs");

// Storage paths
const DATA_DIR = path.resolve(__dirname, "..", "..", "data", "rag");
const VECTORS_FILE = path.join(DATA_DIR, "vectors.json");
const METADATA_FILE = path.join(DATA_DIR, "metadata.json");

// In-memory store (loaded from files)
let vectorStore = {
  ids: [],
  embeddings: [],
  documents: [],
  metadatas: [],
};

/**
 * Ensure data directory exists
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Save vector store to files
 */
function saveStore() {
  ensureDataDir();
  fs.writeFileSync(
    VECTORS_FILE,
    JSON.stringify({
      ids: vectorStore.ids,
      embeddings: vectorStore.embeddings,
    }),
  );
  fs.writeFileSync(
    METADATA_FILE,
    JSON.stringify({
      documents: vectorStore.documents,
      metadatas: vectorStore.metadatas,
    }),
  );
}

/**
 * Load vector store from files
 */
function loadStore() {
  ensureDataDir();

  try {
    if (fs.existsSync(VECTORS_FILE) && fs.existsSync(METADATA_FILE)) {
      const vectors = JSON.parse(fs.readFileSync(VECTORS_FILE, "utf8"));
      const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, "utf8"));

      vectorStore = {
        ids: vectors.ids || [],
        embeddings: vectors.embeddings || [],
        documents: metadata.documents || [],
        metadatas: metadata.metadatas || [],
      };

      return true;
    }
  } catch (error) {
    console.error("Error loading vector store:", error.message);
  }

  return false;
}

/**
 * Initialize vector store
 */
async function initVectorStore() {
  const loaded = loadStore();
  const count = vectorStore.ids.length;

  if (loaded && count > 0) {
    console.log(`Vector store loaded: ${count} documents`);
  } else {
    console.log("Vector store initialized (empty)");
  }

  return {
    success: true,
    count,
    dataDir: DATA_DIR,
  };
}

/**
 * Get collection (for compatibility)
 */
async function getCollection() {
  if (vectorStore.ids.length === 0) {
    loadStore();
  }
  return vectorStore;
}

/**
 * Add input configurations to the vector store
 * @param {Object[]} configs - Array of input configuration objects
 * @param {string} insurer - Insurer name for metadata
 * @param {string} product - Product name for metadata
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Object>} Result with count of added documents
 */
async function addConfigs(
  configs,
  insurer = "unknown",
  product = "unknown",
  onProgress = null,
) {
  const log = (msg) => {
    console.log(msg);
    if (onProgress) onProgress(msg);
  };

  log(`Preparing ${configs.length} configurations for embedding...`);

  // Prepare documents
  const newDocuments = [];
  const newMetadatas = [];
  const newIds = [];

  configs.forEach((config, idx) => {
    // Create searchable text
    const searchText = configToSearchableText({
      ...config,
      insurer,
      product,
    });

    newDocuments.push(searchText);

    // Store full config as metadata
    newMetadatas.push({
      keyword: config.keyword || config.uniqueIdentifier || "",
      keywordcaption: config.keywordcaption || config.label || "",
      keywordtype: config.keywordtype || config.dataType || "",
      keyworddatatype: config.keyworddatatype || config.dataType || "",
      ismandatory: config.ismandatory || "FALSE",
      regex: config.regex || "",
      minlength: String(config.minlength || ""),
      maxlength: String(config.maxlength || ""),
      keyminvalue: String(config.keyminvalue || ""),
      keymaxvalue: String(config.keymaxvalue || ""),
      insurer: insurer,
      product: product,
      mappedFrom: config.mappedFrom || "",
      sourceSheet: config.sourceSheet || "",
    });

    // Generate unique ID
    const keyword =
      config.keyword || config.uniqueIdentifier || `config_${idx}`;
    newIds.push(`${insurer}_${product}_${keyword}_${Date.now()}_${idx}`);
  });

  // Generate embeddings in batches
  log("Generating embeddings (this may take a while)...");
  const newEmbeddings = await embedBatch(
    newDocuments,
    RAG_CONFIG.EMBEDDING.TASK_TYPES.STORE,
    onProgress,
  );

  // Add to store - ONLY add documents with valid embeddings
  log("Storing in vector database...");
  let addedCount = 0;

  for (let i = 0; i < newEmbeddings.length; i++) {
    if (newEmbeddings[i] !== null) {
      vectorStore.ids.push(newIds[i]);
      vectorStore.embeddings.push(newEmbeddings[i]);
      vectorStore.documents.push(newDocuments[i]);
      vectorStore.metadatas.push(newMetadatas[i]);
      addedCount++;
    }
  }

  // Save to files
  saveStore();

  const totalCount = vectorStore.ids.length;
  log(
    `Done! Added ${addedCount} documents (skipped ${
      newDocuments.length - addedCount
    } invalid). Total: ${totalCount}`,
  );

  return {
    success: true,
    added: addedCount,
    skipped: newDocuments.length - addedCount,
    totalCount,
  };
}

/**
 * Search for similar configurations
 * DOES NOT filter by insurer - uses pure semantic similarity
 * "pan card" from Kotak should match "pan no" from IPRU
 * @param {string} query - Search query (field name, caption, etc.)
 * @param {Object} options - Search options
 * @returns {Promise<Object[]>} Array of similar configurations with scores
 */
async function searchSimilar(query, options = {}) {
  const {
    topK = RAG_CONFIG.RETRIEVAL.TOP_K,
    // insurer filter is REMOVED - we want cross-insurer matching
    minSimilarity = RAG_CONFIG.RETRIEVAL.MIN_SIMILARITY,
  } = options;

  if (vectorStore.ids.length === 0) {
    return [];
  }

  // Handle empty query
  if (!query || query.trim().length === 0) {
    console.warn("Empty query for similarity search");
    return [];
  }

  // Generate query embedding
  const queryEmbedding = await embedText(
    query,
    RAG_CONFIG.EMBEDDING.TASK_TYPES.SEARCH,
  );

  // Handle null embedding (empty or invalid text)
  if (!queryEmbedding) {
    console.warn(
      "Could not generate embedding for query:",
      query.substring(0, 50),
    );
    return [];
  }

  // Calculate similarities - NO insurer filtering for semantic cross-matching
  const similarities = [];

  for (let i = 0; i < vectorStore.embeddings.length; i++) {
    // Skip null embeddings in store
    if (!vectorStore.embeddings[i]) continue;

    const similarity = cosineSimilarity(
      queryEmbedding,
      vectorStore.embeddings[i],
    );

    if (similarity >= minSimilarity) {
      similarities.push({
        index: i,
        similarity,
      });
    }
  }

  // Sort by similarity (descending) and take top K
  similarities.sort((a, b) => b.similarity - a.similarity);
  const topResults = similarities.slice(0, topK);

  // Debug logging for RAG performance (sample 5% of queries)
  if (Math.random() < 0.05 && similarities.length > 0) {
    const topSim = similarities[0]?.similarity?.toFixed(3) || "N/A";
    console.log(
      `RAG: ${
        similarities.length
      } matches (top: ${topSim}) for: "${query.substring(0, 50)}..."`,
    );
  }

  // Format results
  return topResults.map((result) => ({
    id: vectorStore.ids[result.index],
    similarity: result.similarity.toFixed(4),
    document: vectorStore.documents[result.index],
    metadata: vectorStore.metadatas[result.index],
  }));
}

/**
 * Search for similar configurations given an input row from mapping sheet
 * Creates searchable text from row and finds semantically similar configs
 * @param {Object} inputRow - Row from mapping sheet (any column names)
 * @param {Object} options - Search options
 * @returns {Promise<Object[]>} Array of similar configurations
 */
async function findSimilarConfigs(inputRow, options = {}) {
  const searchText = configToSearchableText(inputRow);

  // Skip if no searchable text could be extracted
  if (!searchText || searchText.trim().length === 0) {
    // Log sample of what couldn't be extracted (for debugging)
    const sampleKeys = Object.keys(inputRow).slice(0, 5).join(", ");
    console.warn(`RAG: No searchable text from row with keys: ${sampleKeys}`);
    return [];
  }

  // Log first few searches for debugging
  const logSample = Math.random() < 0.02; // Log ~2% of searches
  if (logSample) {
    console.log(`RAG Search: "${searchText.substring(0, 80)}..."`);
  }

  return searchSimilar(searchText, options);
}

/**
 * Get statistics about the knowledge base
 */
async function getStats() {
  // Collect unique insurers
  const insurerSet = new Set();
  vectorStore.metadatas.forEach((m) => {
    if (m.insurer) insurerSet.add(m.insurer);
  });

  return {
    totalDocuments: vectorStore.ids.length,
    insurers: Array.from(insurerSet),
    dataDirectory: DATA_DIR,
  };
}

/**
 * Delete all documents from the store
 */
async function clearCollection() {
  const count = vectorStore.ids.length;

  vectorStore = {
    ids: [],
    embeddings: [],
    documents: [],
    metadatas: [],
  };

  saveStore();

  return { success: true, deleted: count };
}

/**
 * Delete documents by insurer
 */
async function deleteByInsurer(insurer) {
  const newStore = {
    ids: [],
    embeddings: [],
    documents: [],
    metadatas: [],
  };

  let deleted = 0;

  for (let i = 0; i < vectorStore.ids.length; i++) {
    if (vectorStore.metadatas[i].insurer === insurer) {
      deleted++;
    } else {
      newStore.ids.push(vectorStore.ids[i]);
      newStore.embeddings.push(vectorStore.embeddings[i]);
      newStore.documents.push(vectorStore.documents[i]);
      newStore.metadatas.push(vectorStore.metadatas[i]);
    }
  }

  vectorStore = newStore;
  saveStore();

  return { success: true, deleted };
}

/**
 * Export data for inspection/backup
 */
function exportData() {
  return {
    count: vectorStore.ids.length,
    configs: vectorStore.metadatas.map((meta, idx) => ({
      id: vectorStore.ids[idx],
      ...meta,
      document: vectorStore.documents[idx],
    })),
  };
}

module.exports = {
  initVectorStore,
  getCollection,
  addConfigs,
  searchSimilar,
  findSimilarConfigs,
  getStats,
  clearCollection,
  deleteByInsurer,
  exportData,
  DATA_DIR,
};
