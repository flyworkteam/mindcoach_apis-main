/**
 * Voice Chat Server V2  —  Hybrid: OpenAI Realtime + ElevenLabs WS Streaming TTS
 *
 * Pipeline (per connection):
 *   Flutter PCM16 16kHz ──▶ OpenAI Realtime (server VAD + STT + LLM text)
 *                              │
 *                              ├── text.delta ──▶ ElevenLabs WS TTS ─▶ PCM16 ─▶ Flutter
 *                              └── user transcript + AI text ──▶ DB
 *
 * Barge-in (~immediate):
 *   OpenAI `input_audio_buffer.speech_started` while AI is producing
 *     → cancel OpenAI response
 *     → abort ElevenLabs WS TTS
 *     → send {type:'barge_in'} to Flutter (flushes PCM queue)
 *
 * Memory:
 *   On connect we inject up to N previous messages via
 *   `conversation.item.create` so OpenAI has native chat history.
 */

'use strict';

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const UserService = require('../services/userService');
const TokenRepository = require('../repositories/TokenRepository');
const ConsultantService = require('../services/consultantService');
const AppointmentService = require('../services/appointmentService');
const ChatService = require('../services/chatService');
const MessageRepository = require('../repositories/MessageRepository');
const ChatRepository = require('../repositories/ChatRepository');
const { generateVisemesFromPcm24k } = require('../services/visemeService');

const OpenAIRealtimeSession = require('./openaiRealtimeSession');
const ElevenLabsTTSSession = require('./elevenLabsTTSSession');

const HISTORY_LIMIT = 20;

// After the AI finishes speaking, if the user stays silent for this many
// milliseconds we trigger a gentle "are you still there?" check-in. We use
// a longer wait for the FIRST check-in (user might be thinking) and a
// shorter wait before the second/final one.
const IDLE_CHECKIN_FIRST_MS = 10000;
const IDLE_CHECKIN_FOLLOWUP_MS = 5000;
// Number of check-in attempts before saying goodbye and ending the call.
const MAX_CHECKINS = 2;
// How long to wait AFTER the goodbye audio has fully played on the client
// before actually closing the WebSocket. We already know playback is done
// (we gated on `playback_done`), so this is just a tiny safety margin.
const HANGUP_GRACE_MS = 80;

// Canned phrases for idle prompts. Spoken DIRECTLY through TTS so we get
// exact, varied wording (bypassing the LLM, which tends to repeat its last
// response when asked to generate a check-in out of thin air).
//
// Flow when the user goes silent:
//   first  → wait 5s → second → wait 5s → goodbye → hangup (no extra wait)
const IDLE_PHRASES = {
  tr: {
    first: ['Orada mısın?', 'Seni duyamıyorum, her şey yolunda mı?', 'Devam etmek ister misin?'],
    second: ['Hâlâ orada mısın?', 'Beni duyuyor musun?', 'Cevabını bekliyorum.'],
    goodbye: ['Seni duyamıyorum, görüşmek üzere.', 'Aramayı kapatıyorum, kendine iyi bak.'],
  },
  en: {
    first: ['Are you still there?', 'I can\'t hear you — is everything okay?', 'Would you like to continue?'],
    second: ['Still there?', 'Can you hear me?', 'I\'m waiting for your reply.'],
    goodbye: ['I can\'t hear you — talk soon, bye.', 'Ending the call now, take care.'],
  },
  de: {
    first: ['Bist du noch da?', 'Ich kann dich nicht hören — alles in Ordnung?'],
    second: ['Hörst du mich?', 'Ich warte auf deine Antwort.'],
    goodbye: ['Ich kann dich nicht hören, bis bald!', 'Ich lege jetzt auf, pass auf dich auf.'],
  },
  es: {
    first: ['¿Sigues ahí?', 'No te escucho, ¿todo bien?'],
    second: ['¿Me oyes?', 'Estoy esperando tu respuesta.'],
    goodbye: ['No te escucho, hasta pronto.', 'Voy a colgar, cuídate.'],
  },
  fr: {
    first: ['Tu es toujours là ?', 'Je ne t\'entends pas — tout va bien ?'],
    second: ['Tu m\'entends ?', 'J\'attends ta réponse.'],
    goodbye: ['Je ne t\'entends pas — à bientôt.', 'Je raccroche, prends soin de toi.'],
  },
  it: {
    first: ['Ci sei ancora?', 'Non ti sento — tutto bene?'],
    second: ['Mi senti?', 'Sto aspettando la tua risposta.'],
    goodbye: ['Non ti sento — a presto.', 'Chiudo la chiamata, stammi bene.'],
  },
  pt: {
    first: ['Ainda está aí?', 'Não consigo te ouvir — está tudo bem?'],
    second: ['Está me ouvindo?', 'Estou esperando sua resposta.'],
    goodbye: ['Não consigo te ouvir — até logo.', 'Vou desligar, se cuida.'],
  },
  ru: {
    first: ['Ты ещё там?', 'Я тебя не слышу — всё в порядке?'],
    second: ['Слышишь меня?', 'Жду твоего ответа.'],
    goodbye: ['Я тебя не слышу — до скорого.', 'Завершаю звонок, береги себя.'],
  },
  ja: {
    first: ['まだいますか？', '聞こえないのですが、大丈夫ですか？'],
    second: ['聞こえますか？', 'お返事を待っています。'],
    goodbye: ['聞こえないので、またね。', '通話を終了します、お大事に。'],
  },
  ko: {
    first: ['거기 계세요?', '잘 안 들리네요, 괜찮으신가요?'],
    second: ['제 말 들리세요?', '답변을 기다리고 있어요.'],
    goodbye: ['잘 안 들리네요, 다음에 뵐게요.', '통화를 종료할게요, 건강하세요.'],
  },
  zh: {
    first: ['你还在吗？', '我听不到你，一切都好吗？'],
    second: ['你能听到我吗？', '我在等你的回复。'],
    goodbye: ['听不到你了，回见。', '我要挂断了，保重。'],
  },
  hi: {
    first: ['क्या आप अभी भी वहाँ हैं?', 'मुझे सुनाई नहीं दे रहा — सब ठीक है?'],
    second: ['क्या आप मुझे सुन रहे हैं?', 'मैं आपके जवाब का इंतज़ार कर रहा हूँ।'],
    goodbye: ['मुझे आवाज़ नहीं आ रही — फिर मिलेंगे।', 'कॉल बंद कर रहा हूँ, अपना ख्याल रखें।'],
  },
};

