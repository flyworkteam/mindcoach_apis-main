/**
 * Appointment Repository
 * Database operations for appointments
 */

const pool = require('../config/database');
const Appointment = require('../models/Appointment');
const { executeWithRetry } = require('../utils/dbRetry');

class AppointmentRepository {
  /**
   * Map database row to Appointment model
   * @param {Object} row - Database row
   * @returns {Appointment} Appointment instance
   */
  static mapRowToAppointment(row) {
    // Convert appointment_date to ISO 8601 format
    let appointmentDate = row.appointment_date;
    if (appointmentDate) {
      if (appointmentDate instanceof Date) {
        appointmentDate = appointmentDate.toISOString();
      } else if (typeof appointmentDate === 'string') {
        // If it's already a string, ensure it's in ISO format
        const date = new Date(appointmentDate);
        if (!isNaN(date.getTime())) {
          appointmentDate = date.toISOString();
        }
      }
    }

    // Convert timestamps to ISO format
    let createdAt = row.created_at;
    if (createdAt && createdAt instanceof Date) {
      createdAt = createdAt.toISOString();
    }

    let updatedAt = row.updated_at;
    if (updatedAt && updatedAt instanceof Date) {
      updatedAt = updatedAt.toISOString();
    }

    return new Appointment({
      id: row.id,
      userId: row.user_id,
      consultantId: row.consultant_id,
      appointmentDate: appointmentDate,
      status: row.status,
      createdAt: createdAt,
      updatedAt: updatedAt
    });
  }

  /**
   * Create a new appointment
   * @param {number} userId - User ID
   * @param {number} consultantId - Consultant ID
   * @param {string} appointmentDate - Appointment date (ISO 8601 format)
   * @param {string} status - Appointment status (default: 'pending')
   * @returns {Promise<Appointment>} Created appointment
   */
  static async create(userId, consultantId, appointmentDate, status = 'pending') {
    return executeWithRetry(async () => {
      try {
        console.log(`[APPOINTMENT-REPO] Creating appointment: userId=${userId}, consultantId=${consultantId}, date=${appointmentDate}, status=${status}`);
        
        const [result] = await pool.execute(
          `INSERT INTO appointments (user_id, consultant_id, appointment_date, status)
           VALUES (?, ?, ?, ?)`,
          [userId, consultantId, appointmentDate, status]
        );

        if (!result.insertId) {
          throw new Error('Failed to create appointment: No insert ID returned');
        }

        console.log(`[APPOINTMENT-REPO] ✅ Appointment created with ID: ${result.insertId}`);
        const appointment = await this.findById(result.insertId);
        
        if (!appointment) {
          throw new Error(`Failed to retrieve created appointment with ID: ${result.insertId}`);
        }

        return appointment;
      } catch (error) {
        console.error('[APPOINTMENT-REPO] ❌ Error creating appointment:', {
          error: error.message,
          stack: error.stack,
          userId,
          consultantId,
          appointmentDate,
          status
        });
        throw error;
      }
    }, 3, 'create appointment');
  }

  /**
   * Find appointment by ID
   * @param {number} id - Appointment ID
   * @returns {Promise<Appointment|null>} Appointment or null
   */
  static async findById(id) {
    try {
      const [rows] = await pool.execute(
        `SELECT * FROM appointments WHERE id = ?`,
        [id]
      );

      if (rows.length === 0) {
        return null;
      }

      return this.mapRowToAppointment(rows[0]);
    } catch (error) {
      console.error('Error finding appointment by ID:', error);
      throw error;
    }
  }

  /**
   * Find appointments by user ID
   * @param {number} userId - User ID
   * @returns {Promise<Array<Appointment>>} Array of appointments
   */
  static async findByUserId(userId) {
    try {
      const [rows] = await pool.execute(
        `SELECT * FROM appointments 
         WHERE user_id = ? 
         ORDER BY appointment_date ASC`,
        [userId]
      );

      return rows.map(row => this.mapRowToAppointment(row));
    } catch (error) {
      console.error('Error finding appointments by user ID:', error);
      throw error;
    }
  }

  /**
   * Find latest appointment by user and consultant
   * @param {number} userId - User ID
   * @param {number} consultantId - Consultant ID
   * @returns {Promise<Appointment|null>} Latest appointment or null
   */
  static async findByUserAndConsultant(userId, consultantId) {
    try {
      const [rows] = await pool.execute(
        `SELECT * FROM appointments
         WHERE user_id = ? AND consultant_id = ?
         ORDER BY appointment_date DESC
         LIMIT 1`,
        [userId, consultantId]
      );

      if (rows.length === 0) {
        return null;
      }

      return this.mapRowToAppointment(rows[0]);
    } catch (error) {
      console.error('Error finding appointment by user and consultant:', error);
      throw error;
    }
  }

