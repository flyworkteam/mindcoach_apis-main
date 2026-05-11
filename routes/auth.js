const router = require("express").Router();
const { validateAuthRequest } = require("../middleware/validation");
const AuthService = require("../services/authService");
const UserService = require("../services/userService");
const { generateToken, decodeToken } = require("../utils/jwt");
const TokenRepository = require("../repositories/TokenRepository");
const upload = require("../middleware/upload");
const BunnyCDNService = require("../services/bunnyCDNService");
const OneSignalService = require("../services/oneSignalService");
const NotificationRepository = require("../repositories/NotificationRepository");
const AccountDeletionFeedbackRepository = require("../repositories/AccountDeletionFeedbackRepository");

/**
 * Helper function to send welcome notification
 * @param {number} userId - User ID
 * @param {string} username - Username for personalized message
 */
async function sendWelcomeNotification(userId, username) {
  try {
    const title = 'Hoş Geldiniz! 👋';
    const subtitle = `Merhaba ${username}, MindCoach'a hoş geldiniz!`;
    const metadata = {
      type: 'welcome',
      timestamp: new Date().toISOString()
    };

    // Send via OneSignal (if configured)
    let oneSignalResult = null;
    try {
      oneSignalResult = await OneSignalService.sendNotification(
        userId,
        title,
        subtitle,
        metadata,
        'system_notification'
      );
    } catch (oneSignalError) {
      console.error('⚠️ OneSignal error (continuing to save to DB):', oneSignalError.message);
      // Continue even if OneSignal fails
    }

    // Save to database
    await NotificationRepository.create({
      user_id: userId,
      type: 'system_notification',
      title: title,
      subtitle: subtitle,
      metadata: {
        ...metadata,
        oneSignalId: oneSignalResult?.oneSignalId || null
      }
    });

    console.log(`✅ Welcome notification sent to user ${userId}`);
  } catch (error) {
    console.error('❌ Error sending welcome notification:', error);
    throw error;
  }
}

/**
 * @route POST /auth/logout
 * @desc Logout user - Revoke current token
 * @header Authorization: Bearer <token>
 */
router.post("/logout", require("../middleware/auth").authenticate, async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (token) {
      // Revoke token in database
      await TokenRepository.revoke(token);
    }

    res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });
  } catch (error) {
    console.error('Logout error:', error);
    next(error);
  }
});

/**
 * @route POST /auth/logout-all
 * @desc Logout from all devices - Revoke all tokens for user
 * @header Authorization: Bearer <token>
 */
router.post("/logout-all", require("../middleware/auth").authenticate, async (req, res, next) => {
  try {
    const userId = req.userId;
    
    // Revoke all tokens for user
    const revokedCount = await TokenRepository.revokeAll(userId);

    res.status(200).json({
      success: true,
      message: `Logged out from ${revokedCount} device(s) successfully`
    });
  } catch (error) {
    console.error('Logout all error:', error);
    next(error);
  }
});

/**
 * @route POST /auth/guest
 * @desc Create guest user account (anonymous login)
 * @body (no body required)
 */
