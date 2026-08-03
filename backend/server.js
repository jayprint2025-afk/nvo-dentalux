console.log('🚨 EMERGENCY - server.js INICIADO EN BACKEND FOLDER');
console.log('🗂️ Directorio de trabajo:', process.cwd());
console.log('🗂️ __dirname:', __dirname);

// server.js — Dentalux Backend (Render-ready)
/**
 * - CORS permisivo (incluye cache-control, x-sucursal) para preflights
 * - Lee sucursal via ?sucursal=, header x-sucursal o body.sucursal_id
 * - Filtro por sucursal en todas las rutas
 * - Esquema multi-sucursal + (laboratorios, trabajos, abonos, pagos_laboratorio, objetivos)
 * - FACTURACIÓN: /api/facturacion/* (configuración, facturas+conceptos, clientes, productos)
 */

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

console.log('🔥 SERVER.JS INICIANDO - LÍNEA 13');

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { f1EventBus } = require('./modules/f1/event-bus');


// =========================================================
// AUTENTICACIÓN GLOBAL — debe declararse antes de las rutas
// =========================================================
const GLOBAL_JWT_SECRET = String(process.env.JWT_SECRET || '').trim();

function requireGlobalJwtSecret() {
  if (!GLOBAL_JWT_SECRET) {
    const error = new Error('Falta JWT_SECRET en las variables de entorno');
    error.statusCode = 503;
    throw error;
  }
  return GLOBAL_JWT_SECRET;
}

function authRequired(req, res, next) {
  try {
    const header = String(req.headers.authorization || '');
    const match = header.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return res.status(401).json({ error: 'Sesión requerida' });
    }

    req.auth = jwt.verify(match[1], requireGlobalJwtSecret());
    const store = als.getStore();
    if (store) store.tenantId = req.auth?.tenantId || null;
    next();
  } catch (error) {
    return res.status(401).json({
      error: error?.name === 'TokenExpiredError'
        ? 'La sesión expiró. Inicia sesión nuevamente.'
        : 'Sesión inválida'
    });
  }
}

function getTenantId(req) {
  const tenantId = req?.auth?.tenantId;
  if (!tenantId) {
    const error = new Error('No se pudo identificar la empresa de la sesión');
    error.status = 401;
    throw error;
  }
  return tenantId;
}
const { AsyncLocalStorage } = require('async_hooks');


// =========================================================
// CONFIGURACIÓN CENTRAL — RENDER + UNA SOLA BASE DE DATOS
// =========================================================
const app = express();
const PORT = Number(process.env.PORT || 4001);

app.set('trust proxy', 1);
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(morgan('combined'));

const allowedOrigins = String(process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`⚠️ Origen CORS no autorizado: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Cache-Control',
    'Pragma',
    'x-sucursal',
    'x-app',
    'x-db',
    'x-db-key',
    'x-wa-phone-number-id',
    'x-phone-number-id',
    'x-wa-phone',
    'x-channel',
    'x-page-id'
  ]
}));

const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_URL_DB1;
if (!DATABASE_URL) {
  throw new Error('Falta DATABASE_URL en las variables de entorno');
}

const poolDB1 = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000
});

// DB2 y DB3 quedan neutralizadas. Todas las rutas usan poolDB1.
const poolDB2 = null;
const poolDB3 = null;
const als = new AsyncLocalStorage();

function normalizeSucursal(value) {
  const sucursal = String(value || '').trim().toLowerCase();
  if (sucursal === 'condesa' || sucursal === 'sucursal_2' || sucursal === '2') {
    return 'sucursal_2';
  }
  return 'sucursal_1';
}

function getSucursal(req) {
  return normalizeSucursal(
    req?.query?.sucursal ||
    req?.headers?.['x-sucursal'] ||
    req?.body?.sucursal_id ||
    process.env.SUCURSAL_ID_DEFAULT ||
    'sucursal_1'
  );
}

function pickDbKey() {
  return 'db1';
}

function getCurrentPool() {
  return als.getStore()?.pool || poolDB1;
}

async function q(text, params = []) {
  const pool = getCurrentPool();
  const tenantId = als.getStore()?.tenantId || null;
  if (!tenantId) return pool.query(text, params);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [String(tenantId)]);
    const result = await client.query(text, params);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Las rutas antiguas /api/melissa también usan la misma base física.
async function qMelissa(text, params = []) {
  return poolDB1.query(text, params);
}

app.use((req, _res, next) => {
  als.run({ pool: poolDB1, dbKey: 'db1', sucursal: getSucursal(req) }, next);
});

poolDB1.on('error', (error) => {
  console.error('❌ Error inesperado en PostgreSQL:', error);
});

console.log('✅ Servidor configurado para una sola base de datos (DB1)');


// Helper para async/await con manejo de errores
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);


// Verificación explícita del módulo médico
console.log('🚀 INICIANDO CARGA DEL MÓDULO MÉDICO...');
console.log('📁 Directorio actual:', __dirname);
console.log('🗂️ Archivos en directorio:', require('fs').readdirSync(__dirname).filter(f => f.includes('medical')));

let medicalRecordModule;
try {
  console.log('🔍 Intentando cargar ./medical-record-server.js...');
  medicalRecordModule = require('./medical-record-server.js');
  console.log('✅ Módulo médico cargado exitosamente');
  console.log('🔍 Funciones disponibles:', Object.keys(medicalRecordModule));
} catch (error) {
  console.error('❌ ERROR CARGANDO MÓDULO MÉDICO:', error.message);
  console.error('❌ Stack:', error.stack);
  
  // Intentar con path absoluto
  try {
    console.log('🔄 Intentando con path absoluto...');
    medicalRecordModule = require(__dirname + '/medical-record-server.js');
    console.log('✅ Módulo médico cargado con path absoluto');
    console.log('🔍 Funciones disponibles:', Object.keys(medicalRecordModule));
  } catch (error2) {
    console.error('❌ ERROR TAMBIÉN CON PATH ABSOLUTO:', error2.message);
    medicalRecordModule = null;
  }
}

// ================================
// 🤖 IA LEGACY DESACTIVADA
// ================================
// No cargar ./ai-conversations-module.js porque choca con:
// ./modules/ai-saas-routes + ./modules/ai-orchestrator
console.log(
  `ℹ️ IA clínica legacy desactivada. Motor configurado: ${
    process.env.RECEPTIONIST_ENGINE_VERSION ||
    process.env.RECEPTIONIST_VERSION ||
    'v5'
  }.`
);
let aiModule = null;

// ================================
// 🧩 Compatibilidad IA SaaS / WhatsApp identifiers
// Crea clinic_channels y perfiles para PHONE_NUMBER_ID nuevo y WABA_ID viejo.
// Esto evita errores tipo: relation "clinic_channels" does not exist
// y evita que la IA deje de responder al cambiar el número de WhatsApp.
// ================================
async function ensureAiSaasCompatibilityTables() {
  // Migración interna: usa bypass RLS solamente dentro de esta transacción.
  const pool = getCurrentPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_bypass', 'on', true)`);

    const adminQ = (sql, params = []) => client.query(sql, params);

    await adminQ(`
      CREATE TABLE IF NOT EXISTS clinic_channels (
        id SERIAL PRIMARY KEY,
        tenant_id UUID,
        phone_number_id TEXT,
        channel TEXT DEFAULT 'whatsapp',
        name TEXT,
        clinic_name TEXT,
        branch_key TEXT,
        sucursal_id TEXT,
        db_key TEXT DEFAULT 'db1',
        active BOOLEAN DEFAULT TRUE,
        is_active BOOLEAN DEFAULT TRUE,
        config JSONB DEFAULT '{}'::jsonb,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await adminQ(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS tenant_id UUID`);
    await adminQ(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS phone_number_id TEXT`);
    await adminQ(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'whatsapp'`);
    await adminQ(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS name TEXT`);
    await adminQ(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS clinic_name TEXT`);
    await adminQ(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS branch_key TEXT`);
    await adminQ(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS sucursal_id TEXT`);
    await adminQ(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS db_key TEXT DEFAULT 'db1'`);
    await adminQ(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE`);
    await adminQ(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`);
    await adminQ(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb`);
    await adminQ(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb`);
    await adminQ(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
    await adminQ(`ALTER TABLE clinic_channels ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
    await adminQ(`CREATE INDEX IF NOT EXISTS idx_clinic_channels_phone ON clinic_channels(phone_number_id)`);
    await adminQ(`CREATE INDEX IF NOT EXISTS idx_clinic_channels_suc ON clinic_channels(sucursal_id)`);
    await adminQ(`CREATE INDEX IF NOT EXISTS idx_clinic_channels_tenant ON clinic_channels(tenant_id)`);

    // Los canales y la información pública de cada sucursal se administran
    // desde Configuración > Empresas. No insertar datos fijos globales aquí.

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}


// ================================
// 🤖 IA SaaS: rutas adicionales (/api/ai/chat)
// Todas las rutas IA exigen JWT; el webhook usa un JWT interno de 2 minutos.
// ================================
app.use('/api/ai', authRequired);
try {
  // Asegura tablas de compatibilidad IA antes de montar /api/ai/chat
  ensureAiSaasCompatibilityTables()
    .then(async () => {
      console.log('✅ clinic_channels OK (DB1)');
      if (poolDB2) {
        await als.run({ pool: poolDB2, dbKey: 'db2' }, () => ensureAiSaasCompatibilityTables());
        console.log('✅ clinic_channels OK (DB2)');
      }
      if (poolDB3) {
        await als.run({ pool: poolDB3, dbKey: 'db3' }, () => ensureAiSaasCompatibilityTables());
        console.log('✅ clinic_channels OK (DB3)');
      }
    })
    .catch(e => console.error('❌ ensureAiSaasCompatibilityTables', e));

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🤖 Cargando módulo AI SaaS routes (NUEVO SISTEMA)...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const aiSaasModule = require('./modules/ai-saas-routes');
  if (aiSaasModule && typeof aiSaasModule.setupAiSaasRoutes === 'function') {
    aiSaasModule.setupAiSaasRoutes(app, q);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ AI SaaS ROUTES ACTIVAS (SELECTOR V4/V5)');
    console.log('   📍 /api/ai/chat - Recepcionista seleccionada por tenant');
    console.log('   📍 /api/ai/conversations - Gestión de conversaciones');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } else {
    console.error('❌ Módulo AI SaaS no tiene función setupAiSaasRoutes');
  }
} catch (error) {
  console.error('❌ Error cargando módulo AI SaaS:', error.message);
  console.error('Stack:', error.stack);
}


// Test endpoint para verificar que el servidor funciona
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    medicalModule: medicalRecordModule ? 'Disponible' : 'No disponible',
    sucursal: getSucursal(req)
  });
});

app.get('/api/expediente-medico/test', ah(async (req, res) => {
  const sucursalId = getSucursal(req);
  
  try {
    if (!medicalRecordModule) {
      return res.status(503).json({ 
        error: 'Módulo médico no disponible',
        sucursal: sucursalId
      });
    }

    // Test simple de conectividad a la base de datos
    const testQuery = await q('SELECT NOW() as current_time');
    
    res.json({
      status: 'OK',
      message: 'Módulo médico funcionando correctamente',
      sucursal: sucursalId,
      database: 'Conectada',
      timestamp: testQuery.rows[0].current_time
    });
  } catch (error) {
    console.error('Error en test médico:', error);
    res.status(500).json({ 
      error: error.message,
      sucursal: sucursalId
    });
  }
}));

// Montar rutas médicas con autenticación y contexto multi-tenant.
if (medicalRecordModule && typeof medicalRecordModule.setupMedicalRecordRoutes === 'function') {
  medicalRecordModule.setupMedicalRecordRoutes(app, q, { authRequired, getTenantId });
  console.log('✅ Rutas médicas multi-tenant configuradas');
}




