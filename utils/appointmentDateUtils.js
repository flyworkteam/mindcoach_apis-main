/**
 * Appointment date parsing helpers.
 *
 * Storage contract: UTC ISO strings in DB.
 * Display contract: clients convert with toLocal().
 *
 * Turkey (Europe/Istanbul) is UTC+3 year-round (no DST since 2016).
 */

const TURKEY_UTC_OFFSET_HOURS = 3;

/**
 * Parse a client-sent ISO string that already includes timezone (Z or ±HH:MM).
 * Used for Flutter UI webhook/reschedule payloads (local → toUtc() → Z).
 */
function parseAbsoluteAppointmentDate(input) {
  if (!input) {
    throw new Error('Appointment date is required');
  }

  const str = String(input).trim();
  const date = new Date(str);
  if (isNaN(date.getTime())) {
    throw new Error('Invalid appointment date format. Expected ISO 8601 format.');
  }
  return date;
}

/**
 * Parse a naive wall-clock datetime as Turkey local time and return UTC Date.
 * Example: "2026-07-04T13:00:00" → 2026-07-04T10:00:00.000Z
 */
function parseTurkeyLocalAppointmentDate(input) {
  const str = String(input).trim();
  const match = str.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/
  );

  if (!match) {
    throw new Error('Invalid naive appointment date format.');
  }

  const [, year, month, day, hour, minute, second = '0'] = match;
  const utcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - TURKEY_UTC_OFFSET_HOURS,
    Number(minute),
    Number(second)
  );

  const date = new Date(utcMs);
  if (isNaN(date.getTime())) {
    throw new Error('Invalid appointment date.');
  }
  return date;
}

/**
 * AI chat tool often sends the user's requested hour with a trailing "Z"
 * even though it means Turkey local time (e.g. user says 13:00 → 13:00:00.000Z).
 * Strip mistaken Z and interpret wall-clock as Europe/Istanbul.
 *
 * If the model correctly sends +03:00 offset, keep absolute parsing.
 */
function parseAIAppointmentDate(input) {
  if (!input) {
    throw new Error('Appointment date is required');
  }

  const str = String(input).trim();

  // Correct explicit offset from model — trust absolute instant.
  if (/[+-]\d{2}:\d{2}$/.test(str)) {
    return parseAbsoluteAppointmentDate(str);
  }

  // Trailing Z without real offset info — treat wall clock as Turkey local.
  if (/Z$/i.test(str)) {
    const naive = str.replace(/(\.\d{3})?Z$/i, '');
    return parseTurkeyLocalAppointmentDate(naive);
  }

  // Naive datetime — Turkey local wall clock.
  return parseTurkeyLocalAppointmentDate(str);
}

module.exports = {
  TURKEY_UTC_OFFSET_HOURS,
  parseAbsoluteAppointmentDate,
  parseTurkeyLocalAppointmentDate,
  parseAIAppointmentDate,
};
