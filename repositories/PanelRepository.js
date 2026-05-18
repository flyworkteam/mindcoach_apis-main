/**
 * Panel Repository
 * App Panel v2 sözleşmesi için özet metrik ve listeleme sorguları.
 */

const pool = require('../config/database');
const { executeWithRetry } = require('../utils/dbRetry');

const DEFAULT_DAILY_DAYS = parseInt(process.env.PANEL_DAILY_DAYS, 10) || 30;

class PanelRepository {
  static getTimezone() {
    return process.env.PANEL_TIMEZONE || 'Europe/Istanbul';
  }

  /**
   * MySQL session timezone offset for day boundaries (e.g. +03:00).
   */
  static async withTimezone(fn) {
    const tz = this.getTimezone();
    const offset =
      tz === 'Europe/Istanbul' || tz === 'Asia/Istanbul'
        ? '+03:00'
        : '+00:00';
    await pool.execute(`SET time_zone = ?`, [offset]);
    return fn();
  }

  static async countTotalUsers() {
    return executeWithRetry(async () => {
      const [rows] = await pool.execute(
        'SELECT COUNT(*) AS total FROM users'
      );
      return Number(rows[0]?.total || 0);
    }, 2, 'panelCountTotalUsers');
  }

  static async countNewUsersToday() {
    return this.withTimezone(async () => {
      const [rows] = await pool.execute(
        `SELECT COUNT(*) AS total FROM users
         WHERE DATE(account_created_date) = CURDATE()`
      );
      return Number(rows[0]?.total || 0);
    });
  }

  /**
   * Bugün oluşturulan oturum token sayısı (giriş proxy metriği).
   */
  static async countLoginsToday() {
    return this.withTimezone(async () => {
      const [rows] = await pool.execute(
        `SELECT COUNT(*) AS total FROM user_tokens
         WHERE DATE(created_at) = CURDATE()`
      );
      return Number(rows[0]?.total || 0);
    });
  }

  static async getDailyMetrics(days = DEFAULT_DAILY_DAYS) {
    return this.withTimezone(async () => {
      const safeDays = Math.min(Math.max(Number(days) || 30, 7), 90);

      const [loginRows] = await pool.execute(
        `SELECT DATE(created_at) AS day, COUNT(*) AS cnt
         FROM user_tokens
         WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         GROUP BY DATE(created_at)
         ORDER BY day ASC`,
        [safeDays - 1]
      );

      const [newUserRows] = await pool.execute(
        `SELECT DATE(account_created_date) AS day, COUNT(*) AS cnt
         FROM users
         WHERE account_created_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         GROUP BY DATE(account_created_date)
         ORDER BY day ASC`,
        [safeDays - 1]
      );

      const loginMap = new Map(
        loginRows.map((r) => [
          r.day instanceof Date
            ? r.day.toISOString().slice(0, 10)
            : String(r.day).slice(0, 10),
          Number(r.cnt),
        ])
      );
      const newUserMap = new Map(
        newUserRows.map((r) => [
          r.day instanceof Date
            ? r.day.toISOString().slice(0, 10)
            : String(r.day).slice(0, 10),
          Number(r.cnt),
        ])
      );

      const daily = [];
      const today = new Date();
      for (let i = safeDays - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const date = d.toISOString().slice(0, 10);
        daily.push({
          date,
          logins: loginMap.get(date) || 0,
          newUsers: newUserMap.get(date) || 0,
        });
      }

      return daily;
    });
  }

  static async findUsersPaginated(page = 1, limit = 20) {
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offset = (safePage - 1) * safeLimit;

    return executeWithRetry(async () => {
      const [countRows] = await pool.execute(
        'SELECT COUNT(*) AS total FROM users'
      );
      const total = Number(countRows[0]?.total || 0);

      const [rows] = await pool.execute(
        `SELECT u.*,
                (SELECT MAX(ut.created_at) FROM user_tokens ut WHERE ut.user_id = u.id) AS last_login_at,
                (SELECT COUNT(*) > 0 FROM premium_devices pd
                 WHERE pd.user_id = u.id AND pd.is_premium = 1
                   AND (pd.expiry_date IS NULL OR pd.expiry_date > NOW())
                 LIMIT 1) AS is_premium
         FROM users u
         ORDER BY u.id DESC
         LIMIT ? OFFSET ?`,
        [safeLimit, offset]
      );

      return { rows, total, page: safePage, limit: safeLimit };
    }, 2, 'panelFindUsersPaginated');
  }

  static async findUserById(id) {
    return executeWithRetry(async () => {
      const [rows] = await pool.execute(
        `SELECT u.*,
                (SELECT MAX(ut.created_at) FROM user_tokens ut WHERE ut.user_id = u.id) AS last_login_at,
                (SELECT COUNT(*) > 0 FROM premium_devices pd
                 WHERE pd.user_id = u.id AND pd.is_premium = 1
                   AND (pd.expiry_date IS NULL OR pd.expiry_date > NOW())
                 LIMIT 1) AS is_premium
         FROM users u
         WHERE u.id = ?
         LIMIT 1`,
        [id]
      );
      return rows.length > 0 ? rows[0] : null;
    }, 2, 'panelFindUserById');
  }

  static async findAgentsPaginated(page = 1, limit = 20) {
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offset = (safePage - 1) * safeLimit;

    return executeWithRetry(async () => {
      const [countRows] = await pool.execute(
        'SELECT COUNT(*) AS total FROM consultants'
      );
      const total = Number(countRows[0]?.total || 0);

      const [rows] = await pool.execute(
        `SELECT c.*,
                (SELECT COUNT(DISTINCT ch.user_id) FROM chats ch WHERE ch.consultant_id = c.id) AS linked_user_count,
                (SELECT COUNT(*) FROM chats ch WHERE ch.consultant_id = c.id) AS chat_count
         FROM consultants c
         ORDER BY c.id DESC
         LIMIT ? OFFSET ?`,
        [safeLimit, offset]
      );

      return { rows, total, page: safePage, limit: safeLimit };
    }, 2, 'panelFindAgentsPaginated');
  }

  static async findAgentById(id) {
    return executeWithRetry(async () => {
      const [rows] = await pool.execute(
        `SELECT c.*,
                (SELECT COUNT(DISTINCT ch.user_id) FROM chats ch WHERE ch.consultant_id = c.id) AS linked_user_count,
                (SELECT COUNT(*) FROM chats ch WHERE ch.consultant_id = c.id) AS chat_count
         FROM consultants c
         WHERE c.id = ?
         LIMIT 1`,
        [id]
      );
      return rows.length > 0 ? rows[0] : null;
    }, 2, 'panelFindAgentById');
  }

  /**
   * Agent ile etkileşime geçmiş kullanıcılar ("agent sahipleri" = bağlı kullanıcılar).
   */
  static async findAgentLinkedUsers(consultantId, limit = 50) {
    return executeWithRetry(async () => {
      const [rows] = await pool.execute(
        `SELECT u.id, u.username, u.credential, u.account_created_date,
                ch.created_date AS first_chat_date,
                ch.last_message_date
         FROM chats ch
         INNER JOIN users u ON u.id = ch.user_id
         WHERE ch.consultant_id = ?
         ORDER BY ch.last_message_date DESC, ch.id DESC
         LIMIT ?`,
        [consultantId, Math.min(limit, 100)]
      );
      return rows;
    }, 2, 'panelFindAgentLinkedUsers');
  }
}

module.exports = PanelRepository;
