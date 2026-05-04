/**
 * Video Call Routes
 * API endpoints for video call (audio recording and processing)
 * Basit yapı: Ses dosyası CDN'e yüklenir, webhook'a gönderilir, response direkt döndürülür
 */

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/upload');
const BunnyCDNService = require('../services/bunnyCDNService');
const ChatService = require('../services/chatService');
const UserService = require('../services/userService');
const ConsultantService = require('../services/consultantService');
const SpeechToTextService = require('../services/speechToTextService');
const pool = require('../config/database');

let ratingTableReady = false;
let consultantRatingColumnReady = false;
async function ensureVideoCallRatingsTable() {
  if (ratingTableReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS video_call_ratings (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      consultant_id BIGINT UNSIGNED NOT NULL,
      rating TINYINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_vcr_user_id (user_id),
      KEY idx_vcr_consultant_id (consultant_id),
      KEY idx_vcr_created_at (created_at),
      CONSTRAINT chk_vcr_rating CHECK (rating BETWEEN 1 AND 5)
    )
  `);
  ratingTableReady = true;
}

async function ensureConsultantRatingColumn() {
  if (consultantRatingColumnReady) return;
  const [rows] = await pool.execute(`
    SELECT COUNT(*) AS cnt
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'consultants'
      AND COLUMN_NAME = 'rating'
  `);
  const exists = Number(rows?.[0]?.cnt || 0) > 0;
  if (!exists) {
    await pool.execute(`
      ALTER TABLE consultants
      ADD COLUMN rating DECIMAL(4,2) NOT NULL DEFAULT 0
    `);
    console.log('[VIDEO-CALL] ✅ Added missing consultants.rating column');
  }
  consultantRatingColumnReady = true;
}

/**
 * @route POST /video-call
 * @desc Upload audio recording, process it, and send to webhook
 * @header Authorization: Bearer <token>
 * 
 * @body {number} consultantId - Consultant ID
 * @body {File} audio - Audio file (multipart/form-data)
 * 
 * Process:
 * 1. Upload audio to CDN
 * 2. Get user and consultant info
 * 3. Send to webhook with audio URL, user info, consultant info
 * 4. Return webhook response directly (audioURL, transcription, audioContent)
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
    const allowedMimeTypes = [
      'audio/mpeg', 
      'audio/mp3', 
      'audio/wav', 
      'audio/ogg', 
      'audio/m4a', 
      'audio/aac', 
      'audio/x-m4a',
      'audio/mp4', // .m4a files are often detected as audio/mp4
      'audio/x-mp4'
    ];
    if (!allowedMimeTypes.includes(audioFile.mimetype)) {
      console.log(`[VIDEO-CALL] ⚠️ Invalid MIME type: ${audioFile.mimetype}, originalname: ${audioFile.originalname}`);
      return res.status(400).json({
        success: false,
        error: `Invalid audio file type. Received: ${audioFile.mimetype}, Allowed types: ${allowedMimeTypes.join(', ')}`
      });
    }

    console.log(`[VIDEO-CALL] 📤 Audio upload başlatıldı - User: ${userId}, Consultant: ${consultantId}, File: ${audioFile.originalname}, Size: ${audioFile.size} bytes`);

    // 1. Transcribe audio to text (speech-to-text)
    let transcription = null;
    try {
      console.log(`[VIDEO-CALL] 🎤 Audio transcription başlatılıyor...`);
      const user = await UserService.getUserById(userId);
      const userLanguage = user?.nativeLang || 'tr'; // Default to Turkish
      
      transcription = await SpeechToTextService.transcribeAudio(
        audioFile.buffer,
        audioFile.originalname,
        userLanguage
      );
      console.log(`[VIDEO-CALL] ✅ Transcription tamamlandı: ${transcription.substring(0, 100)}${transcription.length > 100 ? '...' : ''}`);
    } catch (transcriptionError) {
      console.error(`[VIDEO-CALL] ❌ Transcription hatası:`, transcriptionError.message);
      // Transcription hatası olsa bile devam et (audio yine de CDN'e yüklenecek)
      console.warn(`[VIDEO-CALL] ⚠️ Transcription başarısız, ancak işlem devam ediyor...`);
    }

    // 2. Upload audio to CDN
    let audioURL = null;
    try {
      const cdnPath = `video-calls/${userId}/${Date.now()}_${audioFile.originalname}`;
      // 'voice' fileType kullanarak voices klasörüne yükle
      audioURL = await BunnyCDNService.uploadFile(audioFile.buffer, cdnPath, 'voice');
      console.log(`[VIDEO-CALL] ✅ Audio CDN'e yüklendi: ${audioURL}`);
    } catch (cdnError) {
      console.error(`[VIDEO-CALL] ❌ CDN upload hatası:`, cdnError);
      return res.status(500).json({
        success: false,
        error: 'Failed to upload audio to CDN'
      });
    }

    // 3. Get user and consultant info for webhook
    const user = await UserService.getUserById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const consultant = await ConsultantService.getConsultantById(consultantId);
    if (!consultant) {
      return res.status(404).json({
        success: false,
        error: 'Consultant not found'
      });
    }

    // 4. Prepare webhook data (koç bilgileri, kullanıcı bilgileri ve genel profil)
    const webhookData = {
      voiceText: transcription || '', // Transcription (mesaj içeriği)
      conversationId: null, // Video call için conversation ID yok
      sender: 'user',
      // Kullanıcı bilgileri
      userInfo: {
        id: user.id,
        username: user.username,
        nativeLang: user.nativeLang || 'tr',
        phycoProfile: user.psychologicalProfileBasedOnMessages || user.generalPsychologicalProfile || 'genel_profil', // Genel profil
      },
      // Koç bilgileri
      consultantInfo: {
        id: consultant.id,
        names: consultant.names,
        job: consultant.job,
        photoURL: consultant.photoURL,
        voiceId: consultant.voiceId,
        url3d: consultant.url3d,
      }
    };

    // 5. Send to webhook (koç bilgileri, kullanıcı bilgileri ve genel profil ile)
    // /webhook/stream-call endpoint'ine gönder
    const webhookBaseURL = 'https://n8n.srv1548849.hstgr.cloud';
    const webhookEndpoint = `${webhookBaseURL}/webhook/stream-call`;

    console.log(`[VIDEO-CALL] 📤 Webhook'a gönderiliyor: ${webhookEndpoint}`);
    console.log(`[VIDEO-CALL] 📤 Webhook data:`, JSON.stringify(webhookData, null, 2));

    let webhookResponse = null;
    let webhookSuccess = false;
    
    try {
      webhookResponse = await ChatService.sendToWebhook(webhookData, webhookEndpoint);
      console.log(`[VIDEO-CALL] ✅ Webhook'a başarıyla gönderildi`);
      console.log(`[VIDEO-CALL] 📥 Webhook response:`, JSON.stringify(webhookResponse, null, 2));
      webhookSuccess = true;
    } catch (webhookError) {
      console.error(`[VIDEO-CALL] ❌ Webhook hatası:`, webhookError.message);
      console.warn(`[VIDEO-CALL] ⚠️ Webhook gönderilemedi, ancak audio CDN'e yüklendi. Response döndürülüyor.`);
    }

    // 6. Extract data from webhook response
    // Webhook response format:
    // {
    //   audioContent: "AI'ın verdiği cevap (text)",
    //   aiVoiceURL: "AI'ın sesli mesajının URL'si",
    //   userAudioContent: "Kullanıcı sesli mesajının içeriği"
    // }
    let audioContent = null;
    let aiVoiceURL = null;
    let userAudioContent = null;
    
    if (webhookResponse) {
      audioContent = webhookResponse.audioContent || null;
      aiVoiceURL = webhookResponse.aiVoiceURL || null;
      userAudioContent = webhookResponse.userAudioContent || null;
      
      if (audioContent) {
        console.log(`[VIDEO-CALL] ✅ Audio content alındı webhook'tan: ${audioContent.substring(0, 100)}...`);
      }
      if (aiVoiceURL) {
        console.log(`[VIDEO-CALL] ✅ AI voice URL alındı webhook'tan: ${aiVoiceURL}`);
      }
      if (userAudioContent) {
        console.log(`[VIDEO-CALL] ✅ User audio content alındı webhook'tan`);
      }
    }

    // 7. Return response
    res.status(200).json({
      success: true,
      transcribedText: transcription || '', // Transcription (ElevenLabs'den)
      fileUrl: audioURL, // CDN'den gelen kullanıcı audio URL
      audioContent: audioContent, // Webhook'tan gelen AI'ın text cevabı
      aiVoiceURL: aiVoiceURL, // Webhook'tan gelen AI'ın sesli mesaj URL'si
      userAudioContent: userAudioContent, // Webhook'tan gelen kullanıcı sesli mesaj içeriği
      webhookResponse: webhookResponse, // Full webhook response
      webhookSuccess: webhookSuccess
    });

  } catch (error) {
    console.error(`[VIDEO-CALL] ❌ Error:`, error);
    next(error);
  }
});

