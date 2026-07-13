/**
 * Premium Routes
 * API endpoints for device-based premium system
 */

const router = require('express').Router();
const PremiumService = require('../services/premiumService');
const { authenticate } = require('../middleware/auth');

/**
 * @route GET /api/v1/premium/device-status/:deviceId
 * @desc Get premium status for a device (public - no auth required)
 * @param {string} deviceId - Device ID (UUID)
 * @returns {Object} Premium status
 */
router.get('/device-status/:deviceId', async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const userIdRaw = req.query.userId;
    const userId = userIdRaw ? parseInt(userIdRaw, 10) : null;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: 'deviceId is required',
      });
    }

    const status = await PremiumService.checkAndValidatePremium(
      deviceId,
      Number.isFinite(userId) ? userId : null,
    );

    res.status(200).json(status);
  } catch (error) {
    console.error('❌ Error getting device premium status:', error);
    next(error);
  }
});

/**
 * @route POST /api/v1/premium/initialize
 * @desc Initialize premium for a device on first app launch (public)
 * @body {Object} { deviceId: string }
 * @returns {Object} Premium status with 3-day trial
 */
router.post('/initialize', async (req, res, next) => {
  try {
    const { deviceId, userId } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: 'deviceId is required',
      });
    }

    const parsedUserId = userId != null ? parseInt(userId, 10) : null;
    const status = await PremiumService.initializeDevice(
      deviceId,
      Number.isFinite(parsedUserId) ? parsedUserId : null,
    );

    res.status(200).json(status);
  } catch (error) {
    console.error('❌ Error initializing device premium:', error);
    next(error);
  }
});

/**
 * @route POST /api/v1/premium/confirm-purchase
 * @desc Confirm in-app purchase and activate premium (public - verified by RevenueCat)
 * @body {Object} { deviceId, userId?, receiptData, packageIdentifier }
 * @returns {Object} Activation result with membership info
 */
router.post('/confirm-purchase', async (req, res, next) => {
  try {
    const {
      deviceId,
      userId,
      receiptData,
      packageIdentifier,
      expiryDate,
      isTrial,
    } = req.body;

    if (!deviceId || !receiptData) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: deviceId, receiptData',
      });
    }

    // TODO: In production, verify receipt with RevenueCat API
    // This is a security-critical operation that should validate the receipt
    // Example: await verifyReceiptWithRevenueCat(receiptData);

    const parsedUserId = userId != null ? parseInt(userId, 10) : null;

    const result = await PremiumService.confirmPurchase({
      deviceId,
      userId: Number.isFinite(parsedUserId) ? parsedUserId : null,
      receiptData,
      packageIdentifier: packageIdentifier ?? null,
      // Flutter RevenueCat listener gerçek bitiş tarihini ve trial bilgisini gönderir.
      expiryDate: expiryDate ?? null,
      isTrial: isTrial === true,
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('❌ Error confirming purchase:', error);
    next(error);
  }
});

/**
 * @route POST /api/v1/premium/revenuecat-webhook
 * @desc RevenueCat abonelik yaşam döngüsü webhook'u (server-to-server).
 *       RevenueCat panelinde tanımlanan Authorization header ile doğrulanır.
 *       Satın alma, yenileme, deneme→ücretli geçiş, iptal, süre dolumu ve
 *       faturalama sorunlarını backend ile senkron tutar.
 * @header Authorization: <REVENUECAT_WEBHOOK_AUTH>
 * @body {Object} RevenueCat event payload ({ event: {...}, api_version })
 */
router.post('/revenuecat-webhook', async (req, res) => {
  try {
    const expected = (process.env.REVENUECAT_WEBHOOK_AUTH || '').trim();

    // Auth opsiyonel: .env'de tanımlıysa doğrula, boşsa devam et.
    if (expected) {
      const provided = req.headers['authorization'];
      if (provided !== expected) {
        console.warn('[RC-WEBHOOK] Geçersiz Authorization header; istek reddedildi.');
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
    }

    const event = req.body && req.body.event ? req.body.event : req.body;
    const result = await PremiumService.applyRevenueCatEvent(event);

    // RC, 2xx dışı yanıtlarda yeniden dener. İşleyemesek bile (ör. anonim ID)
    // 200 dönüp gereksiz retry'ı önlüyoruz; sorunlar loglanıyor.
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('❌ RevenueCat webhook error:', error);
    // Geçici hata → RC retry yapsın diye 500 dön.
    return res.status(500).json({ success: false, error: 'Webhook processing failed' });
  }
});

/**
 * @route GET /api/v1/premium/status
 * @desc Get authenticated user's premium devices
 * @header Authorization: Bearer <token>
 * @returns {Object} List of user's premium devices
 */
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const userId = req.userId;

    const result = await PremiumService.getUserDevices(userId);

    res.status(200).json(result);
  } catch (error) {
    console.error('❌ Error getting user premium status:', error);
    next(error);
  }
});

/**
 * @route POST /api/v1/premium/revoke/:deviceId
 * @desc Revoke premium for a device (admin/user action)
 * @header Authorization: Bearer <token>
 * @param {string} deviceId - Device ID
 * @returns {Object} Revoke result
 */
router.post('/revoke/:deviceId', authenticate, async (req, res, next) => {
  try {
    const { deviceId } = req.params;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: 'deviceId is required',
      });
    }

    // TODO: Verify user owns this device before revoking
    const result = await PremiumService.revokePremium(deviceId);

    res.status(200).json(result);
  } catch (error) {
    console.error('❌ Error revoking premium:', error);
    next(error);
  }
});

module.exports = router;
