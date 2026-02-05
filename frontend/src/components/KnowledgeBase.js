import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import "./KnowledgeBase.css";

const BACKEND_URL = "http://localhost:5000";

function KnowledgeBase() {
  const [stats, setStats] = useState(null);
  const [file, setFile] = useState(null);
  const [insurer, setInsurer] = useState("");
  const [product, setProduct] = useState("");
  const [isIngesting, setIsIngesting] = useState(false);
  const [logs, setLogs] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const logRef = useRef(null);

  // Fetch stats on mount
  useEffect(() => {
    fetchStats();
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const fetchStats = async () => {
    try {
      const res = await axios.get(`${BACKEND_URL}/api/rag/stats`);
      setStats(res.data);
    } catch (err) {
      console.log("Could not fetch RAG stats");
    }
  };

  const handleIngest = async (e) => {
    e.preventDefault();
    if (!file || !insurer) return;

    setIsIngesting(true);
    setLogs([]);

    const sessionId = Date.now().toString();

    // Setup SSE
    const eventSource = new EventSource(
      `${BACKEND_URL}/api/rag/progress/${sessionId}`,
    );

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.message) {
          setLogs((prev) => [...prev, data.message]);
        }
      } catch (e) {}
    };

    // Upload file
    const formData = new FormData();
    formData.append("file", file);
    formData.append("insurer", insurer);
    formData.append("product", product || "general");
    formData.append("sessionId", sessionId);

    try {
      await axios.post(`${BACKEND_URL}/api/rag/ingest`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setLogs((prev) => [...prev, "=== Ingestion Complete ==="]);
      fetchStats();
    } catch (err) {
      setLogs((prev) => [...prev, `ERROR: ${err.message}`]);
    } finally {
      setIsIngesting(false);
      eventSource.close();
      setFile(null);
      document.getElementById("ragFileInput").value = "";
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery) return;

    setIsSearching(true);
    try {
      const res = await axios.post(`${BACKEND_URL}/api/rag/search`, {
        query: searchQuery,
        topK: 5,
      });
      setSearchResults(res.data.results);
    } catch (err) {
      alert("Search failed: " + err.message);
    }
    setIsSearching(false);
  };

  const handleClear = async () => {
    if (!window.confirm("Clear ALL data from knowledge base?")) return;

    try {
      await axios.delete(`${BACKEND_URL}/api/rag/clear`);
      fetchStats();
      alert("Knowledge base cleared");
    } catch (err) {
      alert("Failed to clear: " + err.message);
    }
  };

  return (
    <div className="kb-container">
      <div className="kb-box">
        <h2>Knowledge Base (RAG)</h2>

        {/* Stats */}
        <div className="kb-stats">
          <div className="stat-item">
            <strong>Documents:</strong> {stats?.totalDocuments || 0}
          </div>
          <div className="stat-item">
            <strong>Insurers:</strong> {stats?.insurers?.join(", ") || "None"}
          </div>
        </div>

        {/* Ingest Form */}
        <div className="kb-section">
          <h3>Add Training Data</h3>
          <form onSubmit={handleIngest}>
            <div className="form-row">
              <label>Excel/CSV File:</label>
              <input
                id="ragFileInput"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => setFile(e.target.files[0])}
                disabled={isIngesting}
              />
            </div>
            <div className="form-row">
              <label>Insurer Name:</label>
              <input
                type="text"
                value={insurer}
                onChange={(e) => setInsurer(e.target.value)}
                placeholder="e.g., BAJAJ, KOTAK, HDFC"
                disabled={isIngesting}
              />
            </div>
            <div className="form-row">
              <label>Product (optional):</label>
              <input
                type="text"
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                placeholder="e.g., TERM, ULIP"
                disabled={isIngesting}
              />
            </div>
            <div className="form-row">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!file || !insurer || isIngesting}
              >
                {isIngesting ? "Ingesting..." : "Ingest Data"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={handleClear}
                disabled={isIngesting}
              >
                Clear All
              </button>
            </div>
          </form>

          {/* Ingestion Logs */}
          {logs.length > 0 && (
            <div className="kb-logs" ref={logRef}>
              {logs.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="kb-section">
          <h3>Search Knowledge Base</h3>
          <form onSubmit={handleSearch}>
            <div className="form-row">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search for field names, types..."
                style={{ flex: 1 }}
              />
              <button
                type="submit"
                className="btn"
                disabled={!searchQuery || isSearching}
              >
                {isSearching ? "..." : "Search"}
              </button>
            </div>
          </form>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="kb-results">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Similarity</th>
                    <th>Keyword</th>
                    <th>Caption</th>
                    <th>Type</th>
                    <th>Insurer</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((r, i) => (
                    <tr key={i}>
                      <td>{(parseFloat(r.similarity) * 100).toFixed(1)}%</td>
                      <td>{r.metadata?.keyword}</td>
                      <td>{r.metadata?.keywordcaption}</td>
                      <td>{r.metadata?.keywordtype}</td>
                      <td>{r.metadata?.insurer}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default KnowledgeBase;
