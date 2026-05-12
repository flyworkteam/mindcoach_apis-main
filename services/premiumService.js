/**
 * Premium Service
 * Business logic for device-based premium operations
 */

const PremiumDeviceRepository = require('../repositories/PremiumDeviceRepository');
const PremiumDevice = require('../models/PremiumDevice');

class PremiumService {
  /**
   * Initialize / sync premium for a device on app launch or auth transition.
   *
   * Identity model (account-based premium):
   *  - Premium primarily belongs to userId. Cross-device: user logs in
   *    on any device and gets their existing premium.
   *  - If guest (userId=null), premium is tracked only by deviceId.
   *  - Trial uniqueness: a user (lifetime) OR a guest device may consume
   *    one 3-day trial. Account-switching on the same device cannot farm
   *    new trials because the device row's prior trial blocks new ones
   *    via the `findByDeviceId` short-circuit below.
   *
   * @param {string} deviceId
   * @param {number|null} userId
   * @returns {Promise<Object>} Premium status
   */
  static async initializeDevice(deviceId, userId = null) {
    try {
      // 1) User logged in → check for an existing active premium on any device.
      if (userId) {
        const userPremium = await PremiumDeviceRepository.findActivePremiumByUserId(userId);
        if (userPremium && !userPremium.isExpired()) {
          return {
            success: true,
            isPremium: true,
            planId: userPremium.planId,
            daysRemaining: userPremium.getDaysRemaining(),
            expiryDate: userPremium.expiryDate,
            isTrial: userPremium.isTrial,
          };
        }
      }

      // 2) Device already has a row → don't grant new trial. Link userId if missing.
      const existing = await PremiumDeviceRepository.findByDeviceId(deviceId);
      if (existing) {
        if (userId && !existing.userId) {
          await PremiumDeviceRepository.linkUserToDevice(deviceId, userId);
        }
        return this.getPremiumStatus(deviceId, userId);
      }

      // 3) No device row. Trial eligibility: user must not have used one before.
      const userHadTrial = userId
        ? await PremiumDeviceRepository.hasUsedTrialByUserId(userId)
        : false;

      if (userHadTrial) {
        return {
          success: true,
          isPremium: false,
          daysRemaining: 0,
          expiryDate: null,
          isTrial: false,
          reason: 'trial_already_used',
        };
      }

      // 4) Grant new 3-day trial.
      const now = new Date();
      const expiryDate = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

      await PremiumDeviceRepository.createOrUpdate({
        deviceId,
        userId: userId || null,
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
   * Get premium status. Prefers user-scoped lookup when userId is provided.
   * @param {string} deviceId
   * @param {number|null} userId
   */
  static async getPremiumStatus(deviceId, userId = null) {
    try {
      if (userId) {
        const userPremium = await PremiumDeviceRepository.findActivePremiumByUserId(userId);
        if (userPremium && !userPremium.isExpired()) {
          return {
            success: true,
            isPremium: true,
            daysRemaining: userPremium.getDaysRemaining(),
            expiryDate: userPremium.expiryDate,
            planId: userPremium.planId,
            isTrial: userPremium.isTrial,
          };
        }
      }
      const status = await PremiumDeviceRepository.getPremiumStatus(deviceId);
      return { success: true, ...status };
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
   * Check and validate premium. User-scoped if userId given, else device-scoped.
   * Side-effect: marks expired rows as inactive (lazy expiration).
   * @param {string} deviceId
   * @param {number|null} userId
   */
  static async checkAndValidatePremium(deviceId, userId = null) {
    try {
      if (userId) {
        const userPremium = await PremiumDeviceRepository.findActivePremiumByUserId(userId);
        if (userPremium) {
          if (userPremium.isExpired()) {
            await PremiumDeviceRepository.deactivatePremium(userPremium.deviceId);
          } else {
            return {
              success: true,
              isPremium: true,
              daysRemaining: userPremium.getDaysRemaining(),
              expiryDate: userPremium.expiryDate,
              planId: userPremium.planId,
              isTrial: userPremium.isTrial,
            };
          }
        }
      }

      const device = await PremiumDeviceRepository.findByDeviceId(deviceId);
      if (!device) {
        return { success: true, isPremium: false, daysRemaining: 0, expiryDate: null };
      }
      if (device.isPremium && device.isExpired()) {
        await PremiumDeviceRepository.deactivatePremium(deviceId);
        return { success: true, isPremium: false, daysRemaining: 0, expiryDate: null };
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
