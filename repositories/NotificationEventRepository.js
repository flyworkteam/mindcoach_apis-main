/**
 * Notification Event Repository
 * Zamanlanmış (cron) bildirimlerin idempotent kilidi. Aynı olayın (örn.
 * bir kullanıcının 3-gün re-engagement'ı, bir randevunun 15 dk hatırlatması)
 * yalnızca bir kez gönderilmesini sağlar.
 */

'use strict';

const pool = require('../config/database');

class NotificationEventRepository {
  /**
   * Olay daha önce işaretlenmişse false, yeni işaretlendiyse true döner.
   * (INSERT IGNORE + affectedRows ile yarış koşulundan güvenli.)
   * @param {number} userId
   * @param {string} eventKey - örn. 'reengage_3d:2026-07-02' veya 'appt_reminder_45'
   * @returns {Promise<boolean>} true → ilk kez, gönderilebilir
   */
  static async claim(userId, eventKey) {
    try {
      const [result] = await pool.execute(
        `INSERT IGNORE INTO notification_events (user_id, event_key) VALUES (?, ?)`,
        [userId, eventKey]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error claiming notification event:', error);
      return false; // hata → tekrar göndermemek için güvenli taraf
    }
  }

  /**
   * Belirli bir event_key önekine sahip eski kayıtları temizler (opsiyonel bakım).
   */
  static async cleanupOlderThan(days = 120) {
    try {
      const [result] = await pool.execute(
        'DELETE FROM notification_events WHERE created_at < (NOW() - INTERVAL ? DAY)',
        [days]
      );
      return result.affectedRows;
    } catch (error) {
      console.error('Error cleaning up notification events:', error);
      return 0;
    }
  }
}

module.exports = NotificationEventRepository;
