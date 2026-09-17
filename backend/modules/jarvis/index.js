'use strict';

/**
 * JARVIS backend module.
 * Se monta sobre el MISMO Express app, PostgreSQL q(), JWT, tenant y sucursal
 * del backend central. No abre puerto y no crea otro Web Service.
 */
function setupJarvisRoutes(app, q, deps = {}) {
  const { authRequired, getTenantId, getSucursal } = deps;

  if (!app || typeof app.get !== 'function') {
    throw new Error('JARVIS requiere una instancia Express válida');
  }
  if (typeof q !== 'function') {
    throw new Error('JARVIS requiere el query runner q() del backend central');
  }
  if (typeof authRequired !== 'function' ||
      typeof getTenantId !== 'function' ||
      typeof getSucursal !== 'function') {
    throw new Error('JARVIS requiere authRequired, getTenantId y getSucursal');
  }

  // Candado global: todo /api/jarvis exige la misma sesión JWT del backend.
  app.use('/api/jarvis', authRequired);

  app.get('/api/jarvis/health', (req, res) => {
    res.json({
      ok: true,
      service: 'jarvis',
      mode: 'central-backend-module',
      tenant_id: getTenantId(req),
      sucursal_id: getSucursal(req),
      capabilities: {
        voice: 'reserved-f1-core',
        agenda: 'foundation',
        reminders: 'foundation',
        email: 'planned',
        whatsapp: 'central-bridge',
        calls: 'planned',
        realtime_web: 'planned'
      }
    });
  });

  // Primer endpoint de contexto: comprueba que Jarvis puede usar la BD central
  // respetando tenant y sucursal, sin duplicar conexiones.
  app.get('/api/jarvis/context', async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const sucursalId = getSucursal(req);

      const result = await q(
        `SELECT
           (SELECT COUNT(*)::int
              FROM appointments
             WHERE tenant_id=$1
               AND (sucursal_id=$2 OR sucursal_id IS NULL)
               AND date = CURRENT_DATE) AS citas_hoy,
           (SELECT COUNT(*)::int
              FROM inventory
             WHERE tenant_id=$1
               AND (sucursal_id=$2 OR sucursal_id IS NULL)
               AND quantity <= min_stock) AS inventario_bajo`,
        [tenantId, sucursalId]
      );

      res.json({
        ok: true,
        tenant_id: tenantId,
        sucursal_id: sucursalId,
        today: result.rows?.[0] || { citas_hoy: 0, inventario_bajo: 0 }
      });
    } catch (error) {
      console.error('❌ JARVIS /context:', error);
      res.status(500).json({ ok: false, error: 'No se pudo obtener el contexto de JARVIS' });
    }
  });

  console.log('✅ JARVIS montado en /api/jarvis usando el backend central');
}

module.exports = { setupJarvisRoutes };
