/**
 * Notification Catalog
 * ------------------------------------------------------------------
 * MindCoach Bildirim Sistemi Spesifikasyonu'nun merkezi tanımı.
 * Tüm kategori politikaları, frequency-cap kuralları, sessiz-saat
 * davranışları ve kullanıcıya gösterilecek metin şablonları burada.
 *
 * Metin ilkesi: Re-engagement ve hatırlatma metinleri asla suçlayıcı
 * veya kaygı tetikleyici değildir; nazik ve destekleyicidir.
 * Analiz metinleri tanı/teşhis iması taşımaz ("test/analiz/keşfet").
 */

'use strict';

const { getLocalizedTexts, defaultCoachName, normalizeLang } = require('./notificationI18n');

// --- Kategoriler --------------------------------------------------------------
const CATEGORY = {
  REALTIME: 'realtime',
  THERAPY: 'therapy',
  ANALYSIS: 'analysis',
  REENGAGEMENT: 'reengagement',
  SUBSCRIPTION: 'subscription',
  SYSTEM: 'system',
};

// notification_preferences tablosundaki opt-out kolonu ile eşleme
const CATEGORY_PREF_COLUMN = {
  [CATEGORY.REALTIME]: 'realtime_enabled',
  [CATEGORY.THERAPY]: 'therapy_enabled',
  [CATEGORY.ANALYSIS]: 'analysis_enabled',
  [CATEGORY.REENGAGEMENT]: 'reengagement_enabled',
  [CATEGORY.SUBSCRIPTION]: 'subscription_enabled',
  [CATEGORY.SYSTEM]: 'system_enabled',
};

/**
 * Kategori politikaları (Spec §8 Özet Tablo).
 *
 * dailyLimit           : Kategori için günlük gönderim üst sınırı (null = sınırsız)
 * sendToActiveUser     : Son 24 saatte uygulamayı açmış kullanıcıya gönderilir mi
 * quietHours           : Sessiz saatte (varsayılan 22:00-08:00) davranış
 *                        'always'             → gönderilir (kısıt yok)
 *                        'blocked'            → hiç gönderilmez
 *                        'user_initiated_only'→ sadece kullanıcı kaynaklı olaylar (payload.userInitiated)
 *                        'critical_only'      → sadece kritik olaylar (payload.critical)
 * optOutable           : Kullanıcı bu kategoriyi kapatabilir mi (Spec: hepsi opt-out edilebilir,
 *                        ancak güvenlik/hesap kritikleri her zaman gider)
 * bypassSuppression    : Kriz-suppression flag'i sırasında bile gönderilebilir mi
 */
const CATEGORY_POLICY = {
  [CATEGORY.REALTIME]: {
    dailyLimit: null,
    sendToActiveUser: true,
    quietHours: 'user_initiated_only',
    optOutable: true,
    bypassSuppression: true, // Realtime (mesaj/görüşme/seans) kriz filtresinden muaf
  },
  [CATEGORY.THERAPY]: {
    dailyLimit: 1,
    sendToActiveUser: true,
    quietHours: 'blocked',
    optOutable: true,
    bypassSuppression: false,
  },
  [CATEGORY.ANALYSIS]: {
    dailyLimit: 1,
    sendToActiveUser: true,
    quietHours: 'blocked',
    optOutable: true,
    bypassSuppression: false,
  },
  [CATEGORY.REENGAGEMENT]: {
    dailyLimit: null, // scheduler zaten kademeli tetikliyor
    sendToActiveUser: false, // sadece inaktif kullanıcı
    quietHours: 'blocked',
    optOutable: true,
    bypassSuppression: false, // kriz sonrası 48s pazarlama yasak
  },
  [CATEGORY.SUBSCRIPTION]: {
    dailyLimit: null, // event-based
    sendToActiveUser: true,
    quietHours: 'blocked',
    optOutable: true,
    bypassSuppression: true, // ödeme/abonelik bilgisi kritik sayılır
  },
  [CATEGORY.SYSTEM]: {
    dailyLimit: null, // event-based
    sendToActiveUser: true,
    quietHours: 'critical_only',
    optOutable: true,
    bypassSuppression: true, // güvenlik/hesap bildirimleri her zaman
  },
};

