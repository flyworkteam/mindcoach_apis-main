/**
 * Stream Call Routes
 * API endpoints for stream call (audio recording and processing)
 */

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/upload');
const BunnyCDNService = require('../services/bunnyCDNService');
const ChatService = require('../services/chatService');
const UserService = require('../services/userService');

/**
 * @route POST /stream-call
 * @desc Upload audio recording, process it, and send to webhook
 * @header Authorization: Bearer <token>
 * 
 * @body {number} consultantId - Consultant ID
 * @body {File} audio - Audio file (multipart/form-data)
 * 
 * Process:
 * 1. Upload audio to CDN
 * 2. Get audio transcription (if available)
 * 3. Send to webhook with audio URL and transcription
 * 4. Return response with audio URL and transcription
 */
router.post('/', authenticate, upload.single('audio'), async (req, res, next) => {
  try {
    const userId = req.userId;
    const consultantId = req.body.consultantId;
    const audioFile = req.file;

    // Validate consultantId
    if (!consultantId || isNaN(consultantId)) {
      return res.status(400).json({
        success: false,
        error: 'consultantId is required and must be a number'
      });
    }

    // Validate audio file
    if (!audioFile) {
      return res.status(400).json({
        success: false,
        error: 'Audio file is required'
      });
    }

    // Validate audio file type
    // Note: .m4a files are often detected as audio/mp4, so we include that too
    const allowedMimeTypes = [
      'audio/mpeg', 
      'audio/mp3', 
      'audio/wav', 
      'audio/ogg', 
      'audio/m4a', 
      'audio/aac', 
      'audio/x-m4a',
      'audio/mp4', // .m4a files are often detected as audio/mp4
      'audio/x-mp4' // Alternative MIME type for m4a
    ];
    if (!allowedMimeTypes.includes(audioFile.mimetype)) {
      console.log(`[STREAM-CALL] ⚠️ Invalid MIME type: ${audioFile.mimetype}, originalname: ${audioFile.originalname}`);
      return res.status(400).json({
        success: false,
        error: `Invalid audio file type. Received: ${audioFile.mimetype}, Allowed types: ${allowedMimeTypes.join(', ')}`
      });
    }

    console.log(`[STREAM-CALL] 📤 Audio upload başlatıldı - User: ${userId}, Consultant: ${consultantId}, File: ${audioFile.originalname}, Size: ${audioFile.size} bytes`);

    // 1. Upload audio to CDN
    let audioURL = null;
    try {
      const cdnPath = `stream-calls/${userId}/${Date.now()}_${audioFile.originalname}`;
      // 'voice' fileType kullanarak voices klasörüne yükle
      audioURL = await BunnyCDNService.uploadFile(audioFile.buffer, cdnPath, 'voice');
      console.log(`[STREAM-CALL] ✅ Audio CDN'e yüklendi: ${audioURL}`);
    } catch (cdnError) {
      console.error(`[STREAM-CALL] ❌ CDN upload hatası:`, cdnError);
      return res.status(500).json({
        success: false,
        error: 'Failed to upload audio to CDN'
      });
    }

    // 2. Get or create chat
    const chat = await ChatService.getOrCreateChat(userId, consultantId);

    // 3. Get user info for webhook
    const user = await UserService.getUserById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // 4. Get chat history for webhook
    const chatHistory = await require('../repositories/MessageRepository').getChatHistory(chat.chatId, 50);

    // 5. Prepare webhook data
    // Note: Audio transcription will be added later if available
    const webhookData = {
      id: consultantId,
      chatId: chat.chatId,
      nativeLang: user.nativeLang || 'en',
      message: '[Stream Call Audio]', // Placeholder, will be replaced with transcription if available
      messageType: 'voice',
      voiceURL: audioURL,
      userInfo: {
        username: user.username,
        phycoProfile: user.psychologicalProfileBasedOnMessages || user.generalPsychologicalProfile || 'genel_profil',
        chatHistory: chatHistory.map(msg => ({
          sender: msg.sender,
          message: msg.message,
          sentTime: new Date(msg.sentTime).toLocaleDateString('en-GB'), // DD/MM/YYYY format
          messageType: msg.isVoiceMessage ? 'voice' : (msg.isFile ? 'image' : 'text'),
          ...(msg.isVoiceMessage && msg.voiceURL && { voiceContent: msg.voiceMessageContent || msg.message }),
          ...(msg.isFile && msg.fileURL && { imageContent: msg.imageContent || msg.message })
        })),
        aiComments: []
      }
    };

    // 6. Send to webhook
    // Webhook URL: /webhook/stream-call
    // Basit yapı: Direkt webhook'a gönder, hata olsa bile audio CDN'e yüklendiği için response döndür
    const webhookBaseURL = 'https://n8n.srv1548849.hstgr.cloud';
    const webhookEndpoint = `${webhookBaseURL}/webhook/stream-call`;

    console.log(`[STREAM-CALL] 📤 Webhook'a gönderiliyor: ${webhookEndpoint}`);

    let webhookResponse = null;
    let webhookSuccess = false;
    
    try {
      webhookResponse = await ChatService.sendToWebhook(webhookData, webhookEndpoint);
      console.log(`[STREAM-CALL] ✅ Webhook'a başarıyla gönderildi`);
      console.log(`[STREAM-CALL] 📥 Webhook response:`, JSON.stringify(webhookResponse, null, 2));
      webhookSuccess = true;
    } catch (webhookError) {
      console.error(`[STREAM-CALL] ❌ Webhook hatası:`, webhookError.message);
      // Webhook hatası olsa bile response döndür (audio CDN'e yüklendi)
      console.warn(`[STREAM-CALL] ⚠️ Webhook gönderilemedi, ancak audio CDN'e yüklendi. Response döndürülüyor.`);
    }

    // 7. Extract transcription and audio content from webhook response (if available)
    let transcription = null;
    let audioContent = null;
    if (webhookResponse) {
      // Webhook response format may vary, adjust based on actual response
      transcription = webhookResponse.transcription || webhookResponse.text || webhookResponse.content || null;
      audioContent = webhookResponse.audioContent || webhookResponse.content || null;
      
      if (transcription) {
        console.log(`[STREAM-CALL] ✅ Transcription alındı: ${transcription.substring(0, 100)}...`);
      }
    }

    // 8. Create message in database (optional - for chat history)
    try {
      const sentTime = new Date().toISOString();
      const messageText = transcription || '[Stream Call Audio]';
      
      await require('../repositories/MessageRepository').create(
        chat.chatId,
        userId,
        'user',
        messageText,
        sentTime,
        false, // isFile
        null, // fileURL
        true, // isVoiceMessage
        audioURL, // voiceURL
        null, // imageContent
        transcription // voiceMessageContent (transcription from webhook)
      );

      // Update chat last message
      await require('../repositories/ChatRepository').updateLastMessage(
        chat.chatId,
        messageText,
        sentTime
      );
    } catch (dbError) {
      console.error(`[STREAM-CALL] ⚠️ Database kayıt hatası (non-critical):`, dbError);
    }

    // 9. Return response
    // Note: Webhook hatası olsa bile audio CDN'e yüklendiği için success response döndürülür
    const responseMessage = webhookSuccess 
      ? 'Audio uploaded and sent to webhook successfully'
      : 'Audio uploaded successfully (webhook failed, but audio is available on CDN)';
    
    res.status(200).json({
      success: true,
      data: {
        audioURL: audioURL,
        chatId: chat.chatId,
        message: responseMessage,
        transcription: transcription, // Transcription from webhook (if available)
        audioContent: audioContent, // Additional audio content from webhook (if available)
        webhookResponse: webhookResponse, // Full webhook response (if available)
        webhookSuccess: webhookSuccess // Whether webhook was successful
      }
    });

  } catch (error) {
    console.error(`[STREAM-CALL] ❌ Error:`, error);
    next(error);
  }
});

module.exports = router;

