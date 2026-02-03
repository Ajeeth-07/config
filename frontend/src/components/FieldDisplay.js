import React, { useState } from 'react';
import axios from 'axios';
import './FieldDisplay.css';

function FieldDisplay({ data }) {
  const [activeTab, setActiveTab] = useState('configs');
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!data.outputFile) return;
    
    setDownloading(true);
    try {
      const response = await axios.get(`/api/upload/download/${data.outputFile}`, {
        responseType: 'blob'
      });
      
      // Create blob link to download
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', data.outputFile);
      document.body.appendChild(link);
      link.click();
      
      // Cleanup
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Failed to download file. Please try again.');
    }
    setDownloading(false);
  };

  return (
    <div className="field-display-container">
      <div className="success-banner">
        <h2>✅ Input Configurations Generated Successfully!</h2>
        <p>{data.configCount} input configurations created</p>
        {data.sheetsAnalyzed && (
          <p className="sheets-info">
            📑 Analyzed {data.sheetsAnalyzed.length} sheet(s): {data.sheetsAnalyzed.join(', ')} 
            {data.fileType && <span className="file-type-badge">{data.fileType.toUpperCase()}</span>}
          </p>
        )}
        <button className="download-btn" onClick={handleDownload} disabled={downloading}>
          {downloading ? '⏳ Downloading...' : '📥 Download Excel File'}
        </button>
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'configs' ? 'active' : ''}`}
          onClick={() => setActiveTab('configs')}
        >
          Generated Configs ({data.configCount})
        </button>
        <button
          className={`tab ${activeTab === 'json' ? 'active' : ''}`}
          onClick={() => setActiveTab('json')}
        >
          Original JSON
        </button>
        <button
          className={`tab ${activeTab === 'metadata' ? 'active' : ''}`}
          onClick={() => setActiveTab('metadata')}
        >
          Mapping Sheet Data
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'configs' && (
          <div className="configs-view">
            <h3>📋 Generated Input Configurations</h3>
            <p className="hint">These configurations will be in the downloaded Excel file</p>
            
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
                      <td className={config.required === 'YES' ? 'required-yes' : 'required-no'}>
                        {config.required}
                      </td>
                      <td className="regex">{config.regex || '-'}</td>
                      <td className="list-values">{config.listValues || '-'}</td>
                      <td className="sample-value">{config.sampleValue || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'json' && (
          <div className="json-view">
            <h3>📄 Original JSON Structure</h3>
            <pre className="json-code">
              {JSON.stringify(data.originalJson, null, 2)}
            </pre>
          </div>
        )}

        {activeTab === 'metadata' && (
          <div className="metadata-view">
            <h3>📊 Original Mapping Sheet Data</h3>
            <p className="hint">This is the raw data from the uploaded insurer mapping file</p>
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
