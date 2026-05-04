/**
 * Speech to Text Service
 * Handles audio transcription using ElevenLabs Scribe API
 */

const axios = require('axios');
const FormData = require('form-data');

class SpeechToTextService {
  /**
   * Transcribe audio file to text
   * @param {Buffer} audioBuffer - Audio file buffer
   * @param {string} audioFileName - Audio file name
   * @param {string} language - Language code (optional, e.g., 'tr', 'en')
   * @returns {Promise<string>} Transcribed text
   */
  static async transcribeAudio(audioBuffer, audioFileName, language = null) {
    try {
      // Only use ElevenLabs Scribe API
      const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
      
      if (!elevenLabsApiKey) {
        throw new Error('ELEVENLABS_API_KEY is not configured');
      }

      return await this.transcribeWithElevenLabs(audioBuffer, audioFileName, language);
    } catch (error) {
      console.error('[SPEECH-TO-TEXT] ❌ Transcription error:', error.message);
      throw new Error(`Failed to transcribe audio: ${error.message}`);
    }
  }

  /**
   * Transcribe audio using ElevenLabs Scribe API
   * ElevenLabs'in Speech-to-Text (Scribe) modelini kullanır
   * Documentation: https://elevenlabs.io/docs/api-reference/speech-to-text
   * Model: scribe_v1 (supports 99 languages, up to 3GB files, 10 hours duration)
   */
  static async transcribeWithElevenLabs(audioBuffer, audioFileName, language = null) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    
    if (!apiKey) {
      throw new Error('ELEVENLABS_API_KEY is not configured');
    }

    try {
      // Check file size (max 3GB for ElevenLabs, min 1KB for valid audio)
      const maxSize = 3 * 1024 * 1024 * 1024; // 3GB in bytes
      const minSize = 1024; // 1KB minimum for valid audio file
      
      if (audioBuffer.length > maxSize) {
        throw new Error(`Audio file too large: ${audioBuffer.length} bytes (max: ${maxSize} bytes)`);
      }
      
      if (audioBuffer.length < minSize) {
        throw new Error(`Audio file too small: ${audioBuffer.length} bytes (min: ${minSize} bytes). File may be empty or corrupted.`);
      }

      // ElevenLabs Scribe API endpoint
      const endpoint = 'https://api.elevenlabs.io/v1/speech-to-text';
      
      // FormData oluştur - çalışan örneğe göre
      const form = new FormData();
      form.append('file', audioBuffer, audioFileName);
      form.append('model_id', 'scribe_v1');

      console.log(`[SPEECH-TO-TEXT] 📤 Sending audio to ElevenLabs Scribe - File: ${audioFileName}, Size: ${audioBuffer.length} bytes`);

      const response = await axios.post(
        endpoint,
        form,
        {
          headers: {
            ...form.getHeaders(),
            'xi-api-key': apiKey
          },
          maxBodyLength: Infinity
        }
      );

      // ElevenLabs response format: { text: "...", ... }
      const transcription = response.data.text || '';
      
      if (!transcription) {
        throw new Error('No transcription text in ElevenLabs response');
      }

      console.log(`[SPEECH-TO-TEXT] ✅ ElevenLabs transcription received: ${transcription.substring(0, 100)}${transcription.length > 100 ? '...' : ''}`);
      return transcription;
    } catch (error) {
      console.error('[SPEECH-TO-TEXT] ❌ ElevenLabs STT error:', error.response?.status, error.response?.data || error.message);
      if (error.response?.data) {
        console.error('[SPEECH-TO-TEXT] ❌ Error details:', JSON.stringify(error.response.data, null, 2));
      }
      throw new Error(`ElevenLabs STT failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

}

module.exports = SpeechToTextService;



