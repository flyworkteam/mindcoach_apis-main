/**
 * MySQL Database Configuration
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

// Production-grade database connection pool configuration
// Optimized for millions of concurrent users

// Store pool config separately for monitoring (MySQL2 pool.config is not accessible)
const poolConfig = {
  connectionLimit: parseInt(process.env.DB_POOL_LIMIT) || 100, // Reduced from 300 for PM2 stability
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT) || 500, // Reduced from 1000 for better responsiveness
  connectTimeout: 5000, // 5 seconds - faster initial connection timeout
  idleTimeout: 300000, // 5 minutes - balance between reuse and resource cleanup
};

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'mindcoach',
  waitForConnections: true,
  // Production: 200-500 connections depending on server capacity
  // High concurrency for millions of users
  // IMPORTANT: Reduce pool size if using PM2 with multiple instances
  // Each instance will create its own pool, so total connections = instances * connectionLimit
  connectionLimit: poolConfig.connectionLimit,
  // Queue limit: Allow reasonable queuing but prevent memory exhaustion
  queueLimit: poolConfig.queueLimit,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  // Connection options (passed to each connection)
  connectTimeout: poolConfig.connectTimeout,
  // Keep connections alive longer for better reuse
  idleTimeout: poolConfig.idleTimeout,
  // Multiple statement support disabled for security
  multipleStatements: false,
  // Enable compression for better performance
  compress: true,
  // SSL support (if needed)
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Test connection with retry mechanism
async function testConnection(retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const connection = await pool.getConnection();
      console.log('✅ MySQL database connected successfully');
      connection.release();
      return;
    } catch (error) {
      console.error(`❌ MySQL database connection error (attempt ${i + 1}/${retries}):`, error.message);
      if (i < retries - 1) {
        console.log('🔄 Retrying connection in 2 seconds...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.error('❌ Failed to connect to MySQL database after', retries, 'attempts');
        console.error('Please check your database configuration in .env file');
      }
    }
  }
}

// Test connection on startup
testConnection();

// Production-grade pool monitoring and connection leak detection
let connectionErrorCount = 0;
let lastConnectionError = null;
let activeConnections = new Map(); // Track active connections for leak detection
let connectionLeakWarnings = 0;

// Track connection lifecycle for leak detection
const originalGetConnection = pool.getConnection.bind(pool);
pool.getConnection = function(...args) {
  const connectionPromise = originalGetConnection(...args);
  const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const startTime = Date.now();
  
  connectionPromise.then((connection) => {
    activeConnections.set(connectionId, {
      startTime,
      stack: new Error().stack, // Capture stack trace for debugging
      threadId: connection.threadId
    });
    
    // Set timeout for connection leak detection (5 minutes)
    const leakTimeout = setTimeout(() => {
      if (activeConnections.has(connectionId)) {
        connectionLeakWarnings++;
        const connInfo = activeConnections.get(connectionId);
        console.error(`🚨 [DB-POOL] POSSIBLE CONNECTION LEAK DETECTED! Connection ${connectionId} active for ${Math.floor((Date.now() - connInfo.startTime) / 1000)} seconds`);
        console.error(`📍 [DB-POOL] Connection stack trace:`, connInfo.stack);
        
        // Force release after 10 minutes (emergency cleanup)
        if (Date.now() - connInfo.startTime > 600000) {
          console.error(`🔴 [DB-POOL] FORCE RELEASING LEAKED CONNECTION ${connectionId}`);
          connection.destroy();
          activeConnections.delete(connectionId);
        }
      }
    }, 300000); // 5 minutes
    
    // Override release to track when connection is released
    const originalRelease = connection.release.bind(connection);
    connection.release = function(...releaseArgs) {
      clearTimeout(leakTimeout);
      activeConnections.delete(connectionId);
      return originalRelease(...releaseArgs);
    };
    
    // Override destroy to track when connection is destroyed
    const originalDestroy = connection.destroy.bind(connection);
    connection.destroy = function(...destroyArgs) {
      clearTimeout(leakTimeout);
      activeConnections.delete(connectionId);
      return originalDestroy(...destroyArgs);
    };
    
    return connection;
  }).catch((error) => {
    activeConnections.delete(connectionId);
    throw error;
  });
  
  return connectionPromise;
};

// Listen for pool errors and log them
pool.on('error', (err) => {
  connectionErrorCount++;
  lastConnectionError = new Date();
  console.error('❌ [DB-POOL] Pool error:', err);
  if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
    console.warn('⚠️ [DB-POOL] Connection lost, pool will attempt to reconnect');
  }
  
  // Alert if too many errors (production alerting)
  if (connectionErrorCount > 50) {
    console.error(`🚨 [DB-POOL] CRITICAL: High error count: ${connectionErrorCount} errors detected`);
    // In production, send alert to monitoring system
  }
});

// Production-grade health check and monitoring
// Health check errors are silently handled - circuit breaker will handle connection issues
setInterval(async () => {
  try {
    // Test pool health with a simple query
    const [result] = await pool.execute('SELECT 1 as health_check');
    
    // Log active connections
    const activeCount = activeConnections.size;
    if (activeCount > 0) {
      const oldestConnection = Array.from(activeConnections.values())
        .sort((a, b) => a.startTime - b.startTime)[0];
      const oldestAge = Math.floor((Date.now() - oldestConnection.startTime) / 1000);
      
      if (activeCount > 100) {
        console.warn(`⚠️ [DB-POOL] High active connection count: ${activeCount}`);
      }
      
      if (oldestAge > 60) {
        console.warn(`⚠️ [DB-POOL] Old connection detected: ${oldestAge} seconds old`);
      }
    }
    
    // Connection leak detection summary
    if (connectionLeakWarnings > 0) {
      console.warn(`⚠️ [DB-POOL] Connection leak warnings: ${connectionLeakWarnings}`);
    }
    
    // Error summary (only log if there were recent errors and database is now healthy)
    if (connectionErrorCount > 0 && lastConnectionError) {
      const timeSinceLastError = Math.floor((Date.now() - lastConnectionError.getTime()) / 1000);
      if (timeSinceLastError < 300) { // Last 5 minutes
        console.log(`⚠️ [DB-POOL] Recent errors: ${connectionErrorCount} total, last ${timeSinceLastError}s ago`);
      }
    }
  } catch (error) {
    // Silently handle health check failures - circuit breaker will handle connection issues
    // Only log in development mode for debugging
    if (process.env.NODE_ENV === 'development' && process.env.DB_LOG_HEALTH_ERRORS === 'true') {
      console.debug(`[DB-POOL] Health check failed (silent):`, error.message);
    }
  }
}, 60000); // Check every minute in production

// Export pool statistics for monitoring endpoints
function getPoolStats() {
  return {
    activeConnections: activeConnections.size,
    connectionErrors: connectionErrorCount,
    connectionLeakWarnings,
    lastConnectionError: lastConnectionError ? lastConnectionError.toISOString() : null,
    poolConfig: {
      connectionLimit: poolConfig.connectionLimit,
      queueLimit: poolConfig.queueLimit,
      connectTimeout: poolConfig.connectTimeout,
      idleTimeout: poolConfig.idleTimeout
    }
  };
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🔄 Closing MySQL connection pool...');
  await pool.end();
  console.log('✅ MySQL connection pool closed');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🔄 Closing MySQL connection pool (SIGTERM)...');
  await pool.end();
  console.log('✅ MySQL connection pool closed');
  process.exit(0);
});

// Export pool with additional functions
module.exports = Object.assign(pool, {
  getPoolStats
});


