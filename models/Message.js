/**
 * Message Model
 * Represents a message in a chat
 */

class Message {
  constructor(data) {
    this.messageId = data.messageId || data.id;
    this.chatId = data.chatId || data.chat_id;
    this.senderId = data.senderId || data.sender_id;
    this.sender = data.sender || 'user'; // "user" or "assistant"
    this.message = data.message || '';
    this.sentTime = data.sentTime || data.sent_time || '';
    this.isFile = data.isFile !== undefined ? data.isFile : (data.is_file !== undefined ? data.is_file : false);
    this.fileURL = data.fileURL || data.file_url || null;
    this.isVoiceMessage = data.isVoiceMessage !== undefined ? data.isVoiceMessage : (data.is_voice_message !== undefined ? data.is_voice_message : false);
    this.voiceURL = data.voiceURL || data.voice_url || null;
    this.imageContent = data.imageContent || data.image_content || null;
    this.voiceMessageContent = data.voiceMessageContent || data.voice_message_content || null;
  }

  /**
   * Convert to JSON format (for API responses)
   */
  toJSON() {
    return {
      messageId: this.messageId,
      chatId: this.chatId,
      senderId: this.senderId,
      sender: this.sender,
      message: this.message,
      sentTime: this.sentTime,
      isFile: this.isFile,
      fileURL: this.fileURL,
      isVoiceMessage: this.isVoiceMessage,
      voiceURL: this.voiceURL,
      imageContent: this.imageContent,
      voiceMessageContent: this.voiceMessageContent
    };
  }

  /**
   * Convert to Flutter MessageModel format
   */
  toFlutterFormat() {
    return {
      messageId: this.messageId,
      chatId: this.chatId,
      senderId: this.senderId,
      sender: this.sender,
      message: this.message,
      sentTime: this.sentTime,
      isFile: this.isFile,
      fileURL: this.fileURL,
      isVoiceMessage: this.isVoiceMessage,
      voiceURL: this.voiceURL,
      imageContent: this.imageContent,
      voiceMessageContent: this.voiceMessageContent
    };
  }
}

module.exports = Message;

