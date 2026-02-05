# Backend - AI Input Configuration Generator

Node.js/Express backend service for AI-powered input configuration generation.

## Quick Start

```bash
npm install
npm run dev
```

## Environment Variables

Create `.env` file:
```env
PORT=5000
GEMINI_API_KEY=your_api_key_here
```

## API Endpoints

### Upload API (`/api/upload`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /process | Process JSON and Excel files |
| GET | /progress/:sessionId | SSE progress stream |
| GET | /download/:filename | Download generated file |

### RAG API (`/api/rag`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /init | Initialize vector store |
| GET | /stats | Get knowledge base stats |
| POST | /ingest | Ingest Excel/CSV training data |
| POST | /ingest-json | Ingest JSON configurations |
| POST | /search | Search similar configs |
| GET | /export | View all data (JSON) |
| GET | /export?format=html | View all data (HTML) |
| GET | /vectors | View embeddings (JSON) |
| GET | /vectors?format=html | View embeddings (HTML) |
| GET | /download | Download KB backup |
| POST | /test-embedding | Test text to vector |
| DELETE | /clear | Clear all data |
| DELETE | /insurer/:name | Delete by insurer |

## Data Storage

```
data/rag/
├── vectors.json    # Embeddings (768-dim arrays)
└── metadata.json   # Document content and metadata
```

## Services Architecture

```
services/
├── rag/
│   ├── config.js           # RAG configuration
│   ├── embeddingService.js # Gemini embeddings
│   ├── vectorStore.js      # Vector storage
│   ├── ingestionService.js # Data ingestion
│   └── retrievalService.js # Similarity search
├── utils/
│   ├── helpers.js          # Utilities
│   ├── fileReaders.js      # File parsing
│   └── dataProcessing.js   # Data transforms
├── aiProcessor.js          # LLM interaction
├── cacheService.js         # Context caching
├── excelGenerator.js       # Excel output
├── config.js               # Main config
└── index.js                # Orchestration
```

## Configuration

Edit `services/config.js` for LLM settings.
Edit `services/rag/config.js` for RAG settings.
