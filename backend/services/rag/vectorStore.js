/**
 * Vector Store Service - Parent-Child Architecture
 *
 * Parent documents: LOB schema summaries (one per lob+insurer+product combo)
 * Child documents:  Individual keyword configs (linked to parent via parentId)
 *
 * Retrieval: search children, then enrich with parent context.
 */

const { RAG_CONFIG } = require("./config");
const {
  embedText,
  embedBatch,
  configToSearchableText,
  parentToSearchableText,
  cosineSimilarity,
} = require("./embeddingService");
const path = require("path");
const fs = require("fs");

// ---------------------------------------------------------------------------
// Storage paths
// ---------------------------------------------------------------------------
const DATA_DIR = path.resolve(__dirname, "..", "..", "data", "rag");

// New parent-child files
const PARENT_VECTORS_FILE = path.join(DATA_DIR, "parent_vectors.json");
const PARENT_METADATA_FILE = path.join(DATA_DIR, "parent_metadata.json");
const CHILD_VECTORS_FILE = path.join(DATA_DIR, "child_vectors.json");
const CHILD_METADATA_FILE = path.join(DATA_DIR, "child_metadata.json");

// Legacy flat files (for migration)
const LEGACY_VECTORS_FILE = path.join(DATA_DIR, "vectors.json");
const LEGACY_METADATA_FILE = path.join(DATA_DIR, "metadata.json");

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------
function emptyStore() {
  return { ids: [], embeddings: [], documents: [], metadatas: [] };
}

let parentStore = emptyStore();
let childStore = emptyStore();

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function saveStore() {
  ensureDataDir();
  fs.writeFileSync(
    CHILD_VECTORS_FILE,
    JSON.stringify({ ids: childStore.ids, embeddings: childStore.embeddings }),
  );
  fs.writeFileSync(
    CHILD_METADATA_FILE,
    JSON.stringify({
      documents: childStore.documents,
      metadatas: childStore.metadatas,
    }),
  );
  fs.writeFileSync(
    PARENT_VECTORS_FILE,
    JSON.stringify({
      ids: parentStore.ids,
      embeddings: parentStore.embeddings,
    }),
  );
  fs.writeFileSync(
    PARENT_METADATA_FILE,
    JSON.stringify({
      documents: parentStore.documents,
      metadatas: parentStore.metadatas,
    }),
  );
}

function loadStore() {
  ensureDataDir();
  let loaded = false;

  try {
    // Load child store
    if (
      fs.existsSync(CHILD_VECTORS_FILE) &&
      fs.existsSync(CHILD_METADATA_FILE)
    ) {
      const cv = JSON.parse(fs.readFileSync(CHILD_VECTORS_FILE, "utf8"));
      const cm = JSON.parse(fs.readFileSync(CHILD_METADATA_FILE, "utf8"));
      childStore = {
        ids: cv.ids || [],
        embeddings: cv.embeddings || [],
        documents: cm.documents || [],
        metadatas: cm.metadatas || [],
      };
      loaded = true;
    }

    // Load parent store
    if (
      fs.existsSync(PARENT_VECTORS_FILE) &&
      fs.existsSync(PARENT_METADATA_FILE)
    ) {
      const pv = JSON.parse(fs.readFileSync(PARENT_VECTORS_FILE, "utf8"));
      const pm = JSON.parse(fs.readFileSync(PARENT_METADATA_FILE, "utf8"));
      parentStore = {
        ids: pv.ids || [],
        embeddings: pv.embeddings || [],
        documents: pm.documents || [],
        metadatas: pm.metadatas || [],
      };
    }
  } catch (error) {
    console.error("Error loading vector store:", error.message);
  }

  return loaded;
}

