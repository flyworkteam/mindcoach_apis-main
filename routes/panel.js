/**
 * App Panel Routes (v2)
 *
 * Dış yönetim paneli entegrasyonu — mobil uygulama rotalarından ayrı `/panel` prefix'i.
 * Tüm uçlar panelAuth ile korunur.
 */

const router = require('express').Router();
const { panelAuth } = require('../middleware/panelAuth');
const { maybePanelConsultantUpload } = require('../middleware/panelConsultantUpload');
const PanelService = require('../services/panelService');
const ElevenLabsService = require('../services/elevenLabsService');
const {
  parsePanelAgentBody,
  panelPatchFromAgentBody,
  processConsultantMediaUploads,
  hasMediaFiles,
} = require('./lib/panelConsultantMedia');

router.use(panelAuth);

/** @route GET /panel/health */
router.get('/health', async (req, res, next) => {
  try {
    res.status(200).json(await PanelService.getHealth());
  } catch (error) {
    next(error);
  }
});

/** @route GET /panel/analyse */
router.get('/analyse', async (req, res, next) => {
  try {
    res.status(200).json(await PanelService.getAnalyse());
  } catch (error) {
    next(error);
  }
});

/** @route GET /panel/users */
router.get('/users', async (req, res, next) => {
  try {
    const result = await PanelService.listUsers(req.query.page, req.query.limit);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/** @route GET /panel/users/:id */
router.get('/users/:id', async (req, res, next) => {
  try {
    const includeDetails = String(req.query.includeDetails || '').toLowerCase() === 'true';
    const user = await PanelService.getUserById(req.params.id, includeDetails);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    res.status(200).json({ contractVersion: '2', data: user });
  } catch (error) {
    next(error);
  }
});

/** @route GET /panel/users/:id/details */
router.get('/users/:id/details', async (req, res, next) => {
  try {
    const user = await PanelService.getUserById(req.params.id, true);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    res.status(200).json({ contractVersion: '2', data: user });
  } catch (error) {
    next(error);
  }
});

/**
 * @route PATCH /panel/users/:id
 * @desc  Kısmi güncelleme; extras shallow merge.
 */
router.patch('/users/:id', async (req, res, next) => {
  try {
    const user = await PanelService.updateUserFromPanel(
      req.params.id,
      req.body || {}
    );
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    res.status(200).json({ contractVersion: '2', data: user });
  } catch (error) {
    next(error);
  }
});

/** @route GET /panel/agents/options — form dropdown catalog */
router.get('/agents/options', (req, res, next) => {
  try {
    res.status(200).json({
      contractVersion: '2',
      data: PanelService.getAgentCatalog(),
    });
  } catch (error) {
    next(error);
  }
});

/** @route GET /panel/voices?gender=female|male */
router.get('/voices', async (req, res, next) => {
  try {
    const genderRaw = String(req.query.gender || '').trim().toLowerCase();
    const gender = genderRaw === 'female' || genderRaw === 'male' ? genderRaw : null;
    const voices = await ElevenLabsService.getVoices();

    const mapped = (Array.isArray(voices) ? voices : []).map((v) => {
      const labels = v?.labels || {};
      const g = String(labels.gender || v?.gender || '')
        .trim()
        .toLowerCase();
      return {
        voiceId: v.voice_id || v.voiceId || '',
        name: v.name || 'Unnamed voice',
        gender: g === 'female' || g === 'male' ? g : 'unknown',
        category: v.category || null,
        previewUrl: v.preview_url || null,
      };
    });

    const filteredByGender = gender ? mapped.filter((v) => v.gender === gender) : mapped;
    const filtered = gender && filteredByGender.length === 0 ? mapped : filteredByGender;
    res.status(200).json({
      contractVersion: '2',
      data: filtered,
      meta: {
        gender: gender || 'all',
        total: filtered.length,
        fallbackAllVoices: Boolean(gender && filteredByGender.length === 0),
      },
    });
  } catch (error) {
    next(error);
  }
});

/** @route GET /panel/agents */
router.get('/agents', async (req, res, next) => {
  try {
    const result = await PanelService.listAgents(
      req.query.page,
      req.query.limit
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/** @route GET /panel/agents/:id */
router.get('/agents/:id', async (req, res, next) => {
  try {
    const includeUsers = req.query.includeLinkedUsers !== 'false';
    const agent = await PanelService.getAgentById(req.params.id, includeUsers);
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }
    res.status(200).json({ contractVersion: '2', data: agent });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /panel/agents
 * @body  Consultant create payload (names, job, mainPrompt, ...)
 */
router.post('/agents', maybePanelConsultantUpload, async (req, res, next) => {
  try {
    const body = parsePanelAgentBody(req);
    if (hasMediaFiles(req.files)) {
      Object.assign(body, await processConsultantMediaUploads(req.files, body));
    }
    const agent = await PanelService.createAgent(body);
    res.status(201).json({ contractVersion: '2', data: agent });
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

/** @route PATCH /panel/agents/:id */
router.patch('/agents/:id', maybePanelConsultantUpload, async (req, res, next) => {
  try {
    const body = parsePanelAgentBody(req);
    if (hasMediaFiles(req.files)) {
      Object.assign(body, await processConsultantMediaUploads(req.files, body));
    }
    const agent = await PanelService.updateAgentFromPanel(
      req.params.id,
      panelPatchFromAgentBody(body)
    );
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }
    res.status(200).json({ contractVersion: '2', data: agent });
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
