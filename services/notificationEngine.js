/**
 * Notification Engine
 * ------------------------------------------------------------------
 * MindCoach bildirim sisteminin merkezî karar ve gönderim katmanı.
 * Spesifikasyon §9 kontrol sırasını uygular:
 *   (1) izin  → (2) kategori opt-out → (3) frequency cap →
 *   (4) sessiz saat → (5) foreground suppression → (6) kriz-duyarlılık
 *
 * Tüm uygulama içi bildirim gönderimleri bu servis üzerinden yapılmalıdır.
 */

'use strict';

const OneSignalService = require('./oneSignalService');
const NotificationRepository = require('../repositories/NotificationRepository');
const NotificationPreferenceRepository = require('../repositories/NotificationPreferenceRepository');
const NotificationSuppressionRepository = require('../repositories/NotificationSuppressionRepository');
const UserRepository = require('../repositories/UserRepository');
const {
  CATEGORY_POLICY,
  CATEGORY_PREF_COLUMN,
  NON_OPTOUTABLE_TRIGGERS,
  buildNotification,
} = require('../config/notificationCatalog');

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000; // "aktif kullanıcı" = son 24 saatte açmış

class NotificationEngine {
  /**
   * Katalogdaki bir tetikleyiciyi işleyip gönderir.
   * @param {number} userId
   * @param {string} triggerKey - notificationCatalog TEMPLATES anahtarı
   * @param {Object} params - şablon parametreleri
   * @param {Object} options - ek seçenekler (bkz. dispatch)
   */
  static async sendTrigger(userId, triggerKey, params = {}, options = {}) {
    const notification = buildNotification(triggerKey, params);
    if (!notification) {
      console.warn(`[NOTIF-ENGINE] Bilinmeyen trigger: ${triggerKey}`);
      return { sent: false, reason: 'unknown_trigger' };
    }
    return this.dispatch(userId, notification, options);
  }

  /**
   * Hazır bir bildirim yükünü kontrol katmanlarından geçirip gönderir.
   * @param {number} userId
   * @param {Object} notification - { category, type, trigger, title, subtitle, deepLink, userInitiated?, critical? }
   * @param {Object} options
   *   @param {boolean} [options.force]           - tüm kontrolleri atla (test/kritik acil)
   *   @param {boolean} [options.skipQuietHours]  - sessiz saat kontrolünü atla
   *   @param {string}  [options.activeScreen]    - kullanıcının o an açık olduğu ekran (foreground suppression)
   *   @param {boolean} [options.saveOnBlock]     - bloklanınca yine de DB'ye yaz (in-app liste için)
   *   @param {Object}  [options.extraMetadata]   - metadata'ya eklenecek alanlar
   *   @param {boolean} [options.isUserActive]    - aktiflik override (bilinen durumlarda ekstra sorguyu önler)
   * @returns {Promise<{sent: boolean, reason?: string, notification?: Object}>}
   */
  static async dispatch(userId, notification, options = {}) {
    try {
      if (!userId || !notification) {
        return { sent: false, reason: 'invalid_input' };
      }

      const category = notification.category || 'system';
      const policy = CATEGORY_POLICY[category] || CATEGORY_POLICY.system;
      const trigger = notification.trigger || notification.type || 'generic';

      if (!options.force) {
        const decision = await this._runChecks(userId, notification, policy, category, trigger, options);
        if (!decision.allowed) {
          // Bloklandı; istenirse in-app liste için yine de kaydet (push atmadan)
          if (options.saveOnBlock) {
            await this._persist(userId, notification, { ...options, pushed: false, blockedReason: decision.reason });
          }
          console.log(`[NOTIF-ENGINE] BLOCKED user=${userId} trigger=${trigger} reason=${decision.reason}`);
          return { sent: false, reason: decision.reason };
        }
      }

      // Gönder (OneSignal push + DB kaydı)
      const saved = await this._deliver(userId, notification, options);
      console.log(`[NOTIF-ENGINE] SENT user=${userId} trigger=${trigger} category=${category}`);
      return { sent: true, notification: saved };
    } catch (error) {
      console.error('[NOTIF-ENGINE] dispatch error:', error.message);
      return { sent: false, reason: 'error' };
    }
  }

