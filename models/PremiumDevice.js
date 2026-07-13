/**
 * PremiumDevice model
 * MySQL satırları snake_case gelir; API/servis camelCase kullanır.
 * Her iki format da desteklenir.
 */
class PremiumDevice {
  constructor(data = {}) {
    this.id = data.id ?? null;
    this.deviceId = data.deviceId ?? data.device_id ?? null;
    this.userId = data.userId ?? data.user_id ?? null;
    this.isPremium = this._toBool(data.isPremium ?? data.is_premium, false);
    this.expiryDate = data.expiryDate ?? data.expiry_date ?? null;
    this.purchasedDate = data.purchasedDate ?? data.purchased_date ?? null;
    this.planId = data.planId ?? data.plan_id ?? 'pro';
    this.receiptData = data.receiptData ?? data.receipt_data ?? null;
    this.packageIdentifier = data.packageIdentifier ?? data.package_identifier ?? null;
    this.isTrial = this._toBool(data.isTrial ?? data.is_trial, false);
    this.trialStartDate = data.trialStartDate ?? data.trial_start_date ?? null;
    this.createdAt = data.createdAt ?? data.created_at ?? new Date().toISOString();
    this.updatedAt = data.updatedAt ?? data.updated_at ?? new Date().toISOString();
  }

  _toBool(value, fallback) {
    if (value === undefined || value === null) return fallback;
    return value === true || value === 1 || value === '1';
  }

  toJSON() {
    return {
      id: this.id,
      deviceId: this.deviceId,
      userId: this.userId,
      isPremium: this.isPremium,
      expiryDate: this.expiryDate,
      purchasedDate: this.purchasedDate,
      planId: this.planId,
      receiptData: this.receiptData,
      packageIdentifier: this.packageIdentifier,
      isTrial: this.isTrial,
      trialStartDate: this.trialStartDate,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  isExpired() {
    if (!this.expiryDate) return true;
    return new Date() > new Date(this.expiryDate);
  }

  getDaysRemaining() {
    if (!this.expiryDate || this.isExpired()) return 0;
    const now = new Date();
    const expiry = new Date(this.expiryDate);
    const diff = expiry - now;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }
}

module.exports = PremiumDevice;
