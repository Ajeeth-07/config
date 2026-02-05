/**
 * RAG Routes
 * API endpoints for knowledge base management
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
} = require("../services/rag");

// Import export function directly
const { exportData, DATA_DIR } = require("../services/rag/vectorStore");

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
 * Get knowledge base statistics
 */
router.get("/stats", async (req, res) => {
  try {
    const stats = await getKnowledgeBaseStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Upload and ingest training data
 */
router.post("/ingest", upload.single("file"), async (req, res) => {
  const sessionId = req.body.sessionId || Date.now().toString();

  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { insurer, product } = req.body;

    if (!insurer) {
      return res.status(400).json({ error: "Insurer name is required" });
    }

    sendProgress(sessionId, `Starting ingestion for ${insurer}...`, "info");

    const result = await ingestExcelFile(
      req.file.path,
      insurer,
      product || "general",
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
 * Ingest from JSON data
 */
router.post("/ingest-json", async (req, res) => {
  try {
    const { configs, insurer, product } = req.body;

    if (!configs || !Array.isArray(configs)) {
      return res.status(400).json({ error: "configs array is required" });
    }

    if (!insurer) {
      return res.status(400).json({ error: "insurer is required" });
    }

    const result = await ingestFromJson(configs, insurer, product || "general");
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Search for similar configurations
 */
router.post("/search", async (req, res) => {
  try {
    const { query, topK, insurer, minSimilarity } = req.body;

    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }

    const results = await searchSimilar(query, {
      topK: topK || 10,
      insurer: insurer || null,
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

/**
 * Export/View all data from knowledge base
 * This acts as a simple "GUI" to inspect the data
 */
router.get("/export", async (req, res) => {
  try {
    const data = exportData();

    // If format=html, return a simple HTML page
    if (req.query.format === "html") {
      let html = `
<!DOCTYPE html>
<html>
<head>
  <title>RAG Knowledge Base Viewer</title>
  <style>
    body { font-family: monospace; background: #c0c0c0; padding: 20px; }
    h1 { color: navy; }
    table { border-collapse: collapse; width: 100%; background: white; }
    th, td { border: 1px solid #808080; padding: 8px; text-align: left; font-size: 12px; }
    th { background: navy; color: white; }
    tr:nth-child(even) { background: #f0f0f0; }
    .stats { background: white; padding: 10px; margin-bottom: 20px; border: 2px inset; }
    .truncate { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  </style>
</head>
<body>
  <h1>RAG Knowledge Base Viewer</h1>
  <div class="stats">
    <strong>Total Documents:</strong> ${data.count}<br>
    <strong>Data Directory:</strong> ${DATA_DIR}
  </div>
  <table>
    <tr>
      <th>#</th>
      <th>Keyword</th>
      <th>Caption</th>
      <th>Type</th>
      <th>Insurer</th>
      <th>Product</th>
      <th>Mandatory</th>
      <th>Document (searchable text)</th>
    </tr>`;

      data.configs.forEach((config, idx) => {
        html += `
    <tr>
      <td>${idx + 1}</td>
      <td>${config.keyword || ""}</td>
      <td>${config.keywordcaption || ""}</td>
      <td>${config.keywordtype || ""}</td>
      <td>${config.insurer || ""}</td>
      <td>${config.product || ""}</td>
      <td>${config.ismandatory || ""}</td>
      <td class="truncate" title="${(config.document || "").replace(
        /"/g,
        "&quot;",
      )}">${config.document || ""}</td>
    </tr>`;
      });

      html += `
  </table>
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
 * View raw embeddings (vectors) - shows the actual numbers
 * This demonstrates how text is converted to numerical vectors
 */
router.get("/vectors", async (req, res) => {
  try {
    const vectorsFile = path.join(DATA_DIR, "vectors.json");
    const metadataFile = path.join(DATA_DIR, "metadata.json");

    if (!fs.existsSync(vectorsFile)) {
      return res.json({
        message: "No data yet. Ingest some documents first.",
        count: 0,
        embeddings: [],
      });
    }

    const vectors = JSON.parse(fs.readFileSync(vectorsFile, "utf8"));
    const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));

    // Limit parameter (default show first 5)
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

      result.documents.push({
        id: vectors.ids[i],
        keyword: metadata.metadatas[i]?.keyword || "",
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

    // If HTML format requested
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
        }</span></p>
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
      <tr><td>/api/rag/export?format=html</td><td>View all metadata</td></tr>
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
 * Test embedding - convert any text to a vector to see how it works
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