  // ------------------------------------------------------------------
  // Kontrol katmanları
  // ------------------------------------------------------------------
  static async _runChecks(userId, notification, policy, category, trigger, options) {
    const prefs = await NotificationPreferenceRepository.getByUserId(userId);

    // (2) Kategori opt-out — güvenlik/hesap kritikleri hariç
    const prefColumn = CATEGORY_PREF_COLUMN[category];
    const isNonOptOutable = NON_OPTOUTABLE_TRIGGERS.has(trigger);
    if (!isNonOptOutable && prefColumn && prefs[prefColumn] === false) {
      return { allowed: false, reason: 'category_opt_out' };
    }

    // (Re-engagement) Sadece inaktif kullanıcıya
    if (policy.sendToActiveUser === false) {
      const active = options.isUserActive !== undefined
        ? options.isUserActive
        : await this._isUserActive(userId);
      if (active) {
        return { allowed: false, reason: 'user_active' };
      }
    }

    // (3) Frequency cap (kategori bazlı günlük limit)
    if (policy.dailyLimit != null) {
      const count = await NotificationRepository.countByCategorySince(userId, category, DAY_MS);
      if (count >= policy.dailyLimit) {
        return { allowed: false, reason: 'frequency_cap' };
      }
    }

    // (4) Sessiz saat
    if (!options.skipQuietHours && prefs.quiet_hours_enabled) {
      if (this._isQuietHour(prefs)) {
        const q = policy.quietHours;
        const allowInQuiet =
          q === 'always' ||
          (q === 'user_initiated_only' && notification.userInitiated === true) ||
          (q === 'critical_only' && notification.critical === true);
        if (!allowInQuiet) {
          return { allowed: false, reason: 'quiet_hours' };
        }
      }
    }

    // (5) Foreground suppression — kullanıcı ilgili ekranda aktifse
    if (options.activeScreen && this._screenMatches(options.activeScreen, notification.deepLink)) {
      return { allowed: false, reason: 'foreground_suppression' };
    }

    // (6) Kriz-duyarlılık filtresi
    if (!policy.bypassSuppression) {
      const suppressed = await NotificationSuppressionRepository.isSuppressed(userId);
      if (suppressed) {
        return { allowed: false, reason: 'crisis_suppression' };
      }
    }

    return { allowed: true };
  }

  static async _isUserActive(userId) {
    try {
      const lastActive = await UserRepository.getLastActiveAt(userId);
      if (!lastActive) return false;
      return Date.now() - new Date(lastActive).getTime() < ACTIVE_WINDOW_MS;
    } catch (e) {
      return false;
    }
  }

  /**
   * Kullanıcının yerel saatine göre sessiz saat penceresinde mi?
   */
  static _isQuietHour(prefs) {
    const start = prefs.quiet_hours_start ?? 22;
    const end = prefs.quiet_hours_end ?? 8;
    let hour;
    try {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: prefs.timezone || 'Europe/Istanbul',
        hour: 'numeric',
        hour12: false,
      });
      hour = parseInt(fmt.format(new Date()), 10) % 24;
    } catch (e) {
      hour = new Date().getHours();
    }
    if (start === end) return false;
    if (start < end) return hour >= start && hour < end;
    // Gece geçişi (örn. 22 → 8)
    return hour >= start || hour < end;
  }

  /**
   * Aktif ekran, bildirimin deep-link'iyle eşleşiyor mu?
   * Örn. activeScreen='chat/5', deepLink='chat/5' → true (aynı sohbet)
   */
  static _screenMatches(activeScreen, deepLink) {
    if (!activeScreen || !deepLink) return false;
    const a = String(activeScreen).replace(/^\/+/, '').toLowerCase();
    const d = String(deepLink).replace(/^\/+/, '').toLowerCase();
    if (a === d) return true;
    const aSeg = a.split('/');
    const dSeg = d.split('/');
    // İlk segment (ekran türü) aynı ve varsa id'ler de aynı olmalı
    if (aSeg[0] !== dSeg[0]) return false;
    if (dSeg[1] && aSeg[1]) return dSeg[1] === aSeg[1];
    return true;
  }

  // ------------------------------------------------------------------
  // Gönderim
  // ------------------------------------------------------------------
  static async _deliver(userId, notification, options) {
    const metadata = this._buildMetadata(notification, options);

    // OneSignal push (başarısız olsa da DB'ye kaydederiz — inbox tipi hariç)
    try {
      await OneSignalService.sendNotification(
        userId,
        notification.title,
        notification.subtitle,
        metadata,
        notification.type || 'system_notification'
      );
    } catch (err) {
      console.error('[NOTIF-ENGINE] OneSignal gönderim hatası (DB kaydı devam):', err.message);
    }

    // Sohbet mesajı push'ları in-app bildirim listesini "son sohbetler" gibi
    // doldurmasın; mesajlar zaten chat geçmişinde. Sadece OS bildirim gitsin.
    if (this._isChatMessageOnly(notification)) {
      return null;
    }

    return this._persist(userId, notification, { ...options, metadata, pushed: true });
  }

  static _isChatMessageOnly(notification) {
    const type = notification?.type;
    const trigger = notification?.trigger;
    return type === 'chat_message' || trigger === 'therapist_message';
  }

  static async _persist(userId, notification, options = {}) {
    if (this._isChatMessageOnly(notification)) {
      return null;
    }
    const metadata = options.metadata || this._buildMetadata(notification, options);
    try {
      return await NotificationRepository.create({
        user_id: userId,
        type: notification.type || 'system_notification',
        category: notification.category || 'system',
        title: notification.title,
        subtitle: notification.subtitle,
        deep_link: notification.deepLink || null,
        metadata,
      });
    } catch (err) {
      console.error('[NOTIF-ENGINE] DB kayıt hatası:', err.message);
      return null;
    }
  }

  static _buildMetadata(notification, options) {
    return {
      type: notification.type || 'system_notification',
      category: notification.category || 'system',
      trigger: notification.trigger || null,
      deepLink: notification.deepLink || null,
      ...(options.extraMetadata || {}),
    };
  }
}

module.exports = NotificationEngine;
