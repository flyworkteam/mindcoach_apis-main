-- Create premium_devices table for device-based premium system
-- Device ID'si unique ve bir device birden fazla kullanıcı tarafından kullanılabilir
-- Her device'in kendi premium history'si var

CREATE TABLE IF NOT EXISTS premium_devices (
  id INT PRIMARY KEY AUTO_INCREMENT,

  -- Device identification (unique, device'in app silip yüklemeden sonra bile aynı kalır)
  device_id VARCHAR(36) NOT NULL UNIQUE COMMENT 'UUID generated on first app launch',

  -- User association (nullable - device premium almadan önce user linked olmayabilir)
  user_id INT COMMENT 'User who purchased premium, NULL if trial only',

  -- Premium status
  is_premium BOOLEAN NOT NULL DEFAULT false,

  -- Premium expiration and plan info
  expiry_date DATETIME COMMENT 'When premium expires (ISO 8601 formatted)',
  purchased_date DATETIME COMMENT 'When premium was purchased (ISO 8601 formatted)',
  plan_id VARCHAR(50) NOT NULL DEFAULT 'pro' COMMENT 'pro, plus, trial, etc.',

  -- Receipt and purchase verification
  receipt_data TEXT COMMENT 'RevenueCat receipt for verification',
  package_identifier VARCHAR(255) COMMENT 'Package ID from RevenueCat (com.example.app.premium)',

  -- Trial tracking
  is_trial BOOLEAN NOT NULL DEFAULT false COMMENT 'Is this a trial or purchased premium?',
  trial_start_date DATETIME COMMENT 'When 3-day trial started (ISO 8601 formatted)',

  -- Audit timestamps
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Indexes for common queries
  INDEX idx_device_id (device_id),
  INDEX idx_user_id (user_id),
  INDEX idx_is_premium (is_premium),
  INDEX idx_expiry_date (expiry_date),

  -- Foreign key to users table
  CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Device-based premium tracking: device ID persists across app reinstalls and account switches';
