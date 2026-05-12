/**
 * Premium Device Repository
 * Database operations for device-based premium tracking
 */

const pool = require('../config/database');
const { executeWithRetry } = require('../utils/dbRetry');
const PremiumDevice = require('../models/PremiumDevice');

class PremiumDeviceRepository {
  /**
   * Find premium device by device ID
   * @param {string} deviceId - Device ID (UUID)
   * @returns {Promise<PremiumDevice|null>}
   */
  static async findByDeviceId(deviceId) {
    return executeWithRetry(async () => {
      const [rows] = await pool.execute(
        `SELECT * FROM premium_devices
         WHERE device_id = ?
         LIMIT 1`,
        [deviceId]
      );

      return rows.length > 0 ? new PremiumDevice(rows[0]) : null;
    }, 2, 'findByDeviceId');
  }

  /**
   * Find all premium devices for a user
   * @param {number} userId - User ID
   * @returns {Promise<PremiumDevice[]>}
   */
  static async findByUserId(userId) {
    return executeWithRetry(async () => {
      const [rows] = await pool.execute(
        `SELECT * FROM premium_devices
         WHERE user_id = ?
         ORDER BY created_at DESC`,
        [userId]
      );

      return rows.map(row => new PremiumDevice(row));
    }, 2, 'findByUserId');
  }

  /**
   * Create or update premium device record
   * @param {Object} data - Premium device data
   * @returns {Promise<PremiumDevice>}
   */
  static async createOrUpdate(data) {
    return executeWithRetry(async () => {
      const {
        deviceId,
        userId,
        isPremium,
        expiryDate,
        purchasedDate,
        planId,
        receiptData,
        packageIdentifier,
        isTrial,
        trialStartDate,
      } = data;

      // Check if device already exists
      const existing = await this.findByDeviceId(deviceId);
      const now = new Date().toISOString();

      if (existing) {
        // Update existing record
        const [result] = await pool.execute(
          `UPDATE premium_devices
           SET user_id = ?,
               is_premium = ?,
               expiry_date = ?,
               purchased_date = ?,
               plan_id = ?,
               receipt_data = ?,
               package_identifier = ?,
               is_trial = ?,
               trial_start_date = ?,
               updated_at = ?
           WHERE device_id = ?`,
          [
            userId,
            isPremium,
            expiryDate,
            purchasedDate,
            planId,
            receiptData,
            packageIdentifier,
            isTrial,
            trialStartDate,
            now,
            deviceId,
          ]
        );

        return new PremiumDevice({
          ...data,
          createdAt: existing.createdAt,
          updatedAt: now,
        });
      } else {
        // Create new record
        const [result] = await pool.execute(
          `INSERT INTO premium_devices
           (device_id, user_id, is_premium, expiry_date, purchased_date,
            plan_id, receipt_data, package_identifier, is_trial, trial_start_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            deviceId,
            userId,
            isPremium,
            expiryDate,
            purchasedDate,
            planId,
            receiptData,
            packageIdentifier,
            isTrial,
            trialStartDate,
            now,
            now,
          ]
        );

        return new PremiumDevice({
          id: result.insertId,
          ...data,
          createdAt: now,
          updatedAt: now,
        });
      }
    }, 2, 'createOrUpdate');
  }

  /**
   * Find the most recent active premium row for a user (any device).
   * Used for cross-device premium: user logs in on a new device and we
   * find their existing entitlement.
   * @param {number} userId
   * @returns {Promise<PremiumDevice|null>}
   */
  static async findActivePremiumByUserId(userId) {
    return executeWithRetry(async () => {
      const [rows] = await pool.execute(
        `SELECT * FROM premium_devices
         WHERE user_id = ? AND is_premium = 1
         ORDER BY expiry_date DESC
         LIMIT 1`,
        [userId]
      );
      return rows.length > 0 ? new PremiumDevice(rows[0]) : null;
    }, 2, 'findActivePremiumByUserId');
  }

  /**
   * Has this user ever consumed a trial (on any device)?
   * @param {number} userId
   * @returns {Promise<boolean>}
   */
  static async hasUsedTrialByUserId(userId) {
    return executeWithRetry(async () => {
      const [rows] = await pool.execute(
        `SELECT 1 FROM premium_devices
         WHERE user_id = ? AND is_trial = 1
         LIMIT 1`,
        [userId]
      );
      return rows.length > 0;
    }, 2, 'hasUsedTrialByUserId');
  }

  /**
   * Link an existing guest device row (user_id IS NULL) to a user.
   * No-op if the row already has a user_id.
   * @param {string} deviceId
   * @param {number} userId
   */
  static async linkUserToDevice(deviceId, userId) {
    return executeWithRetry(async () => {
      const now = new Date().toISOString();
      await pool.execute(
        `UPDATE premium_devices
         SET user_id = ?, updated_at = ?
         WHERE device_id = ? AND user_id IS NULL`,
        [userId, now, deviceId]
      );
    }, 2, 'linkUserToDevice');
  }

  /**
   * Check if device has active premium
   * @param {string} deviceId - Device ID
   * @returns {Promise<boolean>}
   */
  static async hasActivePremium(deviceId) {
    return executeWithRetry(async () => {
      const device = await this.findByDeviceId(deviceId);
      if (!device) return false;
      if (!device.isPremium) return false;
      return !device.isExpired();
    }, 2, 'hasActivePremium');
  }

  /**
   * Get premium status and days remaining
   * @param {string} deviceId - Device ID
   * @returns {Promise<{isPremium: boolean, daysRemaining: number, expiryDate: string|null}>}
   */
  static async getPremiumStatus(deviceId) {
    return executeWithRetry(async () => {
      const device = await this.findByDeviceId(deviceId);

      if (!device) {
        return {
          isPremium: false,
          daysRemaining: 0,
          expiryDate: null,
        };
      }

      const isExpired = device.isExpired();
      return {
        isPremium: device.isPremium && !isExpired,
        daysRemaining: isExpired ? 0 : device.getDaysRemaining(),
        expiryDate: device.expiryDate,
        planId: device.planId,
      };
    }, 2, 'getPremiumStatus');
  }

  /**
   * Deactivate premium for device (when expired)
   * @param {string} deviceId - Device ID
   * @returns {Promise<boolean>}
   */
  static async deactivatePremium(deviceId) {
    return executeWithRetry(async () => {
      const now = new Date().toISOString();
      const [result] = await pool.execute(
        `UPDATE premium_devices
         SET is_premium = 0, updated_at = ?
         WHERE device_id = ?`,
        [now, deviceId]
      );

      return result.affectedRows > 0;
    }, 2, 'deactivatePremium');
  }

  /**
   * Delete premium device record
   * @param {string} deviceId - Device ID
   * @returns {Promise<boolean>}
   */
  static async delete(deviceId) {
    return executeWithRetry(async () => {
      const [result] = await pool.execute(
        'DELETE FROM premium_devices WHERE device_id = ?',
        [deviceId]
      );

      return result.affectedRows > 0;
    }, 2, 'delete');
  }
}

module.exports = PremiumDeviceRepository;
