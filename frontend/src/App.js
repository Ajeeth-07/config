import React, { useState, useRef, useCallback } from "react";
import axios from "axios";
import FileUpload from "./components/FileUpload";
import Terminal from "./components/Terminal";
import FieldDisplay from "./components/FieldDisplay";
import "./App.css";

// Direct backend URL for SSE (bypasses proxy buffering)
const BACKEND_URL = "http://localhost:5000";

function App() {
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const eventSourceRef = useRef(null);

  const addLog = useCallback((message, type = "log") => {
    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLogs((prev) => [...prev, { message, type, timestamp }]);
  }, []);

  const handleSubmit = async (jsonFile, mappingFile) => {
    // Reset state
    setLogs([]);
    setResult(null);
    setError(null);
    setIsProcessing(true);

    const sessionId = Date.now().toString();

    // Setup SSE connection DIRECTLY to backend (not through proxy)
    // React proxy buffers SSE which prevents real-time updates
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
      } catch (e) {
        // Ignore parse errors (heartbeats, etc)
      }
    };

    eventSourceRef.current.onerror = (err) => {
      // Only log if we're still processing
      if (isProcessing) {
        console.log("SSE connection error or closed");
      }
    };

    // Small delay to ensure SSE connection is established
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Upload files
    const formData = new FormData();
    formData.append("jsonFile", jsonFile);
    formData.append("excelFile", mappingFile);
    formData.append("sessionId", sessionId);

    try {
      addLog(`Uploading: ${jsonFile.name}, ${mappingFile.name}`, "info");

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
          <h1>AI Input Config Generator v1.0</h1>
          <p>
            Upload mapping sheet to generate standardized input configurations
          </p>
        </header>

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
      </div>
    </div>
  );
}

export default App;
