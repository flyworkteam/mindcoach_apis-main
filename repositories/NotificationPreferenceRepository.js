/**
 * Notification Preference Repository
 * Kullanıcı bazlı kategori opt-out ve sessiz-saat tercihleri.
 */

'use strict';

const pool = require('../config/database');

const DEFAULTS = {
  realtime_enabled: true,
  therapy_enabled: true,
  analysis_enabled: true,
  reengagement_enabled: true,
  subscription_enabled: true,
  system_enabled: true,
  quiet_hours_enabled: true,
  quiet_hours_start: 22,
  quiet_hours_end: 8,
  timezone: 'Europe/Istanbul',
};

const BOOL_FIELDS = [
  'realtime_enabled',
  'therapy_enabled',
  'analysis_enabled',
  'reengagement_enabled',
  'subscription_enabled',
  'system_enabled',
  'quiet_hours_enabled',
];

class NotificationPreferenceRepository {
  /**
   * Kullanıcının tercihlerini döner; kayıt yoksa varsayılanları verir.
   */
  static async getByUserId(userId) {
    try {
      const [rows] = await pool.execute(
        'SELECT * FROM notification_preferences WHERE user_id = ? LIMIT 1',
        [userId]
      );
      if (rows.length === 0) {
        return { userId, ...DEFAULTS };
      }
      return this.mapRow(rows[0]);
    } catch (error) {
      console.error('Error getting notification preferences:', error);
      // Güvenli varsayılan: hata durumunda bildirim akışı kesilmesin
      return { userId, ...DEFAULTS };
    }
  }

  /**
   * Tercihleri oluşturur/günceller (upsert). Sadece verilen alanlar güncellenir.
   */
  static async upsert(userId, prefs = {}) {
    try {
      const merged = { ...DEFAULTS };
      // Mevcut kayıt varsa onu baz al
      const existing = await this.getByUserId(userId);
      Object.assign(merged, this._toDbShape(existing));
      Object.assign(merged, this._sanitize(prefs));

      await pool.execute(
        `INSERT INTO notification_preferences
          (user_id, realtime_enabled, therapy_enabled, analysis_enabled,
           reengagement_enabled, subscription_enabled, system_enabled,
           quiet_hours_enabled, quiet_hours_start, quiet_hours_end, timezone)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           realtime_enabled = VALUES(realtime_enabled),
           therapy_enabled = VALUES(therapy_enabled),
           analysis_enabled = VALUES(analysis_enabled),
           reengagement_enabled = VALUES(reengagement_enabled),
           subscription_enabled = VALUES(subscription_enabled),
           system_enabled = VALUES(system_enabled),
           quiet_hours_enabled = VALUES(quiet_hours_enabled),
           quiet_hours_start = VALUES(quiet_hours_start),
           quiet_hours_end = VALUES(quiet_hours_end),
           timezone = VALUES(timezone)`,
        [
          userId,
          merged.realtime_enabled,
          merged.therapy_enabled,
          merged.analysis_enabled,
          merged.reengagement_enabled,
          merged.subscription_enabled,
          merged.system_enabled,
          merged.quiet_hours_enabled,
          merged.quiet_hours_start,
          merged.quiet_hours_end,
          merged.timezone,
        ]
      );
      return await this.getByUserId(userId);
    } catch (error) {
      console.error('Error upserting notification preferences:', error);
      throw error;
    }
  }

  static _sanitize(prefs) {
    const out = {};
    for (const f of BOOL_FIELDS) {
      if (prefs[f] !== undefined) out[f] = prefs[f] ? 1 : 0;
    }
    if (prefs.quiet_hours_start !== undefined) {
      const v = parseInt(prefs.quiet_hours_start, 10);
      if (!Number.isNaN(v) && v >= 0 && v <= 23) out.quiet_hours_start = v;
    }
    if (prefs.quiet_hours_end !== undefined) {
      const v = parseInt(prefs.quiet_hours_end, 10);
      if (!Number.isNaN(v) && v >= 0 && v <= 23) out.quiet_hours_end = v;
    }
    if (typeof prefs.timezone === 'string' && prefs.timezone.length <= 64) {
      out.timezone = prefs.timezone;
    }
    return out;
  }

  static _toDbShape(pref) {
    return {
      realtime_enabled: pref.realtime_enabled ? 1 : 0,
      therapy_enabled: pref.therapy_enabled ? 1 : 0,
      analysis_enabled: pref.analysis_enabled ? 1 : 0,
      reengagement_enabled: pref.reengagement_enabled ? 1 : 0,
      subscription_enabled: pref.subscription_enabled ? 1 : 0,
      system_enabled: pref.system_enabled ? 1 : 0,
      quiet_hours_enabled: pref.quiet_hours_enabled ? 1 : 0,
      quiet_hours_start: pref.quiet_hours_start,
      quiet_hours_end: pref.quiet_hours_end,
      timezone: pref.timezone,
    };
  }

  static mapRow(row) {
    return {
      userId: row.user_id,
      realtime_enabled: !!row.realtime_enabled,
      therapy_enabled: !!row.therapy_enabled,
      analysis_enabled: !!row.analysis_enabled,
      reengagement_enabled: !!row.reengagement_enabled,
      subscription_enabled: !!row.subscription_enabled,
      system_enabled: !!row.system_enabled,
      quiet_hours_enabled: !!row.quiet_hours_enabled,
      quiet_hours_start: row.quiet_hours_start,
      quiet_hours_end: row.quiet_hours_end,
      timezone: row.timezone,
    };
  }
}

module.exports = NotificationPreferenceRepository;
