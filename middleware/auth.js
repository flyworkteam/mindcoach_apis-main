/**
 * Authentication Middleware
 * JWT token verification with Stateful JWT (database check)
 */

const jwt = require('jsonwebtoken');
const UserService = require('../services/userService');
const TokenRepository = require('../repositories/TokenRepository');
const UserRepository = require('../repositories/UserRepository');

// Aktiflik güncellemesini throttle et (her istekte DB write yapmamak için)
const ACTIVITY_THROTTLE_MS = 5 * 60 * 1000; // 5 dakika
const lastActivityWrite = new Map();

function trackLastActive(userId) {
  if (!userId) return;
  const now = Date.now();
  const prev = lastActivityWrite.get(userId) || 0;
  if (now - prev < ACTIVITY_THROTTLE_MS) return;
  lastActivityWrite.set(userId, now);
  // Fire-and-forget: yanıtı bloklamaz
  UserRepository.touchLastActive(userId).catch(() => {});
  // Bellek sızıntısını önlemek için ara sıra temizle
  if (lastActivityWrite.size > 50000) {
    for (const [key, ts] of lastActivityWrite) {
      if (now - ts > ACTIVITY_THROTTLE_MS) lastActivityWrite.delete(key);
    }
  }
}

/**
 * Verify JWT token and attach user to request
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No token provided. Please provide a valid JWT token in Authorization header.'
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token is required'
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          error: 'Token has expired'
        });
      } else if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          error: 'Invalid token'
        });
      }
      throw error;
    }

    // Check if token exists in database and is not revoked (Stateful JWT)
    const tokenValid = await TokenRepository.isValid(token);
    if (!tokenValid) {
      return res.status(401).json({
        success: false,
        error: 'Token has been revoked or does not exist in database'
      });
    }

    // Get user from database
    const user = await UserService.getUserById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    // Attach user to request
    req.user = user;
    req.userId = decoded.userId;

    // Aktiflik takibi (throttled, fire-and-forget)
    trackLastActive(decoded.userId);

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

/**
 * Optional authentication - doesn't fail if no token
 * Still checks database if token is provided (Stateful JWT)
 */
const optionalAuthenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      
      try {
        // Verify JWT signature first
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Check database (Stateful JWT)
        const tokenValid = await TokenRepository.isValid(token);
        if (!tokenValid) {
          // Token revoked or not in database, skip authentication
          return next();
        }
        
        const user = await UserService.getUserById(decoded.userId);
        
        if (user) {
          req.user = user;
          req.userId = decoded.userId;
          trackLastActive(decoded.userId);
        }
      } catch (error) {
        // Ignore token errors for optional auth
      }
    }
    
    next();
  } catch (error) {
    next();
  }
};

module.exports = {
  authenticate,
  optionalAuthenticate
};

