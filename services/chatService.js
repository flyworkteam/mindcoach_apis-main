/**
 * Chat Service
 * Business logic for chat operations
 */

const ChatRepository = require('../repositories/ChatRepository');
const MessageRepository = require('../repositories/MessageRepository');
const ConsultantRepository = require('../repositories/ConsultantRepository');
const UserService = require('./userService');
const ElevenLabsService = require('./elevenLabsService');
const BunnyCDNService = require('./bunnyCDNService');
const AppointmentService = require('./appointmentService');
const axios = require('axios');
const http = require('http');
const https = require('https');
const { circuitBreakers } = require('../middleware/circuitBreaker');

class ChatService {
  /**
   * Get or create chat for user and consultant
   * @param {number} userId - User ID
   * @param {number} consultantId - Consultant ID
   * @returns {Promise<Chat>} Chat instance
   */
  static async getOrCreateChat(userId, consultantId) {
    try {
      // Check if chat already exists
      let chat = await ChatRepository.findByUserAndConsultant(userId, consultantId);
      
      if (!chat) {
        // Create new chat
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
   * Send message to assistant via webhook
   * @param {Object} webhookData - Webhook request data
   * @returns {Promise<Object>} Webhook response
   */
  static async sendToWebhook(webhookData, webhookUrl = null) {
    const webhookCircuitBreaker = circuitBreakers.webhook;
    
    // Use circuit breaker to protect webhook calls
    return await webhookCircuitBreaker.execute(async () => {
      try {
        // Use provided webhook URL or default
        const url = webhookUrl || 'https://n8n.srv1548849.hstgr.cloud/webhook/chat-assistant';
        
        console.log(`[WEBHOOK] 📤 Sending to webhook: ${url}`);
        
        const response = await axios.post(url, webhookData, {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: parseInt(process.env.WEBHOOK_TIMEOUT) || 45000, // 45 seconds timeout (configurable)
          // Add connection timeout to prevent hanging requests
          httpAgent: new http.Agent({
            keepAlive: true,
            keepAliveMsecs: 1000,
            maxSockets: 50,
            maxFreeSockets: 10,
            timeout: 10000, // 10 seconds connection timeout
          }),
          httpsAgent: new https.Agent({
            keepAlive: true,
            keepAliveMsecs: 1000,
            maxSockets: 50,
            maxFreeSockets: 10,
            timeout: 10000, // 10 seconds connection timeout
          }),
        });

        console.log(`[WEBHOOK] ✅ Webhook response received:`, response.status);
        return response.data;
      } catch (error) {
        console.error('[WEBHOOK] ❌ Error sending to webhook:', error.message);
        if (error.response) {
          console.error('[WEBHOOK] ❌ Response status:', error.response.status);
          console.error('[WEBHOOK] ❌ Response data:', error.response.data);
        }
        throw new Error(`Webhook request failed: ${error.message}`);
      }
    }, async () => {
      // Fallback when circuit breaker is open
      console.warn(`⚠️ [WEBHOOK] Circuit breaker is OPEN, webhook call skipped`);
      throw new Error('Webhook service temporarily unavailable. Please try again later.');
    });
  }

  /**
   * Send message from user
   * @param {number} userId - User ID
   * @param {number} consultantId - Consultant ID
   * @param {string} message - Message content
   * @param {boolean} isFile - Whether message is a file (default: false)
   * @param {string} fileURL - File URL if message is a file (default: null)
   * @param {boolean} isVoiceMessage - Whether message is a voice message (default: false)
   * @param {string} voiceURL - Voice message URL if message is a voice message (default: null)
   * @param {string} imageContent - AI-analyzed image content (default: null)
   * @param {string} voiceMessageContent - Transcribed voice message content (default: null)
   * @returns {Promise<Object>} Response with chat and message
   */
  static async sendMessage(userId, consultantId, message, isFile = false, fileURL = null, isVoiceMessage = false, voiceURL = null, imageContent = null, voiceMessageContent = null) {
    try {
      // Get or create chat
      const chat = await this.getOrCreateChat(userId, consultantId);
      
      // Get user info
      const user = await UserService.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Create user message
      const sentTime = new Date().toISOString();
      const userMessage = await MessageRepository.create(
        chat.chatId,
        userId,
        'user',
        message,
        sentTime,
        isFile,
        fileURL,
        isVoiceMessage,
        voiceURL,
        imageContent,
        voiceMessageContent
      );

      // Update chat last message (use appropriate indicator)
      let lastMessageText = message;
      if (isVoiceMessage) {
        lastMessageText = message || '[Voice Message]';
      } else if (isFile) {
        lastMessageText = message || '[File]';
      }
      await ChatRepository.updateLastMessage(chat.chatId, lastMessageText, sentTime);

      // Get chat history for webhook
      const chatHistory = await MessageRepository.getChatHistory(chat.chatId, 50);

      // Determine message type
      let messageType = 'text';
      if (isVoiceMessage) {
        messageType = 'voice';
      } else if (isFile) {
        messageType = 'image';
      }

      // Prepare webhook message content
      // For image: use imageContent if available, otherwise use message
      // For voice: use voiceMessageContent if available, otherwise use message
      // For text: use message
      let webhookMessage = message;
      if (isFile && imageContent) {
        webhookMessage = imageContent;
      } else if (isVoiceMessage && voiceMessageContent) {
        webhookMessage = voiceMessageContent;
      }

      // Prepare webhook data
      const webhookData = {
        id: consultantId,
        chatId: chat.chatId,
        nativeLang: user.nativeLang || 'tr',
        message: webhookMessage,
        messageType: messageType,
        // Add URL if message is image or voice
        ...(isFile && fileURL && { imageURL: fileURL }),
        ...(isVoiceMessage && voiceURL && { voiceURL: voiceURL }),
        userInfo: {
          username: user.username,
          phycoProfile: user.generalProfile || user.generalPsychologicalProfile || null,
          chatHistory: chatHistory,
          aiComments: user.userAgentNotes || []
        }
      };

      // Send to webhook asynchronously (fire-and-forget)
      // Don't wait for webhook response, send it in background
      this.sendToWebhook(webhookData).catch(error => {
        console.error('Webhook error (background):', error.message);
        // Log error but don't affect the response
      });

      // Return immediately without waiting for webhook
      return {
        chat: chat,
        message: userMessage
      };
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }




  static async sendPremiumMessage(userId, consultantId, message, isFile = false, fileURL = null, isVoiceMessage = false, voiceURL = null, imageContent = null, voiceMessageContent = null) {
    try {
      // Get or create chat
      const chat = await this.getOrCreateChat(userId, consultantId);
      
      // Get user info
      const user = await UserService.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Create user message
      const sentTime = new Date().toISOString();
      const userMessage = await MessageRepository.create(
        chat.chatId,
        userId,
        'user',
        message,
        sentTime,
        isFile,
        fileURL,
        isVoiceMessage,
        voiceURL,
        imageContent,
        voiceMessageContent
      );

      // Update chat last message (use appropriate indicator)
      let lastMessageText = message;
      if (isVoiceMessage) {
        lastMessageText = message || '[Voice Message]';
      } else if (isFile) {
        lastMessageText = message || '[File]';
      }
      await ChatRepository.updateLastMessage(chat.chatId, lastMessageText, sentTime);

      // Get chat history for webhook
      const chatHistory = await MessageRepository.getChatHistory(chat.chatId, 50);

      // Get user's upcoming appointment (to inform AI so it doesn't create duplicates)
      let upcomingAppointment = null;
      try {
        upcomingAppointment = await AppointmentService.getUpcomingAppointmentByUserId(userId);
      } catch (apptErr) {
        console.warn('[PREMIUM-CHAT] Could not fetch upcoming appointment:', apptErr.message);
      }

      // Determine message type
      let messageType = 'text';
      if (isVoiceMessage) {
        messageType = 'voice';
      } else if (isFile) {
        messageType = 'image';
      }

      // Prepare webhook message content
      // For image: use imageContent if available, otherwise use message
      // For voice: use voiceMessageContent if available, otherwise use message
      // For text: use message
      let webhookMessage = message;
      if (isFile && imageContent) {
        webhookMessage = imageContent;
      } else if (isVoiceMessage && voiceMessageContent) {
        webhookMessage = voiceMessageContent;
      }

      // Prepare webhook data
      const webhookData = {
        id: consultantId,
        chatId: chat.chatId,
        nativeLang: user.nativeLang || 'tr',
        message: webhookMessage,
        messageType: messageType,
        // Add URL if message is image or voice
        ...(isFile && fileURL && { imageURL: fileURL }),
        ...(isVoiceMessage && voiceURL && { voiceURL: voiceURL }),
        // Pass upcoming appointment so AI knows not to create duplicate
        upcomingAppointment: upcomingAppointment
          ? {
              appointmentId: upcomingAppointment.id,
              date: upcomingAppointment.appointmentDate,
              status: upcomingAppointment.status,
              consultantId: upcomingAppointment.consultantId
            }
          : null,
        userInfo: {
          username: user.username,
          phycoProfile: user.generalProfile || user.generalPsychologicalProfile || null,
          chatHistory: chatHistory,
          aiComments: user.userAgentNotes || []
        }
      };

      // Send to premium webhook asynchronously (fire-and-forget)
      // Process webhook response in background
      const premiumWebhookUrl = 'https://n8n.srv1548849.hstgr.cloud/webhook/premium-conversation';
      console.log(`[PREMIUM-CHAT] 📤 Sending to premium webhook: ${premiumWebhookUrl}`);
      this.sendToWebhook(webhookData, premiumWebhookUrl)
        .then(webhookResponse => {
          console.log(`[PREMIUM-CHAT] ✅ Premium webhook response received`);
          // Process webhook response with chat info
          return this.processPremiumWebhookResponse(webhookResponse, chat.chatId, consultantId);
        })
        .catch(error => {
          console.error('[PREMIUM-CHAT] ❌ Premium webhook error (background):', error.message);
          // Log error but don't affect the response
        });

      // Return immediately without waiting for webhook
      return {
        chat: chat,
        message: userMessage
      };
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  /**
   * Send general assistant message
   * No DB operations - only sends to webhook and returns response
   * @param {number} userId - User ID
   * @param {string} message - Message content
   * @param {boolean} isFile - Is file message (default: false)
   * @param {string} fileURL - File URL (default: null)
   * @param {boolean} isVoiceMessage - Is voice message (default: false)
   * @param {string} voiceURL - Voice URL (default: null)
   * @param {string} imageContent - Image content (AI analyzed) (default: null)
   * @param {string} voiceMessageContent - Voice message content (transcription) (default: null)
   * @returns {Promise<Object>} Webhook response
   */
  static async sendGeneralAssistantMessage(userId, message, isFile = false, fileURL = null, isVoiceMessage = false, voiceURL = null, imageContent = null, voiceMessageContent = null) {
    try {
      // Get user info (only for webhook data, no DB operations)
      const user = await UserService.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Determine message type
      let messageType = 'text';
      if (isVoiceMessage) {
        messageType = 'voice';
      } else if (isFile) {
        messageType = 'image';
      }

      // Prepare webhook message content
      // For image: use imageContent if available, otherwise use message
      // For voice: use voiceMessageContent if available, otherwise use message
      // For text: use message
      let webhookMessage = message;
      if (isFile && imageContent) {
        webhookMessage = imageContent;
      } else if (isVoiceMessage && voiceMessageContent) {
        webhookMessage = voiceMessageContent;
      }

      // Prepare webhook data (no chatId, no chatHistory - no DB operations)
      const webhookData = {
        nativeLang: user.nativeLang || 'tr',
        message: webhookMessage,
        messageType: messageType,
        // Add URL if message is image or voice
        ...(isFile && fileURL && { imageURL: fileURL }),
        ...(isVoiceMessage && voiceURL && { voiceURL: voiceURL }),
        userInfo: {
          username: user.username,
          phycoProfile: user.generalProfile || user.generalPsychologicalProfile || null,
          chatHistory: [], // Empty - no chat history for general assistant
          aiComments: user.userAgentNotes || []
        }
      };

      // Send to general assistant webhook and wait for response
      const generalAssistantWebhookUrl = 'https://n8n.srv1548849.hstgr.cloud/webhook/general-assistant';
      console.log(`[GENERAL-ASSISTANT] 📤 Sending to general assistant webhook: ${generalAssistantWebhookUrl}`);
      
      const webhookResponse = await this.sendToWebhook(webhookData, generalAssistantWebhookUrl);
      
      console.log(`[GENERAL-ASSISTANT] ✅ General assistant webhook response received`);
      
      // Return webhook response directly (no DB operations)
      return webhookResponse;
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
   * Process premium webhook response
   * Handles webhook response array or single object and creates messages accordingly
   * @param {Array|Object} webhookResponse - Webhook response (array or single object)
   * @param {number} defaultChatId - Default chat ID (fallback if not in response)
   * @param {number} defaultConsultantId - Default consultant ID (fallback if not in response)
   * @returns {Promise<void>}
   */
  static async processPremiumWebhookResponse(webhookResponse, defaultChatId, defaultConsultantId) {
    try {
      // Normalize response to array format (support both array and single object)
      let messagesArray = [];
      
      if (Array.isArray(webhookResponse)) {
        messagesArray = webhookResponse;
      } else if (webhookResponse && typeof webhookResponse === 'object') {
        // Single object - convert to array
        messagesArray = [webhookResponse];
      } else {
        console.error('[PREMIUM-CHAT] Invalid webhook response format - expected array or object:', webhookResponse);
        return;
      }

      console.log(`[PREMIUM-CHAT] Processing ${messagesArray.length} message(s) from webhook`);

      // Process each message in the response
      for (const messageData of messagesArray) {
        try {
          const { messageType, message, consultantId, chatId, needsAppointment, appointmentDate } = messageData;
          
          // Use chatId from response or fallback to default
          const targetChatId = chatId || defaultChatId;
          
          if (!targetChatId) {
            console.error('[PREMIUM-CHAT] No chatId available in message data or default');
            continue;
          }

          // Use consultantId from response or fallback to default
          const targetConsultantId = consultantId || defaultConsultantId;
          
          if (!targetConsultantId) {
            console.error('[PREMIUM-CHAT] No consultantId available in message data or default');
            continue;
          }

          if (!messageType || !message) {
            console.warn('[PREMIUM-CHAT] Skipping invalid message data:', messageData);
            continue;
          }

          const sentTime = new Date().toISOString();

          if (messageType === 'voice') {
            // Voice message - generate audio and save
            // Get consultant data
            const consultant = await ConsultantRepository.findById(targetConsultantId);
            if (!consultant) {
              console.error(`[PREMIUM-CHAT] Consultant ${targetConsultantId} not found`);
              continue;
            }

            if (!consultant.voiceId) {
              console.error(`[PREMIUM-CHAT] Consultant ${targetConsultantId} does not have voiceId`);
              continue;
            }

            console.log(`[PREMIUM-CHAT] 🎙️ Generating voice message for consultant ${targetConsultantId} with voiceId ${consultant.voiceId}`);

            // Generate audio using ElevenLabs
            let audioBuffer;
            try {
              audioBuffer = await ElevenLabsService.textToSpeech(message, consultant.voiceId);
              console.log(`[PREMIUM-CHAT] ✅ Voice generated successfully (${audioBuffer.length} bytes)`);
            } catch (ttsError) {
              console.error(`[PREMIUM-CHAT] ❌ TTS error:`, ttsError.message);
              // Fallback to text message if TTS fails
              await this.createConsultantTextMessage(targetChatId, targetConsultantId, message, sentTime);
              continue;
            }

            // Upload audio to CDN
            let voiceURL;
            try {
              const fileName = `premium_voice_${Date.now()}.mp3`;
              voiceURL = await BunnyCDNService.uploadFile(audioBuffer, fileName, 'voice');
              console.log(`[PREMIUM-CHAT] ✅ Voice uploaded to CDN: ${voiceURL}`);
            } catch (uploadError) {
              console.error(`[PREMIUM-CHAT] ❌ CDN upload error:`, uploadError.message);
              // Fallback to text message if upload fails
              await this.createConsultantTextMessage(targetChatId, targetConsultantId, message, sentTime);
              continue;
            }

            // Save voice message to database
            await MessageRepository.create(
              targetChatId,
              targetConsultantId, // senderId = consultantId for consultant messages
              'assistant',
              message, // text content (transcription)
              sentTime,
              false, // isFile
              null, // fileURL
              true, // isVoiceMessage
              voiceURL, // voiceURL
              null, // imageContent
              message // voiceMessageContent (same as message for TTS)
            );

            console.log(`[PREMIUM-CHAT] ✅ Voice message saved to database`);

          } else if (messageType === 'text') {
            // Text message - save directly
            await this.createConsultantTextMessage(targetChatId, targetConsultantId, message, sentTime);
            console.log(`[PREMIUM-CHAT] ✅ Text message saved to database`);

          } else {
            console.warn(`[PREMIUM-CHAT] Unknown messageType: ${messageType}`);
          }

          // Update chat last message
          await ChatRepository.updateLastMessage(targetChatId, message, sentTime);

          // Handle appointment creation if needed
          if (needsAppointment === true && appointmentDate) {
            try {
              // Get chat to retrieve userId
              const chat = await ChatRepository.findById(targetChatId);
              if (!chat) {
                console.error(`[PREMIUM-CHAT] Chat ${targetChatId} not found for appointment creation`);
              } else {
                const userId = chat.userId;
                
                // Ensure appointmentDate is in ISO 8601 format
                let isoAppointmentDate = appointmentDate;
                try {
                  const date = new Date(appointmentDate);
                  if (!isNaN(date.getTime())) {
                    isoAppointmentDate = date.toISOString();
                  }
                } catch (dateError) {
                  console.warn(`[PREMIUM-CHAT] ⚠️ Could not convert appointmentDate to ISO format, using as-is:`, appointmentDate);
                }
                
                console.log(`[PREMIUM-CHAT] 📅 Creating appointment: userId=${userId}, consultantId=${targetConsultantId}, date=${isoAppointmentDate}`);
                
                // Call AppointmentService directly (same application, no HTTP needed)
                // Use await to ensure proper error handling and database commit
                AppointmentService.createAppointmentFromWebhook(
                  userId,
                  targetConsultantId,
                  isoAppointmentDate
                )
                .then(result => {
                  console.log(`[PREMIUM-CHAT] ✅ Appointment created successfully:`, {
                    appointmentId: result.appointment?.id,
                    userId: userId,
                    consultantId: targetConsultantId,
                    date: isoAppointmentDate
                  });
                })
                .catch(async (error) => {
                  console.error(`[PREMIUM-CHAT] ❌ Failed to create appointment:`, {
                    error: error.message,
                    userId: userId,
                    consultantId: targetConsultantId,
                    date: isoAppointmentDate
                  });

                  // If user already has an upcoming appointment, inform them in chat
                  if (error.message && error.message.includes('already has an upcoming appointment')) {
                    try {
                      // Extract the existing appointment date from error message
                      const dateMatch = error.message.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
                      const existingDate = dateMatch
                        ? new Date(dateMatch[1]).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })
                        : null;

                      const infoMsg = existingDate
                        ? `Mevcut bir randevunuz zaten var (${existingDate}). Yeni randevu oluşturulamadı. Mevcut randevunuz tamamlandıktan sonra yeni randevu alabilirsiniz.`
                        : 'Mevcut bir randevunuz zaten olduğu için yeni randevu oluşturulamadı.';

                      const errSentTime = new Date().toISOString();
                      await ChatService.createConsultantTextMessage(targetChatId, targetConsultantId, infoMsg, errSentTime);
                      await ChatRepository.updateLastMessage(targetChatId, infoMsg, errSentTime);
                      console.log(`[PREMIUM-CHAT] ℹ️ Sent duplicate-appointment info message to user`);
                    } catch (msgErr) {
                      console.error(`[PREMIUM-CHAT] ❌ Could not send info message:`, msgErr.message);
                    }
                  }
                });
              }
            } catch (appointmentError) {
              console.error('[PREMIUM-CHAT] ❌ Error handling appointment creation:', appointmentError.message);
              // Don't fail the message processing if appointment creation fails
            }
          }

        } catch (messageError) {
          console.error('[PREMIUM-CHAT] Error processing individual message:', messageError);
          // Continue processing other messages
        }
      }

      console.log(`[PREMIUM-CHAT] ✅ Finished processing webhook response`);

    } catch (error) {
      console.error('[PREMIUM-CHAT] Error processing webhook response:', error);
    }
  }

  /**
   * Helper method to create assistant text message
   * @param {number} chatId - Chat ID
   * @param {number} consultantId - Consultant ID
   * @param {string} message - Message text
   * @param {string} sentTime - Sent time (ISO string)
   * @returns {Promise<void>}
   */
  static async createConsultantTextMessage(chatId, consultantId, message, sentTime) {
    await MessageRepository.create(
      chatId,
      consultantId, // senderId = consultantId for assistant messages
      'assistant',
      message,
      sentTime,
      false, // isFile
      null, // fileURL
      false, // isVoiceMessage
      null, // voiceURL
      null, // imageContent
      null // voiceMessageContent
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

