class PremiumDevice {
  constructor(data) {
    this.id = data.id || null; // Database ID
    this.deviceId = data.deviceId; // Unique device ID from app
    this.userId = data.userId || null; // User who purchased premium
    this.isPremium = data.isPremium ?? false;
    this.expiryDate = data.expiryDate || null; // ISO 8601 timestamp
    this.purchasedDate = data.purchasedDate || null; // When premium was bought
    this.planId = data.planId || 'pro'; // pro, plus, etc.
    this.receiptData = data.receiptData || null; // RevenueCat receipt for verification
    this.packageIdentifier = data.packageIdentifier || null; // com.example.app.premium
    this.isTrial = data.isTrial ?? false; // Is this a trial or purchased?
    this.trialStartDate = data.trialStartDate || null; // When 3-day trial started
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
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

  // Check if premium is still valid
  isExpired() {
    if (!this.expiryDate) return true;
    return new Date() > new Date(this.expiryDate);
  }

  // Get days remaining
  getDaysRemaining() {
    if (!this.expiryDate || this.isExpired()) return 0;
    const now = new Date();
    const expiry = new Date(this.expiryDate);
    const diff = expiry - now;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }
}

module.exports = PremiumDevice;
