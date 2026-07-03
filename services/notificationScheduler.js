/**
 * Notification Scheduler
 * ------------------------------------------------------------------
 * Zamanlanmış (proaktif) bildirimleri yönetir. Harici bağımlılık
 * gerektirmez; setInterval tabanlıdır.
 *
 * İşler:
 *   - Randevu hatırlatma (her 5 dk): seansına ~15 dk kalan kullanıcılar
 *   - Günlük işler (yerel saat NOTIF_DAILY_HOUR, vars. 10:00):
 *       • Re-engagement (3/7/14/30 gün + 30+ haftalık, 60+ durur)
 *       • Abonelik/deneme bitiş hatırlatmaları
 *       • Analiz-testi teşviki (opsiyonel, env ile açılır)
 *       • Suppression/event tablosu temizliği
 *
 * Idempotency: notification_events tablosu ile aynı olay bir kez gönderilir.
 */

'use strict';

const pool = require('../config/database');
const NotificationEngine = require('./notificationEngine');
const NotificationEventRepository = require('../repositories/NotificationEventRepository');
const NotificationSuppressionRepository = require('../repositories/NotificationSuppressionRepository');
const UserRepository = require('../repositories/UserRepository');
const ChatRepository = require('../repositories/ChatRepository');
const ConsultantRepository = require('../repositories/ConsultantRepository');

const TZ = process.env.NOTIF_TIMEZONE || 'Europe/Istanbul';
const DAILY_HOUR = parseInt(process.env.NOTIF_DAILY_HOUR, 10) || 10;
const ANALYSIS_LAUNCH_ENABLED = process.env.NOTIF_ANALYSIS_ENABLED === 'true';

class NotificationScheduler {
  static start() {
    if (this._started) return;
    this._started = true;
    this._lastDailyKey = null;

    // Randevu hatırlatmaları: her 5 dakika
    this._apptTimer = setInterval(() => {
      this.runAppointmentReminders().catch(e => console.error('[SCHED] appt error:', e.message));
    }, 5 * 60 * 1000);

    // Günlük işler için dakikalık tetik kontrolü
    this._dailyTimer = setInterval(() => {
      this._maybeRunDaily().catch(e => console.error('[SCHED] daily error:', e.message));
    }, 60 * 1000);

    console.log(`✅ [SCHED] Bildirim zamanlayıcı başladı (TZ=${TZ}, günlük saat=${DAILY_HOUR})`);
  }

  static stop() {
    if (this._apptTimer) clearInterval(this._apptTimer);
    if (this._dailyTimer) clearInterval(this._dailyTimer);
    this._started = false;
  }

  // ------------------------------------------------------------------
  // Yerel saat yardımcıları
  // ------------------------------------------------------------------
  static _localParts() {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
    return {
      dateKey: `${parts.year}-${parts.month}-${parts.day}`,
      hour: parseInt(parts.hour, 10) % 24,
    };
  }

  static async _maybeRunDaily() {
    const { dateKey, hour } = this._localParts();
    if (hour !== DAILY_HOUR) return;
    if (this._lastDailyKey === dateKey) return; // bugün zaten çalıştı
    this._lastDailyKey = dateKey;
    console.log(`🗓️ [SCHED] Günlük bildirim işleri çalışıyor (${dateKey})`);
    await this.runDailyJobs(dateKey);
  }

  static async runDailyJobs(dateKey) {
    await this.runReengagement(dateKey).catch(e => console.error('[SCHED] reengage:', e.message));
    await this.runSubscriptionReminders(dateKey).catch(e => console.error('[SCHED] subscription:', e.message));
    if (ANALYSIS_LAUNCH_ENABLED) {
      await this.runAnalysisNudges(dateKey).catch(e => console.error('[SCHED] analysis:', e.message));
    }
    await this.runCleanup().catch(e => console.error('[SCHED] cleanup:', e.message));
  }

  // ------------------------------------------------------------------
  // Re-engagement (sadece inaktif kullanıcı — engine ayrıca doğrular)
  // ------------------------------------------------------------------
  static async runReengagement(dateKey) {
    // Kademeli: 3 / 7 / 14 / 30 gün
    const stageMap = { 3: 'reengage_3d', 7: 'reengage_7d', 14: 'reengage_14d', 30: 'reengage_30d' };
    for (const [daysStr, trigger] of Object.entries(stageMap)) {
      const days = parseInt(daysStr, 10);
      const userIds = await UserRepository.findUserIdsInactiveExactlyDaysAgo(days);
      for (const uid of userIds) {
        const claimed = await NotificationEventRepository.claim(uid, `${trigger}:${dateKey}`);
        if (!claimed) continue;
        let params = {};
        if (trigger === 'reengage_3d') {
          params.consultant = await this._lastConsultantForUser(uid);
        }
        await NotificationEngine.sendTrigger(uid, trigger, params, { isUserActive: false });
      }
    }

    // 30+ gün: haftada 1 (37, 44, 51, 58). 60+ gün: tamamen durur.
    for (const days of [37, 44, 51, 58]) {
      const userIds = await UserRepository.findUserIdsInactiveExactlyDaysAgo(days);
      for (const uid of userIds) {
        const claimed = await NotificationEventRepository.claim(uid, `reengage_weekly:${dateKey}`);
        if (!claimed) continue;
        await NotificationEngine.sendTrigger(uid, 'reengage_30d', {}, { isUserActive: false });
      }
    }
  }

