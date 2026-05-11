/**
 * Chat Service
 * Business logic for chat operations.
 * AI responses are generated directly via OpenAI (AIService)
 * instead of external n8n webhooks.
 */

const ChatRepository = require('../repositories/ChatRepository');
const MessageRepository = require('../repositories/MessageRepository');
const ConsultantRepository = require('../repositories/ConsultantRepository');
const UserService = require('./userService');
const ElevenLabsService = require('./elevenLabsService');
const BunnyCDNService = require('./bunnyCDNService');
const AppointmentService = require('./appointmentService');
const AIService = require('./aiService');

class ChatService {
  /**
   * Get or create chat for user and consultant
   */
  static async getOrCreateChat(userId, consultantId) {
    try {
      let chat = await ChatRepository.findByUserAndConsultant(userId, consultantId);
      if (!chat) {
        const createdDate = new Date().toISOString();
        chat = await ChatRepository.create(consultantId, userId, createdDate);
      }
      return chat;
    } catch (error) {
      console.error('Error getting or creating chat:', error);
      throw error;
    }
  }

  /**
   * Generate AI reply and save as assistant text message (background).
   * Used by sendMessage (free chat).
   */
  static async _generateAndSaveTextReply(chatId, consultantId, user, chatHistory, messageType, message, fileURL, imageContent, voiceMessageContent) {
    try {
      const consultant = await ConsultantRepository.findById(consultantId);
      if (!consultant) {
        console.error(`[CHAT-AI] Consultant ${consultantId} not found`);
        return;
      }

      const nativeLang = user.nativeLang || 'tr';
      const systemPrompt = this._buildSystemPrompt(consultant, user, nativeLang);

      const { reply: aiReply, toolCalls } = await AIService.chat({
        systemPrompt,
        chatHistory,
        userMessage: message,
        messageType,
        imageURL: fileURL || null,
        imageContent: imageContent || null,
        voiceContent: voiceMessageContent || null,
        nativeLang,
      });

      const sentTime = new Date().toISOString();
      await this.createConsultantTextMessage(chatId, consultantId, aiReply, sentTime);
      await ChatRepository.updateLastMessage(chatId, aiReply, sentTime);
      console.log(`[CHAT-AI] Text reply saved (${aiReply.length} chars)`);

      await this._handleToolCalls(toolCalls, user.id || user.userId, consultantId, chatId);
    } catch (err) {
      console.error('[CHAT-AI] Error generating text reply:', err.message);
    }
  }

  /**
   * Generate AI reply for premium chat.
   * Defaults to TEXT. Only sends voice if AI calls send_voice_reply tool.
   */
  static async _generatePremiumReply(chatId, consultantId, user, chatHistory, messageType, message, fileURL, imageContent, voiceMessageContent) {
    try {
      const consultant = await ConsultantRepository.findById(consultantId);
      if (!consultant) {
        console.error(`[PREMIUM-AI] Consultant ${consultantId} not found`);
        return;
      }

      const nativeLang = user.nativeLang || 'tr';
      const systemPrompt = this._buildSystemPrompt(consultant, user, nativeLang);

      const { reply: aiReply, toolCalls } = await AIService.chat({
        systemPrompt,
        chatHistory,
        userMessage: message,
        messageType,
        imageURL: fileURL || null,
        imageContent: imageContent || null,
        voiceContent: voiceMessageContent || null,
        nativeLang,
        isPremium: true,
      });

      const sentTime = new Date().toISOString();
      const userId = user.id || user.userId;

      const wantsVoice = toolCalls.some(tc => tc.name === 'send_voice_reply');

      if (wantsVoice && consultant.voiceId) {
        const voiceReason = toolCalls.find(tc => tc.name === 'send_voice_reply')?.args?.reason || 'unknown';
        console.log(`[PREMIUM-AI] AI chose voice reply (reason: ${voiceReason})`);

        let audioBuffer;
        try {
          audioBuffer = await ElevenLabsService.textToSpeech(aiReply, consultant.voiceId);
          console.log(`[PREMIUM-AI] Voice generated (${audioBuffer.length} bytes)`);
        } catch (ttsErr) {
          console.error('[PREMIUM-AI] TTS failed, falling back to text:', ttsErr.message);
          await this.createConsultantTextMessage(chatId, consultantId, aiReply, sentTime);
          await ChatRepository.updateLastMessage(chatId, aiReply, sentTime);
          await this._handleToolCalls(toolCalls, userId, consultantId, chatId);
          return;
        }

        let voiceURL;
        try {
          const fileName = `premium_voice_${Date.now()}.mp3`;
          voiceURL = await BunnyCDNService.uploadFile(audioBuffer, fileName, 'voice');
          console.log(`[PREMIUM-AI] Voice uploaded: ${voiceURL}`);
        } catch (uploadErr) {
          console.error('[PREMIUM-AI] CDN upload failed, falling back to text:', uploadErr.message);
          await this.createConsultantTextMessage(chatId, consultantId, aiReply, sentTime);
          await ChatRepository.updateLastMessage(chatId, aiReply, sentTime);
          await this._handleToolCalls(toolCalls, userId, consultantId, chatId);
          return;
        }

        await MessageRepository.create(
          chatId, consultantId, 'assistant', aiReply, sentTime,
          false, null, true, voiceURL, null, aiReply
        );
        await ChatRepository.updateLastMessage(chatId, aiReply, sentTime);
        console.log(`[PREMIUM-AI] Voice reply saved`);
      } else {
        if (wantsVoice && !consultant.voiceId) {
          console.warn(`[PREMIUM-AI] AI wanted voice but consultant has no voiceId, sending text`);
        }
        await this.createConsultantTextMessage(chatId, consultantId, aiReply, sentTime);
        await ChatRepository.updateLastMessage(chatId, aiReply, sentTime);
        console.log(`[PREMIUM-AI] Text reply saved (${aiReply.length} chars)`);
      }

      await this._handleToolCalls(toolCalls, userId, consultantId, chatId);
    } catch (err) {
      console.error('[PREMIUM-AI] Error generating premium reply:', err.message);
    }
  }

