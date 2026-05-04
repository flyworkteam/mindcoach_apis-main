/**
 * Voice Chat Server — hızlı, barge-in destekli sesli AI sohbeti
 *
 * Pipeline:
 *   Flutter PCM16 → sessizlik algıla → WAV → ElevenLabs Scribe STT
 *   → n8n premium webhook → ElevenLabs TTS
 *   → binary WS chunks → Flutter
 *
 * Barge-in:
 *   VIDEO modu: Yalnızca Flutter'dan gelen barge_in_request JSON mesajı
 *               (echo-aware, sunucu ses chunk'ından barge-in YAPMIYOR)
 *   VOICE modu: Hem sunucu audio-RMS hem Flutter barge_in JSON
 *
 * Ses formatı:
 *   VIDEO (sampleRate=24000): ElevenLabs pcm_24000 → ham PCM16 → flutter_pcm_sound
 *   VOICE (sampleRate=16000): ElevenLabs mp3 → audioplayers
 */

'use strict';

const WebSocket = require('ws');
const jwt       = require('jsonwebtoken');
const axios     = require('axios');
const FormData  = require('form-data');

const UserService        = require('../services/userService');
const TokenRepository    = require('../repositories/TokenRepository');
const ConsultantService  = require('../services/consultantService');
const AppointmentService = require('../services/appointmentService');
const ChatService        = require('../services/chatService');
const MessageRepository  = require('../repositories/MessageRepository');
const ChatRepository     = require('../repositories/ChatRepository');
const AudioProcessor     = require('./audioProcessor');

// ── sabitler ──────────────────────────────────────────────────────────────────
const PREMIUM_WEBHOOK_URL =
  process.env.PREMIUM_WEBHOOK_URL ||
  'https://n8n.srv1548849.hstgr.cloud/webhook/premium-conversation';

const SILENCE_THRESHOLD   = 0.005;
const SILENCE_DURATION_MS = 700;

// TTS modeli — eleven_flash_v2_5 en düşük gecikmeli
const TTS_MODEL      = process.env.ELEVENLABS_VOICE_CHAT_MODEL || 'eleven_flash_v2_5';
const TTS_CHUNK_SIZE = 4096;

// ── WAV başlığı ───────────────────────────────────────────────────────────────
function pcm16ToWav(pcm, sr, ch = 1) {
  const byteRate   = sr * ch * 2;
  const blockAlign = ch * 2;
  const buf        = Buffer.alloc(44 + pcm.length);
  buf.write('RIFF',  0, 'ascii'); buf.writeUInt32LE(36 + pcm.length, 4);
  buf.write('WAVE',  8, 'ascii'); buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);      buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22);      buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(byteRate, 28); buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii'); buf.writeUInt32LE(pcm.length, 40);
  pcm.copy(buf, 44);
  return buf;
}

// ── sunucu ────────────────────────────────────────────────────────────────────
class VoiceChatServer {
  constructor(port = 3001) {
    this.port = port;
    this.wss  = null;
    this.connections = new Map();
  }

  start() {
    this.wss = new WebSocket.Server({ port: this.port, perMessageDeflate: false });
    console.log(`[VOICE-CHAT] 🚀 Voice Chat WebSocket Server started on port ${this.port}`);
    console.log(`[VOICE-CHAT] ⚡ TTS model: ${TTS_MODEL} | Silence: ${SILENCE_DURATION_MS}ms`);

    this.wss.on('connection', (ws, req) => {
      this._handleConnection(ws, req).catch(err =>
        console.error('[VOICE-CHAT] ❌ Unhandled connection error:', err)
      );
    });

    process.on('SIGINT', () => this.stop());
  }

  stop() {
    this.wss?.close(() => console.log('[VOICE-CHAT] ✅ Server stopped'));
  }

  // ── bağlantı kurma ───────────────────────────────────────────────────────────

