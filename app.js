const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const auth = require('./routes/auth');
const consultants = require('./routes/consultants');
const chats = require('./routes/chats');
const appointments = require('./routes/appointments');
const moods = require('./routes/moods');
const notifications = require('./routes/notifications');
const errorHandler = require('./middleware/errorHandler');
const SocketHandler = require('./socket/socketHandler');
const VoiceChatServer = require('./realtime/voiceChatServer');
const VoiceChatServerV2 = require('./realtime/voiceChatServerV2');
const { generalLimiter, authLimiter, expensiveOperationLimiter, pollingLimiter } = require('./middleware/rateLimiter');
const { circuitBreakers, circuitBreakerMiddleware, getCircuitBreakerStats } = require('./middleware/circuitBreaker');
const poolModule = require('./config/database');
require('dotenv').config();

// Initialize database connection
require('./config/database');

const app = express();
const server = http.createServer(app);

// Monitor server connections (declare early for use in timeout handlers)
let activeConnections = 0;

// HTTP Server timeout and keep-alive settings
// Prevent hanging connections and improve connection reuse
// IMPORTANT: These timeouts must be longer than request timeout middleware
server.timeout = parseInt(process.env.SERVER_TIMEOUT) || 120000; // 120 seconds - longer than request timeout
server.keepAliveTimeout = parseInt(process.env.SERVER_KEEP_ALIVE_TIMEOUT) || 125000; // 125 seconds (slightly higher than timeout)
server.headersTimeout = parseInt(process.env.SERVER_HEADERS_TIMEOUT) || 130000; // 130 seconds (must be > keepAliveTimeout)

// Set max connections to prevent overload
server.maxConnections = parseInt(process.env.MAX_CONNECTIONS) || 10000;

// Handle server timeout events
server.on('timeout', (socket) => {
  console.warn(`⚠️ [SERVER] Request timeout - closing socket (active connections: ${activeConnections})`);
  socket.destroy();
});

// Handle connection errors
server.on('clientError', (err, socket) => {
  console.error('❌ [SERVER] Client error:', err.message);
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  } else {
    socket.destroy();
  }
});

// Track connections
server.on('connection', (socket) => {
  activeConnections++;
  
  socket.on('close', () => {
    activeConnections--;
  });
  
  // Set socket timeout to match server timeout
  socket.setTimeout(server.timeout);
});

// Middleware
app.use(express.json({ limit: '10mb' })); // Add size limit to prevent large payloads from hanging
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Production-grade request timeout middleware
// IMPORTANT: This should be shorter than server.timeout
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT) || 110000; // 110 seconds (less than server timeout)
app.use((req, res, next) => {
  const startTime = Date.now();
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      const duration = Date.now() - startTime;
      console.warn(`⚠️ [REQUEST-TIMEOUT] Request timeout after ${duration}ms: ${req.method} ${req.path} from ${req.ip}`);
      console.warn(`⚠️ [REQUEST-TIMEOUT] Active connections: ${activeConnections || 'unknown'}`);
      
      // Try to send timeout response
      try {
        res.status(504).json({
          success: false,
          error: 'Request timeout - the server did not receive a complete request in time'
        });
      } catch (err) {
        // If response already sent or connection closed, just destroy socket
        console.error('❌ [REQUEST-TIMEOUT] Error sending timeout response:', err.message);
        if (req.socket && !req.socket.destroyed) {
          req.socket.destroy();
        }
      }
    }
  }, REQUEST_TIMEOUT);
  
  // Clear timeout when response is sent
  res.on('finish', () => {
    clearTimeout(timeout);
    const duration = Date.now() - startTime;
    if (duration > 5000) { // Log slow requests (>5 seconds)
      console.warn(`⚠️ [SLOW-REQUEST] Slow request: ${req.method} ${req.path} took ${duration}ms`);
    }
  });
  res.on('close', () => clearTimeout(timeout));
  
  next();
});

// Production-grade rate limiting (apply to all routes except health checks)
app.use(generalLimiter);

// CORS middleware (mobil uygulama için gerekli)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Routes with rate limiting and circuit breaker protection
// Authentication routes - stricter rate limiting
app.use('/auth', authLimiter, circuitBreakerMiddleware('database'), auth);

// Chat routes - no rate limiting and no webhook circuit breaker (removed for better user experience)
// Only database circuit breaker remains for protection
app.use('/chats', circuitBreakerMiddleware('database'), chats);
// Video/Stream call - expensive operations only (POST)
app.use('/video-call', expensiveOperationLimiter, circuitBreakerMiddleware('database'), circuitBreakerMiddleware('webhook'), require('./routes/videoCall'));
app.use('/stream-call', expensiveOperationLimiter, circuitBreakerMiddleware('database'), circuitBreakerMiddleware('webhook'), require('./routes/streamCall'));

