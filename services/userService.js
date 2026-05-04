/**
 * User Service
 * Business logic for user operations
 */

const UserRepository = require('../repositories/UserRepository');
const User = require('../models/User');

class UserService {
  /**
   * Find or create user
   * @param {Object} providerData - Provider authentication data
   * @param {string} credential - Provider name
   * @returns {Promise<Object>} User object
   */
  static async findOrCreateUser(providerData, credential) {
    try {
      // Check if user exists
      const existingUser = await UserRepository.findByCredential(
        credential,
        providerData.id
      );

      if (existingUser) {
        // User exists, update profile photo if provided
        const userData = UserRepository.mapRowToUser(existingUser);
        
        const updateData = {};
        
        // Update profile photo if it's different
        if (providerData.picture && providerData.picture !== userData.profilePhotoUrl) {
          updateData.profilePhotoUrl = providerData.picture;
        }
        
        // Misafir kullanıcı için username'i "Guest user" olarak güncelle
        if (credential === 'guest' && userData.username !== 'Guest user') {
          updateData.username = 'Guest user';
        }
        // Eğer username hala temp ile başlıyorsa ve Apple'dan fullName geldiyse, güncelle
        else if (userData.username && userData.username.startsWith('temp_') && 
            providerData.name && providerData.name.trim().length > 0) {
          updateData.username = providerData.name.trim();
        }
        
        // Misafir kullanıcı için answerData'yı boş obje olarak ayarla (profil setup'a yönlendirilmemesi için)
        if (credential === 'guest' && userData.answerData === null) {
          updateData.answerData = {};
        }
        
        // Eğer güncelleme yapılacak bir şey varsa
        if (Object.keys(updateData).length > 0) {
          await UserRepository.update(existingUser.id, updateData);
          if (updateData.profilePhotoUrl) userData.profilePhotoUrl = updateData.profilePhotoUrl;
          if (updateData.username) userData.username = updateData.username;
          if (updateData.answerData !== undefined) userData.answerData = updateData.answerData;
        }

        return new User(userData);
      }

      // Create new user - İlk oturum açmada sadece temel bilgiler
      // Username ve diğer bilgiler sonradan profil tamamlama ile eklenecek
      // Apple'dan gelen fullName varsa, onu username olarak kullan (boşluk kontrolü yok)
      // Misafir kullanıcı için "Guest user" kullan
      let username;
      if (credential === 'guest') {
        // Misafir kullanıcı için sabit username
        username = 'Guest user';
      } else if (providerData.name && providerData.name.length > 0) {
        // Apple'dan gelen fullName'i username olarak kullan (trim yok, boşluklar korunur)
        username = providerData.name;
      } else {
        // Diğer durumlarda "MindCoach User" kullan (temp_ yerine)
        username = 'MindCoach User';
      }
      
      const newUserData = {
        credential: credential,
        credentialData: {
          providerId: providerData.providerId,
          email: providerData.email,
          id: providerData.id
        },
        username: username,
        gender: 'unknown',
        profilePhotoUrl: providerData.picture || null,
        answerData: credential === 'guest' ? {} : null, // Misafir kullanıcı için boş obje (profil setup'a yönlendirilmez)
        accountCreatedDate: new Date().toISOString()
      };

      try {
        const createdUser = await UserRepository.create(newUserData);
        return new User(UserRepository.mapRowToUser(createdUser));
      } catch (createError) {
        // Eğer unique constraint hatası alırsak (migration çalıştırılmamışsa)
        // ve misafir kullanıcı ise, mevcut kullanıcıyı bulup döndür
        if (createError.code === 'ER_DUP_ENTRY' && credential === 'guest') {
          console.log('⚠️ Unique constraint hatası - mevcut misafir kullanıcıyı arıyoruz...');
          // Mevcut misafir kullanıcıyı bul (credential='guest' ve providerId ile)
          const existingGuest = await UserRepository.findByCredential('guest', providerData.id);
          if (existingGuest) {
            const userData = UserRepository.mapRowToUser(existingGuest);
            // Eğer answerData null ise, boş obje olarak güncelle
            if (userData.answerData === null) {
              await UserRepository.update(existingGuest.id, { answerData: {} });
              userData.answerData = {};
            }
            // Username'i "Guest user" olarak güncelle (eğer değilse)
            if (userData.username !== 'Guest user') {
              await UserRepository.update(existingGuest.id, { username: 'Guest user' });
              userData.username = 'Guest user';
            }
            return new User(userData);
          }
          // Eğer credential ile bulunamazsa, username ile dene (fallback)
          const existingGuestByUsername = await UserRepository.findByUsername('Guest user');
          if (existingGuestByUsername) {
            const userData = UserRepository.mapRowToUser(existingGuestByUsername);
            // Eğer answerData null ise, boş obje olarak güncelle
            if (userData.answerData === null) {
              await UserRepository.update(existingGuestByUsername.id, { answerData: {} });
              userData.answerData = {};
            }
            return new User(userData);
          }
        }
        // Diğer hatalar için orijinal hatayı fırlat
        throw createError;
      }
    } catch (error) {
      console.error('Error in findOrCreateUser:', error);
      throw error;
    }
  }

