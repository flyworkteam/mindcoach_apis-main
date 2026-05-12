/**
 * Appointment Service
 * Business logic for appointment operations
 */

const AppointmentRepository = require('../repositories/AppointmentRepository');
const UserService = require('./userService');
const ConsultantService = require('./consultantService');
const OneSignalService = require('./oneSignalService');
const NotificationRepository = require('../repositories/NotificationRepository');

class AppointmentService {
  /**
   * Create appointment from webhook
   * @param {number} userId - User ID (randevuyu alan kullanıcı)
   * @param {number} consultantId - Consultant ID (randevuyu veren kullanıcı)
   * @param {string} appointmentDate - Appointment date (ISO format)
   * @returns {Promise<Object>} Response with appointment and notification message
   */
  static async createAppointmentFromWebhook(userId, consultantId, appointmentDate) {
    try {
      // Validate user exists
      const user = await UserService.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Validate consultant exists
      const consultant = await ConsultantService.getConsultantById(consultantId);
      if (!consultant) {
        throw new Error('Consultant not found');
      }

      // Validate appointment date
      if (!appointmentDate) {
        throw new Error('Appointment date is required');
      }

      // Validate date format (ISO 8601)
      let date = new Date(appointmentDate);
      if (isNaN(date.getTime())) {
        throw new Error('Invalid appointment date format. Expected ISO 8601 format.');
      }

      // Validate appointment date: only rule is "must be in the future".
      // Saat aralığı kısıtlaması yok — client zaten 00:00-23:30 arası geçerli
      // slot listesi gösteriyor. AI/webhook senaryosunda da kullanıcının
      // seçtiği saatlere uyulması beklenir; geçmişteki tarihler 1 saat ileriye
      // otomatik düzeltilir (AI flow'unu kırmamak için).
      const now = new Date();

      let needsCorrection = false;
      let correctionReason = '';

      if (date <= now) {
        needsCorrection = true;
        correctionReason = 'Date is in the past';
        // Şu andan 1 saat sonrasına yuvarla.
        date = new Date(now.getTime() + 60 * 60 * 1000);
      }

      if (needsCorrection) {
        console.warn(`[APPOINTMENT] ⚠️ Invalid appointment date corrected: ${correctionReason}. Original: ${appointmentDate}, Corrected: ${date.toISOString()}`);
      }

      // Ensure appointmentDate is in ISO 8601 format
      const isoAppointmentDate = date.toISOString();

      // Kural: Kullanıcı her bir koçtan yalnızca 1 kez randevu oluşturabilir.
      const existingAppointment = await AppointmentRepository.findByUserAndConsultant(
        userId,
        consultantId
      );
      if (existingAppointment) {
        throw new Error('User already has an appointment with this consultant');
      }

      // Kural: Kullanıcı aynı tarih-saat slotunda (koçtan bağımsız) sadece 1 aktif randevu alabilir.
      const existingSameSlotAppointment =
        await AppointmentRepository.findByUserAndDateTime(
          userId,
          isoAppointmentDate
        );
      if (existingSameSlotAppointment) {
        throw new Error('User already has an appointment at this date and time');
      }

      // Create appointment with ISO formatted date
      const appointment = await AppointmentRepository.create(
        userId,
        consultantId,
        isoAppointmentDate,
        'pending'
      );

      // Get consultant name for notification
      const consultantName = consultant.names?.tr || consultant.names?.en || consultant.names?.de || 'Koç';
      
      // Prepare notification message
      const notificationTitle = 'Yeni Randevu';
      const notificationSubtitle = `${consultantName}, sizin için randevu oluşturdu`;
      const notificationMessage = 'Randevunuz oluşturuldu';

      // Önce kullanıcıya mesaj dönsün, ardından bildirimi gönder.
      setTimeout(() => {
        sendAppointmentNotification(
          userId,
          consultantId,
          notificationTitle,
          notificationSubtitle,
          appointment.id
        ).catch(err => {
          console.error('⚠️ Failed to send appointment notification:', err.message);
        });
      }, 1500);

      return {
        success: true,
        appointment: appointment.toFlutterFormat(),
        notification: notificationMessage
      };
    } catch (error) {
      console.error('Error creating appointment from webhook:', error);
      throw error;
    }
  }

