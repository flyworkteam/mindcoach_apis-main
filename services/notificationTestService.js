/**
 * GEÇİCİ TEST SERVİSİ — production'da NOTIF_TEST_SEQUENCE=false yapın veya silin.
 * Hot-restart / manuel test için tüm yeni bildirim tiplerini sırayla gönderir.
 */

'use strict';

const NotificationEngine = require('./notificationEngine');
const ConsultantRepository = require('../repositories/ConsultantRepository');
const ChatRepository = require('../repositories/ChatRepository');
const UserRepository = require('../repositories/UserRepository');
const { normalizeLang } = require('../config/notificationI18n');

const ENABLED = process.env.NOTIF_TEST_SEQUENCE !== 'false';
const STEP_MS = parseInt(process.env.NOTIF_TEST_STEP_MS, 10) || 6000;

const SEQUENCE = [
  'coach_idle_24h',
  'coach_idle_3d',
  'reengage_7d',
  'reengage_10d',
];

class NotificationTestService {
  static isEnabled() {
    return ENABLED;
  }

  static async runSequenceForUser(userId, clientLang) {
    if (!ENABLED) {
      return { started: false, reason: 'disabled' };
    }

    const user = await UserRepository.findById(userId);
    if (!user) return { started: false, reason: 'user_not_found' };

    const lang = normalizeLang(clientLang || user.nativeLang);
    let consultant = null;
    try {
      const chats = await ChatRepository.findByUserId(userId, { limit: 1, offset: 0 });
      if (chats && chats.length > 0 && chats[0].consultantId) {
        consultant = await ConsultantRepository.findById(chats[0].consultantId);
      }
    } catch (e) { /* demo without consultant */ }

    // Arka planda sırayla gönder (istek hemen döner)
    setImmediate(() => {
      this._dispatchSteps(userId, lang, consultant).catch(err => {
        console.error('[NOTIF-TEST] sequence error:', err.message);
      });
    });

    return {
      started: true,
      steps: SEQUENCE.length,
      stepDelayMs: STEP_MS,
      lang,
    };
  }

  static async _dispatchSteps(userId, lang, consultant) {
    console.log(`[NOTIF-TEST] 🧪 Sıra başlıyor user=${userId} lang=${lang}`);
    for (let i = 0; i < SEQUENCE.length; i++) {
      const trigger = SEQUENCE[i];
      if (i > 0) {
        await new Promise(r => setTimeout(r, STEP_MS));
      }
      const result = await NotificationEngine.sendTrigger(
        userId,
        trigger,
        { consultant, lang },
        { force: true, skipQuietHours: true, isUserActive: false }
      );
      console.log(`[NOTIF-TEST] step ${i + 1}/${SEQUENCE.length} trigger=${trigger} sent=${result.sent}`);
    }
    console.log(`[NOTIF-TEST] ✅ Sıra tamamlandı user=${userId}`);
  }
}

module.exports = NotificationTestService;
