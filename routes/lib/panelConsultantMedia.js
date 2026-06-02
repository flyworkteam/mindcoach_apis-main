/**
 * Panel rehber medya yükleme — Bunny CDN sabit path'ler.
 * images/c_{code}.png, images/c_{code}_detail.png, {Female|Male} Riv/{code}.riv
 */

const BunnyCDNService = require('../../services/bunnyCDNService');

const CDN_BASE = process.env.BUNNY_CDN_PUBLIC_BASE || 'https://mindcoach.b-cdn.net';
const FEMALE_RIV_DIR = 'Female Riv';
const MALE_RIV_DIR = 'Male Riv';

function normalizeMediaCode(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (!s) return null;
  const slug = s
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!slug || !/^[a-z0-9_]+$/.test(slug)) return null;
  return slug;
}

function publicCdnUrl(storagePath) {
  return `${CDN_BASE.replace(/\/$/, '')}/${storagePath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')}`;
}

function resolveRiveFolder(roles) {
  const list = Array.isArray(roles) ? roles : [];
  if (list.includes('female')) return FEMALE_RIV_DIR;
  if (list.includes('male')) return MALE_RIV_DIR;
  return null;
}

function fileByField(files, field) {
  if (!files) return null;
  if (Array.isArray(files)) {
    return files.find((f) => f.fieldname === field) || null;
  }
  const entry = files[field];
  if (Array.isArray(entry)) return entry[0] || null;
  return entry || null;
}

function hasMediaFiles(files) {
  return Boolean(
    fileByField(files, 'mainPhoto') ||
      fileByField(files, 'detailPhoto') ||
      fileByField(files, 'riveFile')
  );
}

function parseJsonField(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parsePanelAgentBody(req) {
  let base = req.body?.payload;
  if (typeof base === 'string' && base.trim()) {
    base = parseJsonField(base, null);
    if (!base || typeof base !== 'object') {
      const err = new Error('payload geçerli JSON olmalı');
      err.statusCode = 400;
      throw err;
    }
  } else {
    base = { ...(req.body || {}) };
    delete base.payload;
    delete base.mediaCode;
    if (base.names != null) base.names = parseJsonField(base.names, base.names);
    if (base.features != null) {
      base.features = parseJsonField(base.features, base.features);
    }
    if (base.roles != null) {
      base.roles = parseJsonField(base.roles, base.roles);
    }
    if (typeof base.rating === 'string' && base.rating !== '') {
      base.rating = Number(base.rating);
    }
  }

  const mediaCode =
    normalizeMediaCode(req.body?.mediaCode) ||
    normalizeMediaCode(base?.mediaCode);

  return { ...base, mediaCode };
}

function panelPatchFromAgentBody(body) {
  const extras = {};
  if (body.mainPrompt !== undefined) extras.mainPrompt = body.mainPrompt;
  if (body.photoURL !== undefined) extras.photoURL = body.photoURL;
  if (body.voiceId !== undefined) extras.voiceId = body.voiceId;
  if (body.url3d !== undefined) extras.url3d = body.url3d;
  if (body.explanation !== undefined) extras.explanation = body.explanation;
  if (body.features !== undefined) extras.features = body.features;
  if (body.roles !== undefined) extras.roles = body.roles;
  if (body.rating !== undefined) extras.rating = body.rating;

  const patch = {};
  if (body.names !== undefined) patch.names = body.names;
  if (body.job !== undefined) patch.job = body.job;
  if (Object.keys(extras).length) patch.extras = extras;
  return patch;
}

async function processConsultantMediaUploads(files, body) {
  const updates = {};
  const mainPhoto = fileByField(files, 'mainPhoto');
  const detailPhoto = fileByField(files, 'detailPhoto');
  const riveFile = fileByField(files, 'riveFile');

  if (!hasMediaFiles(files)) return updates;

  const code =
    body.mediaCode ||
    normalizeMediaCode(body.names?.tr) ||
    normalizeMediaCode(body.names?.en);

  if (!code) {
    const err = new Error(
      'Medya yüklemesi için mediaCode gerekli (ör. air → c_air.png)'
    );
    err.statusCode = 400;
    throw err;
  }

  if (mainPhoto?.buffer?.length) {
    const storagePath = `images/c_${code}.png`;
    await BunnyCDNService.uploadToPath(
      mainPhoto.buffer,
      storagePath,
      mainPhoto.mimetype || 'image/png'
    );
    updates.photoURL = publicCdnUrl(storagePath);
  }

  if (detailPhoto?.buffer?.length) {
    const storagePath = `images/c_${code}_detail.png`;
    await BunnyCDNService.uploadToPath(
      detailPhoto.buffer,
      storagePath,
      detailPhoto.mimetype || 'image/png'
    );
  }

  if (riveFile?.buffer?.length) {
    const folder = resolveRiveFolder(body.roles);
    if (!folder) {
      const err = new Error(
        'Rive yüklemesi için cinsiyet (male veya female) seçilmeli'
      );
      err.statusCode = 400;
      throw err;
    }
    const storagePath = `${folder}/${code}.riv`;
    await BunnyCDNService.uploadToPath(
      riveFile.buffer,
      storagePath,
      riveFile.mimetype || 'application/octet-stream'
    );
    updates.url3d = publicCdnUrl(storagePath);
  }

  return updates;
}

function mediaCodeFromPhotoUrl(photoURL) {
  if (!photoURL || typeof photoURL !== 'string') return '';
  const match = photoURL.match(/\/c_([a-z0-9_]+)\.png$/i);
  return match ? match[1] : '';
}

module.exports = {
  CDN_BASE,
  FEMALE_RIV_DIR,
  MALE_RIV_DIR,
  normalizeMediaCode,
  publicCdnUrl,
  parsePanelAgentBody,
  panelPatchFromAgentBody,
  processConsultantMediaUploads,
  hasMediaFiles,
  mediaCodeFromPhotoUrl,
  resolveRiveFolder,
};
