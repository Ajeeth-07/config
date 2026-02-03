import React, { useState } from 'react';
import axios from 'axios';
import './FileUpload.css';

function FileUpload({ onSuccess, onError, onLoading, onReset }) {
  const [jsonFile, setJsonFile] = useState(null);
  const [mappingFile, setMappingFile] = useState(null);

  const handleJsonChange = (e) => {
    const file = e.target.files[0];
    if (file && (file.type === 'application/json' || file.name.endsWith('.json'))) {
      setJsonFile(file);
    } else {
      onError('Please select a valid JSON file');
    }
  };

  const handleMappingFileChange = (e) => {
    const file = e.target.files[0];
    const validExts = ['.xlsx', '.xls', '.csv'];
    const isValid = validExts.some(ext => file?.name.toLowerCase().endsWith(ext));
    
    if (file && isValid) {
      setMappingFile(file);
    } else {
      onError('Please select a valid mapping file (.xlsx, .xls, or .csv)');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!jsonFile || !mappingFile) {
      onError('Please upload both JSON and Mapping files');
      return;
    }

    onLoading(true);
    onReset();

    const formData = new FormData();
    formData.append('jsonFile', jsonFile);
    formData.append('excelFile', mappingFile);

    try {
      const response = await axios.post('/api/upload/process', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      onSuccess(response.data);
    } catch (error) {
      const errorMsg = error.response?.data?.error || error.message || 'Failed to process files';
      onError(errorMsg);
    }
  };

  const handleReset = () => {
    setJsonFile(null);
    setMappingFile(null);
    onReset();
    document.getElementById('jsonFileInput').value = '';
    document.getElementById('mappingFileInput').value = '';
  };

  return (
    <div className="file-upload-container">
      <form onSubmit={handleSubmit} className="upload-form">
        <div className="file-input-group">
          <div className="file-input-wrapper">
            <label htmlFor="jsonFileInput" className="file-label">
              📄 JSON File (Reference Only)
            </label>
            <p className="file-hint">Sample JSON for API structure reference</p>
            <input
              id="jsonFileInput"
              type="file"
              accept=".json"
              onChange={handleJsonChange}
              className="file-input"
            />
            {jsonFile && (
              <span className="file-name">✓ {jsonFile.name}</span>
            )}
          </div>

          <div className="file-input-wrapper">
            <label htmlFor="mappingFileInput" className="file-label">
              📊 Mapping Sheet (Source of Truth)
            </label>
            <p className="file-hint">Excel/CSV with ALL fields from any insurer (BAJAJ, Kotak, IPRU, etc.)</p>
            <input
              id="mappingFileInput"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleMappingFileChange}
              className="file-input"
            />
            {mappingFile && (
              <span className="file-name">✓ {mappingFile.name}</span>
            )}
          </div>
        </div>

        <div className="button-group">
          <button 
            type="submit" 
            className="submit-btn"
            disabled={!jsonFile || !mappingFile}
          >
            🚀 Generate Configurations
          </button>
          <button 
            type="button" 
            onClick={handleReset}
            className="reset-btn"
          >
            Reset
          </button>
        </div>
      </form>
    </div>
  );
}

export default FileUpload;
