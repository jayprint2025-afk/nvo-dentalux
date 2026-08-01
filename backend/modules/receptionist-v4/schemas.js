'use strict';

const INTENTS = Object.freeze({
  BOOKING: 'booking',
  INFORMATION: 'information',
  CANCEL_FLOW: 'cancel_flow',
  RESTART: 'restart',
  HUMAN: 'human_handoff',
  GRATITUDE: 'gratitude',
  GREETING: 'greeting',
  UNKNOWN: 'unknown',
});

const INFO_TYPES = Object.freeze([
  'price',
  'location',
  'business_hours',
  'services',
  'promotion',
  'contact',
  'payment_methods',
  'insurance',
  'preparation',
  'duration',
  'other',
]);

const CONFIRMATIONS = Object.freeze({
  YES: 'yes',
  NO: 'no',
  CHANGE: 'change',
  NONE: null,
});

function emptyExtraction() {
  return {
    primary_intent: INTENTS.UNKNOWN,
    booking_intent: false,
    information_requests: [],
    updates: {
      branch_key: null,
      service_text: null,
      date: null,
      preferred_time: null,
      time_range: null,
      patient: null,
      phone: null,
    },
    confirmation: CONFIRMATIONS.NONE,
    rejection: null,
    correction_fields: [],
    needs_human: false,
    confidence: 0,
  };
}

module.exports = { INTENTS, INFO_TYPES, CONFIRMATIONS, emptyExtraction };
