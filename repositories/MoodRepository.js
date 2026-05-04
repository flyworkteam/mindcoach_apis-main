/**
 * Mood Repository
 * Database operations for moods
 */

const pool = require('../config/database');
const Mood = require('../models/Mood');

class MoodRepository {
  /**
   * Map database row to Mood model
   * @param {Object} row - Database row
   * @returns {Mood} Mood instance
   */
  static mapRowToMood(row) {
    return new Mood({
      id: row.id,
      userId: row.user_id,
      date: row.date,
      mood: row.mood,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }

  /**
   * Create or update a mood entry
   * @param {number} userId - User ID
   * @param {string} date - Date (YYYY-MM-DD format)
   * @param {number} mood - Mood value (integer)
   * @returns {Promise<Mood>} Created or updated mood
   */
  static async createOrUpdate(userId, date, mood) {
    try {
      // Try to update first (if exists)
      const [updateResult] = await pool.execute(
        `UPDATE moods 
         SET mood = ?, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND date = ?`,
        [mood, userId, date]
      );

      // If no rows were updated, insert new
      if (updateResult.affectedRows === 0) {
        const [insertResult] = await pool.execute(
          `INSERT INTO moods (user_id, date, mood)
           VALUES (?, ?, ?)`,
          [userId, date, mood]
        );
        return await this.findById(insertResult.insertId);
      }

      // Return updated mood
      const [rows] = await pool.execute(
        `SELECT * FROM moods WHERE user_id = ? AND date = ?`,
        [userId, date]
      );

      return this.mapRowToMood(rows[0]);
    } catch (error) {
      console.error('Error creating or updating mood:', error);
      throw error;
    }
  }

  /**
   * Find mood by ID
   * @param {number} id - Mood ID
   * @returns {Promise<Mood|null>} Mood or null
   */
  static async findById(id) {
    try {
      const [rows] = await pool.execute(
        `SELECT * FROM moods WHERE id = ?`,
        [id]
      );

      if (rows.length === 0) {
        return null;
      }

      return this.mapRowToMood(rows[0]);
    } catch (error) {
      console.error('Error finding mood by ID:', error);
      throw error;
    }
  }

  /**
   * Find mood by user ID and date
   * @param {number} userId - User ID
   * @param {string} date - Date (YYYY-MM-DD format)
   * @returns {Promise<Mood|null>} Mood or null
   */
  static async findByUserIdAndDate(userId, date) {
    try {
      const [rows] = await pool.execute(
        `SELECT * FROM moods WHERE user_id = ? AND date = ?`,
        [userId, date]
      );

      if (rows.length === 0) {
        return null;
      }

      return this.mapRowToMood(rows[0]);
    } catch (error) {
      console.error('Error finding mood by user ID and date:', error);
      throw error;
    }
  }

  /**
   * Find moods by user ID
   * @param {number} userId - User ID
   * @param {number} limit - Number of records to retrieve (optional)
   * @param {number} offset - Offset for pagination (optional)
   * @returns {Promise<Array<Mood>>} Array of moods
   */
  static async findByUserId(userId, limit = null, offset = 0) {
    try {
      let query = `SELECT * FROM moods 
                   WHERE user_id = ? 
                   ORDER BY date DESC`;
      
      const params = [userId];
      
      if (limit !== null) {
        query += ` LIMIT ? OFFSET ?`;
        params.push(limit, offset);
      }

      const [rows] = await pool.execute(query, params);

      return rows.map(row => this.mapRowToMood(row));
    } catch (error) {
      console.error('Error finding moods by user ID:', error);
      throw error;
    }
  }

  /**
   * Delete mood by ID
   * @param {number} id - Mood ID
   * @returns {Promise<boolean>} True if deleted
   */
  static async deleteById(id) {
    try {
      const [result] = await pool.execute(
        `DELETE FROM moods WHERE id = ?`,
        [id]
      );

      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting mood:', error);
      throw error;
    }
  }

  /**
   * Delete all moods for a user
   * @param {number} userId - User ID
   * @returns {Promise<number>} Number of deleted moods
   */
  static async deleteByUserId(userId) {
    try {
      const [result] = await pool.execute(
        'DELETE FROM moods WHERE user_id = ?',
        [userId]
      );
      
      return result.affectedRows;
    } catch (error) {
      console.error('Error deleting moods by user ID:', error);
      throw error;
    }
  }
}

module.exports = MoodRepository;

