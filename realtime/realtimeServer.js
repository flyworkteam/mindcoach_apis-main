/**
 * Realtime WebSocket Server
 * Handles real-time AI phone call-like conversations
 * Features:
 * - Streaming audio input/output
 * - OpenAI Realtime API integration
 * - ElevenLabs Streaming TTS
 * - Barge-in support (user can interrupt AI)
 * - Silence detection
 */

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const UserService = require('../services/userService');
const TokenRepository = require('../repositories/TokenRepository');
const ConsultantService = require('../services/consultantService');
const AppointmentService = require('../services/appointmentService');
const ChatService = require('../services/chatService');
const MessageRepository = require('../repositories/MessageRepository');
const ChatRepository = require('../repositories/ChatRepository');
const StateManager = require('./stateManager');
const AudioProcessor = require('./audioProcessor');
const OpenAIRealtimeClient = require('./openaiRealtimeClient');
const ElevenLabsStreamingClient = require('./elevenLabsStreamingClient');

class RealtimeServer {
  constructor(port = 3001) {
    this.port = port;
    this.wss = null;
    this.silenceThreshold = 0.005; // RMS threshold for silence detection
    this.silenceDurationMs = 1000; // 1 second of silence to trigger processing
  }

  /**
   * Start WebSocket server
   */
  start() {
    this.wss = new WebSocket.Server({
      port: this.port,
      perMessageDeflate: false // Disable compression for lower latency
    });

    console.log(`[REALTIME] 🚀 Realtime WebSocket Server started on port ${this.port}`);
    console.log(`[REALTIME] 📊 Server ready for phone call connections`);

    this.wss.on('connection', (ws, req) => {
      console.log(`[REALTIME] 🔌 New WebSocket connection attempt from ${req.socket.remoteAddress}`);
      this.handleConnection(ws, req);
    });

    // Cleanup on server close
    process.on('SIGINT', () => {
      this.stop();
    });
  }

