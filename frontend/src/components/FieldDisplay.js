import React, { useState } from "react";
import axios from "axios";
import "./FieldDisplay.css";

function FieldDisplay({ data }) {
  const [activeTab, setActiveTab] = useState("configs");
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!data.outputFile) return;

    setDownloading(true);
    try {
      const response = await axios.get(
        `/api/upload/download/${data.outputFile}`,
        {
          responseType: "blob",
        },
      );

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", data.outputFile);
      document.body.appendChild(link);
      link.click();

      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download failed:", error);
      alert("Failed to download file. Please try again.");
    }
    setDownloading(false);
  };

  const formatNumber = (num) => {
    return num?.toLocaleString() || "0";
  };

  return (
    <div className="field-display-container">
      <div className="success-banner">
        <h2>✅ Input Configurations Generated Successfully!</h2>
        <p>{data.configCount} input configurations created</p>
        {data.sheetsAnalyzed && (
          <p className="sheets-info">
            📑 Analyzed {data.sheetsAnalyzed.length} sheet(s):{" "}
            {data.sheetsAnalyzed.join(", ")}
            {data.fileType && (
              <span className="file-type-badge">
                {data.fileType.toUpperCase()}
              </span>
            )}
          </p>
        )}

        {/* Token Usage Summary */}
        {data.tokenUsage && (
          <div className="token-summary">
            <div className="token-stat">
              <span className="token-icon">🎯</span>
              <span className="token-value">
                {formatNumber(data.tokenUsage.totalTokens)}
              </span>
              <span className="token-label">Total Tokens</span>
            </div>
            <div className="token-stat">
              <span className="token-icon">📤</span>
              <span className="token-value">
                {formatNumber(data.tokenUsage.promptTokens)}
              </span>
              <span className="token-label">Input Tokens</span>
            </div>
            <div className="token-stat">
              <span className="token-icon">📥</span>
              <span className="token-value">
                {formatNumber(data.tokenUsage.completionTokens)}
              </span>
              <span className="token-label">Output Tokens</span>
            </div>
            {data.stats?.processingTimeSeconds && (
              <div className="token-stat">
                <span className="token-icon">⏱️</span>
                <span className="token-value">
                  {data.stats.processingTimeSeconds}s
                </span>
                <span className="token-label">Processing Time</span>
              </div>
            )}
          </div>
        )}

        <button
          className="download-btn"
          onClick={handleDownload}
          disabled={downloading}
        >
          {downloading ? "⏳ Downloading..." : "📥 Download Excel File"}
        </button>
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab === "configs" ? "active" : ""}`}
          onClick={() => setActiveTab("configs")}
        >
          Generated Configs ({data.configCount})
        </button>
        <button
          className={`tab ${activeTab === "stats" ? "active" : ""}`}
          onClick={() => setActiveTab("stats")}
        >
          📊 Token Usage
        </button>
        <button
          className={`tab ${activeTab === "json" ? "active" : ""}`}
          onClick={() => setActiveTab("json")}
        >
          Original JSON
        </button>
        <button
          className={`tab ${activeTab === "metadata" ? "active" : ""}`}
          onClick={() => setActiveTab("metadata")}
        >
          Mapping Sheet Data
        </button>
      </div>

      <div className="tab-content">
        {activeTab === "configs" && (
          <div className="configs-view">
            <h3>📋 Generated Input Configurations</h3>
            <p className="hint">
              These configurations will be in the downloaded Excel file
            </p>

            <div className="table-wrapper">
              <table className="configs-table">
                <thead>
                  <tr>
                    <th>Unique ID</th>
                    <th>Field Path</th>
                    <th>Label</th>
                    <th>Data Type</th>
                    <th>Required</th>
                    <th>Regex</th>
                    <th>List Values</th>
                    <th>Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {data.generatedConfigs?.map((config, idx) => (
                    <tr key={idx}>
                      <td className="unique-id">{config.uniqueIdentifier}</td>
                      <td className="field-path">{config.fieldPath}</td>
                      <td>{config.label}</td>
                      <td className="data-type">{config.dataType}</td>
                      <td
                        className={
                          config.required === "YES"
                            ? "required-yes"
                            : "required-no"
                        }
                      >
                        {config.required}
                      </td>
                      <td className="regex">{config.regex || "-"}</td>
                      <td className="list-values">
                        {config.listValues || "-"}
                      </td>
                      <td className="sample-value">
                        {config.sampleValue || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "stats" && (
          <div className="stats-view">
            <h3>📊 Token Usage & Processing Stats</h3>

            {/* Overall Stats */}
            <div className="stats-grid">
              <div className="stat-card">
                <h4>Total Tokens Used</h4>
                <div className="stat-number">
                  {formatNumber(data.tokenUsage?.totalTokens)}
                </div>
                <div className="stat-detail">
                  <span>
                    Input: {formatNumber(data.tokenUsage?.promptTokens)}
                  </span>
                  <span>
                    Output: {formatNumber(data.tokenUsage?.completionTokens)}
                  </span>
                </div>
              </div>

              <div className="stat-card">
                <h4>Batches Processed</h4>
                <div className="stat-number">
                  {data.stats?.batchesProcessed || 0}
                </div>
                <div className="stat-detail">
                  <span>
                    {data.stats?.totalColumnsProcessed || 0} columns total
                  </span>
                </div>
              </div>

              <div className="stat-card">
                <h4>Processing Time</h4>
                <div className="stat-number">
                  {data.stats?.processingTimeSeconds || 0}s
                </div>
                <div className="stat-detail">
                  <span>{data.stats?.totalSheets || 0} sheets analyzed</span>
                </div>
              </div>

              <div className="stat-card">
                <h4>Avg Tokens/Batch</h4>
                <div className="stat-number">
                  {data.tokenUsage?.batchBreakdown?.length > 0
                    ? Math.round(
                        data.tokenUsage.totalTokens /
                          data.tokenUsage.batchBreakdown.length,
                      )
                    : 0}
                </div>
                <div className="stat-detail">
                  <span>20 columns per batch</span>
                </div>
              </div>
            </div>

            {/* Batch Breakdown Table */}
            {data.tokenUsage?.batchBreakdown &&
              data.tokenUsage.batchBreakdown.length > 0 && (
                <>
                  <h4 className="section-title">Batch-by-Batch Breakdown</h4>
                  <div className="table-wrapper">
                    <table className="batch-table">
                      <thead>
                        <tr>
                          <th>Batch #</th>
                          <th>Sheet</th>
                          <th>Columns</th>
                          <th>Prompt Tokens</th>
                          <th>Completion Tokens</th>
                          <th>Total Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.tokenUsage.batchBreakdown.map((batch, idx) => (
                          <tr key={idx}>
                            <td>{batch.batch}</td>
                            <td>{batch.sheet}</td>
                            <td>{batch.columns}</td>
                            <td>{formatNumber(batch.promptTokens)}</td>
                            <td>{formatNumber(batch.completionTokens)}</td>
                            <td className="total-cell">
                              {formatNumber(batch.totalTokens)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="total-row">
                          <td colSpan="3">
                            <strong>TOTAL</strong>
                          </td>
                          <td>
                            <strong>
                              {formatNumber(data.tokenUsage.promptTokens)}
                            </strong>
                          </td>
                          <td>
                            <strong>
                              {formatNumber(data.tokenUsage.completionTokens)}
                            </strong>
                          </td>
                          <td className="total-cell">
                            <strong>
                              {formatNumber(data.tokenUsage.totalTokens)}
                            </strong>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}

            {/* Cost Estimation (rough) */}
            <div className="cost-estimate">
              <h4>💰 Estimated Cost (Approximate)</h4>
              <p className="cost-note">
                Based on Gemini Flash pricing (~$0.075/1M input, ~$0.30/1M
                output)
              </p>
              <div className="cost-value">
                $
                {(
                  (data.tokenUsage?.promptTokens || 0) * 0.000000075 +
                  (data.tokenUsage?.completionTokens || 0) * 0.0000003
                ).toFixed(6)}
              </div>
            </div>
          </div>
        )}

        {activeTab === "json" && (
          <div className="json-view">
            <h3>📄 Original JSON Structure</h3>
            <pre className="json-code">
              {JSON.stringify(data.originalJson, null, 2)}
            </pre>
          </div>
        )}

        {activeTab === "metadata" && (
          <div className="metadata-view">
            <h3>📊 Original Mapping Sheet Data</h3>
            <p className="hint">
              This is the raw data from the uploaded insurer mapping file
            </p>
            {data.mappingData && data.mappingData.length > 0 ? (
              <div className="table-wrapper">
                <table className="metadata-table">
                  <thead>
                    <tr>
                      {Object.keys(data.mappingData[0]).map((key, idx) => (
                        <th key={idx}>{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.mappingData.map((row, idx) => (
                      <tr key={idx}>
                        {Object.values(row).map((value, vIdx) => (
                          <td key={vIdx}>{String(value)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No mapping data available</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default FieldDisplay;