router.post("/guest", async (req, res, next) => {
  try {
    // Cihazdan gelen sabit ID varsa kullan, yoksa yeni oluştur
    // Bu sayede aynı cihaz her zaman aynı hesaba döner
    const deviceId = req.body?.deviceId;
    const guestId = (deviceId && typeof deviceId === 'string' && deviceId.trim().length > 0)
      ? deviceId.trim()
      : `guest_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    console.log(`🔑 [GUEST] deviceId: ${deviceId || 'not provided'}, guestId: ${guestId}`);

    // Önce mevcut kullanıcıyı kontrol et — welcome bildirimi sadece yeni kullanıcıya gidecek
    const UserRepository = require('../repositories/UserRepository');
    const existingUser = await UserRepository.findByCredential('guest', guestId);
    const isNewUser = !existingUser;

    // Create guest user data
    const guestProviderData = {
      providerId: 'guest',
      email: null,
      id: guestId,
      name: null,
      picture: null
    };

    // Find or create guest user — aynı guestId ile ikinci çağrıda mevcut kullanıcıyı döner
    const user = await UserService.findOrCreateUser(guestProviderData, 'guest');

    if (!user) {
      return res.status(500).json({
        success: false,
        error: "Failed to create guest user"
      });
    }

    // Generate JWT token
    const token = generateToken(user.id, {
      expiresIn: '7d'
    });

    // Decode token to get expiration date
    const decoded = decodeToken(token);
    const expiresAt = new Date(decoded.exp * 1000);

    // Save token to database (Stateful JWT)
    await TokenRepository.create(user.id, token, expiresAt, {
      deviceInfo: req.headers['user-agent'] || null,
      ipAddress: req.ip || req.connection.remoteAddress || null
    });

    if (isNewUser) {
      console.log(`✅ [GUEST] Yeni kullanıcı oluşturuldu: ${user.id} (${guestId})`);
      // Welcome notification sadece yeni kullanıcıya gönder
      sendWelcomeNotification(user.id, user.username || 'Guest user').catch(err => {
        console.error('⚠️ Failed to send welcome notification:', err.message);
      });
    } else {
      console.log(`♻️ [GUEST] Mevcut kullanıcı geri döndü: ${user.id} (${guestId})`);
    }

    res.status(200).json({
      success: true,
      data: {
        user: user.toJSON(),
        token: token
      },
      message: isNewUser
        ? "Guest user created and authenticated successfully"
        : "Guest user authenticated successfully"
    });
  } catch (error) {
    console.error('Guest authentication error:', error);
    next(error);
  }
});

/**
 * @route POST /auth/:provider
 * @desc Authenticate user with Google, Facebook, Apple, or Guest
 * @param {string} provider - 'google', 'facebook', 'apple', or 'guest'
 * @body {string} idToken - (Google) Google ID Token
 * @body {string} accessToken - (Facebook) Facebook Access Token
 * @body {string} identityToken - (Apple) Apple Identity Token (JWT)
 * @body {string} userIdentifier - (Apple) Apple User Identifier
 * @body {string} authorizationCode - (Apple, optional) Apple Authorization Code
 */
router.post("/:provider", validateAuthRequest, async (req, res, next) => {
  try {
    const { provider } = req.params;
    const { body } = req;

    let providerData;

    // Provider'a göre token verify et
    switch (provider) {
      case "google":
        if (!body.idToken) {
          return res.status(400).json({
            success: false,
            error: "idToken is required for Google authentication"
          });
        }
        providerData = await AuthService.verifyGoogleToken(body.idToken);
        break;
      case "apple":
        if (!body.identityToken && !body.userIdentifier) {
          return res.status(400).json({
            success: false,
            error: "identityToken or userIdentifier is required for Apple authentication"
          });
        }
        providerData = await AuthService.verifyAppleToken(
          body.identityToken,
          body.userIdentifier
        );
        // Apple'dan gelen fullName'i providerData'ya ekle (boşluk kontrolü yok)
        if (body.fullName && body.fullName.length > 0) {
          providerData.name = body.fullName;
        }
        break;
      case "guest":
        // Misafir girişi için token verify gerekmez
        const guestId = `guest_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
        providerData = {
          providerId: 'guest',
          email: null,
          id: guestId,
          name: null,
          picture: null
        };
        break;
      default:
        return res.status(400).json({
          success: false,
          error: "Invalid provider. Must be one of: google, apple, guest"
        });
    }

    // Validate provider data
    if (!providerData || !providerData.id) {
      return res.status(401).json({
        success: false,
        error: "Failed to verify authentication token"
      });
    }

    // Find or create user in database
    const user = await UserService.findOrCreateUser(providerData, provider);

    if (!user) {
      return res.status(500).json({
        success: false,
        error: "Failed to create or retrieve user"
      });
    }

    // Generate JWT token
    const token = generateToken(user.id, {
      expiresIn: '7d'
    });

    // Decode token to get expiration date
    const decoded = decodeToken(token);
    const expiresAt = new Date(decoded.exp * 1000); // Convert to Date

    // Save token to database (Stateful JWT - required)
    await TokenRepository.create(user.id, token, expiresAt, {
      deviceInfo: req.headers['user-agent'] || null,
      ipAddress: req.ip || req.connection.remoteAddress || null
    });

    // Log successful authentication
    console.log(`✅ User authenticated: ${user.id} (${provider})`);

    // Send welcome notification (async, don't wait for it)
    sendWelcomeNotification(user.id, user.username || 'User').catch(err => {
      console.error('⚠️ Failed to send welcome notification:', err.message);
    });

    res.status(200).json({
      success: true,
      data: {
        user: user.toJSON(),
        token: token
      },
      message: user.accountCreatedDate === new Date(user.accountCreatedDate).toISOString() 
        ? "User authenticated successfully" 
        : "New user created and authenticated successfully"
    });
  } catch (error) {
    console.error('Authentication error:', error);
    next(error);
  }
});

