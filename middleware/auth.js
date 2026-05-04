/**
 * Authentication Middleware
 * JWT token verification with Stateful JWT (database check)
 */

const jwt = require('jsonwebtoken');
const UserService = require('../services/userService');
const TokenRepository = require('../repositories/TokenRepository');

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