  /**
   * Get user by ID
   * @param {number} userId - User ID
   * @returns {Promise<Object|null>} User object or null
   */
  static async getUserById(userId) {
    try {
      const user = await UserRepository.findById(userId);
      if (!user) {
        return null;
      }
      return new User(UserRepository.mapRowToUser(user));
    } catch (error) {
      console.error('Error getting user by ID:', error);
      throw error;
    }
  }

  /**
   * Get user by username
   * @param {string} username - Username
   * @returns {Promise<Object|null>} User object or null
   */
  static async getUserByUsername(username) {
    try {
      const user = await UserRepository.findByUsername(username);
      if (!user) {
        return null;
      }
      return new User(UserRepository.mapRowToUser(user));
    } catch (error) {
      console.error('Error getting user by username:', error);
      throw error;
    }
  }

  /**
   * Update user profile
   * @param {number} userId - User ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated user object
   */
  static async updateUser(userId, updateData) {
    try {
      // Username unique değil, herkes istediği ismi kullanabilir
      const updatedUser = await UserRepository.update(userId, updateData);
      if (!updatedUser) {
        throw new Error('User not found');
      }
      return new User(UserRepository.mapRowToUser(updatedUser));
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }

  /**
   * Check if user profile is complete
   * @param {Object} user - User object
   * @returns {boolean} True if profile is complete
   */
  static isProfileComplete(user) {
    return !!(
      user.username && 
      !user.username.startsWith('temp_') &&
      user.answerData &&
      user.answerData.supportArea &&
      user.answerData.agentSpeakStyle
    );
  }

  /**
   * Delete user account and all associated data
   * @param {number} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  static async deleteUserAccount(userId) {
    try {
      // Delete all user-related data
      // Note: Foreign key constraints may require specific order
      
      // 1. Delete messages (cascades to chat updates)
      const MessageRepository = require('../repositories/MessageRepository');
      // Get all chats for user first
      const ChatRepository = require('../repositories/ChatRepository');
      const chats = await ChatRepository.findByUserId(userId);
      
      for (const chat of chats) {
        // Delete all messages in chat
        await MessageRepository.deleteByChatId(chat.chatId);
      }
      
      // 2. Delete chats
      await ChatRepository.deleteByUserId(userId);
      
      // 3. Delete appointments
      const AppointmentRepository = require('../repositories/AppointmentRepository');
      await AppointmentRepository.deleteByUserId(userId);
      
      // 4. Delete moods
      const MoodRepository = require('../repositories/MoodRepository');
      await MoodRepository.deleteByUserId(userId);
      
      // 5. Delete user tokens (already handled in auth route, but safe to do here too)
      const TokenRepository = require('../repositories/TokenRepository');
      await TokenRepository.revokeAll(userId);
      
      // 6. Finally, delete the user
      await UserRepository.delete(userId);
      
      return true;
    } catch (error) {
      console.error('Error deleting user account:', error);
      throw error;
    }
  }
}

module.exports = UserService;

