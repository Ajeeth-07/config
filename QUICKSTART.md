# 🚀 Quick Start Guide

Get your AI Input Field Generator running in 5 minutes!

## Step 1: Get Gemini API Key

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Click "Create API Key"
3. Copy your API key

## Step 2: Backend Setup

```bash
# Navigate to backend
cd backend

# Install dependencies
npm install

# Create .env file
echo "PORT=5000" > .env
echo "GEMINI_API_KEY=your_api_key_here" >> .env

# Edit .env and replace 'your_api_key_here' with your actual API key

# Start backend
npm run dev
```

✅ Backend running on http://localhost:5000

## Step 3: Frontend Setup

Open a **new terminal**:

```bash
# Navigate to frontend
cd frontend

# Install dependencies
npm install

# Start frontend
npm start
```

✅ Frontend running on http://localhost:3000

## Step 4: Test with Sample Files

1. Browser will automatically open at http://localhost:3000
2. Upload files from `sample-files/` folder:
   - `sample.json`
   - `sample-metadata.xlsx`
3. Click "Generate Input Fields"
4. View your AI-generated fields!

## Troubleshooting

**Backend won't start?**
- Make sure `.env` file has valid GEMINI_API_KEY
- Check if port 5000 is available

**Frontend shows connection error?**
- Ensure backend is running
- Check backend logs for errors

**Need help?**
- Read the full README.md
- Check backend/README.md for API details
- Check frontend/README.md for component details

---

🎉 **You're all set!** Now you can upload your own JSON and Excel files.
