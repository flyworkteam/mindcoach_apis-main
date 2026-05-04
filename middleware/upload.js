/**
 * Upload Middleware
 * Handles file uploads using multer
 */

const multer = require('multer');
const path = require('path');

// Configure multer for memory storage (we'll upload directly to CDN)
const storage = multer.memoryStorage();

// File filter
const fileFilter = (req, file, cb) => {
  // Accept images and audio files
  const allowedMimes = [
    // Images
    'image/jpeg',
    'image/jpg', // Some systems use this (non-standard but common)
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/x-png', // Alternative PNG MIME type
    'image/pjpeg', // Alternative JPEG MIME type
    // Audio
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav', // Alternative WAV MIME type
    'audio/wave', // Alternative WAV MIME type
    'audio/ogg',
    'audio/mp4',
    'audio/aac',
    'audio/m4a',
    'audio/x-m4a', // Alternative M4A MIME type
    'application/octet-stream' // Some systems send this, we'll check extension
  ];

  // Get file extension
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = {
    // Images
    '.jpg': true,
    '.jpeg': true,
    '.png': true,
    '.gif': true,
    '.webp': true,
    '.svg': true,
    // Audio
    '.mp3': true,
    '.wav': true,
    '.ogg': true,
    '.m4a': true,
    '.aac': true
  };

  // Check MIME type first
  if (allowedMimes.includes(file.mimetype)) {
    // If MIME type is application/octet-stream, check extension
    if (file.mimetype === 'application/octet-stream') {
      if (allowedExtensions[ext]) {
        cb(null, true);
      } else {
        cb(new Error(`Invalid file type. Allowed extensions: ${Object.keys(allowedExtensions).join(', ')}`), false);
      }
    } else {
      cb(null, true);
    }
  } else if (allowedExtensions[ext]) {
    // If MIME type is not recognized but extension is valid, allow it
    // This handles cases where MIME type might be incorrect
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Only images (jpg, jpeg, png, gif, webp, svg) and audio files (mp3, wav, ogg, m4a, aac) are allowed. Received: ${file.mimetype}, extension: ${ext}`), false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

module.exports = upload;