// Logging detallado para escrituras
app.use((req, _res, next) => {
  if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
    console.log(`\n=== ${req.method} ${req.path} ===`);
    console.log('Headers:', JSON.stringify({
      'content-type': req.headers['content-type'],
      'x-sucursal': req.headers['x-sucursal'],
      'x-app': req.headers['x-app'],
      'x-db': req.headers['x-db'],
      'origin': req.headers.origin
    }, null, 2));
    console.log('Query params:', req.query);
    const safeBody = { ...(req.body || {}) };
    if ('password' in safeBody) safeBody.password = '[OCULTA]';
    if ('password_hash' in safeBody) safeBody.password_hash = '[OCULTA]';
    console.log('Body received:', JSON.stringify(safeBody, null, 2));
    console.log('Sucursal detected:', getSucursal(req));
    console.log('========================\n');
  }
  next();
});
app.disable('etag');
app.use((_, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

const sucWhereN = (idx, alias = '') => {
  const p = alias ? `${alias}.` : '';
  return `(${p}sucursal_id = $${idx} OR ${p}sucursal_id IS NULL)`;
};


// 🔹 AGREGAR AQUÍ (línea 194):
// Función para números seguros
function safeNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}


function publishAppointmentEvent(name, appointment, req, extra = {}) {
  if (!appointment) return null;

  try {
    return f1EventBus.emit(
      name,
      {
        appointment_id: appointment.id || null,
        patient: appointment.patient || null,
        date: appointment.date || null,
        start_time: appointment.start_time || null,
        status: appointment.status || null,
        doctor_id: appointment.doctor_id || null,
        service_id: appointment.service_id || null,
        ...extra,
      },
      {
        tenant_id: getTenantId(req),
        branch_key: getSucursal(req),
        user_id: req.auth?.sub || null,
        source: 'agenda-api',
      }
    );
  } catch (error) {
    // La publicación de un evento nunca debe revertir una operación ya guardada.
    console.warn('⚠️ Event Bus Agenda:', error.message);
    return null;
  }
}

function classifyAppointmentUpdate(previous, updated) {
  const beforeStatus = String(previous?.status || '').trim().toLowerCase();
  const afterStatus = String(updated?.status || '').trim().toLowerCase();

  if (afterStatus.includes('cancel') && beforeStatus !== afterStatus) {
    return 'appointment.cancelled';
  }
  if (afterStatus.includes('confirm') && beforeStatus !== afterStatus) {
    return 'appointment.confirmed';
  }

  const beforeDate = String(previous?.date || '').slice(0, 10);
  const afterDate = String(updated?.date || '').slice(0, 10);
  const beforeTime = String(previous?.start_time || '').slice(0, 5);
  const afterTime = String(updated?.start_time || '').slice(0, 5);

  if (beforeDate !== afterDate || beforeTime !== afterTime) {
    return 'appointment.rescheduled';
  }

  return 'appointment.updated';
}

// ===================================================================
// Esquema / migraciones (incluye migraciones defensivas de facturación)
// ===================================================================
async function ensureMultiSucursalSchema() {
  await q(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  // Laboratorios
  await q(`
    CREATE TABLE IF NOT EXISTS laboratorios (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      contacto TEXT,
      sucursal_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Trabajos de laboratorio
  await q(`
    CREATE TABLE IF NOT EXISTS lab_trabajos (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      paciente TEXT NOT NULL,
      laboratorio_id INTEGER REFERENCES laboratorios(id),
      servicio_id INTEGER REFERENCES services(id),
      presupuesto NUMERIC NOT NULL,
      fecha_inicio DATE,
      fecha_entrega_estimada DATE,
      etapa TEXT DEFAULT 'Toma de impresión',
      notas TEXT,
      sucursal_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Abonos de laboratorio
  await q(`
    CREATE TABLE IF NOT EXISTS lab_abonos (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      trabajo_id TEXT REFERENCES lab_trabajos(id),
      monto NUMERIC NOT NULL,
      fecha DATE DEFAULT CURRENT_DATE,
      nota TEXT,
      sucursal_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Listado de tablas multi-sucursal existentes
  const tables = [
    'doctors','services','appointments','payments','expenses',
    'laboratorios','lab_trabajos','lab_abonos','objetivos'
  ];
  for (const t of tables) {
    await q(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS sucursal_id TEXT;`);
    await q(`CREATE INDEX IF NOT EXISTS idx_${t}_sucursal ON ${t}(sucursal_id);`);
    await q(`UPDATE ${t} SET sucursal_id='sucursal_1' WHERE sucursal_id IS NULL;`);
  }
  await q(`ALTER TABLE objetivos ADD COLUMN IF NOT EXISTS doctor_id INTEGER;`);
  await q(`CREATE INDEX IF NOT EXISTS idx_objetivos_doctor ON objetivos(doctor_id);`);

  // Normalizar appointments.date a DATE
  try {
    const { rows: dateTypeCheck } = await q(`
      SELECT data_type 
      FROM information_schema.columns 
      WHERE table_name = 'appointments' AND column_name = 'date'
    `);
    if (dateTypeCheck.length > 0 && dateTypeCheck[0].data_type !== 'date') {
      await q(`ALTER TABLE appointments ALTER COLUMN date TYPE DATE`);
    } else if (dateTypeCheck.length === 0) {
      await q(`ALTER TABLE appointments ADD COLUMN date DATE`);
    }
  } catch (error) {
    console.error('❌ Error configurando tipo DATE:', error.message);
  }
// 🆕 Tabla de inventario
  await q(`
    CREATE TABLE IF NOT EXISTS inventory (
      id SERIAL PRIMARY KEY,
      sku VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(50) NOT NULL CHECK (category IN ('instrumental', 'desechable', 'anestesia', 'resina', 'endodoncia', 'ortodoncia')),
      type VARCHAR(50) NOT NULL CHECK (type IN ('equipment', 'material')),
      quantity INTEGER DEFAULT 0 CHECK (quantity >= 0),
      min_stock INTEGER DEFAULT 10 CHECK (min_stock >= 0),
      max_stock INTEGER DEFAULT 100 CHECK (max_stock >= min_stock),
      price NUMERIC(10,2) DEFAULT 0 CHECK (price >= 0),
      supplier VARCHAR(255),
      last_purchase DATE,
      usage_per_patient NUMERIC(5,2) DEFAULT 1 CHECK (usage_per_patient > 0),
      expiration_date DATE,
      sucursal_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_inventory_sucursal ON inventory(sucursal_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory(category)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_inventory_type ON inventory(type)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_inventory_sku ON inventory(sku)`);
  await q(`UPDATE inventory SET sucursal_id = 'sucursal_1' WHERE sucursal_id IS NULL`);
  
  console.log('✅ Tabla de inventario verificada');

  // Pagos laboratorio
  await q(`
    CREATE TABLE IF NOT EXISTS pagos_laboratorio (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      trabajo_id TEXT NOT NULL,
      monto NUMERIC NOT NULL,
      fecha DATE DEFAULT CURRENT_DATE,
      sucursal_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await q(`CREATE INDEX IF NOT EXISTS idx_pagos_laboratorio_trabajo ON pagos_laboratorio(trabajo_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_pagos_laboratorio_sucursal ON pagos_laboratorio(sucursal_id);`);
  await q(`UPDATE pagos_laboratorio SET sucursal_id='sucursal_1' WHERE sucursal_id IS NULL;`);

  // ==============================
  // FACTURACIÓN: tablas base
  // ==============================
  await q(`
    CREATE TABLE IF NOT EXISTS facturas (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      cliente TEXT NOT NULL,
      tipo TEXT NOT NULL,               -- 'ingreso', 'egreso', 'traslado', etc.
      forma_pago TEXT,                  -- catálogo SAT
      metodo_pago TEXT,                 -- PUE/PPD
      cita_id INTEGER REFERENCES appointments(id),
      notas TEXT,
      total NUMERIC NOT NULL DEFAULT 0,
      sucursal_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

// 👉 Nuevas columnas para timbrado/estado (idempotente)
await q(`
  ALTER TABLE facturas
    ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'borrador',
    ADD COLUMN IF NOT EXISTS uuid TEXT,
    ADD COLUMN IF NOT EXISTS serie TEXT,
    ADD COLUMN IF NOT EXISTS folio INTEGER,
    ADD COLUMN IF NOT EXISTS fecha_timbrado TIMESTAMP,
    ADD COLUMN IF NOT EXISTS timbrada_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS status TEXT,
    ADD COLUMN IF NOT EXISTS cancelada_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS cfdi_id TEXT,
    ADD COLUMN IF NOT EXISTS motivo_cancelacion TEXT
`);
await q(`CREATE INDEX IF NOT EXISTS idx_facturas_estado ON facturas(estado)`);


  await q(`
    CREATE TABLE IF NOT EXISTS factura_conceptos (
      id SERIAL PRIMARY KEY,
      factura_id TEXT REFERENCES facturas(id) ON DELETE CASCADE,
      descripcion TEXT NOT NULL,
      cantidad NUMERIC NOT NULL,
      valor_unitario NUMERIC NOT NULL,
      importe NUMERIC NOT NULL,
      clave_prod_serv TEXT,
      unidad TEXT,
      objeto_imp TEXT,
      sucursal_id TEXT
    );
  `);

  // Clientes de facturación (opcional, usado por la UI)
  await q(`
    CREATE TABLE IF NOT EXISTS facturacion_clientes (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      rfc TEXT NOT NULL,
      razon_social TEXT NOT NULL,
      email TEXT,
      telefono TEXT,
      direccion TEXT,
      uso_cfdi TEXT,
      sucursal_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  // 🔧 Nuevas columnas (idempotentes)
  await q(`
    ALTER TABLE facturacion_clientes
      ADD COLUMN IF NOT EXISTS codigo_postal  TEXT,
      ADD COLUMN IF NOT EXISTS regimen_fiscal TEXT;
  `);

  // === Catálogo de productos/servicios de facturación
  await q(`
    CREATE TABLE IF NOT EXISTS facturacion_productos (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      descripcion TEXT NOT NULL,
      clave_prod_serv TEXT,  -- e.g. 85121800
      unidad TEXT,           -- e.g. E48
      objeto_imp TEXT,       -- e.g. 02
      precio NUMERIC DEFAULT 0,
      sucursal_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

 // === Configuración de facturación por sucursal
await q(`
  CREATE TABLE IF NOT EXISTS facturacion_configuracion (
    sucursal_id     TEXT PRIMARY KEY,
    rfc             TEXT NOT NULL,
    razon_social    TEXT NOT NULL,
    regimen_fiscal  TEXT NOT NULL,
    codigo_postal   TEXT NOT NULL,
    pac_proveedor   TEXT NOT NULL DEFAULT 'facturama',
    pac_usuario     TEXT NOT NULL,
    pac_password    TEXT NOT NULL,
    pac_url_timbrado     TEXT,
    pac_url_cancelacion  TEXT,
    serie_facturas  TEXT DEFAULT '',
    ultimo_folio    INTEGER DEFAULT 1,
    ambiente        TEXT NOT NULL CHECK (ambiente IN ('pruebas','produccion')),
    activo          BOOLEAN DEFAULT TRUE,
    logo_url        TEXT,
    logo_image      BYTEA,
    logo_mime       TEXT,
    cer_file        BYTEA,
    key_file        BYTEA,
    key_password    TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
  );
`);

// Agregar columnas a tablas existentes (migración defensiva)
await q(`
  ALTER TABLE facturacion_configuracion 
    ADD COLUMN IF NOT EXISTS cer_file BYTEA,
    ADD COLUMN IF NOT EXISTS key_file BYTEA,
    ADD COLUMN IF NOT EXISTS key_password TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
`);


  // Índices y backfills
  await q(`CREATE INDEX IF NOT EXISTS idx_facturas_sucursal ON facturas(sucursal_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_factura_conceptos_factura ON factura_conceptos(factura_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_fact_cli_sucursal ON facturacion_clientes(sucursal_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_fact_prod_sucursal ON facturacion_productos(sucursal_id);`);
  await q(`UPDATE facturas SET sucursal_id='sucursal_1' WHERE sucursal_id IS NULL;`);
  await q(`UPDATE factura_conceptos SET sucursal_id='sucursal_1' WHERE sucursal_id IS NULL;`);
  await q(`UPDATE facturacion_clientes SET sucursal_id='sucursal_1' WHERE sucursal_id IS NULL;`);
  await q(`UPDATE facturacion_productos SET sucursal_id='sucursal_1' WHERE sucursal_id IS NULL;`);

  // ==============================
  // FACTURACIÓN: migraciones defensivas (si existían tablas viejas)
  // ==============================
  await q(`
    ALTER TABLE facturas
      ADD COLUMN IF NOT EXISTS cliente TEXT,
      ADD COLUMN IF NOT EXISTS tipo TEXT,
      ADD COLUMN IF NOT EXISTS forma_pago TEXT,
      ADD COLUMN IF NOT EXISTS metodo_pago TEXT,
      ADD COLUMN IF NOT EXISTS cita_id INTEGER,
      ADD COLUMN IF NOT EXISTS notas TEXT,
      ADD COLUMN IF NOT EXISTS total NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sucursal_id TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
  `);
  await q(`UPDATE facturas SET cliente = COALESCE(cliente,'Sin nombre');`);
  await q(`UPDATE facturas SET tipo    = COALESCE(tipo,'ingreso');`);

  await q(`
    ALTER TABLE factura_conceptos
      ADD COLUMN IF NOT EXISTS factura_id TEXT,
      ADD COLUMN IF NOT EXISTS descripcion TEXT,
      ADD COLUMN IF NOT EXISTS cantidad NUMERIC,
      ADD COLUMN IF NOT EXISTS valor_unitario NUMERIC,
      ADD COLUMN IF NOT EXISTS importe NUMERIC,
      ADD COLUMN IF NOT EXISTS clave_prod_serv TEXT,
      ADD COLUMN IF NOT EXISTS unidad TEXT,
      ADD COLUMN IF NOT EXISTS objeto_imp TEXT,
      ADD COLUMN IF NOT EXISTS sucursal_id TEXT;
  `);

  await q(`
    ALTER TABLE facturacion_productos
      ADD COLUMN IF NOT EXISTS descripcion TEXT,
      ADD COLUMN IF NOT EXISTS clave_prod_serv TEXT,
      ADD COLUMN IF NOT EXISTS unidad TEXT,
      ADD COLUMN IF NOT EXISTS objeto_imp TEXT,
      ADD COLUMN IF NOT EXISTS precio NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sucursal_id TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
  `);

  // === OBJETIVOS (garantizar columnas/índices)
  await q(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='objetivos') THEN
        CREATE TABLE objetivos (
          id SERIAL PRIMARY KEY,
          doctor_id INTEGER,
          meta NUMERIC DEFAULT 0,
          sueldo_base NUMERIC DEFAULT 0,
          periodo_inicio DATE,
          periodo_fin DATE,
          sucursal_id TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        );
      END IF;
    END$$;
  `);

  await q(`
    ALTER TABLE objetivos
      ADD COLUMN IF NOT EXISTS doctor_id INTEGER,
      ADD COLUMN IF NOT EXISTS meta NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sueldo_base NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS periodo_inicio DATE,
      ADD COLUMN IF NOT EXISTS periodo_fin DATE,
      ADD COLUMN IF NOT EXISTS sucursal_id TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_objetivos_sucursal ON objetivos(sucursal_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_objetivos_periodo ON objetivos(periodo_inicio, periodo_fin);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_objetivos_doctor ON objetivos(doctor_id);`);
  await q(`UPDATE objetivos SET sucursal_id='sucursal_1' WHERE sucursal_id IS NULL;`);
  // 🆕 Tabla de satisfacción del servicio
  await q(`
    CREATE TABLE IF NOT EXISTS satisfaccion_servicio (
      id SERIAL PRIMARY KEY,
      appointment_id INTEGER,
      service_id INTEGER,
      patient_id UUID,
      doctor_id INTEGER,
      rating NUMERIC(3,1),
      comentario TEXT,
      sucursal_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Asegurar columna sucursal_id por si la tabla se creó manual antes
  await q(`ALTER TABLE satisfaccion_servicio ADD COLUMN IF NOT EXISTS sucursal_id TEXT`);
  await q(`CREATE INDEX IF NOT EXISTS idx_satisfaccion_sucursal ON satisfaccion_servicio(sucursal_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_satisfaccion_service  ON satisfaccion_servicio(service_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_satisfaccion_created  ON satisfaccion_servicio(created_at DESC)`);



  console.log('✅ Esquema multi-sucursal verificado/actualizado (incluye FACTURACIÓN + migraciones defensivas + catálogo de productos).');
}

// =========================================
// RUTAS PARA MELISSA-APP-DB
// =========================================

// Health check para MELISSA
app.get('/api/melissa/health', ah(async (req, res) => {
  if (!qMelissa) {
    return res.status(503).json({ 
      ok: false, 
      error: 'MELISSA_DATABASE_URL no configurada' 
    });
  }
  try {
    await qMelissa('SELECT 1');
    res.json({ ok: true, database: 'MELISSA-APP-DB' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
}));

// Appointments en MELISSA
app.get('/api/melissa/appointments', ah(async (req, res) => {
  if (!qMelissa) {
    return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  }
  const { rows } = await qMelissa('SELECT * FROM appointments ORDER BY date DESC');
  res.json(rows);
}));

app.post('/api/melissa/appointments', ah(async (req, res) => {
  if (!qMelissa) {
    return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  }
  const { patient, doctor_id, date, start_time, service_id, phone } = req.body || {};
  const { rows } = await qMelissa(
    `INSERT INTO appointments (patient, doctor_id, date, start_time, service_id, phone, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'Pendiente')
     RETURNING *`,
    [patient, doctor_id || null, date, start_time || '09:00', service_id || null, phone || null]
  );
  res.json(rows[0]);
}));

// Patients en MELISSA
app.get('/api/melissa/patients', ah(async (req, res) => {
  if (!qMelissa) {
    return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  }
  const { rows } = await qMelissa('SELECT * FROM patients ORDER BY id DESC');
  res.json(rows);
}));

app.post('/api/melissa/patients', ah(async (req, res) => {
  if (!qMelissa) {
    return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  }
  const { name, email, phone } = req.body || {};
  const { rows } = await qMelissa(
    `INSERT INTO patients (name, email, phone) VALUES ($1, $2, $3) RETURNING *`,
    [name, email || null, phone || null]
  );
  res.json(rows[0]);
}));

// Services en MELISSA
app.get('/api/melissa/services', ah(async (req, res) => {
  if (!qMelissa) {
    return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  }
  const { rows } = await qMelissa('SELECT * FROM services ORDER BY id ASC');
  res.json(rows);
}));

app.post('/api/melissa/services', ah(async (req, res) => {
  if (!qMelissa) {
    return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  }
  const { name } = req.body || {};
  const { rows } = await qMelissa(
    `INSERT INTO services (name) VALUES ($1) RETURNING *`,
    [name]
  );
  res.json(rows[0]);
}));

// Payments en MELISSA
app.get('/api/melissa/payments', ah(async (req, res) => {
  if (!qMelissa) {
    return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  }
  const { rows } = await qMelissa('SELECT * FROM payments ORDER BY date DESC');
  res.json(rows);
}));

app.post('/api/melissa/payments', ah(async (req, res) => {
  if (!qMelissa) {
    return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  }
  const { patient, amount, payment_method, date } = req.body || {};
  const { rows } = await qMelissa(
    `INSERT INTO payments (patient, amount, payment_method, date) 
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [patient, Number(amount), payment_method, date]
  );
  res.json(rows[0]);
}));

// Doctors en MELISSA
app.get('/api/melissa/doctors', ah(async (req, res) => {
  if (!qMelissa) {
    return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  }
  const { rows } = await qMelissa('SELECT * FROM doctors ORDER BY id ASC');
  res.json(rows);
}));

app.post('/api/melissa/doctors', ah(async (req, res) => {
  if (!qMelissa) {
    return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  }
  const { name, color } = req.body || {};
  
  // Primero verifica la estructura de la tabla
  const tableInfo = await qMelissa(`
    SELECT column_name, column_default 
    FROM information_schema.columns 
    WHERE table_name = 'doctors' 
    ORDER BY ordinal_position
  `);
  console.log('📋 Estructura de doctors en MELISSA:', tableInfo.rows);
  
  // Intenta el insert con manejo de columnas opcionales
  const { rows } = await qMelissa(
    `INSERT INTO doctors (name, color, active) 
     VALUES ($1, $2, true) RETURNING *`,
    [name, color || null]
  );
  res.json(rows[0]);
}));

// Expenses en MELISSA
app.get('/api/melissa/expenses', ah(async (req, res) => {
  if (!qMelissa) {
    return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  }
  const { rows } = await qMelissa('SELECT * FROM expenses ORDER BY date DESC');
  res.json(rows);
}));

app.post('/api/melissa/expenses', ah(async (req, res) => {
  if (!qMelissa) {
    return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  }
  const { concept, amount, date } = req.body || {};
  const { rows } = await qMelissa(
    `INSERT INTO expenses (concept, amount, date) VALUES ($1, $2, $3) RETURNING *`,
    [concept, Number(amount), date]
  );
  res.json(rows[0]);
}));

// Laboratorios en MELISSA
app.get('/api/melissa/laboratorios', ah(async (req, res) => {
  if (!qMelissa) {
    return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  }
  const { rows } = await qMelissa('SELECT * FROM laboratorios ORDER BY id ASC');
  res.json(rows);
}));
app.post('/api/melissa/laboratorios', ah(async (req, res) => {
  if (!qMelissa) {
    return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  }
  const { nombre, contacto } = req.body || {};
  const { rows } = await qMelissa(
    `INSERT INTO laboratorios (nombre, contacto) VALUES ($1, $2) RETURNING *`,
    [nombre, contacto || null]
  );
  res.json(rows[0]);
}));

// Trabajos laboratorio en MELISSA
app.get('/api/melissa/trabajos-laboratorio', ah(async (req, res) => {
  if (!qMelissa) {
    return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  }
  const { rows } = await qMelissa('SELECT * FROM lab_trabajos ORDER BY id DESC');
  res.json(rows);
}));

app.post('/api/melissa/trabajos-laboratorio', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { paciente, laboratorio_id, servicio_id, presupuesto, fecha_inicio, fecha_entrega_estimada, etapa, notas } = req.body || {};
  const { rows } = await qMelissa(
    `INSERT INTO lab_trabajos (paciente, laboratorio_id, servicio_id, presupuesto, fecha_inicio, fecha_entrega_estimada, etapa, notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [paciente, laboratorio_id || null, servicio_id || null, presupuesto || 0, fecha_inicio || null, fecha_entrega_estimada || null, etapa || 'Toma de impresión', notas || null]
  );
  res.json(rows[0]);
}));

app.patch('/api/melissa/trabajos-laboratorio/:id', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { etapa, notas } = req.body || {};
  const { rows } = await qMelissa(
    `UPDATE lab_trabajos SET etapa=COALESCE($1,etapa), notas=COALESCE($2,notas) WHERE id=$3 RETURNING *`,
    [etapa, notas, req.params.id]
  );
  res.json(rows[0] || null);
}));

app.post('/api/melissa/trabajos-laboratorio/:id/abonos', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { monto, fecha, nota } = req.body || {};
  const { rows } = await qMelissa(
    `INSERT INTO lab_abonos (trabajo_id, monto, fecha, nota) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.id, Number(monto), fecha || null, nota || null]
  );
  res.json(rows[0]);
}));

// Debug sucursales para MELISSA
app.get('/api/melissa/debug/sucursales', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const tables = ['doctors','services','appointments','payments','expenses','laboratorios','lab_trabajos'];
  const stats = {};
  for (const t of tables) {
    try {
      const { rows } = await qMelissa(`SELECT COUNT(*)::text AS count FROM ${t}`);
      stats[t] = [{ count: rows[0]?.count || '0' }];
    } catch (e) {
      stats[t] = [{ count: '0', error: e.message }];
    }
  }
  res.json({ sucursales: ['melissa'], estadisticas: stats });
}));


app.put('/api/melissa/facturacion/configuracion', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { rfc, razon_social, regimen_fiscal, codigo_postal, pac_proveedor, pac_usuario, pac_password } = req.body || {};
  const { rows } = await qMelissa(
    `INSERT INTO facturacion_configuracion (sucursal_id, rfc, razon_social, regimen_fiscal, codigo_postal, pac_proveedor, pac_usuario, pac_password, ambiente, activo)
     VALUES ('sucursal_1', $1, $2, $3, $4, $5, $6, $7, 'pruebas', true)
     ON CONFLICT (sucursal_id) DO UPDATE SET rfc=$1, razon_social=$2, regimen_fiscal=$3, codigo_postal=$4, pac_proveedor=$5, pac_usuario=$6, pac_password=$7
     RETURNING *`,
    [rfc, razon_social, regimen_fiscal, codigo_postal, pac_proveedor, pac_usuario, pac_password]
  );
  res.json(rows[0]);
}));

// FACTURACIÓN - Clientes
app.get('/api/melissa/facturacion/clientes', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { rows } = await qMelissa(`SELECT * FROM facturacion_clientes ORDER BY created_at DESC`);
  res.json(rows);
}));

app.post('/api/melissa/facturacion/clientes', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { rfc, razon_social, email, telefono, direccion, uso_cfdi, codigo_postal, regimen_fiscal } = req.body || {};
  if (!rfc) return res.status(400).json({ error: 'RFC requerido' });
  const { rows } = await qMelissa(
    `INSERT INTO facturacion_clientes (rfc, razon_social, email, telefono, direccion, uso_cfdi, codigo_postal, regimen_fiscal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [rfc, razon_social, email || null, telefono || null, direccion || null, uso_cfdi || null, codigo_postal || null, regimen_fiscal || null]
  );
  res.json(rows[0]);
}));

app.put('/api/melissa/facturacion/clientes/:id', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { rfc, razon_social, email, telefono, direccion, uso_cfdi, codigo_postal, regimen_fiscal } = req.body || {};
  const { rows } = await qMelissa(
    `UPDATE facturacion_clientes SET rfc=COALESCE($1,rfc), razon_social=COALESCE($2,razon_social), email=COALESCE($3,email), 
     telefono=COALESCE($4,telefono), direccion=COALESCE($5,direccion), uso_cfdi=COALESCE($6,uso_cfdi), 
     codigo_postal=COALESCE($7,codigo_postal), regimen_fiscal=COALESCE($8,regimen_fiscal)
     WHERE id=$9 RETURNING *`,
    [rfc, razon_social, email, telefono, direccion, uso_cfdi, codigo_postal, regimen_fiscal, req.params.id]
  );
  res.json(rows[0] || null);
}));

// FACTURACIÓN - Productos
app.get('/api/melissa/facturacion/productos', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { rows } = await qMelissa(`SELECT * FROM facturacion_productos ORDER BY created_at DESC`);
  res.json(rows);
}));

app.post('/api/melissa/facturacion/productos', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { descripcion, clave_prod_serv, unidad, objeto_imp, precio } = req.body || {};
  const { rows } = await qMelissa(
    `INSERT INTO facturacion_productos (descripcion, clave_prod_serv, unidad, objeto_imp, precio) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [descripcion, clave_prod_serv || null, unidad || null, objeto_imp || null, precio || 0]
  );
  res.json(rows[0]);
}));

app.put('/api/melissa/facturacion/productos/:id', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { descripcion, clave_prod_serv, unidad, objeto_imp, precio } = req.body || {};
  const { rows } = await qMelissa(
    `UPDATE facturacion_productos SET descripcion=COALESCE($1,descripcion), clave_prod_serv=COALESCE($2,clave_prod_serv),
     unidad=COALESCE($3,unidad), objeto_imp=COALESCE($4,objeto_imp), precio=COALESCE($5,precio) WHERE id=$6 RETURNING *`,
    [descripcion, clave_prod_serv, unidad, objeto_imp, precio, req.params.id]
  );
  res.json(rows[0] || null);
}));

app.delete('/api/melissa/facturacion/productos/:id', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  await qMelissa(`DELETE FROM facturacion_productos WHERE id=$1`, [req.params.id]);
  res.status(204).end();
}));

// FACTURACIÓN - Facturas
app.get('/api/melissa/facturacion/facturas', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { desde, hasta, estado } = req.query;
  const params = [];
  const conds = [];
  if (desde) { params.push(desde); conds.push(`created_at::date >= $${params.length}`); }
  if (hasta) { params.push(hasta); conds.push(`created_at::date <= $${params.length}`); }
  if (estado && ['timbrada','borrador','cancelada'].includes(estado)) { params.push(estado); conds.push(`estado = $${params.length}`); }
  const whereClause = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const { rows } = await qMelissa(`SELECT * FROM facturas ${whereClause} ORDER BY created_at DESC`, params);
  res.json(rows);
}));

app.get('/api/melissa/facturacion/facturas/:id', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { rows } = await qMelissa(`SELECT * FROM facturas WHERE id=$1`, [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Factura no encontrada' });
  const conceptos = await qMelissa(`SELECT * FROM factura_conceptos WHERE factura_id=$1`, [req.params.id]);
  res.json({ ...rows[0], conceptos: conceptos.rows });
}));

app.post('/api/melissa/facturacion/facturas', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { cliente, tipo, forma_pago, metodo_pago, cita_id, notas, total, conceptos } = req.body || {};
  const { rows } = await qMelissa(
    `INSERT INTO facturas (cliente, tipo, forma_pago, metodo_pago, cita_id, notas, total) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [cliente, tipo, forma_pago || null, metodo_pago || null, cita_id || null, notas || null, total || 0]
  );
  const factura = rows[0];
  if (Array.isArray(conceptos)) {
    for (const c of conceptos) {
      await qMelissa(
        `INSERT INTO factura_conceptos (factura_id, descripcion, cantidad, valor_unitario, importe, clave_prod_serv, unidad, objeto_imp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [factura.id, c.descripcion, c.cantidad, c.valor_unitario, c.importe, c.clave_prod_serv || null, c.unidad || null, c.objeto_imp || null]
      );
    }
  }
  res.json(factura);
}));

app.put('/api/melissa/facturacion/facturas/:id', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { cliente, tipo, forma_pago, metodo_pago, notas, total, conceptos } = req.body || {};
  const { rows } = await qMelissa(
    `UPDATE facturas SET cliente=COALESCE($1,cliente), tipo=COALESCE($2,tipo), forma_pago=COALESCE($3,forma_pago),
     metodo_pago=COALESCE($4,metodo_pago), notas=COALESCE($5,notas), total=COALESCE($6,total) WHERE id=$7 RETURNING *`,
    [cliente, tipo, forma_pago, metodo_pago, notas, total, req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Factura no encontrada' });
  if (Array.isArray(conceptos)) {
    await qMelissa(`DELETE FROM factura_conceptos WHERE factura_id=$1`, [req.params.id]);
    for (const c of conceptos) {
      await qMelissa(
        `INSERT INTO factura_conceptos (factura_id, descripcion, cantidad, valor_unitario, importe, clave_prod_serv, unidad, objeto_imp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.params.id, c.descripcion, c.cantidad, c.valor_unitario, c.importe, c.clave_prod_serv || null, c.unidad || null, c.objeto_imp || null]
      );
    }
  }
  res.json(rows[0]);
}));

app.delete('/api/melissa/facturacion/facturas/:id', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  await qMelissa(`DELETE FROM facturas WHERE id=$1`, [req.params.id]);
  res.status(204).end();
}));

app.post('/api/melissa/facturacion/facturas/:id/timbrar', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { rows } = await qMelissa(
    `UPDATE facturas SET estado='timbrada', fecha_timbrado=NOW(), uuid=$1 WHERE id=$2 RETURNING *`,
    ['UUID-EJEMPLO-' + Date.now(), req.params.id]
  );
  res.json({ ok: true, ...rows[0] });
}));

app.post('/api/melissa/facturacion/facturas/:id/cancelar', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { rows } = await qMelissa(
    `UPDATE facturas SET estado='cancelada', cancelada_at=NOW() WHERE id=$1 RETURNING *`,
    [req.params.id]
  );
  res.json({ ok: true, ...rows[0] });
}));

// WHATSAPP - Messages
app.get('/api/melissa/whatsapp/messages', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const limit = req.query.limit || 200;
  const { rows } = await qMelissa(`SELECT * FROM whatsapp_messages ORDER BY created_at DESC LIMIT $1`, [limit]);
  res.json(rows);
}));

app.post('/api/melissa/whatsapp/messages', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { direction, phone, message, status, appointment_id } = req.body || {};
  const { rows } = await qMelissa(
    `INSERT INTO whatsapp_messages (direction, phone, message, status, appointment_id, manual) VALUES ($1,$2,$3,$4,$5,true) RETURNING *`,
    [direction, phone, message, status || 'sent', appointment_id || null]
  );
  res.json(rows[0]);
}));

// WHATSAPP - Stats
app.get('/api/melissa/whatsapp/stats', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { from, to } = req.query;
  const { rows } = await qMelissa(
    `SELECT COUNT(*) as total, direction FROM whatsapp_messages 
     WHERE created_at >= $1 AND created_at <= $2 GROUP BY direction`,
    [from || '2025-01-01', to || '2025-12-31']
  );
  res.json({ incoming: 0, outgoing: 0, ...Object.fromEntries(rows.map(r => [r.direction, Number(r.total)])) });
}));

// WHATSAPP - Test
app.get('/api/melissa/whatsapp/test', (req, res) => {
  res.json({ ok: true, message: 'WhatsApp API disponible', timestamp: new Date().toISOString() });
});

// WHATSAPP - Rules
app.get('/api/melissa/whatsapp/rules', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { rows } = await qMelissa(`SELECT * FROM whatsapp_rules ORDER BY priority DESC, created_at DESC`);
  res.json(rows);
}));

app.post('/api/melissa/whatsapp/rules', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { name, active, priority, match, action, cooldown_secs } = req.body || {};
  const { rows } = await qMelissa(
    `INSERT INTO whatsapp_rules (name, active, priority, match, action, cooldown_secs) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [name, active !== false, priority || 100, JSON.stringify(match), JSON.stringify(action), cooldown_secs || 0]
  );
  res.json(rows[0]);
}));

app.put('/api/melissa/whatsapp/rules/:id', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { name, active, priority, match, action, cooldown_secs } = req.body || {};
  const { rows } = await qMelissa(
    `UPDATE whatsapp_rules SET name=COALESCE($1,name), active=COALESCE($2,active), priority=COALESCE($3,priority),
     match=COALESCE($4,match), action=COALESCE($5,action), cooldown_secs=COALESCE($6,cooldown_secs) WHERE id=$7 RETURNING *`,
    [name, active, priority, match ? JSON.stringify(match) : null, action ? JSON.stringify(action) : null, cooldown_secs, req.params.id]
  );
  res.json(rows[0] || null);
}));

app.delete('/api/melissa/whatsapp/rules/:id', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  await qMelissa(`DELETE FROM whatsapp_rules WHERE id=$1`, [req.params.id]);
  res.status(204).end();
}));

// POST/PUT adicionales que faltan
app.put('/api/melissa/appointments/:id', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { patient, doctor_id, date, start_time, service_id, phone, status } = req.body || {};
  const { rows } = await qMelissa(
    `UPDATE appointments SET patient=COALESCE($1,patient), doctor_id=COALESCE($2,doctor_id), date=COALESCE($3,date),
     start_time=COALESCE($4,start_time), service_id=COALESCE($5,service_id), phone=COALESCE($6,phone), status=COALESCE($7,status)
     WHERE id=$8 RETURNING *`,
    [patient, doctor_id, date, start_time, service_id, phone, status, Number(req.params.id)]
  );
  res.json(rows[0] || null);
}));

app.delete('/api/melissa/appointments/:id', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  await qMelissa(`DELETE FROM appointments WHERE id=$1`, [Number(req.params.id)]);
  res.status(204).end();
}));

app.put('/api/melissa/payments/:id', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { patient, amount, payment_method, date } = req.body || {};
  const { rows } = await qMelissa(
    `UPDATE payments SET patient=$1, amount=$2, payment_method=$3, date=$4 WHERE id=$5 RETURNING *`,
    [patient, amount, payment_method, date, Number(req.params.id)]
  );
  res.json(rows[0] || null);
}));

app.delete('/api/melissa/payments/:id', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  await qMelissa(`DELETE FROM payments WHERE id=$1`, [Number(req.params.id)]);
  res.status(204).end();
}));

app.delete('/api/melissa/doctors/:id', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  await qMelissa(`DELETE FROM doctors WHERE id=$1`, [Number(req.params.id)]);
  res.status(204).end();
}));

app.delete('/api/melissa/services/:id', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  await qMelissa(`DELETE FROM services WHERE id=$1`, [Number(req.params.id)]);
  res.status(204).end();
}));

// Alias para facturacion-v2
app.get('/api/melissa/facturacion-v2/configuracion', ah(async (req, res) => {
  if (!qMelissa) return res.status(503).json({ error: 'MELISSA_DATABASE_URL no configurada' });
  const { rows } = await qMelissa(`SELECT * FROM facturacion_configuracion LIMIT 1`);
  if (rows.length > 0) return res.json(rows[0]);
  res.json({
    rfc: 'XAXX010101000',
    razon_social: 'Sin configurar',
    regimen_fiscal: '601',
    codigo_postal: '00000',
    pac_proveedor: 'facturama',
    ultimo_folio: 1,
    ambiente: 'pruebas',
    activo: false
  });
}));
// ==============================
// Health & debug
// ==============================
app.get('/api/health', ah(async (req, res) => {
  await q('SELECT 1');
  res.json({ ok: true, sucursal: getSucursal(req) });
}));

app.get('/api/test', (req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    sucursal: getSucursal(req),
    headers: req.headers,
    query: req.query
  });
});

app.get('/api/debug/sucursales', ah(async (_req, res) => {
  const tables = [
    'doctors','services','appointments','payments','expenses',
    'laboratorios','lab_trabajos','lab_abonos','objetivos',
    'pagos_laboratorio','facturas','factura_conceptos','facturacion_clientes','facturacion_productos'
  ];
  const stats = {};
  const sucursales = new Set();
  for (const t of tables) {
    const { rows } = await q(
      `SELECT COALESCE(sucursal_id,'(null)') AS sucursal_id, COUNT(*)::text AS count
       FROM ${t} GROUP BY sucursal_id ORDER BY sucursal_id`
    );
    stats[t] = rows;
    rows.forEach(r => { if (r.sucursal_id !== '(null)') sucursales.add(r.sucursal_id); });
  }
  res.json({ sucursales: Array.from(sucursales), estadisticas: stats });
}));

// ==============================
// DOCTORS — aislado por empresa + sucursal
// ==============================
app.get('/api/doctors', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const { rows } = await q(
    `SELECT id, name, color, sucursal_id
     FROM doctors
     WHERE tenant_id = $1 AND ${sucWhereN(2)}
     ORDER BY id ASC`, [tenantId, s]
  );
  res.json(rows);
}));

app.post('/api/doctors', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const { name, color } = req.body || {};
  const { rows } = await q(
    `INSERT INTO doctors (name, color, sucursal_id, tenant_id)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, color || null, s, tenantId]
  );
  res.json(rows[0]);
}));

