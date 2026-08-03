'use strict';

const assert = require('assert');
const { TenantEventBus } = require('./event-bus');

const bus = new TenantEventBus();
const received = [];

const stop = bus.on(
  'appointment.created',
  (event) => received.push(event),
  { tenant_id: 'tenant-a', branch_key: 'sucursal_1' }
);

bus.emit(
  'appointment.created',
  { appointment_id: 1 },
  { tenant_id: 'tenant-a', branch_key: 'sucursal_1', source: 'test' }
);

bus.emit(
  'appointment.created',
  { appointment_id: 2 },
  { tenant_id: 'tenant-b', branch_key: 'sucursal_1', source: 'test' }
);

assert.strictEqual(received.length, 1);
assert.strictEqual(received[0].payload.appointment_id, 1);

stop();

console.log('✅ F1 Event Bus: aislamiento por empresa y sucursal validado');
