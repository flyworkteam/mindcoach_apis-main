/**
 * State Manager
 * Manages conversation state for real-time AI calls
 * Tracks user speaking, AI speaking, and conversation flow
 */

class StateManager {
  constructor() {
    // Per-connection state
    this.connections = new Map();
  }

  /**
   * Initialize state for a new connection
   * @param {string} connectionId - Unique connection ID
   * @param {number} consultantId - Consultant ID
   * @param {number} userId - User ID
   */
  initialize(connectionId, consultantId, userId) {
    console.log(`[STATE] 📊 Initializing state - Connection: ${connectionId}, User: ${userId}, Consultant: ${consultantId}`);
    
    this.connections.set(connectionId, {
      connectionId,
      consultantId,
      userId,
      isUserSpeaking: false,
      isAISpeaking: false,
      lastUserAudioTime: null,
      lastAIAudioTime: null,
      silenceStartTime: null,
      isProcessing: false,
      openaiSessionId: null,
      elevenlabsAbortController: null,
      openaiAbortController: null,
      audioBuffer: [],
      textBuffer: '',
      createdAt: Date.now()
    });
    
    console.log(`[STATE] ✅ State initialized for ${connectionId}`);
  }

  /**
   * Get state for a connection
   * @param {string} connectionId - Connection ID
   * @returns {Object|null} State object or null
   */
  getState(connectionId) {
    return this.connections.get(connectionId) || null;
  }

  /**
   * Update user speaking state
   * @param {string} connectionId - Connection ID
   * @param {boolean} isSpeaking - Whether user is speaking
   */
  setUserSpeaking(connectionId, isSpeaking) {
    const state = this.getState(connectionId);
    if (!state) {
      console.log(`[STATE] ⚠️ Cannot set user speaking - State not found: ${connectionId}`);
      return;
    }

    const wasSpeaking = state.isUserSpeaking;
    state.isUserSpeaking = isSpeaking;
    
    if (isSpeaking) {
      state.lastUserAudioTime = Date.now();
      state.silenceStartTime = null;
      if (!wasSpeaking) {
        console.log(`[STATE] 🎤 [${connectionId}] User started speaking`);
      }
    } else {
      state.silenceStartTime = Date.now();
      if (wasSpeaking) {
        console.log(`[STATE] 🔇 [${connectionId}] User stopped speaking - Silence started at ${new Date(state.silenceStartTime).toISOString()}`);
      }
    }
  }

  /**
   * Update AI speaking state
   * @param {string} connectionId - Connection ID
   * @param {boolean} isSpeaking - Whether AI is speaking
   */
  setAISpeaking(connectionId, isSpeaking) {
    const state = this.getState(connectionId);
    if (!state) {
      console.log(`[STATE] ⚠️ Cannot set AI speaking - State not found: ${connectionId}`);
      return;
    }

    const wasSpeaking = state.isAISpeaking;
    state.isAISpeaking = isSpeaking;
    
    if (isSpeaking) {
      state.lastAIAudioTime = Date.now();
      if (!wasSpeaking) {
        console.log(`[STATE] 🤖 [${connectionId}] AI started speaking`);
      }
    } else {
      if (wasSpeaking) {
        console.log(`[STATE] 🔇 [${connectionId}] AI stopped speaking`);
      }
    }
  }

  /**
   * Check if barge-in should occur (user speaks while AI is speaking)
   * @param {string} connectionId - Connection ID
   * @returns {boolean} True if barge-in should occur
   */
  shouldBargeIn(connectionId) {
    const state = this.getState(connectionId);
    if (!state) return false;

    const shouldBarge = state.isUserSpeaking && state.isAISpeaking;
    if (shouldBarge) {
      console.log(`[STATE] 🚨 [${connectionId}] Barge-in condition met - isUserSpeaking: ${state.isUserSpeaking}, isAISpeaking: ${state.isAISpeaking}`);
    }
    return shouldBarge;
  }

  /**
   * Set OpenAI session ID
   * @param {string} connectionId - Connection ID
   * @param {string} sessionId - OpenAI session ID
   */
  setOpenAISessionId(connectionId, sessionId) {
    const state = this.getState(connectionId);
    if (!state) return;

    state.openaiSessionId = sessionId;
  }

  /**
   * Set ElevenLabs abort controller
   * @param {string} connectionId - Connection ID
   * @param {AbortController} controller - Abort controller
   */
  setElevenLabsAbortController(connectionId, controller) {
    const state = this.getState(connectionId);
    if (!state) return;

    state.elevenlabsAbortController = controller;
  }

