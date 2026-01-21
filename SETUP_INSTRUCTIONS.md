# 📝 Detailed Setup Instructions

## Prerequisites Checklist

- [ ] Node.js v16+ installed ([Download here](https://nodejs.org/))
- [ ] npm or yarn installed (comes with Node.js)
- [ ] Google Gemini API Key ([Get it here](https://makersuite.google.com/app/apikey))
- [ ] Git (optional, for version control)
- [ ] Code editor (VS Code recommended)

## Installation Steps

### Step 1: Install Backend Dependencies

```bash
# Navigate to backend folder
cd backend

# Install all dependencies
npm install

# Expected packages:
# - express: Web framework
# - @google/generative-ai: Gemini AI SDK
# - multer: File upload handling
# - cors: Cross-origin requests
# - dotenv: Environment variables
# - xlsx: Excel parsing
```

### Step 2: Configure Backend Environment

```bash
# Still in backend folder
# Create .env file (copy from template)
# On Windows:
copy .env.example .env

# On Mac/Linux:
cp .env.example .env
```

Edit `.env` file:
```env
PORT=5000
GEMINI_API_KEY=paste_your_actual_api_key_here
```

**Important**: Replace `paste_your_actual_api_key_here` with your real Gemini API key!

### Step 3: Start Backend Server

```bash
# Still in backend folder

# Option 1: Development mode (auto-reload on file changes)
npm run dev

# Option 2: Production mode
npm start

# You should see:
# "Server is running on port 5000"
```

Keep this terminal window open!

### Step 4: Install Frontend Dependencies

Open a **NEW** terminal window:

```bash
# Navigate to frontend folder
cd frontend

# Install all dependencies
npm install

# Expected packages:
# - react: UI library
# - react-dom: React DOM rendering
# - axios: HTTP client
# - react-scripts: Build tools
```

### Step 5: Start Frontend Development Server

```bash
# Still in frontend folder
npm start

# Your browser should automatically open to:
# http://localhost:3000

# If not, manually navigate to http://localhost:3000
```

### Step 6: Test with Sample Files

1. Your browser should now show the AI Input Field Generator
2. Click "📄 JSON File" button
3. Navigate to `sample-files/sample.json` and select it
4. Click "📊 Excel File" button
5. Navigate to `sample-files/sample-metadata.xlsx` and select it
6. Click "Generate Input Fields" button
7. Wait a few seconds for AI processing
8. View your generated fields!

## Verification Checklist

After setup, verify:

- [ ] Backend running on http://localhost:5000
  - Test: Visit http://localhost:5000/api/health
  - Should see: `{"status":"ok","message":"AI Input Generator API is running"}`

- [ ] Frontend running on http://localhost:3000
  - Should see: Purple gradient background with upload interface

- [ ] File upload works
  - Upload sample files
  - No errors in browser console
  - Fields generate successfully

## Common Issues and Solutions

### Issue 1: "Cannot find module 'express'"
**Solution**: Run `npm install` in the backend folder

### Issue 2: "GEMINI_API_KEY is not defined"
**Solution**: 
1. Check `.env` file exists in backend folder
2. Verify API key is correct
3. Restart backend server after editing `.env`

### Issue 3: "Port 5000 already in use"
**Solution**:
1. Change PORT in backend/.env to 5001 (or any available port)
2. Update frontend/package.json proxy: `"proxy": "http://localhost:5001"`
3. Restart both servers

### Issue 4: Frontend shows "Network Error"
**Solution**:
1. Ensure backend is running
2. Check backend console for errors
3. Verify proxy setting in frontend/package.json
4. Try disabling browser extensions

### Issue 5: "AI processing failed"
**Solution**:
1. Verify Gemini API key is valid
2. Check you have API quota remaining
3. Ensure JSON file is valid JSON
4. Ensure Excel file has correct column headers

### Issue 6: Files not uploading
**Solution**:
1. Check file types (.json and .xlsx/.xls only)
2. Verify both files are selected
3. Check browser console for errors
4. Ensure backend uploads folder is writable

## Environment Setup for Different Operating Systems

### Windows
```bash
# Create .env
copy .env.example .env

# Edit with Notepad
notepad .env
```

### macOS/Linux
```bash
# Create .env
cp .env.example .env

# Edit with nano
nano .env

# Or with vim
vim .env
```

## Development Tips

1. **Backend Development**:
   - Use `npm run dev` for auto-reload
   - Check console for error messages
   - Test API with tools like Postman

2. **Frontend Development**:
   - React will auto-reload on file changes
   - Open browser DevTools (F12) for debugging
   - Use React DevTools extension

3. **Testing Changes**:
   - Backend changes: Server auto-reloads with nodemon
   - Frontend changes: Page auto-reloads
   - .env changes: Must restart server manually

## Next Steps After Setup

1. **Test with your own files**:
   - Create your own JSON structure
   - Create matching Excel metadata
   - Upload and generate fields

2. **Customize the application**:
   - Modify UI colors in CSS files
   - Add new field types in FieldDisplay.js
   - Enhance AI prompts in aiAgent.js

3. **Read the documentation**:
   - README.md - Full documentation
   - ARCHITECTURE.md - System design
   - backend/README.md - API documentation
   - frontend/README.md - Component documentation

## Getting Help

If you encounter issues:
1. Check the console logs (both frontend and backend)
2. Review error messages carefully
3. Consult the troubleshooting section in README.md
4. Check the ARCHITECTURE.md for system understanding

## Production Deployment Checklist

Before deploying to production:

- [ ] Set NODE_ENV=production
- [ ] Use proper secrets management
- [ ] Enable HTTPS/SSL
- [ ] Configure CORS properly
- [ ] Set up proper logging
- [ ] Add rate limiting
- [ ] Configure file size limits
- [ ] Set up monitoring
- [ ] Configure backups (if using database)
- [ ] Test error scenarios

---

**Happy coding! 🚀**