app.put('/api/doctors/:id', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const id = Number(req.params.id);
  const { name, color } = req.body || {};
  const { rows } = await q(
    `UPDATE doctors
     SET name = COALESCE($1, name),
         color = COALESCE($2, color)
     WHERE id=$3 AND tenant_id=$4 AND ${sucWhereN(5)}
     RETURNING *`,
    [name || null, color || null, id, tenantId, s]
  );
  res.json(rows[0] || null);
}));

app.delete('/api/doctors/:id', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  await q(
    `DELETE FROM doctors
     WHERE id=$1 AND tenant_id=$2 AND ${sucWhereN(3)}`,
    [Number(req.params.id), tenantId, s]
  );
  res.status(204).end();
}));

// ==============================
// SERVICES — aislado por empresa + sucursal
// ==============================
app.get('/api/services', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const { rows } = await q(
    `SELECT id, name, sucursal_id
     FROM services
     WHERE tenant_id = $1 AND ${sucWhereN(2)}
     ORDER BY id ASC`, [tenantId, s]
  );
  res.json(rows);
}));

app.post('/api/services', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const { name } = req.body || {};
  const { rows } = await q(
    `INSERT INTO services (name, sucursal_id, tenant_id)
     VALUES ($1,$2,$3) RETURNING *`,
    [name, s, tenantId]
  );
  res.json(rows[0]);
}));

app.delete('/api/services/:id', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  await q(
    `DELETE FROM services
     WHERE id=$1 AND tenant_id=$2 AND ${sucWhereN(3)}`,
    [Number(req.params.id), tenantId, s]
  );
  res.status(204).end();
}));

// 🔢 Fórmulas de materiales por tratamiento/servicio
const TREATMENT_FORMULAS = {
  // 🔹 Consultas
  'Primera consulta': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 2 },
  ],
  'primera consulta': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 2 },
  ],

  // 🔹 Limpiezas
  'Limpieza Dental': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 3 },
  ],
  'Limpieza dental': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 3 },
  ],
  'Limpieza': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 3 },
  ],

  // 🔹 Resina / Restauraciones
  'Resina': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Resina A2', quantity: 0.5 },
    { item: 'Ácido Grabador', quantity: 0.3 },
    { item: 'Gasas Estériles', quantity: 2 },
  ],
  'Resinas': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Resina A2', quantity: 0.5 },
    { item: 'Ácido Grabador', quantity: 0.3 },
    { item: 'Gasas Estériles', quantity: 2 },
  ],

  // 🔹 Endodoncia
  'Endodoncia': [
    { item: 'Guantes de Latex', quantity: 4 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Lidocaína 2%', quantity: 2 },
    { item: 'Limas K', quantity: 0.5 },
    { item: 'Gasas Estériles', quantity: 8 },
  ],
  'Endodoncia terminar': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Limas K', quantity: 0.3 },
    { item: 'Gasas Estériles', quantity: 4 },
  ],

  // 🔹 Extracciones / Cirugías
  'Extraccion': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Lidocaína 2%', quantity: 2 },
    { item: 'Gasas Estériles', quantity: 10 },
  ],
  'Extracción': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Lidocaína 2%', quantity: 2 },
    { item: 'Gasas Estériles', quantity: 10 },
  ],
  'Cirugia': [
    { item: 'Guantes de Latex', quantity: 4 },
    { item: 'Cubrebocas Tricapa', quantity: 2 },
    { item: 'Lidocaína 2%', quantity: 4 },
    { item: 'Gasas Estériles', quantity: 20 },
  ],
  'Extirpación de absceso': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Lidocaína 2%', quantity: 2 },
    { item: 'Gasas Estériles', quantity: 8 },
  ],
  'Extirpaci¾n de absceso': [ // por si viene con encoding raro
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Lidocaína 2%', quantity: 2 },
    { item: 'Gasas Estériles', quantity: 8 },
  ],

  // 🔹 Ortodoncia
  'Brackets': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 2 },
  ],
  'Cambio de ligas': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
  ],
  'Retiro brackets': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 2 },
  ],
  'Retiro de brackets': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 2 },
  ],
  'Estudio Ortodontico': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
  ],
  'Mensualidad de orto': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
  ],
  'ortodoncia': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
  ],

  // 🔹 Prótesis / Placas / Coronas / Puentes
  'Corona': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 4 },
  ],
  'Corona metal porcelana': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 4 },
  ],
  'Corona zirconia': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 4 },
  ],
  'Puente 3 unidades': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 6 },
  ],
  'Cementar puente': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 3 },
  ],
  'Puente de metal porcelana': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 6 },
  ],
  'Prótesis Fija con acrílico cosido': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 6 },
  ],
  'Pr¾tesis Fija con acrÝlico cosido': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 6 },
  ],
  'Placa removible': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
  ],
  'Placa removible con ganchos wiplas': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
  ],
  'Placa total inferior': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
  ],
  'Toma de impresión para placa totales': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 2 },
  ],
  'Toma de impresi¾n para placa totales': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 2 },
  ],

  // 🔹 Pulpa / Postes
  'Pulpectomia': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 6 },
  ],
  'Pulpotomia': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 6 },
  ],
  'Poste de Fibra de vidrio': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 4 },
  ],

  // 🔹 Rx / Radiografías / Estudios
  'Rx': [
    { item: 'Guantes de Latex', quantity: 1 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
  ],
  'Radiografia': [
    { item: 'Guantes de Latex', quantity: 1 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
  ],
  'Estudios Rx': [
    { item: 'Guantes de Latex', quantity: 1 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
  ],

  // 🔹 Blanqueamiento
  'Blanqueamiento': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 4 },
  ],

  // 🔹 Ajustes / Tallados / Guarda
  'Ajustes': [
    { item: 'Guantes de Latex', quantity: 1 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
  ],
  'Tallados': [
    { item: 'Guantes de Latex', quantity: 1 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
  ],
  'Guarda': [
    { item: 'Guantes de Latex', quantity: 1 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
  ],

  // 🔹 Cementación
  'Cementación': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 2 },
  ],
  'Cementaci¾n': [
    { item: 'Guantes de Latex', quantity: 2 },
    { item: 'Cubrebocas Tricapa', quantity: 1 },
    { item: 'Gasas Estériles', quantity: 2 },
  ],
};

// Estados que consideramos "finalizados"
const FINAL_APPOINTMENT_STATUSES = [
  'atendida',
  'completada',
  'finalizada',
  'realizada',
];

// 🧮 Función reutilizable para aplicar fórmula al inventario de una sucursal
async function aplicarFormulaInventario(sucursalId, formulaItems) {
  if (!Array.isArray(formulaItems) || formulaItems.length === 0) return;

  for (const f of formulaItems) {
    const nombre = (f.item || '').toString().toLowerCase();
    const cantidad = Number(f.quantity) || 0;

    if (!nombre || cantidad <= 0) continue;

    // Buscar el producto más parecido por nombre en el inventario
    const { rows } = await q(
      `
      SELECT id, quantity
      FROM inventory
      WHERE LOWER(name) LIKE '%' || $1 || '%'
        AND ${sucWhereN(2)}
      ORDER BY LENGTH(name) ASC
      LIMIT 1
      `,
      [nombre, sucursalId]
    );

    if (!rows[0]) {
      console.log('⚠️ Item de fórmula no encontrado en inventario:', nombre);
      continue;
    }

    const producto = rows[0];
    const nuevoStock = Math.max(0, Number(producto.quantity) - cantidad);

    await q(
      `
      UPDATE inventory
      SET quantity = $1
      WHERE id = $2
        AND ${sucWhereN(3)}
      `,
      [nuevoStock, producto.id, sucursalId]
    );
  }
}

// ==============================
// APPOINTMENTS — aislado por empresa + sucursal
// ==============================
app.get('/api/appointments', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const { rows } = await q(
    `SELECT id, patient, doctor_id, date, start_time, duration_hours, service_id, phone, status, sucursal_id
     FROM appointments
     WHERE tenant_id=$1 AND ${sucWhereN(2)}
     ORDER BY date DESC, start_time DESC`, [tenantId, s]
  );
  res.json(rows);
}));

app.post('/api/appointments', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const { patient, doctor_id, date, start_time, duration_hours, service_id, phone, status } = req.body || {};
  if (!patient || (typeof patient === 'string' && !patient.trim())) {
    return res.status(400).json({ error: 'El nombre del paciente es requerido' });
  }
  const cleanPatient = typeof patient === 'string' ? patient.trim() : String(patient);
  const { rows } = await q(
    `INSERT INTO appointments (patient, doctor_id, date, start_time, duration_hours, service_id, phone, status, sucursal_id, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'Pendiente'),$9,$10)
     RETURNING *`,
    [cleanPatient, doctor_id ? Number(doctor_id) : null, date, start_time || '09:00', duration_hours ? Number(duration_hours) : 1, service_id ? Number(service_id) : null, phone || null, status || 'Pendiente', s, tenantId]
  );

  publishAppointmentEvent('appointment.created', rows[0], req);
  res.json(rows[0]);
}));

app.put('/api/appointments/:id', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const id = Number(req.params.id);
  const { patient, doctor_id, date, start_time, duration_hours, service_id, phone, status } = req.body || {};

  const { rows: prevRows } = await q(
    `SELECT id, patient, doctor_id, date, start_time::text AS start_time,
            duration_hours, service_id, phone, status, sucursal_id
       FROM appointments
      WHERE id=$1 AND tenant_id=$2 AND ${sucWhereN(3)}`,
    [id, tenantId, s]
  );
  const prev = prevRows[0] || null;
  const prevStatus = (prev?.status || '').toLowerCase();
  const yaEraFinalizada = FINAL_APPOINTMENT_STATUSES.includes(prevStatus);

  const { rows } = await q(
    `UPDATE appointments
     SET patient = COALESCE($1, patient), doctor_id = COALESCE($2, doctor_id),
         date = COALESCE($3, date), start_time = COALESCE($4, start_time),
         duration_hours = COALESCE($5, duration_hours), service_id = COALESCE($6, service_id),
         phone = COALESCE($7, phone), status = COALESCE($8, status)
     WHERE id=$9 AND tenant_id=$10 AND ${sucWhereN(11)} RETURNING *`,
    [patient, doctor_id, date, start_time, duration_hours, service_id, phone, status, id, tenantId, s]
  );
  const updated = rows[0] || null;

  if (updated) {
    const eventName = classifyAppointmentUpdate(prev, updated);
    publishAppointmentEvent(eventName, updated, req, {
      previous: prev,
    });

    const finalStatus = (status || updated.status || '').toLowerCase();
    const esFinalizadaAhora = FINAL_APPOINTMENT_STATUSES.includes(finalStatus);
    if (esFinalizadaAhora && !yaEraFinalizada) {
      try { await triggerSatisfaccionWhatsApp(updated, s); } catch (err) { console.error('⚠️ Error enviando WhatsApp de satisfacción:', err); }
      const servicioId = updated.service_id || service_id || prev?.service_id;
      if (servicioId) {
        const { rows: serviceRows } = await q(
          `SELECT id, name FROM services WHERE id=$1 AND tenant_id=$2 AND ${sucWhereN(3)}`,
          [servicioId, tenantId, s]
        );
        const service = serviceRows[0] || null;
        if (service) {
          const formulaItems = TREATMENT_FORMULAS[service.name];
          if (formulaItems?.length) {
            try { await aplicarFormulaInventario(s, formulaItems); } catch (err) { console.error('⚠️ Error aplicando fórmula de inventario:', err); }
          }
        }
      }
    }
  }
  res.json(updated);
}));

app.delete('/api/appointments/:id', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const { rows } = await q(
    `DELETE FROM appointments
      WHERE id=$1 AND tenant_id=$2 AND ${sucWhereN(3)}
      RETURNING *`,
    [Number(req.params.id), tenantId, s]
  );

  if (rows[0]) {
    publishAppointmentEvent('appointment.updated', rows[0], req, {
      action: 'deleted',
    });
  }

  res.status(204).end();
}));

// ==============================
// PAYMENTS — aislado por empresa + sucursal
// ==============================
app.get('/api/payments', authRequired, ah(async (req, res) => {
  const s = getSucursal(req); const tenantId = getTenantId(req);
  const { rows } = await q(
    `SELECT id, appointment_id, patient, service_id, amount, payment_method, date, doctor_id, sucursal_id
     FROM payments WHERE tenant_id=$1 AND ${sucWhereN(2)} ORDER BY date DESC, id DESC`, [tenantId, s]);
  res.json(rows);
}));

app.post('/api/payments', authRequired, ah(async (req, res) => {
  const s = getSucursal(req); const tenantId = getTenantId(req);
  const { appointment_id, patient, service_id, amount, payment_method, date, doctor_id } = req.body || {};
  if (!patient || !patient.trim()) return res.status(400).json({ error: 'El nombre del paciente es requerido' });
  if (!amount || amount <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
  if (!payment_method || !payment_method.trim()) return res.status(400).json({ error: 'El método de pago es requerido' });
  if (!date) return res.status(400).json({ error: 'La fecha es requerida' });
  const { rows } = await q(
    `INSERT INTO payments (appointment_id, patient, service_id, amount, payment_method, date, doctor_id, sucursal_id, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [appointment_id || null, patient.trim(), service_id ? Number(service_id) : null, Number(amount), payment_method.trim(), date, doctor_id ? Number(doctor_id) : null, s, tenantId]);
  res.json(rows[0]);
}));

app.put('/api/payments/:id', authRequired, ah(async (req, res) => {
  const s = getSucursal(req); const tenantId = getTenantId(req);
  const id = Number(req.params.id); const { patient, amount, payment_method, date } = req.body || {};
  const { rows } = await q(
    `UPDATE payments SET patient=$1, amount=$2, payment_method=$3, date=$4
     WHERE id=$5 AND tenant_id=$6 AND ${sucWhereN(7)} RETURNING *`,
    [patient, amount, payment_method, date, id, tenantId, s]);
  res.json(rows[0] || null);
}));

app.delete('/api/payments/:id', authRequired, ah(async (req, res) => {
  const s = getSucursal(req); const tenantId = getTenantId(req);
  await q(`DELETE FROM payments WHERE id=$1 AND tenant_id=$2 AND ${sucWhereN(3)}`,
    [Number(req.params.id), tenantId, s]);
  res.status(204).end();
}));

// ==============================
// EXPENSES — aislado por empresa + sucursal
// ==============================
app.get('/api/expenses', authRequired, ah(async (req, res) => {
  const s = getSucursal(req); const tenantId = getTenantId(req);
  const { rows } = await q(
    `SELECT id, concept, amount, date, doctor_id, payment_method, sucursal_id
     FROM expenses WHERE tenant_id=$1 AND ${sucWhereN(2)} ORDER BY date DESC, id DESC`, [tenantId, s]);
  res.json(rows);
}));

app.post('/api/expenses', authRequired, ah(async (req, res) => {
  const s = getSucursal(req); const tenantId = getTenantId(req);
  const { concept, amount, date, doctor_id, payment_method } = req.body || {};
  if (!concept || !concept.trim()) return res.status(400).json({ error: 'El concepto del gasto es requerido' });
  if (!amount || amount <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
  if (!date) return res.status(400).json({ error: 'La fecha es requerida' });
  const { rows } = await q(
    `INSERT INTO expenses (concept, amount, date, doctor_id, payment_method, sucursal_id, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [concept.trim(), Number(amount), date, doctor_id ? Number(doctor_id) : null, payment_method || null, s, tenantId]);
  res.json(rows[0]);
}));

app.put('/api/expenses/:id', authRequired, ah(async (req, res) => {
  const s = getSucursal(req); const tenantId = getTenantId(req);
  const id = Number(req.params.id); const { concept, amount, date, doctor_id, payment_method } = req.body || {};
  const { rows } = await q(
    `UPDATE expenses SET concept=$1, amount=$2, date=$3, doctor_id=$4, payment_method=$5
     WHERE id=$6 AND tenant_id=$7 AND ${sucWhereN(8)} RETURNING *`,
    [concept, amount, date, doctor_id || null, payment_method || null, id, tenantId, s]);
  res.json(rows[0] || null);
}));

app.delete('/api/expenses/:id', authRequired, ah(async (req, res) => {
  const s = getSucursal(req); const tenantId = getTenantId(req);
  await q(`DELETE FROM expenses WHERE id=$1 AND tenant_id=$2 AND ${sucWhereN(3)}`,
    [Number(req.params.id), tenantId, s]);
  res.status(204).end();
}));

// ==============================
// SATISFACCIÓN DEL SERVICIO
// ==============================
app.post('/api/satisfaccion-servicio', ah(async (req, res) => {
  const s = getSucursal(req);
  const {
    appointment_id,
    service_id,
    patient_id,
    doctor_id,
    rating,
    comentario
  } = req.body || {};

  if (!appointment_id) {
    return res.status(400).json({ error: 'appointment_id es requerido' });
  }
  if (!service_id) {
    return res.status(400).json({ error: 'service_id es requerido' });
  }
  if (rating === undefined || rating === null) {
    return res.status(400).json({ error: 'rating es requerido' });
  }

  const r = Number(rating);
  if (isNaN(r) || r < 0 || r > 5) {
    return res.status(400).json({ error: 'rating debe estar entre 0 y 5' });
  }

  const { rows } = await q(`
    INSERT INTO satisfaccion_servicio (
      appointment_id,
      service_id,
      patient_id,
      doctor_id,
      rating,
      comentario,
      sucursal_id
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING *
  `, [
    appointment_id,
    service_id,
    patient_id || null,
    doctor_id || null,
    r,
    comentario || null,
    s
  ]);

  res.json(rows[0]);
}));

// Listado (para debug / reportes / dashboard puntual)
app.get('/api/satisfaccion-servicio', ah(async (req, res) => {
  const s = getSucursal(req);
  const { desde, hasta } = req.query;

  const params = [s];
  let where = `WHERE (ss.sucursal_id = $1 OR ss.sucursal_id IS NULL)`;

  if (desde) {
    params.push(desde);
    where += ` AND ss.created_at::date >= $${params.length}`;
  }
  if (hasta) {
    params.push(hasta);
    where += ` AND ss.created_at::date <= $${params.length}`;
  }

  const { rows } = await q(`
    SELECT 
      ss.*,
      a.patient,
      a.date as appointment_date,
      s.name AS service_name,
      d.name AS doctor_name
    FROM satisfaccion_servicio ss
    LEFT JOIN appointments a ON a.id = ss.appointment_id
    LEFT JOIN services s      ON s.id = ss.service_id
    LEFT JOIN doctors d       ON d.id = ss.doctor_id
    ${where}
    ORDER BY ss.created_at DESC
  `, params);

  res.json(rows);
}));


// ==============================
// LABORATORIOS + TRABAJOS + ABONOS — aislado por empresa + sucursal
// ==============================
app.get('/api/laboratorios', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const { rows } = await q(
    `SELECT id, nombre, contacto, sucursal_id
     FROM laboratorios
     WHERE tenant_id = $1 AND ${sucWhereN(2)}
     ORDER BY id ASC`, [tenantId, s]
  );
  res.json(rows);
}));

app.post('/api/laboratorios', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const { nombre, contacto } = req.body || {};
  const { rows } = await q(
    `INSERT INTO laboratorios (nombre, contacto, sucursal_id, tenant_id)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [nombre, contacto || null, s, tenantId]
  );
  res.json(rows[0]);
}));

app.get('/api/trabajos-laboratorio', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const { rows } = await q(
    `SELECT lt.id,
            lt.paciente,
            lt.laboratorio_id,
            lt.servicio_id,
            lt.presupuesto,
            lt.fecha_inicio,
            lt.fecha_entrega_estimada,
            lt.etapa,
            lt.notas,
            lt.sucursal_id,
            COALESCE(
              json_agg(json_build_object(
                'id', la.id,
                'monto', la.monto,
                'fecha', la.fecha,
                'nota', la.nota,
                'metodo_pago', la.metodo_pago
              ) ORDER BY la.fecha ASC)
              FILTER (WHERE la.id IS NOT NULL), '[]'
            ) AS abonos
     FROM lab_trabajos lt
     LEFT JOIN lab_abonos la
       ON la.trabajo_id = lt.id
      AND la.tenant_id = lt.tenant_id
      AND (la.sucursal_id = lt.sucursal_id OR la.sucursal_id IS NULL)
     WHERE lt.tenant_id = $1 AND ${sucWhereN(2,'lt')}
     GROUP BY lt.id
     ORDER BY lt.id DESC`, [tenantId, s]
  );
  res.json(rows);
}));

app.post('/api/trabajos-laboratorio', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const paciente  = req.body?.paciente;
  const laboratorio_id = req.body?.laboratorio_id ?? req.body?.laboratorioId;
  const servicio_id    = req.body?.servicio_id    ?? req.body?.servicioId;
  const presupuesto    = req.body?.presupuesto;
  const fecha_inicio   = req.body?.fecha_inicio   ?? req.body?.fechaInicio;
  const fecha_entrega  = req.body?.fecha_entrega_estimada ?? req.body?.fechaEntregaEstimada;
  const etapa          = req.body?.etapa || 'Toma de impresión';
  const notas          = req.body?.notas ?? null;

  const labCheck = await q(
    `SELECT 1 FROM laboratorios WHERE id=$1 AND tenant_id=$2 AND ${sucWhereN(3)}`,
    [laboratorio_id, tenantId, s]
  );
  if (labCheck.rowCount === 0) return res.status(400).json({ error: 'Laboratorio inexistente para esta empresa y sucursal' });

  const servCheck = await q(
    `SELECT 1 FROM services WHERE id=$1 AND tenant_id=$2 AND ${sucWhereN(3)}`,
    [servicio_id, tenantId, s]
  );
  if (servCheck.rowCount === 0) return res.status(400).json({ error: 'Servicio inexistente para esta empresa y sucursal' });

  const { rows } = await q(
    `INSERT INTO lab_trabajos
      (paciente, laboratorio_id, servicio_id, presupuesto, fecha_inicio, fecha_entrega_estimada, etapa, notas, sucursal_id, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [paciente, laboratorio_id, servicio_id, presupuesto, fecha_inicio, fecha_entrega, etapa, notas, s, tenantId]
  );
  res.json(rows[0]);
}));

app.patch('/api/trabajos-laboratorio/:id', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const id = req.params.id;
  const { etapa, notas } = req.body || {};
  const { rows } = await q(
    `UPDATE lab_trabajos
     SET etapa = COALESCE($1, etapa),
         notas = COALESCE($2, notas)
     WHERE id=$3 AND tenant_id=$4 AND ${sucWhereN(5)}
     RETURNING *`,
    [etapa || null, notas || null, id, tenantId, s]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Trabajo no encontrado' });
  res.json(rows[0]);
}));

app.post('/api/trabajos-laboratorio/:id/abonos', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const trabajo_id = req.params.id;
  const { monto, fecha, nota, metodo_pago } = req.body || {};

  const chk = await q(
    `SELECT 1 FROM lab_trabajos WHERE id=$1 AND tenant_id=$2 AND ${sucWhereN(3)}`,
    [trabajo_id, tenantId, s]
  );
  if (chk.rowCount === 0) return res.status(404).json({ error: 'Trabajo no encontrado para esta empresa y sucursal' });

  const { rows } = await q(
    `INSERT INTO lab_abonos (trabajo_id, monto, fecha, nota, metodo_pago, sucursal_id, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [trabajo_id, monto, fecha, nota || null, metodo_pago || null, s, tenantId]
  );
  res.json(rows[0]);
}));

// ==============================
// PAGOS DE LABORATORIO — aislado por empresa + sucursal
// ==============================
app.get('/api/pagos-laboratorio', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const trabajoId = req.query.trabajo_id || req.query.trabajoId;
  if (trabajoId) {
    const { rows } = await q(
      `SELECT id, trabajo_id, monto, fecha, sucursal_id
       FROM pagos_laboratorio
       WHERE tenant_id=$1 AND ${sucWhereN(2)} AND trabajo_id = $3
       ORDER BY fecha DESC, created_at DESC`,
      [tenantId, s, String(trabajoId)]
    );
    return res.json(rows);
  }
  const { rows } = await q(
    `SELECT id, trabajo_id, monto, fecha, sucursal_id
     FROM pagos_laboratorio
     WHERE tenant_id=$1 AND ${sucWhereN(2)}
     ORDER BY fecha DESC, created_at DESC`,
    [tenantId, s]
  );
  res.json(rows);
}));

app.post('/api/pagos-laboratorio', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const { trabajo_id, monto, fecha } = req.body || {};

  const chk = await q(
    `SELECT 1 FROM lab_trabajos WHERE id=$1 AND tenant_id=$2 AND ${sucWhereN(3)}`,
    [String(trabajo_id), tenantId, s]
  );
  if (chk.rowCount === 0) return res.status(404).json({ error: 'Trabajo de laboratorio no encontrado para esta empresa y sucursal' });

  const { rows } = await q(
    `INSERT INTO pagos_laboratorio (trabajo_id, monto, fecha, sucursal_id, tenant_id)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [String(trabajo_id), Number(monto), fecha || null, s, tenantId]
  );
  res.json(rows[0]);
}));

