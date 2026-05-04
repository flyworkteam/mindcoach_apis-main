/**
 * Realtime Chat Service
 * Handles realtime chat with consultants using WebSocket and ElevenLabs
 * Users send audio messages, which are transcribed and processed
 */

const ConsultantService = require('./consultantService');
const ElevenLabsService = require('./elevenLabsService');
const SpeechToTextService = require('./speechToTextService');
const ChatService = require('./chatService');
const UserService = require('./userService');

class RealtimeChatService {
  /**
   * Process audio stream from user and generate consultant response
   * @param {number} userId - User ID
   * @param {number} consultantId - Consultant ID
   * @param {Buffer} audioBuffer - Audio buffer from user (streaming audio chunks combined)
   * @param {string} audioFormat - Audio format (pcm, opus, wav, etc.)
   * @param {string} language - Language code (optional)
   * @returns {Promise<Object>} Response with text and audio
   */
  static async processAudioMessage(userId, consultantId, audioBuffer, audioFormat = 'pcm', language = null) {
    try {
      // Get consultant info
      const consultant = await ConsultantService.getConsultantById(consultantId);
      if (!consultant) {
        throw new Error('Consultant not found');
      }

      if (!consultant.voiceId) {
        throw new Error('Consultant does not have voice ID configured');
      }

      // Get user info
      const user = await UserService.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Determine language from user's native language if not provided
      if (!language && user.nativeLang) {
        language = user.nativeLang;
      }

      // Step 1: Transcribe audio to text
      let transcribedText;
      try {
        transcribedText = await SpeechToTextService.transcribe(audioBuffer, audioFormat, language);
        if (!transcribedText || transcribedText.trim() === '') {
          throw new Error('Could not transcribe audio. Please try again.');
        }
      } catch (transcriptionError) {
        console.error('Transcription error:', transcriptionError);
        throw new Error(`Failed to transcribe audio: ${transcriptionError.message}`);
      }

      // Step 2: Send transcribed message to chat service (this will call webhook)
      let chatResult;
      try {
        chatResult = await ChatService.sendMessage(
          userId,
          consultantId,
          transcribedText,
          false, // isFile
          null,  // fileURL
          true,  // isVoiceMessage
          null,  // voiceURL (will be set by webhook response if needed)
          null,  // imageContent
          transcribedText // voiceMessageContent (transcript)
        );
      } catch (chatError) {
        console.error('Chat service error:', chatError);
        // Continue even if chat service fails
      }

      // Step 3: Get AI response from webhook
      // Note: In production, you would get the actual response from the webhook
      // For now, we'll use a placeholder response
      // The webhook should return the consultant's response text
      const consultantResponse = `Mesajınızı anladım: "${transcribedText}". Size nasıl yardımcı olabilirim?`;

      // Step 4: Generate audio using ElevenLabs
      let audioBuffer = null;
      try {
        audioBuffer = await ElevenLabsService.textToSpeech(
          consultantResponse,
          consultant.voiceId
        );
      } catch (audioError) {
        console.error('Error generating audio:', audioError.message);
        // Continue without audio if generation fails
      }

      return {
        success: true,
        transcribedText: transcribedText, // User's transcribed message
        text: consultantResponse, // Consultant's response text
        audio: audioBuffer ? audioBuffer.toString('base64') : null,
        audioFormat: 'mp3',
        consultantId: consultantId,
        consultantName: consultant.names?.tr || consultant.names?.en || 'Consultant',
        trigger3DAnimation: true, // Trigger 3D animation when consultant speaks
        chatId: chatResult?.chat?.chatId || null,
        messageId: chatResult?.message?.messageId || null
      };
    } catch (error) {
      console.error('Error processing audio message:', error);
      throw error;
    }
  }
}

module.exports = RealtimeChatService;