  /**
   * Find appointment by user and exact datetime slot (coach independent)
   * @param {number} userId - User ID
   * @param {string} appointmentDate - Appointment date (ISO 8601 format)
   * @returns {Promise<Appointment|null>} Matching appointment or null
   */
  static async findByUserAndDateTime(userId, appointmentDate) {
    try {
      const [rows] = await pool.execute(
        `SELECT * FROM appointments
         WHERE user_id = ?
           AND appointment_date = ?
           AND status != 'cancelled'
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId, appointmentDate]
      );

      if (rows.length === 0) {
        return null;
      }

      return this.mapRowToAppointment(rows[0]);
    } catch (error) {
      console.error('Error finding appointment by user and datetime:', error);
      throw error;
    }
  }

  /**
   * Find appointments by consultant ID
   * @param {number} consultantId - Consultant ID
   * @returns {Promise<Array<Appointment>>} Array of appointments
   */
  static async findByConsultantId(consultantId) {
    try {
      const [rows] = await pool.execute(
        `SELECT * FROM appointments 
         WHERE consultant_id = ? 
         ORDER BY appointment_date ASC`,
        [consultantId]
      );

      return rows.map(row => this.mapRowToAppointment(row));
    } catch (error) {
      console.error('Error finding appointments by consultant ID:', error);
      throw error;
    }
  }

  /**
   * Update appointment status
   * @param {number} id - Appointment ID
   * @param {string} status - New status
   * @returns {Promise<Appointment>} Updated appointment
   */
  static async updateStatus(id, status) {
    return executeWithRetry(async () => {
      try {
        await pool.execute(
          `UPDATE appointments SET status = ?, updated_at = NOW() WHERE id = ?`,
          [status, id]
        );

        return await this.findById(id);
      } catch (error) {
        console.error('Error updating appointment status:', error);
        throw error;
      }
    }, 3, 'update appointment status');
  }

  /**
   * Cancel appointment (set status to 'cancelled')
   * IMPORTANT: This does NOT delete the appointment from database, only updates the status
   * @param {number} id - Appointment ID
   * @param {number} userId - User ID (for authorization check)
   * @returns {Promise<Appointment>} Cancelled appointment
   */
  static async cancel(id, userId) {
    return executeWithRetry(async () => {
      try {
        // First verify the appointment exists and belongs to the user
        const appointment = await this.findById(id);
        if (!appointment) {
          throw new Error('Appointment not found');
        }

        if (appointment.userId !== userId) {
          throw new Error('Unauthorized: Appointment does not belong to user');
        }

        // Check if appointment can be cancelled (only pending or confirmed can be cancelled)
        if (appointment.status === 'cancelled') {
          throw new Error('Appointment is already cancelled');
        }

        if (appointment.status === 'completed') {
          throw new Error('Cannot cancel a completed appointment');
        }

        // Update status to cancelled (DO NOT DELETE - only update status)
        // The appointment remains in the database for historical records
        await pool.execute(
          `UPDATE appointments SET status = 'cancelled', updated_at = NOW() WHERE id = ?`,
          [id]
        );

        console.log(`[APPOINTMENT-REPO] ✅ Appointment ${id} cancelled (status updated, not deleted)`);

        return await this.findById(id);
      } catch (error) {
        console.error('Error cancelling appointment:', error);
        throw error;
      }
    }, 3, 'cancel appointment');
  }

  /**
   * Reactivate cancelled appointment (set status back to 'pending')
   * IMPORTANT: This only works for cancelled appointments
   * @param {number} id - Appointment ID
   * @param {number} userId - User ID (for authorization check)
   * @returns {Promise<Appointment>} Reactivated appointment
   */
  static async reactivate(id, userId) {
    return executeWithRetry(async () => {
      try {
        // First verify the appointment exists and belongs to the user
        const appointment = await this.findById(id);
        if (!appointment) {
          throw new Error('Appointment not found');
        }

        if (appointment.userId !== userId) {
          throw new Error('Unauthorized: Appointment does not belong to user');
        }

        // Check if appointment is cancelled (only cancelled appointments can be reactivated)
        if (appointment.status !== 'cancelled') {
          throw new Error(`Cannot reactivate appointment with status '${appointment.status}'. Only cancelled appointments can be reactivated.`);
        }

        // Check if appointment date is still in the future
        const appointmentDate = new Date(appointment.appointmentDate);
        const now = new Date();
        if (appointmentDate < now) {
          throw new Error('Cannot reactivate an appointment that has already passed');
        }

        // Update status back to pending
        await pool.execute(
          `UPDATE appointments SET status = 'pending', updated_at = NOW() WHERE id = ?`,
          [id]
        );

        console.log(`[APPOINTMENT-REPO] ✅ Appointment ${id} reactivated (status changed from cancelled to pending)`);

        return await this.findById(id);
      } catch (error) {
        console.error('Error reactivating appointment:', error);
        throw error;
      }
    }, 3, 'reactivate appointment');
  }

  /**
   * Find upcoming appointment by user ID (nearest future appointment)
   * @param {number} userId - User ID
   * @returns {Promise<Appointment|null>} Upcoming appointment or null
   */
  static async findUpcomingByUserId(userId) {
    try {
      const now = new Date().toISOString();
      const [rows] = await pool.execute(
        `SELECT * FROM appointments 
         WHERE user_id = ? 
           AND appointment_date >= ?
           AND status != 'cancelled'
         ORDER BY appointment_date ASC
         LIMIT 1`,
        [userId, now]
      );

      if (rows.length === 0) {
        return null;
      }

      return this.mapRowToAppointment(rows[0]);
    } catch (error) {
      console.error('Error finding upcoming appointment by user ID:', error);
      throw error;
    }
  }

  /**
   * Delete all appointments for a user
   * @param {number} userId - User ID
   * @returns {Promise<number>} Number of deleted appointments
   */
  static async deleteByUserId(userId) {
    try {
      const [result] = await pool.execute(
        'DELETE FROM appointments WHERE user_id = ?',
        [userId]
      );
      
      return result.affectedRows;
    } catch (error) {
      console.error('Error deleting appointments by user ID:', error);
      throw error;
    }
  }
}

module.exports = AppointmentRepository;


