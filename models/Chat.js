/**
 * Chat Model
 * Represents a chat between user and consultant
 */

class Chat {
  constructor(data) {
    this.chatId = data.chatId || data.id;
    this.consultantId = data.consultantId || data.consultant_id;
    this.userId = data.userId || data.user_id;
    this.createdDate = data.createdDate || data.created_date || '';
    this.lastMessage = data.lastMessage || data.last_message || null;
    this.lastMessageDate = data.lastMessageDate || data.last_message_date || null;
  }

  /**
   * Convert to JSON format (for API responses)
   */
  toJSON() {
    return {
      chatId: this.chatId,
      consultantId: this.consultantId,
      userId: this.userId,
      createdDate: this.createdDate,
      lastMessage: this.lastMessage,
      lastMessageDate: this.lastMessageDate
    };
  }

  /**
   * Convert to Flutter ChatModel format
   */
  toFlutterFormat() {
    return {
      chatId: this.chatId,
      consultantId: this.consultantId,
      userId: this.userId,
      createdDate: this.createdDate,
      lastMessage: this.lastMessage,
      lastMessageDate: this.lastMessageDate
    };
  }
}

module.exports = Chat;

