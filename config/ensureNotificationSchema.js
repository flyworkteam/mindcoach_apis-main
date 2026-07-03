/**
 * Notification Schema Bootstrap
 * ------------------------------------------------------------------
 * Uygulama açılışında bildirim sistemi için gereken tabloların ve
 * kolonların var olduğundan emin olur. Idempotent'tir: eksik olanı
 * ekler, var olana dokunmaz. Tekil kolon eklemeleri (MySQL'de
 * "ADD COLUMN IF NOT EXISTS" olmadığı için) önce bilgi şemasından
 * kontrol edilerek yapılır.
 */

'use strict';

const pool = require('./database');

async function columnExists(table, column) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS c
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0].c > 0;
}

async function indexExists(table, indexName) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS c
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?`,
    [table, indexName]
  );
  return rows[0].c > 0;
}

async function tableExists(table) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS c
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [table]
  );
  return rows[0].c > 0;
}

async function addColumnIfMissing(table, column, definition) {
  if (!(await columnExists(table, column))) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
    console.log(`✅ [NOTIF-SCHEMA] ${table}.${column} kolonu eklendi`);
  }
}

async function addIndexIfMissing(table, indexName, definition) {
  if (!(await indexExists(table, indexName))) {
    await pool.query(`ALTER TABLE \`${table}\` ADD ${definition}`);
    console.log(`✅ [NOTIF-SCHEMA] ${table}.${indexName} index eklendi`);
  }
}

async function ensureNotificationSchema() {
  try {
    // 1) notifications tablosu — yoksa tam şemayla oluştur, varsa eksik kolonları tamamla
    if (!(await tableExists('notifications'))) {
      await pool.query(`
        CREATE TABLE notifications (
          id INT PRIMARY KEY AUTO_INCREMENT,
          user_id INT NOT NULL,
          type VARCHAR(50) NOT NULL DEFAULT 'system_notification',
          category VARCHAR(30) NOT NULL DEFAULT 'system',
          title VARCHAR(255) NOT NULL,
          subtitle TEXT,
          deep_link VARCHAR(255) DEFAULT NULL,
          metadata JSON,
          is_read BOOLEAN NOT NULL DEFAULT false,
          read_at DATETIME DEFAULT NULL,
          sentTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_notif_user (user_id),
          INDEX idx_notif_user_cat (user_id, category),
          INDEX idx_notif_user_time (user_id, sentTime)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✅ [NOTIF-SCHEMA] notifications tablosu oluşturuldu');
    } else {
      await addColumnIfMissing('notifications', 'category', "category VARCHAR(30) NOT NULL DEFAULT 'system' AFTER type");
      await addColumnIfMissing('notifications', 'deep_link', 'deep_link VARCHAR(255) DEFAULT NULL AFTER subtitle');
      await addColumnIfMissing('notifications', 'is_read', 'is_read BOOLEAN NOT NULL DEFAULT false AFTER metadata');
      await addColumnIfMissing('notifications', 'read_at', 'read_at DATETIME DEFAULT NULL AFTER is_read');
      await addIndexIfMissing('notifications', 'idx_notif_user_cat', 'INDEX idx_notif_user_cat (user_id, category)');
      await addIndexIfMissing('notifications', 'idx_notif_user_time', 'INDEX idx_notif_user_time (user_id, sentTime)');
    }

    // 2) notification_preferences
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        user_id INT PRIMARY KEY,
        realtime_enabled BOOLEAN NOT NULL DEFAULT true,
        therapy_enabled BOOLEAN NOT NULL DEFAULT true,
        analysis_enabled BOOLEAN NOT NULL DEFAULT true,
        reengagement_enabled BOOLEAN NOT NULL DEFAULT true,
        subscription_enabled BOOLEAN NOT NULL DEFAULT true,
        system_enabled BOOLEAN NOT NULL DEFAULT true,
        quiet_hours_enabled BOOLEAN NOT NULL DEFAULT true,
        quiet_hours_start TINYINT NOT NULL DEFAULT 22,
        quiet_hours_end TINYINT NOT NULL DEFAULT 8,
        timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Istanbul',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 3) user_notification_suppression
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_notification_suppression (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        reason VARCHAR(50) NOT NULL DEFAULT 'crisis',
        suppressed_until DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_suppress_user (user_id),
        INDEX idx_suppress_until (suppressed_until)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 4) notification_events (zamanlanmış işler için idempotent kilit)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notification_events (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        event_key VARCHAR(120) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_user_event (user_id, event_key),
        INDEX idx_event_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 5) users.last_active_at
    if (await tableExists('users')) {
      await addColumnIfMissing('users', 'last_active_at', 'last_active_at DATETIME DEFAULT NULL');
      await addIndexIfMissing('users', 'idx_users_last_active', 'INDEX idx_users_last_active (last_active_at)');
    }

    console.log('✅ [NOTIF-SCHEMA] Bildirim sistemi şeması hazır');
  } catch (error) {
    // Şema hatası uygulamayı çökertmemeli; loglayıp devam et.
    console.error('❌ [NOTIF-SCHEMA] Şema hazırlanırken hata:', error.message);
  }
}

module.exports = { ensureNotificationSchema };
