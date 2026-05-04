/**
 * Message Repository
 * Database operations for messages
 */

const pool = require('../config/database');
const Message = require('../models/Message');

class MessageRepository {
  /**
   * Map database row to Message model
   * @param {Object} row - Database row
   * @returns {Message} Message instance
   */
  static mapRowToMessage(row) {
    return new Message({
      id: row.id,
      chat_id: row.chat_id,
      sender_id: row.sender_id,
      sender: row.sender,
      message: row.message,
      sent_time: row.sent_time,
      is_file: row.is_file,
      file_url: row.file_url,
      is_voice_message: row.is_voice_message,
      voice_url: row.voice_url,
      image_content: row.image_content,
      voice_message_content: row.voice_message_content
    });
  }

  /**
   * Create a new message
   * @param {number} chatId - Chat ID
   * @param {number} senderId - Sender ID
   * @param {string} sender - Sender type ("user" or "assistant")
   * @param {string} message - Message content
   * @param {string} sentTime - Sent time (ISO 8601 format)
   * @param {boolean} isFile - Whether message is a file (default: false)
   * @param {string} fileURL - File URL if message is a file (default: null)
   * @param {boolean} isVoiceMessage - Whether message is a voice message (default: false)
   * @param {string} voiceURL - Voice message URL if message is a voice message (default: null)
   * @param {string} imageContent - AI-analyzed image content (default: null)
   * @param {string} voiceMessageContent - Transcribed voice message content (default: null)
   * @returns {Promise<Message>} Created message
   */
  static async create(chatId, senderId, sender, message, sentTime, isFile = false, fileURL = null, isVoiceMessage = false, voiceURL = null, imageContent = null, voiceMessageContent = null) {
    try {
      const [result] = await pool.execute(
        `INSERT INTO messages (chat_id, sender_id, sender, message, sent_time, is_file, file_url, is_voice_message, voice_url, image_content, voice_message_content)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [chatId, senderId, sender, message, sentTime, isFile, fileURL, isVoiceMessage, voiceURL, imageContent, voiceMessageContent]
      );

      return await this.findById(result.insertId);
    } catch (error) {
      console.error('Error creating message:', error);
      throw error;
    }
  }

  /**
   * Find message by ID
   * @param {number} id - Message ID
   * @returns {Promise<Message|null>} Message or null
   */
  static async findById(id) {
    try {
      const [rows] = await pool.execute(
        'SELECT * FROM messages WHERE id = ? LIMIT 1',
        [id]
      );

      if (rows.length === 0) {
        return null;
      }

      return this.mapRowToMessage(rows[0]);
    } catch (error) {
      console.error('Error finding message by ID:', error);
      throw error;
    }
  }

  /**
   * Find all messages for a chat
   * @param {number} chatId - Chat ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of messages
   */
  static async findByChatId(chatId, options = {}) {
    try {
      const limit = options.limit || 100;
      const offset = options.offset || 0;
      const orderBy = options.orderBy || 'sent_time ASC, created_at ASC';

      const [rows] = await pool.execute(
        `SELECT * FROM messages 
         WHERE chat_id = ?
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
        [chatId, limit, offset]
      );

      return rows.map(row => this.mapRowToMessage(row));
    } catch (error) {
      console.error('Error finding messages by chat ID:', error);
      throw error;
    }
  }

  /**
   * Get chat history for webhook (last N messages)
   * @param {number} chatId - Chat ID
   * @param {number} limit - Number of messages to retrieve
   * @returns {Promise<Array>} Array of messages (formatted for webhook)
   */
  static async getChatHistory(chatId, limit = 50) {
    try {
      const [rows] = await pool.execute(
        `SELECT * FROM messages 
         WHERE chat_id = ?
         ORDER BY sent_time ASC, created_at ASC
         LIMIT ?`,
        [chatId, limit]
      );

      // Already in chronological order (oldest to newest)
      return rows.map(row => {
        // Parse date to DD/MM/YYYY format
        let formattedDate = '';
        if (row.sent_time) {
          const date = new Date(row.sent_time);
          if (!isNaN(date.getTime())) {
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            formattedDate = `${day}/${month}/${year}`;
          }
        }

        // Determine message type
        let messageType = 'text';
        if (row.is_voice_message) {
          messageType = 'voice';
        } else if (row.is_file) {
          messageType = 'image';
        }

        const messageData = {
          sender: row.sender,
          message: row.message,
          sentTime: formattedDate || row.sent_time,
          messageType: messageType
        };

        // Add imageContent if message is an image
        if (row.is_file && row.image_content) {
          messageData.imageContent = row.image_content;
        }

        // Add voiceContent if message is a voice message
        if (row.is_voice_message && row.voice_message_content) {
          messageData.voiceContent = row.voice_message_content;
        }

        return messageData;
      });
    } catch (error) {
      console.error('Error getting chat history:', error);
      throw error;
    }
  }

  /**
   * Delete all messages for a chat
   * @param {number} chatId - Chat ID
   * @returns {Promise<number>} Number of deleted messages
   */
  static async deleteByChatId(chatId) {
    try {
      const [result] = await pool.execute(
        'DELETE FROM messages WHERE chat_id = ?',
        [chatId]
      );
      
      return result.affectedRows;
    } catch (error) {
      console.error('Error deleting messages by chat ID:', error);
      throw error;
    }
  }
}

module.exports = MessageRepository;

