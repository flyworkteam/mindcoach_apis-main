/**
 * WebSocket Handler
 * Handles realtime chat connections using Socket.IO
 */

const jwt = require('jsonwebtoken');
const UserService = require('../services/userService');
const TokenRepository = require('../repositories/TokenRepository');
const RealtimeChatService = require('../services/realtimeChatService');

class SocketHandler {
  constructor(io) {
    this.io = io;
    // Store audio chunks for each conversation (shared across all connections)
    this.audioChunks = new Map();
    this.setupMiddleware();
    this.setupEventHandlers();
  }

  /**
   * Setup Socket.IO middleware for authentication
   */
  setupMiddleware() {
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

        if (!token) {
          return next(new Error('Authentication error: No token provided'));
        }

        // Verify JWT token
        let decoded;
        try {
          decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
          return next(new Error('Authentication error: Invalid token'));
        }

        // Check if token exists in database (Stateful JWT)
        const tokenValid = await TokenRepository.isValid(token);
        if (!tokenValid) {
          return next(new Error('Authentication error: Token has been revoked'));
        }

        // Get user from database
        const user = await UserService.getUserById(decoded.userId);
        if (!user) {
          return next(new Error('Authentication error: User not found'));
        }

        // Attach user info to socket
        socket.userId = decoded.userId;
        socket.user = user;

        next();
      } catch (error) {
        console.error('Socket authentication error:', error);
        next(new Error('Authentication error'));
      }
    });
  }

  /**
   * Setup Socket.IO event handlers
   */
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`User connected: ${socket.userId}`);

      // Join user's personal room
      socket.join(`user:${socket.userId}`);

      /**
       * Handle audio stream start - Initialize audio buffer for a conversation
       * @event audio_stream_start
       * @param {Object} data - Stream start data
       * @param {number} data.consultantId - Consultant ID
       * @param {string} data.audioFormat - Audio format (pcm, opus, etc.) - optional
       * @param {string} data.language - Language code (tr, en, etc.) - optional
       */
      socket.on('audio_stream_start', (data) => {
        try {
          const { consultantId, audioFormat = 'pcm', language = null } = data;

          if (!consultantId) {
            socket.emit('error', {
              success: false,
              error: 'Missing required field: consultantId is required'
            });
            return;
          }

          // Initialize audio buffer for this conversation
          const streamId = `${socket.userId}_${consultantId}`;
          this.audioChunks.set(streamId, {
            consultantId,
            audioFormat,
            language,
            chunks: [],
            startTime: Date.now()
          });

          socket.emit('audio_stream_started', {
            success: true,
            streamId: streamId
          });
        } catch (error) {
          console.error('Error starting audio stream:', error);
          socket.emit('error', {
            success: false,
            error: error.message || 'Internal server error'
          });
        }
      });

      /**
       * Handle audio stream chunk - Receive real-time audio data
       * @event audio_stream_chunk
       * @param {Object} data - Audio chunk data
       * @param {string} data.streamId - Stream ID (from audio_stream_start)
       * @param {string} data.chunk - Base64 encoded audio chunk
       */
      socket.on('audio_stream_chunk', (data) => {
        try {
          const { streamId, chunk } = data;

          if (!streamId || !chunk) {
            socket.emit('error', {
              success: false,
              error: 'Missing required fields: streamId and chunk are required'
            });
            return;
          }

          // Add chunk to buffer
          const streamData = this.audioChunks.get(streamId);
          if (!streamData) {
            socket.emit('error', {
              success: false,
              error: 'Stream not found. Please start audio stream first.'
            });
            return;
          }

          streamData.chunks.push(chunk);
        } catch (error) {
          console.error('Error handling audio chunk:', error);
          socket.emit('error', {
            success: false,
            error: error.message || 'Internal server error'
          });
        }
      });

      /**
       * Handle audio stream end - Process complete audio and generate response
       * @event audio_stream_end
       * @param {Object} data - Stream end data
       * @param {string} data.streamId - Stream ID (from audio_stream_start)
       */
      socket.on('audio_stream_end', async (data) => {
        try {
          const { streamId } = data;

          if (!streamId) {
            socket.emit('error', {
              success: false,
              error: 'Missing required field: streamId is required'
            });
            return;
          }

          // Get stream data
          const streamData = this.audioChunks.get(streamId);
          if (!streamData) {
            socket.emit('error', {
              success: false,
              error: 'Stream not found'
            });
            return;
          }

          // Combine all chunks into single buffer
          const allChunks = streamData.chunks.map(chunk => Buffer.from(chunk, 'base64'));
          const audioBuffer = Buffer.concat(allChunks);

          // Process audio message (transcribe and generate response)
          const response = await RealtimeChatService.processAudioMessage(
            socket.userId,
            streamData.consultantId,
            audioBuffer,
            streamData.audioFormat,
            streamData.language
          );

          // Clean up stream data
          this.audioChunks.delete(streamId);

          // Send response back to user
          socket.emit('audio_response', {
            success: true,
            ...response
          });

          // Trigger 3D animation event when consultant speaks
          socket.emit('animation_trigger', {
            type: 'speak',
            consultantId: streamData.consultantId,
            timestamp: new Date().toISOString()
          });

        } catch (error) {
          console.error('Error handling audio stream end:', error);
          socket.emit('error', {
            success: false,
            error: error.message || 'Internal server error'
          });
        }
      });

      /**
       * Handle disconnect - Clean up audio chunks
       */
      socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.userId}`);
        // Clean up all audio chunks for this user
        for (const [streamId, streamData] of this.audioChunks.entries()) {
          if (streamId.startsWith(`${socket.userId}_`)) {
            this.audioChunks.delete(streamId);
          }
        }
      });

      /**
       * Handle connection error
       */
      socket.on('error', (error) => {
        console.error('Socket error:', error);
      });
    });
  }

  /**
   * Send message to specific user
   * @param {number} userId - User ID
   * @param {string} event - Event name
   * @param {Object} data - Data to send
   */
  sendToUser(userId, event, data) {
    this.io.to(`user:${userId}`).emit(event, data);
  }

  /**
   * Broadcast message to all connected users
   * @param {string} event - Event name
   * @param {Object} data - Data to send
   */
  broadcast(event, data) {
    this.io.emit(event, data);
  }
}

module.exports = SocketHandler;

