'use strict';

const DEFAULT_REALTIME_MODEL = 'gpt-realtime-mini';

const DEPRECATED_REALTIME_MODELS = {
  'gpt-4o-mini-realtime-preview': 'gpt-realtime-mini',
  'gpt-4o-mini-realtime-preview-2024-12-17': 'gpt-realtime-mini',
  'gpt-4o-realtime-preview': 'gpt-realtime',
  'gpt-4o-realtime-preview-2024-10-01': 'gpt-realtime',
};

/**
 * GA Realtime API için geçerli model adını döndürür.
 * Sunucu .env'de eski preview adı kalsa bile otomatik eşler.
 */
function resolveRealtimeModel(raw) {
  const trimmed = (raw || '').trim();
  const candidate =
    trimmed || process.env.OPENAI_REALTIME_MODEL?.trim() || DEFAULT_REALTIME_MODEL;
  const mapped = DEPRECATED_REALTIME_MODELS[candidate];
  if (mapped) {
    console.warn(
      `[OPENAI-RT] ⚠️ Model '${candidate}' artık geçerli değil; '${mapped}' kullanılıyor. ` +
        'Sunucu .env: OPENAI_REALTIME_MODEL=gpt-realtime-mini'
    );
    return mapped;
  }
  return candidate;
}

module.exports = { resolveRealtimeModel, DEFAULT_REALTIME_MODEL };