  /**
   * Build a combined system prompt from consultant mainPrompt + consultant identity + user context.
   */
  static _buildSystemPrompt(consultant, user, nativeLang) {
    const langMap = {
      tr: 'Turkish', en: 'English', de: 'German', es: 'Spanish',
      fr: 'French', hi: 'Hindi', it: 'Italian', ja: 'Japanese',
      ko: 'Korean', pt: 'Portuguese', ru: 'Russian', zh: 'Chinese',
    };
    const langName = langMap[nativeLang] || langMap.en;

    let prompt = consultant.mainPrompt || '';

    // --- Consultant identity ---
    prompt += `\n\n--- Your Identity ---`;

    const consultantName =
      (consultant.names && (consultant.names[nativeLang] || consultant.names.en || consultant.names.tr))
      || 'Consultant';
    prompt += `\nYour name: ${consultantName}`;

    if (consultant.job) {
      prompt += `\nYour specialization (job): ${consultant.job}`;
    }
    if (consultant.features && consultant.features.length > 0) {
      prompt += `\nYour expertise areas: ${consultant.features.join(', ')}`;
    }
    if (consultant.roles && consultant.roles.length > 0) {
      prompt += `\nYour persona: ${consultant.roles.join(', ')}`;
    }
    if (consultant.explanation) {
      prompt += `\nYour description key: ${consultant.explanation}`;
    }
    if (consultant.rating > 0) {
      prompt += `\nYour rating: ${consultant.rating}/5`;
    }

    // --- User context ---
    prompt += `\n\n--- User Context ---`;
    prompt += `\nUser name: ${user.username || 'Unknown'}`;
    prompt += `\nRespond in ${langName}.`;

    if (user.generalProfile || user.generalPsychologicalProfile) {
      prompt += `\nUser psychological profile: ${user.generalProfile || user.generalPsychologicalProfile}`;
    }

    if (user.userAgentNotes && user.userAgentNotes.length > 0) {
      prompt += `\nPrevious notes about user: ${JSON.stringify(user.userAgentNotes)}`;
    }

    return prompt;
  }

