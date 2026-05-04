/**
 * Moods Routes
 * API endpoints for mood operations
 */

const router = require('express').Router();
const MoodService = require('../services/moodService');
const { authenticate } = require('../middleware/auth');

/**
 * @route POST /moods
 * @desc Create or update mood entry
 * @header Authorization: Bearer <token>
 * @body {string} date - Date (YYYY-MM-DD or ISO format)
 * @body {number} mood - Mood value (integer)
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const userId = req.userId;
    const { date, mood } = req.body;

    // Validate required fields
    if (!date || mood === undefined || mood === null) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: date and mood are required'
      });
    }

    // Create or update mood
    const result = await MoodService.createOrUpdateMood(userId, date, mood);

    res.status(200).json({
      success: true,
      message: 'Mood saved successfully',
      data: result.mood
    });
  } catch (error) {
    console.error('Error creating or updating mood:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * @route GET /moods/user/:userId
 * @desc Get all moods for a user
 * @header Authorization: Bearer <token>
 * @param {number} userId - User ID
 * @query {number} limit - Number of records to retrieve (optional)
 * @query {number} offset - Offset for pagination (optional)
 */
router.get('/user/:userId', authenticate, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const limit = req.query.limit ? parseInt(req.query.limit) : null;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    // Check if user is requesting their own moods
    const tokenUserId = req.userId;
    if (tokenUserId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'You can only access your own moods'
      });
    }

    const moods = await MoodService.getMoodsByUserId(userId, limit, offset);

    res.status(200).json({
      success: true,
      data: moods
    });
  } catch (error) {
    console.error('Error getting user moods:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * @route GET /moods/user/:userId/date/:date
 * @desc Get mood for a specific date
 * @header Authorization: Bearer <token>
 * @param {number} userId - User ID
 * @param {string} date - Date (YYYY-MM-DD or ISO format)
 */
router.get('/user/:userId/date/:date', authenticate, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const date = req.params.date;

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    // Check if user is requesting their own moods
    const tokenUserId = req.userId;
    if (tokenUserId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'You can only access your own moods'
      });
    }

    const mood = await MoodService.getMoodByDate(userId, date);

    if (!mood) {
      return res.status(200).json({
        success: true,
        data: null,
        message: 'No mood entry found for this date'
      });
    }

    res.status(200).json({
      success: true,
      data: mood
    });
  } catch (error) {
    console.error('Error getting mood by date:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * @route DELETE /moods/:id
 * @desc Delete mood entry
 * @header Authorization: Bearer <token>
 * @param {number} id - Mood ID
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.userId;

    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid mood ID'
      });
    }

    const deleted = await MoodService.deleteMood(id, userId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Mood not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Mood deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting mood:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

module.exports = router;