  static async _lastConsultantForUser(userId) {
    try {
      const chats = await ChatRepository.findByUserId(userId, { limit: 1, offset: 0 });
      if (!chats || chats.length === 0) return null;
      const consultantId = chats[0].consultantId;
      if (!consultantId) return null;
      return await ConsultantRepository.findById(consultantId);
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Abonelik / deneme hatırlatmaları
  // ------------------------------------------------------------------
  static async runSubscriptionReminders(dateKey) {
    // Deneme bitmesine 2 gün kala
    const trialRows = await this._premiumExpiringInDays(2, { onlyTrial: true });
    for (const row of trialRows) {
      const claimed = await NotificationEventRepository.claim(row.user_id, `trial_ending:${dateKey}`);
      if (!claimed) continue;
      await NotificationEngine.sendTrigger(row.user_id, 'trial_ending', {});
    }

    // Aylık plan yenilemesine 3 gün kala
    const monthlyRows = await this._premiumExpiringInDays(3, { onlyTrial: false });
    for (const row of monthlyRows) {
      if (!this._isMonthlyPlan(row)) continue;
      const claimed = await NotificationEventRepository.claim(row.user_id, `monthly_renewal:${dateKey}`);
      if (!claimed) continue;
      await NotificationEngine.sendTrigger(row.user_id, 'monthly_renewal', {
        dateText: this._formatDate(row.expiry_date),
      });
    }

    // Yıllık plan yenilemesine 7 gün kala
    const yearlyRows = await this._premiumExpiringInDays(7, { onlyTrial: false });
    for (const row of yearlyRows) {
      if (this._isMonthlyPlan(row)) continue;
      const claimed = await NotificationEventRepository.claim(row.user_id, `yearly_renewal:${dateKey}`);
      if (!claimed) continue;
      await NotificationEngine.sendTrigger(row.user_id, 'yearly_renewal', {
        dateText: this._formatDate(row.expiry_date),
      });
    }
  }

  static async _premiumExpiringInDays(daysAhead, { onlyTrial }) {
    try {
      const [rows] = await pool.execute(
        `SELECT user_id, plan_id, is_trial, expiry_date, purchased_date
           FROM premium_devices
          WHERE is_premium = 1
            AND user_id IS NOT NULL
            AND is_trial = ?
            AND DATE(expiry_date) = DATE(DATE_ADD(NOW(), INTERVAL ? DAY))`,
        [onlyTrial ? 1 : 0, daysAhead]
      );
      return rows;
    } catch (e) {
      console.error('[SCHED] premium expiring query error:', e.message);
      return [];
    }
  }

  // Aylık mı yıllık mı? purchased_date ↔ expiry_date farkı ≤ 45 gün → aylık
  static _isMonthlyPlan(row) {
    if (!row.purchased_date || !row.expiry_date) return false;
    const diffDays = (new Date(row.expiry_date) - new Date(row.purchased_date)) / (24 * 60 * 60 * 1000);
    return diffDays <= 45;
  }

  static _formatDate(d) {
    try {
      return new Intl.DateTimeFormat('tr-TR', {
        timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric',
      }).format(new Date(d));
    } catch (e) {
      return '';
    }
  }

  // ------------------------------------------------------------------
  // Analiz-testi teşviki (opsiyonel; env NOTIF_ANALYSIS_ENABLED=true)
  // ------------------------------------------------------------------
  static async runAnalysisNudges(dateKey) {
    // NOT: "kullanıcı testi hiç yapmadı mı" verisi backend'de net değil.
    // Yanlış hedeflemeyi önlemek için varsayılan KAPALIDIR. Test tamamlama
    // kaydı eklendiğinde buraya koşul yazılmalı. Şimdilik güvenli no-op.
    console.log('[SCHED] analysis nudge çalıştı (koşul verisi bekleniyor, gönderim yapılmadı)');
  }

  // ------------------------------------------------------------------
  // Randevu hatırlatma (~15 dk kala)
  // ------------------------------------------------------------------
  static async runAppointmentReminders() {
    let rows;
    try {
      const [result] = await pool.execute(
        `SELECT id, user_id, consultant_id, appointment_date
           FROM appointments
          WHERE status NOT IN ('cancelled', 'completed')
            AND appointment_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 20 MINUTE)`
      );
      rows = result;
    } catch (e) {
      console.error('[SCHED] appointment query error:', e.message);
      return;
    }

    for (const row of rows) {
      const claimed = await NotificationEventRepository.claim(row.user_id, `appt_reminder_${row.id}`);
      if (!claimed) continue;
      let consultant = null;
      try {
        consultant = await ConsultantRepository.findById(row.consultant_id);
      } catch (e) { /* isim olmadan da gönderilebilir */ }
      await NotificationEngine.sendTrigger(row.user_id, 'session_reminder', {
        consultant,
        sessionId: row.id,
      });
    }
  }

  // ------------------------------------------------------------------
  // Bakım / temizlik
  // ------------------------------------------------------------------
  static async runCleanup() {
    const s = await NotificationSuppressionRepository.cleanupExpired();
    const e = await NotificationEventRepository.cleanupOlderThan(120);
    if (s || e) console.log(`🧹 [SCHED] Temizlik: ${s} suppression, ${e} event silindi`);
  }
}

module.exports = NotificationScheduler;