/**
 * @route POST /video-call/rate
 * @desc Save video call rating (post-call feedback)
 * @header Authorization: Bearer <token>
 *
 * @body {number} consultantId - Consultant ID
 * @body {number} rating - 1..5
 */
router.post('/rate', authenticate, async (req, res) => {
  try {
    const userId = req.userId;
    const consultantId = parseInt(req.body?.consultantId, 10);
    const rating = parseInt(req.body?.rating, 10);

    if (!consultantId || isNaN(consultantId)) {
      return res.status(400).json({
        success: false,
        error: 'consultantId is required and must be a number',
      });
    }
    if (!rating || isNaN(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        error: 'rating is required and must be an integer between 1 and 5',
      });
    }

    await ensureVideoCallRatingsTable();
    await ensureConsultantRatingColumn();

    const [result] = await pool.execute(
      `
      INSERT INTO video_call_ratings (user_id, consultant_id, rating)
      VALUES (?, ?, ?)
      `,
      [userId, consultantId, rating]
    );

    const [avgRows] = await pool.execute(
      `
      SELECT ROUND(AVG(rating), 2) AS avg_rating
      FROM video_call_ratings
      WHERE consultant_id = ?
      `,
      [consultantId]
    );
    const avgRating = Number(avgRows?.[0]?.avg_rating || 0);

    // Koç detay/listesinde kullanılan consultants.rating alanını güncel tut.
    await pool.execute(
      `
      UPDATE consultants
      SET rating = ?
      WHERE id = ?
      `,
      [avgRating, consultantId]
    );

    console.log(
      `[VIDEO-CALL] ⭐ Rating saved | id=${result.insertId} user=${userId} consultant=${consultantId} rating=${rating} avg=${avgRating}`
    );

    return res.status(200).json({
      success: true,
      data: {
        id: result.insertId,
        userId,
        consultantId,
        rating,
        consultantAvgRating: avgRating,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[VIDEO-CALL] ❌ Rating error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

module.exports = router;

