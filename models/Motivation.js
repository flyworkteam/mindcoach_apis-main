/**
 * Motivation Model
 * Represents a daily motivation text and advice for a user
 */

class Motivation {
  constructor(data) {
    this.id = data.id;
    this.userId = data.userId || data.user_id;
    this.date = data.date;
    this.motivation = data.motivation;
    this.tavsiye = data.tavsiye;
    this.reality = data.reality;
    this.createdAt = data.createdAt || data.created_at;
    this.updatedAt = data.updatedAt || data.updated_at;
  }

  /**
   * Convert to JSON format (for API responses)
   */
  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      date: this.date,
      motivation: this.motivation,
      tavsiye: this.tavsiye,
      reality: this.reality,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  /**
   * Convert to Flutter format
   */
  toFlutterFormat() {
    return {
      id: this.id,
      userId: this.userId,
      date: this.date,
      motivation: this.motivation,
      tavsiye: this.tavsiye,
      reality: this.reality,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Motivation;