/**
 * @route GET /auth/verify
 * @desc Verify authentication token (JWT) - Stateful JWT with database check
 * @header Authorization: Bearer <token>
 */
router.get("/verify", async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No token provided. Please provide a valid JWT token in Authorization header.'
      });
    }

    const token = authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token is required'
      });
    }

    // Verify JWT signature
    const jwt = require('jsonwebtoken');
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          error: 'Token has expired'
        });
      } else if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          error: 'Invalid token'
        });
      }
      throw error;
    }

    // Check if token exists in database and is not revoked (Stateful JWT)
    const tokenValid = await TokenRepository.isValid(token);
    if (!tokenValid) {
      return res.status(401).json({
        success: false,
        error: 'Token has been revoked or does not exist in database'
      });
    }

    // Get user from database
    const user = await UserService.getUserById(decoded.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        user: user.toJSON(),
        valid: true
      },
      message: "Token is valid"
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /auth/me
 * @desc Get current authenticated user
 * @header Authorization: Bearer <token>
 */
router.get("/me", require("../middleware/auth").authenticate, async (req, res, next) => {
  try {
    const user = req.user;
    
    res.status(200).json({
      success: true,
      data: {
        user: user.toJSON()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route PUT /auth/profile
 * @desc Complete user profile (username, answerData, etc.)
 * @header Authorization: Bearer <token>
 * @body {string} username - Username (required for first time)
 * @body {string} nativeLang - Native language code (optional)
 * @body {string} gender - Gender: male, female, unknown (optional)
 * @body {string} profilePhotoUrl - Profile photo URL (optional)
 * @body {Object} answerData - QuestionAnswers object (optional)
 *   - {any} avaibleDays - Available days
 *   - {any} avaibleHours - Available hours
 *   - {string} supportArea - Support area
 *   - {string} agentSpeakStyle - Agent speak style
 */
router.put("/profile", 
  require("../middleware/auth").authenticate,
  require("../middleware/profileValidation").validateProfileCompletion,
  async (req, res, next) => {
    try {
      const userId = req.userId;
      const { username, age, nativeLang, gender, answerData, profilePhotoUrl } = req.body;

      console.log('📝 Profile update request:', {
        userId,
        username,
        age,
        nativeLang,
        gender,
        profilePhotoUrl,
        answerData: answerData ? JSON.stringify(answerData) : (answerData === null ? 'null' : 'undefined'),
        answerDataType: typeof answerData,
        answerDataIsObject: answerData && typeof answerData === 'object' && !Array.isArray(answerData),
        answerDataKeys: answerData && typeof answerData === 'object' ? Object.keys(answerData) : 'N/A'
      });

      // Prepare update data
      const updateData = {};
      
      if (username !== undefined) {
        // Username boşsa veya sadece boşluklardan oluşuyorsa "MindCoach User" olarak ayarla
        const finalUsername = (username && typeof username === 'string' && username.trim().length > 0) 
          ? username.trim() 
          : 'MindCoach User';
        updateData.username = finalUsername;
        console.log(`📝 Username set: "${finalUsername}" (original: "${username}")`);
      }
      if (nativeLang !== undefined) {
        updateData.nativeLang = nativeLang;
      }
      if (age !== undefined) {
        updateData.age = age;
      }
      if (gender !== undefined) {
        updateData.gender = gender;
      }
      if (profilePhotoUrl !== undefined) {
        updateData.profilePhotoUrl = profilePhotoUrl;
      }
      // answerData opsiyonel - sadece gönderilirse güncelle
      if (answerData !== undefined) {
        // answerData null ise, null olarak kaydet (mevcut answerData'yı silmek için)
        if (answerData === null) {
          updateData.answerData = null;
          console.log('⚠️ answerData is null, will be set to null');
        } else if (typeof answerData === 'object' && !Array.isArray(answerData)) {
          // answerData obje olmalı ve içinde veri olmalı
          if (Object.keys(answerData).length > 0) {
            updateData.answerData = answerData;
            console.log('✅ answerData added to updateData:', JSON.stringify(answerData));
          } else {
            console.error('❌ answerData is empty object');
            return res.status(400).json({
              success: false,
              error: 'answerData cannot be empty'
            });
          }
        } else {
          console.error('❌ answerData is not a valid object:', typeof answerData);
          return res.status(400).json({
            success: false,
            error: 'answerData must be an object'
          });
        }
      }
      // answerData undefined ise, güncelleme yapılmaz (mevcut answerData korunur)

      // Update user profile (userId ile güncelleme yapıyoruz, duplicate kontrolü gereksiz)
      const updatedUser = await UserService.updateUser(userId, updateData);

      res.status(200).json({
        success: true,
        data: {
          user: updatedUser.toJSON()
        },
        message: "Profile updated successfully"
      });
    } catch (error) {
      console.error('Profile update error:', error);
      next(error);
    }
  }
);

/**
 * @route POST /auth/profile/photo
 * @desc Upload profile photo to CDN and update user profile
 * @header Authorization: Bearer <token>
 * @body multipart/form-data with 'photo' field (image file)
 */
router.post("/profile/photo", 
  require("../middleware/auth").authenticate,
  upload.single('photo'),
  async (req, res, next) => {
    try {
      const userId = req.userId;
      
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'Photo file is required'
        });
      }

      // Upload to CDN
      const cdnUrl = await BunnyCDNService.uploadFile(
        req.file.buffer,
        req.file.originalname,
        'image'
      );

      // Update user profile with new photo URL
      const updatedUser = await UserService.updateUser(userId, {
        profilePhotoUrl: cdnUrl
      });

      res.status(200).json({
        success: true,
        data: {
          user: updatedUser.toJSON(),
          photoUrl: cdnUrl
        },
        message: "Profile photo updated successfully"
      });
    } catch (error) {
      console.error('Profile photo upload error:', error);
      next(error);
    }
  }
);

/**
 * @route DELETE /auth/account
 * @desc Delete user account permanently
 * @header Authorization: Bearer <token>
 * 
 * This endpoint:
 * - Deletes all user data (messages, chats, appointments, moods, etc.)
 * - Revokes all tokens
 * - Soft deletes the user account
 */
router.delete("/account", require("../middleware/auth").authenticate, async (req, res, next) => {
  try {
    const userId = req.userId;
    const deleteReasonRaw = req.body?.deleteReason;
    const deleteMessageRaw = req.body?.deleteMessage;
    const deleteReason = typeof deleteReasonRaw === 'string' ? deleteReasonRaw.trim() : null;
    const deleteMessage = typeof deleteMessageRaw === 'string' ? deleteMessageRaw.trim() : null;

    await AccountDeletionFeedbackRepository.save({
      userId,
      reason: deleteReason,
      message: deleteMessage,
      source: 'mobile_app',
      userAgent: req.headers['user-agent'] || null,
      ipAddress: req.ip || req.connection.remoteAddress || null
    });
    
    // Delete all user data
    await UserService.deleteUserAccount(userId);
    
    // Revoke all tokens for user
    await TokenRepository.revokeAll(userId);
    
    res.status(200).json({
      success: true,
      message: "Account deleted successfully"
    });
  } catch (error) {
    console.error('Delete account error:', error);
    next(error);
  }
});

module.exports = router;