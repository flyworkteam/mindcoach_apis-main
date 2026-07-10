/**
 * Notification i18n — 12 dil desteği
 * Uygulama dilleri: en, tr, de, es, fr, hi, it, ja, ko, pt, ru, zh
 */

'use strict';

const SUPPORTED_LANGS = ['en', 'tr', 'de', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt', 'ru', 'zh'];

const COPY = {
  defaults: {
    coachName: {
      en: 'Your coach', tr: 'Koçun', de: 'Dein Coach', es: 'Tu coach', fr: 'Ton coach',
      hi: 'आपका कोच', it: 'Il tuo coach', ja: 'あなたのコーチ', ko: '당신의 코치',
      pt: 'Seu coach', ru: 'Ваш коуч', zh: '你的教练',
    },
  },
  coach_idle_24h: {
    title: { en: '{name}', tr: '{name}', de: '{name}', es: '{name}', fr: '{name}', hi: '{name}', it: '{name}', ja: '{name}', ko: '{name}', pt: '{name}', ru: '{name}', zh: '{name}' },
    subtitle: {
      en: 'Hi, are you feeling better today?',
      tr: 'Merhaba, bugün daha iyi misin?',
      de: 'Hallo, geht es dir heute besser?',
      es: 'Hola, ¿te sientes mejor hoy?',
      fr: "Salut, tu te sens mieux aujourd'hui ?",
      hi: 'नमस्ते, क्या आज आप बेहतर महसूस कर रहे हैं?',
      it: 'Ciao, ti senti meglio oggi?',
      ja: 'こんにちは、今日は少し良くなりましたか？',
      ko: '안녕하세요, 오늘은 좀 나아지셨나요?',
      pt: 'Olá, você está se sentindo melhor hoje?',
      ru: 'Привет, сегодня тебе лучше?',
      zh: '你好，今天感觉好些了吗？',
    },
  },
  coach_idle_3d: {
    title: { en: '{name}', tr: '{name}', de: '{name}', es: '{name}', fr: '{name}', hi: '{name}', it: '{name}', ja: '{name}', ko: '{name}', pt: '{name}', ru: '{name}', zh: '{name}' },
    subtitle: {
      en: "Hi, I haven't heard from you in 3 days. How are you? Would you like to chat and unwind a little?",
      tr: 'Merhaba, 3 gündür senden haber alamıyorum. Nasıl gidiyor? Biraz konuşup rahatlamak ister misin?',
      de: 'Hallo, seit 3 Tagen habe ich nichts von dir gehört. Wie geht es dir? Möchtest du ein bisschen reden und abschalten?',
      es: 'Hola, hace 3 días que no sé de ti. ¿Cómo estás? ¿Te apetece charlar un poco y relajarte?',
      fr: "Salut, ça fait 3 jours sans nouvelles. Comment ça va ? Envie de discuter un peu pour te détendre ?",
      hi: 'नमस्ते, 3 दिन से आपकी कोई खबर नहीं मिली। कैसे हैं? थोड़ी बात करके आराम करना चाहेंगे?',
      it: 'Ciao, non ho tue notizie da 3 giorni. Come stai? Vuoi chiacchierare un po\' per rilassarti?',
      ja: 'こんにちは、3日間ご連絡がありません。お元気ですか？少し話して気分を落ち着かせませんか？',
      ko: '안녕하세요, 3일째 연락이 없어요. 어떻게 지내세요? 잠깐 이야기하며 마음을 풀어볼까요?',
      pt: 'Olá, faz 3 dias que não tenho notícias suas. Como você está? Quer conversar um pouco e relaxar?',
      ru: 'Привет, 3 дня нет от тебя вестей. Как дела? Хочешь немного поговорить и расслабиться?',
      zh: '你好，已经3天没收到你的消息了。最近怎么样？想聊聊放松一下吗？',
    },
  },
  app_idle_7d: {
    title: {
      en: 'Session reminder', tr: 'Seans hatırlatması', de: 'Sitzungserinnerung', es: 'Recordatorio de sesión',
      fr: 'Rappel de séance', hi: 'सेशन अनुस्मारक', it: 'Promemoria sessione', ja: 'セッションのリマインダー',
      ko: '세션 알림', pt: 'Lembrete de sessão', ru: 'Напоминание о сессии', zh: '会话提醒',
    },
    subtitle: {
      en: "Don't forget our session this week — we're here when you're ready.",
      tr: 'Bu hafta seansımızı unutma — hazır olduğunda buradayız.',
      de: 'Vergiss unsere Sitzung diese Woche nicht — wir sind da, wenn du bereit bist.',
      es: 'No olvides nuestra sesión esta semana — estamos aquí cuando estés listo.',
      fr: "N'oublie pas notre séance cette semaine — nous sommes là quand tu es prêt.",
      hi: 'इस हफ्ते हमारा सेशन मत भूलिए — जब आप तैयार हों, हम यहाँ हैं।',
      it: 'Non dimenticare la nostra sessione questa settimana — siamo qui quando sei pronto.',
      ja: '今週のセッションを忘れないで — 準備ができたらここにいます。',
      ko: '이번 주 세션 잊지 마세요 — 준비되면 여기 있을게요.',
      pt: 'Não esqueça nossa sessão esta semana — estamos aqui quando você estiver pronto.',
      ru: 'Не забудь о нашей сессии на этой неделе — мы рядом, когда будешь готов.',
      zh: '别忘了这周我们的会话——你准备好了我们就在这里。',
    },
  },
  app_idle_10d: {
    title: {
      en: 'Everything okay?', tr: 'Her şey yolunda mı?', de: 'Alles in Ordnung?', es: '¿Todo bien?',
      fr: 'Tout va bien ?', hi: 'सब ठीक है?', it: 'Tutto bene?', ja: '大丈夫ですか？',
      ko: '괜찮으신가요?', pt: 'Está tudo bem?', ru: 'Всё в порядке?', zh: '一切都好吗？',
    },
    subtitle: {
      en: 'We noticed you have not been around for a while. Is there a problem with the app?',
      tr: 'Bir süredir görünmüyorsun. Uygulamada bir sorun mu var?',
      de: 'Wir haben bemerkt, dass du eine Weile weg warst. Gibt es ein Problem mit der App?',
      es: 'Notamos que hace tiempo que no entras. ¿Hay algún problema con la app?',
      fr: "Nous avons remarqué que tu n'es pas venu depuis un moment. Y a-t-il un problème avec l'application ?",
      hi: 'कुछ समय से आप नहीं दिखे। क्या ऐप में कोई समस्या है?',
      it: "Ci siamo accorti che non ti vediamo da un po'. C'è un problema con l'app?",
      ja: 'しばらくお見かけしません。アプリに問題がありますか？',
      ko: '한동안 접속이 없으셨어요. 앱에 문제가 있나요?',
      pt: 'Percebemos que você não aparece há um tempo. Há algum problema com o app?',
      ru: 'Мы заметили, что тебя давно не было. Есть проблема с приложением?',
      zh: '我们注意到你有一段时间没来了。应用有什么问题吗？',
    },
  },
};

function normalizeLang(code) {
  if (!code || typeof code !== 'string') return 'tr';
  const base = code.toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LANGS.includes(base) ? base : 'tr';
}

function interpolate(template, vars = {}) {
  if (!template) return '';
  return String(template).replace(/\{(\w+)\}/g, (_, key) => {
    const v = vars[key];
    return v == null ? '' : String(v);
  });
}

/**
 * @param {string} triggerKey - coach_idle_24h | coach_idle_3d | app_idle_7d | app_idle_10d
 * @param {string} lang
 * @param {Object} vars - { name }
 */
function getLocalizedTexts(triggerKey, lang, vars = {}) {
  const l = normalizeLang(lang);
  const block = COPY[triggerKey];
  if (!block) return { title: 'MindCoach', subtitle: '' };
  const titleTpl = (block.title && (block.title[l] || block.title.en)) || 'MindCoach';
  const subtitleTpl = (block.subtitle && (block.subtitle[l] || block.subtitle.en)) || '';
  return {
    title: interpolate(titleTpl, vars),
    subtitle: interpolate(subtitleTpl, vars),
  };
}

function defaultCoachName(lang) {
  const l = normalizeLang(lang);
  return COPY.defaults.coachName[l] || COPY.defaults.coachName.en;
}

module.exports = {
  SUPPORTED_LANGS,
  normalizeLang,
  getLocalizedTexts,
  defaultCoachName,
};
