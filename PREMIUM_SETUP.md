# Device-Based Premium System Setup

## Backend Setup

### 1. Create Premium Devices Table

Run the SQL migration:
```bash
# Connect to your MySQL database and run:
mysql -h [host] -u [user] -p [database] < scripts/create_premium_devices_table.sql

# Or manually in MySQL:
source scripts/create_premium_devices_table.sql;
```

### 2. Environment Variables

Add to `.env`:
```env
# Premium system configuration (optional, already has sensible defaults)
REVENUCAT_API_KEY=your_revenucat_api_key
```

### 3. Start Backend Server

```bash
npm install  # If not already done
npm start
```

The backend will now expose these endpoints:

#### Device Status Check (Public)
```
GET /api/v1/premium/device-status/{deviceId}
Response: {
  "success": true,
  "isPremium": true/false,
  "daysRemaining": 3,
  "expiryDate": "2026-05-08T...",
  "planId": "trial"
}
```

#### Initialize Device (Public - First App Launch)
```
POST /api/v1/premium/initialize
Body: { "deviceId": "uuid-here" }
Response: {
  "success": true,
  "isPremium": true,
  "planId": "trial",
  "daysRemaining": 3,
  "expiryDate": "2026-05-08T...",
  "isTrial": true
}
```

#### Confirm Purchase (Public - After In-App Purchase)
```
POST /api/v1/premium/confirm-purchase
Body: {
  "deviceId": "uuid-here",
  "userId": 123,
  "receiptData": "revenucat-receipt-token",
  "packageIdentifier": "com.example.app.premium"
}
Response: {
  "success": true,
  "membership": {
    "planId": "pro",
    "startDate": "2026-05-05T...",
    "endDate": "2027-05-05T...",
    "isActive": true,
    "daysRemaining": 365
  }
}
```

#### Get User's Premium Devices (Authenticated)
```
GET /api/v1/premium/status
Header: Authorization: Bearer {token}
Response: {
  "success": true,
  "devices": [
    {
      "deviceId": "uuid",
      "isPremium": true,
      "daysRemaining": 365,
      "expiryDate": "2027-05-05T...",
      "planId": "pro",
      "purchasedDate": "2026-05-05T..."
    }
  ]
}
```

## How It Works

### Device Registration Flow
1. **App First Launch**: 
   - Flutter generates UUID (device ID)
   - Stores in SharedPreferences
   - Backend creates trial record with 3-day expiry
   - Device ID persists across reinstalls!

2. **Premium Purchase**:
   - User taps "Get Premium"
   - RevenueCat paywall shown
   - After purchase, app calls `/confirm-purchase`
   - Backend links device to user, creates 1-year premium record
   - Local app state updated

3. **Fresh Install (Reinstall)**:
   - Device ID is same (from SharedPreferences if not wiped)
   - App checks `/device-status/{deviceId}`
   - Backend returns active premium if exists
   - User keeps premium even after reinstall!

### Database Schema

```
premium_devices
├── id (PK)
├── device_id (UUID, UNIQUE) ← Same across reinstalls
├── user_id (FK, nullable) ← User who bought premium
├── is_premium (boolean)
├── expiry_date (datetime)
├── purchased_date (datetime)
├── plan_id (string) ← "trial", "pro", etc.
├── receipt_data (text) ← RevenueCat receipt
├── is_trial (boolean)
├── trial_start_date (datetime)
├── created_at, updated_at
└── Indexes: device_id, user_id, expiry_date
```

## Important Notes

1. **Device ID Persistence**: 
   - Stored in SharedPreferences (`deviceIdPremium` key)
   - Survives app reinstall (unless user clears app data)
   - Survives account logout/login
   - Multiple users on same device share premium status

2. **Fresh Install Scenario**:
   - If user clears app data → New device ID generated
   - If user just reinstalls → Same device ID, same premium
   - This is intentional: prevents reinstall-to-reset-trial abuse

3. **Multiple Devices**:
   - User can have premium on multiple devices
   - Each device tracked separately
   - Premium links to user_id after purchase

4. **Security**:
   - Device status check is PUBLIC (no auth required)
   - Premium confirmation should validate with RevenueCat API in production
   - Receipt validation TODO: Implement RevenueCat receipt verification

## Testing

### Test Device Registration
```bash
curl -X POST http://localhost:3020/api/v1/premium/initialize \
  -H "Content-Type: application/json" \
  -d '{"deviceId": "test-device-uuid-001"}'
```

### Test Device Status
```bash
curl http://localhost:3020/api/v1/premium/device-status/test-device-uuid-001
```

### Test Purchase Confirmation
```bash
curl -X POST http://localhost:3020/api/v1/premium/confirm-purchase \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-device-uuid-001",
    "userId": 1,
    "receiptData": "revenucat-token",
    "packageIdentifier": "com.example.app.premium"
  }'
```

## Future Enhancements

1. **RevenueCat Integration**: Verify receipts against RevenueCat API
2. **Refund Handling**: Handle refunds and subscription cancellations
3. **Admin Panel**: Manage premium devices and user subscriptions
4. **Analytics**: Track premium conversion rates, churn, etc.
5. **Promo Codes**: Support promotional premium access
