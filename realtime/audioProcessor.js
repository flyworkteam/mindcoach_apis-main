/**
 * Audio Processor
 * Handles audio processing, silence detection, and volume analysis
 */

class AudioProcessor {
  /**
   * Calculate RMS (Root Mean Square) for audio buffer
   * Used for volume detection and silence detection
   * @param {Buffer} audioBuffer - PCM audio buffer
   * @returns {number} RMS value (0-1)
   */
  calculateRMS(audioBuffer) {
    if (!audioBuffer || audioBuffer.length === 0) return 0;

    let sum = 0;
    const samples = audioBuffer.length / 2; // 16-bit PCM = 2 bytes per sample

    for (let i = 0; i < audioBuffer.length; i += 2) {
      // Read 16-bit signed integer (little-endian)
      const sample = audioBuffer.readInt16LE(i);
      // Normalize to -1.0 to 1.0
      const normalized = sample / 32768.0;
      sum += normalized * normalized;
    }

    const rms = Math.sqrt(sum / samples);
    return rms;
  }

  /**
   * Detect if audio is above threshold (user is speaking)
   * @param {Buffer} audioBuffer - PCM audio buffer
   * @param {number} threshold - Volume threshold (0-1), default 0.01
   * @returns {boolean} True if audio is above threshold
   */
  isAudioAboveThreshold(audioBuffer, threshold = 0.01) {
    const rms = this.calculateRMS(audioBuffer);
    return rms > threshold;
  }

  /**
   * Convert base64 audio to Buffer
   * @param {string} base64Audio - Base64 encoded audio
   * @returns {Buffer} Audio buffer
   */
  base64ToBuffer(base64Audio) {
    return Buffer.from(base64Audio, 'base64');
  }

  /**
   * Convert Buffer to base64
   * @param {Buffer} buffer - Audio buffer
   * @returns {string} Base64 encoded audio
   */
  bufferToBase64(buffer) {
    return buffer.toString('base64');
  }

  /**
   * Process audio chunk for silence detection
   * @param {Buffer} audioChunk - Audio chunk (PCM16, AAC, or other format)
   * @param {number} silenceThreshold - RMS threshold for silence (default: 0.005)
   * @returns {Object} { isSilent: boolean, volume: number }
   */
  processAudioChunk(audioChunk, silenceThreshold = 0.005) {
    if (!audioChunk || audioChunk.length === 0) {
      return {
        isSilent: true,
        volume: 0,
        threshold: silenceThreshold
      };
    }

    // Try to calculate RMS for PCM16 format
    // If audio is in another format (e.g., AAC), RMS calculation might not be accurate
    // but we'll still try to detect if there's any audio activity
    try {
      const rms = this.calculateRMS(audioChunk);
      const isSilent = rms < silenceThreshold;

      return {
        isSilent,
        volume: rms,
        threshold: silenceThreshold
      };
    } catch (error) {
      // If RMS calculation fails (e.g., non-PCM format), use a simple heuristic
      // Check if buffer has significant non-zero values
      let nonZeroCount = 0;
      for (let i = 0; i < Math.min(audioChunk.length, 100); i++) {
        if (audioChunk[i] !== 0) nonZeroCount++;
      }
      const hasActivity = nonZeroCount > 10; // At least 10% non-zero values
      
      return {
        isSilent: !hasActivity,
        volume: hasActivity ? 0.1 : 0, // Approximate volume
        threshold: silenceThreshold
      };
    }
  }

  /**
   * Combine multiple audio buffers
   * @param {Array<Buffer>} buffers - Array of audio buffers
   * @returns {Buffer} Combined buffer
   */
  combineBuffers(buffers) {
    if (!buffers || buffers.length === 0) {
      return Buffer.alloc(0);
    }

    return Buffer.concat(buffers);
  }

  /**
   * Get audio format info
   * @param {string} format - Audio format (pcm, opus, etc.)
   * @returns {Object} Format information
   */
  getFormatInfo(format = 'pcm') {
    const formats = {
      pcm: {
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
        encoding: 'linear16'
      },
      opus: {
        sampleRate: 48000,
        channels: 1,
        encoding: 'opus'
      }
    };

    return formats[format] || formats.pcm;
  }
}

module.exports = new AudioProcessor();