  /**
   * Get appointments by user ID
   * @param {number} userId - User ID
   * @returns {Promise<Array>} Array of appointments
   */
  static async getAppointmentsByUserId(userId) {
    try {
      const appointments = await AppointmentRepository.findByUserId(userId);
      return appointments.map(appointment => appointment.toFlutterFormat());
    } catch (error) {
      console.error('Error getting appointments by user ID:', error);
      throw error;
    }
  }

  /**
   * Get appointments by consultant ID
   * @param {number} consultantId - Consultant ID
   * @returns {Promise<Array>} Array of appointments
   */
  static async getAppointmentsByConsultantId(consultantId) {
    try {
      const appointments = await AppointmentRepository.findByConsultantId(consultantId);
      return appointments.map(appointment => appointment.toFlutterFormat());
    } catch (error) {
      console.error('Error getting appointments by consultant ID:', error);
      throw error;
    }
  }

  /**
   * Get upcoming appointment by user ID (nearest future appointment)
   * @param {number} userId - User ID
   * @returns {Promise<Object|null>} Upcoming appointment or null
   */
  static async getUpcomingAppointmentByUserId(userId) {
    try {
      const appointment = await AppointmentRepository.findUpcomingByUserId(userId);
      if (!appointment) {
        return null;
      }
      return appointment.toFlutterFormat();
    } catch (error) {
      console.error('Error getting upcoming appointment by user ID:', error);
      throw error;
    }
  }

  /**
   * Cancel appointment
   * @param {number} appointmentId - Appointment ID
   * @param {number} userId - User ID (must match appointment's userId)
   * @returns {Promise<Object>} Cancelled appointment
   */
  static async cancelAppointment(appointmentId, userId) {
    try {
      // Cancel appointment (repository handles validation)
      const appointment = await AppointmentRepository.cancel(appointmentId, userId);

      // Send cancellation notification (async, don't wait)
      sendCancellationNotification(userId, appointment.consultantId, appointment.id).catch(err => {
        console.error('⚠️ Failed to send cancellation notification:', err.message);
      });

      return {
        success: true,
        appointment: appointment.toFlutterFormat(),
        message: 'Appointment cancelled successfully'
      };
    } catch (error) {
      console.error('Error cancelling appointment:', error);
      throw error;
    }
  }

  /**
   * Reactivate cancelled appointment (set status back to 'pending')
   * @param {number} appointmentId - Appointment ID
   * @param {number} userId - User ID (must match appointment's userId)
   * @returns {Promise<Object>} Reactivated appointment
   */
  static async reactivateAppointment(appointmentId, userId) {
    try {
      // Reactivate appointment (repository handles validation)
      const appointment = await AppointmentRepository.reactivate(appointmentId, userId);

      // Send reactivation notification (async, don't wait)
      sendReactivationNotification(userId, appointment.consultantId, appointment.id).catch(err => {
        console.error('⚠️ Failed to send reactivation notification:', err.message);
      });

      return {
        success: true,
        appointment: appointment.toFlutterFormat(),
        message: 'Appointment reactivated successfully'
      };
    } catch (error) {
      console.error('Error reactivating appointment:', error);
      throw error;
    }
  }
}

/**
 * Helper function to send appointment notification
 * @param {number} userId - User ID
 * @param {number} consultantId - Consultant ID
 * @param {string} title - Notification title
 * @param {string} subtitle - Notification subtitle
 * @param {number} appointmentId - Appointment ID
 */
