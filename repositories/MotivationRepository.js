/**
 * Motivation Repository
 * Database operations for motivations
 */

const pool = require('../config/database');
const Motivation = require('../models/Motivation');
const { executeWithRetry } = require('../utils/dbRetry');

class MotivationRepository {
  /**
   * Map database row to Motivation model
   * @param {Object} row - Database row
   * @returns {Motivation} Motivation instance
   */
  static mapRowToMotivation(row) {
    return new Motivation({
      id: row.id,
      user_id: row.user_id,
      userId: row.user_id,
      date: row.date,
      motivation: row.motivation,
      tavsiye: row.tavsiye,
      reality: row.reality,
      created_at: row.created_at,
      updated_at: row.updated_at
    });
  }

  /**
   * Create a new motivation entry
   * @param {number} userId - User ID
   * @param {string} date - Date in YYYY-MM-DD format
   * @param {string} motivation - Motivation text
   * @param {string} tavsiye - Advice text
   * @param {string} reality - Reality text (optional)
   * @returns {Promise<Motivation>} Created motivation
   */
  static async create(userId, date, motivation, tavsiye, reality = null) {
    return executeWithRetry(async () => {
      try {
        const [result] = await pool.execute(
          `INSERT INTO motivations (user_id, date, motivation, tavsiye, reality)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
           motivation = VALUES(motivation),
           tavsiye = VALUES(tavsiye),
           reality = VALUES(reality),
           updated_at = CURRENT_TIMESTAMP`,
          [userId, date, motivation, tavsiye, reality]
        );

        // If insert was successful, return the created record
        if (result.insertId) {
          return await this.findById(result.insertId);
        } else {
          // If duplicate key, fetch the existing record
          return await this.findByUserIdAndDate(userId, date);
        }
      } catch (error) {
        console.error('Error creating motivation:', error);
        throw error;
      }
    }, 3, 'create motivation');
  }

  /**
   * Find motivation by ID
   * @param {number} id - Motivation ID
   * @returns {Promise<Motivation|null>} Motivation or null
   */
  static async findById(id) {
    return executeWithRetry(async () => {
      try {
        const [rows] = await pool.execute(
          'SELECT * FROM motivations WHERE id = ? LIMIT 1',
          [id]
        );

        if (rows.length === 0) {
          return null;
        }

        return this.mapRowToMotivation(rows[0]);
      } catch (error) {
        console.error('Error finding motivation by ID:', error);
        throw error;
      }
    }, 2, 'findById motivation');
  }

  /**
   * Find motivation by user ID and date
   * @param {number} userId - User ID
   * @param {string} date - Date in YYYY-MM-DD format
   * @returns {Promise<Motivation|null>} Motivation or null
   */
  static async findByUserIdAndDate(userId, date) {
    return executeWithRetry(async () => {
      try {
        const [rows] = await pool.execute(
          'SELECT * FROM motivations WHERE user_id = ? AND date = ? LIMIT 1',
          [userId, date]
        );

        if (rows.length === 0) {
          return null;
        }

        return this.mapRowToMotivation(rows[0]);
      } catch (error) {
        console.error('Error finding motivation by user ID and date:', error);
        throw error;
      }
    }, 2, 'findByUserIdAndDate motivation');
  }

  /**
   * Find all motivations for a user
   * @param {number} userId - User ID
   * @param {Object} options - Query options (limit, offset)
   * @returns {Promise<Array<Motivation>>} Array of motivations
   */
  static async findByUserId(userId, options = {}) {
    return executeWithRetry(async () => {
      try {
        let query = 'SELECT * FROM motivations WHERE user_id = ? ORDER BY date DESC';
        const params = [userId];

        if (options.limit) {
          query += ' LIMIT ?';
          params.push(options.limit);
        }

        if (options.offset) {
          query += ' OFFSET ?';
          params.push(options.offset);
        }

        const [rows] = await pool.execute(query, params);
        return rows.map(row => this.mapRowToMotivation(row));
      } catch (error) {
        console.error('Error finding motivations by user ID:', error);
        throw error;
      }
    }, 2, 'findByUserId motivation');
  }
}

module.exports = MotivationRepository;
