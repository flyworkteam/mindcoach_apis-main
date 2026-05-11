/**
 * AI Service
 * Handles OpenAI Chat Completions (text + vision) for consultant chat.
 * Supports function calling for appointment creation.
 */

'use strict';

const axios = require('axios');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
const MAX_HISTORY = 40;

const APPOINTMENT_TOOL = {
  type: 'function',
  function: {
    name: 'create_appointment',
    description:
      'Create a video-call appointment between the user and this consultant. ' +
      'Use when the user explicitly asks for an appointment/session/meeting. ' +
      'Pick a date based on urgency: urgent → tomorrow, normal → 2-3 days, relaxed → within a week. ' +
      'Time must be between 08:00 and 22:59. Default to 10:00 if no preference.',
    parameters: {
      type: 'object',
      properties: {
        appointmentDate: {
          type: 'string',
          description: 'ISO 8601 date-time for the appointment (e.g. 2026-05-13T10:00:00.000Z)',
        },
        urgency: {
          type: 'string',
          enum: ['urgent', 'normal', 'relaxed'],
          description: 'How urgent the user sounds',
        },
      },
      required: ['appointmentDate', 'urgency'],
    },
  },
};

const VOICE_REPLY_TOOL = {
  type: 'function',
  function: {
    name: 'send_voice_reply',
    description:
      'Convert your reply into a voice message using your own voice (text-to-speech). ' +
      'When you call this tool, your next text reply will be spoken aloud and sent as audio. ' +
      'You DO have a real voice — calling this tool activates it. ' +
      'Use RARELY — only when: ' +
      '1) The user explicitly asks to hear your voice or requests a voice/audio message. ' +
      '2) A deeply emotional moment where spoken words are far more comforting (e.g. crying, panic, grief). ' +
      '3) A warm greeting at the very start of a brand new conversation. ' +
      'For all other cases, respond with normal text (90%+ of replies should be text).',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          enum: ['user_requested', 'emotional_support', 'greeting'],
          description: 'Why this reply should be voice',
        },
      },
      required: ['reason'],
    },
  },
};

class AIService {
  /**
   * Build OpenAI messages array from chat history + current message.
   */
  static _buildMessages(opts) {
    const {
      systemPrompt,
      chatHistory,
      userMessage,
      messageType,
      imageURL,
      imageContent,
      voiceContent,
    } = opts;

    const messages = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    const trimmedHistory = (chatHistory || []).slice(-MAX_HISTORY);
    for (const h of trimmedHistory) {
      const role = h.sender === 'user' ? 'user' : 'assistant';
      let content = h.message || '';

      if (h.messageType === 'voice' && h.voiceContent) {
        content = h.voiceContent;
      } else if (h.messageType === 'image' && h.imageContent) {
        content = h.imageContent;
      }

      if (content) {
        messages.push({ role, content });
      }
    }

    if (messageType === 'image' && imageURL) {
      const parts = [];
      if (userMessage) {
        parts.push({ type: 'text', text: userMessage });
      }
      parts.push({
        type: 'image_url',
        image_url: { url: imageURL, detail: 'low' },
      });
      messages.push({ role: 'user', content: parts });
    } else {
      const text =
        messageType === 'voice' && voiceContent
          ? voiceContent
          : userMessage || '';
      if (text) {
        messages.push({ role: 'user', content: text });
      }
    }

    return messages;
  }

  /**
   * Send a chat completion request to OpenAI.
   * Supports function calling — returns { reply, toolCalls }.
   * @param {Object} opts - same as _buildMessages + enableTools
   * @returns {Promise<{reply: string, toolCalls: Array}>}
   */
  static async chat(opts) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

    const isVision = opts.messageType === 'image' && opts.imageURL;
    const model = isVision ? VISION_MODEL : MODEL;
    const messages = this._buildMessages(opts);

    const requestBody = {
      model,
      messages,
      max_tokens: 1024,
      temperature: 0.7,
    };

    if (opts.enableTools !== false) {
      const tools = [APPOINTMENT_TOOL];
      if (opts.isPremium) {
        tools.push(VOICE_REPLY_TOOL);
      }
      requestBody.tools = tools;
      requestBody.tool_choice = 'auto';
    }

    console.log(`[AI] Sending ${messages.length} messages to ${model} (type: ${opts.messageType})`);

    const response = await axios.post(OPENAI_URL, requestBody, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });

    const choice = response.data?.choices?.[0];
    const message = choice?.message;

    if (!message) throw new Error('Empty response from OpenAI');

    const toolCalls = message.tool_calls || [];

    if (toolCalls.length > 0 && !message.content) {
      const toolResults = toolCalls.map(tc => ({
        name: tc.function?.name,
        args: (() => { try { return JSON.parse(tc.function?.arguments || '{}'); } catch { return {}; } })(),
        id: tc.id,
      }));

      console.log(`[AI] Tool call(s): ${toolResults.map(t => t.name).join(', ')}`);

      const hasVoiceTool = toolResults.some(t => t.name === 'send_voice_reply');

      if (hasVoiceTool) {
        // Voice reply: make a fresh request WITHOUT tools.
        // Replace system prompt so the model knows it's "speaking".
        const voiceMessages = messages.map((m, i) => {
          if (i === 0 && m.role === 'system') {
            return {
              role: 'system',
              content: m.content +
                '\n\n--- IMPORTANT: You are now replying via VOICE MESSAGE. ---' +
                '\nThe user will HEAR your words spoken aloud in your voice.' +
                '\nSpeak naturally and warmly as if talking face-to-face.' +
                '\nDo NOT say "I cannot send voice" or "I am a text AI" — you ARE speaking right now.' +
                '\nDo NOT mention voice messages, audio, or TTS at all. Just respond to the user naturally.',
            };
          }
          return m;
        });

        const voiceResp = await axios.post(
          OPENAI_URL,
          { model, messages: voiceMessages, max_tokens: 1024, temperature: 0.7 },
          {
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            timeout: 60000,
          },
        );

        const voiceReply = voiceResp.data?.choices?.[0]?.message?.content?.trim() || '';
        console.log(`[AI] Voice reply generated (${voiceReply.length} chars)`);
        return { reply: voiceReply, toolCalls: toolResults };
      }

      // Non-voice tool calls (e.g. appointment): use standard follow-up
      messages.push(message);
      for (const tc of toolCalls) {
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify({ status: 'success', note: 'Done.' }),
        });
      }

      const followUp = await axios.post(
        OPENAI_URL,
        { model, messages, max_tokens: 1024, temperature: 0.7 },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 60000,
        },
      );

      const followUpReply = followUp.data?.choices?.[0]?.message?.content?.trim() || '';
      console.log(`[AI] Reply after tool call (${followUpReply.length} chars)`);
      return { reply: followUpReply, toolCalls: toolResults };
    }

    const reply = (message.content || '').trim();
    console.log(`[AI] Reply received (${reply.length} chars)`);
    return { reply, toolCalls: [] };
  }
}

module.exports = AIService;