// ==============================
// OBJETIVOS
// ==============================
app.get('/api/objetivos', ah(async (req, res) => {
  const s = getSucursal(req);
  const { from, to, doctor_id } = req.query;
  const params = [s];
  const conds = [`${sucWhereN(1)}`];
  if (from) { params.push(from); conds.push(`(periodo_fin IS NULL OR periodo_fin >= $${params.length})`); }
  if (to)   { params.push(to);   conds.push(`(periodo_inicio IS NULL OR periodo_inicio <= $${params.length})`); }
  if (doctor_id) { params.push(Number(doctor_id)); conds.push(`doctor_id = $${params.length}`); }
  const { rows } = await q(
    `SELECT id, doctor_id, meta, sueldo_base, periodo_inicio, periodo_fin, sucursal_id, created_at
     FROM objetivos
     WHERE ${conds.join(' AND ')}
     ORDER BY COALESCE(periodo_inicio, created_at) DESC, id DESC`,
    params
  );
  res.json(rows);
}));

// ==============================
// OBJETIVOS - REPORTES (por fechas, por doctor)
// ==============================
app.get('/api/objetivos/reportes', ah(async (req, res) => {
  const s = getSucursal(req);
  const { from, to, doctor_id, details } = req.query || {};

  if (!from || !to) {
    return res.status(400).json({ error: 'Parámetros requeridos: from, to (YYYY-MM-DD)' });
  }

  // 1) Doctores de la sucursal
  const docs = await q(
    `SELECT id, name, color
     FROM doctors
     WHERE ${sucWhereN(1)}
     ORDER BY id ASC`,
    [s]
  );
  const doctors = docs.rows || [];

  // 2) Ingresos (payments) agrupados por doctor
  const payParams = [s, from, to];
  const payConds = [`${sucWhereN(1)}`, `date >= $2`, `date <= $3`];
  if (doctor_id) { payParams.push(Number(doctor_id)); payConds.push(`doctor_id = $${payParams.length}`); }

  const paysAgg = await q(
    `SELECT doctor_id,
      SUM(CASE WHEN LOWER(COALESCE(payment_method,'')) LIKE '%efect%' OR LOWER(COALESCE(payment_method,'')) LIKE '%cash%'
          THEN amount ELSE 0 END) AS income_cash,
      SUM(CASE WHEN LOWER(COALESCE(payment_method,'')) LIKE '%tarj%' OR LOWER(COALESCE(payment_method,'')) LIKE '%card%'
            OR LOWER(COALESCE(payment_method,'')) LIKE '%credit%' OR LOWER(COALESCE(payment_method,'')) LIKE '%debit%'
          THEN amount ELSE 0 END) AS income_card,
      SUM(amount) AS income_total
     FROM payments
     WHERE ${payConds.join(' AND ')}
     GROUP BY doctor_id`,
    payParams
  );

  // 3) Gastos (expenses) agrupados por doctor
  const expParams = [s, from, to];
  const expConds = [`${sucWhereN(1)}`, `date >= $2`, `date <= $3`];
  if (doctor_id) { expParams.push(Number(doctor_id)); expConds.push(`doctor_id = $${expParams.length}`); }

  const expsAgg = await q(
    `SELECT doctor_id,
      SUM(amount) AS expense_total
     FROM expenses
     WHERE ${expConds.join(' AND ')}
     GROUP BY doctor_id`,
    expParams
  );

  const payMap = Object.create(null);
  (paysAgg.rows || []).forEach(r => {
    payMap[String(r.doctor_id)] = {
      income_cash: Number(r.income_cash || 0),
      income_card: Number(r.income_card || 0),
      income_total: Number(r.income_total || 0),
    };
  });

  const expMap = Object.create(null);
  (expsAgg.rows || []).forEach(r => {
    expMap[String(r.doctor_id)] = {
      expense_total: Number(r.expense_total || 0),
    };
  });

  // 4) Merge para que TODOS los doctores aparezcan (aunque no tengan movimientos)
  const rows = doctors.map(d => {
    const pid = String(d.id);
    const p = payMap[pid] || { income_cash: 0, income_card: 0, income_total: 0 };
    const e = expMap[pid] || { expense_total: 0 };
    const net = Number(p.income_total || 0) - Number(e.expense_total || 0);
    return {
      doctor_id: d.id,
      doctor_name: d.name,
      doctor_color: d.color || null,
      income_cash: p.income_cash,
      income_card: p.income_card,
      income_total: p.income_total,
      expense_total: e.expense_total,
      net
    };
  });

  const totals = rows.reduce((acc, r) => {
    acc.income_cash += Number(r.income_cash || 0);
    acc.income_card += Number(r.income_card || 0);
    acc.income_total += Number(r.income_total || 0);
    acc.expense_total += Number(r.expense_total || 0);
    acc.net += Number(r.net || 0);
    return acc;
  }, { income_cash: 0, income_card: 0, income_total: 0, expense_total: 0, net: 0 });

  // 5) Detalles (opcional) por doctor
  if (String(details || '') === '1' && doctor_id) {
    const dId = Number(doctor_id);

    const payDet = await q(
      `SELECT id, appointment_id, patient, service_id, amount, payment_method, date, doctor_id, sucursal_id
       FROM payments
       WHERE ${sucWhereN(1)} AND doctor_id=$2 AND date >= $3 AND date <= $4
       ORDER BY date ASC, id ASC`,
      [s, dId, from, to]
    );

    const expDet = await q(
      `SELECT id, concept, amount, date, doctor_id, payment_method, sucursal_id
       FROM expenses
       WHERE ${sucWhereN(1)} AND doctor_id=$2 AND date >= $3 AND date <= $4
       ORDER BY date ASC, id ASC`,
      [s, dId, from, to]
    );

    return res.json({ rows, totals, payments: payDet.rows || [], expenses: expDet.rows || [] });
  }

  res.json({ rows, totals });
}));

app.post('/api/objetivos', ah(async (req, res) => {
  const s = getSucursal(req);
  const { doctor_id, meta, sueldo_base, periodo_inicio, periodo_fin } = req.body || {};
  const { rows } = await q(
    `INSERT INTO objetivos (doctor_id, meta, sueldo_base, periodo_inicio, periodo_fin, sucursal_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, doctor_id, meta, sueldo_base, periodo_inicio, periodo_fin, sucursal_id, created_at`,
    [
      doctor_id ? Number(doctor_id) : null,
      meta != null ? Number(meta) : 0,
      sueldo_base != null ? Number(sueldo_base) : 0,
      periodo_inicio || null,
      periodo_fin || null,
      s
    ]
  );
  res.json(rows[0]);
}));

app.put('/api/objetivos/:id', ah(async (req, res) => {
  const s = getSucursal(req);
  const id = Number(req.params.id);
  const { doctor_id, meta, sueldo_base, periodo_inicio, periodo_fin } = req.body || {};
  const { rows } = await q(
    `UPDATE objetivos
     SET doctor_id = COALESCE($1, doctor_id),
         meta = COALESCE($2, meta),
         sueldo_base = COALESCE($3, sueldo_base),
         periodo_inicio = COALESCE($4, periodo_inicio),
         periodo_fin = COALESCE($5, periodo_fin)
     WHERE id=$6 AND ${sucWhereN(7)}
     RETURNING id, doctor_id, meta, sueldo_base, periodo_inicio, periodo_fin, sucursal_id, created_at`,
    [
      doctor_id != null ? Number(doctor_id) : null,
      meta != null ? Number(meta) : null,
      sueldo_base != null ? Number(sueldo_base) : null,
      periodo_inicio || null,
      periodo_fin || null,
      id, s
    ]
  );
  res.json(rows[0] || null);
}));

app.delete('/api/objetivos/:id', ah(async (req, res) => {
  const s = getSucursal(req);
  await q(`DELETE FROM objetivos WHERE id=$1 AND ${sucWhereN(2)}`, [Number(req.params.id), s]);
  res.status(204).end();
}));

// ==============================
// FACTURACIÓN
// ==============================

// Configuración SAT - responde con llaves que la UI espera
app.get('/api/facturacion/configuracion', ah(async (req, res) => {
  res.json({
    rfc: process.env.RFC || 'XAXX010101000',
    razon_social: process.env.RAZON_SOCIAL || 'Dentalux S.A. de C.V.',
    regimen_fiscal: process.env.REGIMEN_FISCAL || '601',
    codigo_postal: process.env.CODIGO_POSTAL || '64000',
    pac_proveedor: process.env.PAC_PROVEEDOR || 'finkok',
    ultimo_folio: Number(process.env.ULTIMO_FOLIO || 1),
    ambiente: process.env.NODE_ENV === 'production' ? 'produccion' : 'pruebas',
    activo: true   // ⬅️ esto es lo que activa el indicador en la UI
  });
}));

app.put('/api/facturacion/configuracion', ah(async (req, res) => {
  res.json({ ok: true, ...req.body });
}));

// === Subida de LOGO en memoria → responde Data URL (para previsualización en el front) ===
// (Si ya tienes estas 2 líneas arriba, NO las repitas)
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});


// Handler reutilizable (memoria -> Data URL)
const handleLogoUpload = ah(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'Falta archivo "logo"' });
  }
  const mime = req.file.mimetype || 'image/png';
  if (!/^image\//.test(mime)) {
    return res.status(400).json({ ok: false, error: 'Tipo de archivo no permitido' });
  }

  // Convierte el buffer en base64 y arma la Data URL
  const base64 = req.file.buffer.toString('base64');
  const dataUrl = `data:${mime};base64,${base64}`;

  // Devuelve ok + url para que el front la pueda mostrar de inmediato
  res.json({ ok: true, url: dataUrl });
});

// Endpoint legacy que tu UI puede estar llamando
app.post('/api/facturacion/configuracion/logo', upload.single('logo'), handleLogoUpload);

// Alias v2 por si tu front usa /facturacion-v2/ (según tu módulo de facturación)
app.post('/api/facturacion-v2/configuracion/logo', upload.single('logo'), handleLogoUpload);


// ---- CLIENTES (usados por la UI de facturación) ----
app.get('/api/facturacion/clientes', ah(async (req, res) => {
  const s = getSucursal(req);
  const { rows } = await q(
    `SELECT id, rfc, razon_social, email, telefono, direccion, uso_cfdi, codigo_postal, regimen_fiscal, sucursal_id, created_at
     FROM facturacion_clientes
     WHERE ${sucWhereN(1)}
     ORDER BY created_at DESC`, [s]
  );
  res.json(rows);
}));

app.post('/api/facturacion/clientes', ah(async (req, res) => {
  const s = getSucursal(req);
  const { rfc, razon_social, email, telefono, direccion, uso_cfdi, codigo_postal, regimen_fiscal } = req.body || {};
  if (!rfc || !String(rfc).trim()) return res.status(400).json({ error: 'RFC es requerido' });
  if (!razon_social || !String(razon_social).trim()) return res.status(400).json({ error: 'Razón social es requerida' });
  const { rows } = await q(
    `INSERT INTO facturacion_clientes (rfc, razon_social, email, telefono, direccion, uso_cfdi, codigo_postal, regimen_fiscal, sucursal_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      String(rfc).trim(),
      String(razon_social).trim(),
      email || null,
      telefono || null,
      direccion || null,
      uso_cfdi || null,
      codigo_postal || null,
      regimen_fiscal || null,
      s
    ]
  );
  res.json(rows[0]);
}));

// 🔹 Nuevo: actualizar cliente (parcial)
app.put('/api/facturacion/clientes/:id', ah(async (req, res) => {
  const s  = getSucursal(req);
  const id = String(req.params.id);
  const { rfc, razon_social, email, telefono, direccion, uso_cfdi, codigo_postal, regimen_fiscal } = req.body || {};

  const { rows } = await q(
    `UPDATE facturacion_clientes
       SET rfc            = COALESCE($1, rfc),
           razon_social   = COALESCE($2, razon_social),
           email          = COALESCE($3, email),
           telefono       = COALESCE($4, telefono),
           direccion      = COALESCE($5, direccion),
           uso_cfdi       = COALESCE($6, uso_cfdi),
           codigo_postal  = COALESCE($7, codigo_postal),
           regimen_fiscal = COALESCE($8, regimen_fiscal)
     WHERE id = $9 AND ${sucWhereN(10)}
     RETURNING *`,
    [
      rfc || null, razon_social || null, email || null, telefono || null, direccion || null,
      uso_cfdi || null, codigo_postal || null, regimen_fiscal || null, id, s
    ]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json(rows[0]);
}));

// ---- PRODUCTOS (catálogo) ----
app.get('/api/facturacion/productos', ah(async (req, res) => {
  const s = getSucursal(req);
  const { q:term } = req.query; // opcional ?q=consulta
  const params = [s];
  let where = `${sucWhereN(1)}`;
  if (term && String(term).trim()) {
    params.push(`%${String(term).trim()}%`);
    where += ` AND (descripcion ILIKE $${params.length} OR clave_prod_serv ILIKE $${params.length})`;
  }
  const { rows } = await q(
    `SELECT id, descripcion, clave_prod_serv, unidad, objeto_imp, precio, sucursal_id, created_at
     FROM facturacion_productos
     WHERE ${where}
     ORDER BY created_at DESC`,
    params
  );
  res.json(rows);
}));

app.post('/api/facturacion/productos', ah(async (req, res) => {
  const s = getSucursal(req);
  const { descripcion, clave_prod_serv, unidad, objeto_imp, precio } = req.body || {};
  if (!descripcion || !String(descripcion).trim()) {
    return res.status(400).json({ error: 'La descripción es requerida' });
  }
  const { rows } = await q(
    `INSERT INTO facturacion_productos (descripcion, clave_prod_serv, unidad, objeto_imp, precio, sucursal_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, descripcion, clave_prod_serv, unidad, objeto_imp, precio, sucursal_id, created_at`,
    [
      String(descripcion).trim(),
      clave_prod_serv || null,
      unidad || null,
      objeto_imp || null,
      precio != null ? Number(precio) : 0,
      s
    ]
  );
  res.status(201).json(rows[0]);
}));

app.put('/api/facturacion/productos/:id', ah(async (req, res) => {
  const s = getSucursal(req);
  const id = String(req.params.id);
  const { descripcion, clave_prod_serv, unidad, objeto_imp, precio } = req.body || {};
  const { rows } = await q(
    `UPDATE facturacion_productos
     SET descripcion = COALESCE($1, descripcion),
         clave_prod_serv = COALESCE($2, clave_prod_serv),
         unidad = COALESCE($3, unidad),
         objeto_imp = COALESCE($4, objeto_imp),
         precio = COALESCE($5, precio)
     WHERE id=$6 AND ${sucWhereN(7)}
     RETURNING id, descripcion, clave_prod_serv, unidad, objeto_imp, precio, sucursal_id, created_at`,
    [
      descripcion != null ? String(descripcion).trim() : null,
      clave_prod_serv || null,
      unidad || null,
      objeto_imp || null,
      precio != null ? Number(precio) : null,
      id, s
    ]
  );
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json(row);
}));

app.delete('/api/facturacion/productos/:id', ah(async (req, res) => {
  const s = getSucursal(req);
  await q(
    `DELETE FROM facturacion_productos
     WHERE id=$1 AND ${sucWhereN(2)}`,
    [String(req.params.id), s]
  );
  res.status(204).end();
}));

// ---- FACTURAS ----
app.get('/api/facturacion/facturas', ah(async (req, res) => {
  const s = getSucursal(req);

  const { desde, hasta } = req.query;
  let { estado } = req.query;

  // Normaliza el estado que llega del UI
  estado = (estado || '').toString().trim().toLowerCase();
  if (estado === 'timbradas') estado = 'timbrada';
  if (estado === 'borradores') estado = 'borrador';
  if (estado === 'canceladas') estado = 'cancelada';
  if (estado === 'todas') estado = '';

  // WHERE dinámico + parámetros
  const whereParts = [`${sucWhereN(1)}`]; // $1 = sucursal
  const params = [s];
  let i = 2;

  if (desde) { whereParts.push(`created_at::date >= $${i}`); params.push(String(desde)); i++; }
  if (hasta) { whereParts.push(`created_at::date <= $${i}`); params.push(String(hasta)); i++; }
  if (estado && ['timbrada','borrador','cancelada'].includes(estado)) {
    whereParts.push(`estado = $${i}`); params.push(estado); i++;
  }

  const sql = `
    SELECT
      id, cliente, tipo, forma_pago, metodo_pago, cita_id, notas, total, sucursal_id,
      created_at, estado, uuid, serie, folio, fecha_timbrado
    FROM facturas
    WHERE ${whereParts.join(' AND ')}
    ORDER BY created_at DESC
  `;

  const { rows } = await q(sql, params);
  res.json(rows);
}));

app.get('/api/facturacion/facturas/:id', ah(async (req, res) => {
  const s = getSucursal(req);
  const id = String(req.params.id);
  const { rows } = await q(
    `SELECT id, cliente, tipo, forma_pago, metodo_pago, cita_id, notas, total, sucursal_id, created_at
     FROM facturas
     WHERE id=$1 AND ${sucWhereN(2)}`, [id, s]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Factura no encontrada' });
  const factura = rows[0];
  const conceptos = await q(
    `SELECT id, descripcion, cantidad, valor_unitario, importe, clave_prod_serv, unidad, objeto_imp
     FROM factura_conceptos WHERE factura_id=$1 ORDER BY id ASC`, [id]
  );
  res.json({ ...factura, conceptos: conceptos.rows });
}));

app.post('/api/facturacion/facturas/:id/timbrar', ah(async (req, res) => {
  const s = getSucursal(req);
  const id = String(req.params.id);
  const now = new Date().toISOString();
  return res.json({ ok: true, id, uuid: 'UUID-DE-EJEMPLO', fecha_timbrado: now });
}));

app.post('/api/facturacion/facturas/:id/cancelar', ah(async (req, res) => {
  const s = getSucursal(req);
  const id = String(req.params.id);
  const { motivo } = req.body || {};

  // Marca como cancelada en tu DB
  const { rows } = await q(
    `UPDATE facturas
        SET estado = 'cancelada',
            status = COALESCE(status, 'Cancelada'),
            cancelada_at = NOW(),
            motivo_cancelacion = COALESCE($1, motivo_cancelacion)
      WHERE id = $2 AND ${sucWhereN(3)}
      RETURNING id, estado, cancelada_at, motivo_cancelacion`,
    [motivo || null, id, s]
  );

  if (rows.length === 0) {
    return res.status(404).json({ ok: false, error: 'Factura no encontrada' });
  }

  // (Opcional) aquí podrías llamar al PAC para cancelar el CFDI
  return res.json({ ok: true, ...rows[0] });
}));



app.post('/api/facturacion/facturas', ah(async (req, res) => {
  const s = getSucursal(req);
  const body = req.body || {};
  const { cliente, tipo, forma_pago, metodo_pago, cita_id, notas, total, conceptos } = body;

  if (!cliente || !String(cliente).trim()) return res.status(400).json({ error: 'El cliente es requerido' });
  if (!tipo || !String(tipo).trim())       return res.status(400).json({ error: 'El tipo de factura es requerido' });

  const tot = Number(total ?? 0);
  const { rows } = await q(
    `INSERT INTO facturas (cliente, tipo, forma_pago, metodo_pago, cita_id, notas, total, sucursal_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [String(cliente).trim(), String(tipo).trim(), forma_pago || null, metodo_pago || null, cita_id || null, notas || null, isFinite(tot) ? tot : 0, s]
  );
  const factura = rows[0];

  if (Array.isArray(conceptos)) {
    for (const c of conceptos) {
      const cantidad = Number(c.cantidad || 1);
      const valor    = Number(c.valor_unitario || c.valorUnitario || 0);
      const importe  = Number(c.importe != null ? c.importe : cantidad * valor);
      await q(
        `INSERT INTO factura_conceptos
           (factura_id, descripcion, cantidad, valor_unitario, importe, clave_prod_serv, unidad, objeto_imp, sucursal_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          factura.id,
          String(c.descripcion || c.descripcionCorta || 'Concepto').trim(),
          isFinite(cantidad) ? cantidad : 1,
          isFinite(valor) ? valor : 0,
          isFinite(importe) ? importe : 0,
          c.clave_prod_serv || c.claveProdServ || null,
          c.unidad || null,
          c.objeto_imp || c.objetoImp || null,
          s
        ]
      );
    }
  }

  res.json(factura);
}));

app.put('/api/facturacion/facturas/:id', ah(async (req, res) => {
  const s = getSucursal(req);
  const id = String(req.params.id);
  const { cliente, tipo, forma_pago, metodo_pago, cita_id, notas, total, conceptos } = req.body || {};

  const { rows } = await q(
    `UPDATE facturas
     SET cliente = COALESCE($1, cliente),
         tipo = COALESCE($2, tipo),
         forma_pago = COALESCE($3, forma_pago),
         metodo_pago = COALESCE($4, metodo_pago),
         cita_id = COALESCE($5, cita_id),
         notas = COALESCE($6, notas),
         total = COALESCE($7, total)
     WHERE id=$8 AND ${sucWhereN(9)}
     RETURNING *`,
    [cliente || null, tipo || null, forma_pago || null, metodo_pago || null, cita_id || null, notas || null, total != null ? Number(total) : null, id, s]
  );
  const factura = rows[0];
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });

  if (Array.isArray(conceptos)) {
    await q(`DELETE FROM factura_conceptos WHERE factura_id=$1`, [id]);
    for (const c of conceptos) {
      const cantidad = Number(c.cantidad || 1);
      const valor    = Number(c.valor_unitario || c.valorUnitario || 0);
      const importe  = Number(c.importe != null ? c.importe : cantidad * valor);
      await q(
        `INSERT INTO factura_conceptos
          (factura_id, descripcion, cantidad, valor_unitario, importe, clave_prod_serv, unidad, objeto_imp, sucursal_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          String(c.descripcion || 'Concepto').trim(),
          isFinite(cantidad) ? cantidad : 1,
          isFinite(valor) ? valor : 0,
          isFinite(importe) ? importe : 0,
          c.clave_prod_serv || null,
          c.unidad || null,
          c.objeto_imp || null,
          s
        ]
      );
    }
  }

  res.json(factura);
}));

app.delete('/api/facturacion/facturas/:id', ah(async (req, res) => {
  const s = getSucursal(req);
  await q(`DELETE FROM facturas WHERE id=$1 AND ${sucWhereN(2)}`, [String(req.params.id), s]);
  res.status(204).end();
}));

// ==============================
// 🆕 INVENTARIO — aislado por empresa + sucursal
// ==============================
app.get('/api/inventory', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const { rows } = await q(
    `SELECT * FROM inventory
     WHERE tenant_id = $1 AND ${sucWhereN(2)}
     ORDER BY id ASC`,
    [tenantId, s]
  );
  res.json(rows);
}));

app.post('/api/inventory', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const { sku, name, category, type, quantity, minStock, maxStock, price, supplier, usagePerPatient, expirationDate } = req.body || {};

  if (!sku || !String(sku).trim()) return res.status(400).json({ error: 'El SKU es requerido' });
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre es requerido' });

  const duplicate = await q(
    `SELECT id FROM inventory
     WHERE tenant_id=$1 AND ${sucWhereN(2)} AND LOWER(sku)=LOWER($3)
     LIMIT 1`,
    [tenantId, s, String(sku).trim()]
  );
  if (duplicate.rows[0]) return res.status(409).json({ error: 'Ya existe un producto con ese SKU en esta sucursal' });

  const { rows } = await q(
    `INSERT INTO inventory
      (sku, name, category, type, quantity, min_stock, max_stock, price, supplier,
       usage_per_patient, expiration_date, last_purchase, sucursal_id, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CURRENT_DATE,$12,$13)
     RETURNING *`,
    [String(sku).trim(), String(name).trim(), category, type, Number(quantity || 0),
     Number(minStock ?? 10), Number(maxStock ?? 100), Number(price || 0), supplier || null,
     Number(usagePerPatient || 1), expirationDate || null, s, tenantId]
  );
  res.json(rows[0]);
}));

