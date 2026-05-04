/**
 * Mood Model
 * Represents a user's daily mood entry
 */

class Mood {
  constructor({
    id = null,
    userId = null,
    date = null,
    mood = null,
    createdAt = null,
    updatedAt = null
  }) {
    this.id = id;
    this.userId = userId;
    this.date = date;
    this.mood = mood;
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
      date: this.date,
      mood: this.mood,
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
      date: this.date,
      mood: this.mood,
      created_at: this.createdAt,
      updated_at: this.updatedAt
    };
  }
}

module.exports = Mood;

