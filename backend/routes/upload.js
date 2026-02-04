const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

// Store for SSE clients
const progressClients = new Map();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/";
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
    const allowedExts = [".json", ".xlsx", ".xls", ".csv"];
    const allowedMimes = [
      "application/json",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
      "application/csv",
    ];

    if (allowedExts.includes(ext) || allowedMimes.includes(file.mimetype)) {
      return cb(null, true);
    } else {
      cb(
        new Error("Only JSON, Excel (.xlsx, .xls), and CSV files are allowed!"),
      );
    }
  },
});

// SSE endpoint for progress updates
router.get("/progress/:sessionId", (req, res) => {
  const sessionId = req.params.sessionId;

  // Critical headers for SSE to work properly
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Flush headers immediately
  res.flushHeaders();

  // Send initial connection message
  res.write(
    `data: ${JSON.stringify({
      type: "connected",
      message: "Connected to progress stream",
    })}\n\n`,
  );

  // Store the response object for this session
  progressClients.set(sessionId, res);

  // Keep connection alive with heartbeat
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15000);

  // Clean up on close
  req.on("close", () => {
    clearInterval(heartbeat);
    progressClients.delete(sessionId);
  });
});

// Helper to send progress update
function sendProgress(sessionId, message, type = "log") {
  const client = progressClients.get(sessionId);
  if (client) {
    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    try {
      client.write(`data: ${JSON.stringify({ type, message, timestamp })}\n\n`);
    } catch (e) {
      // Client disconnected
      progressClients.delete(sessionId);
    }
  }
}

// Upload and process files with progress streaming
router.post(
  "/process",
  upload.fields([
    { name: "jsonFile", maxCount: 1 },
    { name: "excelFile", maxCount: 1 },
  ]),
  async (req, res) => {
    const sessionId = req.body.sessionId || Date.now().toString();

    try {
      if (!req.files.jsonFile || !req.files.excelFile) {
        return res.status(400).json({
          error: "Both JSON and Excel files are required",
        });
      }

      const jsonFilePath = req.files.jsonFile[0].path;
      const excelFilePath = req.files.excelFile[0].path;

      // Import processFiles with progress callback
      const { processFilesWithProgress } = require("../services");

      // Process files with progress updates
      const result = await processFilesWithProgress(
        jsonFilePath,
        excelFilePath,
        (message, type) => sendProgress(sessionId, message, type),
      );

      // Clean up uploaded files
      fs.unlinkSync(jsonFilePath);
      fs.unlinkSync(excelFilePath);

      // Send completion message
      sendProgress(sessionId, "Processing complete!", "complete");

      res.json(result);
    } catch (error) {
      console.error("Error processing files:", error);
      sendProgress(sessionId, `ERROR: ${error.message}`, "error");

      // Clean up files on error
      if (req.files && req.files.jsonFile) {
        try {
          fs.unlinkSync(req.files.jsonFile[0].path);
        } catch (e) {}
      }
      if (req.files && req.files.excelFile) {
        try {
          fs.unlinkSync(req.files.excelFile[0].path);
        } catch (e) {}
      }

      res.status(500).json({
        error: error.message || "Failed to process files",
      });
    }
  },
);

// Download generated Excel file
router.get("/download/:filename", (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, "..", "outputs", filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);

  fileStream.on("end", () => {
    setTimeout(() => {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {}
    }, 5000);
  });
});

module.exports = router;
