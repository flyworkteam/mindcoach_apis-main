/**
 * Notifications Routes
 * Handles notification-related endpoints
 */

const router = require('express').Router();
const authenticate = require('../middleware/auth').authenticate;
const OneSignalService = require('../services/oneSignalService');
const NotificationRepository = require('../repositories/NotificationRepository');
const UserService = require('../services/userService');

/**
 * @route POST /notifications/send
 * @desc Send notification to specific user(s) via OneSignal and save to database
 * @header Authorization: Bearer <token>
 * @body {number|number[]} userIds - User ID(s) to send notification to
 * @body {string} title - Notification title
 * @body {string} subtitle - Notification subtitle/body
 * @body {string} type - Notification type: 'system_notification' or 'announcement' (optional, default: 'system_notification')
 * @body {Object} metadata - Additional metadata (optional, default: {})
 */
router.post('/send', authenticate, async (req, res, next) => {
  try {
    const { userIds, title, subtitle, type = 'system_notification', metadata = {} } = req.body;

    // Validation
    if (!userIds || !title || !subtitle) {
      return res.status(400).json({
        success: false,
        error: 'userIds, title, and subtitle are required'
      });
    }

    if (!['system_notification', 'announcement'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'type must be either "system_notification" or "announcement"'
      });
    }

    // Convert single userId to array
    const userIdArray = Array.isArray(userIds) ? userIds : [userIds];

    // Validate that all users exist
    for (const userId of userIdArray) {
      const user = await UserService.getUserById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: `User with ID ${userId} not found`
        });
      }
    }

    // Send notification via OneSignal
    let oneSignalResult = null;
    try {
      oneSignalResult = await OneSignalService.sendNotification(
        userIdArray,
        title,
        subtitle,
        metadata,
        type
      );
    } catch (oneSignalError) {
      console.error('⚠️ OneSignal error (continuing to save to DB):', oneSignalError.message);
      // Continue even if OneSignal fails - we still want to save to database
    }

    // Save notification to database for each user
    const savedNotifications = [];
    for (const userId of userIdArray) {
      try {
        const notification = await NotificationRepository.create({
          user_id: userId,
          type: type,
          title: title,
          subtitle: subtitle,
          metadata: {
            ...metadata,
            oneSignalId: oneSignalResult?.oneSignalId || null
          }
        });
        savedNotifications.push(notification);
      } catch (dbError) {
        console.error(`⚠️ Error saving notification for user ${userId}:`, dbError.message);
        // Continue with other users even if one fails
      }
    }

    res.status(200).json({
      success: true,
      data: {
        notifications: savedNotifications,
        oneSignal: oneSignalResult
      },
      message: `Notification sent to ${savedNotifications.length} user(s)`
    });
  } catch (error) {
    console.error('Notification send error:', error);
    next(error);
  }
});

/**
 * @route POST /notifications/broadcast
 * @desc Send broadcast notification to all users via OneSignal
 * @header Authorization: Bearer <token>
 * @body {string} title - Notification title
 * @body {string} subtitle - Notification subtitle/body
 * @body {string} type - Notification type: 'system_notification' or 'announcement' (optional, default: 'announcement')
 * @body {Object} metadata - Additional metadata (optional, default: {})
 */
router.post('/broadcast', authenticate, async (req, res, next) => {
  try {
    const { title, subtitle, type = 'announcement', metadata = {} } = req.body;

    // Validation
    if (!title || !subtitle) {
      return res.status(400).json({
        success: false,
        error: 'title and subtitle are required'
      });
    }

    if (!['system_notification', 'announcement'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'type must be either "system_notification" or "announcement"'
      });
    }

    // Send broadcast notification via OneSignal
    let oneSignalResult = null;
    try {
      oneSignalResult = await OneSignalService.sendBroadcastNotification(
        title,
        subtitle,
        metadata,
        type
      );
    } catch (oneSignalError) {
      console.error('⚠️ OneSignal broadcast error:', oneSignalError.message);
      return res.status(500).json({
        success: false,
        error: `Failed to send broadcast notification: ${oneSignalError.message}`
      });
    }

    res.status(200).json({
      success: true,
      data: {
        oneSignal: oneSignalResult
      },
      message: 'Broadcast notification sent successfully'
    });
  } catch (error) {
    console.error('Notification broadcast error:', error);
    next(error);
  }
});

/**
 * @route GET /notifications
 * @desc Get notifications for authenticated user
 * @header Authorization: Bearer <token>
 * @query {number} limit - Limit results (optional, default: 50)
 * @query {number} offset - Offset for pagination (optional, default: 0)
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const userId = req.userId;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const notifications = await NotificationRepository.findByUserId(userId, limit, offset);

    res.status(200).json({
      success: true,
      data: {
        notifications: notifications,
        count: notifications.length
      }
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    next(error);
  }
});

/**
 * @route GET /notifications/:id
 * @desc Get notification by ID
 * @header Authorization: Bearer <token>
 */
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const notificationId = parseInt(req.params.id);
    const userId = req.userId;

    const notification = await NotificationRepository.findById(notificationId);

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }

    // Check if notification belongs to authenticated user
    if (notification.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        notification: notification
      }
    });
  } catch (error) {
    console.error('Get notification by ID error:', error);
    next(error);
  }
});

/**
 * @route DELETE /notifications/:id
 * @desc Delete a specific notification by ID
 * @header Authorization: Bearer <token>
 * @param {number} id - Notification ID
 */
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const notificationId = parseInt(req.params.id);
    const userId = req.userId;

    if (isNaN(notificationId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid notification ID'
      });
    }

    // Verify notification exists and belongs to user
    const notification = await NotificationRepository.findById(notificationId);
    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }

    if (notification.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only delete your own notifications.'
      });
    }

    // Delete notification
    const deleted = await NotificationRepository.deleteById(notificationId, userId);

    if (!deleted) {
      return res.status(500).json({
        success: false,
        error: 'Failed to delete notification'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Notification deleted successfully'
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    next(error);
  }
});

/**
 * @route DELETE /notifications
 * @desc Delete all notifications for authenticated user
 * @header Authorization: Bearer <token>
 */
router.delete('/', authenticate, async (req, res, next) => {
  try {
    const userId = req.userId;

    const deletedCount = await NotificationRepository.deleteAllByUserId(userId);

    res.status(200).json({
      success: true,
      message: `Deleted ${deletedCount} notification(s)`,
      data: {
        deletedCount: deletedCount
      }
    });
  } catch (error) {
    console.error('Delete all notifications error:', error);
    next(error);
  }
});

module.exports = router;

