-- Add nullable age column to users table
-- Safe to run multiple times on MySQL 8+.

ALTER TABLE users
ADD COLUMN IF NOT EXISTS age TINYINT UNSIGNED NULL AFTER id;

