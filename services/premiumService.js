/**
 * Premium Service
 * Business logic for device-based premium operations
 */

const PremiumDeviceRepository = require('../repositories/PremiumDeviceRepository');
const PremiumDevice = require('../models/PremiumDevice');

class PremiumService {
  /**
   * Initialize premium for a device (on app first launch)
   * @param {string} deviceId - Device ID
   * @returns {Promise<Object>} Premium status
   */
  static async initializeDevice(deviceId) {
    try {
      // Check if device already has premium record
      let device = await PremiumDeviceRepository.findByDeviceId(deviceId);

      if (device) {
        // Device already exists, just return status
        return this.getPremiumStatus(deviceId);
      }

      // Create new device with 3-day trial
      const now = new Date();
      const expiryDate = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // +3 days

      device = await PremiumDeviceRepository.createOrUpdate({
        deviceId,
        userId: null, // Not linked to user until purchase
        isPremium: true,
        expiryDate: expiryDate.toISOString(),
        purchasedDate: null,
        planId: 'trial',
        receiptData: null,
        packageIdentifier: null,
        isTrial: true,
        trialStartDate: now.toISOString(),
      });

      return {
        success: true,
        isPremium: true,
        planId: 'trial',
        daysRemaining: 3,
        expiryDate: expiryDate.toISOString(),
        isTrial: true,
      };
    } catch (error) {
      console.error('❌ Error initializing device premium:', error);
      throw error;
    }
  }

  /**
   * Get premium status for device
   * @param {string} deviceId - Device ID
   * @returns {Promise<Object>}
   */
  static async getPremiumStatus(deviceId) {
    try {
      const status = await PremiumDeviceRepository.getPremiumStatus(deviceId);
      return {
        success: true,
        ...status,
      };
    } catch (error) {
      console.error('❌ Error getting premium status:', error);
      throw error;
    }
  }

  /**
   * Confirm purchase from RevenueCat
   * @param {Object} data - Purchase data from app
   * @returns {Promise<Object>}
   */
  static async confirmPurchase(data) {
    try {
      const {
        deviceId,
        userId,
        receiptData,
        packageIdentifier,
      } = data;

      if (!deviceId || !receiptData) {
        throw new Error('Missing required fields: deviceId, receiptData');
      }

      // In production, you would verify the receipt with RevenueCat here
      // For now, we'll trust the client (should be secured with RevenueCat verification)
      const now = new Date();
      const expiryDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // +1 year

      const device = await PremiumDeviceRepository.createOrUpdate({
        deviceId,
        userId, // Link to user account
        isPremium: true,
        expiryDate: expiryDate.toISOString(),
        purchasedDate: now.toISOString(),
        planId: 'pro',
        receiptData,
        packageIdentifier,
        isTrial: false,
        trialStartDate: null,
      });

      return {
        success: true,
        message: 'Premium activated for device',
        membership: {
          planId: 'pro',
          startDate: now.toISOString(),
          endDate: expiryDate.toISOString(),
          isActive: true,
          daysRemaining: 365,
        },
      };
    } catch (error) {
      console.error('❌ Error confirming purchase:', error);
      throw error;
    }
  }

  /**
   * Check and validate premium for device
   * @param {string} deviceId - Device ID
   * @returns {Promise<Object>}
   */
  static async checkAndValidatePremium(deviceId) {
    try {
      const device = await PremiumDeviceRepository.findByDeviceId(deviceId);

      if (!device) {
        // Device not found, return not premium
        return {
          success: true,
          isPremium: false,
          daysRemaining: 0,
          expiryDate: null,
        };
      }

      // Check if premium has expired
      if (device.isPremium && device.isExpired()) {
        // Deactivate premium
        await PremiumDeviceRepository.deactivatePremium(deviceId);
        return {
          success: true,
          isPremium: false,
          daysRemaining: 0,
          expiryDate: null,
        };
      }

      return {
        success: true,
        isPremium: device.isPremium,
        daysRemaining: device.getDaysRemaining(),
        expiryDate: device.expiryDate,
        planId: device.planId,
        isTrial: device.isTrial,
      };
    } catch (error) {
      console.error('❌ Error checking premium:', error);
      throw error;
    }
  }

  /**
   * Get user's premium devices
   * @param {number} userId - User ID
   * @returns {Promise<Array>}
   */
  static async getUserDevices(userId) {
    try {
      const devices = await PremiumDeviceRepository.findByUserId(userId);
      return {
        success: true,
        devices: devices.map(d => ({
          deviceId: d.deviceId,
          isPremium: d.isPremium && !d.isExpired(),
          daysRemaining: d.getDaysRemaining(),
          expiryDate: d.expiryDate,
          planId: d.planId,
          purchasedDate: d.purchasedDate,
        })),
      };
    } catch (error) {
      console.error('❌ Error getting user devices:', error);
      throw error;
    }
  }

  /**
   * Revoke premium (admin or user request)
   * @param {string} deviceId - Device ID
   * @returns {Promise<Object>}
   */
  static async revokePremium(deviceId) {
    try {
      const success = await PremiumDeviceRepository.deactivatePremium(deviceId);
      return {
        success,
        message: success ? 'Premium revoked' : 'Device not found',
      };
    } catch (error) {
      console.error('❌ Error revoking premium:', error);
      throw error;
    }
  }
}

module.exports = PremiumService;