function pickIdlePhrase(lang, kind) {
  const fallback = IDLE_PHRASES.tr[kind];
  const pool = (IDLE_PHRASES[lang] && IDLE_PHRASES[lang][kind]) || fallback;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Canned opening greetings (per language) ─────────────────────────────────
// Going through the LLM for the first line costs ~1–2s of extra latency
// (OpenAI connect → instruction prompt → streamed deltas → TTS). By using
// a canned, localized greeting we can start audio in a few hundred ms —
// which is the single biggest factor that makes a phone-like call feel
// "professional" instead of amateur. The greeting is intentionally short
// and warm; the LLM takes over on the user's first reply.
const GREETING_PHRASES = {
  tr: [
    'Merhaba, nasılsın bugün?',
    'Selam, nasıl gidiyor?',
    'Merhaba, iyi misin?',
  ],
  en: [
    'Hey, how are you today?',
    'Hi there, how are you doing?',
    'Hello, how’s it going?',
  ],
  de: ['Hallo, wie geht es dir heute?', 'Hey, alles gut bei dir?'],
  es: ['Hola, ¿cómo estás hoy?', 'Hola, ¿qué tal todo?'],
  fr: ['Salut, comment vas-tu aujourd’hui ?', 'Bonjour, comment tu te sens ?'],
  it: ['Ciao, come stai oggi?', 'Ehi, come va?'],
  pt: ['Olá, como você está hoje?', 'Oi, tudo bem?'],
  ru: ['Привет, как ты сегодня?', 'Здравствуй, как дела?'],
  ja: ['こんにちは、今日はどう？', 'やあ、元気？'],
  ko: ['안녕하세요, 오늘 어떠세요?', '안녕, 잘 지내?'],
  zh: ['你好，今天怎么样？', '嗨，你还好吗？'],
  hi: ['नमस्ते, आज आप कैसे हैं?', 'हाय, कैसे हो?'],
};

const GREETING_PREFIX = {
  tr: ['Merhaba', 'Selam', 'Alo'],
  en: ['Hello', 'Hi', 'Hey'],
  de: ['Hallo', 'Hi'],
  es: ['Hola'],
  fr: ['Bonjour', 'Salut'],
  it: ['Ciao'],
  pt: ['Olá', 'Oi'],
  ru: ['Привет', 'Здравствуйте'],
  ja: ['こんにちは', 'やあ'],
  ko: ['안녕하세요', '안녕'],
  zh: ['你好', '嗨'],
  hi: ['नमस्ते', 'हैलो'],
};

function _sanitizeGreetingName(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Skip generic / fallback usernames — saying "Hi Guest user" is a dead
  // giveaway that this is a bot.
  const lower = trimmed.toLowerCase();
  const GENERIC = ['guest', 'guest user', 'user', 'anonymous', 'unknown', 'test'];
  if (GENERIC.includes(lower)) return '';
  // Only keep the first name component so we don't say "Hi Furkan Kazim Cam,".
  const first = trimmed.split(/\s+/)[0];
  if (!first || first.length < 2 || first.length > 20) return '';
  // Strip anything weird (emoji, punctuation, digits).
  const cleaned = first.replace(/[^\p{L}'-]/gu, '');
  return cleaned;
}

function pickGreetingPhrase(lang, { userName, coachName } = {}) {
  const pool = GREETING_PHRASES[lang] || GREETING_PHRASES.tr;
  const prefixes = GREETING_PREFIX[lang] || GREETING_PREFIX.tr;
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const baseRaw = pool[Math.floor(Math.random() * pool.length)];
  // Base metni selamlama kelimesiyle başlasa bile tekrar etmeyelim.
  const base = baseRaw.replace(/^(\p{L}+)([,!.\s]*)/u, '').trim() || baseRaw;
  const safeUser = _sanitizeGreetingName(userName);
  const safeCoach = _sanitizeGreetingName(coachName);
  // Personalize: always start with an explicit greeting token.
  // This prevents awkward openings that sound like just a name.
  if (safeUser && Math.random() < 0.5) {
    return `${prefix} ${safeUser}, ${base}`.replace(/\s{2,}/g, ' ').trim();
  }
  if (safeCoach && Math.random() < 0.35) {
    return `${prefix}, ben ${safeCoach}. ${base}`.replace(/\s{2,}/g, ' ').trim();
  }
  return `${prefix}, ${base}`.replace(/\s{2,}/g, ' ').trim();
}

// Human-readable names for each supported language — used in prompts so
// the model doesn't have to guess what "tr" vs "pt" means.
const LANG_NAMES = {
  tr: 'Turkish', en: 'English', de: 'German', es: 'Spanish',
  fr: 'French', it: 'Italian', pt: 'Portuguese', ru: 'Russian',
  ja: 'Japanese', ko: 'Korean', zh: 'Chinese', hi: 'Hindi',
  ar: 'Arabic',
};
function langName(code) {
  return LANG_NAMES[code] || code || 'Turkish';
}

/**
 * Heuristic language detector from a short text snippet. Uses unicode
 * range checks first (for non-Latin scripts), then diacritic hints for
 * Latin-script languages. Returns a 2-letter code or null if unsure.
 */
function detectLanguage(text) {
  if (!text || typeof text !== 'string') return null;
  const s = text.trim();
  if (!s) return null;

  // Non-Latin scripts — unambiguous
  if (/[\u0400-\u04FF]/.test(s)) return 'ru';
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(s)) return 'ja';
  if (/[\uAC00-\uD7AF]/.test(s)) return 'ko';
  if (/[\u4E00-\u9FFF]/.test(s)) return 'zh';
  if (/[\u0900-\u097F]/.test(s)) return 'hi';
  if (/[\u0600-\u06FF]/.test(s)) return 'ar';

  const lower = s.toLowerCase();

  // Turkish-specific chars
  if (/[çğışö]|[ıİ]/.test(lower) || /\b(bir|ben|sen|için|merhaba|nasıl|evet|hayır|şu|bu)\b/.test(lower)) {
    if (/[ğışİ]/.test(s)) return 'tr';
  }
  if (/[ğışİ]/.test(s)) return 'tr';

  // German
  if (/[äöüß]/.test(lower) || /\b(ich|bin|und|der|die|das|nicht|wie|geht|danke)\b/.test(lower)) return 'de';

  // Spanish
  if (/[ñ¿¡]/.test(lower) || /\b(hola|cómo|estás|gracias|qué|por|favor|muy|bien)\b/.test(lower)) return 'es';

  // French
  if (/[àâçéèêëîïôùûüÿœæ]/.test(lower) && /\b(je|tu|est|suis|vous|bonjour|merci|pas|oui|non)\b/.test(lower)) return 'fr';
  if (/\b(bonjour|merci|s'il|vous|plaît|est-ce|qu'est)\b/.test(lower)) return 'fr';

  // Italian
  if (/\b(ciao|sono|come|stai|grazie|prego|cosa|molto|bene)\b/.test(lower)) return 'it';

  // Portuguese
  if (/[ãõ]/.test(lower) || /\b(olá|obrigado|obrigada|você|está|sim|não|muito|bem)\b/.test(lower)) return 'pt';

  // Default to English if pure ASCII + has common words
  if (/^[\x20-\x7E]+$/.test(s) && /\b(the|and|you|are|is|how|hello|hi|thanks|yes|no)\b/.test(lower)) return 'en';

  return null;
}

// ── Echo detection helpers ──────────────────────────────────────────────────
// iOS hardware AEC is imperfect with ElevenLabs TTS — the mic still picks up
// faint copies of the AI's own voice and Whisper happily transcribes them.
// We use a token-overlap check to detect when a user "transcript" is just an
// echo of something the AI said in the last few seconds.

function _normForCompare(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _tokensForCompare(s) {
  return _normForCompare(s).split(' ').filter((t) => t.length >= 2);
}

/**
 * Overlap coefficient between two strings (|A∩B| / min(|A|,|B|)).
 * Works well when Whisper catches only a partial snippet of a long AI
 * utterance — the short transcript still scores high against the full text.
 */
function _overlapSimilarity(a, b) {
  const ta = new Set(_tokensForCompare(a));
  const tb = new Set(_tokensForCompare(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

function _pruneRecentUtterances(list) {
  const now = Date.now();
  return (list || []).filter((u) => u.until >= now);
}

function _findEchoMatch(transcript, recent, threshold = 0.5) {
  // Token count of the transcript drives the minimum absolute overlap we
  // require on top of the similarity ratio. Without this floor, short user
  // phrases like "ok bro" or "you know" can accidentally score 1.0 against
  // long AI utterances that happen to contain those common words — and we
  // end up dropping real user speech.
  const userTokens = new Set(_tokensForCompare(transcript));
  if (userTokens.size === 0) return null;
  for (const u of recent) {
    const refTokens = new Set(_tokensForCompare(u.text));
    if (refTokens.size === 0) continue;
    let inter = 0;
    for (const t of userTokens) if (refTokens.has(t)) inter++;
    const sim = inter / Math.min(userTokens.size, refTokens.size);
    // Require 3+ overlapping tokens for short transcripts; 2+ is fine for
    // longer ones where the ratio signal itself is more trustworthy.
    const minInter = userTokens.size < 6 ? 3 : 2;
    if (sim >= threshold && inter >= minInter) return { sim, ref: u.text };
  }
  return null;
}

/**
 * When Whisper transcribes a buffer containing BOTH the AI's voice
 * (speaker bleed) AND the user's live reply concatenated together, the
 * echo filter catches the whole thing with a high sim score. Blindly
 * dropping loses the user's actual reply — they end up ignored.
 *
 * This helper walks the transcript tokens left→right and finds the
 * rightmost point where we've "consumed" most of the AI tokens. Whatever
 * comes after is treated as the genuine user speech.
 *
 * Returns a string (the residual) or null if nothing meaningful remains.
 */
function _stripEchoPrefix(transcript, aiText) {
  const rawWords = transcript.split(/\s+/).filter((w) => w.length > 0);
  if (rawWords.length === 0) return null;

  const aiTokenSet = new Set(_tokensForCompare(aiText));
  if (aiTokenSet.size === 0) return null;

  // Scan left→right. Remember the index of the LAST word that was an AI
  // token AND only a small gap of non-matching words preceded it — this
  // way we don't prematurely cut at an isolated repeated word.
  let lastMatchIdx = -1;
  let matchedCount = 0;
  let nonMatchStreak = 0;
  for (let i = 0; i < rawWords.length; i++) {
    const norm = _normForCompare(rawWords[i]).trim();
    if (norm.length >= 2 && aiTokenSet.has(norm)) {
      lastMatchIdx = i;
      matchedCount++;
      nonMatchStreak = 0;
    } else {
      nonMatchStreak++;
      // If we've already matched enough AI tokens and then see a run of
      // non-AI words, stop extending the prefix — the rest is user.
      if (matchedCount >= 3 && nonMatchStreak >= 2) break;
    }
  }

  if (lastMatchIdx < 0 || lastMatchIdx >= rawWords.length - 1) return null;
  const residual = rawWords.slice(lastMatchIdx + 1).join(' ').trim();
  // Require the residual to be substantive — at least 3 tokens of real
  // content. Otherwise we risk turning noise fragments into fake turns.
  const residualTokens = _tokensForCompare(residual);
  if (residualTokens.length < 3) return null;
  return residual;
}

/**
 * Whisper is famous for hallucinating stock phrases during silence —
 * "Thank you for watching", "MBC 뉴스...", "ご視聴ありがとうございました",
 * etc. If the transcript is in a totally different script from the
 * conversation's expected language, it's almost certainly a hallucination.
 */
function _isScriptMismatch(transcript, expectedLang) {
  const det = detectLanguage(transcript);
  if (!det) return false;
  if (det === expectedLang) return false;
  const scriptGroup = (l) => {
    if (['ja', 'ko', 'zh'].includes(l)) return 'cjk';
    if (l === 'ru') return 'cyrillic';
    if (l === 'ar') return 'arabic';
    if (l === 'hi') return 'devanagari';
    return 'latin';
  };
  return scriptGroup(det) !== scriptGroup(expectedLang);
}

/**
 * Stronger check: any confidently-detected language that doesn't match
 * the conversation language. Catches the Latin-vs-Latin case that
 * `_isScriptMismatch` can't handle (e.g. conversation is `tr` and Whisper
 * hallucinated English from background noise).
 */
function _isLanguageMismatch(transcript, expectedLang) {
  const det = detectLanguage(transcript);
  if (!det) return false;
  return det !== expectedLang;
}

// Well-known Whisper hallucinations — phrases the model emits during
// mostly-silent or noisy audio because they're over-represented in its
// YouTube/podcast training data. Real users do not say these things on a
// therapy call; if one shows up, it's noise.
const WHISPER_HALLUCINATIONS = [
  // English
  /^(thank you|thanks)\s+(for|so much)\b/i,
  /^(thanks|thank you) for watching/i,
  /^please\s+subscribe/i,
  /^i('?ll| will)\s+see\s+you\s+(next time|later|soon)/i,
  /^i\s+don'?t\s+know\s+what\s+i('?m|\s+am)\s+(going\s+to|gonna)\s+(say|do)/i,
  /^(see|bye)\s+you\s+(next time|later|soon)/i,
  /^that'?s\s+(it|all)\s+for\s+(today|this)/i,
  /^(uh+|um+|hmm+|ah+|eh+)[.,!?]*$/i,
  /^like,?\s+(and|share|subscribe)/i,
  // Korean
  /^(mbc|kbs|sbs)\s+뉴스/i,
  /^(이덕영|먹방끝|빠이빠이)/,
  /다음\s*영상에서\s*뵙겠습니다/,
  // Japanese
  /ご視聴\s*ありがとう/,
  /^チャンネル登録/,
  // Turkish-specific YouTube artifacts
  /^abone\s+ol/i,
  /^kanalıma\s+abone/i,
];

function _isWhisperHallucination(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  for (const re of WHISPER_HALLUCINATIONS) {
    if (re.test(s)) return true;
  }
  return false;
}

// ── Character personas ──────────────────────────────────────────────────────
// Each consultant gets a speaking style derived from their job / features.
// The persona controls BOTH the ElevenLabs voice settings (stability, style,
// speed) AND a tone hint we inject into the LLM system prompt, so the AI's
// word choice and prosody both match the character's field.
//
// Voice IDs below are all ElevenLabs "premade" library voices that exist on
// every account. Each persona splits the pool by {male, female} so female
// coaches always get a female voice and vice-versa. If we can't guess the
// gender from the coach's name, we fall back to `unisex` which is used only
// as a last resort.
const PERSONA_STYLES = {
  default: {
    fallbackVoices: {
      male: [
        'JBFqnCBsd6RMkjVDRZzb', // George — Warm, Captivating Storyteller
        'nPczCjzI2devNBz1zQrb', // Brian — Deep, Resonant, Comforting
      ],
      female: [
        'EXAVITQu4vr4xnSDxMaL', // Sarah — Mature, Reassuring, Confident
        'pFZP5JQG7iQjIQuC4Bku', // Lily — Velvety Actress
      ],
    },
    voice: { stability: 0.55, similarity_boost: 0.8, style: 0.15, speed: 1.0, use_speaker_boost: true },
    tone: 'Speak in a warm, natural, conversational tone — like a trusted friend on the phone.',
  },
  // High-energy: motivation, performance, fitness, sports coaches
  energetic: {
    fallbackVoices: {
      male: [
        'TX3LPaxmHKxFdv7VOQHJ', // Liam — Energetic social-media creator
        'IKne3meq5aSn9XLyUdCD', // Charlie — Deep, confident, energetic
      ],
      female: [
        'FGY2WhTYpPnrIDTdsKH5', // Laura — Enthusiast, quirky attitude
        'cgSgspJ2msm6clMCkdW9', // Jessica — Playful, bright, warm
      ],
    },
    voice: { stability: 0.42, similarity_boost: 0.78, style: 0.55, speed: 1.1, use_speaker_boost: true },
    tone: 'Speak with high energy and enthusiasm — upbeat, fast-paced, confident and cheerful. Use short, punchy sentences. Let your excitement come through.',
  },
  // Calm & soothing: meditation, mindfulness, sleep, breathwork
  calm: {
    fallbackVoices: {
      male: [
        'nPczCjzI2devNBz1zQrb', // Brian — Deep, resonant, comforting
        'onwK4e9ZLuTAKqWW03F9', // Daniel — Steady broadcaster
      ],
      female: [
        'pFZP5JQG7iQjIQuC4Bku', // Lily — Velvety
        'XrExE9yKIg1WjnnlVkGX', // Matilda — Knowledgable, professional
      ],
    },
    voice: { stability: 0.75, similarity_boost: 0.85, style: 0.05, speed: 0.9, use_speaker_boost: true },
    tone: 'Speak slowly, calmly and softly, with gentle natural pauses. Soothing and unhurried. Let silence breathe between thoughts.',
  },
  // Warm & empathetic: therapy, psychology, relationships, family
  warm: {
    fallbackVoices: {
      male: [
        'JBFqnCBsd6RMkjVDRZzb', // George — Warm storyteller
        'cjVigY5qzO86Huf0OWal', // Eric — Smooth, trustworthy
      ],
      female: [
        'EXAVITQu4vr4xnSDxMaL', // Sarah — Mature, reassuring
        'XrExE9yKIg1WjnnlVkGX', // Matilda — Knowledgable, professional
      ],
    },
    voice: { stability: 0.62, similarity_boost: 0.84, style: 0.2, speed: 0.97, use_speaker_boost: true },
    tone: 'Speak with genuine warmth and empathy. Unhurried, attentive, gently caring. Validate feelings before offering ideas.',
  },
  // Confident & composed: career, leadership, business, strategy
  confident: {
    fallbackVoices: {
      male: [
        'cjVigY5qzO86Huf0OWal', // Eric — Smooth, trustworthy
        'onwK4e9ZLuTAKqWW03F9', // Daniel — Steady broadcaster
      ],
      female: [
        'XrExE9yKIg1WjnnlVkGX', // Matilda — Knowledgable, professional
        'EXAVITQu4vr4xnSDxMaL', // Sarah — Mature, reassuring
      ],
    },
    voice: { stability: 0.55, similarity_boost: 0.8, style: 0.3, speed: 1.02, use_speaker_boost: true },
    tone: 'Speak with quiet confidence — direct, composed, thoughtful. Concise and clear. Sound like a seasoned mentor who has answered this before.',
  },
  // Playful & light: creative arts, humor, kids, casual coaching
  playful: {
    fallbackVoices: {
      male: [
        'TX3LPaxmHKxFdv7VOQHJ', // Liam — Energetic
        'IKne3meq5aSn9XLyUdCD', // Charlie — Confident, energetic
      ],
      female: [
        'cgSgspJ2msm6clMCkdW9', // Jessica — Playful, bright, warm
        'FGY2WhTYpPnrIDTdsKH5', // Laura — Quirky
      ],
    },
    voice: { stability: 0.45, similarity_boost: 0.78, style: 0.5, speed: 1.06, use_speaker_boost: true },
    tone: 'Speak playfully and lightly. Friendly, quick-witted, a touch of humor, relaxed rhythm.',
  },
};

// ── Gender inference from consultant name ──────────────────────────────────
// We don't have an explicit gender column in the consultants table yet, so
// we guess from the coach's name. Matching is case-insensitive and works
// across any language entry in `consultant.names`.
//
// If the name is ambiguous we return null and callers fall back to a
// persona-matched default. Adding an explicit `gender` field later just
// becomes the first check and wins over this heuristic.
const FEMALE_NAMES = new Set([
  // Turkish
  'ayşe', 'ayse', 'fatma', 'zeynep', 'elif', 'merve', 'selin', 'emine', 'büşra', 'busra',
  'kübra', 'kubra', 'gül', 'gul', 'derya', 'hatice', 'hülya', 'hulya', 'mine', 'özlem', 'ozlem',
  'pınar', 'pinar', 'yasemin', 'leyla', 'aylin', 'ceren', 'cemre', 'ebru', 'eda', 'esra',
  'filiz', 'gülşen', 'gulsen', 'havva', 'hande', 'ilknur', 'irem', 'meltem', 'nazlı', 'nazli',
  'nihan', 'nurdan', 'senem', 'serap', 'sibel', 'sinem', 'şeyma', 'seyma', 'şule', 'sule',
  'burcu', 'burçin', 'burcin', 'canan', 'defne', 'duygu', 'ezgi', 'gamze', 'gizem', 'gökçe',
  'gokce', 'nur', 'melisa', 'melis', 'başak', 'basak', 'özge', 'ozge', 'rabia', 'rana', 'tuba',
  'tuğba', 'tugba', 'yıldız', 'yildiz', 'berna', 'selma', 'seda', 'simge', 'tülay', 'tulay',
  'ümmühan', 'umran', 'zehra', 'zübeyde', 'zeliha', 'esma', 'emel', 'fikriye', 'gönül', 'gonul',
  // English / western
  'sarah', 'emma', 'emily', 'olivia', 'sophia', 'mia', 'isabella', 'ava', 'charlotte', 'amelia',
  'anna', 'maria', 'laura', 'lisa', 'linda', 'lily', 'ella', 'rose', 'chloe', 'grace', 'jessica',
  'jenny', 'jennifer', 'kate', 'katie', 'kim', 'megan', 'nicole', 'rachel', 'rebecca', 'ruth',
  'susan', 'tiffany', 'alice', 'angela', 'beth', 'carol', 'diana', 'elena', 'eva', 'fiona',
  'helen', 'julia', 'karen', 'michelle', 'monica', 'nina', 'paula', 'sophie', 'tina', 'victoria',
  'zoe', 'catherine', 'bella', 'daniela', 'sofia', 'olga', 'natasha', 'natalia', 'tatiana',
  'irina', 'svetlana', 'nancy', 'margaret', 'barbara', 'sandra', 'ashley', 'amanda', 'melissa',
  'deborah', 'stephanie', 'dorothy', 'amy', 'kathleen', 'shirley', 'cynthia', 'marie', 'samantha',
  'christine', 'debra', 'carolyn', 'janet', 'virginia', 'hannah', 'isabel', 'claire',
]);

const MALE_NAMES = new Set([
  // Turkish
  'ahmet', 'mehmet', 'mustafa', 'ali', 'hüseyin', 'huseyin', 'hasan', 'ibrahim', 'ismail',
  'osman', 'yusuf', 'murat', 'kemal', 'emre', 'onur', 'can', 'burak', 'serkan', 'tolga', 'oğuz',
  'oguz', 'kaan', 'cem', 'barış', 'baris', 'çağatay', 'cagatay', 'eren', 'furkan', 'hakan',
  'kerem', 'mert', 'ozan', 'selim', 'tarık', 'tarik', 'ufuk', 'umut', 'volkan', 'yaşar', 'yasar',
  'yiğit', 'yigit', 'batuhan', 'efe', 'berk', 'bora', 'caner', 'enes', 'ergun', 'erkan', 'erol',
  'ersin', 'fatih', 'ferhat', 'fikret', 'gökhan', 'gokhan', 'halil', 'ilker', 'kadir', 'levent',
  'mahmut', 'metin', 'naim', 'nevzat', 'nihat', 'okan', 'okay', 'oktay', 'ömer', 'omer', 'özcan',
  'ozcan', 'recep', 'rıfat', 'rifat', 'sabri', 'sadık', 'sadik', 'samet', 'selahattin', 'serdar',
  'şevket', 'sevket', 'sinan', 'süleyman', 'suleyman', 'taner', 'tayfun', 'tayyip', 'turgay',
  'ulaş', 'ulas', 'veli', 'yalçın', 'yalcin', 'zafer', 'koray', 'rafet', 'talha', 'abdullah',
  // English / western
  'john', 'james', 'william', 'michael', 'david', 'robert', 'richard', 'thomas', 'charles',
  'christopher', 'daniel', 'matthew', 'anthony', 'mark', 'donald', 'steven', 'paul', 'andrew',
  'joshua', 'kenneth', 'kevin', 'brian', 'george', 'timothy', 'jason', 'edward', 'jeffrey',
  'ryan', 'jacob', 'gary', 'nicholas', 'eric', 'jonathan', 'stephen', 'larry', 'justin',
  'scott', 'brandon', 'benjamin', 'samuel', 'gregory', 'frank', 'alexander', 'raymond',
  'patrick', 'jack', 'dennis', 'jerry', 'tyler', 'aaron', 'jose', 'adam', 'henry', 'nathan',
  'douglas', 'zachary', 'peter', 'kyle', 'noah', 'ethan', 'jeremy', 'walter', 'christian',
  'keith', 'roger', 'terry', 'austin', 'sean', 'arthur', 'lawrence', 'jesse', 'dylan', 'bryan',
  'jordan', 'billy', 'bruce', 'albert', 'willie', 'gabriel', 'logan', 'alan', 'juan', 'wayne',
  'roy', 'ralph', 'randy', 'eugene', 'vincent', 'russell', 'louis', 'philip', 'bobby', 'johnny',
  'bradley', 'max', 'liam', 'oliver', 'charlie', 'mohammed', 'muhammad', 'oscar', 'leo', 'theo',
]);

function _guessGender(consultant) {
  const parseRoles = (raw) => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
      } catch (_) {}
      return [trimmed];
    }
    return [];
  };

  // 1. roles/gender metadata from DB wins (female/male).
  const roles = parseRoles(consultant?.roles);
  for (const role of roles) {
    const s = String(role || '').toLowerCase().trim();
    if (['female', 'woman', 'kadin', 'kadın', 'f'].includes(s)) return 'female';
    if (['male', 'man', 'erkek', 'm'].includes(s)) return 'male';
  }

  // 2. Explicit gender column wins if it's ever added to the DB.
  const g = consultant?.gender ?? consultant?.Gender ?? null;
  if (g) {
    const s = String(g).toLowerCase();
    if (s.startsWith('f') || s === 'kadın' || s === 'kadin' || s === 'k') return 'female';
    if (s.startsWith('m') || s === 'erkek' || s === 'e') return 'male';
  }

  // 3. Name-based lookup across all localized entries in `consultant.names`.
  const names = consultant?.names || {};
  const tokens = [];
  for (const v of Object.values(names)) {
    if (typeof v !== 'string') continue;
    // Split on whitespace and common separators so "Dr. Ayşe Yılmaz" → ["dr","ayşe","yılmaz"].
    for (const t of v.toLowerCase().split(/[\s\.,/\\|\-–—]+/u)) {
      const clean = t.replace(/[^\p{L}]/gu, '');
      if (clean.length >= 2) tokens.push(clean);
    }
  }
  for (const t of tokens) {
    if (FEMALE_NAMES.has(t)) return 'female';
    if (MALE_NAMES.has(t)) return 'male';
  }

  // 4. Very weak Turkish heuristic: names ending in 'a' or 'e' are *more
  //    often* female (Zeynep, Ayşe, Meryem ...), names ending in consonants
  //    more often male. We only apply this when the first/given name is
  //    obviously Turkish (no Latin letters outside Turkish alphabet) and
  //    we found nothing in the lookup tables. It's far from perfect but
  //    better than a 50/50 coin flip through a mixed-gender pool.
  if (tokens.length) {
    const first = tokens[0];
    if (/^[a-zçğıöşü]+$/.test(first)) {
      if (/(a|e)$/.test(first)) return 'female';
      if (/(l|n|r|t|m|k|s|z|p|b)$/.test(first)) return 'male';
    }
  }
  return null;
}

function _normalizeVoiceId(raw) {
  if (!raw) return null;
  let id = String(raw)
    // Remove zero-width/invisible chars from copy-paste.
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  if (!id) return null;

  // If a full URL was pasted, keep the last segment.
  if (id.includes('/')) {
    const parts = id.split('/').filter(Boolean);
    id = parts[parts.length - 1] || id;
  }
  // Drop query/hash fragments.
  id = id.split('?')[0].split('#')[0].trim();
  return id || null;
}

/**
 * Pick a stable fallback voice for a consultant. Uses a cheap hash of the
 * consultantId so the SAME consultant always gets the SAME fallback voice
 * (otherwise their voice would change between turns, which sounds jarring).
 */
function _genderedPool(pool, gender) {
  // `pool` is either { male:[...], female:[...] } (new shape) or a flat
  // array (legacy). In both cases we return a de-duplicated list in
  // gender-preference order with the gender's voices FIRST.
  if (!pool) return [];
  if (Array.isArray(pool)) return pool.slice();
  const males = Array.isArray(pool.male) ? pool.male : [];
  const females = Array.isArray(pool.female) ? pool.female : [];
  if (gender === 'female') return [...females, ...males];
  if (gender === 'male') return [...males, ...females];
  // Unknown → mix starting with females so ambiguous names default to a
  // softer voice (safer choice for "kadın" coaches whose name we missed).
  return [...females, ...males];
}

/**
 * Pick a premade ElevenLabs voice for a consultant.
 *
 *   1. Honor gender so female coaches don't get male voices and vice-versa.
 *   2. Fall back from persona's pool → universal default pool if the
 *      persona-specific gender pool is empty.
 *   3. Stable-per-consultant: same coach gets the same voice every call.
 *   4. `exclude` lets retry pick a different voice when the previous one
 *      was rejected by ElevenLabs.
 */
function _pickFallbackVoice(persona, consultantId, gender = null, exclude = null) {
  const primary = _genderedPool(persona?.fallbackVoices, gender);
  const universal = _genderedPool(PERSONA_STYLES.default.fallbackVoices, gender);
  const seen = new Set();
  const list = [];
  for (const v of [...primary, ...universal]) {
    if (!v || seen.has(v)) continue;
    if (exclude && v === exclude) continue;
    seen.add(v);
    list.push(v);
  }
  if (list.length === 0) return null;
  const id = Number(consultantId) || 0;
  return list[id % list.length];
}

function _derivePersonaKey(consultant) {
  const job = String(consultant?.job || '').toLowerCase();
  const featStr = Array.isArray(consultant?.features)
    ? consultant.features.map((f) => String(f).toLowerCase()).join(' ')
    : String(consultant?.features || '').toLowerCase();
  const exp = String(consultant?.explanation || '').toLowerCase();
  const hay = `${job} ${featStr} ${exp}`;

  // Order matters: the first match wins. Place the most specific / most
  // distinctive categories first.
  if (/\b(meditat|mindful|yoga|nefes|breath|uyku|sleep|huzur|rahatlama|relax)\b/.test(hay)) return 'calm';
  if (/\b(therap|psikolog|psycholog|terap|anxiet|kayg|depres|travma|trauma|öz\s*güven)\b/.test(hay)) return 'warm';
  if (/\b(fitness|nutrition|beslen|spor|sport|antren|perform|diyet|kilo|workout)\b/.test(hay)) return 'energetic';
  if (/\b(motivat|coach|koç|başar|succes|hedef|goal|performans)\b/.test(hay)) return 'energetic';
  if (/\b(career|kariyer|business|iş\s|leader|lider|ceo|girişim|startup|finance|para\b)\b/.test(hay)) return 'confident';
  if (/\b(relations|ilişki|couple|partner|aşk|evlil|love|family|aile|parent|ebeveyn|child|çocuk)\b/.test(hay)) return 'warm';
  if (/\b(creative|sanat|art|writer|yazar|müzik|music|playful|eğlen|mizah|humor|komedi)\b/.test(hay)) return 'playful';
  if (/\b(mentor|guide|advisor|danış|rehber)\b/.test(hay)) return 'confident';

  return 'default';
}

// ─────────────────────────────────────────────────────────────────────────────
// Phoneme → Viseme timeline generator (Rhubarb Lip Sync map)
// ─────────────────────────────────────────────────────────────────────────────
const RHUBARB_MAP = {
  A:2, B:8, C:18, D:1, E:2, F:11, G:20, H:1, I:2, J:18, K:20,
  L:12, M:8, N:1, O:6, P:8, Q:20, R:1, S:15, T:1, U:7, V:11,
  W:7, X:0, Y:1, Z:15,
};

// Turkish-specific overrides (letters with distinct phonemes not in English)
const TR_MAP = { 'Ğ':1, 'Ş':15, 'Ç':18, 'İ':2, 'Ö':6, 'Ü':7 };

/**
 * Convert plain text into a [{id, t}] viseme timeline.
 * Timing is estimated at a fixed character rate that matches ElevenLabs TTS
 * natural speech pace.
 *
 * "Hızlı/sürekli konuşma" izlenimi için iki kritik tweak:
 *  1. MS_PER_CHAR 68 → 52: ElevenLabs TR sesleri ölçtüğümüzde ~16-17 ch/sn.
 *     Düşük değer = client'ta zamanlamalar audio ile daha senkron.
 *  2. Aynı viseme id'sinin arka arkaya geldiği harfler için tek bir entry
 *     emit etmek yerine, **transit close (id=0)** ekleyip yeniden açıyoruz.
 *     Böylece "merhaba"daki RH gibi tekrarlar bile ağzı her harfte
 *     hareket ettiriyor — gerçek konuşmada ağız her hece arasında kapanır.
 */
function _generateVisemeTimeline(text) {
  if (!text) return [];

  // ~30 char/sn hedefi: ses süresi boyunca çok daha sık keyframe (istem).
  // ElevenLabs TR genelde 14–18 ch/sn; biraz sık = dudak audio'dan hafif
  // önde ama "hareketli" görünür; client RMS ile tamamlanır.
  const MS_PER_CHAR  = 32;
  const MS_SPACE     = 36;
  const MS_COMMA     = 85;
  const MS_SENTENCE  = 160;
  // Aynı viseme tekrarında kısa kapan→aç — yoğun titreme.
  const MS_REPEAT_TRANSIT = 14;

  const visemes = [];
  let t = 0;
  let lastId = -1;

  const emit = (id, when) => {
    visemes.push({ id, t: Math.round(when) });
    lastId = id;
  };

  for (const rawChar of text) {
    const ch = rawChar.toUpperCase();

    // Silence / pause characters
    if (ch === ' ') {
      if (lastId !== 0) emit(0, t);
      t += MS_SPACE;
      continue;
    }
    if (ch === ',' || ch === ';') {
      if (lastId !== 0) emit(0, t);
      t += MS_COMMA;
      continue;
    }
    if (/[.!?…]/.test(ch)) {
      if (lastId !== 0) emit(0, t);
      t += MS_SENTENCE;
      continue;
    }
    if (/[\n\r\t]/.test(ch)) { t += MS_SPACE; continue; }
    if (/[^A-ZÇĞİÖŞÜA-Z0-9]/.test(ch)) { continue; } // skip other symbols

    const id = TR_MAP[ch] ?? RHUBARB_MAP[ch] ?? null;
    if (id === null) { t += MS_PER_CHAR; continue; }

    if (id === lastId) {
      // Tekrar eden phoneme: kısa bir kapanma + yeniden aç → ağız her harfte
      // gerçekten kıpırdar, "çok konuşan" hissi belirginleşir.
      emit(0, t);
      emit(id, t + MS_REPEAT_TRANSIT);
    } else {
      emit(id, t);
    }
    t += MS_PER_CHAR;
  }

  // Always end with mouth-closed
  if (lastId !== 0) visemes.push({ id: 0, t: Math.round(t) + 100 });

  return visemes;
}

class VoiceChatServerV2 {
  constructor(port = 3001) {
    this.port = port;
    this.wss = null;
    /** @type {Map<string, ConnectionContext>} */
    this.connections = new Map();
  }

  start(options = {}) {
    const { server = null, path = '/realtime' } = options;
    const wsOptions = server
      ? { server, path, perMessageDeflate: false }
      : { port: this.port, perMessageDeflate: false };

    this.wss = new WebSocket.Server(wsOptions);
    if (server) {
      console.log(`[VCv2] 🚀 Voice Chat v2 (OpenAI+Eleven) attached to HTTP server on path ${path}`);
    } else {
      console.log(`[VCv2] 🚀 Voice Chat v2 (OpenAI+Eleven) on port ${this.port}`);
    }

    this.wss.on('connection', (ws, req) => {
      this._handleConnection(ws, req).catch((e) => {
        console.error('[VCv2] ❌ Unhandled connection error:', e);
      });
    });

    process.on('SIGINT', () => this.stop());
  }

  stop() {
    if (this.wss) this.wss.close(() => console.log('[VCv2] ✅ Server stopped'));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Connection lifecycle
  // ───────────────────────────────────────────────────────────────────────────
  async _handleConnection(ws, req) {
    const auth = await this._authenticate(req);
    if (!auth.success) {
      ws.close(1008, auth.error);
      return;
    }

    const { userId, consultantId, clientLang } = auth;
    const connectionId = `${userId}_${consultantId}_${Date.now()}`;

    let consultant;
    try {
      consultant = await ConsultantService.getConsultantById(consultantId);
    } catch (e) {
      console.error(`[VCv2] ❌ consultant fetch failed:`, e.message);
      ws.close(1011, 'Consultant fetch failed');
      return;
    }

    if (!consultant) { ws.close(1008, 'Consultant not found'); return; }

    let user = null;
    try { user = await UserService.getUserById(userId); } catch (_) { }

    let chatId = null;
    try {
      const chat = await ChatService.getOrCreateChat(userId, consultantId);
      chatId = chat?.chatId ?? null;
    } catch (e) {
      console.warn('[VCv2] ⚠️ getOrCreateChat failed:', e.message);
    }

    // Fetch recent history up front — we need it (a) to pick the starting
    // language of the call, and (b) to inject into OpenAI as memory.
    let historyRows = [];
    if (chatId) {
      try {
        historyRows = await MessageRepository.getChatHistory(chatId, HISTORY_LIMIT) || [];
      } catch (e) {
        console.warn('[VCv2] ⚠️ history fetch failed:', e.message);
      }
    }

    // Language priority:
    //   1. Language of the most recent user message in chat history
    //      (only if chat actually has content)
    //   2. clientLang — the device/app locale sent by the Flutter client
    //   3. user.nativeLang (device locale stored on signup)
    //   4. 'tr' as last-resort fallback
    const detectedFromChat = this._detectChatLanguage(historyRows);
    const conversationLang =
      detectedFromChat ||
      clientLang ||
      user?.nativeLang ||
      'tr';
    console.log(
      `[VCv2] 🌐 [${connectionId}] language = ${conversationLang} ` +
      `(chat=${detectedFromChat || '-'} client=${clientLang || '-'} ` +
      `native=${user?.nativeLang || '-'})`
    );

    const personaKey = _derivePersonaKey(consultant);
    const persona = PERSONA_STYLES[personaKey] || PERSONA_STYLES.default;
    const gender = _guessGender(consultant);
    console.log(
      `[VCv2] 🎭 [${connectionId}] persona=${personaKey} gender=${gender || 'unknown'}`
    );

    const ctx = {
      connectionId, userId, consultantId, chatId, user, consultant, ws,
      language: conversationLang,
      personaKey,
      persona,
      gender,
      historyRows,
      openai: null,
      tts: null,
      isAISpeaking: false,       // AI generating/streaming audio
      pendingAssistantText: '',  // collected text for current response
      pendingUserTranscript: '', // collected user transcript for current turn
      closed: false,
      // Idle check-in: if user stays quiet after AI finishes, gently prompt.
      idleTimer: null,
      checkinCount: 0,
      // When true, the next TTS `done` will trigger the call to end (used
      // to hang up after the goodbye message finishes playing).
      endAfterResponse: false,
      // Recent things the AI said — used to detect when a "user transcript"
      // is actually the AI's own voice echoing back through the mic. Each
      // entry is { text, until } where `until` is a wall-clock expiry time.
      recentAiUtterances: [],
      // Timestamps from OpenAI's server-VAD so we can filter out transcripts
      // that come from extremely short speech bursts (likely noise/echo tail).
      speechStartedAt: 0,
      lastSpeechDurationMs: 0,
      // Set while we're waiting to confirm sustained speech before aborting
      // the AI. Canceled by user_speech_stopped if the speech was a blip.
      bargeInTimer: null,
      // Set when ElevenLabs rejects the consultant's configured voiceId.
      // From that point on, every TTS session in this call uses the
      // fallback voice directly — no more primary-voice retries.
      stickyVoiceId: null,
      // Per-connection cache for custom voice IDs that are not accessible
      // with the active ElevenLabs API key/workspace.
      blockedVoiceIds: new Set(),
      // Per-turn replay buffer + finish flag — populated by _ttsSend /
      // _ttsFinish so a mid-stream tts_error can resend exactly what we
      // intended to say through the fallback session.
      ttsReplayBuffer: '',
      ttsFinishCalled: false,
      // Per-turn raw PCM chunks from ElevenLabs stream (24kHz mono PCM16).
      // Used by visemeService to derive mouth cues for video avatars.
      turnPcmChunks: [],
    };
    this.connections.set(connectionId, ctx);

    console.log(`[VCv2] ✅ ${connectionId} | user=${userId} consultant=${consultantId} chat=${chatId}`);

    // Validate consultant-level custom voice before first TTS turn so the
    // very first greeting doesn't fail with `voice_id_does_not_exist`.
    try {
      await this._prepareVoiceForConnection(ctx);
    } catch (e) {
      console.warn(
        `[VCv2] ⚠️ [${ctx.connectionId}] preflight voice check failed:`,
        e?.message || e
      );
    }

    // ── Set up OpenAI Realtime session ───────────────────────────────────────
    try {
      const instructions = await this._buildSystemPrompt(consultant, user, userId, consultantId, persona, conversationLang);

      ctx.openai = new OpenAIRealtimeSession({
        instructions,
        language: conversationLang,
        temperature: 0.8,
      });

      await ctx.openai.connect();
      this._wireOpenAI(ctx);

      // Inject recent chat history so the AI remembers prior context natively
      await this._injectChatHistory(ctx);

      this._sendJson(ws, { type: 'connection_success', connectionId, consultantId });

      // Initial greeting — short, triggered by AI
      setTimeout(() => this._triggerGreeting(ctx), 400);
    } catch (e) {
      console.error('[VCv2] ❌ OpenAI session setup failed:', e.message);
      this._sendJson(ws, { type: 'error', error: 'ai_session_setup_failed' });
      try { ws.close(1011, 'AI session setup failed'); } catch (_) { }
      this._cleanup(connectionId);
      return;
    }

    // ── Client → server message handling ─────────────────────────────────────
    ws.on('message', (data) => {
      if (ctx.closed) return;
      if (Buffer.isBuffer(data)) {
        // Binary PCM16 chunk from Flutter — only forward to OpenAI when the
        // AI is NOT speaking and the client is NOT playing back audio.
        //
        // Without this gate OpenAI's server-side VAD fires on audio that was
        // still in the pipeline when TTS started (race condition), triggering
        // the barge-in timer and cutting the AI's own response.  Flutter
        // already stops sending mic audio when _callState == speaking, but
        // there's a brief gap between server sending ai_speaking_start and
        // Flutter receiving + honouring it — gating here closes that window.
        if (ctx.openai?.isReady) {
          const isClientPlaying =
            !!ctx.playbackFallbackTimer ||
            (ctx.turnAudioBytes > 0 && !ctx.playbackDoneReceived);
          if (!ctx.isAISpeaking && !isClientPlaying) {
            ctx.openai.appendAudio(data);
          }
        }
      } else {
        try {
          const msg = JSON.parse(data.toString());
          this._onClientJson(ctx, msg);
        } catch (_) { }
      }
    });

    ws.on('close', () => { console.log(`[VCv2] 🔌 closed: ${connectionId}`); this._cleanup(connectionId); });
    ws.on('error', (e) => { console.error(`[VCv2] ❌ ws error [${connectionId}]:`, e.message); this._cleanup(connectionId); });
  }

  _onClientJson(ctx, msg) {
    switch (msg?.type) {
      case 'ping':
        this._sendJson(ctx.ws, { type: 'pong' });
        break;
      case 'playback_done':
        // Client finished playing all queued AI audio — NOW it's truly
        // silent and we can start counting idle time.
        this._onPlaybackDone(ctx);
        break;
      case 'barge_in_request':
        // Explicit user interruption from the Flutter UI.
        // Always respond with barge_in — even if TTS has already finished
        // but the client is still draining its PCM queue (isAISpeaking=false
        // yet clientPlaying=true). Without this the Flutter screen stays
        // stuck in the speaking state waiting for a barge_in that never arrives.
        console.log(
          `[VCv2] 🤚 [${ctx.connectionId}] client barge-in ` +
          `(speaking=${ctx.isAISpeaking})`
        );
        if (ctx.isAISpeaking) {
          this._abortAIResponse(ctx); // also resets turnAudioBytes + cancels fallback timer
        } else {
          // TTS done but client still playing — reset so audio forwarding
          // to OpenAI resumes immediately after the interrupt.
          ctx.turnAudioBytes = 0;
          ctx.playbackDoneReceived = true;
          this._cancelPlaybackDoneFallback(ctx);
        }
        this._sendJson(ctx.ws, { type: 'barge_in' });
        this._cancelIdleTimer(ctx);
        ctx.checkinCount = 0;
        break;
      default:
        break;
    }
  }

  /** Called when Flutter confirms its PCM queue drained. */
  _onPlaybackDone(ctx) {
    if (ctx.closed) return;
    // Cancel any fallback timer we set while waiting.
    this._cancelPlaybackDoneFallback(ctx);
    ctx.playbackDoneReceived = true;
    // If user already started talking before we got here, don't touch idle.
    if (ctx.isAISpeaking) return;

    if (ctx.endAfterResponse) {
      setTimeout(() => this._hangupDueToSilence(ctx), HANGUP_GRACE_MS);
    } else {
      this._scheduleIdleCheckin(ctx);
    }
  }

  /**
   * Schedule the "silence starts now" event. We compute the expected
   * playback duration from the exact number of audio bytes we streamed,
   * so the wait is precisely as long as the AI speech. If the client
   * sends `playback_done` first, we use that (acts as an early-confirm).
   */
  _schedulePlaybackDoneFallback(ctx, waitMs) {
    this._cancelPlaybackDoneFallback(ctx);
    const ms = Number.isFinite(waitMs) ? waitMs : 30000;
    ctx.playbackDoneFallback = setTimeout(() => {
      ctx.playbackDoneFallback = null;
      this._onPlaybackDone(ctx);
    }, ms);
  }

  _cancelPlaybackDoneFallback(ctx) {
    if (ctx.playbackDoneFallback) {
      clearTimeout(ctx.playbackDoneFallback);
      ctx.playbackDoneFallback = null;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // OpenAI event wiring
  // ───────────────────────────────────────────────────────────────────────────
  _wireOpenAI(ctx) {
    const { openai, ws } = ctx;

    // VAD fired — user started speaking.
    //
    // Server-side barge-in via OpenAI VAD is intentionally DISABLED while
    // isAISpeaking=true. Reason: even after we stop forwarding mic audio to
    // OpenAI, audio that was already in OpenAI's buffer before isAISpeaking
    // became true can still trigger user_speech_started. That causes the AI
    // to cut its OWN response — it mistakes buffered stale audio for real
    // user speech.
    //
    // Instead we rely exclusively on Flutter's echo-aware barge_in_request:
    // Flutter uses RMS + _lastPlaybackRms*1.6 as the threshold, so playback
    // echo never crosses it, but real user speech does. If the user genuinely
    // interrupts, Flutter sends barge_in_request → server aborts.
    openai.on('user_speech_started', () => {
      ctx.speechStartedAt = Date.now();
      this._sendJson(ws, { type: 'user_speech_started' });

      // While TTS is active, never auto-abort — Flutter handles it.
      if (ctx.isAISpeaking) return;
    });

    openai.on('user_speech_stopped', () => {
      if (ctx.speechStartedAt > 0) {
        ctx.lastSpeechDurationMs = Date.now() - ctx.speechStartedAt;
      }
      // Speech blip ended before the barge-in threshold — cancel the abort.
      if (ctx.bargeInTimer) {
        clearTimeout(ctx.bargeInTimer);
        ctx.bargeInTimer = null;
        console.log(
          `[VCv2] 🙈 [${ctx.connectionId}] barge-in cancelled ` +
          `(speech only ${ctx.lastSpeechDurationMs}ms — likely echo/noise)`
        );
      }
      // Reset the marker so a late-arriving bargeInTimer callback doesn't
      // fire on a stale speech window.
      ctx.speechStartedAt = 0;
      this._sendJson(ws, { type: 'user_speech_stopped' });
    });

    // Whisper transcription of user audio — this is where we decide if
    // it's a real user turn or just speaker echo.
    openai.on('user_transcript', ({ transcript }) => {
      let raw = (transcript || '').trim();
      if (!raw) return;

      // Filter 0 — strip transient noise (".", "Uh.", etc.)
      const meaningful = raw.replace(/[^\p{L}\p{N}]/gu, '');
      if (meaningful.length < 2) {
        console.log(`[VCv2] 🙊 [${ctx.connectionId}] dropped (too short): "${raw}"`);
        return;
      }

      // Filter 1 — very short VAD burst → likely echo tail / background noise
      // ("speech" only lasted a blink, Whisper filled in a stock phrase).
      // Uses the speech_started → speech_stopped window from OpenAI's VAD.
      if (ctx.lastSpeechDurationMs > 0 && ctx.lastSpeechDurationMs < 400) {
        console.log(
          `[VCv2] 🙊 [${ctx.connectionId}] dropped (short speech=${ctx.lastSpeechDurationMs}ms): ` +
          `"${raw.substring(0, 60)}"`
        );
        ctx.lastSpeechDurationMs = 0;
        return;
      }
      ctx.lastSpeechDurationMs = 0;

      // Filter 2 — echo of our own TTS output.
      //
      // We check against two sources:
      //   a) AI utterances from recently finished turns (15s window).
      //   b) The AI's CURRENT in-progress response (`pendingAssistantText`)
      //      — if the LLM is still streaming its answer, the speaker may
      //      already be playing early chunks. Whisper can pick those up and
      //      label them as user speech BEFORE we ever fire `response_done`.
      // A 0.6 threshold is slightly stricter than the old 0.5 so short
      // coincidental overlaps ("I don't know" / "bro") are less likely to
      // cause false-positive drops of genuine user speech.
      ctx.recentAiUtterances = _pruneRecentUtterances(ctx.recentAiUtterances);
      const echoCandidates = [...ctx.recentAiUtterances];
      const live = (ctx.pendingAssistantText || '').trim();
      if (live.length >= 10) {
        echoCandidates.push({ text: live, until: Date.now() + 1000 });
      }
      const echo = _findEchoMatch(raw, echoCandidates, 0.6);
      if (echo) {
        // Don't blindly drop — Whisper often concatenates the AI's spoken
        // prompt with the user's live reply into a single transcript
        // ("I can't hear you. Yes bro I'm here"). Extract whatever the
        // user said AFTER the echoed portion and continue with that as
        // the real turn. If the residual is too thin, we still drop.
        const residual = _stripEchoPrefix(raw, echo.ref);
        if (residual) {
          console.log(
            `[VCv2] ✂️ [${ctx.connectionId}] stripped echo prefix (sim=${echo.sim.toFixed(2)}), ` +
            `residual="${residual.substring(0, 60)}"`
          );
          raw = residual;
        } else {
          console.log(
            `[VCv2] 🙊 [${ctx.connectionId}] dropped (echo sim=${echo.sim.toFixed(2)}): ` +
            `"${raw.substring(0, 60)}"`
          );
          return;
        }
      }

      // Filter 3 — known Whisper hallucination phrases ("thank you for
      // watching", "I don't know what I'm going to say", etc.)
      if (_isWhisperHallucination(raw)) {
        console.log(
          `[VCv2] 🙊 [${ctx.connectionId}] dropped (hallucination pattern): ` +
          `"${raw.substring(0, 60)}"`
        );
        return;
      }

      // Filter 4 — language handling.
      //   a) Detect the transcript's language first.
      //   b) If the detected language is DIFFERENT from the current
      //      conversation language AND the transcript is long enough to be
      //      a confident signal (≥10 chars), treat it as a genuine
      //      language SWITCH and update ctx.language immediately. Do NOT
      //      drop — the user wants to continue in this new language.
      //   c) Otherwise, drop on mismatch:
      //        - Script mismatch (tr → ja/ko/ru) = always drop.
      //        - Same-script mismatch (tr → en) on short transcript = drop.
      //      This still lets a clear "Türkçe konuşalım" through while
      //      rejecting noise / single-word hallucinations.
      const detectedLang = detectLanguage(raw);
      let languageSwitched = false;
      if (
        detectedLang &&
        detectedLang !== ctx.language &&
        raw.length >= 10
      ) {
        console.log(
          `[VCv2] 🌐 [${ctx.connectionId}] language switch (user-driven): ` +
          `${ctx.language} → ${detectedLang}`
        );
        ctx.language = detectedLang;
        languageSwitched = true;
      }

      if (!languageSwitched) {
        if (_isScriptMismatch(raw, ctx.language)) {
          console.log(
            `[VCv2] 🙊 [${ctx.connectionId}] dropped (script mismatch, expected=${ctx.language}): ` +
            `"${raw.substring(0, 60)}"`
          );
          return;
        }
        if (_isLanguageMismatch(raw, ctx.language) && raw.length < 60) {
          console.log(
            `[VCv2] 🙊 [${ctx.connectionId}] dropped (lang mismatch, expected=${ctx.language}): ` +
            `"${raw.substring(0, 60)}"`
          );
          return;
        }
      }

      // Verified real user turn — safe to act on it now.
      console.log(`[VCv2] 👤 [${ctx.connectionId}] user: "${raw.substring(0, 80)}"`);
      this._sendJson(ws, { type: 'transcript', text: raw });
      this._saveUserMessage(ctx, raw).catch((e) => {
        console.warn(`[VCv2] ⚠️ [${ctx.connectionId}] save user msg failed:`, e.message);
      });

      // Reset idle state
      this._cancelIdleTimer(ctx);
      this._cancelPlaybackDoneFallback(ctx);
      ctx.checkinCount = 0;

      // Barge-in. Two independent cases can warrant flushing the client's
      // audio queue:
      //   1. Server-side AI is still generating / TTS streaming.
      //   2. Server is done, but the client still has queued PCM playing
      //      ("playback_done" hasn't arrived yet). Without this, the user
      //      hears the old response finish after they already spoke up.
      // We always send barge_in; _flushPcm() on the client is safe if the
      // queue is already empty. cancelResponse / tts.abort are also safe
      // no-ops when already idle.
      const serverStillSpeaking = ctx.isAISpeaking;
      const clientMaybeStillPlaying =
        !!ctx.playbackFallbackTimer || (ctx.turnAudioBytes > 0 && !ctx.playbackDoneReceived);
      if (serverStillSpeaking || clientMaybeStillPlaying) {
        console.log(
          `[VCv2] ⚡ [${ctx.connectionId}] barge-in ` +
          `(server=${serverStillSpeaking} clientPlaying=${clientMaybeStillPlaying})`
        );
        this._abortAIResponse(ctx);
        this._sendJson(ws, { type: 'barge_in' });
      }

      // We disabled OpenAI's auto-response-create so we can gate it on
      // echo verification — fire it manually now.
      try { ctx.openai?.createResponse(); } catch (_) { }
    });

    openai.on('response_created', () => {
      this._cancelIdleTimer(ctx);
      this._cancelPlaybackDoneFallback(ctx);
      ctx.isAISpeaking = true;
      ctx.aiSpeakingStartedAt = Date.now();
      ctx.pendingAssistantText = '';
      ctx.pendingAssistantSaved = false;
      ctx.openaiTextDone = false;
      this._sendJson(ws, { type: 'ai_speaking_start' });
      this._openTTSSession(ctx);
    });

    openai.on('text_delta', ({ delta }) => {
      if (!delta) return;
      ctx.pendingAssistantText += delta;
      this._ttsSend(ctx, delta);
    });

    openai.on('text_done', ({ text }) => {
      ctx.openaiTextDone = true;

      // Generate and send phoneme-based viseme timeline now that we have
      // the full response text. startOffsetMs tells Flutter how many ms of
      // audio have already been playing so it can skip past entries.
      const fullText = (ctx.pendingAssistantText || '').trim();
      if (fullText) {
        const timeline = _generateVisemeTimeline(fullText);
        const startOffsetMs = ctx.aiSpeakingStartedAt
          ? Math.max(0, Date.now() - ctx.aiSpeakingStartedAt)
          : 0;
        this._sendJson(ws, { type: 'viseme_timeline', timeline, startOffsetMs });
      }

      this._ttsFinish(ctx);
    });

    openai.on('response_done', () => {
      const finalText = ctx.pendingAssistantText.trim();
      if (finalText && !ctx.pendingAssistantSaved) {
        ctx.pendingAssistantSaved = true;
        this._saveAssistantMessage(ctx, finalText).catch((e) => {
          console.warn(`[VCv2] ⚠️ [${ctx.connectionId}] save assistant msg failed:`, e.message);
        });
        this._rememberAiUtterance(ctx, finalText);
      }
      // Keep ctx.isAISpeaking true until TTS fully drains — TTS 'done' clears it.
      if (ctx.tts) {
        this._ttsFinish(ctx);
      } else {
        ctx.isAISpeaking = false;
        this._sendJson(ws, { type: 'ai_response_complete' });
      }
    });

    openai.on('response_cancelled', () => {
      ctx.isAISpeaking = false;
      // If we had started generating text before the barge-in, save that
      // partial so the user sees what was spoken (and it's matched against
      // any echoed audio from the speaker).
      const partial = (ctx.pendingAssistantText || '').trim();
      if (partial && !ctx.pendingAssistantSaved) {
        ctx.pendingAssistantSaved = true;
        this._saveAssistantMessage(ctx, partial).catch((e) => {
          console.warn(`[VCv2] ⚠️ [${ctx.connectionId}] save cancelled assistant msg failed:`, e.message);
        });
        this._rememberAiUtterance(ctx, partial);
      }
    });

    openai.on('api_error', (event) => {
      const msg = event?.error?.message || 'openai_error';
      const code = event?.error?.code;
      console.error(`[VCv2] ❌ [${ctx.connectionId}] OpenAI API error:`, msg);
      // Non-fatal input errors — don't break the call, just warn server-side.
      const NON_FATAL_CODES = new Set([
        'invalid_value',
        'input_audio_buffer_commit_empty',
        'input_audio_buffer_clear_empty',
      ]);
      if (NON_FATAL_CODES.has(code)) return;
      this._sendJson(ws, { type: 'error', error: msg });
    });

    openai.on('ws_error', (e) => {
      console.error(`[VCv2] ❌ [${ctx.connectionId}] OpenAI WS error:`, e.message);
    });

    openai.on('closed', () => {
      if (!ctx.closed && ws.readyState === WebSocket.OPEN) {
        this._sendJson(ws, { type: 'error', error: 'openai_session_closed' });
      }
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TTS per-turn session
  // ───────────────────────────────────────────────────────────────────────────
  _openTTSSession(ctx) {
    // Abort any previous one defensively
    if (ctx.tts) { try { ctx.tts.abort(); } catch (_) { } ctx.tts = null; }

    // Per-turn audio bookkeeping so we can calculate an accurate "silence
    // starts now" moment without needing a reliable client-side signal.
    ctx.turnAudioBytes = 0;
    ctx.turnFirstAudioTime = 0;
    ctx.playbackDoneReceived = false;
    ctx.turnPcmChunks = [];

    // Reset the per-turn replay buffer. Every call to _ttsSend appends to
    // this, so if ElevenLabs rejects the voiceId mid-stream we can replay
    // exactly what we tried to say through the fallback voice — NOT some
    // stale `pendingAssistantText` left over from a previous LLM turn.
    ctx.ttsReplayBuffer = '';
    ctx.ttsFinishCalled = false;

    // Voice ID resolution:
    //   1. Sticky voice (session memory): once a voice works, keep it for
    //      the rest of the call for consistent persona.
    //   2. Consultant voiceId from DB (user/admin configured).
    //   3. ELEVENLABS_DEFAULT_VOICE_ID from env.
    //   4. Persona-matched premade fallback.
    //
    // NOTE: We now default to using DB voice IDs. Set
    // ALLOW_CUSTOM_VOICE_ID=false only if you explicitly want to disable
    // DB-provided voice IDs.
    const allowCustom = process.env.ALLOW_CUSTOM_VOICE_ID !== 'false';
    const envDefault = _normalizeVoiceId(process.env.ELEVENLABS_DEFAULT_VOICE_ID || null);
    const dbVoiceId = _normalizeVoiceId(ctx.consultant.voiceId);
    const dbVoiceAllowed = dbVoiceId && !ctx.blockedVoiceIds?.has(dbVoiceId);
    const primaryVoiceId =
      ctx.stickyVoiceId ||
      (allowCustom && dbVoiceAllowed ? dbVoiceId : null) ||
      envDefault ||
      _pickFallbackVoice(ctx.persona, ctx.consultantId, ctx.gender);

    if (!primaryVoiceId) {
      console.error(`[VCv2] ❌ [${ctx.connectionId}] no voice id resolved — aborting TTS`);
      ctx.isAISpeaking = false;
      this._sendJson(ctx.ws, { type: 'error', error: 'tts_open_failed' });
      return;
    }

    // Cache the voice so every next turn reuses it (stickiness).
    ctx.stickyVoiceId = primaryVoiceId;

    const tts = new ElevenLabsTTSSession({
      voiceId: primaryVoiceId,
      voiceSettings: ctx.persona?.voice,
    });
    ctx.tts = tts;
    ctx.ttsVoiceIdUsed = primaryVoiceId;
    ctx.ttsTriedFallback = false;

    this._wireTtsEvents(ctx, tts);

    tts.open().catch((e) => {
      console.error(`[VCv2] ❌ [${ctx.connectionId}] TTS open failed:`, e.message);
      ctx.isAISpeaking = false;
      this._sendJson(ctx.ws, { type: 'error', error: 'tts_open_failed' });
    });
  }

  /**
   * Send text to the current TTS session AND remember it in the per-turn
   * replay buffer so we can resend exactly this content through a fallback
   * session if ElevenLabs rejects the current voice mid-stream.
   */
  _ttsSend(ctx, text) {
    if (!text) return;
    ctx.ttsReplayBuffer = (ctx.ttsReplayBuffer || '') + text;
    try { ctx.tts?.sendText(text, false); } catch (_) { }
  }

  _ttsFinish(ctx) {
    ctx.ttsFinishCalled = true;
    try { ctx.tts?.finish(); } catch (_) { }
  }

  /**
   * Wire the full TTS event pipeline (audio → client, done → playback
   * scheduler, error → fallback-or-error) onto a given session. Extracted
   * so both the initial session and the fallback retry go through the
   * exact same handlers.
   */
  _wireTtsEvents(ctx, tts) {
    tts.on('audio', (pcm) => {
      if (ctx.ws.readyState === WebSocket.OPEN) {
        try { ctx.ws.send(pcm, { binary: true }); } catch (_) { }
        if (ctx.turnFirstAudioTime === 0) ctx.turnFirstAudioTime = Date.now();
        ctx.turnAudioBytes += pcm.length;
        // Keep a bounded copy for viseme extraction (skip unbounded growth).
        const MAX_PCM_BYTES = 6 * 1024 * 1024; // ~65s mono PCM16 @24kHz
        if (ctx.turnAudioBytes <= MAX_PCM_BYTES) {
          ctx.turnPcmChunks.push(Buffer.from(pcm));
        }
      }
    });

    tts.on('done', () => {
      ctx.isAISpeaking = false;
      this._sendJson(ctx.ws, { type: 'ai_response_complete' });
      try { tts.abort(); } catch (_) { }
      if (ctx.tts === tts) ctx.tts = null;

      // Compute how long the audio will take to play on the client based
      // on the exact number of PCM bytes we streamed out.
      //   PCM16 mono @ 24kHz  →  24000 * 2 = 48000 bytes / sec
      const bytesPerSec = 48000;
      const audioDurationMs = Math.round((ctx.turnAudioBytes / bytesPerSec) * 1000);
      const firstAudioAt = ctx.turnFirstAudioTime || Date.now();
      const elapsedMs = Date.now() - firstAudioAt;
      const remainingMs = Math.max(0, audioDurationMs - elapsedMs);
      // Small grace so the very last audio frame finishes decoding on the
      // client before we start counting silence. 150ms is enough on-device
      // and keeps the response-to-idle turnaround snappy.
      const grace = 150;
      const waitMs = remainingMs + grace;

      console.log(
        `[VCv2] ⏱ [${ctx.connectionId}] audio=${audioDurationMs}ms ` +
        `streamed=${elapsedMs}ms → wait=${waitMs}ms`
      );

      this._schedulePlaybackDoneFallback(ctx, waitMs);

      // Generate visemes for this finished AI utterance and send once.
      this._emitVisemeTimeline(ctx).catch((e) => {
        console.warn(
          `[VCv2] ⚠️ [${ctx.connectionId}] viseme timeline failed:`,
          e.message
        );
      });
    });

    tts.on('tts_error', (err) => {
      const code = err?.code || err?.message || err;
      console.error(
        `[VCv2] ❌ [${ctx.connectionId}] TTS error: ${code}` +
        ` | voiceId="${ctx.ttsVoiceIdUsed}" consultantId=${ctx.consultantId}`
      );

      // Bad/expired voiceId in DB → fall back to a persona-matched premade
      // ElevenLabs voice (always available on every account). We retry ONCE
      // per turn so we don't loop forever.
      const isMissingVoice = String(code).includes('voice_id_does_not_exist');
      if (isMissingVoice && ctx.ttsVoiceIdUsed) {
        if (ctx.blockedVoiceIds) ctx.blockedVoiceIds.add(ctx.ttsVoiceIdUsed);
        this._logVoiceAccessDiagnostic(ctx, ctx.ttsVoiceIdUsed);
      }
      // Pick a voice different from the one that just failed so we don't
      // retry with the same broken ID.
      const fallbackId = isMissingVoice
        ? _pickFallbackVoice(ctx.persona, ctx.consultantId, ctx.gender, ctx.ttsVoiceIdUsed)
        : null;
      if (isMissingVoice && fallbackId && !ctx.ttsTriedFallback && fallbackId !== ctx.ttsVoiceIdUsed) {
        console.warn(
          `[VCv2] 🔁 [${ctx.connectionId}] retrying TTS with fallback voice: ` +
          `"${fallbackId}" (persona=${ctx.personaKey})`
        );
        ctx.ttsTriedFallback = true;
        // Remember the working fallback for the rest of the session so
        // subsequent turns don't re-hit the broken primary voice.
        ctx.stickyVoiceId = fallbackId;
        if (ctx.tts === tts) ctx.tts = null;
        try { tts.abort(); } catch (_) { }

        // Replay EXACTLY what we tried to send to the broken session.
        // This is the per-turn replay buffer — NOT pendingAssistantText,
        // which is an LLM-only concept and would be stale for canned
        // idle/goodbye/greeting turns.
        const replay = ctx.ttsReplayBuffer || '';
        const needsFinish = ctx.ttsFinishCalled;
        const fallback = new ElevenLabsTTSSession({
          voiceId: fallbackId,
          voiceSettings: ctx.persona?.voice,
        });
        ctx.tts = fallback;
        ctx.ttsVoiceIdUsed = fallbackId;
        this._wireTtsEvents(ctx, fallback);
        fallback.open()
          .then(() => {
            if (replay) fallback.sendText(replay, false);
            // If the original session already had finish() called (canned
            // turns) OR the LLM already delivered its full text, close
            // the fallback stream immediately. Otherwise text_delta will
            // keep feeding it as the LLM continues.
            if (needsFinish || ctx.openaiTextDone) {
              try { fallback.finish(); } catch (_) { }
            }
          })
          .catch((e) => {
            console.error(`[VCv2] ❌ [${ctx.connectionId}] fallback TTS open failed:`, e.message);
            ctx.isAISpeaking = false;
            this._sendJson(ctx.ws, { type: 'error', error: 'tts_error' });
          });
        return;
      }

      ctx.isAISpeaking = false;
      this._sendJson(ctx.ws, { type: 'error', error: 'tts_error' });
      if (ctx.tts === tts) ctx.tts = null;
    });
  }

  async _emitVisemeTimeline(ctx) {
    if (!ctx || ctx.closed) return;
    if (!ctx.ws || ctx.ws.readyState !== WebSocket.OPEN) return;
    if (!Array.isArray(ctx.turnPcmChunks) || ctx.turnPcmChunks.length === 0) return;

    // Snapshot and clear so next turn starts fresh even if this call is slow.
    const pcm = Buffer.concat(ctx.turnPcmChunks);
    ctx.turnPcmChunks = [];
    if (!pcm || pcm.length < 2048) return;

    const visemes = await generateVisemesFromPcm24k(pcm, {
      connectionId: ctx.connectionId,
    });
    if (!Array.isArray(visemes) || visemes.length === 0) return;

    this._sendJson(ctx.ws, {
      type: 'viseme_timeline',
      sampleRate: 24000,
      visemes,
    });
  }

  async _logVoiceAccessDiagnostic(ctx, voiceId) {
    try {
      const key = process.env.ELEVENLABS_API_KEY || '';
      if (!key) return;
      const vId = _normalizeVoiceId(voiceId) || voiceId;
      const resp = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(vId)}`, {
        headers: { 'xi-api-key': key, Accept: 'application/json' },
      });
      if (resp.status === 200) {
        console.warn(
          `[VCv2] ℹ️ [${ctx.connectionId}] voice exists in ElevenLabs API but WS rejected it: ` +
          `voiceId="${vId}". Check model/account/workspace compatibility.`
        );
        return;
      }
      console.warn(
        `[VCv2] ⚠️ [${ctx.connectionId}] voice lookup failed: status=${resp.status} ` +
        `voiceId="${vId}" keySuffix="${key.slice(-6)}"`
      );
    } catch (e) {
      console.warn(`[VCv2] ⚠️ [${ctx.connectionId}] voice diagnostic failed:`, e.message);
    }
  }

  /**
   * Preflight custom voice IDs once per connection. If the consultant voice
   * isn't visible to the current ElevenLabs API key/workspace, pick a stable
   * persona fallback up front to avoid first-turn TTS failure.
   */
  async _prepareVoiceForConnection(ctx) {
    const allowCustom = process.env.ALLOW_CUSTOM_VOICE_ID !== 'false';
    if (!allowCustom) return;
    const dbVoiceId = _normalizeVoiceId(ctx?.consultant?.voiceId);
    if (!dbVoiceId) return;

    const accessible = await this._isVoiceAccessibleForApiKey(dbVoiceId);
    if (accessible) {
      ctx.stickyVoiceId = dbVoiceId;
      console.log(
        `[VCv2] 🎙️ [${ctx.connectionId}] using consultant voiceId="${dbVoiceId}"`
      );
      return;
    }

    if (ctx.blockedVoiceIds) ctx.blockedVoiceIds.add(dbVoiceId);
    const fallbackId = _pickFallbackVoice(ctx.persona, ctx.consultantId, ctx.gender, dbVoiceId);
    if (fallbackId) {
      ctx.stickyVoiceId = fallbackId;
      console.warn(
        `[VCv2] ⚠️ [${ctx.connectionId}] consultant voice inaccessible: "${dbVoiceId}" ` +
        `→ fallback "${fallbackId}" (persona=${ctx.personaKey})`
      );
    }
  }

  async _isVoiceAccessibleForApiKey(voiceId) {
    try {
      const key = process.env.ELEVENLABS_API_KEY || '';
      if (!key) return false;
      const vId = _normalizeVoiceId(voiceId) || voiceId;
      const resp = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(vId)}`, {
        headers: { 'xi-api-key': key, Accept: 'application/json' },
      });
      return resp.status === 200;
    } catch (_) {
      return false;
    }
  }

  _abortAIResponse(ctx) {
    try { ctx.openai?.cancelResponse(); } catch (_) { }
    if (ctx.tts) {
      try { ctx.tts.abort(); } catch (_) { }
      ctx.tts = null;
    }
    ctx.isAISpeaking = false;
    ctx.turnPcmChunks = [];
    // Reset client-playing state so audio forwarding to OpenAI resumes
    // immediately after abort (barge-in audio pre-roll must reach OpenAI).
    ctx.turnAudioBytes = 0;
    ctx.playbackDoneReceived = true;
    this._cancelPlaybackDoneFallback(ctx);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Chat history + greeting
  // ───────────────────────────────────────────────────────────────────────────
  async _injectChatHistory(ctx) {
    const rows = ctx.historyRows;
    if (!rows || rows.length === 0) return;
    try {
      // Filter out user rows that are clearly echoes of the preceding
      // assistant message — old voice sessions (before echo suppression
      // existed) polluted the DB with AI text mislabeled as "user".
      // Injecting those as history confuses the LLM into continuing in
      // whatever language the echo was in.
      let prevAssistantText = '';
      let skipped = 0;
      let kept = 0;
      for (const m of rows) {
        const role = m.sender === 'user' ? 'user' : 'assistant';
        const text = (m.voiceContent || m.message || '').trim();
        if (!text) continue;

        // Skip messages that are echoes of the previous assistant turn.
        if (role === 'user' && prevAssistantText) {
          const sim = _overlapSimilarity(text, prevAssistantText);
          if (sim >= 0.5) {
            skipped++;
            continue;
          }
        }

        // Skip messages in an entirely different script than the
        // conversation language — these are almost always artifacts of
        // previous broken sessions and only confuse the LLM.
        if (_isScriptMismatch(text, ctx.language)) {
          skipped++;
          continue;
        }

        ctx.openai.addHistoryMessage(role, text);
        kept++;
        if (role === 'assistant') prevAssistantText = text;
      }
      console.log(
        `[VCv2] 📚 [${ctx.connectionId}] injected ${kept} history msgs` +
        (skipped > 0 ? ` (skipped ${skipped} dirty rows)` : '')
      );
    } catch (e) {
      console.warn(`[VCv2] ⚠️ history inject failed:`, e.message);
    }
  }

  /**
   * Detect the conversation language from chat history in a way that is
   * robust against echo-contaminated rows. Earlier voice sessions (before
   * the server-side echo filter existed) persisted AI-echo as "user"
   * messages — they look like real user text but are actually just the
   * AI's own words. If we naively picked the most recent user message,
   * we'd lock the call into the wrong language.
   *
   * Rules:
   *   - Scan USER messages from newest to oldest, capping at MAX_CONSIDER.
   *   - Skip any user message that overlaps heavily with the immediately
   *     preceding assistant message (it's an echo).
   *   - Count language votes from surviving messages.
   *   - Require at least TWO votes for the same language — a lone
   *     message isn't enough evidence; fall back to client/device lang.
   *   - If zero real user text is found, try the most recent assistant
   *     message whose text isn't a canned idle/goodbye phrase.
   */
  _detectChatLanguage(rows) {
    if (!rows || rows.length === 0) return null;
    const MAX_CONSIDER = 8;
    const votes = {};
    let considered = 0;

    for (let i = rows.length - 1; i >= 0 && considered < MAX_CONSIDER; i--) {
      const m = rows[i];
      if (m.sender !== 'user') continue;
      const txt = (m.voiceContent || m.message || '').trim();
      if (txt.length < 5) continue;

      // Echo guard: compare with the assistant message right before it.
      let prev = null;
      for (let j = i - 1; j >= 0; j--) {
        if (rows[j].sender !== 'user') { prev = rows[j]; break; }
      }
      if (prev) {
        const prevTxt = (prev.voiceContent || prev.message || '').trim();
        if (prevTxt && _overlapSimilarity(txt, prevTxt) >= 0.5) continue;
      }

      const lang = detectLanguage(txt);
      if (!lang) continue;
      votes[lang] = (votes[lang] || 0) + 1;
      considered++;
    }

    let winner = null, max = 0;
    for (const [lang, count] of Object.entries(votes)) {
      if (count > max) { max = count; winner = lang; }
    }
    // Require majority evidence — a single user message might itself be
    // contamination we didn't catch.
    if (max >= 2) return winner;

    return null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Idle check-in: if user stays quiet after AI finishes, gently prompt them
  // ───────────────────────────────────────────────────────────────────────────
  _scheduleIdleCheckin(ctx) {
    this._cancelIdleTimer(ctx);
    if (ctx.closed) return;
    // First silence → long wait (user might just be thinking).
    // After that → shorter wait so the call doesn't feel stuck.
    const waitMs = ctx.checkinCount === 0
      ? IDLE_CHECKIN_FIRST_MS
      : IDLE_CHECKIN_FOLLOWUP_MS;
    ctx.idleTimer = setTimeout(() => {
      ctx.idleTimer = null;
      if (ctx.checkinCount >= MAX_CHECKINS) {
        // Both check-ins went unanswered → say a short goodbye and hang up
        // as soon as the goodbye playback is done on the client.
        this._triggerGoodbyeAndEnd(ctx);
      } else {
        this._triggerIdleCheckin(ctx);
      }
    }, waitMs);
  }

  _cancelIdleTimer(ctx) {
    if (ctx.idleTimer) {
      clearTimeout(ctx.idleTimer);
      ctx.idleTimer = null;
    }
  }

  _triggerIdleCheckin(ctx) {
    if (ctx.closed || ctx.isAISpeaking) return;
    if (!ctx.ws || ctx.ws.readyState !== WebSocket.OPEN) return;
    ctx.checkinCount += 1;
    const lang = ctx.language || ctx.user?.nativeLang || 'tr';
    const kind = ctx.checkinCount === 1 ? 'first' : 'second';
    const text = pickIdlePhrase(lang, kind);
    console.log(`[VCv2] 💬 [${ctx.connectionId}] idle check-in #${ctx.checkinCount}: "${text}"`);
    // Ephemeral voice-call prompt — do NOT persist to chat DB.
    this._speakCanned(ctx, text, { endAfter: false, persist: false });
  }

  /** After MAX_CHECKINS with no reply: speak a short farewell, then hang up
   *  immediately once the audio finishes playing on the client. */
  _triggerGoodbyeAndEnd(ctx) {
    if (ctx.closed || ctx.isAISpeaking) return;
    if (!ctx.ws || ctx.ws.readyState !== WebSocket.OPEN) return;
    const lang = ctx.language || ctx.user?.nativeLang || 'tr';
    const text = pickIdlePhrase(lang, 'goodbye');
    console.log(`[VCv2] 👋 [${ctx.connectionId}] silent too long — goodbye: "${text}"`);
    // Ephemeral voice-call prompt — do NOT persist to chat DB.
    this._speakCanned(ctx, text, { endAfter: true, persist: false });
  }

  /**
   * Speak a fixed piece of text directly through ElevenLabs, bypassing the
   * LLM. Used for deterministic prompts (idle check-ins, goodbye) where we
   * want exact wording and don't need a creative generation.
   *
   * By default these ephemeral voice-call prompts are NOT persisted to the
   * chat DB — users opening the text chat later shouldn't see
   * "I can't hear you" / "bye, take care" polluting their conversation.
   * Set `persist: true` only for substantive AI turns.
   */
  _speakCanned(ctx, text, { endAfter, persist = false } = {}) {
    if (ctx.closed) return;
    if (!ctx.ws || ctx.ws.readyState !== WebSocket.OPEN) return;
    ctx.isAISpeaking = true;
    ctx.aiSpeakingStartedAt = Date.now();
    ctx.endAfterResponse = !!endAfter;
    this._sendJson(ctx.ws, { type: 'ai_speaking_start' });
    // For canned responses we know the full text up-front, so send the
    // viseme timeline immediately (startOffsetMs=0 — no audio played yet).
    const cannedTimeline = _generateVisemeTimeline(text);
    this._sendJson(ctx.ws, { type: 'viseme_timeline', timeline: cannedTimeline, startOffsetMs: 0 });
    this._openTTSSession(ctx);
    try {
      this._ttsSend(ctx, text);
      this._ttsFinish(ctx);
    } catch (e) {
      console.warn('[VCv2] ⚠️ canned speak failed:', e.message);
      ctx.isAISpeaking = false;
      return;
    }
    // Keep OpenAI's in-session history coherent so subsequent LLM turns
    // know what was said, but don't write to the chat DB by default.
    try { ctx.openai?.addHistoryMessage('assistant', text); } catch (_) { }
    if (persist) {
      this._saveAssistantMessage(ctx, text).catch(() => { });
    }
    // Track canned phrases for echo suppression regardless of DB persistence.
    this._rememberAiUtterance(ctx, text);
  }

  /**
   * Track something the AI just said (either LLM-generated or canned) so
   * we can recognize its echo if the mic picks it up in the next few
   * seconds. Entries expire after 15s — long enough to catch echo reverb,
   * short enough that a user legitimately discussing the same topic later
   * doesn't get falsely dropped.
   */
  _rememberAiUtterance(ctx, text) {
    const t = String(text || '').trim();
    if (!t) return;
    const entry = { text: t, until: Date.now() + 15000 };
    ctx.recentAiUtterances = _pruneRecentUtterances(ctx.recentAiUtterances);
    ctx.recentAiUtterances.push(entry);
    // Cap the list length as a safety valve.
    if (ctx.recentAiUtterances.length > 8) {
      ctx.recentAiUtterances.splice(0, ctx.recentAiUtterances.length - 8);
    }
  }

  _hangupDueToSilence(ctx) {
    if (ctx.closed) return;
    this._sendJson(ctx.ws, { type: 'call_ended_idle' });
    try { ctx.ws.close(1000, 'idle timeout'); } catch (_) { }
  }

  async _triggerGreeting(ctx) {
    if (ctx.closed) return;
    const lang = ctx.language || ctx.user?.nativeLang || 'tr';
    const userName = ctx.user?.username || '';

    // Localized coach name (optional, for the "Ben Ayşe — merhaba" variant).
    const names = ctx.consultant?.names || {};
    const coachName =
      names[lang] || names.en ||
      Object.values(names).find((v) => typeof v === 'string') || '';

    // Canned greeting — speaks in ~400ms instead of the ~2s round-trip it
    // takes to go OpenAI → TTS for the first line. Biggest single lever
    // for making the call feel professional rather than amateur.
    const greetingText = pickGreetingPhrase(lang, { userName, coachName });

    console.log(`[VCv2] 👋 [${ctx.connectionId}] canned greeting: "${greetingText}"`);
    this._speakCanned(ctx, greetingText, { endAfter: false, persist: false });
  }

  async _buildSystemPrompt(consultant, user, userId, consultantId, persona, conversationLang = 'tr') {
    // ─── Coach identity ──────────────────────────────────────────────────────
    // Localized name from consultant.names map (e.g. {tr:"...", en:"..."}).
    // Fall back to en, then to the first available value.
    const names = consultant?.names || {};
    const coachName =
      names[conversationLang] ||
      names.en ||
      Object.values(names).find((v) => typeof v === 'string') ||
      'Coach';

    const job = (consultant?.job || '').toString().trim();
    const explanation = (consultant?.explanation || '').toString().trim();
    const features = Array.isArray(consultant?.features)
      ? consultant.features.filter((f) => typeof f === 'string' && f.trim())
      : [];
    const featuresLine = features.length ? features.join(', ') : '';

    const identityBlock =
      `YOU ARE ${coachName}${job ? `, a ${job}` : ''}.\n` +
      `This is your real name and identity. When the user asks "who are you / ` +
      `what is your name / what do you do / what can you help with", answer ` +
      `naturally and specifically as ${coachName}.\n\n` +
      `YOUR SPECIALTY / SCOPE:\n` +
      (job ? `- Role: ${job}\n` : '') +
      (featuresLine ? `- Areas you coach on: ${featuresLine}\n` : '') +
      (explanation ? `- About you: ${explanation}\n` : '');

    // ─── Hard topic boundary ─────────────────────────────────────────────────
    // The coach MUST refuse to act as a generalist. Any off-topic request
    // should be politely redirected back to their specialty.
    const boundaryBlock =
      `\nTOPIC BOUNDARIES (STRICT):\n` +
      `- You ONLY coach within your specialty listed above. Do not give ` +
      `advice, answers, facts, opinions, explanations or examples on ` +
      `unrelated subjects (general trivia, politics, coding, sports ` +
      `results, celebrity gossip, news, homework help, math problems, ` +
      `medical diagnosis outside your scope, etc.).\n` +
      `- If the user asks something outside your scope, briefly acknowledge ` +
      `them in one short sentence and redirect: say clearly that this ` +
      `isn't your area and offer to help with something in your specialty ` +
      `instead. Example tone: "That's not really my area — I'm here for ` +
      `[specialty]. Is there anything on that front I can help with?"\n` +
      `- Never pretend to be a general-purpose assistant. Never answer ` +
      `off-topic questions just because the user insists.\n` +
      `- Do not break character. You are not ChatGPT, not an AI, not a ` +
      `language model — you are ${coachName}, a coach.`;

    // ─── User context ────────────────────────────────────────────────────────
    let profile = '';
    if (user?.username) profile += `\n\nUser's name: ${user.username}`;
    const p = user?.generalProfile || user?.generalPsychologicalProfile;
    if (p) profile += `\nUser profile notes: ${typeof p === 'string' ? p : JSON.stringify(p)}`;

    let appt = '';
    try {
      const a = await AppointmentService.getUpcomingAppointmentByUserId(userId);
      appt = a
        ? `\n\nThe user already has an upcoming appointment (${new Date(a.appointmentDate).toLocaleString('tr-TR')}). Do NOT propose new appointments.`
        : '';
    } catch (_) { }

    // Persona tone block — pushes the LLM toward the right conversational
    // register for this character's field (calm therapist vs. energetic
    // motivation coach, etc.). Paired with matching ElevenLabs voice
    // settings applied at TTS-session open time.
    const toneBlock = persona?.tone
      ? `\n\nSPEAKING STYLE:\n- ${persona.tone}`
      : '';

    // Existing DB-configured prompt (character bio, backstory, etc.) comes
    // AFTER the identity block so it layers on top without overriding
    // the hard scope rules above.
    const base = consultant.mainPrompt || '';
    const baseBlock = base ? `\n\nADDITIONAL CHARACTER NOTES:\n${base}` : '';

    return `${identityBlock}${boundaryBlock}${baseBlock}${profile}${appt}${toneBlock}`;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Persistence
  // ───────────────────────────────────────────────────────────────────────────
  async _ensureChatId(ctx) {
    if (ctx.chatId) return ctx.chatId;
    try {
      const chat = await ChatService.getOrCreateChat(ctx.userId, ctx.consultantId);
      ctx.chatId = chat?.chatId ?? null;
      if (ctx.chatId) {
        console.log(`[VCv2] 🔁 [${ctx.connectionId}] recovered chatId=${ctx.chatId} for persistence`);
      }
    } catch (e) {
      console.warn(`[VCv2] ⚠️ [${ctx.connectionId}] ensure chatId failed:`, e.message);
    }
    return ctx.chatId;
  }

  async _persistWithRetry(task, { label, retries = 3, baseDelayMs = 180 } = {}) {
    let lastErr = null;
    for (let i = 0; i < retries; i++) {
      try {
        await task();
        return true;
      } catch (e) {
        lastErr = e;
        const isLast = i === retries - 1;
        if (!isLast) {
          const waitMs = baseDelayMs * (i + 1);
          await new Promise((r) => setTimeout(r, waitMs));
        }
      }
    }
    console.warn(`[VCv2] ⚠️ persist failed (${label || 'unknown'}):`, lastErr?.message || lastErr);
    return false;
  }

  async _saveUserMessage(ctx, transcript) {
    const chatId = await this._ensureChatId(ctx);
    if (!chatId) return;
    try {
      const now = new Date().toISOString();
      await this._persistWithRetry(
        async () => {
          await MessageRepository.create(
            chatId, ctx.userId, 'user', transcript, now,
            false, null, true, null, null, transcript
          );
          await ChatRepository.updateLastMessage(chatId, transcript, now);
        },
        { label: `user_msg chat=${chatId}` }
      );
    } catch (e) {
      console.warn('[VCv2] ⚠️ save user msg:', e.message);
    }
  }

  async _saveAssistantMessage(ctx, text) {
    const chatId = await this._ensureChatId(ctx);
    if (!chatId) return;
    try {
      const now = new Date().toISOString();
      await this._persistWithRetry(
        async () => {
          await ChatService.createConsultantTextMessage(chatId, ctx.consultantId, text, now);
          await ChatRepository.updateLastMessage(chatId, text, now);
        },
        { label: `assistant_msg chat=${chatId}` }
      );
    } catch (e) {
      console.warn('[VCv2] ⚠️ save assistant msg:', e.message);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Auth
  // ───────────────────────────────────────────────────────────────────────────
  async _authenticate(req) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get('token') || req.headers.authorization?.replace('Bearer ', '');
      if (!token) return { success: false, error: 'No token' };

      let decoded;
      try { decoded = jwt.verify(token, process.env.JWT_SECRET); }
      catch (_) { return { success: false, error: 'Invalid token' }; }

      if (!(await TokenRepository.isValid(token))) return { success: false, error: 'Token revoked' };

      const cid = parseInt(url.searchParams.get('consultantId'), 10);
      if (!cid || cid <= 0) return { success: false, error: 'Invalid consultantId' };

      // Optional device/app language hint from the client (e.g. "en", "de").
      const rawLang = (url.searchParams.get('lang') || '').toLowerCase().trim();
      const clientLang = /^[a-z]{2}$/.test(rawLang) ? rawLang : null;

      return { success: true, userId: decoded.userId, consultantId: cid, clientLang };
    } catch (_) {
      return { success: false, error: 'Auth failed' };
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────
  _sendJson(ws, obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(obj)); } catch (_) { }
    }
  }

  _cleanup(connectionId) {
    const ctx = this.connections.get(connectionId);
    if (!ctx) return;
    ctx.closed = true;
    this._cancelIdleTimer(ctx);
    this._cancelPlaybackDoneFallback(ctx);
    if (ctx.bargeInTimer) { clearTimeout(ctx.bargeInTimer); ctx.bargeInTimer = null; }
    // If the AI was mid-response when the user hung up, persist whatever
    // text we had so the next time they open the chat they see a partial
    // reply rather than a missing turn.
    const pending = (ctx.pendingAssistantText || '').trim();
    if (pending && !ctx.pendingAssistantSaved) {
      ctx.pendingAssistantSaved = true;
      this._saveAssistantMessage(ctx, pending).catch((e) => {
        console.warn(`[VCv2] ⚠️ [${connectionId}] save pending assistant on close:`, e.message);
      });
    }
    try { ctx.tts?.abort(); } catch (_) { }
    try { ctx.openai?.close(); } catch (_) { }
    this.connections.delete(connectionId);
  }
}

module.exports = VoiceChatServerV2;
