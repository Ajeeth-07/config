/**
 * RAG Routes
 * API endpoints for knowledge base management (Parent-Child hierarchy)
 */

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const router = express.Router();

// Import RAG services
const {
  initVectorStore,
  ingestExcelFile,
  ingestFromJson,
  getStats,
  clearCollection,
  deleteByInsurer,
  searchSimilar,
  getKnowledgeBaseStats,
  getQueryCacheStats,
  clearQueryCache,
} = require("../services/rag");

// Import export function directly
const {
  exportData,
  DATA_DIR,
  getAllParents,
  getParent,
} = require("../services/rag/vectorStore");

const { LOB_TYPES } = require("../services/rag/config");

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/rag/";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".xlsx", ".xls", ".csv"].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel and CSV files are allowed"));
    }
  },
});

// Store for SSE clients
const progressClients = new Map();

// SSE endpoint for ingestion progress
router.get("/progress/:sessionId", (req, res) => {
  const sessionId = req.params.sessionId;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  progressClients.set(sessionId, res);

  req.on("close", () => {
    progressClients.delete(sessionId);
  });
});

function sendProgress(sessionId, message, type = "log") {
  const client = progressClients.get(sessionId);
  if (client) {
    try {
      client.write(`data: ${JSON.stringify({ type, message })}\n\n`);
    } catch (e) {
      progressClients.delete(sessionId);
    }
  }
}

/**
 * Initialize vector store
 */