  async _handleConnection(ws, req) {
    let connectionId = null;
    try {
      const auth = await this._authenticate(req);
      if (!auth.success) { ws.close(1008, auth.error); return; }

      const { userId, consultantId, sampleRate, isVideoMode } = auth;
      connectionId = `${userId}_${consultantId}_${Date.now()}`;
      console.log(`[VOICE-CHAT] ✅ Auth OK — User:${userId} Consultant:${consultantId} sampleRate:${sampleRate} videoMode:${isVideoMode}`);

      const consultant = await ConsultantService.getConsultantById(consultantId);
      if (!consultant)         { ws.close(1008, 'Consultant not found'); return; }
      if (!consultant.voiceId) { ws.close(1008, 'Consultant voice not configured'); return; }

      const user = await UserService.getUserById(userId);

      let chatId = null;
      try {
        const chat = await ChatService.getOrCreateChat(userId, consultantId);
        chatId = chat.chatId;
      } catch (e) {
        console.warn('[VOICE-CHAT] ⚠️ getOrCreateChat failed:', e.message);
      }

      const systemPromptP = this._buildSystemPrompt(consultant, user, userId, consultantId);

      const state = {
        userId, consultantId, chatId, user, consultant,
        systemPrompt: '',
        sampleRate,         // 16000 (voice) veya 24000 (video)
        isVideoMode,        // true → PCM16 çıktı, false → MP3 çıktı
        // ses tamponu
        audioChunks: [],
        isUserSpeaking: false,
        lastSpeechTime: null,
        silenceTimer: null,
        // AI durumu
        isAISpeaking: false,
        waitingForClientPlayback: false,
        abortAI: false,
        processing: false,
      };
      this.connections.set(connectionId, state);

      systemPromptP.then(p => { state.systemPrompt = p; }).catch(() => {});

      this._send(ws, { type: 'connection_success', connectionId, consultantId });
      console.log(`[VOICE-CHAT] ✅ Connection ready: ${connectionId}`);

      // Karşılama
      this._sendGreeting(connectionId, ws).catch(e =>
        console.error('[VOICE-CHAT] ❌ Greeting error:', e.message)
      );

      ws.on('message', async (data) => {
        try {
          if (Buffer.isBuffer(data)) {
            await this._onAudioChunk(connectionId, data, ws);
          } else {
            const msg = JSON.parse(data.toString());
            await this._onJsonMessage(connectionId, msg, ws);
          }
        } catch (e) {
          console.error(`[VOICE-CHAT] ❌ Message error [${connectionId}]:`, e.message);
        }
      });

      ws.on('close', () => { console.log(`[VOICE-CHAT] 🔌 Disconnected: ${connectionId}`); this._cleanup(connectionId); });
      ws.on('error', (e) => { console.error(`[VOICE-CHAT] ❌ WS error [${connectionId}]:`, e.message); this._cleanup(connectionId); });

    } catch (err) {
      console.error('[VOICE-CHAT] ❌ Fatal connection setup error:', err);
      if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'Internal error');
      if (connectionId) this._cleanup(connectionId);
    }
  }

  // ── JSON mesajları ────────────────────────────────────────────────────────────

  async _onJsonMessage(connectionId, msg, ws) {
    const state = this.connections.get(connectionId);
    if (!state) return;

    switch (msg.type) {
      case 'ping':
        this._send(ws, { type: 'pong' });
        break;

      // Flutter sesi normal bitirdi (her iki moddan da gelebilir)
      case 'audio_done':      // voice_call_view gönderir
      case 'playback_done':   // video_call_realtime_screen gönderir
        console.log(`[VOICE-CHAT] ✅ [${connectionId}] Playback done (${msg.type})`);
        state.waitingForClientPlayback = false;
        state.processing = false;
        state.isAISpeaking = false;
        break;

      // Flutter barge-in algıladı (her iki moddan da gelebilir)
      case 'barge_in':          // voice_call_view
      case 'barge_in_request':  // video_call_realtime_screen
        console.log(`[VOICE-CHAT] ⚡ [${connectionId}] Barge-in from Flutter (${msg.type})`);
        state.abortAI = true;
        state.isAISpeaking = false;
        state.waitingForClientPlayback = false;
        state.processing = false;
        this._send(ws, { type: 'barge_in' }); // her iki Flutter'ın da beklediği mesaj
        break;

      default:
        break;
    }
  }

  // ── ses chunk'ı işle ──────────────────────────────────────────────────────────

  async _onAudioChunk(connectionId, chunk, ws) {
    const state = this.connections.get(connectionId);
    if (!state) return;

    const { isSilent } = AudioProcessor.processAudioChunk(chunk, SILENCE_THRESHOLD);
    if (isSilent) return;

    // ── Sunucu-taraflı barge-in (YALNIZCA voice modunda)
    // Video modunda Flutter kendi akıllı echo-aware barge-in algılamasını yapıyor
    // Sunucu bunu yapsa echo'yu barge-in sanır → yapay zeka kendi sesini keser
    if (!state.isVideoMode &&
        (state.isAISpeaking || state.waitingForClientPlayback) &&
        !state.abortAI) {
      console.log(`[VOICE-CHAT] ⚡ Server-side barge-in [${connectionId}]`);
      state.abortAI = true;
      state.isAISpeaking = false;
      state.waitingForClientPlayback = false;
      state.processing = false;
      this._send(ws, { type: 'barge_in' });
    }

    // Ses biriktir (zaten işlem varsa atla)
    if (state.processing || state.waitingForClientPlayback) return;

    state.audioChunks.push(chunk);
    state.isUserSpeaking = true;
    state.lastSpeechTime = Date.now();

    if (state.silenceTimer) { clearTimeout(state.silenceTimer); state.silenceTimer = null; }
    state.silenceTimer = setTimeout(
      () => this._onSilence(connectionId, ws),
      SILENCE_DURATION_MS
    );
  }

  // ── sessizlik → pipeline ──────────────────────────────────────────────────────

  async _onSilence(connectionId, ws) {
    const state = this.connections.get(connectionId);
    if (!state) return;
    state.silenceTimer = null;

    if (state.audioChunks.length === 0) return;
    if (state.processing || state.waitingForClientPlayback) {
      state.audioChunks = [];
      return;
    }

    const chunks = [...state.audioChunks];
    state.audioChunks = [];
    state.isUserSpeaking = false;
    state.processing = true;
    state.abortAI = false;

    console.log(`[VOICE-CHAT] 🔇 Silence [${connectionId}] — ${chunks.length} chunk | sr:${state.sampleRate}`);

    try {
      // 1. PCM → WAV (doğru sample rate ile)
      const pcm = Buffer.concat(chunks);
      const wav = pcm16ToWav(pcm, state.sampleRate, 1);

      // 2. STT
      this._send(ws, { type: 'processing_start' });
      const t0 = Date.now();
      const transcript = await this._stt(wav);
      console.log(`[VOICE-CHAT] 📝 STT ${Date.now()-t0}ms — "${transcript}"`);

      if (!transcript?.trim()) { state.processing = false; return; }

      this._send(ws, { type: 'transcript', text: transcript });
      await this._saveUserMessage(state, transcript);

      if (state.abortAI) { state.processing = false; return; }

      // 3. AI cevabı
      this._send(ws, { type: 'ai_thinking' });
      const t1 = Date.now();
      const aiText = await this._getAIResponse(state, transcript);
      console.log(`[VOICE-CHAT] 🤖 Webhook ${Date.now()-t1}ms — "${aiText?.substring(0,80)}"`);

      if (!aiText?.trim() || state.abortAI) { state.processing = false; return; }

      await this._saveAIMessage(state, aiText);

      // 4. TTS
      const t2 = Date.now();
      const audioBuffer = await this._tts(aiText, state.consultant.voiceId, state.isVideoMode);
      console.log(`[VOICE-CHAT] 🔊 TTS ${Date.now()-t2}ms — ${audioBuffer.length}B (${state.isVideoMode ? 'PCM24k' : 'MP3'})`);

      if (state.abortAI) {
        state.isAISpeaking = false; state.processing = false;
        this._send(ws, { type: 'ai_response_interrupted' });
        return;
      }

      // 5. Ses chunk'larını Flutter'a gönder
      state.isAISpeaking = true;
      this._send(ws, { type: 'ai_speaking_start' });

      for (let offset = 0; offset < audioBuffer.length; offset += TTS_CHUNK_SIZE) {
        if (state.abortAI || ws.readyState !== WebSocket.OPEN) {
          this._send(ws, { type: 'ai_response_interrupted' });
          state.isAISpeaking = false; state.processing = false;
          return;
        }
        ws.send(audioBuffer.slice(offset, Math.min(offset + TTS_CHUNK_SIZE, audioBuffer.length)), { binary: true });
      }

      if (!state.abortAI && ws.readyState === WebSocket.OPEN) {
        this._send(ws, { type: 'ai_response_complete' });
      }

      // Flutter çalıyor — playback_done / audio_done bekliyoruz
      state.isAISpeaking = false;
      state.waitingForClientPlayback = true;
      // processing = true kalır

    } catch (err) {
      console.error(`[VOICE-CHAT] ❌ Pipeline error [${connectionId}]:`, err.message);
      state.processing = false; state.isAISpeaking = false; state.waitingForClientPlayback = false;
      if (ws.readyState === WebSocket.OPEN)
        this._send(ws, { type: 'error', error: err.message });
    }
  }

  // ── karşılama ─────────────────────────────────────────────────────────────────

  async _sendGreeting(connectionId, ws) {
    const state = this.connections.get(connectionId);
    if (!state) return;
    state.processing = true;

    try {
      const { consultant, user, chatId, userId, consultantId, isVideoMode } = state;
      const userName       = user?.username || '';
      const consultantName = consultant.names?.tr || consultant.names?.en ||
        Object.values(consultant.names || {})[0] || 'Koç';

      let greetingText = '';
      try {
        const resp = await axios.post(PREMIUM_WEBHOOK_URL, {
          id: consultantId, chatId,
          nativeLang: user?.nativeLang || 'tr',
          message: '__GREETING__', messageType: 'text',
          userInfo: {
            username: userName,
            phycoProfile: user?.generalProfile || user?.generalPsychologicalProfile || null,
            chatHistory: [], aiComments: user?.userAgentNotes || [],
            isGreeting: true,
          },
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
        const d = resp.data;
        const item = Array.isArray(d) ? d[0] : d;
        greetingText = item?.message || item?.text || item?.response || '';
      } catch (e) {
        console.warn('[VOICE-CHAT] ⚠️ Greeting webhook failed:', e.message);
      }

      if (!greetingText)
        greetingText = `Merhaba${userName ? ' ' + userName : ''}! Ben ${consultantName}. Bugün sana nasıl yardımcı olabilirim?`;

      console.log(`[VOICE-CHAT] 👋 [${connectionId}] Greeting: "${greetingText.substring(0,80)}"`);

      const audioBuffer = await this._tts(greetingText, consultant.voiceId, isVideoMode);
      state.isAISpeaking = true;
      this._send(ws, { type: 'ai_speaking_start' });

      for (let offset = 0; offset < audioBuffer.length; offset += TTS_CHUNK_SIZE) {
        if (state.abortAI || ws.readyState !== WebSocket.OPEN) break;
        ws.send(audioBuffer.slice(offset, Math.min(offset + TTS_CHUNK_SIZE, audioBuffer.length)), { binary: true });
      }

      if (!state.abortAI && ws.readyState === WebSocket.OPEN)
        this._send(ws, { type: 'ai_response_complete' });

      state.isAISpeaking = false;
      state.waitingForClientPlayback = true;

    } catch (err) {
      console.error(`[VOICE-CHAT] ❌ Greeting error [${connectionId}]:`, err.message);
      const s = this.connections.get(connectionId);
      if (s) { s.isAISpeaking = false; s.processing = false; s.waitingForClientPlayback = false; }
    }
  }

  // ── ElevenLabs STT ────────────────────────────────────────────────────────────

  async _stt(wavBuffer) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');

    const form = new FormData();
    form.append('file', wavBuffer, { filename: 'audio.wav', contentType: 'audio/wav' });
    form.append('model_id', 'scribe_v1');

    const resp = await axios.post('https://api.elevenlabs.io/v1/speech-to-text', form, {
      headers: { 'xi-api-key': apiKey, ...form.getHeaders() },
      timeout: 20000,
    });
    return resp.data?.text || resp.data?.transcript || '';
  }

  // ── n8n webhook ───────────────────────────────────────────────────────────────

  async _getAIResponse(state, userMessage) {
    let chatHistory = [];
    try {
      if (state.chatId) chatHistory = await MessageRepository.getChatHistory(state.chatId, 20);
    } catch (_) {}

    let upcomingAppointment = null;
    try { upcomingAppointment = await AppointmentService.getUpcomingAppointmentByUserId(state.userId); } catch (_) {}

    const resp = await axios.post(PREMIUM_WEBHOOK_URL, {
      id: state.consultantId, chatId: state.chatId,
      nativeLang: state.user?.nativeLang || 'tr',
      message: userMessage, messageType: 'voice',
      upcomingAppointment: upcomingAppointment
        ? { appointmentId: upcomingAppointment.id, date: upcomingAppointment.appointmentDate,
            status: upcomingAppointment.status, consultantId: upcomingAppointment.consultantId }
        : null,
      userInfo: {
        username: state.user?.username,
        phycoProfile: state.user?.generalProfile || state.user?.generalPsychologicalProfile || null,
        chatHistory, aiComments: state.user?.userAgentNotes || [],
      },
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 45000 });

    const d = resp.data;
    const item = Array.isArray(d) ? d[0] : d;
    return item?.message || item?.text || item?.response || '';
  }

  // ── ElevenLabs TTS ────────────────────────────────────────────────────────────
  // isVideoMode=true  → pcm_24000 (ham PCM16, flutter_pcm_sound için)
  // isVideoMode=false → mp3      (audioplayers için)

  async _tts(text, voiceId, isVideoMode = false) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');

    const outputFormat = isVideoMode ? 'pcm_24000' : 'mp3_44100_128';

    const body = {
      text,
      model_id: TTS_MODEL,
      output_format: outputFormat,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
    };

    // PCM modunda Accept: audio/mpeg koyma
    const headers = { 'Content-Type': 'application/json', 'xi-api-key': apiKey };
    if (!isVideoMode) headers['Accept'] = 'audio/mpeg';

    const resp = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      body,
      { headers, responseType: 'arraybuffer', timeout: 30000 }
    );

    return Buffer.from(resp.data);
  }

  // ── DB ────────────────────────────────────────────────────────────────────────

  async _saveUserMessage(state, transcript) {
    if (!state.chatId) return;
    try {
      const now = new Date().toISOString();
      await MessageRepository.create(
        state.chatId, state.userId, 'user', transcript, now,
        false, null, true, null, null, transcript
      );
      await ChatRepository.updateLastMessage(state.chatId, transcript, now);
    } catch (e) { console.warn('[VOICE-CHAT] ⚠️ saveUserMessage:', e.message); }
  }

  async _saveAIMessage(state, aiText) {
    if (!state.chatId) return;
    try {
      const now = new Date().toISOString();
      await ChatService.createConsultantTextMessage(state.chatId, state.consultantId, aiText, now);
      await ChatRepository.updateLastMessage(state.chatId, aiText, now);
    } catch (e) { console.warn('[VOICE-CHAT] ⚠️ saveAIMessage:', e.message); }
  }

  // ── sistem prompt ─────────────────────────────────────────────────────────────

  async _buildSystemPrompt(consultant, user, userId, consultantId) {
    let chatHistoryText = '';
    try {
      const chat = await ChatRepository.findByUserAndConsultant(userId, consultantId);
      if (chat) {
        const history = await MessageRepository.getChatHistory(chat.chatId, 30);
        if (history?.length) {
          chatHistoryText = '\n\n--- Önceki Sohbet ---\n' +
            history.map(m => `${m.sender === 'user' ? 'Kullanıcı' : 'Sen'}: ${m.voiceContent || m.message || '[ses]'}`).join('\n') +
            '\n--- Son ---\n';
        }
      }
    } catch (_) {}

    let appointmentText = '';
    try {
      const appt = await AppointmentService.getUpcomingAppointmentByUserId(userId);
      appointmentText = appt
        ? `\n\nKullanıcının randevusu var (${new Date(appt.appointmentDate).toLocaleString('tr-TR')}). Yeni randevu ÖNERME.`
        : '\n\nKullanıcının aktif randevusu yok.';
    } catch (_) {}

    let userProfileText = '';
    if (user?.username) userProfileText += `\nKullanıcı adı: ${user.username}`;
    const profile = user?.generalProfile || user?.generalPsychologicalProfile;
    if (profile) userProfileText += `\nProfil: ${typeof profile === 'string' ? profile : JSON.stringify(profile)}`;

    return (consultant.mainPrompt || 'Sen yardımcı bir AI asistanısın.') + userProfileText + appointmentText + chatHistoryText;
  }

  // ── kimlik doğrulama ──────────────────────────────────────────────────────────

  async _authenticate(req) {
    try {
      const url   = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get('token') || req.headers.authorization?.replace('Bearer ', '');
      if (!token) return { success: false, error: 'No token' };

      let decoded;
      try { decoded = jwt.verify(token, process.env.JWT_SECRET); }
      catch (_) { return { success: false, error: 'Invalid token' }; }

      if (!await TokenRepository.isValid(token)) return { success: false, error: 'Token revoked' };

      const cid = parseInt(url.searchParams.get('consultantId'), 10);
      if (!cid || cid <= 0) return { success: false, error: 'Invalid consultantId' };

      // sampleRate → video mi voice mi?
      const sampleRate  = parseInt(url.searchParams.get('sampleRate'), 10) || 16000;
      const isVideoMode = sampleRate === 24000;

      return { success: true, userId: decoded.userId, consultantId: cid, sampleRate, isVideoMode };
    } catch (e) {
      return { success: false, error: 'Auth failed' };
    }
  }

  // ── yardımcılar ───────────────────────────────────────────────────────────────

  _send(ws, obj) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  _cleanup(connectionId) {
    const state = this.connections.get(connectionId);
    if (state) {
      if (state.silenceTimer) clearTimeout(state.silenceTimer);
      state.abortAI = true;
      this.connections.delete(connectionId);
    }
  }
}

module.exports = VoiceChatServer;
