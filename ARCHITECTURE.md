# 🏗️ System Architecture

## Overview

The AI Input Field Generator is a full-stack application that uses Google's Gemini LLM to intelligently generate form input fields from JSON and Excel metadata.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER BROWSER                             │
│                    http://localhost:3000                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ HTTP Requests
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      REACT FRONTEND                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   App.js     │  │ FileUpload   │  │ FieldDisplay │          │
│  │  (Main)      │  │ Component    │  │  Component   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                  │                  │                  │
│         └──────────────────┴──────────────────┘                  │
│                            │                                     │
│                            │ axios POST                          │
│                            │ /api/upload/process                 │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXPRESS BACKEND                               │
│                 http://localhost:5000                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  server.js - Main Express Server                         │   │
│  │  - CORS enabled                                           │   │
│  │  - Routes configuration                                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            │                                     │
│                            ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  routes/upload.js                                         │   │
│  │  - Multer file upload handling                            │   │
│  │  - File validation (JSON, Excel)                          │   │
│  │  - POST /api/upload/process                               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            │                                     │
│                            ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  services/aiAgent.js                                      │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │ 1. readJsonFile() - Validate & Parse JSON          │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │ 2. readExcelFile() - Parse Excel to JSON           │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │ 3. flattenJson() - Convert nested to dot notation  │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │ 4. processFiles() - Main AI processing             │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            │                                     │
│                            │ API Call                            │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   GOOGLE GEMINI AI API                           │
│                  (gemini-1.5-flash model)                        │
│                                                                  │
│  - Analyzes JSON structure                                       │
│  - Processes Excel metadata                                      │
│  - Generates intelligent field configurations                    │
│  - Returns structured JSON response                              │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. File Upload Phase
```
User → FileUpload Component → FormData → Backend API
```

### 2. Processing Phase
```
Backend receives files
    ↓
Validate JSON structure
    ↓
Parse Excel metadata
    ↓
Flatten JSON to dot notation
    ↓
Create AI prompt with both inputs
    ↓
Send to Gemini AI
    ↓
Receive generated field configurations
    ↓
Return to frontend
```

### 3. Display Phase
```
Frontend receives response
    ↓
FieldDisplay Component renders
    ↓
User sees interactive form fields
```

## Component Responsibilities

### Frontend Components

#### App.js
- **Role**: Main application orchestrator
- **State Management**: 
  - `generatedFields` - AI response data
  - `loading` - Processing status
  - `error` - Error messages
- **Responsibilities**:
  - Manage global state
  - Coordinate between components
  - Handle error display

#### FileUpload.js
- **Role**: File selection and upload
- **Responsibilities**:
  - Accept JSON and Excel files
  - Validate file types
  - Send files to backend via FormData
  - Handle upload progress
  - Reset functionality

#### FieldDisplay.js
- **Role**: Display generated fields
- **Responsibilities**:
  - Render different input types dynamically
  - Manage form state
  - Display JSON and metadata in tabs
  - Handle user interactions

### Backend Components

#### server.js
- **Role**: Express server setup
- **Responsibilities**:
  - Initialize Express app
  - Configure middleware (CORS, JSON parsing)
  - Mount routes
  - Start HTTP server

#### routes/upload.js
- **Role**: File upload endpoint
- **Responsibilities**:
  - Configure Multer for file storage
  - Validate file types
  - Handle upload errors
  - Clean up temporary files
  - Route to AI service

#### services/aiAgent.js
- **Role**: AI processing logic
- **Functions**:
  - `readJsonFile()`: JSON validation and parsing
  - `readExcelFile()`: Excel to JSON conversion
  - `flattenJson()`: Recursive JSON flattening
  - `processFiles()`: Gemini AI integration
- **Responsibilities**:
  - File processing
  - Data transformation
  - AI prompt engineering
  - Response formatting

## Technology Choices

### Why Node.js + Express?
- Fast, lightweight backend
- Excellent for file uploads
- Easy integration with npm packages
- Great async handling for AI API calls

### Why React?
- Component-based architecture
- Easy state management
- Rich ecosystem
- Fast development

### Why Gemini AI?
- Powerful language understanding
- Good at structured data generation
- Reliable JSON output
- Cost-effective
- Fast response times

### Why Multer?
- Industry standard for file uploads in Node.js
- Flexible storage options
- Built-in file validation
- Easy cleanup

### Why XLSX?
- Robust Excel parsing
- Supports both .xls and .xlsx
- Easy to use API
- Good performance

## Security Considerations

1. **File Validation**: Only JSON and Excel files accepted
2. **File Cleanup**: Temporary files deleted after processing
3. **API Key**: Stored in environment variables
4. **CORS**: Configured for specific origins
5. **File Size Limits**: Multer limits prevent large uploads
6. **No Data Persistence**: Files not stored permanently

## Scalability Considerations

### Current Limitations
- Synchronous file processing
- No queue system
- Single-threaded Node.js
- No caching

### Future Improvements
- Add Redis for caching
- Implement job queue (Bull/BullMQ)
- Database for storing configurations
- Load balancing for multiple instances
- Rate limiting for API calls
- WebSocket for real-time updates

## Error Handling Strategy

### Frontend
- User-friendly error messages
- Loading states
- Graceful degradation
- Reset functionality

### Backend
- Try-catch blocks
- HTTP status codes
- Detailed error logs
- File cleanup on error

## Performance Optimization

1. **Frontend**:
   - React component optimization
   - Lazy loading potential
   - CSS-in-JS for scoped styles

2. **Backend**:
   - Async/await for non-blocking operations
   - Stream processing for large files (future)
   - Efficient JSON parsing

3. **AI Integration**:
   - Using Gemini Flash model (faster)
   - Optimized prompts
   - Response caching (future)

## Deployment Considerations

### Backend Deployment
- Environment variables configuration
- Process manager (PM2)
- Reverse proxy (Nginx)
- HTTPS/SSL certificates
- File upload size limits

### Frontend Deployment
- Build optimization
- CDN for static assets
- Environment-based API URLs
- Compression (gzip/brotli)

### Database (Future)
- PostgreSQL for structured data
- Redis for caching
- MongoDB for flexible schemas
