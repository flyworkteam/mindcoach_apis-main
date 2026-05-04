/**
 * Token Repository
 * Database operations for user tokens
 */

const pool = require('../config/database');
const crypto = require('crypto');

class TokenRepository {
  /**
   * Create token hash for quick lookup
   * @param {string} token - JWT token
   * @returns {string} Token hash
   */
  static hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Save token to database
   * @param {number} userId - User ID
   * @param {string} token - JWT token
   * @param {Date} expiresAt - Token expiration date
   * @param {Object} options - Additional options (deviceInfo, ipAddress)
   * @returns {Promise<Object>} Created token record
   */
  static async create(userId, token, expiresAt, options = {}) {
    try {
      const tokenHash = this.hashToken(token);
      
      const [result] = await pool.execute(
        `INSERT INTO user_tokens (
          user_id, token, token_hash, expires_at, device_info, ip_address
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          userId,
          token,
          tokenHash,
          expiresAt,
          options.deviceInfo || null,
          options.ipAddress || null
        ]
      );

      return await this.findById(result.insertId);
    } catch (error) {
      console.error('Error creating token:', error);
      throw error;
    }
  }

  /**
   * Find token by token hash with retry mechanism
   * @param {string} token - JWT token
   * @param {number} retries - Number of retries (default: 2)
   * @returns {Promise<Object|null>} Token record or null
   */
  static async findByToken(token, retries = 2) {
    const tokenHash = this.hashToken(token);
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const [rows] = await pool.execute(
          `SELECT * FROM user_tokens 
           WHERE token_hash = ? 
           AND is_revoked = FALSE
           AND expires_at > NOW()
           LIMIT 1`,
          [tokenHash]
        );
        
        return rows.length > 0 ? rows[0] : null;
      } catch (error) {
        // ECONNRESET veya PROTOCOL_CONNECTION_LOST hatası ise retry yap
        if ((error.code === 'ECONNRESET' || 
             error.code === 'PROTOCOL_CONNECTION_LOST' ||
             error.code === 'ETIMEDOUT') && 
            attempt < retries) {
          console.warn(`⚠️ Connection error (attempt ${attempt + 1}/${retries + 1}), retrying...`, error.code);
          // Kısa bir bekleme sonrası tekrar dene
          await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
          continue;
        }
        
        // Son deneme veya farklı bir hata
        console.error('Error finding token:', error);
        throw error;
      }
    }
    
    return null;
  }

  /**
   * Find token by ID
   * @param {number} id - Token ID
   * @returns {Promise<Object|null>} Token record or null
   */
  static async findById(id) {
    try {
      const [rows] = await pool.execute(
        'SELECT * FROM user_tokens WHERE id = ? LIMIT 1',
        [id]
      );
      
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error finding token by ID:', error);
      throw error;
    }
  }

  /**
   * Find all active tokens for a user
   * @param {number} userId - User ID
   * @returns {Promise<Array>} Array of token records
   */
  static async findByUserId(userId) {
    try {
      const [rows] = await pool.execute(
        `SELECT * FROM user_tokens 
         WHERE user_id = ? 
         AND is_revoked = FALSE
         AND expires_at > NOW()
         ORDER BY created_at DESC`,
        [userId]
      );
      
      return rows;
    } catch (error) {
      console.error('Error finding tokens by user ID:', error);
      throw error;
    }
  }

  /**
   * Revoke token (logout)
   * @param {string} token - JWT token
   * @returns {Promise<boolean>} Success status
   */
  static async revoke(token) {
    try {
      const tokenHash = this.hashToken(token);
      
      const [result] = await pool.execute(
        `UPDATE user_tokens 
         SET is_revoked = TRUE, revoked_at = NOW()
         WHERE token_hash = ? AND is_revoked = FALSE`,
        [tokenHash]
      );
      
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error revoking token:', error);
      throw error;
    }
  }

  /**
   * Revoke all tokens for a user (logout from all devices)
   * @param {number} userId - User ID
   * @returns {Promise<number>} Number of revoked tokens
   */
  static async revokeAll(userId) {
    try {
      const [result] = await pool.execute(
        `UPDATE user_tokens 
         SET is_revoked = TRUE, revoked_at = NOW()
         WHERE user_id = ? AND is_revoked = FALSE`,
        [userId]
      );
      
      return result.affectedRows;
    } catch (error) {
      console.error('Error revoking all tokens:', error);
      throw error;
    }
  }

  /**
   * Delete expired tokens (cleanup)
   * @returns {Promise<number>} Number of deleted tokens
   */
  static async deleteExpired() {
    try {
      const [result] = await pool.execute(
        'DELETE FROM user_tokens WHERE expires_at < NOW()',
        []
      );
      
      return result.affectedRows;
    } catch (error) {
      console.error('Error deleting expired tokens:', error);
      throw error;
    }
  }

  /**
   * Check if token is valid (exists, not revoked, not expired)
   * @param {string} token - JWT token
   * @returns {Promise<boolean>} True if token is valid
   */
  static async isValid(token) {
    try {
      const tokenRecord = await this.findByToken(token);
      return tokenRecord !== null;
    } catch (error) {
      // Connection hatalarında false döndür (token geçersiz sayılır)
      if (error.code === 'ECONNRESET' || 
          error.code === 'PROTOCOL_CONNECTION_LOST' ||
          error.code === 'ETIMEDOUT') {
        console.warn('⚠️ Database connection error while checking token validity, treating as invalid');
        return false;
      }
      console.error('Error checking token validity:', error);
      return false;
    }
  }
}

module.exports = TokenRepository;

