/**
 * JWT Utility Functions
 */

const jwt = require('jsonwebtoken');

/**
 * Generate JWT token
 * @param {number} userId - User ID
 * @param {Object} options - Additional options
 * @returns {string} JWT token
 */
function generateToken(userId, options = {}) {
  const payload = {
    userId: userId,
    iat: Math.floor(Date.now() / 1000)
  };

  const tokenOptions = {
    expiresIn: options.expiresIn || process.env.JWT_EXPIRES_IN || '7d',
    issuer: process.env.JWT_ISSUER || 'mindcoach-api',
    audience: process.env.JWT_AUDIENCE || 'mindcoach-app'
  };

  return jwt.sign(payload, process.env.JWT_SECRET, tokenOptions);
}

/**
 * Verify JWT token
 * @param {string} token - JWT token
 * @returns {Object} Decoded token payload
 */
function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, {
    issuer: process.env.JWT_ISSUER || 'mindcoach-api',
    audience: process.env.JWT_AUDIENCE || 'mindcoach-app'
  });
}

/**
 * Decode JWT token without verification
 * @param {string} token - JWT token
 * @returns {Object} Decoded token payload
 */
function decodeToken(token) {
  return jwt.decode(token);
}

module.exports = {
  generateToken,
  verifyToken,
  decodeToken
};

