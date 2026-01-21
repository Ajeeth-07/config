const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { processFiles } = require('../services/aiAgent');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /json|xlsx|xls/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || 
                     file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                     file.mimetype === 'application/vnd.ms-excel' ||
                     file.mimetype === 'application/json';
    
    if (extname || mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Only JSON and Excel files are allowed!'));
    }
  }
});

// Upload and process files - returns Excel file
router.post('/process', upload.fields([
  { name: 'jsonFile', maxCount: 1 },
  { name: 'excelFile', maxCount: 1 }
]), async (req, res) => {
  try {
    if (!req.files.jsonFile || !req.files.excelFile) {
      return res.status(400).json({ 
        error: 'Both JSON and Excel files are required' 
      });
    }

    const jsonFilePath = req.files.jsonFile[0].path;
    const excelFilePath = req.files.excelFile[0].path;

    // Process files with AI agent
    const result = await processFiles(jsonFilePath, excelFilePath);

    // Clean up uploaded files
    fs.unlinkSync(jsonFilePath);
    fs.unlinkSync(excelFilePath);

    res.json(result);
  } catch (error) {
    console.error('Error processing files:', error);
    
    // Clean up files on error
    if (req.files && req.files.jsonFile) {
      try { fs.unlinkSync(req.files.jsonFile[0].path); } catch (e) {}
    }
    if (req.files && req.files.excelFile) {
      try { fs.unlinkSync(req.files.excelFile[0].path); } catch (e) {}
    }
    
    res.status(500).json({ 
      error: error.message || 'Failed to process files' 
    });
  }
});

// Download generated Excel file
router.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, '..', 'outputs', filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  
  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);
  
  // Clean up file after download (optional - you can remove this if you want to keep files)
  fileStream.on('end', () => {
    setTimeout(() => {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }, 5000);
  });
});

module.exports = router;
