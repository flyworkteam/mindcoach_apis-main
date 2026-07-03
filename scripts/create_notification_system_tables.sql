-- ============================================================================
-- MindCoach — Bildirim Sistemi Şeması
-- ----------------------------------------------------------------------------
-- Bu script bildirim revizyonu için gereken tabloları ve kolonları oluşturur.
-- Idempotent olması hedeflenmiştir; tekrar çalıştırılabilir.
-- Manuel çalıştırma:
--   mysql -h <host> -u <user> -p <db> < scripts/create_notification_system_tables.sql
-- NOT: Uygulama açılışında config/ensureNotificationSchema.js aynı işi otomatik yapar.
-- ============================================================================

-- 1) notifications tablosu (yoksa oluştur) --------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1b) Var olan notifications tablosuna eksik kolonları eklemek için:
-- (MySQL "ADD COLUMN IF NOT EXISTS" desteklemez; hata alırsan kolon zaten vardır, atla.)
-- ALTER TABLE notifications ADD COLUMN category VARCHAR(30) NOT NULL DEFAULT 'system' AFTER type;
-- ALTER TABLE notifications ADD COLUMN deep_link VARCHAR(255) DEFAULT NULL AFTER subtitle;
-- ALTER TABLE notifications ADD COLUMN is_read BOOLEAN NOT NULL DEFAULT false AFTER metadata;
-- ALTER TABLE notifications ADD COLUMN read_at DATETIME DEFAULT NULL AFTER is_read;
-- ALTER TABLE notifications ADD INDEX idx_notif_user_cat (user_id, category);
-- ALTER TABLE notifications ADD INDEX idx_notif_user_time (user_id, sentTime);

-- 2) notification_preferences: kullanıcı bazlı kategori opt-out + sessiz saat ----
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id INT PRIMARY KEY,
  realtime_enabled BOOLEAN NOT NULL DEFAULT true,
  therapy_enabled BOOLEAN NOT NULL DEFAULT true,
  analysis_enabled BOOLEAN NOT NULL DEFAULT true,
  reengagement_enabled BOOLEAN NOT NULL DEFAULT true,
  subscription_enabled BOOLEAN NOT NULL DEFAULT true,
  system_enabled BOOLEAN NOT NULL DEFAULT true,
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT true,
  quiet_hours_start TINYINT NOT NULL DEFAULT 22 COMMENT 'Sessiz saat başlangıcı (0-23, yerel saat)',
  quiet_hours_end TINYINT NOT NULL DEFAULT 8 COMMENT 'Sessiz saat bitişi (0-23, yerel saat)',
  timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Istanbul',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifpref_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) user_notification_suppression: kriz-duyarlılık ve benzeri geçici bloklar ----
CREATE TABLE IF NOT EXISTS user_notification_suppression (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  reason VARCHAR(50) NOT NULL DEFAULT 'crisis' COMMENT 'crisis, manual, etc.',
  suppressed_until DATETIME NOT NULL COMMENT 'Bu tarihe kadar pazarlama/re-engagement gönderilmez',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_suppress_user (user_id),
  INDEX idx_suppress_until (suppressed_until),
  CONSTRAINT fk_suppress_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4) notification_events: zamanlanmış işlerin idempotent kilidi (aynı bildirimi
--    iki kez göndermemek için). Örn. "user 5 için 3-gün re-engagement 2026-07-02".
CREATE TABLE IF NOT EXISTS notification_events (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  event_key VARCHAR(120) NOT NULL COMMENT 'Örn. reengage_3d, trial_expiry, appt_reminder_<id>',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_event (user_id, event_key),
  INDEX idx_event_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5) users.last_active_at: aktif/inaktif kullanıcı tespiti için ------------------
-- (Kolon zaten varsa hata verir; sorun değil.)
-- ALTER TABLE users ADD COLUMN last_active_at DATETIME DEFAULT NULL;
-- ALTER TABLE users ADD INDEX idx_users_last_active (last_active_at);
