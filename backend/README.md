# Backend - AI Input Field Generator

## Overview
Node.js/Express backend with Gemini AI integration for processing JSON and Excel files.

## Installation

```bash
npm install
```

## Environment Variables

Create a `.env` file:

```env
PORT=5000
GEMINI_API_KEY=your_gemini_api_key_here
```

## Running the Server

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## API Endpoints

### POST `/api/upload/process`

Upload and process JSON and Excel files.

**Request:**
- Content-Type: `multipart/form-data`
- Fields:
  - `jsonFile`: JSON file
  - `excelFile`: Excel file (.xlsx or .xls)

**Response:**
```json
{
  "success": true,
  "originalJson": {...},
  "flattenedJson": {...},
  "excelMetadata": [...],
  "generatedFields": [...],
  "fieldCount": 10
}
```

### GET `/api/health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "message": "AI Input Generator API is running"
}
```

## Dependencies

- `express`: Web framework
- `@google/generative-ai`: Gemini AI SDK
- `multer`: File upload handling
- `cors`: Cross-origin resource sharing
- `dotenv`: Environment variable management
- `xlsx`: Excel file parsing

## Error Handling

All errors return appropriate HTTP status codes with error messages in JSON format.
