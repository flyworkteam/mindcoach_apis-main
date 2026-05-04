/**
 * Mood Service
 * Business logic for mood operations
 */

const MoodRepository = require('../repositories/MoodRepository');
const UserService = require('./userService');

class MoodService {
  /**
   * Create or update mood entry
   * @param {number} userId - User ID
   * @param {string} date - Date (YYYY-MM-DD format or ISO format)
   * @param {number} mood - Mood value (integer)
   * @returns {Promise<Object>} Response with mood
   */
  static async createOrUpdateMood(userId, date, mood) {
    try {
      // Validate user exists
      const user = await UserService.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Validate mood value
      if (mood === null || mood === undefined) {
        throw new Error('Mood value is required');
      }

      if (!Number.isInteger(mood)) {
        throw new Error('Mood must be an integer');
      }

      // Normalize date to YYYY-MM-DD format
      let normalizedDate = date;
      if (date.includes('T')) {
        // ISO format, extract date part
        normalizedDate = date.split('T')[0];
      }

      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(normalizedDate)) {
        throw new Error('Invalid date format. Expected YYYY-MM-DD or ISO format.');
      }

      // Create or update mood
      const moodEntry = await MoodRepository.createOrUpdate(userId, normalizedDate, mood);

      return {
        success: true,
        mood: moodEntry.toFlutterFormat()
      };
    } catch (error) {
      console.error('Error creating or updating mood:', error);
      throw error;
    }
  }

  /**
   * Get mood by user ID and date
   * @param {number} userId - User ID
   * @param {string} date - Date (YYYY-MM-DD format or ISO format)
   * @returns {Promise<Object|null>} Mood or null
   */
  static async getMoodByDate(userId, date) {
    try {
      // Normalize date to YYYY-MM-DD format
      let normalizedDate = date;
      if (date.includes('T')) {
        normalizedDate = date.split('T')[0];
      }

      const mood = await MoodRepository.findByUserIdAndDate(userId, normalizedDate);
      
      if (!mood) {
        return null;
      }

      return mood.toFlutterFormat();
    } catch (error) {
      console.error('Error getting mood by date:', error);
      throw error;
    }
  }

  /**
   * Get moods by user ID
   * @param {number} userId - User ID
   * @param {number} limit - Number of records to retrieve (optional)
   * @param {number} offset - Offset for pagination (optional)
   * @returns {Promise<Array>} Array of moods
   */
  static async getMoodsByUserId(userId, limit = null, offset = 0) {
    try {
      const moods = await MoodRepository.findByUserId(userId, limit, offset);
      return moods.map(mood => mood.toFlutterFormat());
    } catch (error) {
      console.error('Error getting moods by user ID:', error);
      throw error;
    }
  }

  /**
   * Delete mood by ID
   * @param {number} id - Mood ID
   * @param {number} userId - User ID (for authorization)
   * @returns {Promise<boolean>} True if deleted
   */
  static async deleteMood(id, userId) {
    try {
      // Check if mood exists and belongs to user
      const mood = await MoodRepository.findById(id);
      if (!mood) {
        throw new Error('Mood not found');
      }

      if (mood.userId !== userId) {
        throw new Error('You can only delete your own moods');
      }

      return await MoodRepository.deleteById(id);
    } catch (error) {
      console.error('Error deleting mood:', error);
      throw error;
    }
  }
}

module.exports = MoodService;

