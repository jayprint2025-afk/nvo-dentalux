'use strict';
const assert = require('assert');
const { realtimeVoiceProfile } = require('./voice-profile');

function reset() {
  for (const k of ['F1_VAD_EAGERNESS','F1_REALTIME_MAX_OUTPUT_TOKENS','F1_VOICE_SPEED','F1_NOISE_REDUCTION']) delete process.env[k];
}

reset();
let p = realtimeVoiceProfile();
assert.strictEqual(p.vadEagerness, 'low');
assert.strictEqual(p.maxOutputTokens, 2400);
assert.strictEqual(p.voiceSpeed, 1.04);
assert.strictEqual(p.noiseReduction, 'far_field');

process.env.F1_VAD_EAGERNESS='high';
process.env.F1_REALTIME_MAX_OUTPUT_TOKENS='99999';
process.env.F1_VOICE_SPEED='0.2';
process.env.F1_NOISE_REDUCTION='near_field';
p = realtimeVoiceProfile();
assert.strictEqual(p.vadEagerness, 'high');
assert.strictEqual(p.maxOutputTokens, 4096);
assert.strictEqual(p.voiceSpeed, 0.85);
assert.strictEqual(p.noiseReduction, 'near_field');

process.env.F1_VAD_EAGERNESS='invalid';
process.env.F1_NOISE_REDUCTION='invalid';
p = realtimeVoiceProfile();
assert.strictEqual(p.vadEagerness, 'low');
assert.strictEqual(p.noiseReduction, 'far_field');
reset();
console.log('PASS voice-profile.test.js');
