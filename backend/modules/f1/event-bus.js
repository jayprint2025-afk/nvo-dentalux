'use strict';

const { EventEmitter } = require('events');
const crypto = require('crypto');

const DEFAULT_HISTORY_LIMIT = Number(process.env.F1_EVENT_HISTORY_LIMIT || 200);
const DEFAULT_LISTENER_LIMIT = Number(process.env.F1_EVENT_MAX_LISTENERS || 100);

const ALLOWED_EVENTS = new Set([
  'appointment.created',
  'appointment.updated',
  'appointment.cancelled',
  'appointment.confirmed',
  'appointment.rescheduled',

  'payment.created',
  'payment.updated',
  'payment.deleted',

  'expense.created',
  'expense.updated',
  'expense.deleted',

  'laboratory.created',
  'laboratory.updated',
  'laboratory.completed',
  'laboratory.overdue',

  'inventory.created',
  'inventory.updated',
  'inventory.low_stock',
  'inventory.out_of_stock',

  'patient.created',
  'patient.updated',

  'f1.notification.created',
  'f1.operations.refresh',
]);

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function nowIso() {
  return new Date().toISOString();
}

function createEventId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function normalizeContext(context = {}) {
  const tenantId = clean(context.tenant_id || context.tenantId);
  if (!tenantId) throw new Error('F1 Event Bus: tenant_id es obligatorio');

  return {
    tenant_id: tenantId,
    branch_key: clean(context.branch_key || context.branchKey || 'sucursal_1'),
    user_id: clean(context.user_id || context.userId) || null,
    source: clean(context.source || 'system'),
  };
}

function normalizeEvent(name, payload = {}, context = {}, options = {}) {
  const eventName = clean(name);
  if (!ALLOWED_EVENTS.has(eventName)) {
    throw new Error(`F1 Event Bus: evento no permitido: ${eventName || 'vacío'}`);
  }

  const ctx = normalizeContext(context);

  return Object.freeze({
    id: clean(options.id) || createEventId(),
    name: eventName,
    occurred_at: clean(options.occurred_at) || nowIso(),
    tenant_id: ctx.tenant_id,
    branch_key: ctx.branch_key,
    user_id: ctx.user_id,
    source: ctx.source,
    payload: payload && typeof payload === 'object' ? payload : { value: payload },
    metadata: options.metadata && typeof options.metadata === 'object'
      ? options.metadata
      : {},
  });
}

class TenantEventBus {
  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(DEFAULT_LISTENER_LIMIT);
    this.history = [];
  }

  emit(name, payload, context, options = {}) {
    const event = normalizeEvent(name, payload, context, options);

    this.history.push(event);
    if (this.history.length > DEFAULT_HISTORY_LIMIT) {
      this.history.splice(0, this.history.length - DEFAULT_HISTORY_LIMIT);
    }

    // Canal global para observadores internos.
    this.emitter.emit('*', event);

    // Canal por nombre de evento.
    this.emitter.emit(event.name, event);

    // Canal estrictamente aislado por empresa.
    this.emitter.emit(`${event.tenant_id}:${event.name}`, event);

    // Canal aislado por empresa + sucursal.
    this.emitter.emit(
      `${event.tenant_id}:${event.branch_key}:${event.name}`,
      event
    );

    return event;
  }

  on(name, handler, filters = {}) {
    if (typeof handler !== 'function') {
      throw new TypeError('F1 Event Bus: handler debe ser una función');
    }

    const eventName = clean(name);
    const tenantId = clean(filters.tenant_id || filters.tenantId);
    const branchKey = clean(filters.branch_key || filters.branchKey);

    if (eventName !== '*' && !ALLOWED_EVENTS.has(eventName)) {
      throw new Error(`F1 Event Bus: evento no permitido: ${eventName}`);
    }

    let channel = eventName;

    if (eventName === '*') {
      channel = '*';
    } else if (tenantId && branchKey) {
      channel = `${tenantId}:${branchKey}:${eventName}`;
    } else if (tenantId) {
      channel = `${tenantId}:${eventName}`;
    }

    const wrapped = (event) => {
      if (tenantId && event.tenant_id !== tenantId) return;
      if (branchKey && event.branch_key !== branchKey) return;
      handler(event);
    };

    this.emitter.on(channel, wrapped);

    return () => {
      this.emitter.off(channel, wrapped);
    };
  }

  once(name, handler, filters = {}) {
    let unsubscribe = null;
    const wrapped = (event) => {
      if (unsubscribe) unsubscribe();
      handler(event);
    };
    unsubscribe = this.on(name, wrapped, filters);
    return unsubscribe;
  }

  getHistory(filters = {}) {
    const tenantId = clean(filters.tenant_id || filters.tenantId);
    const branchKey = clean(filters.branch_key || filters.branchKey);
    const name = clean(filters.name);
    const limit = Math.max(1, Math.min(Number(filters.limit || 50), DEFAULT_HISTORY_LIMIT));

    return this.history
      .filter((event) => {
        if (tenantId && event.tenant_id !== tenantId) return false;
        if (branchKey && event.branch_key !== branchKey) return false;
        if (name && event.name !== name) return false;
        return true;
      })
      .slice(-limit);
  }

  clearHistory(filters = {}) {
    const tenantId = clean(filters.tenant_id || filters.tenantId);
    const branchKey = clean(filters.branch_key || filters.branchKey);

    if (!tenantId && !branchKey) {
      this.history = [];
      return;
    }

    this.history = this.history.filter((event) => {
      if (tenantId && event.tenant_id !== tenantId) return true;
      if (branchKey && event.branch_key !== branchKey) return true;
      return false;
    });
  }

  listenerCount(name, filters = {}) {
    const tenantId = clean(filters.tenant_id || filters.tenantId);
    const branchKey = clean(filters.branch_key || filters.branchKey);

    let channel = clean(name);
    if (channel !== '*' && tenantId && branchKey) {
      channel = `${tenantId}:${branchKey}:${channel}`;
    } else if (channel !== '*' && tenantId) {
      channel = `${tenantId}:${channel}`;
    }

    return this.emitter.listenerCount(channel);
  }

  allowedEvents() {
    return Array.from(ALLOWED_EVENTS);
  }
}

const f1EventBus = new TenantEventBus();

module.exports = {
  ALLOWED_EVENTS,
  TenantEventBus,
  f1EventBus,
  normalizeEvent,
};
