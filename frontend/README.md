# Frontend - AI Input Field Generator

## Overview
React-based frontend for uploading files and displaying AI-generated input fields.

## Installation

```bash
npm install
```

## Running the Application

Development mode:
```bash
npm start
```

Build for production:
```bash
npm run build
```

## Features

- File upload interface (JSON and Excel)
- Real-time processing status
- Tabbed view for results:
  - Generated Fields (interactive form)
  - Original JSON
  - Excel Metadata
- Responsive design
- Error handling with user-friendly messages

## Components

### App.js
Main application component with state management

### FileUpload.js
- Handles file selection
- Validates file types
- Submits to backend API
- Reset functionality

### FieldDisplay.js
- Displays generated fields
- Interactive form inputs
- Tabbed interface
- Supports multiple field types

## Styling

All components use CSS modules for scoped styling:
- Modern gradient backgrounds
- Smooth animations
- Responsive grid layouts
- Accessible form elements

## API Integration

The frontend communicates with the backend via proxy configuration in `package.json`:
```json
"proxy": "http://localhost:5000"
```

Change this if your backend runs on a different port.