app.put('/api/inventory/:id', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const id = Number(req.params.id);
  const { sku, name, category, type, quantity, minStock, maxStock, price, supplier, usagePerPatient, expirationDate } = req.body || {};

  if (sku) {
    const duplicate = await q(
      `SELECT id FROM inventory
       WHERE tenant_id=$1 AND ${sucWhereN(2)} AND LOWER(sku)=LOWER($3) AND id<>$4
       LIMIT 1`,
      [tenantId, s, String(sku).trim(), id]
    );
    if (duplicate.rows[0]) return res.status(409).json({ error: 'Ya existe otro producto con ese SKU en esta sucursal' });
  }

  const { rows } = await q(
    `UPDATE inventory
     SET sku = COALESCE($1, sku),
         name = COALESCE($2, name),
         category = COALESCE($3, category),
         type = COALESCE($4, type),
         quantity = COALESCE($5, quantity),
         min_stock = COALESCE($6, min_stock),
         max_stock = COALESCE($7, max_stock),
         price = COALESCE($8, price),
         supplier = COALESCE($9, supplier),
         usage_per_patient = COALESCE($10, usage_per_patient),
         expiration_date = COALESCE($11, expiration_date)
     WHERE id=$12 AND tenant_id=$13 AND ${sucWhereN(14)}
     RETURNING *`,
    [sku ? String(sku).trim() : null, name ? String(name).trim() : null, category || null, type || null,
     quantity ?? null, minStock ?? null, maxStock ?? null, price ?? null, supplier ?? null,
     usagePerPatient ?? null, expirationDate ?? null, id, tenantId, s]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json(rows[0]);
}));

app.delete('/api/inventory/:id', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const result = await q(
    `DELETE FROM inventory WHERE id=$1 AND tenant_id=$2 AND ${sucWhereN(3)}`,
    [Number(req.params.id), tenantId, s]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Producto no encontrado' });
  res.status(204).end();
}));

