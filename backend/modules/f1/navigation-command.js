"use strict";
// Solo órdenes completas de navegación. Las órdenes compuestas siguen al modelo.
const modules = {
  objetivos: 'objetivos', metas: 'objetivos', agenda: 'agenda', calendario: 'agenda',
  caja: 'caja', pagos: 'caja', reportes: 'reportes', productividad: 'reportes',
  laboratorio: 'laboratorio', laboratorios: 'laboratorio', inventario: 'inventario',
  facturacion: 'facturacion', expediente: 'expediente', historial: 'expediente',
  whatsapp: 'whatsapp', empresa: 'empresas', empresas: 'empresas'
};
function parseNavigationCommand(value) {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const match = normalized.match(/^(?:(?:hana|hanna|f1)[,:]?\s+)?(?:abre|abrir|muestra|muestrame|ve a|llevame a)\s+(?:(?:el|la|los|las)\s+)?(?:(?:panel|modulo)\s+(?:de\s+)?)?([a-z]+)\s*(?:[,;]\s*sin (?:crear ni modificar datos|modificar datos|crear ni modificar facturas))?[.!]?$/);
  return match ? modules[match[1]] || null : null;
}
module.exports = { parseNavigationCommand };
