/**
 * Appointments Routes
 * API endpoints for appointment operations
 */

const router = require('express').Router();
const AppointmentService = require('../services/appointmentService');
const { authenticate } = require('../middleware/auth');

/**
 * @route POST /appointments/webhook
 * @desc Create appointment from webhook (AI assistant)
 * @body {number} userId - User ID (randevuyu alan kullanıcı)
 * @body {number} consultantId - Consultant ID (randevuyu veren kullanıcı)
 * @body {string} appointmentDate - Appointment date (ISO 8601 format)
 */
router.post('/webhook', async (req, res) => {
  try {
    const { userId, consultantId, appointmentDate } = req.body;

    // Validate required fields
    if (!userId || !consultantId || !appointmentDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, consultantId, and appointmentDate are required'
      });
    }

    // Create appointment
    const result = await AppointmentService.createAppointmentFromWebhook(
      userId,
      consultantId,
      appointmentDate
    );

    res.status(201).json({
      success: true,
      message: result.notification,
      appointment: result.appointment
    });
  } catch (error) {
    console.error('Error creating appointment from webhook:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * @route GET /appointments/user/:userId
 * @desc Get all appointments for a user
 * @param {number} userId - User ID
 */
router.get('/user/:userId', authenticate, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    // Check if user is requesting their own appointments
    const tokenUserId = req.userId;
    if (tokenUserId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'You can only access your own appointments'
      });
    }

    const appointments = await AppointmentService.getAppointmentsByUserId(userId);

    res.status(200).json({
      success: true,
      data: appointments
    });
  } catch (error) {
    console.error('Error getting user appointments:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * @route GET /appointments/user/:userId/upcoming
 * @desc Get upcoming (nearest) appointment for a user
 * @param {number} userId - User ID
 */
router.get('/user/:userId/upcoming', authenticate, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    // Check if user is requesting their own appointments
    const tokenUserId = req.userId;
    if (tokenUserId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'You can only access your own appointments'
      });
    }

    const appointment = await AppointmentService.getUpcomingAppointmentByUserId(userId);

    if (!appointment) {
      return res.status(200).json({
        success: true,
        data: null,
        message: 'No upcoming appointment found'
      });
    }

    res.status(200).json({
      success: true,
      data: appointment
    });
  } catch (error) {
    console.error('Error getting upcoming appointment:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * @route DELETE /appointments/:id
 * @desc Cancel an appointment (authenticated user can only cancel their own appointments)
 * IMPORTANT: This does NOT delete the appointment from database, only updates status to 'cancelled'
 * The appointment remains in the database for historical records
 * @param {number} id - Appointment ID
 * @header Authorization: Bearer <token>
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const appointmentId = parseInt(req.params.id);
    const userId = req.userId; // From authentication middleware

    if (isNaN(appointmentId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid appointment ID'
      });
    }

    const result = await AppointmentService.cancelAppointment(appointmentId, userId);

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.appointment
    });
  } catch (error) {
    console.error('Error cancelling appointment:', error);
    
    // Handle specific error cases
    if (error.message === 'Appointment not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    if (error.message === 'Unauthorized: Appointment does not belong to user') {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    }

    if (error.message === 'Appointment is already cancelled' || 
        error.message === 'Cannot cancel a completed appointment') {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * @route PUT /appointments/:id/reactivate
 * @desc Reactivate a cancelled appointment (set status back to 'pending')
 * Only cancelled appointments can be reactivated
 * The appointment date must still be in the future
 * @param {number} id - Appointment ID
 * @header Authorization: Bearer <token>
 */
router.put('/:id/reactivate', authenticate, async (req, res) => {
  try {
    const appointmentId = parseInt(req.params.id);
    const userId = req.userId; // From authentication middleware

    if (isNaN(appointmentId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid appointment ID'
      });
    }

    const result = await AppointmentService.reactivateAppointment(appointmentId, userId);

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.appointment
    });
  } catch (error) {
    console.error('Error reactivating appointment:', error);
    
    // Handle specific error cases
    if (error.message === 'Appointment not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    if (error.message === 'Unauthorized: Appointment does not belong to user') {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    }

    if (error.message.includes('Cannot reactivate appointment with status') ||
        error.message === 'Cannot reactivate an appointment that has already passed') {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

module.exports = router;