  /**
   * Send message from user (free / normal chat).
   * AI responds with text only.
   */
  static async sendMessage(userId, consultantId, message, isFile = false, fileURL = null, isVoiceMessage = false, voiceURL = null, imageContent = null, voiceMessageContent = null) {
    try {
      const chat = await this.getOrCreateChat(userId, consultantId);

      const user = await UserService.getUserById(userId);
      if (!user) throw new Error('User not found');

      const sentTime = new Date().toISOString();
      const userMessage = await MessageRepository.create(
        chat.chatId, userId, 'user', message, sentTime,
        isFile, fileURL, isVoiceMessage, voiceURL,
        imageContent, voiceMessageContent
      );

      let lastMessageText = message;
      if (isVoiceMessage) lastMessageText = message || '[Voice Message]';
      else if (isFile) lastMessageText = message || '[File]';
      await ChatRepository.updateLastMessage(chat.chatId, lastMessageText, sentTime);

      const chatHistory = await MessageRepository.getChatHistory(chat.chatId, 50);

      let messageType = 'text';
      if (isVoiceMessage) messageType = 'voice';
      else if (isFile) messageType = 'image';

      this._generateAndSaveTextReply(
        chat.chatId, consultantId, user, chatHistory,
        messageType, message, fileURL, imageContent, voiceMessageContent
      ).catch(err => console.error('[CHAT-AI] background error:', err.message));

      return { chat, message: userMessage };
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  /**
   * Send premium message from user.
   * AI responds with voice (TTS via ElevenLabs).
   */
  static async sendPremiumMessage(userId, consultantId, message, isFile = false, fileURL = null, isVoiceMessage = false, voiceURL = null, imageContent = null, voiceMessageContent = null) {
    try {
      const chat = await this.getOrCreateChat(userId, consultantId);

      const user = await UserService.getUserById(userId);
      if (!user) throw new Error('User not found');

      const sentTime = new Date().toISOString();
      const userMessage = await MessageRepository.create(
        chat.chatId, userId, 'user', message, sentTime,
        isFile, fileURL, isVoiceMessage, voiceURL,
        imageContent, voiceMessageContent
      );

      let lastMessageText = message;
      if (isVoiceMessage) lastMessageText = message || '[Voice Message]';
      else if (isFile) lastMessageText = message || '[File]';
      await ChatRepository.updateLastMessage(chat.chatId, lastMessageText, sentTime);

      const chatHistory = await MessageRepository.getChatHistory(chat.chatId, 50);

      let messageType = 'text';
      if (isVoiceMessage) messageType = 'voice';
      else if (isFile) messageType = 'image';

      this._generatePremiumReply(
        chat.chatId, consultantId, user, chatHistory,
        messageType, message, fileURL, imageContent, voiceMessageContent
      ).catch(err => console.error('[PREMIUM-AI] background error:', err.message));

      return { chat, message: userMessage };
    } catch (error) {
      console.error('Error sending premium message:', error);
      throw error;
    }
  }

  /**
   * Send general assistant message (no DB, no consultant).
   * Returns AI text reply synchronously.
   */
  static async sendGeneralAssistantMessage(userId, message, isFile = false, fileURL = null, isVoiceMessage = false, voiceURL = null, imageContent = null, voiceMessageContent = null) {
    try {
      const user = await UserService.getUserById(userId);
      if (!user) throw new Error('User not found');

      let messageType = 'text';
      if (isVoiceMessage) messageType = 'voice';
      else if (isFile) messageType = 'image';

      const nativeLang = user.nativeLang || 'tr';
      const langMap = {
        tr: 'Turkish', en: 'English', de: 'German', es: 'Spanish',
        fr: 'French', hi: 'Hindi', it: 'Italian', ja: 'Japanese',
        ko: 'Korean', pt: 'Portuguese', ru: 'Russian', zh: 'Chinese',
      };
      const langName = langMap[nativeLang] || langMap.en;

      const systemPrompt =
        `You are a helpful mental wellness assistant. Respond in ${langName}. ` +
        `User name: ${user.username || 'Unknown'}.`;

      const { reply: aiReply } = await AIService.chat({
        systemPrompt,
        chatHistory: [],
        userMessage: message,
        messageType,
        imageURL: fileURL || null,
        imageContent: imageContent || null,
        voiceContent: voiceMessageContent || null,
        nativeLang,
        enableTools: false,
      });

      return { message: aiReply };
    } catch (error) {
      console.error('Error sending general assistant message:', error);
      throw error;
    }
  }







  /**
   * Get all chats for a user
   * @param {number} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of chats
   */
  static async getUserChats(userId, options = {}) {
    try {
      return await ChatRepository.findByUserId(userId, options);
    } catch (error) {
      console.error('Error getting user chats:', error);
      throw error;
    }
  }

  /**
   * Get chat by ID
   * @param {number} chatId - Chat ID
   * @param {number} userId - User ID (for authorization check)
   * @returns {Promise<Chat|null>} Chat or null
   */
  static async getChatById(chatId, userId) {
    try {
      const chat = await ChatRepository.findById(chatId);
      
      if (!chat) {
        return null;
      }

      // Check if user owns this chat
      if (chat.userId !== userId) {
        throw new Error('Unauthorized: Chat does not belong to user');
      }

      return chat;
    } catch (error) {
      console.error('Error getting chat by ID:', error);
      throw error;
    }
  }

  /**
   * Get messages for a chat
   * @param {number} chatId - Chat ID
   * @param {number} userId - User ID (for authorization check)
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of messages
   */
  static async getChatMessages(chatId, userId, options = {}) {
    try {
      // Verify chat belongs to user
      const chat = await ChatRepository.findById(chatId);
      if (!chat) {
        throw new Error('Chat not found');
      }
      if (chat.userId !== userId) {
        throw new Error('Unauthorized: Chat does not belong to user');
      }

      return await MessageRepository.findByChatId(chatId, options);
    } catch (error) {
      console.error('Error getting chat messages:', error);
      throw error;
    }
  }

  /**
   * Get messages by consultant ID
   * @param {number} consultantId - Consultant ID
   * @param {number} userId - User ID (for authorization check)
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of messages
   */
  static async getMessagesByConsultant(consultantId, userId, options = {}) {
    try {
      // Find chat by user and consultant
      const chat = await ChatRepository.findByUserAndConsultant(userId, consultantId);
      
      if (!chat) {
        // No chat exists, return empty array
        return [];
      }

      // Get messages for the chat
      return await MessageRepository.findByChatId(chat.chatId, options);
    } catch (error) {
      console.error('Error getting messages by consultant:', error);
      throw error;
    }
  }

  /**
   * Process any tool calls returned by the AI (e.g. appointment creation).
   */
  static async _handleToolCalls(toolCalls, userId, consultantId, chatId) {
    if (!toolCalls || toolCalls.length === 0) return;

    for (const tc of toolCalls) {
      if (tc.name === 'create_appointment') {
        try {
          const { appointmentDate, urgency } = tc.args;
          console.log(`[APPOINTMENT-AI] Creating appointment: userId=${userId}, consultantId=${consultantId}, date=${appointmentDate}, urgency=${urgency}`);

          const result = await AppointmentService.createAppointmentFromWebhook(
            userId,
            consultantId,
            appointmentDate
          );

          console.log(`[APPOINTMENT-AI] Appointment created: id=${result.appointment?.id}`);
        } catch (err) {
          console.error(`[APPOINTMENT-AI] Failed to create appointment:`, err.message);

          if (err.message && err.message.includes('already has an appointment')) {
            try {
              const infoMsg = 'Bu danışmanla zaten bir randevunuz bulunuyor. Mevcut randevunuz tamamlandıktan sonra yeni randevu alabilirsiniz.';
              const errSentTime = new Date().toISOString();
              await this.createConsultantTextMessage(chatId, consultantId, infoMsg, errSentTime);
              await ChatRepository.updateLastMessage(chatId, infoMsg, errSentTime);
            } catch (msgErr) {
              console.error('[APPOINTMENT-AI] Could not send info message:', msgErr.message);
            }
          }
        }
      }
    }
  }

  /**
   * Helper: create assistant text message in DB.
   */
  static async createConsultantTextMessage(chatId, consultantId, message, sentTime) {
    await MessageRepository.create(
      chatId,
      consultantId,
      'assistant',
      message,
      sentTime,
      false, null, false, null, null, null
    );
  }

  /**
   * Delete chat by user and consultant
   * @param {number} userId - User ID
   * @param {number} consultantId - Consultant ID
   * @returns {Promise<boolean>} Success status
   */
  static async deleteChat(userId, consultantId) {
    try {
      // Verify chat exists and belongs to user
      const chat = await ChatRepository.findByUserAndConsultant(userId, consultantId);
      if (!chat) {
        // Chat doesn't exist, return false
        return false;
      }

      // Delete chat (messages will be deleted automatically via CASCADE)
      return await ChatRepository.deleteByUserAndConsultant(userId, consultantId);
    } catch (error) {
      console.error('Error deleting chat:', error);
      throw error;
    }
  }
}

module.exports = ChatService;

