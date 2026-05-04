/**
 * Rate Limiting Middleware
 * Production-grade rate limiting for millions of users
 * Prevents API abuse and ensures fair resource usage
 */

const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

// Store configuration for rate limiting
// Production: Use Redis for distributed systems (recommended for multiple server instances)
// Development: Use memory store (default)

let rateLimitStore = undefined; // undefined = use default memory store

// Optional: Redis store for distributed rate limiting (production recommendation)
// Uncomment and configure if using Redis
/*
try {
  const RedisStore = require('rate-limit-redis');
  const redis = require('redis');
  
  if (process.env.REDIS_URL || process.env.REDIS_HOST) {
    const redisClient = redis.createClient({
      url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`,
      password: process.env.REDIS_PASSWORD || undefined,
    });
    
    redisClient.on('error', (err) => {
      console.error('⚠️ [RATE-LIMIT] Redis error, falling back to memory store:', err);
    });
    
    rateLimitStore = new RedisStore({
      client: redisClient,
      prefix: 'rl:mindcoach:',
    });
    
    console.log('✅ [RATE-LIMIT] Using Redis store for distributed rate limiting');
  }
} catch (error) {
  console.warn('⚠️ [RATE-LIMIT] Redis not available, using memory store. Install rate-limit-redis and redis packages for distributed rate limiting.');
}
*/

// If Redis not configured, express-rate-limit will use default memory store automatically

/**
 * General API rate limiter
 * Limits: 100 requests per minute per IP (configurable)
 */
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100, // 100 requests per window
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Skip rate limiting for health checks and metrics
  skip: (req) => req.path === '/health' || req.path === '/metrics',
  // Use Redis store if configured, otherwise use default memory store
  store: rateLimitStore,
  // Custom key generator - use IP + user ID if authenticated (IPv6-safe)
  keyGenerator: (req) => {
    if (req.userId) {
      // Use ipKeyGenerator helper for IPv6 support
      const ipKey = ipKeyGenerator(req);
      return `${ipKey}:user:${req.userId}`;
    }
    // Use ipKeyGenerator helper for IPv6 support
    return ipKeyGenerator(req);
  },
  // Custom handler for rate limit exceeded
  handler: (req, res) => {
    console.warn(`⚠️ [RATE-LIMIT] Rate limit exceeded for ${req.ip} - ${req.method} ${req.path}`);
    res.status(429).json({
      success: false,
      error: 'Too many requests, please try again later.',
      retryAfter: Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000)
    });
  }
});

/**
 * Strict rate limiter for authentication endpoints (login only)
 * Limits: 5 requests per 15 minutes per IP
 * Skip: /auth/verify, /auth/me, /auth/logout (these are not login attempts)
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per 15 minutes
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: rateLimitStore,
  // Use default keyGenerator (IPv6-safe automatically)
  // No custom keyGenerator needed for auth limiter - it uses IP by default
  skipSuccessfulRequests: true, // Don't count successful auth requests
  // Skip rate limiting for non-login endpoints (verify, me, logout, profile, etc.)
  skip: (req) => {
    const path = req.path.toLowerCase();
    return path === '/verify' || 
           path === '/me' || 
           path === '/logout' || 
           path === '/logout-all' ||
           path.startsWith('/profile');
  },
  handler: (req, res) => {
    console.warn(`⚠️ [RATE-LIMIT] Auth rate limit exceeded for ${req.ip}`);
    res.status(429).json({
      success: false,
      error: 'Too many authentication attempts, please try again in 15 minutes.',
      retryAfter: 900
    });
  }
});

/**
 * Strict rate limiter for expensive operations (webhooks, AI processing, POST operations)
 * Limits: 20 requests per minute per user
 */
const expensiveOperationLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 20, // 20 requests per minute
  message: {
    success: false,
    error: 'Too many requests for this operation, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: rateLimitStore,
  // Only apply to POST, PUT, DELETE methods (expensive write operations)
  skip: (req) => req.method === 'GET',
  // Custom key generator - use IP + user ID if authenticated (IPv6-safe)
  keyGenerator: (req) => {
    if (req.userId) {
      return `expensive:user:${req.userId}`;
    }
    // Use ipKeyGenerator helper for IPv6 support
    return `expensive:ip:${ipKeyGenerator(req)}`;
  },
  handler: (req, res) => {
    console.warn(`⚠️ [RATE-LIMIT] Expensive operation rate limit exceeded for user ${req.userId || req.ip}`);
    res.status(429).json({
      success: false,
      error: 'Too many requests for this operation, please wait a moment.',
      retryAfter: Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000)
    });
  }
});

/**
 * Polling/Stream rate limiter for GET operations (chat messages, polling endpoints)
 * Higher limits to support real-time polling behavior
 * Limits: 120 requests per minute per user (2 requests per second)
 */
const pollingLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: parseInt(process.env.POLLING_RATE_LIMIT_MAX) || 120, // 120 requests per minute (2 req/sec)
  message: {
    success: false,
    error: 'Too many polling requests, please reduce polling frequency.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: rateLimitStore,
  // Only apply to GET methods (read operations for polling)
  skip: (req) => req.method !== 'GET',
  // Custom key generator - use IP + user ID if authenticated (IPv6-safe)
  keyGenerator: (req) => {
    if (req.userId) {
      return `polling:user:${req.userId}`;
    }
    // Use ipKeyGenerator helper for IPv6 support
    return `polling:ip:${ipKeyGenerator(req)}`;
  },
  handler: (req, res) => {
    console.warn(`⚠️ [RATE-LIMIT] Polling rate limit exceeded for user ${req.userId || req.ip} - ${req.method} ${req.path}`);
    res.status(429).json({
      success: false,
      error: 'Too many polling requests. Please reduce polling frequency.',
      retryAfter: Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000)
    });
  }
});

module.exports = {
  generalLimiter,
  authLimiter,
  expensiveOperationLimiter,
  pollingLimiter
};
