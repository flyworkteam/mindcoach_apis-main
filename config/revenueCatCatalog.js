/**
 * RevenueCat / App Store ürün kataloğu
 *
 * App Store Connect'teki "Mindcoach Pro" abonelik grubundaki ürünler ve
 * bunların backend'deki plan/süre karşılıkları. Her ürüne 3 günlük ücretsiz
 * deneme (introductory offer) tanımlandı; deneme süresini App Store / RevenueCat
 * yönetir, backend gerçek bitiş tarihini (expiry) RevenueCat'ten alır.
 *
 * durationDays yalnızca gerçek expiry elde edilemediğinde (ör. client eski
 * sürüm) FALLBACK olarak kullanılır. Mümkün olduğunda her zaman RevenueCat'in
 * bildirdiği gerçek bitiş tarihi kullanılmalıdır.
 */

const TRIAL_DAYS = 3;

// productId → { planId, durationDays }
const PRODUCTS = {
  // Aylık planlar (1 ay)
  monthly: { planId: 'monthly', durationDays: 30 },
  monthlyv2: { planId: 'monthly', durationDays: 30 },
  monthly_discount: { planId: 'monthly', durationDays: 30 },

  // Yıllık planlar (1 yıl)
  yearly: { planId: 'yearly', durationDays: 365 },
  yearlyv2: { planId: 'yearly', durationDays: 365 },
  mindcoach_pro_yearly: { planId: 'yearly', durationDays: 365 },
};

// Eşleşme bulunamazsa güvenli varsayılan. 1 yıl gibi uzun bir süreyi ASLA
// varsayılan yapma — kötüye kullanımı/yanlış premium süresini önlemek için
// en kısa periyodu (aylık) esas al.
const DEFAULT_PLAN = { planId: 'pro', durationDays: 30 };

/**
 * Bir ürün ID'sini plan bilgisine çevirir.
 * @param {string|null|undefined} productId
 * @returns {{ planId: string, durationDays: number }}
 */
function resolvePlan(productId) {
  if (!productId) return { ...DEFAULT_PLAN };
  const key = String(productId).trim();
  return PRODUCTS[key] ? { ...PRODUCTS[key] } : { ...DEFAULT_PLAN };
}

/**
 * RevenueCat event'inin period_type alanının deneme olup olmadığını söyler.
 * TRIAL ve INTRO (introductory offer / 3 günlük ücretsiz deneme) → deneme.
 * @param {string|null|undefined} periodType
 * @returns {boolean}
 */
function isTrialPeriod(periodType) {
  if (!periodType) return false;
  const p = String(periodType).trim().toUpperCase();
  return p === 'TRIAL' || p === 'INTRO';
}

module.exports = {
  TRIAL_DAYS,
  PRODUCTS,
  DEFAULT_PLAN,
  resolvePlan,
  isTrialPeriod,
};
