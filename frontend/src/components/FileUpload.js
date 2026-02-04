import React, { useState } from "react";
import "./FileUpload.css";

function FileUpload({ onSubmit, disabled }) {
  const [jsonFile, setJsonFile] = useState(null);
  const [mappingFile, setMappingFile] = useState(null);

  const handleJsonChange = (e) => {
    const file = e.target.files[0];
    if (file) setJsonFile(file);
  };

  const handleMappingChange = (e) => {
    const file = e.target.files[0];
    if (file) setMappingFile(file);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (jsonFile && mappingFile) {
      onSubmit(jsonFile, mappingFile);
    }
  };

  const handleReset = () => {
    setJsonFile(null);
    setMappingFile(null);
    document.getElementById("jsonInput").value = "";
    document.getElementById("mappingInput").value = "";
  };

  return (
    <div className="upload-box">
      <h2>File Upload</h2>
      <form onSubmit={handleSubmit}>
        <div className="file-row">
          <div className="file-group">
            <label>JSON File (API Reference):</label>
            <input
              id="jsonInput"
              type="file"
              accept=".json"
              onChange={handleJsonChange}
              disabled={disabled}
            />
            {jsonFile && (
              <div className="file-selected">Selected: {jsonFile.name}</div>
            )}
          </div>
          <div className="file-group">
            <label>Mapping Sheet (Excel/CSV):</label>
            <input
              id="mappingInput"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleMappingChange}
              disabled={disabled}
            />
            {mappingFile && (
              <div className="file-selected">Selected: {mappingFile.name}</div>
            )}
          </div>
        </div>
        <div className="btn-row">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!jsonFile || !mappingFile || disabled}
          >
            {disabled ? "Processing..." : "Generate Configs"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleReset}
            disabled={disabled}
          >
            Reset
          </button>
        </div>
      </form>
    </div>
  );
}

export default FileUpload;
