'use strict';

const DEFAULT_PROFILE = Object.freeze({
  name: null,
  clinic_name: null,
  phone: null,
  email: null,
  city: null,
  branches: null,
  current_software: null,
  pain_points: [],
  interested_features: [],
  objections: [],
  recommended_plan: 'cliniqone_complete',
  onboarding_url: null,
  onboarding_token_created: false,
  onboarding_completed: false,
  buying_intent: 'unknown',
  next_step: null
});

function normalizeArray(value) {
  return Array.from(new Set((Array.isArray(value) ? value : []).map(v => String(v || '').trim()).filter(Boolean)));
}

function normalizeProfile(value = {}) {
  return {
    ...DEFAULT_PROFILE,
    ...(value && typeof value === 'object' ? value : {}),
    pain_points: normalizeArray(value?.pain_points),
    interested_features: normalizeArray(value?.interested_features),
    objections: normalizeArray(value?.objections)
  };
}

function mergeProfile(current, patch = {}) {
  const base = normalizeProfile(current);
  const next = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (['pain_points','interested_features','objections'].includes(key)) {
      next[key] = normalizeArray([...(base[key] || []), ...(Array.isArray(value) ? value : [value])]);
    } else {
      next[key] = value;
    }
  }
  return normalizeProfile(next);
}

module.exports = { DEFAULT_PROFILE, normalizeProfile, mergeProfile };
