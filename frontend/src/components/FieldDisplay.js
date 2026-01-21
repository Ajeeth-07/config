import React, { useState } from 'react';
import './FieldDisplay.css';

function FieldDisplay({ data }) {
  const [activeTab, setActiveTab] = useState('fields');
  const [formValues, setFormValues] = useState({});

  const handleInputChange = (fieldName, value) => {
    setFormValues({
      ...formValues,
      [fieldName]: value
    });
  };

  const renderInputField = (field) => {
    const value = formValues[field.fieldName] !== undefined 
      ? formValues[field.fieldName] 
      : field.defaultValue || '';

    switch (field.dataType?.toLowerCase()) {
      case 'select':
      case 'dropdown':
        return (
          <select
            value={value}
            onChange={(e) => handleInputChange(field.fieldName, e.target.value)}
            required={field.required}
            className="form-select"
          >
            <option value="">Select {field.label}</option>
            {field.options?.map((option, idx) => (
              <option key={idx} value={option}>
                {option}
              </option>
            ))}
          </select>
        );

      case 'boolean':
      case 'checkbox':
        return (
          <div className="checkbox-wrapper">
            <input
              type="checkbox"
              checked={value === true || value === 'true'}
              onChange={(e) => handleInputChange(field.fieldName, e.target.checked)}
              className="form-checkbox"
            />
            <span>{field.label}</span>
          </div>
        );

      case 'date':
        return (
          <input
            type="date"
            value={value}
            onChange={(e) => handleInputChange(field.fieldName, e.target.value)}
            required={field.required}
            className="form-input"
          />
        );

      case 'number':
        return (
          <input
            type="number"
            value={value}
            onChange={(e) => handleInputChange(field.fieldName, e.target.value)}
            required={field.required}
            className="form-input"
          />
        );

      case 'textarea':
        return (
          <textarea
            value={value}
            onChange={(e) => handleInputChange(field.fieldName, e.target.value)}
            required={field.required}
            className="form-textarea"
            rows="3"
          />
        );

      default:
        return (
          <input
            type="text"
            value={value}
            onChange={(e) => handleInputChange(field.fieldName, e.target.value)}
            required={field.required}
            className="form-input"
          />
        );
    }
  };

  return (
    <div className="field-display-container">
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'fields' ? 'active' : ''}`}
          onClick={() => setActiveTab('fields')}
        >
          Generated Fields ({data.fieldCount})
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
          Excel Metadata
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'fields' && (
          <div className="fields-grid">
            <h2>✨ Generated Input Fields</h2>
            <div className="form-container">
              {data.generatedFields?.map((field, index) => (
                <div key={index} className="field-item">
                  <label className="field-label">
                    {field.label}
                    {field.required && <span className="required">*</span>}
                  </label>
                  <div className="field-info">
                    <span className="field-name">{field.fieldName}</span>
                    <span className="field-type">{field.dataType}</span>
                  </div>
                  {renderInputField(field)}
                  {field.validation && (
                    <span className="validation-info">
                      ℹ️ {field.validation}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'json' && (
          <div className="json-view">
            <h2>📄 Original JSON Structure</h2>
            <pre className="json-code">
              {JSON.stringify(data.originalJson, null, 2)}
            </pre>
          </div>
        )}

        {activeTab === 'metadata' && (
          <div className="metadata-view">
            <h2>📊 Excel Metadata</h2>
            {data.excelMetadata && data.excelMetadata.length > 0 ? (
              <div className="table-wrapper">
                <table className="metadata-table">
                  <thead>
                    <tr>
                      {Object.keys(data.excelMetadata[0]).map((key, idx) => (
                        <th key={idx}>{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.excelMetadata.map((row, idx) => (
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
              <p>No metadata available</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default FieldDisplay;
