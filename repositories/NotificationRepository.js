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
      const {
        user_id,
        type,
        title,
        subtitle,
        metadata,
        category = 'system',
        deep_link = null,
      } = notificationData;

      const [result] = await pool.execute(
        `INSERT INTO notifications (user_id, type, category, title, subtitle, deep_link, metadata, sentTime)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          user_id,
          type,
          category,
          title,
          subtitle,
          deep_link,
          JSON.stringify(metadata || {})
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
   * Bir kullanıcıya belirli bir kategoride, verilen zaman aralığında kaç bildirim
   * gönderildiğini sayar (frequency-cap için).
   * @param {number} userId
   * @param {string} category
   * @param {number} sinceMs - şu andan geriye doğru milisaniye penceresi
   * @returns {Promise<number>}
   */
  static async countByCategorySince(userId, category, sinceMs) {
    try {
      const sinceDate = new Date(Date.now() - sinceMs);
      const [rows] = await pool.execute(
        `SELECT COUNT(*) AS c FROM notifications
          WHERE user_id = ? AND category = ? AND sentTime >= ?`,
        [userId, category, sinceDate]
      );
      return rows[0].c;
    } catch (error) {
      console.error('Error counting notifications by category:', error);
      return 0;
    }
  }

  /**
   * Belirli bir trigger (JSON metadata.trigger) ile verilen pencerede kaç
   * bildirim gönderildiğini sayar. Aynı içeriğin tekrarını engellemek için.
   */
  static async countByTriggerSince(userId, trigger, sinceMs) {
    try {
      const sinceDate = new Date(Date.now() - sinceMs);
      const [rows] = await pool.execute(
        `SELECT COUNT(*) AS c FROM notifications
          WHERE user_id = ?
            AND sentTime >= ?
            AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.trigger')) = ?`,
        [userId, sinceDate, trigger]
      );
      return rows[0].c;
    } catch (error) {
      console.error('Error counting notifications by trigger:', error);
      return 0;
    }
  }

  /**
   * Bir bildirimi okundu olarak işaretler.
   */
  static async markAsRead(id, userId) {
    try {
      const [result] = await pool.execute(
        `UPDATE notifications SET is_read = true, read_at = NOW()
          WHERE id = ? AND user_id = ?`,
        [id, userId]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw error;
    }
  }

  /**
   * Kullanıcının tüm bildirimlerini okundu işaretler.
   */
  static async markAllAsRead(userId) {
    try {
      const [result] = await pool.execute(
        `UPDATE notifications SET is_read = true, read_at = NOW()
          WHERE user_id = ? AND is_read = false`,
        [userId]
      );
      return result.affectedRows;
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      throw error;
    }
  }

  /**
   * Okunmamış bildirim sayısı.
   */
  static async countUnread(userId) {
    try {
      const [rows] = await pool.execute(
        `SELECT COUNT(*) AS c FROM notifications
          WHERE user_id = ?
            AND is_read = false
            AND COALESCE(type, '') <> 'chat_message'`,
        [userId]
      );
      return rows[0].c;
    } catch (error) {
      console.error('Error counting unread notifications:', error);
      return 0;
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
           AND COALESCE(type, '') <> 'chat_message'
           AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.trigger')), '') <> 'therapist_message'
         ORDER BY sentTime DESC 
         LIMIT ? OFFSET ?`,
        [userId, Number(limit), Number(offset)]
      );

      return rows.map(row => this.mapRowToNotification(row));
    } catch (error) {
      // Eski MySQL sürümlerinde JSON_EXTRACT sorun çıkarırsa type filtresiyle devam et
      console.error('Error finding notifications by user ID (json filter):', error.message);
      try {
        const [rows] = await pool.execute(
          `SELECT * FROM notifications 
           WHERE user_id = ?
             AND COALESCE(type, '') <> 'chat_message'
           ORDER BY sentTime DESC 
           LIMIT ? OFFSET ?`,
          [userId, Number(limit), Number(offset)]
        );
        return rows
          .map(row => this.mapRowToNotification(row))
          .filter((n) => (n.metadata && n.metadata.trigger) !== 'therapist_message');
      } catch (fallbackError) {
        console.error('Error finding notifications by user ID:', fallbackError);
        throw fallbackError;
      }
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
    let metadata = {};
    if (row.metadata) {
      try {
        metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
      } catch (e) {
        metadata = {};
      }
    }
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      category: row.category || 'system',
      title: row.title,
      subtitle: row.subtitle,
      deepLink: row.deep_link || metadata.deepLink || null,
      metadata,
      isRead: row.is_read === 1 || row.is_read === true,
      readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
      sentTime: row.sentTime ? new Date(row.sentTime).toISOString() : null
    };
  }
}

module.exports = NotificationRepository;

