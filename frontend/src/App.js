import React, { useState, useRef, useCallback } from "react";
import axios from "axios";
import FileUpload from "./components/FileUpload";
import Terminal from "./components/Terminal";
import FieldDisplay from "./components/FieldDisplay";
import KnowledgeBase from "./components/KnowledgeBase";
import "./App.css";

// Direct backend URL for SSE (bypasses proxy buffering)
const BACKEND_URL = "http://localhost:5000";

function App() {
  const [activeTab, setActiveTab] = useState("generator");
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [useRAG, setUseRAG] = useState(true);
  const eventSourceRef = useRef(null);

  const addLog = useCallback((message, type = "log") => {
    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLogs((prev) => [...prev, { message, type, timestamp }]);
  }, []);

  const handleSubmit = async (jsonFile, mappingFile) => {
    setLogs([]);
    setResult(null);
    setError(null);
    setIsProcessing(true);

    const sessionId = Date.now().toString();

    addLog("Connecting to server...", "info");

    eventSourceRef.current = new EventSource(
      `${BACKEND_URL}/api/upload/progress/${sessionId}`,
    );

    eventSourceRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "connected") {
          addLog("Connected. Starting upload...", "info");
        } else if (data.type === "complete") {
          addLog(data.message, "success");
        } else if (data.type === "error") {
          addLog(data.message, "error");
        } else if (data.type === "success") {
          addLog(data.message, "success");
        } else {
          addLog(data.message, data.type);
        }
      } catch (e) {}
    };

    eventSourceRef.current.onerror = () => {};

    await new Promise((resolve) => setTimeout(resolve, 100));

    const formData = new FormData();
    formData.append("jsonFile", jsonFile);
    formData.append("excelFile", mappingFile);
    formData.append("sessionId", sessionId);
    formData.append("useRAG", useRAG);

    try {
      addLog(`Uploading: ${jsonFile.name}, ${mappingFile.name}`, "info");
      if (useRAG) {
        addLog("RAG Enhancement: ENABLED", "info");
      }

      const response = await axios.post("/api/upload/process", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setResult(response.data);
      addLog("===========================================", "success");
      addLog("DONE! Check results below.", "success");
      addLog("===========================================", "success");
    } catch (err) {
      const errorMsg =
        err.response?.data?.error || err.message || "Processing failed";
      setError(errorMsg);
      addLog(`FATAL ERROR: ${errorMsg}`, "error");
    } finally {
      setIsProcessing(false);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    }
  };

  return (
    <div className="App">
      <div className="container">
        <header className="header">
          <h1>AI Input Config Generator v2.0</h1>
          <p>With RAG-enhanced knowledge base for better accuracy</p>
        </header>

        {/* Main Tabs */}
        <div className="main-tabs">
          <button
            className={`main-tab ${activeTab === "generator" ? "active" : ""}`}
            onClick={() => setActiveTab("generator")}
          >
            Generator
          </button>
          <button
            className={`main-tab ${
              activeTab === "knowledgebase" ? "active" : ""
            }`}
            onClick={() => setActiveTab("knowledgebase")}
          >
            Knowledge Base
          </button>
        </div>

        {/* Generator Tab */}
        {activeTab === "generator" && (
          <>
            <div className="rag-toggle">
              <label>
                <input
                  type="checkbox"
                  checked={useRAG}
                  onChange={(e) => setUseRAG(e.target.checked)}
                  disabled={isProcessing}
                />
                Enable RAG (uses knowledge base for better accuracy)
              </label>
            </div>

            <FileUpload onSubmit={handleSubmit} disabled={isProcessing} />

            {(isProcessing || logs.length > 0) && (
              <Terminal logs={logs} isRunning={isProcessing} />
            )}

            {error && !isProcessing && (
              <div className="error-box">
                <p>
                  <strong>Error:</strong> {error}
                </p>
              </div>
            )}

            {result && !isProcessing && <FieldDisplay data={result} />}
          </>
        )}

        {/* Knowledge Base Tab */}
        {activeTab === "knowledgebase" && <KnowledgeBase />}
      </div>
    </div>
  );
}

export default App;
