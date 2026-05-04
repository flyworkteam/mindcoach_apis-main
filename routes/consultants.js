/**
 * Consultants Routes
 * API endpoints for consultant operations
 */

const router = require('express').Router();
const ConsultantService = require('../services/consultantService');
const { optionalAuthenticate } = require('../middleware/auth');

// Apply optional authentication middleware to all routes
router.use(optionalAuthenticate);

/**
 * @route GET /consultants
 * @desc Get all consultants
 * @query {number} limit - Limit number of results (default: 100)
 * @query {number} offset - Offset for pagination (default: 0)
 * @query {string} orderBy - Order by field (default: created_at DESC)
 */
router.get('/', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const orderBy = req.query.orderBy || 'created_at DESC';

    const consultants = await ConsultantService.getAllConsultants({
      limit,
      offset,
      orderBy
    });

    res.status(200).json({
      success: true,
      data: {
        consultants: consultants.map(c => c.toFlutterFormat()),
        count: consultants.length
      }
    });
  } catch (error) {
    console.error('Error getting all consultants:', error);
    next(error);
  }
});

/**
 * @route GET /consultants/:id
 * @desc Get consultant by ID
 * @param {number} id - Consultant ID
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const consultant = await ConsultantService.getConsultantById(id);

    if (!consultant) {
      return res.status(404).json({
        success: false,
        error: 'Consultant not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        consultant: consultant.toFlutterFormat()
      }
    });
  } catch (error) {
    console.error('Error getting consultant by ID:', error);
    next(error);
  }
});

/**
 * @route GET /consultants/job/:job
 * @desc Get consultants by job
 * @param {string} job - Job title
 * @query {number} limit - Limit number of results (default: 100)
 * @query {number} offset - Offset for pagination (default: 0)
 * @query {string} orderBy - Order by field (default: created_at DESC)
 */
router.get('/job/:job', async (req, res, next) => {
  try {
    const { job } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const orderBy = req.query.orderBy || 'created_at DESC';

    const consultants = await ConsultantService.getConsultantsByJob(job, {
      limit,
      offset,
      orderBy
    });

    res.status(200).json({
      success: true,
      data: {
        consultants: consultants.map(c => c.toFlutterFormat()),
        count: consultants.length,
        job: job
      }
    });
  } catch (error) {
    console.error('Error getting consultants by job:', error);
    next(error);
  }
});

/**
 * @route GET /consultants/date/:createdDate
 * @desc Get consultants by created date
 * @param {string} createdDate - Created date (ISO 8601 format, e.g., 2024-01-01)
 * @query {number} limit - Limit number of results (default: 100)
 * @query {number} offset - Offset for pagination (default: 0)
 * @query {string} orderBy - Order by field (default: created_at DESC)
 */
router.get('/date/:createdDate', async (req, res, next) => {
  try {
    const { createdDate } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const orderBy = req.query.orderBy || 'created_at DESC';

    const consultants = await ConsultantService.getConsultantsByCreatedDate(createdDate, {
      limit,
      offset,
      orderBy
    });

    res.status(200).json({
      success: true,
      data: {
        consultants: consultants.map(c => c.toFlutterFormat()),
        count: consultants.length,
        createdDate: createdDate
      }
    });
  } catch (error) {
    console.error('Error getting consultants by created date:', error);
    next(error);
  }
});

module.exports = router;