router.post("/init", async (req, res) => {
  try {
    const result = await initVectorStore();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get knowledge base statistics (now includes LOB breakdown and parents)
 */
router.get("/stats", async (req, res) => {
  try {
    const stats = await getKnowledgeBaseStats();
    const cacheStats = getQueryCacheStats();
    res.json({ ...stats, queryCache: cacheStats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get valid LOB types
 */
router.get("/lob-types", (req, res) => {
  res.json({
    lobTypes: Object.values(LOB_TYPES),
    description:
      "Supported Lines of Business. Pass one of these as the 'lob' parameter during ingestion.",
  });
});

// -------------------------------------------------------------------------
// Parent endpoints
// -------------------------------------------------------------------------

/**
 * Get all parent documents (LOB schemas)
 */
router.get("/parents", async (req, res) => {
  try {
    const parents = getAllParents();
    res.json({
      count: parents.length,
      parents: parents.map((p) => ({
        id: p.id,
        lob: p.metadata.lob,
        insurer: p.metadata.insurer,
        product: p.metadata.product,
        fieldCount: p.metadata.fieldCount,
        fieldCategories: p.metadata.fieldCategories,
        sampleKeywords: p.metadata.sampleKeywords,
        summary: p.metadata.summary,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get a specific parent and summary
 */
router.get("/parent/:id", async (req, res) => {
  try {
    const parent = getParent(req.params.id);
    if (!parent) {
      return res.status(404).json({ error: "Parent not found" });
    }
    res.json({
      id: parent.id,
      ...parent.metadata,
      document: parent.document,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------------------
// Ingestion endpoints (with LOB param)
// -------------------------------------------------------------------------

/**
 * Upload and ingest training data
 * Now accepts optional `lob` parameter
 */
router.post("/ingest", upload.single("file"), async (req, res) => {
  const sessionId = req.body.sessionId || Date.now().toString();

  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { insurer, product, lob } = req.body;

    if (!insurer) {
      return res.status(400).json({ error: "Insurer name is required" });
    }

    sendProgress(sessionId, `Starting ingestion for ${insurer}...`, "info");

    const result = await ingestExcelFile(
      req.file.path,
      insurer,
      product || "general",
      lob || "general",
      (msg) => sendProgress(sessionId, msg),
    );

    // Cleanup uploaded file
    fs.unlinkSync(req.file.path);

    sendProgress(sessionId, "Ingestion complete!", "complete");

    res.json(result);
  } catch (error) {
    sendProgress(sessionId, `Error: ${error.message}`, "error");

    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {}
    }

    res.status(500).json({ error: error.message });
  }
});

/**
 * Ingest from JSON data (with LOB param)
 */
router.post("/ingest-json", async (req, res) => {
  try {
    const { configs, insurer, product, lob } = req.body;

    if (!configs || !Array.isArray(configs)) {
      return res.status(400).json({ error: "configs array is required" });
    }

    if (!insurer) {
      return res.status(400).json({ error: "insurer is required" });
    }

    const result = await ingestFromJson(
      configs,
      insurer,
      product || "general",
      lob || "general",
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------------------
// Search
// -------------------------------------------------------------------------

/**
 * Search for similar configurations (with optional LOB filter for boost)
 */
router.post("/search", async (req, res) => {
  try {
    const { query, topK, lob, minSimilarity } = req.body;

    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }

    const results = await searchSimilar(query, {
      topK: topK || 10,
      lob: lob || null,
      minSimilarity: minSimilarity || 0.6,
    });

    res.json({
      query,
      results,
      count: results.length,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------------------
// Delete
// -------------------------------------------------------------------------

/**
 * Clear all data from knowledge base
 */
router.delete("/clear", async (req, res) => {
  try {
    const result = await clearCollection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete data for specific insurer
 */
router.delete("/insurer/:insurer", async (req, res) => {
  try {
    const result = await deleteByInsurer(req.params.insurer);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------------------
// Export / View
// -------------------------------------------------------------------------

/**
 * Export/View all data from knowledge base (parent-child aware)
 */
router.get("/export", async (req, res) => {
  try {
    const data = exportData();

    if (req.query.format === "html") {
      // Group children by parent
      const grouped = {};
      data.configs.forEach((config) => {
        const pid = config.parentId || "unassigned";
        if (!grouped[pid]) grouped[pid] = [];
        grouped[pid].push(config);
      });

      let html = `
<!DOCTYPE html>
<html>
<head>
  <title>RAG Knowledge Base Viewer</title>
  <style>
    body { font-family: monospace; background: #c0c0c0; padding: 20px; }
    h1, h2, h3 { color: navy; }
    table { border-collapse: collapse; width: 100%; background: white; }
    th, td { border: 1px solid #808080; padding: 8px; text-align: left; font-size: 12px; }
    th { background: navy; color: white; }
    tr:nth-child(even) { background: #f0f0f0; }
    .stats { background: white; padding: 10px; margin-bottom: 20px; border: 2px inset; }
    .truncate { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .parent-block { margin: 20px 0; padding: 10px; background: white; border: 2px outset; }
    .parent-header { background: #000080; color: white; padding: 8px; margin: -10px -10px 10px -10px; }
    .lob-badge { display: inline-block; background: darkred; color: white; padding: 2px 8px; font-size: 11px; margin-left: 8px; }
  </style>
</head>
<body>
  <h1>RAG Knowledge Base Viewer</h1>
  <div class="stats">
    <strong>Total Children:</strong> ${data.count} |
    <strong>Total Parents:</strong> ${data.parentCount} |
    <strong>Data Directory:</strong> ${DATA_DIR}
  </div>

  <h2>Parents (LOB Schemas)</h2>
  <table>
    <tr><th>ID</th><th>LOB</th><th>Insurer</th><th>Product</th><th>Fields</th><th>Categories</th></tr>`;

      data.parents.forEach((p) => {
        html += `
    <tr>
      <td>${p.id || ""}</td>
      <td>${p.lob || ""}</td>
      <td>${p.insurer || ""}</td>
      <td>${p.product || ""}</td>
      <td>${p.fieldCount || 0}</td>
      <td>${(p.fieldCategories || []).join(", ")}</td>
    </tr>`;
      });

      html += `
  </table>

  <h2>Children (by Parent)</h2>`;

      Object.entries(grouped).forEach(([parentId, configs]) => {
        const parent = data.parents.find((p) => p.id === parentId);
        const lobLabel = parent ? parent.lob : "unknown";

        html += `
  <div class="parent-block">
    <div class="parent-header">
      ${parentId} <span class="lob-badge">${lobLabel}</span> (${configs.length} fields)
    </div>
    <table>
      <tr>
        <th>#</th><th>Keyword</th><th>Caption</th><th>Type</th>
        <th>Insurer</th><th>Mandatory</th><th>LOB</th><th>Document</th>
      </tr>`;

        configs.forEach((config, idx) => {
          html += `
      <tr>
        <td>${idx + 1}</td>
        <td>${config.keyword || ""}</td>
        <td>${config.keywordcaption || ""}</td>
        <td>${config.keywordtype || ""}</td>
        <td>${config.insurer || ""}</td>
        <td>${config.ismandatory || ""}</td>
        <td>${config.lob || ""}</td>
        <td class="truncate" title="${(config.document || "").replace(
          /"/g,
          "&quot;",
        )}">${config.document || ""}</td>
      </tr>`;
        });

        html += `
    </table>
  </div>`;
      });

      html += `
</body>
</html>`;

      res.type("html").send(html);
      return;
    }

    // Default: return JSON
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Download data as JSON file
 */
router.get("/download", async (req, res) => {
  try {
    const data = exportData();
    const filename = `rag-knowledge-base-${
      new Date().toISOString().split("T")[0]
    }.json`;

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/json");
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * View raw embeddings (vectors) - now reads from child_vectors.json
 */
router.get("/vectors", async (req, res) => {
  try {
    const vectorsFile = path.join(DATA_DIR, "child_vectors.json");
    const metadataFile = path.join(DATA_DIR, "child_metadata.json");

    // Fallback to legacy paths
    const legacyVectors = path.join(DATA_DIR, "vectors.json");
    const legacyMeta = path.join(DATA_DIR, "metadata.json");

    let vFile = vectorsFile;
    let mFile = metadataFile;
    if (!fs.existsSync(vFile) && fs.existsSync(legacyVectors)) {
      vFile = legacyVectors;
      mFile = legacyMeta;
    }

    if (!fs.existsSync(vFile)) {
      return res.json({
        message: "No data yet. Ingest some documents first.",
        count: 0,
        embeddings: [],
      });
    }

    const vectors = JSON.parse(fs.readFileSync(vFile, "utf8"));
    const metadata = JSON.parse(fs.readFileSync(mFile, "utf8"));

    const limit = parseInt(req.query.limit) || 5;
    const showFull = req.query.full === "true";

    const result = {
      totalDocuments: vectors.ids.length,
      embeddingDimensions: vectors.embeddings[0]?.length || 0,
      showingFirst: Math.min(limit, vectors.ids.length),
      explanation: {
        whatIsEmbedding:
          "Each document is converted to a vector of 768 numbers using Gemini's embedding model",
        howItWorks:
          "Similar documents have similar vectors (close in 768-dimensional space)",
        similarity: "We use cosine similarity to find related documents",
      },
      documents: [],
    };

    for (let i = 0; i < Math.min(limit, vectors.ids.length); i++) {
      const embedding = vectors.embeddings[i];
      if (!embedding) continue;

      result.documents.push({
        id: vectors.ids[i],
        keyword: metadata.metadatas[i]?.keyword || "",
        lob: metadata.metadatas[i]?.lob || "",
        parentId: metadata.metadatas[i]?.parentId || "",
        searchableText: metadata.documents[i],
        embedding: showFull
          ? embedding
          : {
              first10: embedding.slice(0, 10),
              last10: embedding.slice(-10),
              totalNumbers: embedding.length,
              note: "Add ?full=true to see complete embedding",
            },
      });
    }

    if (req.query.format === "html") {
      let html = `
<!DOCTYPE html>
<html>
<head>
  <title>RAG Embeddings Viewer</title>
  <style>
    body { font-family: monospace; background: #c0c0c0; padding: 20px; }
    h1, h2 { color: navy; }
    .box { background: white; padding: 15px; margin: 10px 0; border: 2px inset; }
    .embedding { background: #1a1a2e; color: #0f0; padding: 10px; font-size: 11px; overflow-x: auto; white-space: nowrap; }
    .keyword { color: darkred; font-weight: bold; }
    .dim { color: gray; font-size: 12px; }
    .lob-badge { display: inline-block; background: darkred; color: white; padding: 2px 6px; font-size: 10px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #808080; padding: 8px; text-align: left; }
    th { background: navy; color: white; }
  </style>
</head>
<body>
  <h1>RAG Embeddings Viewer</h1>
  
  <div class="box">
    <h2>What are Embeddings?</h2>
    <p>Each text document is converted to a <strong>vector of ${result.embeddingDimensions} numbers</strong> using Gemini's embedding model.</p>
    <p>These numbers capture the <em>semantic meaning</em> of the text. Similar texts have similar vectors.</p>
    <p><strong>Total Documents:</strong> ${result.totalDocuments}</p>
  </div>
  
  <h2>Sample Embeddings (showing ${result.showingFirst} of ${result.totalDocuments})</h2>`;

      result.documents.forEach((doc, idx) => {
        const emb = vectors.embeddings[idx];
        if (!emb) return;
        const preview =
          emb
            .slice(0, 20)
            .map((n) => n.toFixed(4))
            .join(", ") +
          " ... (+" +
          (emb.length - 20) +
          " more numbers)";

        html += `
  <div class="box">
    <p><strong>#${idx + 1}</strong> | <span class="keyword">${
          doc.keyword
        }</span>
    ${doc.lob ? `<span class="lob-badge">${doc.lob}</span>` : ""}
    ${doc.parentId ? `| Parent: ${doc.parentId}` : ""}</p>
    <p><strong>Searchable Text:</strong> ${doc.searchableText}</p>
    <p class="dim">Embedding (${emb.length} dimensions):</p>
    <div class="embedding">[${preview}]</div>
  </div>`;
      });

      html += `
  <div class="box">
    <h2>API Endpoints</h2>
    <table>
      <tr><th>Endpoint</th><th>Description</th></tr>
      <tr><td>/api/rag/vectors</td><td>View embeddings as JSON</td></tr>
      <tr><td>/api/rag/vectors?format=html</td><td>This page</td></tr>
      <tr><td>/api/rag/vectors?limit=10</td><td>Show more documents</td></tr>
      <tr><td>/api/rag/vectors?full=true</td><td>Show complete embeddings</td></tr>
      <tr><td>/api/rag/export?format=html</td><td>View all metadata (grouped by parent)</td></tr>
      <tr><td>/api/rag/parents</td><td>View all parent LOB schemas</td></tr>
      <tr><td>/api/rag/stats</td><td>Knowledge base statistics with LOB breakdown</td></tr>
      <tr><td>/api/rag/lob-types</td><td>List supported LOB types</td></tr>
    </table>
  </div>
</body>
</html>`;

      return res.type("html").send(html);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Test embedding - convert any text to a vector
 */
router.post("/test-embedding", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "text is required" });
    }

    const { embedText } = require("../services/rag/embeddingService");
    const { RAG_CONFIG } = require("../services/rag/config");

    const startTime = Date.now();
    const embedding = await embedText(
      text,
      RAG_CONFIG.EMBEDDING.TASK_TYPES.SEARCH,
    );
    const duration = Date.now() - startTime;

    if (!embedding) {
      return res
        .status(400)
        .json({ error: "Could not generate embedding for the provided text" });
    }

    res.json({
      inputText: text,
      textLength: text.length,
      embeddingDimensions: embedding.length,
      processingTimeMs: duration,
      embedding: {
        first20: embedding.slice(0, 20),
        last10: embedding.slice(-10),
        min: Math.min(...embedding),
        max: Math.max(...embedding),
        mean: (embedding.reduce((a, b) => a + b, 0) / embedding.length).toFixed(
          6,
        ),
      },
      fullEmbedding: req.query.full === "true" ? embedding : undefined,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
