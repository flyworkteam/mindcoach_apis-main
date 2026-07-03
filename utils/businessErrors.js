/**
 * İş kuralı hataları — DB/circuit-breaker arızası değildir.
 * Bu hatalar circuit breaker sayacını artırmamalı ve retry edilmemelidir.
 */
const BUSINESS_ERROR_MESSAGES = new Set([
  'Appointment not found',
  'Unauthorized: Appointment does not belong to user',
  'User already has an appointment with this consultant',
  'Notification not found',
  'Access denied',
]);

function isBusinessError(error) {
  if (!error) return false;
  if (BUSINESS_ERROR_MESSAGES.has(error.message)) return true;
  // ER_* kodları dışındaki bilinçli Error fırlatmaları
  if (error.isBusinessError === true) return true;
  return false;
}

module.exports = { isBusinessError, BUSINESS_ERROR_MESSAGES };
