/**
 * Motivations Routes
 * API endpoints for motivation text operations
 */

const router = require('express').Router();
const MotivationService = require('../services/motivationService');
const { authenticate } = require('../middleware/auth');

/**
 * @route GET /motivationtexts
 * @desc Get today's motivation text and advice for the authenticated user
 * @header Authorization: Bearer <token>
 * @returns {Object} { success: true, data: { motivation: string, tavsiye: string } }
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const userId = req.userId;

    // Get today's motivation text
    const result = await MotivationService.getTodayMotivation(userId);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error getting motivation text:', error);
    next(error);
  }
});

module.exports = router;
