# 🤖 AI Input Field Generator - Insurtech Solution

An intelligent agentic AI system powered by Google's Gemini LLM that automatically generates input field definitions from JSON and Excel files. Perfect for insurance companies to streamline their API mapping and form creation workflow.

## 📋 Overview

This application solves the time-consuming task of creating input fields and API mapping in the insurtech domain. Simply upload:
1. **JSON file** - Your data structure (e.g., insurance product details)
2. **Excel file** - Metadata (field types, validations, list values)

The AI agent will analyze both files and automatically generate comprehensive input field configurations.

## 🚀 Features

- ✅ JSON validation and parsing
- ✅ Excel metadata extraction
- ✅ AI-powered field generation using Gemini LLM
- ✅ Support for nested JSON structures
- ✅ Multiple input types (text, number, date, select, boolean, etc.)
- ✅ Automatic validation rules
- ✅ Beautiful, responsive UI
- ✅ Real-time field preview

## 🛠️ Tech Stack

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **Gemini AI (Google)** - LLM for intelligent field generation
- **Multer** - File upload handling
- **XLSX** - Excel file parsing

### Frontend
- **React** - UI framework
- **Axios** - HTTP client
- **CSS3** - Modern styling

## 📁 Project Structure

```
AI_CONFIG/
├── backend/
│   ├── routes/
│   │   └── upload.js          # File upload endpoints
│   ├── services/
│   │   └── aiAgent.js         # Gemini AI integration & processing logic
│   ├── server.js              # Express server setup
│   ├── package.json
│   └── .gitignore
├── frontend/
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── components/
│   │   │   ├── FileUpload.js     # File upload component
│   │   │   ├── FileUpload.css
│   │   │   ├── FieldDisplay.js   # Generated fields display
│   │   │   └── FieldDisplay.css
│   │   ├── App.js
│   │   ├── App.css
│   │   ├── index.js
│   │   └── index.css
│   ├── package.json
│   └── .gitignore
├── sample-files/
│   ├── sample.json              # Example JSON file
│   └── sample-metadata.xlsx     # Example Excel metadata
└── README.md
```

## 🔧 Installation & Setup

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- Google Gemini API Key ([Get it here](https://makersuite.google.com/app/apikey))

### Step 1: Clone the Repository
```bash
cd AI_CONFIG
```

### Step 2: Backend Setup

1. Navigate to backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file in the backend directory:
```bash
# Create .env file
touch .env
```

4. Add your Gemini API key to `.env`:
```env
PORT=5000
GEMINI_API_KEY=your_actual_gemini_api_key_here
```

5. Start the backend server:
```bash
# Development mode with auto-reload
npm run dev

# OR Production mode
npm start
```

Backend will run on `http://localhost:5000`

### Step 3: Frontend Setup

1. Open a new terminal and navigate to frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the React development server:
```bash
npm start
```

Frontend will run on `http://localhost:3000`

## 📖 Usage Guide

### 1. Prepare Your Files

#### JSON File Example (`sample.json`):
```json
{
  "productCode": "B07",
  "basicDetails": {
    "phEqualsLi": true,
    "insured": {
      "gender": "female",
      "dateOfBirth": "01/01/1975"
    }
  }
}
```

#### Excel Metadata File:
Create an Excel file with these columns:
- `fieldName` - The field path (e.g., "basicDetails.insured.gender")
- `label` - Display label
- `dataType` - Field type (text, number, date, select, boolean)
- `required` - true/false
- `options` - Comma-separated values for select fields
- `validation` - Validation rules

Example:

| fieldName | label | dataType | required | options | validation |
|-----------|-------|----------|----------|---------|------------|
| productCode | Product Code | text | true | | Must be alphanumeric |
| basicDetails.insured.gender | Gender | select | true | male,female,other | |
| basicDetails.insured.dateOfBirth | Date of Birth | date | true | | DD/MM/YYYY format |

### 2. Upload Files

1. Open the application in your browser (`http://localhost:3000`)
2. Click "📄 JSON File" and select your JSON file
3. Click "📊 Excel File" and select your Excel metadata file
4. Click "Generate Input Fields"

### 3. View Results

The AI will process your files and display:
- **Generated Fields Tab**: Interactive input fields with proper types and validations
- **Original JSON Tab**: Your uploaded JSON structure
- **Excel Metadata Tab**: Your metadata in table format

## 🧪 Testing with Sample Files

Sample files are provided in the `sample-files/` directory:

1. Use `sample.json` and `sample-metadata.xlsx` to test the application
2. These files demonstrate a typical insurance product structure

## 🎯 How It Works

1. **File Upload**: User uploads JSON and Excel files
2. **Validation**: Backend validates JSON structure
3. **Parsing**: 
   - JSON is flattened to extract all field paths
   - Excel is parsed to extract metadata
4. **AI Processing**: 
   - Gemini AI analyzes both inputs
   - Generates intelligent field configurations
   - Maps data types, validations, and options
5. **Response**: Frontend displays interactive form fields

## 🔑 Key Components

### Backend

#### `server.js`
Main Express server setup with CORS and routes

#### `routes/upload.js`
- Handles file uploads with Multer
- Validates file types (JSON and Excel only)
- Processes files and returns results
- Cleans up temporary files

#### `services/aiAgent.js`
- **`readJsonFile()`**: Validates and parses JSON
- **`readExcelFile()`**: Parses Excel to JSON
- **`flattenJson()`**: Converts nested JSON to dot notation
- **`processFiles()`**: Main AI processing logic with Gemini

### Frontend

#### `App.js`
Main application component managing state

#### `FileUpload.js`
- File selection interface
- Form validation
- API communication

#### `FieldDisplay.js`
- Tabbed interface for results
- Dynamic form field rendering
- Support for all input types

## 🌟 Supported Field Types

- **Text**: Standard text input
- **Number**: Numeric input with validation
- **Date**: Date picker
- **Select/Dropdown**: Options from metadata
- **Boolean/Checkbox**: True/false values
- **Textarea**: Multi-line text

## 🔒 Security Considerations

- File uploads are validated for type and size
- Temporary files are automatically cleaned up
- CORS is configured for local development
- API key is stored in environment variables

## 🚨 Troubleshooting

### Backend Issues

**Error: "GEMINI_API_KEY is not defined"**
- Ensure `.env` file exists in backend directory
- Check that `GEMINI_API_KEY` is set correctly
- Restart the backend server

**Error: "Port 5000 already in use"**
- Change PORT in `.env` file
- Update proxy in `frontend/package.json` accordingly

### Frontend Issues

**Files not uploading**
- Check that backend is running on port 5000
- Verify CORS is enabled
- Check browser console for errors

**AI processing fails**
- Verify Gemini API key is valid
- Check file formats match requirements
- Ensure Excel has required columns

## 📝 Future Enhancements

- [ ] Support for multiple JSON files
- [ ] Export generated fields as code
- [ ] Save/load configurations
- [ ] Advanced validation rules
- [ ] Support for more LLM providers
- [ ] Database integration for field storage
- [ ] User authentication
- [ ] API rate limiting
- [ ] Batch processing

## 🤝 Contributing

Feel free to submit issues and enhancement requests!

## 📄 License

This project is open source and available under the MIT License.

## 👨‍💻 Support

For issues or questions, please create an issue in the repository.

---

**Built with ❤️ for the Insurtech industry**
