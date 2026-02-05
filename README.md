# AI Input Configuration Generator

An intelligent agentic AI system powered by Google Gemini LLM that automatically generates input field configurations from JSON API structures and Excel mapping sheets. Built for the insurance technology domain to streamline API mapping and form creation workflows.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Installation](#installation)
5. [API Reference](#api-reference)
6. [RAG Knowledge Base](#rag-knowledge-base)
7. [Usage Guide](#usage-guide)
8. [Configuration](#configuration)
9. [Troubleshooting](#troubleshooting)

---

## Overview

### Problem Statement

Creating input configurations and API mappings in the insurance domain is time-consuming. Analysts manually create hundreds of field definitions with keywords, data types, validations, and mappings for each insurer product.

### Solution

This system uses:

- **Gemini LLM** for intelligent field generation
- **RAG (Retrieval Augmented Generation)** to leverage existing configurations
- **Automated Excel output** with standardized 33-column format

### Key Features

- JSON validation and parsing
- **Multi-sheet Excel support** (handles 7-8 sheets per file, e.g., ICICI with LA/PR, NRI, Medical questionnaires)
- Excel/CSV metadata extraction (supports varied formats from different insurers)
- AI-powered field generation with **Gemini 3 thinking levels**
- Context caching for reduced token usage
- RAG-based knowledge retrieval for improved accuracy
- Real-time processing status via Server-Sent Events
- Standardized Excel output with 33 columns
- Token usage tracking and optimization

---

## Architecture

```
                                    +------------------+
                                    |    Frontend      |
                                    |   (React.js)     |
                                    |   Port: 3000     |
                                    +--------+---------+
                                             |
                                             | HTTP/SSE
                                             v
+------------------+              +----------+-----------+              +------------------+
|   Excel/CSV      |   Upload    |      Backend         |   API Call   |   Gemini LLM     |
|   Mapping Sheet  +------------>+    (Node.js)         +------------->+   (Google AI)    |
+------------------+              |    Port: 5000        |              +------------------+
                                  |                      |
+------------------+              |  +----------------+  |              +------------------+
|   JSON API       |   Upload    |  | RAG System     |  |   Embed      |   Gemini         |
|   Structure      +------------>+  | (Vector Store) +--+------------->+   Embedding API  |
+------------------+              |  +----------------+  |              +------------------+
                                  +----------+-----------+
                                             |
                                             v
                                  +----------+-----------+
                                  |   Output Excel       |
                                  |   (33 Columns)       |
                                  +----------------------+
```

---

## Tech Stack

| Component         | Technology                       | Purpose               |
| ----------------- | -------------------------------- | --------------------- |
| Backend Runtime   | Node.js v16+                     | Server environment    |
| Backend Framework | Express.js                       | REST API              |
| LLM               | Google Gemini (gemini-2.0-flash) | AI generation         |
| Embedding Model   | gemini-embedding-001             | Text vectorization    |
| Vector Storage    | File-based JSON                  | Embedding persistence |
| File Parsing      | XLSX                             | Excel/CSV processing  |
| File Upload       | Multer                           | Multipart handling    |
| Frontend          | React.js                         | User interface        |
| Real-time Updates | Server-Sent Events               | Progress streaming    |

---

## Installation

### Prerequisites

- Node.js v16 or higher
- npm or yarn
- Google Gemini API Key

### Step 1: Clone and Setup Backend

```bash
cd AI_CONFIG/backend
npm install
```

Create `.env` file:

```env
PORT=5000
GEMINI_API_KEY=your_gemini_api_key_here
```

Start the server:

```bash
npm run dev
```

### Step 2: Setup Frontend

```bash
cd AI_CONFIG/frontend
npm install
npm start
```

---

## API Reference

### Base URLs

| Service     | URL                   |
| ----------- | --------------------- |
| Backend API | http://localhost:5000 |
| Frontend UI | http://localhost:3000 |

---

### Upload API Endpoints

#### Process Files

Generate input configurations from JSON and Excel files.

```
POST http://localhost:5000/api/upload/process
Content-Type: multipart/form-data

Parameters:
- jsonFile: JSON file (application/json)
- excelFile: Excel or CSV file (.xlsx, .xls, .csv)
- sessionId: Unique session identifier for SSE
- useRAG: boolean (true/false) - Enable RAG retrieval
```

#### Progress Stream (SSE)

Real-time processing status updates.

```
GET http://localhost:5000/api/upload/progress/:sessionId

Response: Server-Sent Events stream
- type: "info" | "success" | "error"
- message: Status text
- timestamp: ISO timestamp
```

#### Download Generated Excel

```
GET http://localhost:5000/api/upload/download/:filename
```

---

### RAG Knowledge Base API Endpoints

#### Initialize Vector Store

```
GET http://localhost:5000/api/rag/init
```

#### Get Knowledge Base Statistics

```
GET http://localhost:5000/api/rag/stats

Response:
{
  "totalDocuments": 1537,
  "insurers": ["BAJAJ", "KOTAK", "ICICI", "HDFC"]
}
```

#### Ingest Training Data (Excel/CSV)

```
POST http://localhost:5000/api/rag/ingest
Content-Type: multipart/form-data

Parameters:
- file: Excel or CSV file
- insurer: Insurer name (e.g., "BAJAJ")
- product: Product name (e.g., "TERM_LIFE")
- sessionId: For SSE progress updates
```

#### Ingest from JSON

```
POST http://localhost:5000/api/rag/ingest-json
Content-Type: application/json

Body:
{
  "configs": [...],
  "insurer": "BAJAJ",
  "product": "TERM_LIFE"
}
```

#### Search Similar Configurations

```
POST http://localhost:5000/api/rag/search
Content-Type: application/json

Body:
{
  "query": "insured gender",
  "topK": 5,
  "insurer": "BAJAJ" (optional filter)
}
```

#### Clear All Data

```
DELETE http://localhost:5000/api/rag/clear
```

#### Delete by Insurer

```
DELETE http://localhost:5000/api/rag/insurer/:insurer
```

---

### Data Inspection Endpoints

#### View Knowledge Base (HTML)

```
GET http://localhost:5000/api/rag/export?format=html
```

Browser-friendly table view of all stored configurations.

#### View Knowledge Base (JSON)

```
GET http://localhost:5000/api/rag/export
```

#### Download Knowledge Base Backup

```
GET http://localhost:5000/api/rag/download
```

Downloads complete knowledge base as JSON file.

#### View Raw Embeddings (HTML)

```
GET http://localhost:5000/api/rag/vectors?format=html
```

Visual display of how text is converted to numerical vectors.

#### View Raw Embeddings (JSON)

```
GET http://localhost:5000/api/rag/vectors
GET http://localhost:5000/api/rag/vectors?limit=10
GET http://localhost:5000/api/rag/vectors?full=true
```

#### Test Text to Embedding Conversion

```
POST http://localhost:5000/api/rag/test-embedding
Content-Type: application/json

Body:
{
  "text": "INSURED_GENDER"
}

Response:
{
  "inputText": "INSURED_GENDER",
  "textLength": 14,
  "embeddingDimensions": 768,
  "processingTimeMs": 245,
  "embedding": {
    "first20": [0.0234, -0.0891, ...],
    "last10": [...],
    "min": -0.0891,
    "max": 0.1245,
    "mean": "0.000234"
  }
}
```

**cURL Example:**

```bash
curl -X POST http://localhost:5000/api/rag/test-embedding \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"INSURED_GENDER\"}"
```

---

## RAG Knowledge Base

### How RAG Works

RAG (Retrieval Augmented Generation) improves AI output quality by referencing existing configurations.

#### Phase A: Ingestion

```
Excel Row --> Parse --> Searchable Text --> Gemini Embedding --> 768-dim Vector --> Store
```

#### Phase B: Retrieval

```
New Input --> Generate Query Vector --> Cosine Similarity Search --> Top K Matches
```

#### Phase C: Generation

```
Retrieved Context + New Input --> Gemini LLM --> Enhanced Output
```

### Embedding Task Types

| Task Type           | Usage                  |
| ------------------- | ---------------------- |
| RETRIEVAL_DOCUMENT  | When storing documents |
| RETRIEVAL_QUERY     | When searching         |
| SEMANTIC_SIMILARITY | For direct comparisons |

### Data Storage Location

```
backend/data/rag/
├── vectors.json    # Embeddings (768-dimensional arrays)
└── metadata.json   # Document content and metadata
```

---

## Usage Guide

### Generator Workflow

1. Open http://localhost:3000
2. Select "Generator" tab
3. Enable/Disable RAG toggle based on preference
4. Upload JSON file (API structure reference)
5. Upload Excel/CSV file (mapping sheet)
6. Click "Generate"
7. Monitor progress in terminal display
8. Download generated Excel file

### Knowledge Base Management

1. Select "Knowledge Base" tab
2. View current statistics
3. Upload training data (existing configurations)
4. Specify insurer and product names
5. Monitor ingestion progress
6. Use search to verify data

---

## Configuration

### Backend Configuration

File: `backend/services/config.js`

| Parameter                       | Default              | Description                              |
| ------------------------------- | -------------------- | ---------------------------------------- |
| MODEL                           | gemini-3-pro-preview | Gemini 3 LLM model                       |
| THINKING_LEVEL                  | high                 | Reasoning depth (low/high)               |
| THINKING_LEVEL_WITH_RAG_CONTEXT | low                  | Thinking level when RAG provides context |
| BATCH_SIZE                      | 100                  | Rows per batch                           |
| DELAY_BETWEEN_BATCHES_MS        | 3000                 | Rate limiting                            |
| MAX_RETRIES                     | 3                    | API retry count                          |
| ENABLE_CACHING                  | true                 | Context caching                          |
| CACHE_TTL_SECONDS               | 3600                 | Cache duration                           |

### Gemini 3 Thinking Levels

The system uses Gemini 3's thinking level feature to optimize performance:

| Level  | Usage                           | When Used                          |
| ------ | ------------------------------- | ---------------------------------- |
| `high` | Deep reasoning, better accuracy | Complex fields, no RAG context     |
| `low`  | Fast processing, lower latency  | When RAG provides similar examples |

Reference: [Gemini 3 Thinking Level](https://ai.google.dev/gemini-api/docs/gemini-3#thinking_level)

### RAG Configuration

File: `backend/services/rag/config.js`

| Parameter       | Default              | Description          |
| --------------- | -------------------- | -------------------- |
| EMBEDDING_MODEL | gemini-embedding-001 | Embedding model      |
| DIMENSIONS      | 768                  | Vector dimensions    |
| TOP_K           | 5                    | Results per search   |
| MIN_SIMILARITY  | 0.7                  | Similarity threshold |
| BATCH_SIZE      | 50                   | Embedding batch size |

### Output Excel Columns

The generated Excel contains 33 columns in this order:

1. keyword
2. keywordcaption
3. keywordtype
4. keyworddatatype
5. parentkeyword
6. keysequence
7. defaultvalue
8. ismandatory
9. inputoroutput
10. reversecalctype
11. addonstype
12. controlgivento
13. seporagg
14. defaultuibehaviour
15. maxrepeatercount
16. keyminvalue
17. keymaxvalue
18. minlength
19. maxlength
20. regex
21. lookupcondition
22. addlcondition
23. metadata
24. chkfieldsource
25. defaultadditionstep
26. fromeffectivedate
27. toeffectivedate
28. fromversionid
29. toversionid
30. keywordsection
31. coveragecode
32. riskitemcode
33. coverageriskcategory

---

## Troubleshooting

### Common Issues

| Issue            | Solution                                                         |
| ---------------- | ---------------------------------------------------------------- |
| Port 5000 in use | `taskkill /F /IM node.exe` (Windows) or `pkill node` (Mac/Linux) |
| API key invalid  | Verify GEMINI_API_KEY in .env file                               |
| SSE not updating | Check CORS settings, use direct backend URL                      |
| Slow processing  | Reduce BATCH_SIZE, enable RAG for faster retrieval               |
| Empty embeddings | Verify Gemini API quota is not exceeded                          |

### Logs Location

- Backend console: Real-time processing logs
- Terminal file: `terminals/*.txt`
- RAG data: `backend/data/rag/`

---

## Quick Reference Links

### Development URLs

| Description          | URL                              |
| -------------------- | -------------------------------- |
| Frontend Application | http://localhost:3000            |
| Backend API Base     | http://localhost:5000            |
| Upload API           | http://localhost:5000/api/upload |
| RAG API              | http://localhost:5000/api/rag    |

### Data Inspection URLs

| Description                  | URL                                               |
| ---------------------------- | ------------------------------------------------- |
| Knowledge Base Viewer (HTML) | http://localhost:5000/api/rag/export?format=html  |
| Knowledge Base Stats         | http://localhost:5000/api/rag/stats               |
| Raw Embeddings Viewer        | http://localhost:5000/api/rag/vectors?format=html |
| Download KB Backup           | http://localhost:5000/api/rag/download            |

### Testing Commands

**Test Embedding Conversion:**

```bash
curl -X POST http://localhost:5000/api/rag/test-embedding -H "Content-Type: application/json" -d "{\"text\": \"INSURED_GENDER\"}"
```

**Search Knowledge Base:**

```bash
curl -X POST http://localhost:5000/api/rag/search -H "Content-Type: application/json" -d "{\"query\": \"insured date of birth\", \"topK\": 5}"
```

**Get Statistics:**

```bash
curl http://localhost:5000/api/rag/stats
```

---

## Project Structure

```
AI_CONFIG/
├── backend/
│   ├── data/
│   │   └── rag/                    # Vector store data
│   │       ├── vectors.json        # Embeddings
│   │       └── metadata.json       # Documents
│   ├── routes/
│   │   ├── upload.js               # File upload endpoints
│   │   └── rag.js                  # RAG API endpoints
│   ├── services/
│   │   ├── rag/
│   │   │   ├── config.js           # RAG configuration
│   │   │   ├── embeddingService.js # Gemini embeddings
│   │   │   ├── vectorStore.js      # Vector storage
│   │   │   ├── ingestionService.js # Data ingestion
│   │   │   ├── retrievalService.js # Similarity search
│   │   │   └── index.js            # RAG exports
│   │   ├── utils/
│   │   │   ├── helpers.js          # Utility functions
│   │   │   ├── fileReaders.js      # File parsing
│   │   │   └── dataProcessing.js   # Data transforms
│   │   ├── aiProcessor.js          # LLM interaction
│   │   ├── cacheService.js         # Context caching
│   │   ├── excelGenerator.js       # Excel output
│   │   ├── config.js               # Main config
│   │   └── index.js                # Service orchestration
│   ├── uploads/                    # Temporary uploads
│   ├── output/                     # Generated files
│   ├── server.js                   # Express server
│   ├── package.json
│   └── .env                        # Environment variables
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── FileUpload.js       # Upload interface
│   │   │   ├── Terminal.js         # Progress display
│   │   │   ├── FieldDisplay.js     # Results view
│   │   │   └── KnowledgeBase.js    # RAG management
│   │   ├── App.js                  # Main application
│   │   └── App.css                 # Styles
│   └── package.json
├── sample-files/                   # Example inputs
└── README.md                       # This file
```

---

## License

This project is open source and available under the MIT License.

---

_Built for the Insurance Technology domain_
