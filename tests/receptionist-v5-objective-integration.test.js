
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(
  path.join(__dirname, '../backend/modules/receptionist-v5/free-conversation-agent.js'),
  'utf8'
);

assert(source.includes("require('./booking-objective-planner')"));
assert(source.includes("plan.action.type === 'find_next_available_date'"));
assert(source.includes("ObjectivePlanner.markUnavailable"));
assert(source.includes("ObjectivePlanner.markSlotValidated"));
assert(source.includes("BOOKING_OBJECTIVE"));
console.log('✅ integración del planificador confirmada');
