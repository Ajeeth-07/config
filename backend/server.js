const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

// Load .env BEFORE importing routes that use env variables
dotenv.config();

const uploadRoutes = require("./routes/upload");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware - Enable CORS for frontend
app.use(
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/upload", uploadRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "AI Input Generator API is running" });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