// Aplicar fórmula de tratamiento únicamente al inventario de la empresa/sucursal activa
app.post('/api/inventory/apply-formula', authRequired, ah(async (req, res) => {
  const s = getSucursal(req);
  const tenantId = getTenantId(req);
  const items = req.body?.items || req.body?.formula || [];
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Faltan items de la fórmula' });
  }

  const client = await getCurrentPool().connect();
  try {
    await client.query('BEGIN');
    const updated = [];
    const missing = [];

    for (const f of items) {
      const nombre = String(f.item || '').trim().toLowerCase();
      const cantidad = Number(f.quantity) || 0;
      if (!nombre || cantidad <= 0) continue;

      const found = await client.query(
        `SELECT id, name, quantity FROM inventory
         WHERE tenant_id=$1 AND (sucursal_id=$2 OR sucursal_id IS NULL)
           AND LOWER(name) LIKE '%' || $3 || '%'
         ORDER BY LENGTH(name) ASC LIMIT 1
         FOR UPDATE`,
        [tenantId, s, nombre]
      );
      if (!found.rows[0]) { missing.push(nombre); continue; }

      const producto = found.rows[0];
      const nuevoStock = Math.max(0, Number(producto.quantity) - cantidad);
      await client.query(
        `UPDATE inventory SET quantity=$1
         WHERE id=$2 AND tenant_id=$3 AND (sucursal_id=$4 OR sucursal_id IS NULL)`,
        [nuevoStock, producto.id, tenantId, s]
      );
      updated.push({ id: producto.id, name: producto.name, quantity: nuevoStock });
    }

    await client.query('COMMIT');
    res.json({ ok: true, updated, missing });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

// ==============================
// 🆕 HISTORIAL DE PACIENTES
// ==============================
app.get('/api/patients-full-history', ah(async (req, res) => {
  const s = getSucursal(req);

  const { rows } = await q(
    `SELECT DISTINCT ON (a.patient)
      a.patient AS name,
      a.phone,
      COALESCE(a.email, 'sin-email@example.com') AS email,
      30 AS age,
      (
        SELECT COALESCE(
          json_agg(
            json_build_object(
              'date', a2.date,
              'service', COALESCE(s2.name, 'Servicio desconocido'),
              'doctor', COALESCE(d2.name, 'Doctor desconocido'),
              'status', LOWER(COALESCE(a2.status, 'pendiente')),
              'notes', '',
              'cost', 0
            ) ORDER BY a2.date DESC
          ),
          '[]'::json
        )
        FROM appointments a2
        LEFT JOIN services s2 ON s2.id = a2.service_id
        LEFT JOIN doctors d2 ON d2.id = a2.doctor_id
        WHERE a2.patient = a.patient
          AND ${sucWhereN(2,'a2')}
      ) AS appointments
    FROM appointments a
    WHERE ${sucWhereN(1,'a')}
    ORDER BY a.patient, a.date DESC
    `,
    [s, s]
  );

  const patients = rows.map((row, idx) => ({
    id: idx + 1,
    name: row.name,
    phone: row.phone || 'Sin teléfono',
    email: row.email || 'sin-email@example.com',
    age: row.age || 0,
    appointments: Array.isArray(row.appointments) ? row.appointments : []
  }));

  res.json(patients);
}));

// ==============================
app.get('/', (_req, res) => res.status(404).json({ ok: false, message: 'Dentalux API' }));
app.get('/favicon.ico', (_req, res) => res.status(404).end());

app.use((err, _req, res, _next) => {
  console.error('Uncaught error:', err);
  const status = err?.status || 500;
  res.status(status).json({ error: err?.message || 'Internal Server Error' });
});

// ========================================
// NUEVOS ENDPOINTS PARA DASHBOARD GLOBAL
// ========================================

// Función auxiliar para obtener sucursal del request
function getSucursalFromReq(req) {
  return req.query.sucursal || req.headers['x-sucursal'] || req.body?.sucursal_id || 'sucursal_1';
}

function buildDateFilter(fechaInicio, fechaFin, dateColumn = 'date') {
  let dateFilter = '';
  let params = [];
  
  if (fechaInicio) {
    dateFilter += ` AND ${dateColumn} >= $${params.length + 2}::date`; // +2 porque sucursalId es $1
    params.push(fechaInicio);
  }
  
  if (fechaFin) {
    dateFilter += ` AND ${dateColumn} <= $${params.length + 2}::date`; // +2 por la misma razón
    params.push(fechaFin);
  }
  
  return { dateFilter, params };
}

// ==============================================
// ENDPOINT PRINCIPAL: Dashboard Global por Sucursal
// ==============================================
app.get('/api/dashboard/:sucursalId', ah(async (req, res) => {
  const { sucursalId } = req.params;
  const { fecha_inicio, fecha_fin } = req.query;
  
  try {
    // Si es MELISSA, usar la base de datos MELISSA
    if (sucursalId === 'melissa' && qMelissa) {
      const result = await getDashboardDataMelissa(fecha_inicio, fecha_fin);
      return res.json(result);
    }
    
    // Para sucursales principales, usar la base de datos principal
    const result = await getDashboardData(sucursalId, fecha_inicio, fecha_fin);
    res.json(result);
    
  } catch (error) {
    console.error('Error en dashboard:', error);
    res.status(500).json({ error: error.message });
  }
}));

// ==============================================
// ==============================================
// FUNCIÓN: Datos del Dashboard (Base Principal)
// ==============================================
async function getDashboardData(sucursalId, fechaInicio, fechaFin) {
  const { dateFilter, params } = buildDateFilter(fechaInicio, fechaFin, 'date');
  
  // 1. Citas
  const appointments = await q(`
    SELECT 
      id, 
      COALESCE(patient, 'Paciente Sin Nombre') as patient,
      COALESCE(doctor_id, 1) as doctor_id,
      COALESCE(service_id, 1) as service_id,
      COALESCE(date, CURRENT_DATE) as date,
      COALESCE(status, 'Pendiente') as status,
      phone,
      sucursal_id
    FROM appointments 
    WHERE sucursal_id = $1 ${dateFilter}
    ORDER BY date DESC
  `, [sucursalId, ...params]);
  
  // 2. Pagos
  const payments = await q(`
    SELECT 
      id,
      COALESCE(amount, 0) as amount,
      COALESCE(payment_method, 'efectivo') as payment_method,
      COALESCE(date, CURRENT_DATE) as date,
      appointment_id,
      patient,
      sucursal_id
    FROM payments 
    WHERE sucursal_id = $1 ${dateFilter}
    ORDER BY date DESC
  `, [sucursalId, ...params]);
  
  // 3. Gastos
  const expenses = await q(`
    SELECT * FROM expenses 
    WHERE sucursal_id = $1 ${dateFilter}
    ORDER BY date DESC
  `, [sucursalId, ...params]);
  
  // 4. Trabajos de Laboratorio (usar buildDateFilter separado para fecha_inicio)
  const { dateFilter: labDateFilter, params: labParams } = buildDateFilter(fechaInicio, fechaFin, 'fecha_inicio');
  const trabajosLab = await q(`
    SELECT t.*, 
           COALESCE(
             (SELECT JSON_AGG(
               JSON_BUILD_OBJECT(
                 'id', a.id,
                 'monto', a.monto,
                 'fecha', a.fecha,
                 'metodo_pago', a.metodo_pago,
                 'nota', a.nota
               )
             ) FROM lab_abonos a WHERE a.trabajo_id = t.id), 
             '[]'::json
           ) as abonos
    FROM lab_trabajos t 
    WHERE t.sucursal_id = $1 
    ${labDateFilter}
    ORDER BY t.fecha_inicio DESC
  `, [sucursalId, ...labParams]);
    
  // 5. Doctores
  const doctors = await q(`
    SELECT * FROM doctors 
    WHERE sucursal_id = $1 
    ORDER BY name
  `, [sucursalId]);
  
  // 6. Servicios
  const services = await q(`
    SELECT 
      id,
      COALESCE(name, 'Servicio Sin Nombre') as name,
      COALESCE(price, 0) as price,
      sucursal_id
    FROM services 
    WHERE sucursal_id = $1 
    ORDER BY name
  `, [sucursalId]);

   // 7. Satisfacción del servicio (registros crudos por cita / servicio)
  const satisfaccion = await q(`
    SELECT 
      id,
      appointment_id,
      service_id,
      patient_id,
      doctor_id,
      rating,
      comentario,
      sucursal_id,
      created_at
    FROM satisfaccion_servicio
    WHERE (sucursal_id = $1 OR sucursal_id IS NULL)
      AND created_at::date BETWEEN $2 AND $3
    ORDER BY created_at DESC
  `, [sucursalId, fechaInicio, fechaFin]);

  // 8. Satisfacción agregada por servicio (para el dashboard)
  const satisfaccionServicios = await q(`
    SELECT 
      service_id,
      ROUND(AVG(rating), 2) AS promedio_rating,
      COUNT(*)             AS total_respuestas
    FROM satisfaccion_servicio
    WHERE (sucursal_id = $1 OR sucursal_id IS NULL)
      AND created_at::date BETWEEN $2 AND $3
    GROUP BY service_id
    ORDER BY service_id
  `, [sucursalId, fechaInicio, fechaFin]);

  // 9. Inventario con métricas completas
  let inventory = [];
  let inventarioStats = {
    total_productos: 0,
    total_stock: 0,
    valor_total: 0,
    productos_agotados: 0,
    productos_stock_bajo: 0,
    eficiencia_stock: 0
  };
  
  try {
    // Obtener productos con estados calculados
    inventory = await q(`
      SELECT 
        id, sku, name, category, type, quantity, min_stock, max_stock, 
        price, supplier, last_purchase, usage_per_patient, expiration_date,
        (quantity * price) as valor_total,
        CASE 
          WHEN quantity <= 0 THEN 'agotado'
          WHEN quantity <= min_stock * 0.5 THEN 'critico'
          WHEN quantity <= min_stock THEN 'bajo'
          ELSE 'normal'
        END as estado_stock,
        (quantity::float / NULLIF(min_stock, 0) * 100) as porcentaje_stock
      FROM inventory 
      WHERE sucursal_id = $1
      ORDER BY name
    `, [sucursalId]);

    // Calcular métricas de inventario
    const inventoryMetrics = await q(`
      SELECT 
        COUNT(*) as total_productos,
        SUM(quantity) as total_stock,
        SUM(quantity * price) as valor_total,
        SUM(CASE WHEN quantity <= 0 THEN 1 ELSE 0 END) as productos_agotados,
        SUM(CASE WHEN quantity <= min_stock THEN 1 ELSE 0 END) as productos_stock_bajo,
        AVG(quantity::float / NULLIF(min_stock, 0) * 100) as eficiencia_stock
      FROM inventory 
      WHERE sucursal_id = $1
    `, [sucursalId]);

    inventarioStats = inventoryMetrics.rows[0] || inventarioStats;
    
  } catch (error) {
    console.log('Error obteniendo inventario:', error);
  }
  
  // Calcular métricas base
   const metricas = calculateMetrics({
    appointments: appointments.rows,
    payments: payments.rows,
    expenses: expenses.rows,
    trabajosLab: trabajosLab.rows,
    doctors: doctors.rows,
    services: services.rows,
    inventory: Array.isArray(inventory.rows) ? inventory.rows : (inventory || []),
    satisfaccion: satisfaccion.rows   // 🆕
  });

  
    return {
    sucursalId,
    nombre: sucursalId === 'sucursal_1' ? 'Sucursal Centro' : 'Sucursal Norte',
    periodo: { fecha_inicio: fechaInicio, fecha_fin: fechaFin },

    // Datos crudos
    appointments: appointments.rows,
    payments: payments.rows,
    expenses: expenses.rows,
    trabajosLaboratorio: trabajosLab.rows,
    doctors: doctors.rows,
    services: services.rows,
    inventory: inventory.rows || [],

    // 🆕 Satisfacción (cruda y agregada por servicio)
    satisfaccion: satisfaccion.rows,
    satisfaccionServicios: satisfaccionServicios.rows,

    // Métricas calculadas
    metricas: {
      ...metricas,
      inventario: {
        totalProductos: parseInt(inventarioStats.total_productos),
        productosStockBajo: parseInt(inventarioStats.productos_stock_bajo),
        productosAgotados: parseInt(inventarioStats.productos_agotados),
        valorInventario: parseFloat(inventarioStats.valor_total || 0),
        eficienciaStock: parseFloat(inventarioStats.eficiencia_stock || 0),
        alertasCriticas: inventory.rows
          ? inventory.rows.filter(item =>
              item.estado_stock === 'critico' || item.estado_stock === 'agotado'
            ).length
          : 0
      }
    }
  };
}

// ==============================================
// FUNCIÓN: Calcular Métricas
// ==============================================
function calculateMetrics(data) {
  const {
    appointments = [],
    payments = [],
    expenses = [],
    trabajosLab = [],
    doctors = [],
    services = [],
    inventory = [],
    satisfaccion = []   // 🆕
  } = data;
  
  console.log(`  🧮 Calculando métricas: ${appointments.length} citas, ${payments.length} pagos`);
  
  // Métricas Financieras (CORREGIDO - usar safeNumber)
  const ingresos = payments.reduce((sum, p) => sum + safeNumber(p.amount), 0);
  const gastos = expenses.reduce((sum, e) => sum + safeNumber(e.amount), 0);
  const utilidad = ingresos - gastos;
  const margenUtilidad = ingresos > 0 ? (utilidad / ingresos) * 100 : 0;
  
  // Laboratorio
  const ingresosLaboratorio = trabajosLab.reduce((sum, t) => sum + safeNumber(t.presupuesto), 0);
  const abonosLaboratorio = trabajosLab.reduce((sum, t) => {
    const abonos = Array.isArray(t.abonos) ? t.abonos : 
                   (typeof t.abonos === 'string' ? JSON.parse(t.abonos || '[]') : []);
    return sum + abonos.reduce((abonoSum, a) => abonoSum + safeNumber(a.monto), 0);
  }, 0);
  const saldosPendientes = ingresosLaboratorio - abonosLaboratorio;
  
  // Métodos de pago (NUEVO)
  const metodosPago = payments.reduce((acc, p) => {
    const metodo = p.payment_method || 'efectivo';
    acc[metodo] = (acc[metodo] || 0) + safeNumber(p.amount);
    return acc;
  }, {});
  
  // Métricas Operacionales (CORREGIDO)
  const totalCitas = appointments.length;
  const citasAtendidas = appointments.filter(a => 
    ['Atendida', 'Completada', 'Finalizada', 'atendida', 'completada', 'finalizada'].includes(a.status)
  ).length;
  const citasCanceladas = appointments.filter(a => 
    ['Cancelada', 'cancelada'].includes(a.status)
  ).length;
  const citasPendientes = totalCitas - citasAtendidas - citasCanceladas;
  const tasaConversion = totalCitas > 0 ? (citasAtendidas / totalCitas) * 100 : 0;
  
  const trabajosLaboratorio = trabajosLab.length;
  const trabajosCompletados = trabajosLab.filter(t => 
    ['Completado', 'Entregado', 'completado', 'entregado'].includes(t.etapa)
  ).length;
  const trabajosPendientes = trabajosLaboratorio - trabajosCompletados;
  
  const pacientesUnicos = new Set(appointments.map(a => a.patient)).size;
  
  // Citas por día (para gráfico)
  const citasPorDia = appointments.reduce((acc, a) => {
    const fecha = a.date;
    if (!acc[fecha]) {
      acc[fecha] = { fecha, total: 0, atendidas: 0 };
    }
    acc[fecha].total++;
    if (['Atendida', 'Completada', 'Finalizada', 'atendida', 'completada', 'finalizada'].includes(a.status)) {
      acc[fecha].atendidas++;
    }
    return acc;
  }, {});
  
  // Métricas de Inventario (CORREGIDO)
  const totalProductos = inventory.length;
  const productosStockBajo = inventory.filter(p => 
    safeNumber(p.stock || p.quantity) <= safeNumber(p.min_stock)
  ).length;
  const productosAgotados = inventory.filter(p => 
    safeNumber(p.stock || p.quantity) === 0
  ).length;
  const valorInventario = inventory.reduce((sum, p) => 
    sum + (safeNumber(p.stock || p.quantity) * safeNumber(p.price)), 0
  );
  const eficienciaStock = totalProductos > 0 ? 
    ((totalProductos - productosStockBajo - productosAgotados) / totalProductos * 100) : 100;
  
  // Métricas por Doctor (CORREGIDO)
  const metricasDoctores = doctors.map(doctor => {
    const citasDoctor = appointments.filter(a => a.doctor_id === doctor.id);
    const pagosDoctor = payments.filter(p => {
      const citaAsociada = appointments.find(a => a.id === p.appointment_id);
      return citaAsociada && citaAsociada.doctor_id === doctor.id;
    });
    const trabajosLabDoctor = trabajosLab.filter(t => t.doctor_id === doctor.id);
    
    const citasAtendidasDoc = citasDoctor.filter(c => 
      ['Atendida', 'Completada', 'Finalizada', 'atendida', 'completada', 'finalizada'].includes(c.status)
    ).length;
    
    const ingresosDoctor = pagosDoctor.reduce((sum, p) => sum + safeNumber(p.amount), 0);
    const tasaConversionDoc = citasDoctor.length > 0 ? (citasAtendidasDoc / citasDoctor.length) * 100 : 0;
    
    return {
      doctorId: doctor.id.toString(),
      nombre: doctor.name,
      color: doctor.color || '#8884d8',
      citas: citasDoctor.length,
      citasAtendidas: citasAtendidasDoc,
      ingresos: ingresosDoctor,
      tasaConversion: tasaConversionDoc,
      comision: 0.2,
      trabajosLaboratorio: trabajosLabDoctor.length,
    };
  });
  
  // Métricas de Servicios (MEJORADO + satisfacción real)
  const servicioStats = services.reduce((acc, service) => {
    const citasServicio = appointments.filter(a => a.service_id === service.id);
    const pagosServicio = payments.filter(p => {
      const citaAsociada = appointments.find(a => a.id === p.appointment_id);
      return citaAsociada && citaAsociada.service_id === service.id;
    });

    const ingresoTotal = pagosServicio.reduce((sum, p) => sum + safeNumber(p.amount), 0);
    const cantidadVendida = citasServicio.length;

    acc.ingresosPorServicio[service.name] = ingresoTotal;
    acc.cantidadPorServicio[service.name] = cantidadVendida;

    // proteger división entre 0
    acc.margenPorServicio[service.name] = service.price && ingresoTotal > 0
      ? ((ingresoTotal - (cantidadVendida * service.price * 0.3)) / ingresoTotal) * 100
      : 0;

    // Por ahora tiempo promedio fijo (luego lo ligamos a duración real)
    acc.tiempoPromedioPorServicio[service.name] = 60;

    // 🆕 Satisfacción REAL por servicio (promedio 0–5)
    const ratingsServicio = satisfaccion.filter(r => r.service_id === service.id);
    if (ratingsServicio.length > 0) {
      const totalRating = ratingsServicio.reduce((sum, r) => sum + safeNumber(r.rating), 0);
      acc.satisfaccionPorServicio[service.name] = totalRating / ratingsServicio.length;
    } else {
      acc.satisfaccionPorServicio[service.name] = null; // sin datos aún
    }

    return acc;
  }, {
    ingresosPorServicio: {},
    cantidadPorServicio: {},
    margenPorServicio: {},
    tiempoPromedioPorServicio: {},
    satisfaccionPorServicio: {}
  });

const servicioMasVendido = Object.keys(servicioStats.cantidadPorServicio).reduce((max, current) => 
  servicioStats.cantidadPorServicio[current] > (servicioStats.cantidadPorServicio[max] || 0) ? current : max, 
  Object.keys(servicioStats.cantidadPorServicio)[0]
) || 'N/A';

// Generar tendencia de servicios por mes (últimos 6 meses)
const tendenciaServicios = [];
const fechaActual = new Date();
for (let i = 5; i >= 0; i--) {
  const fecha = new Date(fechaActual);
  fecha.setMonth(fecha.getMonth() - i);
  const mes = fecha.toLocaleDateString('es-MX', { month: 'short', year: 'numeric' });
  
  services.forEach(service => {
    const citasMes = appointments.filter(a => {
      const fechaCita = new Date(a.date);
      return a.service_id === service.id && 
             fechaCita.getMonth() === fecha.getMonth() && 
             fechaCita.getFullYear() === fecha.getFullYear();
    });
    
    const ingresosMes = payments.filter(p => {
      const citaAsociada = appointments.find(a => a.id === p.appointment_id);
      const fechaPago = new Date(p.date);
      return citaAsociada && citaAsociada.service_id === service.id &&
             fechaPago.getMonth() === fecha.getMonth() && 
             fechaPago.getFullYear() === fecha.getFullYear();
    }).reduce((sum, p) => sum + safeNumber(p.amount), 0);
    
    if (citasMes.length > 0) {
      tendenciaServicios.push({
        mes,
        servicio: service.name,
        cantidad: citasMes.length,
        ingresos: ingresosMes
      });
    }
  });
}
  
  // Trabajos por etapa
  const trabajosPorEtapa = trabajosLab.reduce((acc, t) => {
    acc[t.etapa || 'Sin etapa'] = (acc[t.etapa || 'Sin etapa'] || 0) + 1;
    return acc;
  }, {});
  
  console.log(`  ✅ Métricas calculadas: $${ingresos} ingresos, ${citasAtendidas}/${totalCitas} citas`);
  
  return {
    financieras: {
      ingresos,
      gastos,
      utilidad,
      margenUtilidad,
      ingresosLaboratorio,
      abonosLaboratorio,
      saldosPendientes,
      metodosPago
    },
    operacionales: {
      totalCitas,
      citasAtendidas,
      citasCanceladas,
      citasPendientes,
      tasaConversion,
      pacientesUnicos,
      citasPorDia: Object.values(citasPorDia).sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
    },
    inventario: {
      totalProductos,
      productosStockBajo,
      productosAgotados,
      valorInventario,
      eficienciaStock,
      alertasCriticas: productosAgotados + productosStockBajo
    },
    laboratorio: {
      trabajosTotal: trabajosLaboratorio,
      trabajosCompletados,
      trabajosPendientes,
      presupuestoTotal: ingresosLaboratorio,
      abonosRecibidos: abonosLaboratorio,
      saldosPendientes,
      eficiencia: trabajosLaboratorio > 0 ? (trabajosCompletados / trabajosLaboratorio) * 100 : 0,
      trabajosPorEtapa
    },
    doctores: metricasDoctores,
    servicios: {
  serviciosActivos: services.length,
  servicioMasVendido,
  ingresosPorServicio: servicioStats.ingresosPorServicio,
  cantidadPorServicio: servicioStats.cantidadPorServicio,
  margenPorServicio: servicioStats.margenPorServicio,
  tiempoPromedioPorServicio: servicioStats.tiempoPromedioPorServicio,
  satisfaccionPorServicio: servicioStats.satisfaccionPorServicio,
  tendenciaServicios
}
  };
}

// ==============================================
// FUNCIÓN AUXILIAR: Servicio más vendido
// ==============================================
function findMostUsedService(appointments, services) {
  const serviceCounts = {};
  
  appointments.forEach(apt => {
    if (apt.service_id) {
      serviceCounts[apt.service_id] = (serviceCounts[apt.service_id] || 0) + 1;
    }
  });
  
  const mostUsedServiceId = Object.keys(serviceCounts).reduce((max, current) => 
    serviceCounts[current] > (serviceCounts[max] || 0) ? current : max, 
    Object.keys(serviceCounts)[0]
  );
  
  const mostUsedService = services.find(s => s.id == mostUsedServiceId);
  return mostUsedService?.name || 'N/A';
}

// ==============================================
// ENDPOINTS ESPECÍFICOS PARA INVENTARIO Y SERVICIOS
// ==============================================

// Inventario por sucursal
app.get('/api/inventario/:sucursalId', authRequired, ah(async (req, res) => {
  const { sucursalId } = req.params;
  const tenantId = getTenantId(req);
  
  try {
    const productos = await q(`
      SELECT 
        *,
        (COALESCE(stock, quantity, 0) * COALESCE(price, 0)) as valor_total,
        CASE 
          WHEN COALESCE(stock, quantity, 0) = 0 THEN 'agotado'
          WHEN COALESCE(stock, quantity, 0) <= COALESCE(min_stock, 5) THEN 'bajo'
          ELSE 'normal'
        END as stock_status
      FROM inventory 
      WHERE tenant_id = $1 AND sucursal_id = $2 
      ORDER BY name
    `, [tenantId, sucursalId]);
    
    // Alertas dinámicas basadas en stock
    const productosProblematicos = productos.rows.filter(p => p.stock_status !== 'normal');
    const alertas = productosProblematicos.map(p => ({
      id: `alert_${p.id}`,
      producto_id: p.id,
      tipo: p.stock_status,
      mensaje: p.stock_status === 'agotado' ? 
        `${p.name} está agotado` : 
        `${p.name} tiene stock bajo (${p.stock || p.quantity})`,
      prioridad: p.stock_status === 'agotado' ? 3 : 2,
      resuelta: false
    }));
    
    res.json({
      ok: true,
      data: {
        productos: productos.rows,
        alertas: alertas
      }
    });
    
  } catch (error) {
    console.error('Error en inventario:', error);
    res.json({ 
      ok: false, 
      data: { productos: [], alertas: [] },
      error: error.message 
    });
  }
}));

// Servicios detallados por sucursal
app.get('/api/servicios/:sucursalId', ah(async (req, res) => {
  const { sucursalId } = req.params;
  const { fecha_inicio, fecha_fin } = req.query;
  
  try {
    // Servicios básicos
    const servicios = await q(`
      SELECT * FROM services 
      WHERE sucursal_id = $1 
      ORDER BY name
    `, [sucursalId]);
    
    // Estadísticas de uso (citas por servicio)
    const { dateFilter, params } = buildDateFilter(fecha_inicio, fecha_fin, 'date');
    const estadisticas = await q(`
      SELECT 
        s.id,
        s.name,
        s.price,
        COUNT(a.id) as cantidad_vendida,
        SUM(p.amount) as ingresos_total
      FROM services s
      LEFT JOIN appointments a ON s.id = a.service_id 
        AND a.sucursal_id = $1 ${dateFilter}
      LEFT JOIN payments p ON a.id = p.appointment_id
      WHERE s.sucursal_id = $1
      GROUP BY s.id, s.name, s.price
      ORDER BY cantidad_vendida DESC
    `, [sucursalId, ...params]);
    
    res.json({
      servicios: servicios.rows,
      estadisticas: estadisticas.rows
    });
    
  } catch (error) {
    console.error('Error en servicios:', error);
    res.json({ servicios: [], estadisticas: [] });
  }
}));

// ==============================================
// ENDPOINT: Comparación Global
// ==============================================
app.get('/api/dashboard/comparacion', ah(async (req, res) => {
  const { fecha_inicio, fecha_fin } = req.query;
  
  try {
    // Obtener datos de ambas sucursales
    const sucursal1 = await getDashboardData('sucursal_1', fecha_inicio, fecha_fin);
    const sucursal2 = await getDashboardData('sucursal_2', fecha_inicio, fecha_fin);
    
    // También incluir MELISSA si está configurada
    let melissa = null;
    if (qMelissa) {
      try {
        melissa = await getDashboardDataMelissa(fecha_inicio, fecha_fin);
      } catch (error) {
        console.log('Error obteniendo datos de Melissa:', error.message);
      }
    }
    
    const sucursales = [sucursal1, sucursal2];
    if (melissa) sucursales.push(melissa);
    
    res.json({
      periodo: { fecha_inicio, fecha_fin },
      sucursales,
      resumen: {
        totalIngresos: sucursales.reduce((sum, s) => sum + s.metricas.financieras.ingresos, 0),
        totalUtilidad: sucursales.reduce((sum, s) => sum + s.metricas.financieras.utilidad, 0),
        totalCitas: sucursales.reduce((sum, s) => sum + s.metricas.operacionales.totalCitas, 0),
        totalPacientes: sucursales.reduce((sum, s) => sum + s.metricas.operacionales.pacientesUnicos, 0)
      }
    });
    
  } catch (error) {
    console.error('Error en comparación:', error);
    res.status(500).json({ error: error.message });
  }
}));

console.log('✅ Endpoints del Dashboard Global agregados');

// AGREGA ESTE ENDPOINT TEMPORAL AL FINAL DE TU server.js (antes de app.listen)

app.get('/api/debug/dashboard/:sucursalId', ah(async (req, res) => {
  const { sucursalId } = req.params;
  const { fecha_inicio, fecha_fin } = req.query;
  
  try {
    console.log(`🔍 DEBUG Dashboard: ${sucursalId}, fechas: ${fecha_inicio} a ${fecha_fin}`);
    
    // Consulta directa sin filtro de fechas
    const allAppointments = await q(`
      SELECT COUNT(*) as total, MIN(date) as min_date, MAX(date) as max_date
      FROM appointments 
      WHERE sucursal_id = $1
    `, [sucursalId]);
    
    // Consulta CON filtro de fechas
    const filteredAppointments = await q(`
      SELECT COUNT(*) as total, MIN(date) as min_date, MAX(date) as max_date
      FROM appointments 
      WHERE sucursal_id = $1 
      AND date >= CAST($2 AS date) 
      AND date <= CAST($3 AS date)
    `, [sucursalId, fecha_inicio, fecha_fin]);
    
    // Lo mismo para pagos
    const allPayments = await q(`
      SELECT COUNT(*) as total, MIN(date) as min_date, MAX(date) as max_date
      FROM payments 
      WHERE sucursal_id = $1
    `, [sucursalId]);
    
    const filteredPayments = await q(`
      SELECT COUNT(*) as total, MIN(date) as min_date, MAX(date) as max_date
      FROM payments 
      WHERE sucursal_id = $1 
      AND date >= CAST($2 AS date) 
      AND date <= CAST($3 AS date)
    `, [sucursalId, fecha_inicio, fecha_fin]);
    
    // Algunos registros de ejemplo
    const sampleAppointments = await q(`
      SELECT id, patient, date, status, service_id, doctor_id
      FROM appointments 
      WHERE sucursal_id = $1 
      ORDER BY date DESC 
      LIMIT 3
    `, [sucursalId]);
    
    const samplePayments = await q(`
      SELECT id, amount, payment_method, date, appointment_id
      FROM payments 
      WHERE sucursal_id = $1 
      ORDER BY date DESC 
      LIMIT 3
    `, [sucursalId]);
    
    res.json({
      sucursalId,
      fechas_solicitadas: { fecha_inicio, fecha_fin },
      appointments: {
        sin_filtro: allAppointments.rows[0],
        con_filtro: filteredAppointments.rows[0],
        ejemplos: sampleAppointments.rows
      },
      payments: {
        sin_filtro: allPayments.rows[0],
        con_filtro: filteredPayments.rows[0],
        ejemplos: samplePayments.rows
      }
    });
    
  } catch (error) {
    console.error('🚨 Error en debug dashboard:', error);
    res.status(500).json({ 
      error: error.message,
      stack: error.stack,
      sucursalId,
      fechas: { fecha_inicio, fecha_fin }
    });
  }
}));

console.log('🔍 Endpoint debug agregado: /api/debug/dashboard/:sucursalId');

// 🔹 AGREGAR AQUÍ (antes de la línea 2645):
// Endpoint de debug para verificar tablas
app.get('/api/debug/tablas', ah(async (req, res) => {
  const s = getSucursal(req);
  
  try {
    const resultados = {};
    const tablas = ['appointments', 'payments', 'expenses', 'doctors', 'services', 'inventory'];
    
    for (const tabla of tablas) {
      try {
        const count = await q(`SELECT COUNT(*) as total FROM ${tabla} WHERE sucursal_id = $1`, [s]);
        const sample = await q(`SELECT * FROM ${tabla} WHERE sucursal_id = $1 LIMIT 1`, [s]);
        
        resultados[tabla] = {
          existe: true,
          count: count.rows[0].total,
          sample: sample.rows[0] || null
        };
      } catch (error) {
        resultados[tabla] = {
          existe: false,
          error: error.message
        };
      }
    }
    
    res.json({
      sucursal: s,
      tablas: resultados
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}));

console.log('   🏥 Historia clínica (/api/historia-clinica/*)');
console.log('✅ Correcciones aplicadas - Dashboard listo');


(async () => {
  try {
    
// =========================================================
// 🏢 ESQUEMA MULTI-TENANT - FASE 1
// =========================================================
async function ensureMultiTenantSchema() {
  console.log('🏢 Verificando esquema multi-tenant...');

  // Necesario para generar UUID
  await q(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
  `);

  // Clientes o empresas que usarán la plataforma
  await q(`
    CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      plan TEXT NOT NULL DEFAULT 'basic',
      logo_url TEXT,
      primary_color TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Usuarios que iniciarán sesión
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Relación entre usuarios y clientes
  await q(`
    CREATE TABLE IF NOT EXISTS tenant_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL
        REFERENCES tenants(id)
        ON DELETE CASCADE,
      user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'employee',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, user_id)
    );
  `);

  // Sucursales pertenecientes a cada cliente
  await q(`
    CREATE TABLE IF NOT EXISTS branches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL
        REFERENCES tenants(id)
        ON DELETE CASCADE,
      name TEXT NOT NULL,
      branch_key TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, branch_key)
    );
  `);

  // Información pública y configuración que consume la Recepcionista V4.
  await q(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS whatsapp TEXT`);
  await q(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS business_hours TEXT`);
  await q(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS google_maps_url TEXT`);
  await q(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS directions TEXT`);
  await q(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS payment_methods TEXT`);
  await q(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS parking_info TEXT`);
  await q(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS welcome_message TEXT`);
  await q(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS cancellation_policy TEXT`);
  await q(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS preparation_notes TEXT`);
  await q(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS insurance_information TEXT`);
  await q(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS extra_information TEXT`);
  await q(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS promotions TEXT`);
  await q(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT TRUE`);
  await q(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS booking_enabled BOOLEAN NOT NULL DEFAULT TRUE`);

  // Índices
  await q(`
    CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant_id
    ON tenant_users(tenant_id);
  `);

  await q(`
    CREATE INDEX IF NOT EXISTS idx_tenant_users_user_id
    ON tenant_users(user_id);
  `);

  await q(`
    CREATE INDEX IF NOT EXISTS idx_branches_tenant_id
    ON branches(tenant_id);
  `);

  await q(`
    CREATE INDEX IF NOT EXISTS idx_tenants_status
    ON tenants(status);
  `);

  console.log('✅ Esquema multi-tenant listo');
}


// =========================================================
// 🏢 MULTIEMPRESA - FASE 2.1 (tablas operativas principales)
// =========================================================
const CORE_TENANT_TABLES = ['doctors', 'services', 'appointments', 'payments', 'expenses', 'laboratorios', 'lab_trabajos', 'lab_abonos', 'pagos_laboratorio', 'inventory'];

async function ensureCoreTenantSchema() {
  console.log('🏢 Verificando tenant_id en tablas operativas principales...');

  const { rows: tenantRows } = await q(`
    SELECT id
    FROM tenants
    WHERE slug = $1
    ORDER BY created_at ASC
    LIMIT 1
  `, [String(process.env.BOOTSTRAP_TENANT_SLUG || 'dentalux').trim().toLowerCase()]);

  const tenantId = tenantRows[0]?.id;
  if (!tenantId) {
    throw new Error('No se encontró el tenant principal para migrar los datos existentes');
  }

  for (const table of CORE_TENANT_TABLES) {
    const exists = await q(`SELECT to_regclass($1) AS name`, [`public.${table}`]);
    if (!exists.rows[0]?.name) {
      console.warn(`⚠️ Tabla ${table} todavía no existe; se omitió tenant_id`);
      continue;
    }

    await q(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS tenant_id UUID`);
    await q(`UPDATE ${table} SET tenant_id = $1 WHERE tenant_id IS NULL`, [tenantId]);
    await q(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant_id ON ${table}(tenant_id)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant_sucursal ON ${table}(tenant_id, sucursal_id)`);
  }

  // El SKU ya no debe ser único globalmente: cada empresa/sucursal puede usar el mismo SKU.
  const inventoryExists = await q(`SELECT to_regclass('public.inventory') AS name`);
  if (inventoryExists.rows[0]?.name) {
    await q(`
      DO $$
      DECLARE constraint_name TEXT;
      BEGIN
        SELECT tc.constraint_name INTO constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
         AND tc.table_schema = ccu.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'inventory'
          AND tc.constraint_type = 'UNIQUE'
          AND ccu.column_name = 'sku'
        LIMIT 1;

        IF constraint_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE inventory DROP CONSTRAINT %I', constraint_name);
        END IF;
      END $$;
    `);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_tenant_sucursal_sku
             ON inventory(tenant_id, sucursal_id, LOWER(sku))`);
  }

  console.log('✅ tenant_id listo en doctors, services, appointments, payments, expenses, laboratorios, lab_trabajos, lab_abonos, pagos_laboratorio e inventory');
}

function getTenantId(req) {
  const tenantId = req?.auth?.tenantId;
  if (!tenantId) {
    const error = new Error('No se pudo identificar la empresa de la sesión');
    error.status = 401;
    throw error;
  }
  return tenantId;
}

// =========================================================
    // 🧬 MIGRACIONES POR CADA BASE (DB1/DB2/DB3)
    // =========================================================
    const runStartupFor = async (pool, dbKey) => {
  if (!pool) return;

  await als.run({ pool, dbKey }, async () => {
    try {
      // await ensureRequiredFields();

      // 🏢 Crear tablas principales multi-tenant
      try {
        console.log(`🏢 Iniciando migración multi-tenant (${dbKey})...`);
        await ensureMultiTenantSchema();
        await ensureBootstrapDentaluxAdmin();
        await ensurePublicDemoAccount();
        await ensureCoreTenantSchema();
        console.log(`✅ Migración multi-tenant lista (${dbKey})`);
      } catch (err) {
        console.error(`❌ Error en migración multi-tenant (${dbKey}):`, err);
        throw err;
      }

      // 🤖 Crear tablas IA (ai_conversations/ai_messages) en cada DB
      if (aiModule && typeof aiModule.createAiTables === 'function') {
            try {
              console.log(`🤖 Iniciando migración IA (${dbKey}).`);
              await aiModule.createAiTables(q);
              console.log(`✅ Tablas IA listas (${dbKey})`);
            } catch (err) {
              console.error(`❌ Error en migración IA (${dbKey}):`, err);
            }
          } else {
            console.warn(`⚠️ No se pueden crear tablas IA (${dbKey}): módulo no disponible`);
          }

// Crear tablas médicas si el módulo está disponible
          if (medicalRecordModule && typeof medicalRecordModule.createMedicalRecordTables === 'function') {
            console.log(`🏥 Iniciando migración de tablas médicas (${dbKey})...`);
            try {
              await medicalRecordModule.createMedicalRecordTables(q);
              console.log(`✅ Tablas médicas creadas exitosamente (${dbKey})`);
            } catch (err) {
              console.error(`❌ Error en migración médica (${dbKey}):`, err);
            }
          } else {
            console.warn(`⚠️ No se pueden crear tablas médicas (${dbKey}): módulo no disponible`);
          }
        } catch (err) {
          console.error(`❌ Error en migraciones startup (${dbKey}):`, err);
          throw err;
        }
      });
    };

    // ===============================================================================
// 1. NUEVA FUNCIÓN PARA REINTENTAR (Copia esto tal cual)
// ===============================================================================
async function runStartupWithRetry(pool, name, retries = 5, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`⏳ Intentando conectar a ${name} (Intento ${i + 1}/${retries})...`);
      // Llamamos a tu función original
      await runStartupFor(pool, name);
      console.log(`✅ ${name} conectado y configurado con éxito.`);
      return; // Si funciona, sale del bucle y continúa con la siguiente DB
    } catch (err) {
      // Si es el último intento y falló, lanzamos el error definitivo
      if (i === retries - 1) {
        console.error(`🛑 Fallaron todos los intentos para ${name}`);
        throw err;
      }
      // Si falló pero quedan intentos, esperamos 'delay' milisegundos
      console.log(`⚠️ ${name} no está listo aún. Reintentando en ${delay/1000}s...`);
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

// ===============================================================================
// 2. EJECUCIÓN CON REINTENTOS (Sustituye tus "await runStartupFor" por esto)
// ===============================================================================
const startApp = async () => {
  try {
    // Ahora usamos la función con reintentos en lugar de la directa
    await runStartupWithRetry(poolDB1, 'db1');
    
    if (poolDB2) {
      await runStartupWithRetry(poolDB2, 'db2');
    }
    
    if (poolDB3) {
      await runStartupWithRetry(poolDB3, 'db3');
    }
    
    console.log('🚀 Todas las bases de datos están listas y sincronizadas.');
  } catch (error) {
    console.error('❌ ERROR CRÍTICO AL INICIAR:', error.message);
    // No cerramos el proceso para que Docker no entre en un ciclo infinito de reinicio inmediato
    // process.exit(1); 
  }
};

// Disparamos el inicio
startApp();

// ==============================
// 📩 FACEBOOK MESSENGER WEBHOOK
// (Para mensajes de Facebook Page / Click-to-Messenger)
// Nota: Click-to-WhatsApp NO pasa por aquí; eso llega por el webhook de WhatsApp.
// Requiere env:
//   FB_VERIFY_TOKEN=algo_secreto
//   FB_PAGE_ACCESS_TOKEN=EAAB...
// Opcional:
//   PUBLIC_BASE_URL=http://localhost:5173 (si no existe, usa req.get('host'))
// ==============================

const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || '';
// ✅ Tokens por Page ID (recomendado): {"<PAGE_ID>":"<PAGE_TOKEN>", ...}
const FB_PAGE_TOKENS_JSON = process.env.FB_PAGE_TOKENS_JSON || '';
// (Compatibilidad) Token único - evita usarlo si manejas varias páginas
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN || '';

function getFbPageToken(pageId) {
  const pid = String(pageId || '').trim();
  if (FB_PAGE_TOKENS_JSON) {
    try {
      const map = JSON.parse(FB_PAGE_TOKENS_JSON);
      const tok = map && map[pid];
      if (tok) return String(tok);
    } catch (e) {
      console.warn('⚠️ FB_PAGE_TOKENS_JSON inválido; debe ser JSON.');
    }
  }
  return FB_PAGE_ACCESS_TOKEN || '';
}

const MESSENGER_CONSULTORIO_PAGE_IDS = String(process.env.MESSENGER_CONSULTORIO_PAGE_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const MESSENGER_DETALLES_PAGE_IDS = String(process.env.MESSENGER_DETALLES_PAGE_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);


function getPublicBaseUrl(req) {
  const envUrl = process.env.PUBLIC_BASE_URL;
  if (envUrl) return envUrl.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
  const host = req.get('host');
  return `${proto}://${host}`;
}

async function fbSendText(psid, text, pageId) {
  const token = getFbPageToken(pageId);
  if (!token) {
    console.warn('⚠️ No hay token para responder Messenger (FB_PAGE_TOKENS_JSON/FB_PAGE_ACCESS_TOKEN). pageId=', String(pageId||''));
    return;
  }

  // Preferimos /{pageId}/messages (más consistente). Si no hay pageId, caemos a /me/messages.
  const targetId = String(pageId || 'me').trim() || 'me';
  const url = `https://graph.facebook.com/v20.0/${encodeURIComponent(targetId)}/messages`;

  const body = {
    recipient: { id: psid },
    messaging_type: 'RESPONSE',
    message: { text: String(text || '').slice(0, 1800) }
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('❌ Error enviando a Messenger:', r.status, j);
  }
}

async function callAiChatFromServer({ phone, message, channel, extra = {} }, req) {
  // Llama al endpoint local /api/ai/chat para reutilizar el mismo flujo IA
  const baseUrl = getPublicBaseUrl(req);
  const url = `${baseUrl}/api/ai/chat`;

  const store = als.getStore?.() ? als.getStore() : null;
  const dbKey = store?.dbKey || pickDbKey(req);
  const sucursal = store?.sucursal || getSucursal(req);

  const headers = { 'Content-Type': 'application/json' };
  if (dbKey) headers['x-db'] = String(dbKey);
  // Para Messenger evitamos forzar x-sucursal, para que el usuario pueda elegir sucursal en el flujo IA.
  if (sucursal && channel !== 'messenger') headers['x-sucursal'] = String(sucursal);

  // Propaga aislamiento IA si viene en la request actual
  const pn =
    req.headers['x-wa-phone-number-id'] ||
    req.headers['x-phone-number-id'] ||
    req.query?.phone_number_id;
  if (pn) headers['x-wa-phone-number-id'] = String(pn);

  const payload = {
    phone,
    message,
    channel: channel || 'facebook',
    ...extra
  };

  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  const j = await r.json().catch(() => ({}));
  return j;
}

// Deduplicación persistente de eventos Messenger.
// Meta puede reenviar el mismo MID; responder dos veces rompe el ritmo y puede pisar el estado.
const messengerMidInFlight = new Set();

async function claimMessengerMessageOnce(pageId, senderId, mid) {
  const messageId = String(mid || '').trim();
  if (!messageId) return true;

  if (messengerMidInFlight.has(messageId)) return false;
  messengerMidInFlight.add(messageId);

  try {
    await poolDB1.query(`
      CREATE TABLE IF NOT EXISTS messenger_processed_messages (
        mid TEXT PRIMARY KEY,
        page_id TEXT,
        sender_id TEXT,
        processed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const result = await poolDB1.query(
      `INSERT INTO messenger_processed_messages(mid, page_id, sender_id)
       VALUES ($1,$2,$3)
       ON CONFLICT (mid) DO NOTHING
       RETURNING mid`,
      [messageId, String(pageId || ''), String(senderId || '')]
    );

    // Limpieza defensiva para que la tabla no crezca sin límite.
    if (Math.random() < 0.01) {
      poolDB1.query(
        `DELETE FROM messenger_processed_messages
          WHERE processed_at < NOW() - INTERVAL '30 days'`
      ).catch(() => {});
    }

    return Boolean(result.rows?.length);
  } catch (error) {
    console.warn('⚠️ No se pudo verificar MID de Messenger:', error.message);
    // Si falla la tabla, el Set en memoria todavía evita duplicados simultáneos.
    return true;
  } finally {
    setTimeout(() => messengerMidInFlight.delete(messageId), 5 * 60 * 1000).unref?.();
  }
}

// Verificación del webhook (Meta/FB)

// =============================
// Messenger Webhook (Facebook)
// =============================

// Cache en memoria: PSID -> conversationId
const FB_CONV_CACHE = new Map();

async function getOrCreateFbConversationId(psid, pageId, req) {
  if (FB_CONV_CACHE.has(psid)) return FB_CONV_CACHE.get(psid);

  const baseUrl = getPublicBaseUrl(req);
  const createUrl = `${baseUrl}/api/ai/conversations`;

  const store = als.getStore?.() ? als.getStore() : null;
  const dbKey = store?.dbKey || pickDbKey(req);

  const headers = { 'Content-Type': 'application/json' };
  if (dbKey) headers['x-db'] = String(dbKey);
  if (pageId) headers['x-wa-phone-number-id'] = String(pageId);
  headers['x-sucursal'] = 'sucursal_1';

  const r = await fetch(createUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: `fb_${psid}` })
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.id) {
    console.error('❌ No pude crear conversación IA para Messenger:', r.status, j);
    return null;
  }

  FB_CONV_CACHE.set(psid, j.id);
  return j.id;
}

async function callSalesAiForMessenger(senderId, pageId, msgText, req) {
  // Reutiliza el flujo del router de ventas (leads + IA) para Messenger.
  // 1) /api/sales/leads/ensure  -> crea/obtiene lead por (messenger, senderId)
  // 2) /api/sales/leads/:id/messages -> genera respuesta y guarda historial
  const safeText = String(msgText || '').trim();
  if (!safeText) return { reply: '' };

  // Determinar baseUrl confiable
  // OJO: para llamadas "a sí mismo" desde un webhook, SIEMPRE es más seguro usar el host del request entrante,
  // porque PUBLIC_BASE_URL suele apuntar al FRONTEND (static) y eso provoca 404 "Cannot POST ...".
  const envBase = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '';
  const reqBase = req ? `${(req.get('x-forwarded-proto') || req.protocol)}://${req.get('host')}` : '';
  const baseUrl = reqBase || envBase || '';

  const headers = { 'Content-Type': 'application/json' };

  // 1) Ensure lead
  const ensureResp = await fetch(`${baseUrl}/api/sales/leads/ensure`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contact_pref: 'messenger',
      contact_value: String(senderId),
      notes: pageId ? `[Messenger] page_id=${pageId}` : '[Messenger]'
    })
  });

  if (!ensureResp.ok) {
    const t = await ensureResp.text().catch(() => '');
    throw new Error(`ensure lead failed: ${ensureResp.status} ${t}`);
  }

  const ensureJson = await ensureResp.json();
  const leadId = ensureJson?.lead?.id;
  if (!leadId) throw new Error('ensure lead: missing lead.id');

  // 2) Send message to lead pipeline
  const msgResp = await fetch(`${baseUrl}/api/sales/leads/${leadId}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: safeText,
      meta: { channel: 'messenger', senderId: String(senderId), pageId: String(pageId || '') }
    })
  });

  if (!msgResp.ok) {
    const t = await msgResp.text().catch(() => '');
    throw new Error(`lead message failed: ${msgResp.status} ${t}`);
  }

  return await msgResp.json();
}


async function callDetallesAiForMessenger(senderId, pageId, msgText, req) {
  // Reutiliza el flujo del router de DETALLES (leads + IA) para Messenger.
  // 1) /api/detalles/leads/ensure  -> crea/obtiene lead por (messenger, senderId)
  // 2) /api/detalles/leads/:id/messages -> genera respuesta y guarda historial
  const safeText = String(msgText || '').trim();
  if (!safeText) return { reply: '' };

  const envBase = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '';
  const reqBase = req ? `${(req.get('x-forwarded-proto') || req.protocol)}://${req.get('host')}` : '';
  const baseUrl = reqBase || envBase || '';

  const headers = { 'Content-Type': 'application/json' };

  // 1) Ensure lead
  const ensureResp = await fetch(`${baseUrl}/api/detalles/leads/ensure`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contact_pref: 'messenger',
      contact_value: String(senderId),
      notes: pageId ? `[Messenger] page_id=${pageId}` : '[Messenger]'
    })
  });

  if (!ensureResp.ok) {
    const t = await ensureResp.text().catch(() => '');
    throw new Error(`[detalles] ensure lead failed: ${ensureResp.status} ${t}`);
  }

  const ensureJson = await ensureResp.json();
  const leadId = ensureJson?.lead?.id;
  if (!leadId) throw new Error('[detalles] ensure lead: missing lead.id');

  // 2) Send message to lead pipeline
  const msgResp = await fetch(`${baseUrl}/api/detalles/leads/${leadId}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: safeText,
      meta: { channel: 'messenger', senderId: String(senderId), pageId: String(pageId || '') }
    })
  });

  if (!msgResp.ok) {
    const t = await msgResp.text().catch(() => '');
    throw new Error(`[detalles] lead message failed: ${msgResp.status} ${t}`);
  }

  return await msgResp.json();
}


function _dbKeyForMessengerPageId(pageId) {
  const pid = String(pageId || '').trim();
  if (!pid) return null;
  const fb1 = String(process.env.DB1_FB_PAGE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const fb2 = String(process.env.DB2_FB_PAGE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const fb3 = String(process.env.DB3_FB_PAGE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (fb2.includes(pid)) return 'db2';
  if (fb3.includes(pid)) return 'db3';
  if (fb1.includes(pid)) return 'db1';
  return null;
}

function _poolForDbKey(dbKey) {
  if (dbKey === 'db2' && poolDB2) return poolDB2;
  if (dbKey === 'db3' && poolDB3) return poolDB3;
  return poolDB1;
}

async function resolveMessengerTenantId(pageId, pool) {
  const pid = String(pageId || '').trim();
  if (!pid) throw new Error('Page ID ausente para resolver tenant de Messenger');

  // 1) Fuente principal: canal registrado desde Configuración > Empresa > Canales.
  // Se consulta con bypass controlado porque todavía no conocemos el tenant.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_bypass', 'on', true)`);

    const { rows: channelRows } = await client.query(
      `SELECT tenant_id
         FROM clinic_channels
        WHERE channel = 'messenger'
          AND COALESCE(active, TRUE) = TRUE
          AND COALESCE(is_active, TRUE) = TRUE
          AND (
            external_id = $1
            OR phone_number_id = $1
            OR metadata->>'page_id' = $1
          )
          AND tenant_id IS NOT NULL
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1`,
      [pid]
    );

    await client.query('COMMIT');

    const channelTenantId = String(channelRows?.[0]?.tenant_id || '').trim();
    if (channelTenantId) {
      console.log('🏢 Messenger tenant resuelto desde clinic_channels', {
        pageId: pid,
        tenantId: channelTenantId
      });
      return channelTenantId;
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.warn('⚠️ No se pudo resolver Messenger desde clinic_channels:', error.message);
  } finally {
    client.release();
  }

  // 2) Compatibilidad temporal: mapeo explícito por variable de entorno.
  // MESSENGER_PAGE_TENANTS_JSON={"114659410337690":"uuid-del-tenant"}
  const rawMap = String(process.env.MESSENGER_PAGE_TENANTS_JSON || '').trim();
  if (rawMap) {
    try {
      const map = JSON.parse(rawMap);
      const mapped = String(map?.[pid] || '').trim();
      if (mapped) return mapped;
    } catch (error) {
      console.warn('⚠️ MESSENGER_PAGE_TENANTS_JSON inválido:', error.message);
    }
  }

  // 3) Compatibilidad temporal: tenant único para páginas antiguas.
  const directTenant = String(process.env.MESSENGER_TENANT_ID || '').trim();
  if (directTenant) return directTenant;

  // 4) Último fallback para instalaciones antiguas sin canal registrado.
  const slug = String(
    process.env.MESSENGER_TENANT_SLUG ||
    process.env.BOOTSTRAP_TENANT_SLUG ||
    'dentalux'
  ).trim().toLowerCase();

  const { rows } = await pool.query(
    `SELECT id
       FROM tenants
      WHERE slug = $1
        AND status = 'active'
      ORDER BY created_at ASC
      LIMIT 1`,
    [slug]
  );

  const tenantId = String(rows?.[0]?.id || '').trim();
  if (!tenantId) {
    throw new Error(
      `No se encontró tenant para Messenger. Configura MESSENGER_TENANT_ID o MESSENGER_PAGE_TENANTS_JSON (page_id=${pid}).`
    );
  }
  return tenantId;
}

async function getOrCreateAiConversationIdForMessenger(pageId, psid, dbKey, tenantId) {
  const pool = _poolForDbKey(dbKey);
  const pid = String(pageId || '').trim();
  const sid = String(psid || '').trim();
  const tid = String(tenantId || '').trim();
  if (!tid) throw new Error('tenantId ausente para conversación de Messenger');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Todo acceso a tablas con RLS ocurre dentro del tenant correcto.
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tid]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS messenger_threads (
        id SERIAL PRIMARY KEY,
        page_id TEXT NOT NULL,
        psid TEXT NOT NULL,
        conversation_id BIGINT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(page_id, psid)
      )
    `);

    const found = await client.query(
      `SELECT conversation_id
         FROM messenger_threads
        WHERE page_id=$1 AND psid=$2
        LIMIT 1`,
      [pid, sid]
    );

    const existingConvId = found.rows?.[0]?.conversation_id
      ? Number(found.rows[0].conversation_id)
      : null;

    if (existingConvId) {
      const chk = await client.query(
        `SELECT 1
           FROM ai_conversations
          WHERE id=$1 AND tenant_id=$2::uuid
          LIMIT 1`,
        [existingConvId, tid]
      );

      if (chk.rows?.length) {
        await client.query(
          `UPDATE ai_conversations
              SET state = CASE
                    WHEN COALESCE(state->>'version','') = 'v4' OR COALESCE(state->>'version','') LIKE 'v5%' THEN state
                    ELSE jsonb_build_object(
                      'version',$3::text,
                      'active',FALSE,
                      'phone',COALESCE(state->>'phone', state->>'wa_phone'),
                      'branch_key',state->>'branch_key',
                      'migrated_from',COALESCE(state->>'version', state->>'stage', 'legacy'),
                      'migrated_at',NOW()
                    )
                  END,
                  updated_at = NOW()
            WHERE id=$1 AND tenant_id=$2::uuid`,
          [
            existingConvId,
            tid,
            String(
              process.env.RECEPTIONIST_ENGINE_VERSION ||
              process.env.RECEPTIONIST_VERSION ||
              'v5'
            ).trim().toLowerCase()
          ]
        );
        await client.query('COMMIT');
        return existingConvId;
      }

      await client.query(
        `UPDATE messenger_threads
            SET conversation_id=NULL
          WHERE page_id=$1 AND psid=$2`,
        [pid, sid]
      );
    }

    const title = `Messenger:${pid}:${sid}`.slice(0, 200);
    const created = await client.query(
      `INSERT INTO ai_conversations
         (tenant_id, title, clinic_id, channel, external_id,
          sucursal_id, phone_number_id, state)
       VALUES
         ($1::uuid, $2::text, $1::text, 'messenger', $3::text,
          NULL, $3::text, $4::jsonb)
       RETURNING id`,
      [
        tid,
        title,
        pid,
        JSON.stringify({
          version: String(
            process.env.RECEPTIONIST_ENGINE_VERSION ||
            process.env.RECEPTIONIST_VERSION ||
            'v5'
          ).trim().toLowerCase(),
          active: false,
          channel: 'messenger',
          external_key: `ms:${pid}:${sid}`,
          page_id: pid,
          psid: sid
        })
      ]
    );

    const convId = Number(created.rows[0].id);

    await client.query(
      `INSERT INTO messenger_threads(page_id, psid, conversation_id)
       VALUES ($1,$2,$3)
       ON CONFLICT (page_id, psid)
       DO UPDATE SET conversation_id=EXCLUDED.conversation_id`,
      [pid, sid, convId]
    );

    await client.query('COMMIT');
    return convId;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function callClinicAiForMessenger(senderId, pageId, msgText, req) {
  const safeText = String(msgText || '').trim();
  if (!safeText) return { reply: '' };

  const dbKey = _dbKeyForMessengerPageId(pageId) || pickDbKey(req) || 'db1';
  const pool = _poolForDbKey(dbKey);
  const tenantId = await resolveMessengerTenantId(pageId, pool);

  // JWT interno corto: permite reutilizar las rutas SaaS protegidas sin abrirlas públicamente.
  const internalToken = jwt.sign(
    {
      sub: `messenger:${String(senderId || '').trim()}`,
      tenantId,
      role: 'messenger'
    },
    requireGlobalJwtSecret(),
    { expiresIn: '2m' }
  );

  async function clearMessengerThread() {
    const pid = String(pageId || '').trim();
    const sid = String(senderId || '').trim();
    try {
      await pool.query(
        `UPDATE messenger_threads SET conversation_id=NULL WHERE page_id=$1 AND psid=$2`,
        [pid, sid]
      );
    } catch {}
  }

  async function runOnce(conversationId) {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${internalToken}`,
      'x-db': String(dbKey),
      'x-channel': 'messenger',
      'x-page-id': String(pageId || ''),
      'x-from': String(senderId || '')
    };

    const resp = await fetch(`${getPublicBaseUrl(req)}/api/ai/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        conversationId,
        message: safeText,
        channel: 'messenger',
        pageId: String(pageId || '')
      })
    });

    const data = await resp.json().catch(() => ({}));
    return { resp, data };
  }

  let conversationId = await getOrCreateAiConversationIdForMessenger(
    pageId,
    senderId,
    dbKey,
    tenantId
  );
  let { resp, data } = await runOnce(conversationId);

  // Limpia referencias antiguas y reintenta una sola vez.
  const errorText = String(data?.error || '').toLowerCase();
  if (!resp.ok && (
    resp.status === 401 ||
    resp.status === 403 ||
    (resp.status === 404 && errorText.includes('conversación'))
  )) {
    await clearMessengerThread();
    conversationId = await getOrCreateAiConversationIdForMessenger(
      pageId,
      senderId,
      dbKey,
      tenantId
    );
    ({ resp, data } = await runOnce(conversationId));
  }

  if (!resp.ok) {
    console.error('❌ [messenger][clinic] /api/ai/chat error', resp.status, data);
    return {
      reply: data?.reply || 'Estoy teniendo un problema técnico. Intenta de nuevo.'
    };
  }

  console.log('🤖 Messenger atendido por Recepcionista', {
    pageId: String(pageId || ''),
    tenantId,
    conversationId,
    engineVersion: data?.engineVersion || 'desconocida',
    used: data?.used || null
  });

  return data;
}

async function callAiChatForMessenger(senderId, pageId, msgText, req) {
  const pid = String(pageId || '').trim();
  const isClinic = MESSENGER_CONSULTORIO_PAGE_IDS.includes(pid);
  if (isClinic) return await callClinicAiForMessenger(senderId, pid, msgText, req);

  const isDetalles = MESSENGER_DETALLES_PAGE_IDS.includes(pid);
  if (isDetalles) return await callDetallesAiForMessenger(senderId, pid, msgText, req);

  return await callSalesAiForMessenger(senderId, pid, msgText, req);
}

// Verificación del webhook (Meta/FB)
app.get('/api/messenger/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && token === FB_VERIFY_TOKEN) {
    console.log('✅ Messenger webhook verificado');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Recepción de eventos
app.post('/api/messenger/webhook', async (req, res) => {
  try {
    const body = req.body;

    // Responde rápido a Meta
    res.sendStatus(200);

    if (!body || body.object !== 'page' || !Array.isArray(body.entry)) return;

    for (const entry of body.entry) {
      const messaging = entry.messaging || [];
      for (const event of messaging) {
        const senderId = event?.sender?.id;

        // Texto normal
        let msgText = event?.message?.text;

        // También soporta botones / postbacks
        if (!msgText && event?.postback?.payload) msgText = String(event.postback.payload);
        if (!msgText && event?.message?.quick_reply?.payload) msgText = String(event.message.quick_reply.payload);

        // Ignora eco (mensajes que enviamos nosotros)
        if (event?.message?.is_echo) continue;
        if (!senderId || !msgText) continue;

        const messageMid = event?.message?.mid || event?.postback?.mid || null;
        const claimed = await claimMessengerMessageOnce(entry?.id, senderId, messageMid);
        if (!claimed) {
          console.log('♻️ Messenger MID duplicado ignorado', {
            mid: messageMid,
            pageId: entry?.id,
            senderId
          });
          continue;
        }

        const ai = await callAiChatForMessenger(senderId, entry?.id, String(msgText).trim(), req);

        const reply =
          ai?.reply ||
          ai?.message ||
          ai?.text ||
          (ai?.error ? 'Estoy teniendo un problema técnico. Intenta de nuevo.' : 'Gracias. ¿Te ayudo a agendar o necesitas información?');

        await fbSendText(senderId, reply, entry?.id);
      }
    }
  } catch (e) {
    console.error('❌ Error Messenger webhook:', e);
    // ya respondimos 200 arriba
  }
});



// ===================== CliniqOne Sales AI (Facebook / Web) =====================
// Monta un módulo de "ventas" independiente (no sucursal), que usa el mismo /api/ai/chat del server central.
// Requiere: ./cliniqone_sales_router.js (incluido en tu repo) y (opcional) SALES_DATABASE_URL para elegir DB.
//
// Variables recomendadas en Render:
// - SALES_DATABASE_URL: (la DB donde guardar leads/ventas; por tu caso debe ser DB2)
// - PUBLIC_BASE_URL o RENDER_EXTERNAL_URL: URL pública del server central (para que el router se llame a sí mismo)
//
// Nota: NO toca WhatsApp, ni el flujo de citas; esto solo agrega /api/sales/*.
let _cliniqOneSalesRouterMounted = false;
try {
  const { createCliniqOneSalesRouter } = require('./cliniqone_sales_router');

  const publicBaseUrl =
    process.env.PUBLIC_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:5173');

  // Por defecto, el router guarda leads en SALES_DATABASE_URL.
  // Si NO la pones, usará DATABASE_URL_DB3 o DATABASE_URL como fallback (según el router).
  const salesRouter = createCliniqOneSalesRouter({
    centralAiBaseUrl: publicBaseUrl,
    centralAiSecret: process.env.CENTRAL_AI_SECRET || process.env.AI_SECRET || '',
    databaseUrl: process.env.SALES_DATABASE_URL || '',
    // Si quieres forzar que siempre use DB2 desde el router sin tocar env:
    // forceDbKey: 'db2'
  });

  app.use('/api/sales', salesRouter);
  _cliniqOneSalesRouterMounted = true;
  console.log('✅ /api/sales montado (CliniqOne Sales AI)');
} catch (e) {
  console.log('⚠️ No se montó /api/sales (cliniqone_sales_router no encontrado o error):', e?.message || e);
}


// ===================== Detalles Sales AI (Facebook / Messenger) =====================
// Monta un módulo de "ventas" para páginas de DETALLES / arreglos especiales.
// Requiere: ./detalles_sales_router.js
//
// Variables recomendadas en Render:
// - DETALLES_DATABASE_URL: DB donde guardar leads/mensajes (si no se define, usa SALES_DATABASE_URL o DATABASE_URL_DB2)
// - MESSENGER_DETALLES_PAGE_IDS: IDs de página (separados por comas) que deben usar este router
// - FB_PAGE_TOKENS_JSON: {"<PAGE_ID>":"<TOKEN>", ...} para poder responder con el token correcto por página
let _detallesSalesRouterMounted = false;
try {
  const { createDetallesSalesRouter } = require('./detalles_sales_router');

  const publicBaseUrlDet =
    process.env.PUBLIC_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:5173');

  const detallesRouter = createDetallesSalesRouter({
    centralAiBaseUrl: publicBaseUrlDet,
    centralAiSecret: process.env.CENTRAL_AI_SECRET || process.env.AI_SECRET || '',
    databaseUrl: process.env.DETALLES_DATABASE_URL || process.env.SALES_DATABASE_URL || '',
  });

  app.use('/api/detalles', detallesRouter);
  _detallesSalesRouterMounted = true;
  console.log('✅ /api/detalles montado (Detalles Sales AI)');
} catch (e) {
  console.log('⚠️ No se montó /api/detalles (detalles_sales_router no encontrado o error):', e?.message || e);
}
// ===============================================================================
// ===============================================================================



// ===============================================================================
// AUTENTICACIÓN DENTALUX (JWT)
// ===============================================================================
const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();
const JWT_EXPIRES_IN = String(process.env.JWT_EXPIRES_IN || '12h').trim();

function requireJwtSecret() {
  if (!JWT_SECRET) {
    const error = new Error('Falta JWT_SECRET en las variables de entorno');
    error.statusCode = 503;
    throw error;
  }
  return JWT_SECRET;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

const SUPERADMIN_EMAIL = normalizeEmail(
  process.env.SUPERADMIN_EMAIL ||
  process.env.BOOTSTRAP_ADMIN_EMAIL ||
  'nhaelvaldez26@hotmail.com'
);
const DEMO_EMAIL = 'cliniqonedemo@gmail.com';

function effectiveUserRole(email, storedRole) {
  const normalized = normalizeEmail(email);
  if (normalized === SUPERADMIN_EMAIL) return 'superadmin';
  if (normalized === DEMO_EMAIL) return 'demo';
  return storedRole || 'owner';
}

function publicUserPayload(row) {
  return {
    id: row.user_id,
    name: row.user_name,
    email: row.email,
    tenant: {
      id: row.tenant_id,
      name: row.tenant_name,
      slug: row.tenant_slug,
      plan: row.tenant_plan
    },
    role: effectiveUserRole(row.email, row.role),
    branches: Array.isArray(row.branches) ? row.branches : []
  };
}

async function loadLoginUserByEmail(email) {
  const { rows } = await poolDB1.query(`
    SELECT
      u.id AS user_id,
      u.name AS user_name,
      u.email,
      u.password_hash,
      u.active AS user_active,
      t.id AS tenant_id,
      t.name AS tenant_name,
      t.slug AS tenant_slug,
      t.plan AS tenant_plan,
      t.status AS tenant_status,
      tu.role,
      tu.active AS membership_active,
      COALESCE(
        jsonb_agg(
          DISTINCT jsonb_build_object(
            'id', b.id,
            'name', b.name,
            'branchKey', b.branch_key,
            'phone', b.phone,
            'address', b.address,
            'active', b.active
          )
        ) FILTER (WHERE b.id IS NOT NULL),
        '[]'::jsonb
      ) AS branches
    FROM users u
    JOIN tenant_users tu ON tu.user_id = u.id
    JOIN tenants t ON t.id = tu.tenant_id
    LEFT JOIN branches b
      ON b.tenant_id = t.id
      AND b.active = TRUE
    WHERE LOWER(u.email) = LOWER($1)
    GROUP BY
      u.id, u.name, u.email, u.password_hash, u.active,
      t.id, t.name, t.slug, t.plan, t.status,
      tu.role, tu.active
    ORDER BY
      CASE WHEN tu.role = 'owner' THEN 0 ELSE 1 END,
      t.created_at ASC
    LIMIT 1
  `, [email]);

  return rows[0] || null;
}

function authRequired(req, res, next) {
  try {
    const header = String(req.headers.authorization || '');
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ error: 'Sesión requerida' });
    }

    const payload = jwt.verify(match[1], requireJwtSecret());
    req.auth = payload;
    const store = als.getStore();
    if (store) store.tenantId = payload?.tenantId || null;
    if (payload?.role === 'demo' && ['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      return res.status(403).json({ error: 'La cuenta de demostración es solo de lectura' });
    }
    next();
  } catch (error) {
    return res.status(401).json({
      error: error?.name === 'TokenExpiredError'
        ? 'La sesión expiró. Inicia sesión nuevamente.'
        : 'Sesión inválida'
    });
  }
}

app.post('/api/auth/login', ah(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');

  if (!email || !password) {
    return res.status(400).json({ error: 'Escribe tu correo y contraseña' });
  }

  const row = await loadLoginUserByEmail(email);
  const validAccount =
    row &&
    row.user_active === true &&
    row.membership_active === true &&
    row.tenant_status === 'active';

  if (!validAccount || !(await bcrypt.compare(password, row.password_hash))) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  }

  const user = publicUserPayload(row);
  const token = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      tenantId: user.tenant.id,
      role: user.role
    },
    requireJwtSecret(),
    { expiresIn: JWT_EXPIRES_IN }
  );

  res.json({ ok: true, token, user });
}));

app.get('/api/auth/me', authRequired, ah(async (req, res) => {
  const { rows } = await poolDB1.query(`
    SELECT
      u.id AS user_id,
      u.name AS user_name,
      u.email,
      TRUE AS user_active,
      t.id AS tenant_id,
      t.name AS tenant_name,
      t.slug AS tenant_slug,
      t.plan AS tenant_plan,
      t.status AS tenant_status,
      tu.role,
      tu.active AS membership_active,
      COALESCE(
        jsonb_agg(
          DISTINCT jsonb_build_object(
            'id', b.id,
            'name', b.name,
            'branchKey', b.branch_key,
            'phone', b.phone,
            'address', b.address,
            'active', b.active
          )
        ) FILTER (WHERE b.id IS NOT NULL),
        '[]'::jsonb
      ) AS branches
    FROM users u
    JOIN tenant_users tu
      ON tu.user_id = u.id
      AND tu.tenant_id = $2
    JOIN tenants t ON t.id = tu.tenant_id
    LEFT JOIN branches b
      ON b.tenant_id = t.id
      AND b.active = TRUE
    WHERE u.id = $1
      AND u.active = TRUE
      AND tu.active = TRUE
      AND t.status = 'active'
    GROUP BY
      u.id, u.name, u.email,
      t.id, t.name, t.slug, t.plan, t.status,
      tu.role, tu.active
    LIMIT 1
  `, [req.auth.sub, req.auth.tenantId]);

  if (!rows[0]) {
    return res.status(401).json({ error: 'La cuenta ya no está disponible' });
  }

  res.json({ ok: true, user: publicUserPayload(rows[0]) });
}));


// ===============================================================================
// EMPRESAS — módulo SaaS básico
// ===============================================================================
function companiesSuperAdminOnly(req, res, next) {
  if (req.auth?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Acceso exclusivo para el superadministrador' });
  }
  next();
}

function companySlug(name) {
  return String(name || 'empresa').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'empresa';
}

async function uniqueCompanySlug(client, name, excludeId = null) {
  const base = companySlug(name); let slug = base; let i = 2;
  while (true) {
    const { rows } = await client.query('SELECT id FROM tenants WHERE slug=$1 AND ($2::uuid IS NULL OR id<>$2::uuid) LIMIT 1', [slug, excludeId]);
    if (!rows[0]) return slug;
    slug = `${base}-${i++}`;
  }
}

const companySelectSql = `
  SELECT t.id, t.name, t.slug, t.plan, t.status,
         COALESCE(owner_u.name, '') AS owner_name,
         COALESCE(owner_u.email, '') AS owner_email,
         COALESCE(first_b.name, '') AS branch_name,
         COALESCE(first_b.phone, '') AS phone,
         COALESCE(first_b.address, '') AS address
  FROM tenants t
  LEFT JOIN LATERAL (
    SELECT u.name, u.email FROM tenant_users tu JOIN users u ON u.id=tu.user_id
    WHERE tu.tenant_id=t.id AND tu.role='owner' ORDER BY tu.created_at ASC LIMIT 1
  ) owner_u ON TRUE
  LEFT JOIN LATERAL (
    SELECT b.name, b.phone, b.address FROM branches b
    WHERE b.tenant_id=t.id ORDER BY b.created_at ASC LIMIT 1
  ) first_b ON TRUE`;

function mapCompany(row) {
  return { id: row.id, name: row.name, slug: row.slug, plan: row.plan, status: row.status,
    ownerName: row.owner_name, ownerEmail: row.owner_email, branchName: row.branch_name,
    phone: row.phone, address: row.address };
}

app.get('/api/companies', authRequired, companiesSuperAdminOnly, ah(async (_req, res) => {
  const { rows } = await poolDB1.query(`${companySelectSql} ORDER BY t.created_at DESC`);
  res.json(rows.map(mapCompany));
}));


function mapBranchAI(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchKey: row.branch_key,
    name: row.name || '',
    phone: row.phone || '',
    whatsapp: row.whatsapp || '',
    address: row.address || '',
    businessHours: row.business_hours || '',
    googleMapsUrl: row.google_maps_url || '',
    directions: row.directions || '',
    paymentMethods: row.payment_methods || '',
    parkingInfo: row.parking_info || '',
    welcomeMessage: row.welcome_message || '',
    cancellationPolicy: row.cancellation_policy || '',
    preparationNotes: row.preparation_notes || '',
    insuranceInformation: row.insurance_information || '',
    extraInformation: row.extra_information || '',
    promotions: row.promotions || '',
    aiEnabled: row.ai_enabled !== false,
    bookingEnabled: row.booking_enabled !== false,
    active: row.active !== false
  };
}

const branchAiSelect = `
  SELECT id, tenant_id, branch_key, name, phone, whatsapp, address,
         business_hours, google_maps_url, directions, payment_methods,
         parking_info, welcome_message, cancellation_policy, preparation_notes,
         insurance_information, extra_information, promotions,
         ai_enabled, booking_enabled, active
    FROM branches
   WHERE tenant_id = $1::uuid
   ORDER BY CASE branch_key WHEN 'sucursal_1' THEN 1 WHEN 'sucursal_2' THEN 2 ELSE 3 END,
            created_at ASC`;

app.get('/api/companies/:id/branches/ai-config', authRequired, companiesSuperAdminOnly, ah(async (req, res) => {
  const { rows: tenantRows } = await poolDB1.query('SELECT id FROM tenants WHERE id=$1::uuid LIMIT 1', [req.params.id]);
  if (!tenantRows[0]) return res.status(404).json({ error: 'Empresa no encontrada' });
  const { rows } = await poolDB1.query(branchAiSelect, [req.params.id]);
  res.json(rows.map(mapBranchAI));
}));

app.put('/api/companies/:id/branches/ai-config', authRequired, companiesSuperAdminOnly, ah(async (req, res) => {
  const tenantId = req.params.id;
  const branches = Array.isArray(req.body?.branches) ? req.body.branches : [];
  const allowedKeys = new Set(['sucursal_1', 'sucursal_2']);
  if (!branches.length) return res.status(400).json({ error: 'Envía la configuración de las sucursales' });

  const client = await poolDB1.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query('SELECT id FROM tenants WHERE id=$1::uuid LIMIT 1', [tenantId]);
    if (!tenant.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    for (const item of branches) {
      const branchKey = String(item?.branchKey || '').trim();
      if (!allowedKeys.has(branchKey)) continue;
      const defaultName = branchKey === 'sucursal_1' ? 'Victoria' : 'Condesa';
      await client.query(`
        INSERT INTO branches (
          tenant_id, branch_key, name, phone, whatsapp, address,
          business_hours, google_maps_url, directions, payment_methods,
          parking_info, welcome_message, cancellation_policy, preparation_notes,
          insurance_information, extra_information, promotions,
          ai_enabled, booking_enabled, active, updated_at
        ) VALUES (
          $1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW()
        )
        ON CONFLICT (tenant_id, branch_key) DO UPDATE SET
          name=EXCLUDED.name, phone=EXCLUDED.phone, whatsapp=EXCLUDED.whatsapp,
          address=EXCLUDED.address, business_hours=EXCLUDED.business_hours,
          google_maps_url=EXCLUDED.google_maps_url, directions=EXCLUDED.directions,
          payment_methods=EXCLUDED.payment_methods, parking_info=EXCLUDED.parking_info,
          welcome_message=EXCLUDED.welcome_message,
          cancellation_policy=EXCLUDED.cancellation_policy,
          preparation_notes=EXCLUDED.preparation_notes,
          insurance_information=EXCLUDED.insurance_information,
          extra_information=EXCLUDED.extra_information,
          promotions=EXCLUDED.promotions, ai_enabled=EXCLUDED.ai_enabled,
          booking_enabled=EXCLUDED.booking_enabled, active=EXCLUDED.active,
          updated_at=NOW()
      `, [
        tenantId, branchKey, String(item?.name || defaultName).trim() || defaultName,
        String(item?.phone || '').trim(), String(item?.whatsapp || '').trim(),
        String(item?.address || '').trim(), String(item?.businessHours || '').trim(),
        String(item?.googleMapsUrl || '').trim(), String(item?.directions || '').trim(),
        String(item?.paymentMethods || '').trim(), String(item?.parkingInfo || '').trim(),
        String(item?.welcomeMessage || '').trim(), String(item?.cancellationPolicy || '').trim(),
        String(item?.preparationNotes || '').trim(), String(item?.insuranceInformation || '').trim(),
        String(item?.extraInformation || '').trim(), String(item?.promotions || '').trim(),
        item?.aiEnabled !== false, item?.bookingEnabled !== false, item?.active !== false
      ]);
    }

    await client.query('COMMIT');
    const { rows } = await poolDB1.query(branchAiSelect, [tenantId]);
    res.json(rows.map(mapBranchAI));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));


// ===============================================================================
// CANALES POR EMPRESA — WhatsApp y Facebook Messenger
// ===============================================================================

function mapCompanyChannel(row) {
  const config = row.config && typeof row.config === 'object'
    ? row.config
    : {};

  const metadata = row.metadata && typeof row.metadata === 'object'
    ? row.metadata
    : {};

  return {
    id: row.id,
    tenantId: row.tenant_id,
    channel: row.channel || 'whatsapp',
    name: row.name || '',
    clinicName: row.clinic_name || '',
    phoneNumberId: row.phone_number_id || '',
    branchKey: row.branch_key || '',
    sucursalId: row.sucursal_id || '',
    dbKey: row.db_key || 'db1',
    active: row.active !== false && row.is_active !== false,

    pageId:
      config.pageId ||
      config.page_id ||
      metadata.pageId ||
      metadata.page_id ||
      '',

    pageAccessToken:
      config.pageAccessToken ||
      config.page_access_token ||
      metadata.pageAccessToken ||
      metadata.page_access_token ||
      '',

    wabaId:
      config.wabaId ||
      config.waba_id ||
      metadata.wabaId ||
      metadata.waba_id ||
      '',

    accessToken:
      config.accessToken ||
      config.access_token ||
      metadata.accessToken ||
      metadata.access_token ||
      '',

    config,
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

app.get(
  '/api/companies/:id/channels',
  authRequired,
  companiesSuperAdminOnly,
  ah(async (req, res) => {
    const tenantId = req.params.id;

    const { rows: tenantRows } = await poolDB1.query(
      `SELECT id
         FROM tenants
        WHERE id = $1::uuid
        LIMIT 1`,
      [tenantId]
    );

    if (!tenantRows[0]) {
      return res.status(404).json({
        error: 'Empresa no encontrada'
      });
    }

    const { rows } = await poolDB1.query(
      `SELECT
         id,
         tenant_id,
         phone_number_id,
         channel,
         name,
         clinic_name,
         branch_key,
         sucursal_id,
         db_key,
         active,
         is_active,
         config,
         metadata,
         created_at,
         updated_at
       FROM clinic_channels
       WHERE tenant_id = $1::uuid
       ORDER BY created_at ASC, id ASC`,
      [tenantId]
    );

    res.json(rows.map(mapCompanyChannel));
  })
);

app.put(
  '/api/companies/:id/channels',
  authRequired,
  companiesSuperAdminOnly,
  ah(async (req, res) => {
    const tenantId = req.params.id;
    const channels = Array.isArray(req.body?.channels)
      ? req.body.channels
      : [];

    const { rows: tenantRows } = await poolDB1.query(
      `SELECT id
         FROM tenants
        WHERE id = $1::uuid
        LIMIT 1`,
      [tenantId]
    );

    if (!tenantRows[0]) {
      return res.status(404).json({
        error: 'Empresa no encontrada'
      });
    }

    const client = await poolDB1.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.tenant_bypass', 'on', true)`
      );

      for (const item of channels) {
        const channel = String(item?.channel || '').trim().toLowerCase();

        if (!['whatsapp', 'facebook', 'messenger'].includes(channel)) {
          continue;
        }

        const normalizedChannel =
          channel === 'messenger' ? 'facebook' : channel;

        const active = item?.active !== false;

        const config = {
          ...(item?.config && typeof item.config === 'object'
            ? item.config
            : {})
        };

        const metadata = {
          ...(item?.metadata && typeof item.metadata === 'object'
            ? item.metadata
            : {})
        };

        if (normalizedChannel === 'facebook') {
          config.pageId = String(item?.pageId || '').trim();
          config.pageAccessToken = String(
            item?.pageAccessToken || ''
          ).trim();
        }

        if (normalizedChannel === 'whatsapp') {
          config.wabaId = String(item?.wabaId || '').trim();
          config.accessToken = String(item?.accessToken || '').trim();
        }

        const existing = await client.query(
          `SELECT id
             FROM clinic_channels
            WHERE tenant_id = $1::uuid
              AND channel = $2
            ORDER BY id ASC
            LIMIT 1`,
          [tenantId, normalizedChannel]
        );

        if (existing.rows[0]) {
          await client.query(
            `UPDATE clinic_channels
                SET phone_number_id = $1,
                    name = $2,
                    clinic_name = $3,
                    branch_key = $4,
                    sucursal_id = $5,
                    db_key = $6,
                    active = $7,
                    is_active = $7,
                    config = $8::jsonb,
                    metadata = $9::jsonb,
                    updated_at = NOW()
              WHERE id = $10
                AND tenant_id = $11::uuid`,
            [
              String(item?.phoneNumberId || '').trim() || null,
              String(item?.name || '').trim() || null,
              String(item?.clinicName || '').trim() || null,
              String(item?.branchKey || '').trim() || null,
              String(item?.sucursalId || '').trim() || null,
              String(item?.dbKey || 'db1').trim() || 'db1',
              active,
              JSON.stringify(config),
              JSON.stringify(metadata),
              existing.rows[0].id,
              tenantId
            ]
          );
        } else {
          await client.query(
            `INSERT INTO clinic_channels (
               tenant_id,
               phone_number_id,
               channel,
               name,
               clinic_name,
               branch_key,
               sucursal_id,
               db_key,
               active,
               is_active,
               config,
               metadata,
               created_at,
               updated_at
             )
             VALUES (
               $1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$9,
               $10::jsonb,$11::jsonb,NOW(),NOW()
             )`,
            [
              tenantId,
              String(item?.phoneNumberId || '').trim() || null,
              normalizedChannel,
              String(item?.name || '').trim() || null,
              String(item?.clinicName || '').trim() || null,
              String(item?.branchKey || '').trim() || null,
              String(item?.sucursalId || '').trim() || null,
              String(item?.dbKey || 'db1').trim() || 'db1',
              active,
              JSON.stringify(config),
              JSON.stringify(metadata)
            ]
          );
        }
      }

      await client.query('COMMIT');

      const { rows } = await poolDB1.query(
        `SELECT *
           FROM clinic_channels
          WHERE tenant_id = $1::uuid
          ORDER BY created_at ASC, id ASC`,
        [tenantId]
      );

      res.json(rows.map(mapCompanyChannel));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  })
);

app.post('/api/companies', authRequired, companiesSuperAdminOnly, ah(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const ownerName = String(req.body?.ownerName || '').trim();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const branchName = String(req.body?.branchName || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const address = String(req.body?.address || '').trim();
  const plan = 'standard_20_usd';
  if (!name || !ownerName || !email || !branchName || password.length < 8) return res.status(400).json({ error: 'Completa todos los campos. La contraseña debe tener mínimo 8 caracteres.' });
  const client = await poolDB1.connect();
  try {
    await client.query('BEGIN');
    const slug = await uniqueCompanySlug(client, name);
    const tenant = (await client.query('INSERT INTO tenants(name,slug,status,plan) VALUES($1,$2,\'active\',$3) RETURNING id', [name,slug,plan])).rows[0];
    const hash = await bcrypt.hash(password, 12);
    const user = (await client.query('INSERT INTO users(name,email,password_hash,active) VALUES($1,$2,$3,TRUE) RETURNING id', [ownerName,email,hash])).rows[0];
    await client.query("INSERT INTO tenant_users(tenant_id,user_id,role,active) VALUES($1,$2,'owner',TRUE)", [tenant.id,user.id]);
    await client.query(`
      INSERT INTO branches(tenant_id,name,branch_key,phone,address,active)
      VALUES
        ($1,$2,'sucursal_1',$3,$4,TRUE),
        ($1,'Condesa','sucursal_2','','',TRUE)
      ON CONFLICT (tenant_id,branch_key) DO NOTHING
    `, [tenant.id,branchName,phone,address]);
    await client.query('COMMIT');
    const { rows } = await poolDB1.query(`${companySelectSql} WHERE t.id=$1`, [tenant.id]);
    res.status(201).json(mapCompany(rows[0]));
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'El correo ya está registrado' });
    throw error;
  } finally { client.release(); }
}));

app.put('/api/companies/:id', authRequired, companiesSuperAdminOnly, ah(async (req, res) => {
  const id = req.params.id;
  const name = String(req.body?.name || '').trim();
  const ownerName = String(req.body?.ownerName || '').trim();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const branchName = String(req.body?.branchName || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const address = String(req.body?.address || '').trim();
  const plan = 'standard_20_usd';
  if (!name || !ownerName || !email || !branchName) return res.status(400).json({ error: 'Completa los campos obligatorios' });
  const client = await poolDB1.connect();
  try {
    await client.query('BEGIN');
    const slug = await uniqueCompanySlug(client, name, id);
    const updated = await client.query('UPDATE tenants SET name=$1,slug=$2,plan=$3,updated_at=NOW() WHERE id=$4 RETURNING id', [name,slug,plan,id]);
    if (!updated.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Empresa no encontrada' }); }
    const owner = (await client.query("SELECT u.id FROM tenant_users tu JOIN users u ON u.id=tu.user_id WHERE tu.tenant_id=$1 AND tu.role='owner' ORDER BY tu.created_at ASC LIMIT 1", [id])).rows[0];
    if (owner) {
      if (password) {
        if (password.length < 8) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'La contraseña debe tener mínimo 8 caracteres' }); }
        await client.query('UPDATE users SET name=$1,email=$2,password_hash=$3,updated_at=NOW() WHERE id=$4', [ownerName,email,await bcrypt.hash(password,12),owner.id]);
      } else await client.query('UPDATE users SET name=$1,email=$2,updated_at=NOW() WHERE id=$3', [ownerName,email,owner.id]);
    }
    await client.query(`
      INSERT INTO branches(tenant_id,name,branch_key,phone,address,active)
      VALUES($1,$2,'sucursal_1',$3,$4,TRUE)
      ON CONFLICT (tenant_id,branch_key) DO UPDATE SET
        name=EXCLUDED.name, phone=EXCLUDED.phone, address=EXCLUDED.address,
        active=TRUE, updated_at=NOW()
    `,[id,branchName,phone,address]);
    await client.query('COMMIT');
    const { rows } = await poolDB1.query(`${companySelectSql} WHERE t.id=$1`, [id]);
    res.json(mapCompany(rows[0]));
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'El correo ya está registrado' });
    throw error;
  } finally { client.release(); }
}));