// Regular routes - general rate limiting and database circuit breaker
app.use('/consultants', circuitBreakerMiddleware('database'), consultants);
app.use('/appointments', circuitBreakerMiddleware('database'), appointments);
app.use('/moods', circuitBreakerMiddleware('database'), moods);
app.use('/notifications', circuitBreakerMiddleware('database'), notifications);
app.use('/motivationtexts', circuitBreakerMiddleware('database'), require('./routes/motivations'));

// Health check endpoint (bypass rate limiting)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    nodeVersion: process.version
  });
});

// Production monitoring endpoint (protected)
app.get('/metrics', (req, res) => {
  // In production, this should be protected with authentication
  const poolStats = poolModule.getPoolStats ? poolModule.getPoolStats() : null;
  const circuitBreakerStats = getCircuitBreakerStats();
  
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: poolStats,
    circuitBreakers: circuitBreakerStats,
    nodeVersion: process.version,
    pid: process.pid
  });
});

// Error handler (en sonda olmalı)
app.use(errorHandler);


// Setup Socket.IO handlers (legacy)



const PORT = process.env.PORT || 3011;

// Graceful shutdown handling
let isShuttingDown = false;

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
  console.error('🚨 [UNCAUGHT-EXCEPTION]', error);
  // Don't exit immediately - allow graceful shutdown
  if (!isShuttingDown) {
    isShuttingDown = true;
    gracefulShutdown('uncaughtException');
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 [UNHANDLED-REJECTION]', reason);
  // Log but don't crash - allow app to continue
  // In production, you might want to restart after too many unhandled rejections
});

// Graceful shutdown function
async function gracefulShutdown(signal) {
  console.log(`🔄 [SHUTDOWN] Received ${signal}, starting graceful shutdown...`);
  
  // Stop accepting new connections
  server.close(() => {
    console.log('✅ [SHUTDOWN] HTTP server closed');
  });
  
  // Close database connections
  try {
    const pool = require('./config/database');
    await pool.end();
    console.log('✅ [SHUTDOWN] Database pool closed');
  } catch (error) {
    console.error('❌ [SHUTDOWN] Error closing database pool:', error);
  }
  
  // Force exit after timeout
  setTimeout(() => {
    console.error('⚠️ [SHUTDOWN] Forcing exit after timeout');
    process.exit(1);
  }, 10000); // 10 seconds max
}

// Handle shutdown signals
process.on('SIGTERM', () => {
  console.log('🔄 [SHUTDOWN] SIGTERM received');
  if (!isShuttingDown) {
    isShuttingDown = true;
    gracefulShutdown('SIGTERM');
  }
});

process.on('SIGINT', () => {
  console.log('🔄 [SHUTDOWN] SIGINT received');
  if (!isShuttingDown) {
    isShuttingDown = true;
    gracefulShutdown('SIGINT');
  }
});

// Start server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server started PORT: ${PORT}`);
  console.log(`✅ Socket.IO server ready for legacy realtime connections`);

  // Sesli sohbet WebSocket sunucusu
  // VOICE_CHAT_VERSION=v2 (varsayılan) → OpenAI Realtime (VAD+STT+LLM) + ElevenLabs WS streaming TTS
  // VOICE_CHAT_VERSION=v1 → legacy pipeline (ElevenLabs STT + n8n + ElevenLabs TTS)
  const wsPort = parseInt(process.env.REALTIME_WS_PORT) || 3001;
  const voiceChatVersion = (process.env.VOICE_CHAT_VERSION || 'v2').toLowerCase();

  if (voiceChatVersion === 'v1') {
    const voiceChatServer = new VoiceChatServer(wsPort);
    voiceChatServer.start();
    console.log(`✅ Voice Chat v1 (legacy) ready on port ${wsPort}`);
  } else {
    const voiceChatServer = new VoiceChatServerV2(wsPort);
    voiceChatServer.start();
    console.log(`✅ Voice Chat v2 (OpenAI+ElevenLabs streaming) ready on port ${wsPort}`);
  }
  
  // Emit ready event for PM2 wait_ready
  if (process.send) {
    process.send('ready');
  }
});

// Handle server errors
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
    process.exit(1);
  } else {
    console.error('❌ Server error:', error);
  }
});

// Log connection count and pool stats periodically
setInterval(() => {
  const poolStats = poolModule.getPoolStats ? poolModule.getPoolStats() : null;
  
  if (activeConnections > 1000) {
    console.warn(`⚠️ [SERVER] High active connection count: ${activeConnections}`);
  }
  
  if (poolStats && poolStats.activeConnections > 80) {
    console.warn(`⚠️ [DB-POOL] High active DB connections: ${poolStats.activeConnections}/${poolStats.poolConfig.connectionLimit}`);
  }
  
  // Log if queue is backing up
  if (poolStats && poolStats.activeConnections >= poolStats.poolConfig.connectionLimit * 0.9) {
    console.warn(`🚨 [DB-POOL] Connection pool near capacity: ${poolStats.activeConnections}/${poolStats.poolConfig.connectionLimit}`);
  }
}, 60000); // Every minute
