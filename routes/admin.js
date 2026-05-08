/**
 * Admin Routes
 *
 * Admin paneli için korumalı endpoint'ler.
 * Tüm rotalar `Authorization: Bearer <ADMIN_API_KEY>` header'ı bekler.
 */

const router = require('express').Router();
const ConsultantService = require('../services/consultantService');
const { adminAuth } = require('../middleware/adminAuth');

router.use(adminAuth);

/**
 * @route GET /admin/consultants/options
 * @desc  Admin panel form'u için tüm seçenek setleri (catalog).
 *        UI: bu endpoint'i bir kere çağırıp dropdown'ları doldurur,
 *             job değişince features / explanations dropdown'larını
 *             featuresByJob[job] / explanationsByJob[job] ile filtreler.
 *
 * @returns {
 *   success: true,
 *   data: {
 *     jobs:              ["family_assistant", ...],
 *     featuresByJob:     { family_assistant: ["family_conflicts", ...], ... },
 *     roles:             ["male", "female"],
 *     explanationsByJob: { family_assistant: ["explanationFamilyAssistant1", ...], ... }
 *   }
 * }
 */
router.get('/consultants/options', (req, res, next) => {
  try {
    const catalog = ConsultantService.getCatalog();
    res.status(200).json({ success: true, data: catalog });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /admin/consultants/jobs
 * @desc  DB'de en az bir rehberi olan rehberlik alanlarının listesi.
 *        (Tüm catalog için /admin/consultants/options kullan.)
 */
router.get('/consultants/jobs', async (req, res, next) => {
  try {
    const jobs = await ConsultantService.getAllJobs();
    res.status(200).json({
      success: true,
      data: { jobs, count: jobs.length },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /admin/consultants
 * @desc  Var olan bir rehberlik alanına (job) yeni rehber ekler.
 * @body  {
 *          names:       { tr: "...", en: "..." },   // zorunlu, en az bir dil
 *          job:         "...",                       // zorunlu, mevcut alanlardan biri
 *          mainPrompt:  "...",                       // zorunlu
 *          photoURL:    "...",                       // opsiyonel
 *          url3d:       "...",                       // opsiyonel (3D avatar URL)
 *          voiceId:     "...",                       // opsiyonel (ElevenLabs)
 *          explanation: "...",                       // opsiyonel
 *          features:    ["...", "..."],              // opsiyonel
 *          roles:       ["...", "..."],              // opsiyonel
 *          rating:      0..5                         // opsiyonel (default 0)
 *        }
 * @returns 201 { success, data: { consultant } }
 *          400 validation error
 *          401/403 auth error
 */
router.post('/consultants', async (req, res, next) => {
  try {
    const consultant = await ConsultantService.createConsultant(req.body || {});
    res.status(201).json({
      success: true,
      data: { consultant: consultant.toFlutterFormat() },
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({
        success: false,
        error: error.message,
        validationErrors: error.validationErrors || null,
      });
    }
    next(error);
  }
});

module.exports = router;