app.patch('/api/companies/:id/activate', authRequired, companiesSuperAdminOnly, ah(async (req, res) => {
  const { rows } = await poolDB1.query("UPDATE tenants SET status='active',updated_at=NOW() WHERE id=$1 RETURNING id,status", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Empresa no encontrada' });
  res.json({ ok:true, ...rows[0] });
}));

app.patch('/api/companies/:id/suspend', authRequired, companiesSuperAdminOnly, ah(async (req, res) => {
  if (req.auth?.tenantId === req.params.id) return res.status(400).json({ error: 'No puedes suspender la empresa de tu sesión actual' });
  const { rows } = await poolDB1.query("UPDATE tenants SET status='suspended',updated_at=NOW() WHERE id=$1 RETURNING id,status", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Empresa no encontrada' });
  res.json({ ok:true, ...rows[0] });
}));
// ===============================================================================

// Cuenta pública de demostración. Es de solo lectura y permite conocer la estructura.
async function ensurePublicDemoAccount() {
  const email = DEMO_EMAIL;
  const password = 'cliniqonedemo123';
  const client = await poolDB1.connect();
  try {
    await client.query('BEGIN');
    const tenantResult = await client.query(`
      INSERT INTO tenants (name, slug, status, plan)
      VALUES ('CliniqOne Demo', 'cliniqone-demo', 'active', 'standard_20_usd')
      ON CONFLICT (slug) DO UPDATE SET status='active', plan='standard_20_usd', updated_at=NOW()
      RETURNING id
    `);
    const tenantId = tenantResult.rows[0].id;
    const passwordHash = await bcrypt.hash(password, 12);
    const userResult = await client.query(`
      INSERT INTO users (name, email, password_hash, active)
      VALUES ('Usuario Demo', $1, $2, TRUE)
      ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, active=TRUE, updated_at=NOW()
      RETURNING id
    `, [email, passwordHash]);
    const userId = userResult.rows[0].id;
    await client.query(`
      INSERT INTO tenant_users (tenant_id, user_id, role, active)
      VALUES ($1,$2,'demo',TRUE)
      ON CONFLICT (tenant_id,user_id) DO UPDATE SET role='demo', active=TRUE
    `,[tenantId,userId]);
    await client.query(`
      INSERT INTO branches (tenant_id,name,branch_key,phone,address,active)
      VALUES ($1,'Sucursal Demo','sucursal_1','','',TRUE)
      ON CONFLICT (tenant_id,branch_key) DO UPDATE SET active=TRUE, updated_at=NOW()
    `,[tenantId]);
    await client.query('COMMIT');
    console.log(`✅ Cuenta demo pública lista: ${email}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

// Crea Dentalux y el primer propietario solo cuando se configuran las variables
// BOOTSTRAP_ADMIN_EMAIL y BOOTSTRAP_ADMIN_PASSWORD en Render.
// Después del primer acceso se recomienda eliminar BOOTSTRAP_ADMIN_PASSWORD.
async function ensureBootstrapDentaluxAdmin() {
  const email = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL);
  const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '');
  const name = String(process.env.BOOTSTRAP_ADMIN_NAME || 'Administrador Dentalux').trim();

  if (!email && !password) {
    console.log('ℹ️ Bootstrap de administrador omitido (sin variables BOOTSTRAP_ADMIN_*)');
    return;
  }

  if (!email || password.length < 8) {
    throw new Error(
      'BOOTSTRAP_ADMIN_EMAIL y BOOTSTRAP_ADMIN_PASSWORD (mínimo 8 caracteres) son obligatorios'
    );
  }

  const client = await poolDB1.connect();
  try {
    await client.query('BEGIN');

    const tenantResult = await client.query(`
      INSERT INTO tenants (name, slug, status, plan)
      VALUES ('Dentalux', 'dentalux', 'active', 'enterprise')
      ON CONFLICT (slug)
      DO UPDATE SET
        name = EXCLUDED.name,
        status = 'active',
        updated_at = NOW()
      RETURNING id
    `);
    const tenantId = tenantResult.rows[0].id;

    const passwordHash = await bcrypt.hash(password, 12);
    const userResult = await client.query(`
      INSERT INTO users (name, email, password_hash, active)
      VALUES ($1, $2, $3, TRUE)
      ON CONFLICT (email)
      DO UPDATE SET
        name = EXCLUDED.name,
        password_hash = EXCLUDED.password_hash,
        active = TRUE,
        updated_at = NOW()
      RETURNING id
    `, [name, email, passwordHash]);
    const userId = userResult.rows[0].id;

    await client.query(`
      INSERT INTO tenant_users (tenant_id, user_id, role, active)
      VALUES ($1, $2, 'owner', TRUE)
      ON CONFLICT (tenant_id, user_id)
      DO UPDATE SET role = 'owner', active = TRUE
    `, [tenantId, userId]);

    await client.query(`
      INSERT INTO branches (tenant_id, name, branch_key, phone, address, active)
      VALUES
        ($1, 'Victoria', 'sucursal_1', '', '', TRUE),
        ($1, 'Condesa', 'sucursal_2', '', '', TRUE)
      ON CONFLICT (tenant_id, branch_key) DO NOTHING
    `, [tenantId]);

    await client.query('COMMIT');
    console.log(`✅ Usuario propietario Dentalux listo: ${email}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
// ===============================================================================


// ===============================================================================
// AISLAMIENTO SaaS DE WHATSAPP / IA (tenant_id + PostgreSQL RLS)
// ===============================================================================
async function ensureWhatsAppTenantIsolationSchema() {
  const client = await poolDB1.connect();
  try {
    await client.query('BEGIN');
    const tables = ['appointments','whatsapp_messages','ai_conversations','ai_messages','clinic_channels','whatsapp_rules','whatsapp_faqs','wa_processed'];
    for (const table of tables) {
      await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS tenant_id UUID`).catch(() => {});
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS wa_unrouted_messages (
        id BIGSERIAL PRIMARY KEY,
        wamid TEXT,
        phone TEXT,
        context_message_id TEXT,
        reason TEXT NOT NULL,
        payload JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      UPDATE ai_messages m
         SET tenant_id = c.tenant_id
        FROM ai_conversations c
       WHERE m.conversation_id = c.id
         AND m.tenant_id IS NULL
         AND c.tenant_id IS NOT NULL
    `).catch(() => {});

    await client.query(`CREATE INDEX IF NOT EXISTS idx_appointments_tenant ON appointments(tenant_id)`).catch(() => {});
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wa_messages_tenant_created ON whatsapp_messages(tenant_id, created_at DESC)`).catch(() => {});
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wa_messages_tenant_phone ON whatsapp_messages(tenant_id, phone)`).catch(() => {});
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_conversations_tenant ON ai_conversations(tenant_id, updated_at DESC)`).catch(() => {});
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_messages_tenant_conv ON ai_messages(tenant_id, conversation_id)`).catch(() => {});

    for (const table of tables) {
      await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`).catch(() => {});
      await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`).catch(() => {});
      await client.query(`DROP POLICY IF EXISTS ${table}_tenant_isolation ON ${table}`).catch(() => {});
      await client.query(`
        CREATE POLICY ${table}_tenant_isolation ON ${table}
        USING (
          current_setting('app.tenant_bypass', true) = 'on'
          OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        )
        WITH CHECK (
          current_setting('app.tenant_bypass', true) = 'on'
          OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        )
      `).catch((e) => console.warn(`RLS ${table}:`, e.message));
    }

    await client.query('COMMIT');
    console.log('✅ Aislamiento WhatsApp/IA por tenant y RLS activo');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ===============================================================================
// F1 COPILOT — gestión por texto y voz OpenAI Realtime
// Se agrega sin sustituir la Recepcionista V5, Messenger, WhatsApp ni la agenda.
try {
  const { setupF1Routes } = require('./modules/f1');
  setupF1Routes(app, q, { authRequired, getTenantId, getSucursal });
} catch (error) {
  console.error('❌ No se pudo montar F1 Copilot:', error);
}

// ===============================================================================
// WHATSAPP CLOUD API
// Monta GET/POST /api/whatsapp/webhook y las demás rutas del módulo.
const whatsappRoutes = require('./routes/whatsapp');
ensureWhatsAppTenantIsolationSchema().catch((e) => {
  console.error('❌ No se pudo activar aislamiento WhatsApp/IA:', e);
  process.exitCode = 1;
});
app.use('/api/whatsapp', (req, res, next) => {
  const isWebhook = req.path === '/webhook';
  if (isWebhook) return next();
  return authRequired(req, res, next);
}, whatsappRoutes);
console.log('✅ Rutas de WhatsApp montadas con JWT obligatorio (excepto webhook Meta)');
// ===============================================================================


app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Dentalux API corriendo en http://0.0.0.0:${PORT}`);
      console.log('📊 Base(s) de datos conectada(s):');
      console.log('   ✅ DB1 (DATABASE_URL_DB1/DATABASE_URL)');
      if (poolDB2) console.log('   ✅ DB2 (DATABASE_URL_DB2)');
      if (poolDB3) console.log('   ✅ DB3 (DATABASE_URL_DB3)');

      if (medicalRecordModule) {
        console.log('   🏥 Historia clínica (/api/expediente-medico/*)');
      } else {
        console.log('   ❌ Historia clínica (NO DISPONIBLE)');
      }

      console.log('\n🔗 URLs de prueba:');
      console.log(`   • Health check: http://localhost:${PORT}/api/health`);
      console.log(`   • Test médico: http://localhost:${PORT}/api/expediente-medico/test`);
    });
  } catch (e) {
    console.error('Error al iniciar:', e);
    process.exit(1);
  }
})();
