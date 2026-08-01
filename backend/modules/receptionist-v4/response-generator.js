'use strict';

const { formatDate, formatTime } = require('./utils');
const { getBranchDisplayName } = require('../tenant-context');

function ask(field, state, serviceList=[]) {
  const prompts = {
    branch: '¿En cuál sucursal prefieres atenderte: Victoria o Condesa?',
    service: `¿Qué servicio necesitas? ${serviceList.length ? `Por ejemplo: ${serviceList.slice(0,5).map(s=>s.name).join(', ')}.` : ''}`.trim(),
    date: `Perfecto${state.branch_key ? `, en ${getBranchDisplayName(state.branch_key)}` : ''}. ¿Qué día te gustaría asistir?`,
    availability: '¿Qué hora prefieres aproximadamente?',
    phone: '¿Qué número de 10 dígitos deseas dejar para la confirmación?',
    patient: '¿A nombre de quién registro la cita?',
  };
  return prompts[field] || '¿Me ayudas con el dato que falta?';
}

function slotOffer(state, exactUnavailable=false) {
  const slot = state.proposed_slot;
  if (!slot) return 'No encontré disponibilidad ese día. ¿Qué otro día te gustaría?';
  if (exactUnavailable && state.time_preference?.value) {
    return `A las ${formatTime(state.time_preference.value)} no tengo espacio disponible. La opción más cercana es ${formatDate(slot.date)} a las ${formatTime(slot.start_time)}. ¿Te funciona?`;
  }
  return `Tengo disponibilidad ${formatDate(slot.date)} a las ${formatTime(slot.start_time)}. ¿Te funciona?`;
}

function summary(state) {
  return [
    'Perfecto. Antes de guardarla, confirma estos datos:',
    `• Nombre: ${state.patient}`,
    `• Teléfono: ${state.phone}`,
    `• Servicio: ${state.service_name}`,
    `• Fecha: ${formatDate(state.selected_slot?.date)}`,
    `• Hora: ${formatTime(state.selected_slot?.start_time)}`,
    `• Sucursal: ${getBranchDisplayName(state.branch_key)}`,
    '',
    '¿Confirmas que deseas agendarla?',
  ].join('\n');
}

function booked(created, state) {
  return [
    '✅ Tu cita quedó registrada correctamente.',
    `• Folio: ${created.id}`,
    `• Nombre: ${created.patient || state.patient}`,
    `• Servicio: ${state.service_name}`,
    `• Fecha: ${formatDate(created.date || state.selected_slot?.date)}`,
    `• Hora: ${formatTime(created.start_time || state.selected_slot?.start_time)}`,
    `• Sucursal: ${getBranchDisplayName(state.branch_key)}`,
    '',
    'Te esperamos 😊',
  ].join('\n');
}

function resume(state, missing) {
  const known = [
    state.branch_key ? `sucursal ${getBranchDisplayName(state.branch_key)}` : null,
    state.service_name ? `servicio ${state.service_name}` : null,
    state.date ? `fecha ${formatDate(state.date)}` : null,
    state.selected_slot?.start_time ? `hora ${formatTime(state.selected_slot.start_time)}` : null,
    state.patient ? `nombre ${state.patient}` : null,
  ].filter(Boolean);
  const first = known.length ? `Hasta ahora tengo: ${known.join(', ')}.` : 'Continuemos con tu cita.';
  return first;
}

module.exports = { ask, slotOffer, summary, booked, resume };
