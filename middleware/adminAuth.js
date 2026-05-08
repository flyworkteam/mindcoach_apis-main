/**
 * Admin Authentication Middleware
 *
 * Korumalı admin endpoint'leri için basit API Key bazlı yetkilendirme.
 *
 * Kullanım: İstek gönderirken `Authorization: Bearer <ADMIN_API_KEY>` header'ı.
 * `.env` dosyasında `ADMIN_API_KEY=...` tanımlı olmalıdır. Tanımlı değilse
 * tüm admin endpoint'leri 503 döner (yanlış yapılandırma).
 */

const adminAuth = (req, res, next) => {
  const expectedKey = process.env.ADMIN_API_KEY;
  if (!expectedKey) {
    console.error(
      '❌ [ADMIN-AUTH] ADMIN_API_KEY env değişkeni tanımlı değil — admin endpoint kapalı.'
    );
    return res.status(503).json({
      success: false,
      error:
        'Admin API not configured on server (ADMIN_API_KEY missing).',
    });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Admin API key required (Authorization: Bearer <key>).',
    });
  }

  const providedKey = authHeader.slice('Bearer '.length).trim();
  if (providedKey !== expectedKey) {
    return res.status(403).json({
      success: false,
      error: 'Invalid admin API key.',
    });
  }

  next();
};

module.exports = { adminAuth };
