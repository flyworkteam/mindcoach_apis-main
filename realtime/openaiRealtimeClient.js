/**
 * OpenAI Realtime API Client
 * Handles real-time communication with OpenAI Realtime API via WebSocket
 * Supports streaming audio input and text output
 * 
 * Note: OpenAI Realtime API uses WebSocket connection
 * Documentation: https://platform.openai.com/docs/guides/realtime
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const axios = require('axios');

class OpenAIRealtimeClient extends EventEmitter {
  constructor() {
    super();
    this.apiKey = process.env.OPENAI_API_KEY;
    this.baseUrl = 'wss://api.openai.com/v1/realtime';

    if (!this.apiKey) {
      console.warn('⚠️  OPENAI_API_KEY not set. OpenAI Realtime API will not function.');
    }
  }

  /**
   * Create a new Realtime API session
   * @param {Object} options - Session options
   * @param {string} options.model - Model to use (default: 'gpt-4o-realtime-preview-2024-10-01')
   * @param {string} options.voice - Voice to use (default: 'alloy')
   * @param {number} options.temperature - Temperature (default: 1.0)
   * @param {Array} options.modalities - Modalities (default: ['text'])
   * @param {string} options.instructions - System instructions
   * @param {string} options.language - Language code
   * @returns {Promise<Object>} Session object with WebSocket connection
   */
  async createSession(options = {}) {
    const {
      model = 'gpt-4o-realtime-preview-2024-10-01',
      voice = 'alloy',
      temperature = 1.0,
      modalities = ['text'], // We use text only, TTS is handled by ElevenLabs
      instructions = null,
      language = null
    } = options;

    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    try {
      // Create WebSocket connection to OpenAI Realtime API
      const wsUrl = `${this.baseUrl}?model=${model}`;
      const ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });

      // Wait for connection
      await new Promise((resolve, reject) => {
        console.log(`[OPENAI] 🔌 Connecting to OpenAI Realtime API: ${wsUrl}`);
        
        ws.on('open', () => {
          console.log(`[OPENAI] ✅ Connected to OpenAI Realtime API`);
          resolve();
        });

        ws.on('error', (error) => {
          console.error(`[OPENAI] ❌ WebSocket connection error:`, error);
          reject(error);
        });

        // Set timeout
        setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) {
            console.error(`[OPENAI] ❌ Connection timeout after 10 seconds`);
            reject(new Error('Connection timeout'));
          }
        }, 10000);
      });

      // Send session configuration
      // Note: OpenAI Realtime API doesn't support session.language parameter
      // Language is handled via input_audio_transcription.model and instructions
      const config = {
        type: 'session.update',
        session: {
          modalities: modalities,
          instructions: instructions || 'You are a helpful AI assistant.',
          voice: voice,
          temperature: temperature,
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: {
            model: 'whisper-1'
            // Language can be specified here if needed: language: language
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500
          }
        }
      };
      
      // Add language to instructions if provided (as a workaround)
      if (language) {
        config.session.instructions = `${instructions || 'You are a helpful AI assistant.'} Please respond in ${language} language.`;
        console.log(`[OPENAI] 🌐 Language set via instructions: ${language}`);
      }

      console.log(`[OPENAI] 📤 Sending session configuration...`);
      ws.send(JSON.stringify(config));
      console.log(`[OPENAI] ✅ Session configuration sent`);

      // Set up event handlers
      console.log(`[OPENAI] 🎧 Setting up event handlers...`);
      this.setupEventHandlers(ws);

      // Generate session ID (OpenAI doesn't provide one, so we generate)
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      console.log(`[OPENAI] ✅ Session created - Session ID: ${sessionId}`);

      return {
        session: ws,
        sessionId: sessionId
      };
    } catch (error) {
      console.error(`[OPENAI] ❌ Error creating OpenAI Realtime session:`, error);
      console.error(`[OPENAI] ❌ Stack trace:`, error.stack);
      throw error;
    }
  }

  /**
   * Set up event handlers for Realtime API WebSocket
   * @param {WebSocket} ws - OpenAI Realtime WebSocket connection
   */
  setupEventHandlers(ws) {
    // Handle incoming messages from OpenAI
    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString());

        // Emit event based on type
        switch (event.type) {
          case 'session.created':
            console.log(`[OPENAI] ✅ Session created event received`);
            // Session created - this is normal, no action needed
            break;

          case 'session.updated':
            console.log(`[OPENAI] 📊 Session updated event received`);
            this.emit('session_updated', event);
            break;

          case 'conversation.item.created':
            console.log(`[OPENAI] 💬 Conversation item created`);
            this.emit('conversation_item_created', event);
            break;

          case 'conversation.item.input_audio_transcript.completed':
            console.log(`[OPENAI] 🎤 Input audio transcript completed`);
            this.emit('transcript_completed', event);
            break;

          case 'response.audio_transcript.delta':
            console.log(`[OPENAI] 🎙️ Audio transcript delta received`);
            this.emit('audio_transcript_delta', event);
            break;

          case 'response.audio_transcript.done':
            console.log(`[OPENAI] ✅ Audio transcript done`);
            this.emit('audio_transcript_done', event);
            break;

          case 'response.text.delta':
            // AI is generating text - emit for ElevenLabs TTS
            const delta = event.delta || '';
            console.log(`[OPENAI] 📝 Text delta received: "${delta.substring(0, 50)}${delta.length > 50 ? '...' : ''}"`);
            this.emit('text_delta', event);
            break;

          case 'response.text.done':
            console.log(`[OPENAI] ✅ Text generation done`);
            this.emit('text_done', event);
            break;

          case 'response.audio.delta':
            // AI audio output (if using OpenAI TTS, but we use ElevenLabs)
            console.log(`[OPENAI] 🎵 Audio delta received (not used - using ElevenLabs)`);
            this.emit('audio_delta', event);
            break;

          case 'response.audio.done':
            console.log(`[OPENAI] ✅ Audio done`);
            this.emit('audio_done', event);
            break;

          case 'response.output_item.added':
            console.log(`[OPENAI] ➕ Output item added`);
            this.emit('output_item_added', event);
            break;

          case 'response.output_item.done':
            console.log(`[OPENAI] ✅ Output item done`);
            this.emit('output_item_done', event);
            break;

          case 'response.done':
            console.log(`[OPENAI] ✅ Response complete`);
            this.emit('response_done', event);
            break;

          case 'response.interrupted':
            // Barge-in occurred
            console.log(`[OPENAI] ⚠️ Response interrupted (barge-in)`);
            this.emit('response_interrupted', event);
            break;

          case 'error':
            console.error(`[OPENAI] ❌ API error:`, event);
            this.emit('error', event);
            break;

          default:
            // Unknown event type
            console.log(`[OPENAI] ℹ️ Unknown event type: ${event.type}`);
        }
      } catch (error) {
        console.error('Error parsing OpenAI message:', error);
        this.emit('error', error);
      }
    });

    // Handle WebSocket errors
    ws.on('error', (error) => {
      console.error('OpenAI Realtime WebSocket error:', error);
      this.emit('error', error);
    });

    // Handle WebSocket close
    ws.on('close', (code, reason) => {
      console.log(`[OPENAI] 🔌 WebSocket closed - Code: ${code}, Reason: ${reason?.toString() || 'No reason'}`);
      this.emit('close');
    });
  }

  /**
   * Send audio input to Realtime API
   * @param {WebSocket} session - OpenAI Realtime WebSocket session
   * @param {Buffer} audioBuffer - PCM audio buffer
   */
  sendAudioInput(session, audioBuffer) {
    try {
      if (session.readyState !== WebSocket.OPEN) {
        console.warn(`[OPENAI] ⚠️ Session not open, cannot send audio (readyState: ${session.readyState})`);
        return;
      }

      // Convert buffer to base64
      const base64Audio = audioBuffer.toString('base64');
      
      // Send audio input event
      session.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: base64Audio
      }));
      
      // Log every 50th chunk to avoid spam
      if (Math.random() < 0.02) {
        console.log(`[OPENAI] 📤 Sent audio input to OpenAI (${audioBuffer.length} bytes PCM)`);
      }
    } catch (error) {
      console.error(`[OPENAI] ❌ Error sending audio input:`, error);
      this.emit('error', error);
    }
  }

  /**
   * Signal end of audio input
   * @param {WebSocket} session - OpenAI Realtime WebSocket session
   */
  signalAudioInputDone(session) {
    try {
      if (session.readyState !== WebSocket.OPEN) {
        console.warn(`[OPENAI] ⚠️ Session not open, cannot signal audio input done`);
        return;
      }

      console.log(`[OPENAI] ✅ Signaling end of audio input (commit)`);
      session.send(JSON.stringify({
        type: 'input_audio_buffer.commit'
      }));
    } catch (error) {
      console.error(`[OPENAI] ❌ Error signaling audio input done:`, error);
      this.emit('error', error);
    }
  }

  /**
   * Cancel current response (for barge-in)
   * @param {WebSocket} session - OpenAI Realtime WebSocket session
   */
  cancelResponse(session) {
    try {
      if (session.readyState !== WebSocket.OPEN) {
        console.warn(`[OPENAI] ⚠️ Session not open, cannot cancel response`);
        return;
      }

      console.log(`[OPENAI] 🛑 Canceling OpenAI response (barge-in)`);
      session.send(JSON.stringify({
        type: 'response.cancel'
      }));
      console.log(`[OPENAI] ✅ Cancel request sent`);
    } catch (error) {
      console.error(`[OPENAI] ❌ Error canceling response:`, error);
      this.emit('error', error);
    }
  }

  /**
   * Create a response (trigger AI to speak)
   * This can be used to initiate a conversation or respond to user input
   * Note: response.create does not accept instructions parameter
   * To customize the response, update session instructions first using updateSessionInstructions
   * @param {WebSocket} session - OpenAI Realtime WebSocket session
   */
  createResponse(session) {
    try {
      if (session.readyState !== WebSocket.OPEN) {
        console.warn(`[OPENAI] ⚠️ Session not open, cannot create response (readyState: ${session.readyState})`);
        return;
      }

      const message = {
        type: 'response.create'
      };
      
      session.send(JSON.stringify(message));
      console.log(`[OPENAI] 📤 Sent response.create to OpenAI - AI will respond using current session instructions`);
    } catch (error) {
      console.error(`[OPENAI] ❌ Error creating response:`, error);
      this.emit('error', error);
    }
  }

  /**
   * Update session instructions temporarily
   * This can be used to change what the AI says for the next response
   * @param {WebSocket} session - OpenAI Realtime WebSocket session
   * @param {string} instructions - New instructions for the session
   */
  updateSessionInstructions(session, instructions) {
    try {
      if (session.readyState !== WebSocket.OPEN) {
        console.warn(`[OPENAI] ⚠️ Session not open, cannot update instructions (readyState: ${session.readyState})`);
        return;
      }

      const message = {
        type: 'session.update',
        session: {
          instructions: instructions
        }
      };
      
      session.send(JSON.stringify(message));
      console.log(`[OPENAI] 📝 Updated session instructions: ${instructions.substring(0, 100)}...`);
    } catch (error) {
      console.error(`[OPENAI] ❌ Error updating session instructions:`, error);
      this.emit('error', error);
    }
  }

  /**
   * Close session
   * @param {WebSocket} session - OpenAI Realtime WebSocket session
   */
  async closeSession(session) {
    try {
      if (session.readyState === WebSocket.OPEN) {
        session.close();
      }
    } catch (error) {
      console.error('Error closing OpenAI Realtime session:', error);
    }
  }
}

module.exports = new OpenAIRealtimeClient();

