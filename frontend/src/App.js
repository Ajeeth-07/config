import React, { useState } from 'react';
import FileUpload from './components/FileUpload';
import FieldDisplay from './components/FieldDisplay';
import './App.css';

function App() {
  const [generatedFields, setGeneratedFields] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleFilesProcessed = (result) => {
    setGeneratedFields(result);
    setLoading(false);
    setError(null);
  };

  const handleError = (errorMsg) => {
    setError(errorMsg);
    setLoading(false);
    setGeneratedFields(null);
  };

  const handleReset = () => {
    setGeneratedFields(null);
    setError(null);
  };

  return (
    <div className="App">
      <div className="container">
        <header className="header">
          <h1>🤖 AI Input Field Generator</h1>
          <p>Upload JSON and Excel files to automatically generate input fields</p>
        </header>

        <FileUpload 
          onSuccess={handleFilesProcessed}
          onError={handleError}
          onLoading={setLoading}
          onReset={handleReset}
        />

        {loading && (
          <div className="loading">
            <div className="spinner"></div>
            <p>Processing files with AI...</p>
          </div>
        )}

        {error && (
          <div className="error-message">
            <h3>❌ Error</h3>
            <p>{error}</p>
          </div>
        )}

        {generatedFields && !loading && (
          <FieldDisplay data={generatedFields} />
        )}
      </div>
    </div>
  );
}

export default App;
