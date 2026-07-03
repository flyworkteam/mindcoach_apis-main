/**
 * Notification Suppression Repository
 * Kriz-duyarlılık ve benzeri geçici bloklar. Bir kullanıcı risk sinyali
 * verdiğinde 48 saat boyunca pazarlama/re-engagement bildirimleri durdurulur.
 */

'use strict';

const pool = require('../config/database');

class NotificationSuppressionRepository {
  /**
   * Kullanıcıyı belirtilen süre boyunca (ms) suppress eder.
   * @param {number} userId
   * @param {number} durationMs
   * @param {string} reason
   */
  static async suppress(userId, durationMs, reason = 'crisis') {
    try {
      const until = new Date(Date.now() + durationMs);
      await pool.execute(
        `INSERT INTO user_notification_suppression (user_id, reason, suppressed_until)
         VALUES (?, ?, ?)`,
        [userId, reason, until]
      );
      return until.toISOString();
    } catch (error) {
      console.error('Error creating suppression flag:', error);
      throw error;
    }
  }

  /**
   * Kullanıcı şu an aktif bir suppression altında mı?
   * @returns {Promise<boolean>}
   */
  static async isSuppressed(userId) {
    try {
      const [rows] = await pool.execute(
        `SELECT COUNT(*) AS c FROM user_notification_suppression
          WHERE user_id = ? AND suppressed_until > NOW()`,
        [userId]
      );
      return rows[0].c > 0;
    } catch (error) {
      console.error('Error checking suppression:', error);
      return false; // hata → akışı bloklama
    }
  }

  /**
   * Süresi dolmuş kayıtları temizler (scheduler tarafından çağrılır).
   */
  static async cleanupExpired() {
    try {
      const [result] = await pool.execute(
        'DELETE FROM user_notification_suppression WHERE suppressed_until < NOW()'
      );
      return result.affectedRows;
    } catch (error) {
      console.error('Error cleaning up suppression flags:', error);
      return 0;
    }
  }
}

module.exports = NotificationSuppressionRepository;
