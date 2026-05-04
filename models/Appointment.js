/**
 * Appointment Model
 * Represents an appointment between a user and a consultant
 */

class Appointment {
  constructor({
    id = null,
    userId = null,
    consultantId = null,
    appointmentDate = null,
    status = 'pending',
    createdAt = null,
    updatedAt = null
  }) {
    this.id = id;
    this.userId = userId;
    this.consultantId = consultantId;
    this.appointmentDate = appointmentDate;
    this.status = status;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  /**
   * Convert to JSON format
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      consultantId: this.consultantId,
      appointmentDate: this.appointmentDate,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  /**
   * Convert to Flutter format (snake_case)
   * @returns {Object} Flutter format representation
   */
  toFlutterFormat() {
    return {
      id: this.id,
      user_id: this.userId,
      consultant_id: this.consultantId,
      appointment_date: this.appointmentDate,
      status: this.status,
      created_at: this.createdAt,
      updated_at: this.updatedAt
    };
  }
}

module.exports = Appointment;

