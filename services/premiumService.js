/**
 * Premium Service
 * Business logic for device-based premium operations
 */

const PremiumDeviceRepository = require('../repositories/PremiumDeviceRepository');
const PremiumDevice = require('../models/PremiumDevice');
const { resolvePlan, isTrialPeriod } = require('../config/revenueCatCatalog');

/** Güvenli tarih parse: ISO string veya Date → geçerli Date | null */
function parseDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

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
        expiryDate: expiryDateRaw, // client (RevenueCat) gerçek bitiş tarihi
        isTrial: isTrialRaw,       // client (RevenueCat) deneme mi?
      } = data;

      if (!deviceId || !receiptData) {
        throw new Error('Missing required fields: deviceId, receiptData');
      }

      const now = new Date();

      // Plan bilgisini ürün ID'sinden çöz (monthly/yearly vs.).
      const { planId, durationDays } = resolvePlan(packageIdentifier);

      // Bitiş tarihi önceliği:
      // 1) Client'ın RevenueCat'ten aldığı GERÇEK expiry (3 gün deneme dahil doğru).
      // 2) Fallback: plan süresine göre hesapla (ASLA sabit +1 yıl değil).
      const clientExpiry = parseDate(expiryDateRaw);
      const expiryDate = clientExpiry
        || new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

      const isTrial = isTrialRaw === true;
      const daysRemaining = Math.max(
        0,
        Math.ceil((expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
      );

      await PremiumDeviceRepository.createOrUpdate({
        deviceId,
        userId: userId ?? null, // Link to user account
        isPremium: true,
        expiryDate: expiryDate.toISOString(),
        purchasedDate: now.toISOString(),
        planId,
        receiptData,
        packageIdentifier: packageIdentifier ?? null,
        isTrial,
        trialStartDate: isTrial ? now.toISOString() : null,
      });

      return {
        success: true,
        message: 'Premium activated for device',
        membership: {
          planId,
          startDate: now.toISOString(),
          endDate: expiryDate.toISOString(),
          isActive: true,
          isTrial,
          daysRemaining,
        },
      };
    } catch (error) {
      console.error('❌ Error confirming purchase:', error);
      throw error;
    }
  }

  /**
   * RevenueCat webhook event'ini işler (server-to-server, yetkili kaynak).
   *
   * RevenueCat, abonelik yaşam döngüsündeki her olayda (satın alma, yenileme,
   * deneme→ücretli geçiş, iptal, süre dolumu, faturalama sorunu) bu endpoint'i
   * çağırır. Uygulama kapalıyken bile durum senkron kalır.
   *
   * @param {Object} event - RevenueCat event body'sindeki `event` nesnesi
   * @returns {Promise<Object>} İşlem özeti
   */
  static async applyRevenueCatEvent(event) {
    if (!event || typeof event !== 'object') {
      return { handled: false, reason: 'empty_event' };
    }

    const type = String(event.type || '').toUpperCase();
    const appUserId = event.app_user_id;

    // app_user_id = bizim userId (Flutter Purchases.logIn(userId) çağırıyor).
    // Anonim ($RCAnonymousID:...) veya sayısal olmayan ID'leri eşleyemeyiz.
    const userId = /^\d+$/.test(String(appUserId || '')) ? parseInt(appUserId, 10) : null;
    if (!userId) {
      console.warn(`[RC-WEBHOOK] Eşlenemeyen app_user_id='${appUserId}' (type=${type}). Atlanıyor.`);
      return { handled: false, reason: 'unmapped_app_user_id', type };
    }

    const { planId } = resolvePlan(event.product_id);
    const expiry = event.expiration_at_ms ? new Date(Number(event.expiration_at_ms)) : null;
    const purchased = event.purchased_at_ms ? new Date(Number(event.purchased_at_ms)) : null;
    const isTrial = isTrialPeriod(event.period_type);

    // Premium'u SONLANDIRAN event'ler.
    const DEACTIVATE = new Set(['EXPIRATION', 'SUBSCRIPTION_PAUSED']);
    // Premium'u KURAN/UZATAN event'ler.
    const ACTIVATE = new Set([
      'INITIAL_PURCHASE',
      'RENEWAL',
      'PRODUCT_CHANGE',
      'UNCANCELLATION',
      'NON_RENEWING_PURCHASE',
    ]);

    if (DEACTIVATE.has(type)) {
      const rows = await PremiumDeviceRepository.applyStatusByUserId(userId, {
        isPremium: false,
        expiryDate: expiry ? expiry.toISOString() : new Date().toISOString(),
        planId,
        isTrial: false,
      });
      console.log(`[RC-WEBHOOK] ${type} → userId=${userId} premium kapatıldı (rows=${rows}).`);
      return { handled: true, type, userId, isPremium: false };
    }

    if (ACTIVATE.has(type)) {
      // expiry gelmemişse (nadiren) premium'a dokunma, sadece logla.
      if (!expiry) {
        console.warn(`[RC-WEBHOOK] ${type} için expiration_at_ms yok (userId=${userId}). Atlanıyor.`);
        return { handled: false, reason: 'missing_expiry', type, userId };
      }
      const isActive = expiry.getTime() > Date.now();
      const rows = await PremiumDeviceRepository.applyStatusByUserId(userId, {
        isPremium: isActive,
        expiryDate: expiry.toISOString(),
        purchasedDate: purchased ? purchased.toISOString() : null,
        planId,
        isTrial,
      });
      console.log(
        `[RC-WEBHOOK] ${type} → userId=${userId} premium=${isActive} trial=${isTrial} `
          + `expiry=${expiry.toISOString()} (rows=${rows}).`,
      );
      return { handled: true, type, userId, isPremium: isActive, isTrial };
    }

    // CANCELLATION (auto-renew kapatıldı ama süre dolana kadar erişim sürer),
    // BILLING_ISSUE (grace period), TEST vb. → premium'a dokunma. EXPIRATION
    // event'i geldiğinde asıl kapatma yapılır.
    console.log(`[RC-WEBHOOK] ${type} (userId=${userId}) bilgilendirme amaçlı, premium değiştirilmedi.`);
    return { handled: true, type, userId, noChange: true };
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
            // Kullanıcının tüm cihaz satırlarını kapat (tek cihaz değil).
            await PremiumDeviceRepository.applyStatusByUserId(userId, {
              isPremium: false,
              expiryDate: userPremium.expiryDate,
              planId: userPremium.planId,
              isTrial: false,
            });
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
