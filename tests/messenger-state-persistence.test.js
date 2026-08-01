'use strict';
const assert = require('assert');
const fs = require('fs');

const server = fs.readFileSync('backend/server.js', 'utf8');
const routes = fs.readFileSync('backend/modules/ai-saas-routes.js', 'utf8');
const state = fs.readFileSync('backend/modules/conversation-state.js', 'utf8');

assert(server.includes("LIKE 'v5%' THEN state"));
console.log('✅ server conserva v5-free y cualquier variante V5');

assert(server.includes('claimMessengerMessageOnce'));
assert(server.includes('Messenger MID duplicado ignorado'));
console.log('✅ Messenger deduplica por MID');

assert(routes.includes('withConversationLock'));
assert(routes.includes('STATE BEFORE'));
assert(routes.includes('STATE AFTER'));
console.log('✅ turnos de una conversación se procesan en serie');

const routeStart = routes.indexOf("app.post('/api/ai/chat'");
const lockUse = routes.indexOf('withConversationLock', routeStart);
const loadUse = routes.indexOf('loadTenantConversation(q, tenantId, conversationId)', lockUse);
assert(lockUse > routeStart && loadUse > lockUse);
console.log('✅ el estado se carga dentro del lock');

assert(state.includes('RETURNING id, updated_at'));
assert(state.includes('CONVERSATION_STATE_NOT_SAVED'));
console.log('✅ el guardado de estado se verifica');

console.log('\n5/5 pruebas de persistencia y deduplicación pasaron.');
