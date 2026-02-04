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
        { responseType: "blob" },
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
      alert("Download failed. Please try again.");
    }
    setDownloading(false);
  };

  return (
    <div className="results-box">
      <h2>Results - {data.configCount} Configurations Generated</h2>

      <div className="stats-row">
        <div className="stat-box">
          <strong>Sheets:</strong> {data.stats?.totalSheets || 0}
        </div>
        <div className="stat-box">
          <strong>Rows Processed:</strong>{" "}
          {data.stats?.totalInputFieldsProcessed || 0}
        </div>
        <div className="stat-box">
          <strong>Batches:</strong> {data.stats?.batchesProcessed || 0}
        </div>
        <div className="stat-box">
          <strong>Time:</strong> {data.stats?.processingTimeSeconds || 0}s
        </div>
        <div className="stat-box">
          <strong>Total Tokens:</strong>{" "}
          {data.tokenUsage?.totalTokens?.toLocaleString() || 0}
        </div>
      </div>

      <div className="download-section">
        <p>
          Output file ready: <strong>{data.outputFile}</strong>
        </p>
        <button
          className="btn-download"
          onClick={handleDownload}
          disabled={downloading}
        >
          {downloading ? "Downloading..." : "Download Excel"}
        </button>
      </div>

      <div className="tabs">
        <button
          className={`tab-btn ${activeTab === "configs" ? "active" : ""}`}
          onClick={() => setActiveTab("configs")}
        >
          Configs ({data.configCount})
        </button>
        <button
          className={`tab-btn ${activeTab === "tokens" ? "active" : ""}`}
          onClick={() => setActiveTab("tokens")}
        >
          Token Usage
        </button>
        <button
          className={`tab-btn ${activeTab === "json" ? "active" : ""}`}
          onClick={() => setActiveTab("json")}
        >
          JSON
        </button>
        <button
          className={`tab-btn ${activeTab === "mapping" ? "active" : ""}`}
          onClick={() => setActiveTab("mapping")}
        >
          Mapping Data
        </button>
      </div>

      <div className="tab-content">
        {activeTab === "configs" && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Keyword</th>
                <th>Caption</th>
                <th>Type</th>
                <th>Mandatory</th>
                <th>Regex</th>
              </tr>
            </thead>
            <tbody>
              {data.generatedConfigs?.map((config, idx) => (
                <tr key={idx}>
                  <td>{config.keyword || config.uniqueIdentifier || "-"}</td>
                  <td>{config.keywordcaption || config.label || "-"}</td>
                  <td>{config.keywordtype || config.dataType || "-"}</td>
                  <td>
                    {config.ismandatory ||
                      (config.required === "YES" ? "TRUE" : "FALSE")}
                  </td>
                  <td
                    style={{
                      maxWidth: 150,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {config.regex || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {activeTab === "tokens" && (
          <div>
            <table className="token-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Prompt Tokens</td>
                  <td>
                    {data.tokenUsage?.promptTokens?.toLocaleString() || 0}
                  </td>
                </tr>
                <tr>
                  <td>Completion Tokens</td>
                  <td>
                    {data.tokenUsage?.completionTokens?.toLocaleString() || 0}
                  </td>
                </tr>
                <tr>
                  <td>Total Tokens</td>
                  <td>
                    <strong>
                      {data.tokenUsage?.totalTokens?.toLocaleString() || 0}
                    </strong>
                  </td>
                </tr>
              </tbody>
            </table>

            {data.tokenUsage?.batchBreakdown?.length > 0 && (
              <>
                <p style={{ marginTop: 12, fontWeight: "bold" }}>
                  Batch Breakdown:
                </p>
                <table className="token-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Sheet</th>
                      <th>Rows</th>
                      <th>Prompt</th>
                      <th>Completion</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tokenUsage.batchBreakdown.map((b, i) => (
                      <tr key={i}>
                        <td>{b.batch}</td>
                        <td>{b.sheet}</td>
                        <td>{b.rows}</td>
                        <td>{b.promptTokens?.toLocaleString()}</td>
                        <td>{b.completionTokens?.toLocaleString()}</td>
                        <td>{b.totalTokens?.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan="3">TOTAL</td>
                      <td>{data.tokenUsage.promptTokens?.toLocaleString()}</td>
                      <td>
                        {data.tokenUsage.completionTokens?.toLocaleString()}
                      </td>
                      <td>{data.tokenUsage.totalTokens?.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
              </>
            )}
          </div>
        )}

        {activeTab === "json" && (
          <pre className="json-view">
            {JSON.stringify(data.originalJson, null, 2)}
          </pre>
        )}

        {activeTab === "mapping" && (
          <table className="data-table">
            <thead>
              <tr>
                {data.mappingData?.[0] &&
                  Object.keys(data.mappingData[0]).map((key, i) => (
                    <th key={i}>{key}</th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {data.mappingData?.slice(0, 50).map((row, idx) => (
                <tr key={idx}>
                  {Object.values(row).map((val, i) => (
                    <td key={i}>{String(val)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default FieldDisplay;
