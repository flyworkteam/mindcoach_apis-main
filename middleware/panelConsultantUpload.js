/**
 * Panel rehber formu — mainPhoto, detailPhoto, riveFile
 */

const multer = require('multer');
const path = require('path');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg']);
const RIVE_EXT = new Set(['.riv']);

const storage = multer.memoryStorage();

function panelConsultantFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const field = file.fieldname;

  if (field === 'mainPhoto' || field === 'detailPhoto') {
    if (IMAGE_EXT.has(ext)) return cb(null, true);
    return cb(
      new Error('Ana ve detay fotoğraf için yalnızca PNG veya JPG kullanın.')
    );
  }

  if (field === 'riveFile') {
    if (RIVE_EXT.has(ext)) return cb(null, true);
    return cb(new Error('Rive dosyası .riv uzantılı olmalı.'));
  }

  return cb(new Error(`Bilinmeyen dosya alanı: ${field}`));
}

const panelConsultantUpload = multer({
  storage,
  fileFilter: panelConsultantFileFilter,
  limits: { fileSize: 80 * 1024 * 1024 },
}).fields([
  { name: 'mainPhoto', maxCount: 1 },
  { name: 'detailPhoto', maxCount: 1 },
  { name: 'riveFile', maxCount: 1 },
]);

function maybePanelConsultantUpload(req, res, next) {
  if (!req.is('multipart/form-data')) return next();
  return panelConsultantUpload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'Dosya boyutu limiti aşıldı (max 80MB).',
      });
    }
    return res.status(400).json({
      success: false,
      error: err.message || 'Yükleme hatası.',
    });
  });
}

module.exports = {
  panelConsultantUpload,
  maybePanelConsultantUpload,
};
