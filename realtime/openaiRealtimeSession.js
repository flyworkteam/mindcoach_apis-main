/**
 * OpenAI Realtime Session (per-connection)
 *
 * Hybrid mode: we use OpenAI Realtime ONLY for:
 *   - Server-side VAD (low latency turn detection)
 *   - Input audio transcription (Whisper)
 *   - LLM text output (streamed as text.delta)
 *
 * TTS is handled externally by ElevenLabs WS streaming for
 * per-consultant custom voices.
 */

'use strict';

const WebSocket = require('ws');
const EventEmitter = require('events');

const DEFAULT_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-mini-realtime-preview';

class OpenAIRealtimeSession extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {string} opts.instructions  System instructions (includes chat history)
   * @param {string} [opts.language]    Response language code (e.g. "tr")
   * @param {number} [opts.temperature]
   * @param {string} [opts.model]
   */
  constructor(opts = {}) {
    super();
    this.apiKey = process.env.OPENAI_API_KEY;
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is not set');

    this.instructions = opts.instructions || 'You are a helpful AI assistant.';
    this.language = opts.language || 'tr';
    this.temperature = typeof opts.temperature === 'number' ? opts.temperature : 0.8;
    this.model = opts.model || DEFAULT_MODEL;

    this.ws = null;
    this.isReady = false;
    this.closed = false;
    this.currentResponseId = null;
  }

  /** Open the WebSocket connection to OpenAI and send session.update */
  async connect() {
    const url = `wss://api.openai.com/v1/realtime?model=${this.model}`;
    console.log(`[OPENAI-RT] 🔌 Connecting — model=${this.model}`);

    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    await new Promise((resolve, reject) => {
      const onOpen = () => {
        this.ws.off('error', onErr);
        resolve();
      };
      const onErr = (err) => {
        this.ws.off('open', onOpen);
        reject(err);
      };
      this.ws.once('open', onOpen);
      this.ws.once('error', onErr);
      setTimeout(() => {
        if (this.ws.readyState !== WebSocket.OPEN) reject(new Error('OpenAI connect timeout'));
      }, 10000);
    });

    this._attachHandlers();

    // Language handling: auto-detect from the user's audio and mirror it.
    // Never switch to a different language mid-conversation on your own.
    // `this.language` is only used as a fallback (initial greeting) when
    // we haven't yet heard any user speech.
    const LANG_NAMES = {
      tr: 'Turkish', en: 'English', de: 'German', es: 'Spanish',
      fr: 'French', it: 'Italian', pt: 'Portuguese', ru: 'Russian',
      ja: 'Japanese', ko: 'Korean', zh: 'Chinese', hi: 'Hindi',
      ar: 'Arabic',
    };
    const defaultLanguage = LANG_NAMES[this.language] || this.language;

    const instructions = `${this.instructions}

LANGUAGE RULES (very important):
- Always respond in the exact same language the user is speaking right now.
- If you haven't heard the user yet, OR cannot clearly identify their language, you MUST respond in ${defaultLanguage} (code: ${this.language}).
- Never switch to another language unless the user does it first.
- Never mix languages in the same sentence.

TONE:
- This is a real phone call — keep replies natural, warm, conversational and concise.
- Avoid long monologues; one or two short sentences at a time.`;

    this._send({
      type: 'session.update',
      session: {
        modalities: ['text'],
        instructions,
        temperature: this.temperature,
        input_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.7,
          prefix_padding_ms: 200,
          silence_duration_ms: 600,
          // Critical: we want to verify the transcript is NOT an echo of our
          // own TTS output before killing the AI response. So we disable
          // automatic interruption and automatic response creation — the
          // server layer (voiceChatServerV2) decides manually after it has
          // seen the full transcript.
          create_response: false,
          interrupt_response: false,
        },
      },
    });

    console.log(`[OPENAI-RT] ✅ Connected & configured`);
    this.isReady = true;
  }

  /** Wire up raw WebSocket events to typed emitter events */
  _attachHandlers() {
    this.ws.on('message', (raw) => {
      let event;
      try {
        event = JSON.parse(raw.toString());
      } catch (e) {
        console.warn('[OPENAI-RT] ⚠️ Non-JSON message received');
        return;
      }

      switch (event.type) {
        case 'session.created':
        case 'session.updated':
          break;

        case 'input_audio_buffer.speech_started':
          // User started speaking — critical for barge-in
          this.emit('user_speech_started', event);
          break;

        case 'input_audio_buffer.speech_stopped':
          this.emit('user_speech_stopped', event);
          break;

        case 'conversation.item.input_audio_transcription.completed':
          this.emit('user_transcript', {
            itemId: event.item_id,
            transcript: event.transcript || '',
          });
          break;

        case 'response.created':
          this.currentResponseId = event.response?.id || null;
          this.emit('response_created', event);
          break;

        case 'response.text.delta':
        case 'response.output_text.delta':
          if (event.delta) this.emit('text_delta', { delta: event.delta });
          break;

        case 'response.text.done':
        case 'response.output_text.done':
          this.emit('text_done', { text: event.text || '' });
          break;

        case 'response.done':
          this.currentResponseId = null;
          this.emit('response_done', event);
          break;

        case 'response.cancelled':
          this.currentResponseId = null;
          this.emit('response_cancelled', event);
          break;

        case 'error': {
          const code = event?.error?.code;
          const param = event?.error?.param;
          // Benign race: we asked to cancel but response already ended. Ignore quietly.
          if (code === 'response_cancel_not_active') {
            this.currentResponseId = null;
            break;
          }
          // Invalid audio chunk rejected by OpenAI — the buffer is unusable,
          // but the session itself is fine. Clear the buffer and keep going
          // (do NOT propagate to the app as a fatal error; otherwise the
          // Flutter client ends the call and the user sees a broken UX).
          if (
            code === 'invalid_value' &&
            (param === 'audio.audio' || param === 'audio')
          ) {
            console.warn('[OPENAI-RT] ⚠️ Invalid audio chunk — clearing input buffer');
            try {
              this._send({ type: 'input_audio_buffer.clear' });
            } catch (_) {}
            break;
          }
          console.error('[OPENAI-RT] ❌ API error:', JSON.stringify(event));
          this.emit('api_error', event);
          break;
        }

        default:
          // Ignore: response.output_item.added, response.content_part.*, rate_limits.updated, etc.
          break;
      }
    });

    this.ws.on('error', (err) => {
      console.error('[OPENAI-RT] ❌ WebSocket error:', err.message);
      this.emit('ws_error', err);
    });

    this.ws.on('close', (code, reason) => {
      this.closed = true;
      this.isReady = false;
      console.log(`[OPENAI-RT] 🔌 Closed — code=${code} reason=${reason?.toString()}`);
      this.emit('closed', { code, reason: reason?.toString() });
    });
  }

  /** Append PCM16 chunk to input audio buffer */
  appendAudio(pcmBuffer) {
    if (!this.isReady || this.closed) return;
    // Guard against empty / odd-sized / non-buffer inputs — OpenAI will
    // reject the event with `invalid_value` otherwise and drop the whole
    // realtime session.
    if (!Buffer.isBuffer(pcmBuffer)) return;
    if (pcmBuffer.length === 0) return;
    if (pcmBuffer.length % 2 !== 0) return; // PCM16 must be even-byte
    const base64 = pcmBuffer.toString('base64');
    if (!base64) return;
    this._send({ type: 'input_audio_buffer.append', audio: base64 });
  }

  /** Add a prior message (for history injection) — called BEFORE any response */
  addHistoryMessage(role, text) {
    if (!this.isReady || this.closed) return;
    if (!text || !text.trim()) return;
    this._send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role, // 'user' | 'assistant'
        content: [{ type: role === 'assistant' ? 'text' : 'input_text', text }],
      },
    });
  }

  /** Force-create a response (e.g. for greeting) */
  createResponse(overrideInstructions = null) {
    if (!this.isReady || this.closed) return;
    const msg = { type: 'response.create', response: { modalities: ['text'] } };
    if (overrideInstructions) msg.response.instructions = overrideInstructions;
    this._send(msg);
  }

  /** Cancel an in-flight response (for barge-in). No-op if no active response. */
  cancelResponse() {
    if (!this.ws || this.closed) return;
    if (this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.currentResponseId) return; // nothing to cancel → avoid OpenAI "response_cancel_not_active" error
    this._send({ type: 'response.cancel' });
  }

  close() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.close(); } catch (_) {}
    }
    this.closed = true;
    this.isReady = false;
    this.removeAllListeners();
  }

  _send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(obj));
    } catch (e) {
      console.error('[OPENAI-RT] ❌ send error:', e.message);
    }
  }
}

module.exports = OpenAIRealtimeSession;