  /**
   * Handle new WebSocket connection
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} req - HTTP request
   */
  async handleConnection(ws, req) {
    let connectionId = null;
    let userId = null;
    let consultantId = null;

    try {
      console.log(`[REALTIME] 🔐 Authenticating connection...`);
      
      // Authenticate connection
      const authResult = await this.authenticateConnection(req);
      if (!authResult.success) {
        console.log(`[REALTIME] ❌ Authentication failed: ${authResult.error}`);
        ws.close(1008, authResult.error);
        return;
      }

      userId = authResult.userId;
      consultantId = authResult.consultantId;
      connectionId = `${userId}_${consultantId}_${Date.now()}`;

      console.log(`[REALTIME] ✅ Authentication successful - User: ${userId}, Consultant: ${consultantId}`);
      console.log(`[REALTIME] 📝 Connection ID: ${connectionId}`);

      // Get consultant info
      console.log(`[REALTIME] 🔍 Fetching consultant info (ID: ${consultantId})...`);
      const consultant = await ConsultantService.getConsultantById(consultantId);
      if (!consultant) {
        console.log(`[REALTIME] ❌ Consultant not found: ${consultantId}`);
        ws.close(1008, 'Consultant not found');
        return;
      }

      if (!consultant.voiceId) {
        console.log(`[REALTIME] ❌ Consultant voice ID not configured: ${consultantId}`);
        ws.close(1008, 'Consultant voice ID not configured');
        return;
      }

      console.log(`[REALTIME] ✅ Consultant found - Voice ID: ${consultant.voiceId}, Name: ${consultant.names?.tr || consultant.names?.en || 'Unknown'}`);

      // Initialize state
      console.log(`[REALTIME] 📊 Initializing state for connection: ${connectionId}`);
      StateManager.initialize(connectionId, consultantId, userId);

      // Initialize OpenAI Realtime session
      console.log(`[REALTIME] 🤖 Creating OpenAI Realtime session...`);
      const user = await UserService.getUserById(userId);

      // ── Sohbet geçmişini getir ────────────────────────────────────────────
      let chatHistoryText = '';
      try {
        const chat = await ChatRepository.findByUserAndConsultant(userId, consultantId);
        if (chat) {
          const history = await MessageRepository.getChatHistory(chat.chatId, 30);
          if (history && history.length > 0) {
            chatHistoryText = '\n\n--- Önceki Sohbet Geçmişi ---\n';
            chatHistoryText += history.map(m => {
              const who = m.sender === 'user' ? 'Kullanıcı' : 'Sen';
              // voiceContent → ses mesajı transkripti, message → metin mesajı
              const text = m.voiceContent || m.message || '[ses mesajı]';
              return `${who}: ${text}`;
            }).join('\n');
            chatHistoryText += '\n--- Geçmiş Sonu ---\n';
            console.log(`[REALTIME] 📚 Chat history loaded: ${history.length} messages`);
          }
        }
      } catch (histErr) {
        console.warn('[REALTIME] ⚠️ Chat history fetch failed:', histErr.message);
      }

      // ── Randevu bilgisini getir ───────────────────────────────────────────
      let appointmentText = '';
      try {
        const appt = await AppointmentService.getUpcomingAppointmentByUserId(userId);
        if (appt) {
          const apptDate = appt.appointmentDate
            ? new Date(appt.appointmentDate).toLocaleString('tr-TR')
            : 'belirtilmemiş';
          appointmentText = `\n\nKullanıcının yaklaşan bir randevusu var: ${apptDate} (ID: ${appt.id}, Durum: ${appt.status}). Bu kişiye yeni randevu ÖNERME — zaten randevusu var.`;
          console.log(`[REALTIME] 📅 Upcoming appointment: ${apptDate}`);
        } else {
          appointmentText = '\n\nKullanıcının şu an aktif bir randevusu yok.';
        }
      } catch (apptErr) {
        console.warn('[REALTIME] ⚠️ Appointment fetch failed:', apptErr.message);
      }

      // ── Kullanıcı profil bilgisi ──────────────────────────────────────────
      let userProfileText = '';
      if (user) {
        const profile = user.generalProfile || user.generalPsychologicalProfile || null;
        if (profile) {
          userProfileText = `\n\nKullanıcı Profili: ${typeof profile === 'string' ? profile : JSON.stringify(profile)}`;
        }
        if (user.username) {
          userProfileText = `\nKullanıcı adı: ${user.username}` + userProfileText;
        }
      }

      // ── Tüm bağlamı instruction'a ekle ───────────────────────────────────
      const enrichedInstructions = (consultant.mainPrompt || 'You are a helpful AI assistant.')
        + userProfileText
        + appointmentText
        + chatHistoryText;

      const openaiSession = await OpenAIRealtimeClient.createSession({
        instructions: enrichedInstructions,
        language: user?.nativeLang || 'tr',
        temperature: 0.8
      });

      console.log(`[REALTIME] ✅ OpenAI Realtime session created - Session ID: ${openaiSession.sessionId}`);
      StateManager.setOpenAISessionId(connectionId, openaiSession.sessionId);

      // Set up OpenAI event handlers
      console.log(`[REALTIME] 🎧 Setting up OpenAI event handlers...`);
      this.setupOpenAIHandlers(connectionId, openaiSession.session, consultant.voiceId, ws);

      // Send connection success
      const successMessage = {
        type: 'connection_success',
        connectionId,
        consultantId,
        message: 'Connected to realtime AI call'
      };
      ws.send(JSON.stringify(successMessage));
      console.log(`[REALTIME] ✅ Connection established - Sent success message to client`);

      // Send initial greeting from AI
      // Wait a bit for session to be fully ready
      setTimeout(() => {
        console.log(`[REALTIME] 👋 [${connectionId}] Triggering initial greeting from AI...`);
        this.sendInitialGreeting(connectionId, openaiSession.session, consultant);
      }, 1500); // Wait 1.5 seconds for session to be ready

      // Handle incoming messages (both JSON and binary)
      let audioChunkCount = 0;
      ws.on('message', async (data) => {
        try {
          if (Buffer.isBuffer(data)) {
            // Binary audio data
            audioChunkCount++;
            console.log(`[REALTIME] 🎤 [${connectionId}] Received audio chunk #${audioChunkCount} - Size: ${data.length} bytes`);
            
            // İlk birkaç chunk'ta detaylı log
            if (audioChunkCount <= 5) {
              console.log(`[REALTIME] 🎤 [${connectionId}] Audio chunk detayları:`, {
                size: data.length,
                firstBytes: Array.from(data.slice(0, 10)),
                isBuffer: Buffer.isBuffer(data)
              });
            }
            
            await this.handleAudioChunk(connectionId, data, ws, openaiSession.session);
          } else {
            // JSON message
            try {
              const message = JSON.parse(data.toString());
              console.log(`[REALTIME] 📨 [${connectionId}] Received JSON message:`, message.type);
              await this.handleMessage(connectionId, message, ws, openaiSession.session);
            } catch (parseError) {
              console.error(`[REALTIME] ❌ [${connectionId}] JSON parse error:`, parseError);
              console.error(`[REALTIME] ❌ [${connectionId}] Raw data:`, data.toString().substring(0, 100));
            }
          }
        } catch (error) {
          console.error(`[REALTIME] ❌ [${connectionId}] Error handling message:`, error);
          console.error(`[REALTIME] ❌ [${connectionId}] Stack trace:`, error.stack);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'error',
              error: error.message
            }));
          }
        }
      });

      // Handle connection close
      ws.on('close', (code, reason) => {
        console.log(`[REALTIME] 🔌 Connection closed: ${connectionId} - Code: ${code}, Reason: ${reason?.toString() || 'No reason'}`);
        this.cleanupConnection(connectionId, openaiSession.session);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error(`[REALTIME] ❌ WebSocket error for ${connectionId}:`, error);
        this.cleanupConnection(connectionId, openaiSession.session);
      });

      console.log(`[REALTIME] ✅ Connection setup complete for ${connectionId}`);

    } catch (error) {
      console.error(`[REALTIME] ❌ Error setting up connection:`, error);
      console.error(`[REALTIME] ❌ Stack trace:`, error.stack);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, 'Internal server error');
      }
      if (connectionId) {
        this.cleanupConnection(connectionId, null);
      }
    }
  }

  /**
   * Authenticate WebSocket connection
   * @param {Object} req - HTTP request
   * @returns {Promise<Object>} Authentication result
   */
  async authenticateConnection(req) {
    try {
      console.log(`[REALTIME] 🔐 Starting authentication process...`);
      
      // Get token from query string or headers
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get('token') || 
                   req.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        console.log(`[REALTIME] ❌ Authentication failed: No token provided`);
        return { success: false, error: 'No token provided' };
      }

      console.log(`[REALTIME] 🔑 Token found, verifying JWT...`);

      // Verify JWT token
      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log(`[REALTIME] ✅ JWT verified - User ID: ${decoded.userId}`);
      } catch (error) {
        console.log(`[REALTIME] ❌ JWT verification failed:`, error.message);
        return { success: false, error: 'Invalid token' };
      }

      // Check if token exists in database (Stateful JWT)
      console.log(`[REALTIME] 🔍 Checking token validity in database...`);
      const tokenValid = await TokenRepository.isValid(token);
      if (!tokenValid) {
        console.log(`[REALTIME] ❌ Token revoked or expired in database`);
        return { success: false, error: 'Token has been revoked' };
      }

      console.log(`[REALTIME] ✅ Token valid in database`);

      // Get consultant ID from query string
      const consultantIdParam = url.searchParams.get('consultantId');
      if (!consultantIdParam) {
        console.log(`[REALTIME] ❌ Consultant ID missing from query string`);
        return { success: false, error: 'Consultant ID is required' };
      }

      const consultantId = parseInt(consultantIdParam);
      if (isNaN(consultantId) || consultantId <= 0) {
        console.log(`[REALTIME] ❌ Consultant ID invalid: ${consultantIdParam}`);
        return { success: false, error: 'Consultant ID must be a valid positive number' };
      }

      console.log(`[REALTIME] ✅ Authentication successful - User: ${decoded.userId}, Consultant: ${consultantId}`);

      return {
        success: true,
        userId: decoded.userId,
        consultantId
      };
    } catch (error) {
      console.error(`[REALTIME] ❌ Authentication error:`, error);
      console.error(`[REALTIME] ❌ Stack trace:`, error.stack);
      return { success: false, error: 'Authentication failed' };
    }
  }

  /**
   * Set up OpenAI Realtime API event handlers
   * @param {string} connectionId - Connection ID
   * @param {WebSocket} session - OpenAI Realtime WebSocket session
   * @param {string} voiceId - ElevenLabs voice ID
   * @param {WebSocket} ws - Client WebSocket connection
   */
  setupOpenAIHandlers(connectionId, session, voiceId, ws) {
    const state = StateManager.getState(connectionId);
    if (!state) return;

    // Store session reference for this connection
    const sessionRef = session;

    // Handle text deltas from OpenAI (AI is generating text)
    const textDeltaHandler = (event) => {
      // Check if this event is for our connection
      // Note: OpenAI events don't have session_id, so we handle all events
      // This is okay since each connection has its own handler set
      
      const textDelta = event.delta || '';
      if (textDelta && textDelta.trim()) {
        console.log(`[REALTIME] 📝 [${connectionId}] OpenAI text delta received: "${textDelta.substring(0, 100)}${textDelta.length > 100 ? '...' : ''}"`);
        
        // Update text buffer
        StateManager.addText(connectionId, textDelta);
        const state = StateManager.getState(connectionId);
        console.log(`[REALTIME] 📝 [${connectionId}] Text buffer updated - Total length: ${state?.textBuffer?.length || 0} chars`);

        // Check if AI just started speaking (first text delta)
        const wasAISpeaking = state?.isAISpeaking || false;
        if (!wasAISpeaking && ws.readyState === WebSocket.OPEN) {
          // Send ai_speaking_start event to client
          ws.send(JSON.stringify({
            type: 'ai_speaking_start',
            message: 'Agent started speaking'
          }));
          console.log(`[REALTIME] 📤 [${connectionId}] Sent ai_speaking_start message to client (first text delta)`);
        }

        // Stream to ElevenLabs immediately (incremental TTS)
        console.log(`[REALTIME] 🎙️ [${connectionId}] Streaming text delta to ElevenLabs TTS...`);
        this.streamTextDeltaToElevenLabs(connectionId, textDelta, voiceId, ws);
      } else {
        console.log(`[REALTIME] ⚠️ [${connectionId}] Empty text delta received, skipping`);
      }
    };

    // Handle text done
    const textDoneHandler = (event) => {
      console.log(`[REALTIME] ✅ [${connectionId}] OpenAI text generation complete`);
    };

    // Handle response done
    const responseDoneHandler = (event) => {
      console.log(`[REALTIME] ✅ [${connectionId}] AI response complete`);
      
      // AI response complete
      StateManager.setAISpeaking(connectionId, false);
      StateManager.clearTextBuffer(connectionId);

      const state = StateManager.getState(connectionId);
      console.log(`[REALTIME] 📊 [${connectionId}] State updated - isAISpeaking: false`);

      // If this was the initial greeting, restore original instructions
      if (state._restoreInstructionsAfterGreeting && state._originalInstructions) {
        console.log(`[REALTIME] 🔄 [${connectionId}] Restoring original session instructions after greeting...`);
        OpenAIRealtimeClient.updateSessionInstructions(session, state._originalInstructions);
        state._restoreInstructionsAfterGreeting = false;
        delete state._originalInstructions;
        console.log(`[REALTIME] ✅ [${connectionId}] Original instructions restored`);
      }

      ws.send(JSON.stringify({
        type: 'ai_response_complete'
      }));
      console.log(`[REALTIME] 📤 [${connectionId}] Sent ai_response_complete message to client`);
    };

    // Handle response interrupted (barge-in occurred)
    const responseInterruptedHandler = (event) => {
      console.log(`[REALTIME] ⚠️ [${connectionId}] Response interrupted by user (barge-in detected)`);
      
      StateManager.setAISpeaking(connectionId, false);
      StateManager.clearTextBuffer(connectionId);

      const state = StateManager.getState(connectionId);
      console.log(`[REALTIME] 📊 [${connectionId}] State updated after interruption - isAISpeaking: false, isUserSpeaking: ${state?.isUserSpeaking || false}`);

      ws.send(JSON.stringify({
        type: 'ai_response_interrupted',
        message: 'AI response interrupted by user'
      }));
      console.log(`[REALTIME] 📤 [${connectionId}] Sent ai_response_interrupted message to client`);
    };

    // Handle errors
    const errorHandler = (error) => {
      console.error(`[REALTIME] ❌ [${connectionId}] OpenAI API error:`, error);
      console.error(`[REALTIME] ❌ [${connectionId}] Error details:`, JSON.stringify(error, null, 2));
      
      ws.send(JSON.stringify({
        type: 'error',
        error: 'OpenAI API error'
      }));
      console.log(`[REALTIME] 📤 [${connectionId}] Sent error message to client`);
    };

    // Register event handlers
    OpenAIRealtimeClient.on('text_delta', textDeltaHandler);
    OpenAIRealtimeClient.on('text_done', textDoneHandler);
    OpenAIRealtimeClient.on('response_done', responseDoneHandler);
    OpenAIRealtimeClient.on('response_interrupted', responseInterruptedHandler);
    OpenAIRealtimeClient.on('error', errorHandler);

    // Store handlers for cleanup
    state._eventHandlers = {
      textDelta: textDeltaHandler,
      textDone: textDoneHandler,
      responseDone: responseDoneHandler,
      responseInterrupted: responseInterruptedHandler,
      error: errorHandler
    };
  }

  /**
   * Send initial greeting from AI consultant
   * @param {string} connectionId - Connection ID
   * @param {WebSocket} openaiSession - OpenAI Realtime WebSocket session
   * @param {Object} consultant - Consultant object
   */
  async sendInitialGreeting(connectionId, openaiSession, consultant) {
    try {
      const state = StateManager.getState(connectionId);
      if (!state) {
        console.log(`[REALTIME] ⚠️ [${connectionId}] Cannot send greeting - State not found`);
        return;
      }

      // Check if OpenAI session is ready
      if (!openaiSession || openaiSession.readyState !== WebSocket.OPEN) {
        console.log(`[REALTIME] ⚠️ [${connectionId}] Cannot send greeting - OpenAI session not ready`);
        return;
      }

      // Get consultant name (prefer Turkish, fallback to first available)
      const consultantName = consultant.names?.tr || consultant.names?.en || consultant.names?.[Object.keys(consultant.names || {})[0]] || 'Koç';
      
      // Create greeting message based on consultant's job/role
      // We'll temporarily update session instructions for the greeting
      const greetingInstructions = `${consultant.mainPrompt || 'You are a helpful AI assistant.'}

Now, greet the user warmly and ask how you can help them today. 
Keep the greeting brief, friendly, and professional (2-3 sentences maximum).
Speak in a natural, conversational tone.`;

      console.log(`[REALTIME] 👋 [${connectionId}] Sending initial greeting - Consultant: ${consultantName}`);
      console.log(`[REALTIME] 📝 [${connectionId}] Updating session instructions for greeting...`);

      // First, update session instructions temporarily for greeting
      OpenAIRealtimeClient.updateSessionInstructions(openaiSession, greetingInstructions);

      // Wait a bit for instructions to be applied
      await new Promise(resolve => setTimeout(resolve, 200));

      // Mark AI as speaking
      StateManager.setAISpeaking(connectionId, true);
      console.log(`[REALTIME] 📊 [${connectionId}] State updated - isAISpeaking: true (greeting)`);

      // Create response (AI will use the updated instructions)
      OpenAIRealtimeClient.createResponse(openaiSession);

      console.log(`[REALTIME] ✅ [${connectionId}] Initial greeting triggered - AI will speak shortly`);

      // After greeting, restore original instructions
      // We'll do this after response is done (handled in responseDoneHandler)
      state._restoreInstructionsAfterGreeting = true;
      state._originalInstructions = consultant.mainPrompt || 'You are a helpful AI assistant.';
    } catch (error) {
      console.error(`[REALTIME] ❌ [${connectionId}] Error sending initial greeting:`, error);
      console.error(`[REALTIME] ❌ [${connectionId}] Stack trace:`, error.stack);
    }
  }

  /**
   * Stream text delta to ElevenLabs TTS
   * @param {string} connectionId - Connection ID
   * @param {string} textDelta - Text delta to convert
   * @param {string} voiceId - ElevenLabs voice ID
   * @param {WebSocket} ws - WebSocket connection
   */
  async streamTextDeltaToElevenLabs(connectionId, textDelta, voiceId, ws) {
    const state = StateManager.getState(connectionId);
    if (!state) {
      console.log(`[REALTIME] ⚠️ [${connectionId}] Cannot stream TTS - State not found`);
      return;
    }

    console.log(`[REALTIME] 🎙️ [${connectionId}] Starting ElevenLabs TTS stream - Text: "${textDelta.substring(0, 50)}${textDelta.length > 50 ? '...' : ''}"`);

    // Check for barge-in
    if (StateManager.shouldBargeIn(connectionId)) {
      console.log(`[REALTIME] ⚠️ [${connectionId}] Barge-in detected before TTS start, aborting`);
      StateManager.abortAIResponse(connectionId);
      if (state.openaiSessionId) {
        // Note: We need the session object, not sessionId
        console.log(`[REALTIME] 🛑 [${connectionId}] Canceling OpenAI response due to barge-in`);
      }
      return;
    }

    // Set AI speaking state
    const wasAISpeaking = state.isAISpeaking;
    StateManager.setAISpeaking(connectionId, true);
    console.log(`[REALTIME] 📊 [${connectionId}] State updated - isAISpeaking: true`);

    // Send ai_speaking_start event to client if AI just started speaking
    if (!wasAISpeaking && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'ai_speaking_start',
        message: 'Agent started speaking'
      }));
      console.log(`[REALTIME] 📤 [${connectionId}] Sent ai_speaking_start message to client`);
    }

    // Create abort controller for this TTS stream
    const abortController = new AbortController();
    StateManager.setElevenLabsAbortController(connectionId, abortController);
    console.log(`[REALTIME] 🎛️ [${connectionId}] Abort controller created for TTS stream`);

    try {
      console.log(`[REALTIME] 🎙️ [${connectionId}] Calling ElevenLabs TTS API - Voice ID: ${voiceId}`);
      
      // Stream text to ElevenLabs
      await ElevenLabsStreamingClient.streamTextToSpeech(
        textDelta,
        voiceId,
        abortController
      );

      let chunkCount = 0;
      let totalBytes = 0;

      // Handle audio chunks from ElevenLabs
      // Use 'on' instead of 'once' to handle multiple chunks
      const audioChunkHandler = (audioChunk) => {
        // Check if connection is still valid
        const currentState = StateManager.getState(connectionId);
        if (!currentState) {
          console.log(`[REALTIME] ⚠️ [${connectionId}] State not found, removing audio chunk handler`);
          ElevenLabsStreamingClient.removeListener('audio_chunk', audioChunkHandler);
          abortController.abort();
          return;
        }

        chunkCount++;
        totalBytes += audioChunk.length;
        
        // Check for barge-in before sending
        if (StateManager.shouldBargeIn(connectionId)) {
          console.log(`[REALTIME] ⚠️ [${connectionId}] Barge-in detected during TTS stream (chunk ${chunkCount}), aborting`);
          ElevenLabsStreamingClient.removeListener('audio_chunk', audioChunkHandler);
          abortController.abort();
          return;
        }

        // Send audio chunk to client
        if (ws.readyState === WebSocket.OPEN) {
          try {
            // Send as binary data
            ws.send(audioChunk, { binary: true });
            if (chunkCount % 10 === 0 || chunkCount === 1) {
              console.log(`[REALTIME] 📤 [${connectionId}] Sent ${chunkCount} audio chunks (${totalBytes} bytes total) to client`);
            }
          } catch (error) {
            console.error(`[REALTIME] ❌ [${connectionId}] Error sending audio chunk to client:`, error);
            console.error(`[REALTIME] ❌ [${connectionId}] Error details:`, error.message);
            // Remove handler on error to prevent further errors
            ElevenLabsStreamingClient.removeListener('audio_chunk', audioChunkHandler);
            abortController.abort();
          }
        } else {
          console.log(`[REALTIME] ⚠️ [${connectionId}] WebSocket not open (readyState: ${ws.readyState}), cannot send audio chunk`);
          // Remove handler if WebSocket is closed
          if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
            ElevenLabsStreamingClient.removeListener('audio_chunk', audioChunkHandler);
            abortController.abort();
          }
        }
      };

      ElevenLabsStreamingClient.on('audio_chunk', audioChunkHandler);
      console.log(`[REALTIME] 🎧 [${connectionId}] ElevenLabs audio chunk handler registered`);
      
      // Store handler for cleanup
      if (state) {
        state._elevenLabsChunkHandler = audioChunkHandler;
      }

      // Handle stream end
      const streamEndHandler = () => {
        console.log(`[REALTIME] ✅ [${connectionId}] ElevenLabs TTS stream complete - Total chunks: ${chunkCount}, Total bytes: ${totalBytes}`);
        // Clean up handler
        const currentState = StateManager.getState(connectionId);
        if (currentState && currentState._elevenLabsChunkHandler) {
          ElevenLabsStreamingClient.removeListener('audio_chunk', currentState._elevenLabsChunkHandler);
          delete currentState._elevenLabsChunkHandler;
        }
      };
      
      ElevenLabsStreamingClient.once('stream_end', streamEndHandler);

      // Handle stream aborted
      const streamAbortedHandler = () => {
        console.log(`[REALTIME] 🛑 [${connectionId}] ElevenLabs TTS stream aborted (barge-in)`);
        // Clean up handler
        const currentState = StateManager.getState(connectionId);
        if (currentState && currentState._elevenLabsChunkHandler) {
          ElevenLabsStreamingClient.removeListener('audio_chunk', currentState._elevenLabsChunkHandler);
          delete currentState._elevenLabsChunkHandler;
        }
      };
      
      ElevenLabsStreamingClient.once('stream_aborted', streamAbortedHandler);

    } catch (error) {
      if (error.name === 'AbortError' || error.code === 'ERR_CANCELED') {
        // Expected when aborting (barge-in)
        console.log(`[REALTIME] 🛑 [${connectionId}] TTS stream aborted (expected - barge-in)`);
        return;
      }

      console.error(`[REALTIME] ❌ [${connectionId}] Error streaming TTS:`, error);
      console.error(`[REALTIME] ❌ [${connectionId}] Error stack:`, error.stack);
      
      ws.send(JSON.stringify({
        type: 'error',
        error: 'TTS streaming error'
      }));
      console.log(`[REALTIME] 📤 [${connectionId}] Sent error message to client`);
    }
  }

  /**
   * Handle incoming WebSocket message
   * @param {string} connectionId - Connection ID
   * @param {Object} data - Message data
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} openaiSession - OpenAI Realtime session
   */
  async handleMessage(connectionId, data, ws, openaiSession) {
    const state = StateManager.getState(connectionId);
    if (!state) return;

    switch (data.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;

      case 'audio_config':
        // Client sending audio configuration
        // Can be used for future enhancements
        break;

      default:
        console.warn(`Unknown message type: ${data.type}`);
    }
  }

  /**
   * Handle incoming audio chunk
   * @param {string} connectionId - Connection ID
   * @param {Buffer} audioChunk - PCM audio chunk
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} openaiSession - OpenAI Realtime session
   */
  async handleAudioChunk(connectionId, audioChunk, ws, openaiSession) {
    const state = StateManager.getState(connectionId);
    if (!state) {
      console.log(`[REALTIME] ⚠️ [${connectionId}] Cannot handle audio chunk - State not found`);
      return;
    }

    // Log first few chunks to verify audio is being received
    const initialBufferSize = state.audioBuffer?.length || 0;
    if (initialBufferSize < 10) {
      console.log(`[REALTIME] 🎤 [${connectionId}] Audio chunk #${initialBufferSize + 1} received - Size: ${audioChunk.length} bytes`);
      console.log(`[REALTIME] 🎤 [${connectionId}] Chunk detayları:`, {
        size: audioChunk.length,
        firstBytes: Array.from(audioChunk.slice(0, Math.min(20, audioChunk.length))),
        bufferSize: initialBufferSize
      });
    }

    // Add audio chunk to buffer for processing
    StateManager.addAudioChunk(connectionId, audioChunk);

    // Process audio for silence detection
    // Note: Audio format from Flutter might be AAC, but we need PCM16
    // For now, we'll try to process it as PCM16
    // In production, you might want to add audio format conversion
    const audioInfo = AudioProcessor.processAudioChunk(audioChunk, this.silenceThreshold);
    
    // İlk birkaç chunk'ta audio info log'la
    if (initialBufferSize < 5) {
      console.log(`[REALTIME] 🎤 [${connectionId}] Audio info:`, {
        isSilent: audioInfo.isSilent,
        volume: audioInfo.volume.toFixed(4),
        threshold: audioInfo.threshold
      });
    }
    
    // Update user speaking state
    const wasUserSpeaking = state.isUserSpeaking;
    const isUserSpeaking = !audioInfo.isSilent;
    StateManager.setUserSpeaking(connectionId, isUserSpeaking);

    // Log state changes
    if (wasUserSpeaking !== isUserSpeaking) {
      if (isUserSpeaking) {
        console.log(`[REALTIME] 🎤 [${connectionId}] User started speaking - Volume: ${audioInfo.volume.toFixed(4)}, Threshold: ${audioInfo.threshold}`);
      } else {
        console.log(`[REALTIME] 🔇 [${connectionId}] User stopped speaking - Silence detected`);
      }
    }

    // Check for barge-in (user speaks while AI is speaking)
    if (StateManager.shouldBargeIn(connectionId)) {
      console.log(`[REALTIME] ⚠️ [${connectionId}] 🚨 BARGE-IN DETECTED - User speaking while AI is speaking`);
      console.log(`[REALTIME] 📊 [${connectionId}] State - isUserSpeaking: ${state.isUserSpeaking}, isAISpeaking: ${state.isAISpeaking}`);
      
      // Abort AI response immediately
      console.log(`[REALTIME] 🛑 [${connectionId}] Aborting AI response (ElevenLabs + OpenAI)`);
      StateManager.abortAIResponse(connectionId);
      
      // Cancel OpenAI response
      if (openaiSession && openaiSession.readyState === WebSocket.OPEN) {
        console.log(`[REALTIME] 🛑 [${connectionId}] Canceling OpenAI Realtime response`);
        OpenAIRealtimeClient.cancelResponse(openaiSession);
      }

      ws.send(JSON.stringify({
        type: 'barge_in',
        message: 'User interrupted AI'
      }));
      console.log(`[REALTIME] 📤 [${connectionId}] Sent barge_in message to client`);
    }

    // Send audio to OpenAI Realtime API
    // Note: OpenAI expects PCM16 format, but Flutter might send AAC
    // For now, we'll send it as-is and let OpenAI handle format conversion if needed
    // In production, you might want to add audio format conversion here
    if (isUserSpeaking) {
      if (openaiSession && openaiSession.readyState === WebSocket.OPEN) {
        try {
          // Convert audio chunk to PCM16 if needed
          // For now, we assume it's already in a compatible format or send as-is
          OpenAIRealtimeClient.sendAudioInput(openaiSession, audioChunk);
          // Log every 50th chunk to avoid spam
          if (Math.random() < 0.02) {
            console.log(`[REALTIME] 📤 [${connectionId}] Sent audio chunk to OpenAI (${audioChunk.length} bytes)`);
          }
        } catch (error) {
          console.error(`[REALTIME] ❌ [${connectionId}] Error sending audio to OpenAI:`, error);
          console.error(`[REALTIME] ❌ [${connectionId}] Error details:`, error.message);
        }
      } else {
        console.log(`[REALTIME] ⚠️ [${connectionId}] OpenAI session not open (readyState: ${openaiSession?.readyState}), cannot send audio`);
      }
    } else {
      // Log occasionally when silent
      if (Math.random() < 0.001) {
        console.log(`[REALTIME] 🔇 [${connectionId}] Audio chunk is silent (volume: ${audioInfo.volume.toFixed(4)})`);
      }
    }

    // Check for silence (user stopped speaking)
    if (StateManager.isSilenceDetected(connectionId, this.silenceDurationMs)) {
      console.log(`[REALTIME] 🔇 [${connectionId}] Silence detected (${this.silenceDurationMs}ms), signaling end of audio input to OpenAI`);
      
      // Signal end of audio input to OpenAI
      if (openaiSession && openaiSession.readyState === WebSocket.OPEN) {
        OpenAIRealtimeClient.signalAudioInputDone(openaiSession);
        console.log(`[REALTIME] ✅ [${connectionId}] Signaled audio input done to OpenAI`);
      }
      
      // Clear audio buffer
      StateManager.clearAudioBuffer(connectionId);
      console.log(`[REALTIME] 🧹 [${connectionId}] Cleared audio buffer`);
    }
  }

  /**
   * Cleanup connection resources
   * @param {string} connectionId - Connection ID
   * @param {WebSocket} openaiSession - OpenAI Realtime WebSocket session
   */
  async cleanupConnection(connectionId, openaiSession) {
    try {
      console.log(`[REALTIME] 🧹 [${connectionId}] Starting cleanup...`);
      
      const state = StateManager.getState(connectionId);
      
      // Clean up ElevenLabs audio chunk handler if exists
      if (state && state._elevenLabsChunkHandler) {
        console.log(`[REALTIME] 🧹 [${connectionId}] Removing ElevenLabs audio chunk handler...`);
        try {
          ElevenLabsStreamingClient.removeListener('audio_chunk', state._elevenLabsChunkHandler);
        } catch (error) {
          console.log(`[REALTIME] ⚠️ [${connectionId}] Error removing ElevenLabs handler (may already be removed):`, error.message);
        }
        delete state._elevenLabsChunkHandler;
      }
      
      // Remove event handlers
      if (state && state._eventHandlers) {
        console.log(`[REALTIME] 🧹 [${connectionId}] Removing OpenAI event handlers...`);
        try {
          OpenAIRealtimeClient.removeListener('text_delta', state._eventHandlers.textDelta);
          OpenAIRealtimeClient.removeListener('text_done', state._eventHandlers.textDone);
          OpenAIRealtimeClient.removeListener('response_done', state._eventHandlers.responseDone);
          OpenAIRealtimeClient.removeListener('response_interrupted', state._eventHandlers.responseInterrupted);
          OpenAIRealtimeClient.removeListener('error', state._eventHandlers.error);
        } catch (error) {
          console.log(`[REALTIME] ⚠️ [${connectionId}] Error removing OpenAI handlers (may already be removed):`, error.message);
        }
        console.log(`[REALTIME] ✅ [${connectionId}] Event handlers removed`);
      }

      // Abort any ongoing AI responses
      console.log(`[REALTIME] 🛑 [${connectionId}] Aborting any ongoing AI responses...`);
      StateManager.abortAIResponse(connectionId);
      console.log(`[REALTIME] ✅ [${connectionId}] AI responses aborted`);

      // Close OpenAI session
      if (openaiSession) {
        console.log(`[REALTIME] 🔌 [${connectionId}] Closing OpenAI Realtime session...`);
        try {
          await OpenAIRealtimeClient.closeSession(openaiSession);
          console.log(`[REALTIME] ✅ [${connectionId}] OpenAI session closed`);
        } catch (error) {
          console.log(`[REALTIME] ⚠️ [${connectionId}] Error closing OpenAI session:`, error.message);
        }
      }

      // Remove state
      StateManager.remove(connectionId);
      console.log(`[REALTIME] ✅ [${connectionId}] State removed`);

      console.log(`[REALTIME] ✅ [${connectionId}] Cleanup complete`);
    } catch (error) {
      console.error(`[REALTIME] ❌ [${connectionId}] Error during cleanup:`, error);
      console.error(`[REALTIME] ❌ [${connectionId}] Stack trace:`, error.stack);
    }
  }

  /**
   * Stop WebSocket server
   */
  stop() {
    if (this.wss) {
      console.log(`[REALTIME] 🛑 Stopping Realtime WebSocket Server...`);
      this.wss.close(() => {
        console.log(`[REALTIME] ✅ Realtime WebSocket Server stopped`);
      });
    }
  }
}

module.exports = RealtimeServer;

