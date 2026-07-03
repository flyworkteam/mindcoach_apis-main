/**
 * Crisis Detection (keyword tabanlı ilk katman)
 * ------------------------------------------------------------------
 * Kullanıcı mesajlarında kendine zarar / intihar / acil kriz sinyali
 * arar. Bu HAFİF bir ön filtredir; klinik teşhis aracı değildir.
 * Amaç: risk sinyali veren kullanıcıya 48 saat pazarlama/re-engagement
 * bildirimi göndermemek (Spec §1 Kriz duyarlılığı).
 *
 * Not: Yanlış-pozitifler bildirim baskılamaya yol açar (güvenli taraf);
 * yanlış-negatifler ise mevcut davranışı değiştirmez.
 */

'use strict';

// Türkçe ve İngilizce yüksek-riskli ifade kalıpları
const CRISIS_PATTERNS = [
  // Türkçe
  /intihar/i,
  /kendim[ie]\s*zarar/i,
  /canıma\s*k[ıi]y/i,
  /ya[şs]amak\s*istemiyorum/i,
  /ölmek\s*istiyorum/i,
  /hayat[ıi]ma\s*son/i,
  /ya[şs]aman[ıi]n\s*anlam[ıi]\s*yok/i,
  /kendimi\s*öldür/i,
  /art[ıi]k\s*dayanam[ıi]yorum/i,
  /bit[ie]rmek\s*istiyorum/i,
  // İngilizce
  /suicide/i,
  /kill\s*myself/i,
  /self[\s-]*harm/i,
  /want\s*to\s*die/i,
  /end\s*my\s*life/i,
  /don'?t\s*want\s*to\s*live/i,
  /hurt\s*myself/i,
];

/**
 * Verilen metin(ler)de kriz sinyali var mı?
 * @param  {...(string|null|undefined)} texts
 * @returns {boolean}
 */
function detectCrisis(...texts) {
  const combined = texts.filter(Boolean).join(' \n ');
  if (!combined) return false;
  return CRISIS_PATTERNS.some((pattern) => pattern.test(combined));
}

module.exports = { detectCrisis, CRISIS_PATTERNS };
