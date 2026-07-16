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
const { resolveRealtimeModel } = require('./realtimeModel');

class OpenAIRealtimeSession extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {string} opts.instructions  System instructions (includes chat history)
   * @param {string} [opts.language]    Response language code (e.g. "tr")
   * @param {number} [opts.temperature]
   * @param {string} [opts.model]
   * @param {Array}  [opts.tools]       Optional tools (function calling) for GA session
   */
  constructor(opts = {}) {
    super();
    this.apiKey = process.env.OPENAI_API_KEY;
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is not set');

    this.instructions = opts.instructions || 'You are a helpful AI assistant.';
    this.language = opts.language || 'tr';
    this.temperature = typeof opts.temperature === 'number' ? opts.temperature : 0.8;
    this.model = resolveRealtimeModel(opts.model);
    // Tools schema (function calling). Left null if the caller didn't
    // supply any — we simply omit the field from session.update in that case.
    this.tools = Array.isArray(opts.tools) && opts.tools.length ? opts.tools : null;

    this.ws = null;
    this.isReady = false;
    this.closed = false;
    this.currentResponseId = null;
    // Per-function-call argument accumulator: callId → { name, args, itemId }
    this._pendingFnCalls = new Map();
  }

  /** Open the WebSocket connection to OpenAI and send session.update */
  async connect() {
    const url = `wss://api.openai.com/v1/realtime?model=${this.model}`;
    console.log(`[OPENAI-RT] 🔌 Connecting — model=${this.model}`);

    // GA (General Availability) Realtime API: `OpenAI-Beta: realtime=v1`
    // header KALDIRILMALI. Beta shape 2026-05-12'de kapatıldı; header ya da
    // eski session alanları gönderilirse oturum `beta_api_shape_disabled`
    // (code=4000) ile anında kapanır.
    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
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

    // GA session.update shape. Beta alanları (`modalities`, `input_audio_format`,
    // `input_audio_transcription`, `temperature`) GA'da REDDEDİLİR ve varsa TÜM
    // update düşer. GA'da:
    //   • `session.type: 'realtime'` zorunlu
    //   • output modaliteleri `output_modalities`
    //   • ses girişi ayarları `audio.input.*` altında
    //   • `temperature` kaldırıldı
    // TTS harici (ElevenLabs) olduğundan yalnızca `text` çıkışı istiyoruz;
    // `audio.output`/`voice` gerekmiyor.
    const sessionUpdate = {
      type: 'session.update',
      session: {
        type: 'realtime',
        output_modalities: ['text'],
        instructions,
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription: { model: 'whisper-1' },
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
        },
      },
    };
    if (this.tools) {
      sessionUpdate.session.tools = this.tools;
      sessionUpdate.session.tool_choice = 'auto';
    }
    this._send(sessionUpdate);

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

        // ── Function calling (tools) ────────────────────────────────────
        // GA event shape:
        //   response.output_item.added        — output item may be a function_call
        //   response.function_call_arguments.delta  — streamed JSON args
        //   response.function_call_arguments.done   — final JSON args string
        case 'response.output_item.added': {
          const item = event.item || {};
          if (item.type === 'function_call' && item.call_id) {
            this._pendingFnCalls.set(item.call_id, {
              name: item.name || '',
              args: '',
              itemId: item.id || null,
            });
          }
          break;
        }

        case 'response.function_call_arguments.delta': {
          const callId = event.call_id;
          const bucket = this._pendingFnCalls.get(callId);
          if (bucket && typeof event.delta === 'string') {
            bucket.args += event.delta;
          }
          break;
        }

        case 'response.function_call_arguments.done': {
          const callId = event.call_id;
          const bucket = this._pendingFnCalls.get(callId) || {
            name: event.name || '',
            args: '',
            itemId: null,
          };
          const rawArgs = typeof event.arguments === 'string'
            ? event.arguments
            : bucket.args;
          this._pendingFnCalls.delete(callId);
          let parsed = {};
          try { parsed = rawArgs ? JSON.parse(rawArgs) : {}; }
          catch (_) { parsed = { __raw: rawArgs }; }
          this.emit('function_call', {
            callId,
            name: bucket.name || event.name || '',
            args: parsed,
            itemId: bucket.itemId,
          });
          break;
        }

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
    // GA content part tipleri: assistant → `output_text`, user → `input_text`
    // (beta'da assistant için `text` kullanılıyordu).
    this._send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role, // 'user' | 'assistant'
        content: [
          { type: role === 'assistant' ? 'output_text' : 'input_text', text },
        ],
      },
    });
  }

  /** Force-create a response (e.g. for greeting) */
  createResponse(overrideInstructions = null) {
    if (!this.isReady || this.closed) return;
    // GA: `modalities` → `output_modalities`.
    const msg = {
      type: 'response.create',
      response: { output_modalities: ['text'] },
    };
    if (overrideInstructions) msg.response.instructions = overrideInstructions;
    this._send(msg);
  }

  /**
   * Return the JSON result of a function call to the LLM and trigger a new
   * response. Use this in the `function_call` event handler after the app
   * has executed the requested action.
   *
   * @param {string} callId  The call_id from the function_call event.
   * @param {Object|string} output  Serializable output (will be JSON.stringify'd if not already a string).
   * @param {boolean} [createResponse=true]  Immediately request the LLM's follow-up response.
   */
  submitFunctionOutput(callId, output, createResponse = true) {
    if (!this.isReady || this.closed) return;
    if (!callId) return;
    const payload =
      typeof output === 'string' ? output : JSON.stringify(output ?? {});
    this._send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: payload,
      },
    });
    if (createResponse) {
      this._send({
        type: 'response.create',
        response: { output_modalities: ['text'] },
      });
    }
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
