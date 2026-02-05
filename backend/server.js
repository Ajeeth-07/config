const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

// Load .env BEFORE importing routes that use env variables
dotenv.config();

const uploadRoutes = require("./routes/upload");
const ragRoutes = require("./routes/rag");

// Initialize RAG vector store
const { initVectorStore } = require("./services/rag");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware - Enable CORS for frontend
app.use(
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
  }),
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Routes
app.use("/api/upload", uploadRoutes);
app.use("/api/rag", ragRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "AI Input Generator API is running" });
});

// Initialize and start server
async function startServer() {
  try {
    // Initialize vector store for RAG
    console.log("Initializing RAG vector store...");
    await initVectorStore();
    console.log("RAG vector store ready");
  } catch (error) {
    console.log("RAG initialization warning:", error.message);
    console.log("RAG features may be limited");
  }

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`- Upload API: http://localhost:${PORT}/api/upload`);
    console.log(`- RAG API: http://localhost:${PORT}/api/rag`);
  });
}

startServer();
