const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Multer setup for image uploads
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    cb(null, base + '-' + Date.now() + ext);
  }
});

const imageFilter = (req, file, cb) => {
  if (!file.mimetype.match(/^image\/(png|jpeg|jpg|gif|webp)$/)) {
    return cb(new Error('Only image files are allowed!'), false);
  }
  cb(null, true);
};

const upload = multer({ 
  storage, 
  fileFilter: imageFilter, 
  limits: { 
    files: 5, 
    fileSize: 5 * 1024 * 1024 
  } 
});

module.exports = {
  upload,
  uploadDir
}; 