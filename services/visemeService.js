'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');

const RHUBARB_BIN = process.env.RHUBARB_BIN || '/opt/rhubarb/rhubarb';
const ENABLE_RHUBARB = process.env.ENABLE_RHUBARB_VISEME === 'true';
const TEMP_DIR = path.join(os.tmpdir(), 'mindcoach-viseme');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Rhubarb -> Microsoft Viseme map
const RHUBARB_MAP = {
  A: 2, B: 8, C: 18, D: 1, E: 2, F: 11, G: 20, H: 1, I: 2, J: 18, K: 20,
  L: 12, M: 8, N: 1, O: 6, P: 8, Q: 20, R: 1, S: 15, T: 1, U: 7, V: 11,
  W: 7, X: 0, Y: 1, Z: 15,
};

function _q(p) {
  return `"${String(p).replace(/"/g, '\\"')}"`;
}

function execPromise(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(stderr || stdout || err.message || 'exec failed');
        return reject(e);
      }
      resolve({ stdout, stderr });
    });
  });
}

function _mapRhubarbToVisemes(raw) {
  const cues = Array.isArray(raw?.mouthCues) ? raw.mouthCues : [];
  return cues.map((cue) => ({
    id: RHUBARB_MAP[cue.value] ?? 0,
    time: Number(Number(cue.start || 0).toFixed(3)),
  }));
}

async function generateVisemesFromWavFile(wavPath) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const jsonPath = path.join(TEMP_DIR, `${id}.json`);
  try {
    await execPromise(
      `${_q(RHUBARB_BIN)} ${_q(wavPath)} -f json -o ${_q(jsonPath)}`
    );
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return _mapRhubarbToVisemes(raw);
  } finally {
    if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
  }
}

async function generateVisemesFromPcm24k(pcmBuffer, opts = {}) {
  if (!Buffer.isBuffer(pcmBuffer) || pcmBuffer.length < 2) return [];
  // Fast local fallback: no ffmpeg/rhubarb dependency required.
  if (!ENABLE_RHUBARB) {
    return generateEnergyVisemesFromPcm24k(pcmBuffer);
  }
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const pcmPath = path.join(TEMP_DIR, `${id}.pcm`);
  const wavPath = path.join(TEMP_DIR, `${id}.wav`);
  try {
    fs.writeFileSync(pcmPath, pcmBuffer);
    await execPromise(
      `ffmpeg -y -f s16le -ar 24000 -ac 1 -i ${_q(pcmPath)} -ac 1 -ar 16000 ${_q(wavPath)}`
    );
    return await generateVisemesFromWavFile(wavPath);
  } catch (err) {
    if (opts.connectionId) {
      console.warn(`[VISEME] [${opts.connectionId}] generation failed: ${err.message}`);
    } else {
      console.warn(`[VISEME] generation failed: ${err.message}`);
    }
    // If external tools are unavailable, degrade gracefully to local fallback.
    return generateEnergyVisemesFromPcm24k(pcmBuffer);
  } finally {
    if (fs.existsSync(pcmPath)) fs.unlinkSync(pcmPath);
    if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
  }
}

function generateEnergyVisemesFromPcm24k(pcmBuffer) {
  const bytesPerSample = 2;
  const totalSamples = Math.floor(pcmBuffer.length / bytesPerSample);
  if (totalSamples <= 0) return [];
  // Rhubarb kapalıyken energy fallback: pencereyi küçük tut ki saniyede
  // ~40+ viseme update olsun (client RMS ile uyumlu yoğun hareket).
  const windowMs = 22;
  const samplesPerWindow = Math.max(1, Math.floor((24000 * windowMs) / 1000));
  const result = [];
  let lastId = -1;
  for (let start = 0; start < totalSamples; start += samplesPerWindow) {
    const end = Math.min(totalSamples, start + samplesPerWindow);
    let sumSq = 0;
    let count = 0;
    for (let i = start; i < end; i++) {
      const s = pcmBuffer.readInt16LE(i * 2);
      sumSq += s * s;
      count++;
    }
    if (count === 0) continue;
    const rms = Math.sqrt(sumSq / count);
    // Eşikler düşürüldü ki düşük amplitüdlü heceler bile ağız değişimi
    // tetiklesin.
    let id = 0;
    if (rms > 600)  id = 2;
    if (rms > 1200) id = 6;
    if (rms > 2000) id = 7;
    if (rms > 3000) id = 8;
    if (rms > 4500) id = 15;
    // Aynı id arka arkaya geldiğinde araya kısa bir close (id=0) sok →
    // mouth flicker olsun, statik kalmasın.
    if (id !== 0 && id === lastId) {
      result.push({
        id: 0,
        time: Number(((start / 24000)).toFixed(3)),
      });
    }
    result.push({
      id,
      time: Number((((start + Math.floor(samplesPerWindow / 4)) / 24000)).toFixed(3)),
    });
    lastId = id;
  }
  return result;
}

async function generateVisemesFromAudioUrl(audioUrl) {
  if (!audioUrl) throw new Error('audioUrl is required');
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const inputPath = path.join(TEMP_DIR, `${id}.input`);
  const wavPath = path.join(TEMP_DIR, `${id}.wav`);
  try {
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error('Audio download failed');
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(inputPath, buffer);
    await execPromise(`ffmpeg -y -i ${_q(inputPath)} -ac 1 -ar 16000 ${_q(wavPath)}`);
    return await generateVisemesFromWavFile(wavPath);
  } finally {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
  }
}

module.exports = {
  generateVisemesFromWavFile,
  generateVisemesFromPcm24k,
  generateVisemesFromAudioUrl,
  generateEnergyVisemesFromPcm24k,
  RHUBARB_MAP,
};