// ---------------------------------------------------------------------------
// Migration from legacy flat store
// ---------------------------------------------------------------------------
function migrateLegacyStore() {
  if (
    !fs.existsSync(LEGACY_VECTORS_FILE) ||
    !fs.existsSync(LEGACY_METADATA_FILE)
  ) {
    return false;
  }

  // Already migrated?
  if (fs.existsSync(CHILD_VECTORS_FILE)) {
    return false;
  }

  try {
    console.log("Migrating legacy flat vector store to parent-child format...");

    const legacyVectors = JSON.parse(
      fs.readFileSync(LEGACY_VECTORS_FILE, "utf8"),
    );
    const legacyMeta = JSON.parse(
      fs.readFileSync(LEGACY_METADATA_FILE, "utf8"),
    );

    const ids = legacyVectors.ids || [];
    const embeddings = legacyVectors.embeddings || [];
    const documents = legacyMeta.documents || [];
    const metadatas = legacyMeta.metadatas || [];

    if (ids.length === 0) {
      console.log("Legacy store is empty, nothing to migrate.");
      return false;
    }

    // Group children by insurer+product to create parents
    const groups = {};
    metadatas.forEach((m, i) => {
      const insurer = m.insurer || "unknown";
      const product = m.product || "general";
      const parentId = `general_${insurer}_${product}`;
      if (!groups[parentId]) {
        groups[parentId] = {
          insurer,
          product,
          lob: "general",
          childIndices: [],
        };
      }
      groups[parentId].childIndices.push(i);
    });

    // Build parent documents and tag children
    for (const [parentId, group] of Object.entries(groups)) {
      const childMetas = group.childIndices.map((i) => metadatas[i]);
      const keywords = childMetas
        .map((m) => m.keyword)
        .filter(Boolean)
        .slice(0, RAG_CONFIG.PARENT_CHILD.PARENT_SUMMARY_MAX_KEYWORDS);
      const categories = [
        ...new Set(childMetas.map((m) => m.sourceSheet).filter(Boolean)),
      ];

      const parentMeta = {
        type: "parent",
        lob: group.lob,
        insurer: group.insurer,
        product: group.product,
        fieldCount: group.childIndices.length,
        sampleKeywords: keywords,
        fieldCategories: categories,
        summary: `${group.lob} insurance fields from ${group.insurer} (${
          group.product
        }): ${keywords.slice(0, 10).join(", ")}`,
      };

      const parentText = parentToSearchableText(parentMeta);
      parentStore.ids.push(parentId);
      parentStore.embeddings.push(null); // Will be re-embedded on first use
      parentStore.documents.push(parentText);
      parentStore.metadatas.push(parentMeta);

      // Tag children with parentId
      group.childIndices.forEach((i) => {
        metadatas[i].parentId = parentId;
        metadatas[i].lob = group.lob;
        metadatas[i].type = "child";
      });
    }

    // Move legacy data into child store
    childStore = { ids, embeddings, documents, metadatas };

    // Save new format
    saveStore();

    // Rename legacy files so migration doesn't repeat
    fs.renameSync(
      LEGACY_VECTORS_FILE,
      path.join(DATA_DIR, "vectors.json.migrated"),
    );
    fs.renameSync(
      LEGACY_METADATA_FILE,
      path.join(DATA_DIR, "metadata.json.migrated"),
    );

    console.log(
      `Migration complete: ${childStore.ids.length} children, ${parentStore.ids.length} parents`,
    );
    return true;
  } catch (error) {
    console.error("Migration failed:", error.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
async function initVectorStore() {
  // Try loading new format first
  const loaded = loadStore();

  if (!loaded || childStore.ids.length === 0) {
    // Attempt migration from legacy flat format
    const migrated = migrateLegacyStore();
    if (!migrated && childStore.ids.length === 0) {
      console.log("Vector store initialized (empty)");
      return { success: true, count: 0, parents: 0, dataDir: DATA_DIR };
    }
  }

  const childCount = childStore.ids.length;
  const parentCount = parentStore.ids.length;
  console.log(
    `Vector store loaded: ${childCount} children, ${parentCount} parents`,
  );

  return {
    success: true,
    count: childCount,
    parents: parentCount,
    dataDir: DATA_DIR,
  };
}

// ---------------------------------------------------------------------------
// Parent operations
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic parent ID from lob + insurer + product
 */
function makeParentId(lob, insurer, product) {
  return `${lob}_${insurer}_${product}`.toLowerCase().replace(/\s+/g, "_");
}

/**
 * Create or update a parent document
 * @param {Object} parentMeta - Parent metadata (lob, insurer, product, fieldCount, sampleKeywords, fieldCategories, summary)
 * @returns {Promise<string>} The parent ID
 */
async function addParent(parentMeta) {
  const parentId = makeParentId(
    parentMeta.lob,
    parentMeta.insurer,
    parentMeta.product,
  );

  const existingIdx = parentStore.ids.indexOf(parentId);
  const text = parentToSearchableText(parentMeta);

  // Generate embedding
  const embedding = await embedText(
    text,
    RAG_CONFIG.EMBEDDING.TASK_TYPES.STORE,
  );

  const meta = {
    type: "parent",
    ...parentMeta,
  };

  if (existingIdx >= 0) {
    // Update existing parent
    parentStore.documents[existingIdx] = text;
    parentStore.metadatas[existingIdx] = meta;
    parentStore.embeddings[existingIdx] = embedding;
  } else {
    // Add new parent
    parentStore.ids.push(parentId);
    parentStore.documents.push(text);
    parentStore.metadatas.push(meta);
    parentStore.embeddings.push(embedding);
  }

  saveStore();
  return parentId;
}

/**
 * Fetch a parent document by ID
 * @param {string} parentId
 * @returns {Object|null} Parent metadata or null
 */
function getParent(parentId) {
  const idx = parentStore.ids.indexOf(parentId);
  if (idx < 0) return null;
  return {
    id: parentStore.ids[idx],
    document: parentStore.documents[idx],
    metadata: parentStore.metadatas[idx],
  };
}

/**
 * Get all parent documents
 * @returns {Object[]}
 */
function getAllParents() {
  return parentStore.ids.map((id, idx) => ({
    id,
    document: parentStore.documents[idx],
    metadata: parentStore.metadatas[idx],
  }));
}

// ---------------------------------------------------------------------------
// Child operations (mostly unchanged from the old addConfigs / searchSimilar)
// ---------------------------------------------------------------------------

/**
 * Add child configurations linked to a parent
 * @param {Object[]} configs - Configuration objects
 * @param {string} insurer
 * @param {string} product
 * @param {string} lob - Line of Business
 * @param {string} parentId - Parent document ID
 * @param {Function} onProgress
 */
async function addConfigs(
  configs,
  insurer = "unknown",
  product = "unknown",
  lob = "general",
  parentId = null,
  onProgress = null,
) {
  const log = (msg) => {
    console.log(msg);
    if (onProgress) onProgress(msg);
  };

  log(`Preparing ${configs.length} configurations for embedding...`);

  const newDocuments = [];
  const newMetadatas = [];
  const newIds = [];

  configs.forEach((config, idx) => {
    const searchText = configToSearchableText({
      ...config,
      insurer,
      product,
    });

    newDocuments.push(searchText);

    newMetadatas.push({
      type: "child",
      parentId: parentId || makeParentId(lob, insurer, product),
      lob,
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
      insurer,
      product,
      mappedFrom: config.mappedFrom || "",
      sourceSheet: config.sourceSheet || "",
    });

    const keyword =
      config.keyword || config.uniqueIdentifier || `config_${idx}`;
    newIds.push(`${lob}_${insurer}_${product}_${keyword}_${Date.now()}_${idx}`);
  });

  log("Generating embeddings (this may take a while)...");
  const newEmbeddings = await embedBatch(
    newDocuments,
    RAG_CONFIG.EMBEDDING.TASK_TYPES.STORE,
    onProgress,
  );

  log("Storing in vector database...");
  let addedCount = 0;

  for (let i = 0; i < newEmbeddings.length; i++) {
    if (newEmbeddings[i] !== null) {
      childStore.ids.push(newIds[i]);
      childStore.embeddings.push(newEmbeddings[i]);
      childStore.documents.push(newDocuments[i]);
      childStore.metadatas.push(newMetadatas[i]);
      addedCount++;
    }
  }

  saveStore();

  const totalCount = childStore.ids.length;
  log(
    `Done! Added ${addedCount} children (skipped ${
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
 * Search child documents for similar configurations, then enrich with parent
 */
async function searchSimilar(query, options = {}) {
  const {
    topK = RAG_CONFIG.RETRIEVAL.TOP_K,
    minSimilarity = RAG_CONFIG.RETRIEVAL.MIN_SIMILARITY,
    lob = null, // Optional LOB filter for parent boost
  } = options;

  if (childStore.ids.length === 0) return [];
  if (!query || query.trim().length === 0) return [];

  const queryEmbedding = await embedText(
    query,
    RAG_CONFIG.EMBEDDING.TASK_TYPES.SEARCH,
  );
  if (!queryEmbedding) return [];

  const similarities = [];

  for (let i = 0; i < childStore.embeddings.length; i++) {
    if (!childStore.embeddings[i]) continue;

    let similarity = cosineSimilarity(queryEmbedding, childStore.embeddings[i]);

    // Apply parent LOB boost when the query LOB matches the child's parent LOB
    if (lob && childStore.metadatas[i].lob === lob) {
      similarity += RAG_CONFIG.RETRIEVAL.PARENT_BOOST;
    }

    if (similarity >= minSimilarity) {
      similarities.push({ index: i, similarity });
    }
  }

  similarities.sort((a, b) => b.similarity - a.similarity);
  const topResults = similarities.slice(0, topK);

  // Enrich with parent context
  return topResults.map((result) => {
    const meta = childStore.metadatas[result.index];
    const parent = meta.parentId ? getParent(meta.parentId) : null;

    return {
      id: childStore.ids[result.index],
      similarity: result.similarity.toFixed(4),
      document: childStore.documents[result.index],
      metadata: meta,
      parent: parent
        ? {
            id: parent.id,
            lob: parent.metadata.lob,
            insurer: parent.metadata.insurer,
            product: parent.metadata.product,
            fieldCount: parent.metadata.fieldCount,
            fieldCategories: parent.metadata.fieldCategories,
          }
        : null,
    };
  });
}

/**
 * Search for similar configs given an input row
 */
async function findSimilarConfigs(inputRow, options = {}) {
  const searchText = configToSearchableText(inputRow);
  if (!searchText || searchText.trim().length === 0) {
    const sampleKeys = Object.keys(inputRow).slice(0, 5).join(", ");
    console.warn(`RAG: No searchable text from row with keys: ${sampleKeys}`);
    return [];
  }

  const logSample = Math.random() < 0.02;
  if (logSample) {
    console.log(`RAG Search: "${searchText.substring(0, 80)}..."`);
  }

  return searchSimilar(searchText, options);
}

// ---------------------------------------------------------------------------
// Stats / management
// ---------------------------------------------------------------------------

async function getStats() {
  const insurerSet = new Set();
  const lobSet = new Set();
  childStore.metadatas.forEach((m) => {
    if (m.insurer) insurerSet.add(m.insurer);
    if (m.lob) lobSet.add(m.lob);
  });

  // LOB breakdown
  const lobBreakdown = {};
  childStore.metadatas.forEach((m) => {
    const lob = m.lob || "general";
    if (!lobBreakdown[lob]) lobBreakdown[lob] = 0;
    lobBreakdown[lob]++;
  });

  return {
    totalDocuments: childStore.ids.length,
    totalParents: parentStore.ids.length,
    insurers: Array.from(insurerSet),
    lobs: Array.from(lobSet),
    lobBreakdown,
    parents: parentStore.ids.map((id, idx) => ({
      id,
      lob: parentStore.metadatas[idx].lob,
      insurer: parentStore.metadatas[idx].insurer,
      product: parentStore.metadatas[idx].product,
      fieldCount: parentStore.metadatas[idx].fieldCount,
    })),
    dataDirectory: DATA_DIR,
  };
}

async function clearCollection() {
  const childCount = childStore.ids.length;
  const parentCount = parentStore.ids.length;

  childStore = emptyStore();
  parentStore = emptyStore();
  saveStore();

  return {
    success: true,
    deletedChildren: childCount,
    deletedParents: parentCount,
  };
}

async function deleteByInsurer(insurer) {
  // Remove children for this insurer
  const newChild = emptyStore();
  let deletedChildren = 0;

  for (let i = 0; i < childStore.ids.length; i++) {
    if (childStore.metadatas[i].insurer === insurer) {
      deletedChildren++;
    } else {
      newChild.ids.push(childStore.ids[i]);
      newChild.embeddings.push(childStore.embeddings[i]);
      newChild.documents.push(childStore.documents[i]);
      newChild.metadatas.push(childStore.metadatas[i]);
    }
  }
  childStore = newChild;

  // Remove parents for this insurer
  const newParent = emptyStore();
  let deletedParents = 0;

  for (let i = 0; i < parentStore.ids.length; i++) {
    if (parentStore.metadatas[i].insurer === insurer) {
      deletedParents++;
    } else {
      newParent.ids.push(parentStore.ids[i]);
      newParent.embeddings.push(parentStore.embeddings[i]);
      newParent.documents.push(parentStore.documents[i]);
      newParent.metadatas.push(parentStore.metadatas[i]);
    }
  }
  parentStore = newParent;

  saveStore();
  return { success: true, deletedChildren, deletedParents };
}

function exportData() {
  return {
    count: childStore.ids.length,
    parentCount: parentStore.ids.length,
    parents: parentStore.metadatas.map((meta, idx) => ({
      id: parentStore.ids[idx],
      ...meta,
      document: parentStore.documents[idx],
    })),
    configs: childStore.metadatas.map((meta, idx) => ({
      id: childStore.ids[idx],
      ...meta,
      document: childStore.documents[idx],
    })),
  };
}

// Compatibility helper
async function getCollection() {
  if (childStore.ids.length === 0) loadStore();
  return childStore;
}

module.exports = {
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
  exportData,
  DATA_DIR,
};
