import React, { useState } from "react";
import axios from "axios";
import "./FieldDisplay.css";

/**
 * Gemini 3 Pro pricing (per 1M tokens):
 *   <= 200k total tokens: $2 input / $12 output
 *   >  200k total tokens: $4 input / $18 output
 */
function calculateCost(promptTokens, completionTokens) {
  const totalTokens = promptTokens + completionTokens;
  const isHighTier = totalTokens > 200000;

  const inputRate = isHighTier ? 4.0 : 2.0; // $ per 1M tokens
  const outputRate = isHighTier ? 18.0 : 12.0; // $ per 1M tokens

  const inputCost = (promptTokens / 1_000_000) * inputRate;
  const outputCost = (completionTokens / 1_000_000) * outputRate;
  const totalCost = inputCost + outputCost;

  return {
    tier: isHighTier ? ">200k" : "<=200k",
    inputRate,
    outputRate,
    inputCost,
    outputCost,
    totalCost,
  };
}

function PricingBreakdown({ tokenUsage }) {
  if (!tokenUsage) return null;

  const prompt = tokenUsage.promptTokens || 0;
  const completion = tokenUsage.completionTokens || 0;
  const cost = calculateCost(prompt, completion);

  return (
    <div className="pricing-box">
      <p className="pricing-title">Estimated Cost (gemini-3-pro-preview)</p>
      <table className="token-table">
        <thead>
          <tr>
            <th>Component</th>
            <th>Tokens</th>
            <th>Rate (per 1M)</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Input (prompt)</td>
            <td>{prompt.toLocaleString()}</td>
            <td>${cost.inputRate.toFixed(2)}</td>
            <td>${cost.inputCost.toFixed(6)}</td>
          </tr>
          <tr>
            <td>Output (completion)</td>
            <td>{completion.toLocaleString()}</td>
            <td>${cost.outputRate.toFixed(2)}</td>
            <td>${cost.outputCost.toFixed(6)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td>{(prompt + completion).toLocaleString()}</td>
            <td className="pricing-tier">Tier: {cost.tier}</td>
            <td className="pricing-total">${cost.totalCost.toFixed(6)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function FieldDisplay({ data }) {
  const [activeTab, setActiveTab] = useState("configs");
  const [downloading, setDownloading] = useState(false);
  const [downloadingLV, setDownloadingLV] = useState(false);

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

  const handleDownloadListValues = async () => {
    if (!data.listValuesFile) return;

    setDownloadingLV(true);
    try {
      const response = await axios.get(
        `/api/upload/download/${data.listValuesFile}`,
        { responseType: "blob" },
      );

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", data.listValuesFile);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert("Download failed. Please try again.");
    }
    setDownloadingLV(false);
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
        <div className="download-row">
          <div className="download-item">
            <p>
              Input Configs: <strong>{data.outputFile}</strong>
            </p>
            <button
              className="btn-download"
              onClick={handleDownload}
              disabled={downloading}
            >
              {downloading ? "Downloading..." : "Download Input Configs"}
            </button>
          </div>
          {data.listValuesFile && (
            <div className="download-item">
              <p>
                List Values: <strong>{data.listValuesFile}</strong> (
                {data.listValuesCount || 0} values)
              </p>
              <button
                className="btn-download btn-download-lv"
                onClick={handleDownloadListValues}
                disabled={downloadingLV}
              >
                {downloadingLV ? "Downloading..." : "Download List Values"}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="tabs">
        <button
          className={`tab-btn ${activeTab === "configs" ? "active" : ""}`}
          onClick={() => setActiveTab("configs")}
        >
          Configs ({data.configCount})
        </button>
        {data.listValuesFile && (
          <button
            className={`tab-btn ${activeTab === "listvals" ? "active" : ""}`}
            onClick={() => setActiveTab("listvals")}
          >
            List Values ({data.listValuesCount || 0})
          </button>
        )}
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

        {activeTab === "listvals" && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Keyword</th>
                <th>Display</th>
                <th>Value</th>
                <th>Default</th>
                <th>Seq</th>
              </tr>
            </thead>
            <tbody>
              {data.generatedListValues?.map((lv, idx) => (
                <tr key={idx}>
                  <td>{lv.keyword || "-"}</td>
                  <td>{lv.keyworddisplay || "-"}</td>
                  <td>{lv.keywordvalue || "-"}</td>
                  <td>{lv.defaultselected || "False"}</td>
                  <td>{lv.keyvalsequence || "-"}</td>
                </tr>
              ))}
              {(!data.generatedListValues ||
                data.generatedListValues.length === 0) && (
                <tr>
                  <td colSpan="5" style={{ textAlign: "center" }}>
                    No list values generated
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {activeTab === "tokens" && (
          <div>
            {/* Pricing calculator */}
            <PricingBreakdown tokenUsage={data.tokenUsage} />

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