  /**
   * Set OpenAI abort controller
   * @param {string} connectionId - Connection ID
   * @param {AbortController} controller - Abort controller
   */
  setOpenAIAbortController(connectionId, controller) {
    const state = this.getState(connectionId);
    if (!state) return;

    state.openaiAbortController = controller;
  }

  /**
   * Abort AI response (barge-in)
   * @param {string} connectionId - Connection ID
   */
  abortAIResponse(connectionId) {
    const state = this.getState(connectionId);
    if (!state) {
      console.log(`[STATE] ⚠️ Cannot abort AI response - State not found: ${connectionId}`);
      return;
    }

    console.log(`[STATE] 🛑 [${connectionId}] Aborting AI response...`);

    // Abort ElevenLabs streaming
    if (state.elevenlabsAbortController) {
      console.log(`[STATE] 🛑 [${connectionId}] Aborting ElevenLabs stream`);
      state.elevenlabsAbortController.abort();
      state.elevenlabsAbortController = null;
      console.log(`[STATE] ✅ [${connectionId}] ElevenLabs stream aborted`);
    } else {
      console.log(`[STATE] ℹ️ [${connectionId}] No ElevenLabs abort controller to abort`);
    }

    // Abort OpenAI response
    if (state.openaiAbortController) {
      console.log(`[STATE] 🛑 [${connectionId}] Aborting OpenAI response`);
      state.openaiAbortController.abort();
      state.openaiAbortController = null;
      console.log(`[STATE] ✅ [${connectionId}] OpenAI response aborted`);
    } else {
      console.log(`[STATE] ℹ️ [${connectionId}] No OpenAI abort controller to abort`);
    }

    // Reset AI speaking state
    state.isAISpeaking = false;
    state.textBuffer = '';
    console.log(`[STATE] ✅ [${connectionId}] AI response aborted - State reset`);
  }

  /**
   * Add audio chunk to buffer
   * @param {string} connectionId - Connection ID
   * @param {Buffer} chunk - Audio chunk
   */
  addAudioChunk(connectionId, chunk) {
    const state = this.getState(connectionId);
    if (!state) return;

    state.audioBuffer.push(chunk);
    
    // Limit buffer size (prevent memory issues)
    if (state.audioBuffer.length > 100) {
      state.audioBuffer.shift();
    }
  }

  /**
   * Clear audio buffer
   * @param {string} connectionId - Connection ID
   */
  clearAudioBuffer(connectionId) {
    const state = this.getState(connectionId);
    if (!state) return;

    state.audioBuffer = [];
  }

  /**
   * Add text to buffer
   * @param {string} connectionId - Connection ID
   * @param {string} text - Text to add
   */
  addText(connectionId, text) {
    const state = this.getState(connectionId);
    if (!state) return;

    state.textBuffer += text;
  }

  /**
   * Clear text buffer
   * @param {string} connectionId - Connection ID
   */
  clearTextBuffer(connectionId) {
    const state = this.getState(connectionId);
    if (!state) return;

    state.textBuffer = '';
  }

  /**
   * Check if silence detected
   * @param {string} connectionId - Connection ID
   * @param {number} silenceThresholdMs - Silence threshold in milliseconds
   * @returns {boolean} True if silence detected
   */
  isSilenceDetected(connectionId, silenceThresholdMs = 1000) {
    const state = this.getState(connectionId);
    if (!state) return false;

    if (!state.silenceStartTime) return false;

    const silenceDuration = Date.now() - state.silenceStartTime;
    const isSilent = silenceDuration >= silenceThresholdMs && !state.isUserSpeaking;
    
    if (isSilent && silenceDuration >= silenceThresholdMs) {
      console.log(`[STATE] 🔇 [${connectionId}] Silence detected - Duration: ${silenceDuration}ms (threshold: ${silenceThresholdMs}ms)`);
    }
    
    return isSilent;
  }

  /**
   * Remove connection state
   * @param {string} connectionId - Connection ID
   */
  remove(connectionId) {
    console.log(`[STATE] 🧹 Removing state for connection: ${connectionId}`);
    
    // Clean up abort controllers
    const state = this.getState(connectionId);
    if (state) {
      this.abortAIResponse(connectionId);
    }

    this.connections.delete(connectionId);
    console.log(`[STATE] ✅ State removed for ${connectionId}`);
  }

  /**
   * Get all active connections
   * @returns {Array} Array of connection IDs
   */
  getActiveConnections() {
    return Array.from(this.connections.keys());
  }
}

// Singleton instance
module.exports = new StateManager();