// Kullanıcı opt-out etse bile gönderilmesi gereken (yasal/güvenlik) tetikleyiciler
const NON_OPTOUTABLE_TRIGGERS = new Set([
  'new_device_login',
  'payment_failed',
  'privacy_update',
  'verify',
]);

/**
 * Terapist adını çok dilli JSON'dan güvenli çeker.
 */
function consultantName(consultant, lang = 'en') {
  if (!consultant) return defaultCoachName(lang);
  const l = normalizeLang(lang);
  const n = consultant.names || {};
  return n[l] || n.en || n.tr || n.de || defaultCoachName(l);
}

function previewText(text, max = 40) {
  if (!text) return '';
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Bildirim şablonları.
 * Her şablon (params) => { category, type, trigger, title, subtitle, deepLink,
 *                          userInitiated?, critical? }
 * trigger: frequency-cap ve event idempotency anahtarı olarak da kullanılır.
 */
const TEMPLATES = {
  // ---- Kategori 1: REALTIME ----
  therapist_message: ({ consultant, messagePreview }) => ({
    category: CATEGORY.REALTIME,
    type: 'chat_message',
    trigger: 'therapist_message',
    title: `💬 ${consultantName(consultant)}`,
    subtitle: `"${previewText(messagePreview, 40)}"`,
    deepLink: `chat/${consultant?.id}`,
  }),
  incoming_voice_call: ({ consultant, lang = 'en' }) => {
    const name = consultantName(consultant, lang);
    const texts = getLocalizedTexts('incoming_voice_call', lang, { name });
    return {
      category: CATEGORY.REALTIME,
      type: 'incoming_call',
      trigger: 'incoming_voice_call',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: `call/incoming/${consultant?.id}`,
      userInitiated: false,
    };
  },
  incoming_video_call: ({ consultant, lang = 'en' }) => {
    const name = consultantName(consultant, lang);
    const texts = getLocalizedTexts('incoming_video_call', lang, { name });
    return {
      category: CATEGORY.REALTIME,
      type: 'incoming_video_call',
      trigger: 'incoming_video_call',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: `videocall/incoming/${consultant?.id}`,
      userInitiated: false,
    };
  },
  session_reminder: ({ consultant, sessionId, lang = 'en' }) => {
    const name = consultantName(consultant, lang);
    const texts = getLocalizedTexts('session_reminder', lang, { name });
    return {
      category: CATEGORY.REALTIME,
      type: 'session_reminder',
      trigger: 'session_reminder',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: `session/${sessionId}`,
      userInitiated: true, // kullanıcının kendi planladığı seans → gece de gönderilebilir
    };
  },

  // ---- Kategori 2: TERAPİ / KARAKTER ETKİLEŞİMİ ----
  onboarding_no_selection: ({ lang = 'en' } = {}) => {
    const texts = getLocalizedTexts('onboarding_no_selection', lang, {});
    return {
      category: CATEGORY.THERAPY,
      type: 'therapy_suggestion',
      trigger: 'onboarding_no_selection',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: 'therapists/browse',
    };
  },
  continue_therapy: ({ consultant, lang = 'en' }) => {
    const name = consultantName(consultant, lang);
    return {
      category: CATEGORY.THERAPY,
      type: 'therapy_continue',
      trigger: 'continue_therapy',
      title: name,
      subtitle: getLocalizedTexts('coach_idle_24h', lang, { name }).subtitle,
      deepLink: consultant?.id ? `chat/${consultant.id}` : 'therapists/browse',
    };
  },
  /** Hocayla 24 saat konuşulmadı */
  coach_idle_24h: ({ consultant, lang = 'en' }) => {
    const name = consultantName(consultant, lang);
    const texts = getLocalizedTexts('coach_idle_24h', lang, { name });
    return {
      category: CATEGORY.THERAPY,
      type: 'therapy_continue',
      trigger: 'coach_idle_24h',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: consultant?.id ? `chat/${consultant.id}` : 'home',
    };
  },
  /** Hocayla 3 gün konuşulmadı */
  coach_idle_3d: ({ consultant, lang = 'en' }) => {
    const name = consultantName(consultant, lang);
    const texts = getLocalizedTexts('coach_idle_3d', lang, { name });
    return {
      category: CATEGORY.THERAPY,
      type: 'therapy_continue',
      trigger: 'coach_idle_3d',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: consultant?.id ? `chat/${consultant.id}` : 'home',
    };
  },
  new_category: ({ categoryName, categoryId, lang = 'en' }) => {
    const texts = getLocalizedTexts('new_category', lang, { categoryName });
    return {
      category: CATEGORY.THERAPY,
      type: 'therapy_new_category',
      trigger: 'new_category',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: `therapists/category/${categoryId}`,
    };
  },

  // ---- Kategori 3: PSİKOLOJİK ANALİZ TESTİ ----
  analysis_launch: ({ lang = 'en' } = {}) => {
    const texts = getLocalizedTexts('analysis_launch', lang, {});
    return {
      category: CATEGORY.ANALYSIS,
      type: 'analysis_launch',
      trigger: 'analysis_launch',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: 'analysis-test/intro',
    };
  },
  analysis_never_taken: ({ lang = 'en' } = {}) => {
    const texts = getLocalizedTexts('analysis_never_taken', lang, {});
    return {
      category: CATEGORY.ANALYSIS,
      type: 'analysis_invite',
      trigger: 'analysis_never_taken',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: 'analysis-test/start',
    };
  },
  analysis_result_ready: ({ resultId, lang = 'en' }) => {
    const texts = getLocalizedTexts('analysis_result_ready', lang, {});
    return {
      category: CATEGORY.ANALYSIS,
      type: 'analysis_result',
      trigger: 'analysis_result_ready',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: `analysis-test/results/${resultId}`,
    };
  },
  analysis_periodic_retest: ({ lang = 'en' } = {}) => {
    const texts = getLocalizedTexts('analysis_periodic_retest', lang, {});
    return {
      category: CATEGORY.ANALYSIS,
      type: 'analysis_retest',
      trigger: 'analysis_periodic_retest',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: 'analysis-test/start',
    };
  },

  // ---- Kategori 4: RE-ENGAGEMENT (nazik, suçlayıcı değil) ----
  reengage_3d: ({ consultant, lang = 'en' }) => {
    const name = consultantName(consultant, lang);
    const texts = getLocalizedTexts('reengage_3d', lang, { name });
    return {
      category: CATEGORY.REENGAGEMENT,
      type: 'reengagement',
      trigger: 'reengage_3d',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: consultant?.id ? `chat/${consultant.id}` : 'home',
    };
  },
  reengage_7d: ({ consultant, lang = 'en' }) => {
    const texts = getLocalizedTexts('app_idle_7d', lang, {
      name: consultantName(consultant, lang),
    });
    return {
      category: CATEGORY.REENGAGEMENT,
      type: 'reengagement',
      trigger: 'reengage_7d',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: consultant?.id ? `chat/${consultant.id}` : 'home',
    };
  },
  reengage_10d: ({ lang = 'en' }) => {
    const texts = getLocalizedTexts('app_idle_10d', lang, {});
    return {
      category: CATEGORY.REENGAGEMENT,
      type: 'reengagement',
      trigger: 'reengage_10d',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: 'home',
    };
  },
  reengage_14d: ({ lang = 'en' } = {}) => {
    const texts = getLocalizedTexts('reengage_14d', lang, {});
    return {
      category: CATEGORY.REENGAGEMENT,
      type: 'reengagement',
      trigger: 'reengage_14d',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: 'home',
    };
  },
  reengage_30d: ({ lang = 'en' } = {}) => {
    const texts = getLocalizedTexts('reengage_30d', lang, {});
    return {
      category: CATEGORY.REENGAGEMENT,
      type: 'reengagement',
      trigger: 'reengage_30d',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: 'home',
    };
  },

  // ---- Kategori 5: ABONELİK / PLAN (nötr, net) ----
  trial_ending: ({ lang = 'en' } = {}) => {
    const texts = getLocalizedTexts('trial_ending', lang, {});
    return {
      category: CATEGORY.SUBSCRIPTION,
      type: 'subscription',
      trigger: 'trial_ending',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: 'settings/subscription',
    };
  },
  monthly_renewal: ({ dateText, lang = 'en' }) => {
    const texts = getLocalizedTexts('monthly_renewal', lang, { dateText });
    return {
      category: CATEGORY.SUBSCRIPTION,
      type: 'subscription',
      trigger: 'monthly_renewal',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: 'settings/subscription',
    };
  },
  yearly_renewal: ({ dateText, lang = 'en' }) => {
    const texts = getLocalizedTexts('yearly_renewal', lang, { dateText });
    return {
      category: CATEGORY.SUBSCRIPTION,
      type: 'subscription',
      trigger: 'yearly_renewal',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: 'settings/subscription',
    };
  },
  payment_failed: ({ lang = 'en' } = {}) => {
    const texts = getLocalizedTexts('payment_failed', lang, {});
    return {
      category: CATEGORY.SUBSCRIPTION,
      type: 'subscription',
      trigger: 'payment_failed',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: 'settings/payment',
      critical: true,
    };
  },
  upgrade_offer: ({ lang = 'en' } = {}) => {
    const texts = getLocalizedTexts('upgrade_offer', lang, {});
    return {
      category: CATEGORY.SUBSCRIPTION,
      type: 'subscription',
      trigger: 'upgrade_offer',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: 'settings/plans',
    };
  },

  // ---- Kategori 6: SİSTEM / HESAP ----
  welcome: ({ username, lang = 'en' }) => {
    const texts = getLocalizedTexts('welcome', lang, { username: username || '' });
    return {
      category: CATEGORY.SYSTEM,
      type: 'welcome',
      trigger: 'welcome',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: 'home',
    };
  },
  new_device_login: ({ lang = 'en' } = {}) => {
    const texts = getLocalizedTexts('new_device_login', lang, {});
    return {
      category: CATEGORY.SYSTEM,
      type: 'security',
      trigger: 'new_device_login',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: 'settings/security',
      critical: true,
    };
  },
  verify: ({ lang = 'en' } = {}) => {
    const texts = getLocalizedTexts('verify', lang, {});
    return {
      category: CATEGORY.SYSTEM,
      type: 'account',
      trigger: 'verify',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: 'verify',
      critical: true,
    };
  },
  privacy_update: ({ lang = 'en' } = {}) => {
    const texts = getLocalizedTexts('privacy_update', lang, {});
    return {
      category: CATEGORY.SYSTEM,
      type: 'account',
      trigger: 'privacy_update',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: 'settings/privacy',
    };
  },
  // Kriz sonrası izin verilen TEK nötr/destekleyici kaynak bildirimi (Spec §1 Kriz duyarlılığı)
  crisis_resource: ({ lang = 'en' } = {}) => {
    const texts = getLocalizedTexts('crisis_resource', lang, {});
    return {
      category: CATEGORY.SYSTEM,
      type: 'support_resource',
      trigger: 'crisis_resource',
      title: texts.title,
      subtitle: texts.subtitle,
      deepLink: 'home',
      critical: true,
    };
  },
};

/**
 * Bir tetikleyici (trigger) için hazır bildirim yükü üretir.
 * @param {string} triggerKey - TEMPLATES anahtarı
 * @param {Object} params - şablona geçilecek parametreler
 * @returns {Object|null}
 */
function buildNotification(triggerKey, params = {}) {
  const tpl = TEMPLATES[triggerKey];
  if (!tpl) return null;
  return tpl(params);
}

module.exports = {
  CATEGORY,
  CATEGORY_PREF_COLUMN,
  CATEGORY_POLICY,
  NON_OPTOUTABLE_TRIGGERS,
  TEMPLATES,
  buildNotification,
  consultantName,
  previewText,
};
