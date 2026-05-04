/**
 * Notification Repository
 * Database operations for notifications table
 */

const pool = require('../config/database');

class NotificationRepository {
  /**
   * Create a new notification record
   * @param {Object} notificationData - Notification data
   * @param {number} notificationData.user_id - User ID
   * @param {string} notificationData.type - Notification type (system_notification, announcement)
   * @param {string} notificationData.title - Notification title
   * @param {string} notificationData.subtitle - Notification subtitle
   * @param {Object} notificationData.metadata - Metadata (JSON object)
   * @returns {Promise<Object>} Created notification record
   */
  static async create(notificationData) {
    try {
      const { user_id, type, title, subtitle, metadata } = notificationData;

      const [result] = await pool.execute(
        `INSERT INTO notifications (user_id, type, title, subtitle, metadata, sentTime)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [
          user_id,
          type,
          title,
          subtitle,
          JSON.stringify(metadata)
        ]
      );

      // Return created notification
      return await this.findById(result.insertId);
    } catch (error) {
      console.error('Error creating notification:', error);
      throw error;
    }
  }

  /**
   * Find notification by ID
   * @param {number} id - Notification ID
   * @returns {Promise<Object|null>} Notification record or null
   */
  static async findById(id) {
    try {
      const [rows] = await pool.execute(
        'SELECT * FROM notifications WHERE id = ?',
        [id]
      );

      if (rows.length === 0) {
        return null;
      }

      return this.mapRowToNotification(rows[0]);
    } catch (error) {
      console.error('Error finding notification by ID:', error);
      throw error;
    }
  }

  /**
   * Find notifications by user ID
   * @param {number} userId - User ID
   * @param {number} limit - Limit results (optional, default: 50)
   * @param {number} offset - Offset for pagination (optional, default: 0)
   * @returns {Promise<Array>} Array of notification records
   */
  static async findByUserId(userId, limit = 50, offset = 0) {
    try {
      const [rows] = await pool.execute(
        `SELECT * FROM notifications 
         WHERE user_id = ? 
         ORDER BY sentTime DESC 
         LIMIT ? OFFSET ?`,
        [userId, limit, offset]
      );

      return rows.map(row => this.mapRowToNotification(row));
    } catch (error) {
      console.error('Error finding notifications by user ID:', error);
      throw error;
    }
  }

  /**
   * Find notifications by type
   * @param {string} type - Notification type (system_notification, announcement)
   * @param {number} limit - Limit results (optional, default: 50)
   * @param {number} offset - Offset for pagination (optional, default: 0)
   * @returns {Promise<Array>} Array of notification records
   */
  static async findByType(type, limit = 50, offset = 0) {
    try {
      const [rows] = await pool.execute(
        `SELECT * FROM notifications 
         WHERE type = ? 
         ORDER BY sentTime DESC 
         LIMIT ? OFFSET ?`,
        [type, limit, offset]
      );

      return rows.map(row => this.mapRowToNotification(row));
    } catch (error) {
      console.error('Error finding notifications by type:', error);
      throw error;
    }
  }

  /**
   * Delete notification by ID
   * @param {number} id - Notification ID
   * @param {number} userId - User ID (to verify ownership)
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  static async deleteById(id, userId) {
    try {
      const [result] = await pool.execute(
        'DELETE FROM notifications WHERE id = ? AND user_id = ?',
        [id, userId]
      );

      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting notification:', error);
      throw error;
    }
  }

  /**
   * Delete all notifications for a user
   * @param {number} userId - User ID
   * @returns {Promise<number>} Number of deleted notifications
   */
  static async deleteAllByUserId(userId) {
    try {
      const [result] = await pool.execute(
        'DELETE FROM notifications WHERE user_id = ?',
        [userId]
      );

      return result.affectedRows;
    } catch (error) {
      console.error('Error deleting all notifications for user:', error);
      throw error;
    }
  }

  /**
   * Map database row to notification object
   * @param {Object} row - Database row
   * @returns {Object} Notification object
   */
  static mapRowToNotification(row) {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      title: row.title,
      subtitle: row.subtitle,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      sentTime: row.sentTime ? new Date(row.sentTime).toISOString() : null
    };
  }
}

module.exports = NotificationRepository;

