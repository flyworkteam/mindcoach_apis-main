/**
 * ElevenLabs Streaming TTS Client
 * Handles streaming text-to-speech with ElevenLabs API
 * Supports real-time audio streaming and interruption
 */

const axios = require('axios');
const EventEmitter = require('events');

class ElevenLabsStreamingClient extends EventEmitter {
  constructor() {
    super();
    this.apiKey = process.env.ELEVENLABS_API_KEY;
    this.baseUrl = 'https://api.elevenlabs.io/v1';
    this.modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';

    if (!this.apiKey) {
      console.warn('⚠️  ELEVENLABS_API_KEY not set. ElevenLabs streaming will not function.');
    }
  }

  /**
   * Stream text to speech
   * Streams audio chunks as they are generated
   * @param {string} text - Text to convert to speech
   * @param {string} voiceId - ElevenLabs voice ID
   * @param {AbortController} abortController - Abort controller for cancellation
   * @returns {Promise<void>}
   */
  async streamTextToSpeech(text, voiceId, abortController = null) {
    if (!this.apiKey) {
      throw new Error('ElevenLabs API key not configured');
    }

    if (!voiceId) {
      throw new Error('Voice ID is required');
    }

    if (!text || text.trim() === '') {
      throw new Error('Text is required');
    }

    try {
      console.log(`[ELEVENLABS] 🎙️ Starting TTS stream - Voice ID: ${voiceId}, Text length: ${text.length} chars`);
      console.log(`[ELEVENLABS] 📝 Text preview: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
      
      const response = await axios.post(
        `${this.baseUrl}/text-to-speech/${voiceId}/stream`,
        {
          text: text,
          model_id: this.modelId,
          voice_settings: {
            stability: 0.75,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true
          },
          output_format: 'pcm_16000', // PCM 16kHz for real-time streaming
          optimize_streaming_latency: 4 // Maximum optimization for low latency
        },
        {
          headers: {
            'xi-api-key': this.apiKey,
            'Content-Type': 'application/json',
            'Accept': 'audio/pcm'
          },
          responseType: 'stream', // Stream response
          signal: abortController?.signal, // Support cancellation
          timeout: 30000
        }
      );

      console.log(`[ELEVENLABS] ✅ TTS request sent, waiting for audio stream...`);

      let chunkCount = 0;
      let totalBytes = 0;

      // Stream audio chunks
      response.data.on('data', (chunk) => {
        if (abortController?.signal.aborted) {
          console.log(`[ELEVENLABS] 🛑 Stream aborted, stopping chunk processing`);
          return; // Stop processing if aborted
        }

        chunkCount++;
        totalBytes += chunk.length;
        
        // Log every 20th chunk
        if (chunkCount % 20 === 0) {
          console.log(`[ELEVENLABS] 📦 Received ${chunkCount} chunks (${totalBytes} bytes total)`);
        }

        // Emit audio chunk
        this.emit('audio_chunk', chunk);
      });

      response.data.on('end', () => {
        console.log(`[ELEVENLABS] ✅ Stream complete - Total chunks: ${chunkCount}, Total bytes: ${totalBytes}`);
        this.emit('stream_end');
      });

      response.data.on('error', (error) => {
        if (!abortController?.signal.aborted) {
          console.error(`[ELEVENLABS] ❌ Streaming error:`, error);
          this.emit('error', error);
        } else {
          console.log(`[ELEVENLABS] 🛑 Stream error (expected - aborted)`);
        }
      });

    } catch (error) {
      if (error.name === 'AbortError' || error.code === 'ERR_CANCELED') {
        // Expected when aborting, don't emit error
        console.log(`[ELEVENLABS] 🛑 Stream aborted (expected - barge-in)`);
        this.emit('stream_aborted');
        return;
      }

      console.error(`[ELEVENLABS] ❌ Error streaming TTS:`, error.response?.data || error.message);
      console.error(`[ELEVENLABS] ❌ Error stack:`, error.stack);
      throw error;
    }
  }

  /**
   * Stream text delta to speech (for incremental TTS)
   * This allows streaming TTS as text is generated
   * @param {string} textDelta - New text to add
   * @param {string} voiceId - ElevenLabs voice ID
   * @param {AbortController} abortController - Abort controller
   * @returns {Promise<void>}
   */
  async streamTextDelta(textDelta, voiceId, abortController = null) {
    if (!textDelta || textDelta.trim() === '') {
      return; // Skip empty deltas
    }

    // For now, we'll use the full text streaming approach
    // In production, you might want to implement sentence-level streaming
    await this.streamTextToSpeech(textDelta, voiceId, abortController);
  }

  /**
   * Get available voices
   * @returns {Promise<Array>} Array of voice objects
   */
  async getVoices() {
    if (!this.apiKey) {
      throw new Error('ElevenLabs API key not configured');
    }

    try {
      const response = await axios.get(`${this.baseUrl}/voices`, {
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      return response.data.voices || [];
    } catch (error) {
      console.error('Error fetching ElevenLabs voices:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = new ElevenLabsStreamingClient();

