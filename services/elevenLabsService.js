/**
 * ElevenLabs Service
 * Handles text-to-speech conversion using ElevenLabs API
 */

const axios = require('axios');

class ElevenLabsService {
  /**
   * Convert text to speech using ElevenLabs API
   * @param {string} text - Text to convert to speech
   * @param {string} voiceId - ElevenLabs voice ID
   * @param {Object} options - Additional options (model_id, voice_settings)
   * @returns {Promise<Buffer>} Audio buffer (MP3)
   */
  static async textToSpeech(text, voiceId, options = {}) {
    try {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        throw new Error('ELEVENLABS_API_KEY is not configured');
      }

      if (!voiceId) {
        throw new Error('Voice ID is required');
      }

      const modelId = options.modelId || process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
      const voiceSettings = options.voiceSettings || {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true
      };

      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          text: text,
          model_id: modelId,
          voice_settings: voiceSettings
        },
        {
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': apiKey
          },
          responseType: 'arraybuffer',
          timeout: 30000 // 30 seconds timeout
        }
      );

      return Buffer.from(response.data);
    } catch (error) {
      console.error('ElevenLabs API error:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      throw new Error(`ElevenLabs API error: ${error.message}`);
    }
  }

  /**
   * Get available voices from ElevenLabs
   * @returns {Promise<Array>} Array of available voices
   */
  static async getVoices() {
    try {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        throw new Error('ELEVENLABS_API_KEY is not configured');
      }

      const response = await axios.get(
        'https://api.elevenlabs.io/v1/voices',
        {
          headers: {
            'xi-api-key': apiKey
          }
        }
      );

      return response.data.voices || [];
    } catch (error) {
      console.error('Error getting voices from ElevenLabs:', error.message);
      throw new Error(`Failed to get voices: ${error.message}`);
    }
  }
}

module.exports = ElevenLabsService;

