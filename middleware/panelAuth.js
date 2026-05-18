/**
 * App Panel API Authentication
 *
 * Dış yönetim panelinden gelen istekler için API key doğrulaması.
 * Panel sunucusu şu header'lardan birini gönderebilir:
 *   - Authorization: Bearer <PANEL_API_KEY>
 *   - X-Panel-Api-Key: <PANEL_API_KEY>
 *
 * PANEL_API_KEY tanımlı değilse ADMIN_API_KEY ile geriye dönük uyumluluk sağlanır.
 */

const panelAuth = (req, res, next) => {
  const expectedKey =
    process.env.PANEL_API_KEY || process.env.ADMIN_API_KEY || null;

  if (!expectedKey) {
    console.error(
      '❌ [PANEL-AUTH] PANEL_API_KEY (veya ADMIN_API_KEY) tanımlı değil — panel endpoint kapalı.'
    );
    return res.status(503).json({
      success: false,
      error:
        'Panel API not configured on server (PANEL_API_KEY missing).',
    });
  }

  const bearer =
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice('Bearer '.length).trim()
      : null;
  const headerKey = req.headers['x-panel-api-key'];
  const providedKey = bearer || headerKey;

  if (!providedKey) {
    return res.status(401).json({
      success: false,
      error:
        'Panel API key required (Authorization: Bearer <key> or X-Panel-Api-Key).',
    });
  }

  if (providedKey !== expectedKey) {
    return res.status(403).json({
      success: false,
      error: 'Invalid panel API key.',
    });
  }

  next();
};

module.exports = { panelAuth };
