const pool = require('../config/database');

class AccountDeletionFeedbackRepository {
  static async ensureTable() {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS account_deletion_feedback (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        reason VARCHAR(255) NULL,
        message TEXT NULL,
        source VARCHAR(64) NULL,
        user_agent VARCHAR(512) NULL,
        ip_address VARCHAR(64) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_adf_user_id (user_id),
        KEY idx_adf_created_at (created_at)
      )
    `);
  }

  static async save({
    userId,
    reason = null,
    message = null,
    source = null,
    userAgent = null,
    ipAddress = null
  }) {
    await this.ensureTable();

    await pool.execute(
      `
        INSERT INTO account_deletion_feedback
          (user_id, reason, message, source, user_agent, ip_address)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [userId, reason, message, source, userAgent, ipAddress]
    );
  }
}

module.exports = AccountDeletionFeedbackRepository;
