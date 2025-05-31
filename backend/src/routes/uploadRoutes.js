const express = require('express');
const router = express.Router();
const { upload } = require('../config/multer');

// Image upload endpoint
router.post('/', upload.array('images', 5), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No images uploaded' });
  }
  // Return URLs for uploaded images
  const urls = req.files.map(f => `/uploads/${f.filename}`);
  res.json({ urls });
});

module.exports = router; 