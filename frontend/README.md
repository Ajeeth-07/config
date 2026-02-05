# Frontend - AI Input Configuration Generator

React frontend for AI-powered input configuration generation.

## Quick Start

```bash
npm install
npm start
```

Opens at http://localhost:3000

## Features

### Generator Tab
- Upload JSON (API structure) and Excel/CSV (mapping sheet)
- Enable/disable RAG for enhanced generation
- Real-time progress display (terminal-style)
- Download generated Excel output
- Token usage metrics

### Knowledge Base Tab
- View RAG statistics
- Upload training data (existing configurations)
- Real-time ingestion progress
- Search knowledge base
- Manage data (clear, delete by insurer)

## Components

| Component | Description |
|-----------|-------------|
| FileUpload.js | File selection and upload form |
| Terminal.js | Real-time processing status display |
| FieldDisplay.js | Results and download interface |
| KnowledgeBase.js | RAG management interface |

## Backend Connection

Connects to backend at http://localhost:5000

For SSE (Server-Sent Events), the frontend connects directly to the backend to avoid proxy buffering issues.

## Styling

90s-inspired minimal design with:
- Gray backgrounds
- Navy/green accents
- Monospace fonts
- Inset/outset borders
