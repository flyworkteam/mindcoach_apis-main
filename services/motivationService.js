/**
 * Motivation Service
 * Business logic for motivation text operations
 */

const MotivationRepository = require('../repositories/MotivationRepository');
const UserService = require('./userService');
const axios = require('axios');
const { circuitBreakers } = require('../middleware/circuitBreaker');

class MotivationService {
  /**
   * Get today's motivation text for a user
   * If not exists in DB, fetch from webhook and save
   * @param {number} userId - User ID
   * @returns {Promise<Object>} Motivation object with motivation and tavsiye
   */
  static async getTodayMotivation(userId) {
    try {
      // Get today's date in YYYY-MM-DD format
      const today = new Date().toISOString().split('T')[0];

      // Check if motivation exists in DB for today
      let motivation = await MotivationRepository.findByUserIdAndDate(userId, today);

      if (motivation) {
        // Return existing motivation
        return {
          motivation: motivation.motivation,
          tavsiye: motivation.tavsiye,
          reality: motivation.reality
        };
      }

      // If not exists, fetch from webhook
      const user = await UserService.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Get user's psychological profile (prefer generalPsychologicalProfile, fallback to generalProfile)
      const psychologicalProfile = user.generalPsychologicalProfile || user.generalProfile || null;
      const nativeLang = user.nativeLang || 'tr';

      // Call webhook to get motivation text
      const webhookData = {
        psychologicalProfile: psychologicalProfile,
        nativeLang: nativeLang
      };

      const webhookResponse = await this.callMotivationWebhook(webhookData);

      // Save to database
      motivation = await MotivationRepository.create(
        userId,
        today,
        webhookResponse.motivation,
        webhookResponse.tavsiye,
        webhookResponse.reality || null
      );

      return {
        motivation: motivation.motivation,
        tavsiye: motivation.tavsiye,
        reality: motivation.reality
      };
    } catch (error) {
      console.error('Error getting today motivation:', error);
      throw error;
    }
  }

  /**
   * Call webhook to get motivation text
   * Retries on failure
   * @param {Object} webhookData - Data to send to webhook
   * @param {number} maxRetries - Maximum number of retries (default: 3)
   * @returns {Promise<Object>} Webhook response with motivation and tavsiye
   */
  static async callMotivationWebhook(webhookData, maxRetries = 3) {
    const webhookCircuitBreaker = circuitBreakers.webhook;
    const webhookUrl = 'https://n8n.srv1548849.hstgr.cloud/webhook/create-motivation-text';

    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[MOTIVATION] 📤 Calling webhook (attempt ${attempt}/${maxRetries}): ${webhookUrl}`);

        // Use circuit breaker to protect webhook calls
        const response = await webhookCircuitBreaker.execute(async () => {
          return await axios.post(webhookUrl, webhookData, {
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: parseInt(process.env.WEBHOOK_TIMEOUT) || 45000, // 45 seconds timeout
            httpAgent: new (require('http').Agent)({
              keepAlive: true,
              keepAliveMsecs: 1000,
              maxSockets: 50,
              maxFreeSockets: 10,
              timeout: 10000,
            }),
            httpsAgent: new (require('https').Agent)({
              keepAlive: true,
              keepAliveMsecs: 1000,
              maxSockets: 50,
              maxFreeSockets: 10,
              timeout: 10000,
            }),
          });
        }, async () => {
          // Fallback when circuit breaker is open
          throw new Error('Webhook service temporarily unavailable. Please try again later.');
        });

        // Handle array response (webhook may return array with single object)
        let responseData = response.data;
        if (Array.isArray(responseData) && responseData.length > 0) {
          responseData = responseData[0];
        }

        // Validate response
        if (!responseData || !responseData.motivation || !responseData.tavsiye) {
          throw new Error('Invalid webhook response format - missing motivation or tavsiye');
        }

        console.log(`[MOTIVATION] ✅ Webhook response received successfully`);
        return {
          motivation: responseData.motivation,
          tavsiye: responseData.tavsiye,
          reality: responseData.reality || null
        };
      } catch (error) {
        lastError = error;
        console.error(`[MOTIVATION] ❌ Webhook call failed (attempt ${attempt}/${maxRetries}):`, error.message);

        // If it's the last attempt, throw the error
        if (attempt === maxRetries) {
          throw new Error(`Failed to get motivation text from webhook after ${maxRetries} attempts: ${error.message}`);
        }

        // Wait before retrying (exponential backoff)
        const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Max 10 seconds
        console.log(`[MOTIVATION] ⏳ Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    // This should never be reached, but just in case
    throw lastError || new Error('Unknown error occurred while calling webhook');
  }
}

module.exports = MotivationService;
