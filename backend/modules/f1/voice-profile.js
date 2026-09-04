'use strict';

function envNumber(name, fallback, min, max) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(raw, min), max);
}

function envEnum(name, allowed, fallback) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  return allowed.includes(raw) ? raw : fallback;
}

function realtimeVoiceProfile() {
  return {
    vadEagerness: envEnum('F1_VAD_EAGERNESS', ['low', 'medium', 'high', 'auto'], 'low'),
    maxOutputTokens: Math.round(envNumber('F1_REALTIME_MAX_OUTPUT_TOKENS', 2400, 900, 4096)),
    voiceSpeed: envNumber('F1_VOICE_SPEED', 1.04, 0.85, 1.20),
    noiseReduction: envEnum('F1_NOISE_REDUCTION', ['near_field', 'far_field'], 'far_field'),
  };
}

module.exports = { realtimeVoiceProfile };