async function sendAppointmentNotification(userId, consultantId, title, subtitle, appointmentId) {
  try {
    const consultant = await ConsultantService.getConsultantById(consultantId);
    const consultantPhotoUrl = consultant?.photoURL || null;

    const metadata = {
      type: 'appointment',
      appointmentId: appointmentId,
      consultantId: consultantId,
      consultantPhotoUrl,
      timestamp: new Date().toISOString()
    };

    // Send via OneSignal (if configured)
    let oneSignalResult = null;
    try {
      oneSignalResult = await OneSignalService.sendNotification(
        userId,
        title,
        subtitle,
        metadata,
        'system_notification'
      );
    } catch (oneSignalError) {
      console.error('⚠️ OneSignal error (continuing to save to DB):', oneSignalError.message);
      // Continue even if OneSignal fails
    }

    // Save to database
    await NotificationRepository.create({
      user_id: userId,
      type: 'system_notification',
      title: title,
      subtitle: subtitle,
      metadata: {
        ...metadata,
        oneSignalId: oneSignalResult?.oneSignalId || null
      }
    });

    console.log(`✅ Appointment notification sent to user ${userId}`);
  } catch (error) {
    console.error('❌ Error sending appointment notification:', error);
    throw error;
  }
}

/**
 * Helper function to send cancellation notification
 * @param {number} userId - User ID
 * @param {number} consultantId - Consultant ID
 * @param {number} appointmentId - Appointment ID
 */
async function sendCancellationNotification(userId, consultantId, appointmentId) {
  try {
    const metadata = {
      type: 'appointment_cancelled',
      appointmentId: appointmentId,
      consultantId: consultantId,
      timestamp: new Date().toISOString()
    };

    const title = 'Randevu İptal Edildi';
    const subtitle = 'Randevunuz iptal edildi';

    // Send via OneSignal (if configured)
    let oneSignalResult = null;
    try {
      oneSignalResult = await OneSignalService.sendNotification(
        userId,
        title,
        subtitle,
        metadata,
        'system_notification'
      );
    } catch (oneSignalError) {
      console.error('⚠️ OneSignal error (continuing to save to DB):', oneSignalError.message);
      // Continue even if OneSignal fails
    }

    // Save to database
    await NotificationRepository.create({
      user_id: userId,
      type: 'system_notification',
      title: title,
      subtitle: subtitle,
      metadata: {
        ...metadata,
        oneSignalId: oneSignalResult?.oneSignalId || null
      }
    });

    console.log(`✅ Cancellation notification sent to user ${userId}`);
  } catch (error) {
    console.error('❌ Error sending cancellation notification:', error);
    throw error;
  }
}

/**
 * Helper function to send reactivation notification
 * @param {number} userId - User ID
 * @param {number} consultantId - Consultant ID
 * @param {number} appointmentId - Appointment ID
 */
async function sendReactivationNotification(userId, consultantId, appointmentId) {
  try {
    const metadata = {
      type: 'appointment_reactivated',
      appointmentId: appointmentId,
      consultantId: consultantId,
      timestamp: new Date().toISOString()
    };

    const title = 'Randevu Yeniden Aktif';
    const subtitle = 'Randevunuz tekrar aktif hale getirildi';

    // Send via OneSignal (if configured)
    let oneSignalResult = null;
    try {
      oneSignalResult = await OneSignalService.sendNotification(
        userId,
        title,
        subtitle,
        metadata,
        'system_notification'
      );
    } catch (oneSignalError) {
      console.error('⚠️ OneSignal error (continuing to save to DB):', oneSignalError.message);
      // Continue even if OneSignal fails
    }

    // Save to database
    await NotificationRepository.create({
      user_id: userId,
      type: 'system_notification',
      title: title,
      subtitle: subtitle,
      metadata: {
        ...metadata,
        oneSignalId: oneSignalResult?.oneSignalId || null
      }
    });

    console.log(`✅ Reactivation notification sent to user ${userId}`);
  } catch (error) {
    console.error('❌ Error sending reactivation notification:', error);
    throw error;
  }
}

module.exports = AppointmentService;


