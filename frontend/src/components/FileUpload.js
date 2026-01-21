import React, { useState } from 'react';
import axios from 'axios';
import './FileUpload.css';

function FileUpload({ onSuccess, onError, onLoading, onReset }) {
  const [jsonFile, setJsonFile] = useState(null);
  const [excelFile, setExcelFile] = useState(null);

  const handleJsonChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/json') {
      setJsonFile(file);
    } else {
      onError('Please select a valid JSON file');
    }
  };

  const handleExcelChange = (e) => {
    const file = e.target.files[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      setExcelFile(file);
    } else {
      onError('Please select a valid Excel file (.xlsx or .xls)');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!jsonFile || !excelFile) {
      onError('Please upload both JSON and Excel files');
      return;
    }

    onLoading(true);
    onReset();

    const formData = new FormData();
    formData.append('jsonFile', jsonFile);
    formData.append('excelFile', excelFile);

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
    setExcelFile(null);
    onReset();
    document.getElementById('jsonFileInput').value = '';
    document.getElementById('excelFileInput').value = '';
  };

  return (
    <div className="file-upload-container">
      <form onSubmit={handleSubmit} className="upload-form">
        <div className="file-input-group">
          <div className="file-input-wrapper">
            <label htmlFor="jsonFileInput" className="file-label">
              📄 JSON File
            </label>
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
            <label htmlFor="excelFileInput" className="file-label">
              📊 Excel File
            </label>
            <input
              id="excelFileInput"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleExcelChange}
              className="file-input"
            />
            {excelFile && (
              <span className="file-name">✓ {excelFile.name}</span>
            )}
          </div>
        </div>

        <div className="button-group">
          <button 
            type="submit" 
            className="submit-btn"
            disabled={!jsonFile || !excelFile}
          >
            Generate Input Fields
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
