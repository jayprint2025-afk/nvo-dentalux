// routes/facturama.js – Timbrado con Facturama + Configuración (compatible con UI)
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const multer = require('multer');

// ====== Wrapper async (captura errores en rutas) ======
const ah = (fn) => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (e) {
    console.error('Uncaught error in route:', e);
    if (res.headersSent) return next(e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
};

// ====== DB ======
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
const q = (text, params = []) => pool.query(text, params);

// ====== Upload (multipart) ======
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function getSucursalFromReq(req) {
  // ✅ SIEMPRE usar sucursal_1 como default
  const sucursal = 
    req.headers['x-sucursal'] ||
    req.headers['x-sucursal-id'] ||
    req.query?.sucursal_id ||
    req.query?.sucursal ||
    (req.body && (req.body.sucursal_id || req.body.sucursal)) ||
    'sucursal_1';  // ✅ Default fijo
  
  console.log('🔎 Sucursal detectada:', sucursal);
  return sucursal;
}
// ====== Cliente Facturama (por configuración de emisor) ======
function facturamaBase() {
  const env = String(process.env.FACTURAMA_ENV || 'sandbox').toLowerCase();
  const base =
    process.env.FACTURAMA_BASE_URL ||
    (env === 'production' ? 'https://api.facturama.mx/' : 'https://apisandbox.facturama.mx/');
  return base.endsWith('/') ? base : base + '/';
}

function basicToken() {
  const u = String(process.env.FACTURAMA_USER || '');
  const p = String(process.env.FACTURAMA_PASS || '');
  if (!u || !p) throw new Error('Faltan FACTURAMA_USER/FACTURAMA_PASS');
  return Buffer.from(`${u}:${p}`).toString('base64');
}

async function fGet(path, params = {}, respType = 'json', accept = '*/*') {
  const url = new URL(path, facturamaBase());
  Object.entries(params).forEach(
    ([k, v]) => v !== undefined && v !== null && url.searchParams.set(k, String(v))
  );
  const r = await fetch(url, { headers: { Authorization: `Basic ${basicToken()}`, Accept: accept } });
  if (!r.ok) {
    const err = await r.text().catch(() => String(r.status));
    throw new Error(`Facturama GET ${url} -> ${r.status} ${err}`);
  }
  return respType === 'arraybuffer' ? Buffer.from(await r.arrayBuffer()) : await r.json();
}

async function fPost(path, body) {
  const url = new URL(path, facturamaBase());
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${basicToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Facturama POST ${url} -> ${r.status} ${JSON.stringify(data)}`);
  return data;
}


// ====== Cliente desde configuración (para timbrado con datos del emisor) ======
function clientFromConfig(cfg) {
  const env = String(cfg.ambiente || 'pruebas').toLowerCase();
  const base = (cfg.pac_url_timbrado && cfg.pac_url_timbrado.trim())
    ? cfg.pac_url_timbrado
    : (env === 'produccion' ? 'https://api.facturama.mx/' : 'https://apisandbox.facturama.mx/');
  const token = Buffer.from(`${cfg.pac_usuario}:${cfg.pac_password}`).toString('base64');

  const doFetch = async (method, path, { params, body, respType='json', accept='*/*' } = {}) => {
    const url = new URL(path, base.endsWith('/') ? base : base + '/');
    if (params) Object.entries(params).forEach(([k,v]) => v!=null && url.searchParams.set(k, String(v)));

    const headers = { 
      'Authorization': `Basic ${token}`, 
      'Accept': accept,
      'User-Agent': 'Dentalux-Multi-RFC/2.0'
    };
    if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const r = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!r.ok) {
        const errorText = await r.text().catch(() => '');
        throw new Error(`Facturama ${method} ${url} -> ${r.status} ${errorText || r.statusText}`);
      }

      if (respType === 'arraybuffer') {
        return Buffer.from(await r.arrayBuffer());
      } else {
        const data = await r.json().catch(() => ({}));
        return data;
      }
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Timeout: ${method} ${url} tardó más de 30 segundos`);
      }
      throw error;
    }
  };

  return {
    get: (p, params, respType, accept) => doFetch('GET', p, { params, respType, accept }),
    post: (p, body) => doFetch('POST', p, { body }),
  };
}

// ====== Cliente con credenciales ENV (para descargas y operaciones administrativas) ======
function createEnvClient() {
  const env = String(process.env.FACTURAMA_ENV || 'sandbox').toLowerCase();
  const base = env === 'production' ? 'https://api.facturama.mx/' : 'https://apisandbox.facturama.mx/';
  
  console.log(`🌍 Ambiente: ${env.toUpperCase()} (${base})`);

  const user = String(process.env.FACTURAMA_USER || '');
  const pass = String(process.env.FACTURAMA_PASS || '');
  
  if (!user || !pass) {
    throw new Error('Faltan credenciales FACTURAMA_USER/FACTURAMA_PASS en variables de entorno');
  }
  
  const token = Buffer.from(`${user}:${pass}`).toString('base64');
  console.log(`🔐 Usando credenciales ENV - Usuario: ${user}, Ambiente: ${env}, Base URL: ${base}`);

  const doFetch = async (method, path, { params, body, respType='json', accept='*/*' } = {}) => {
    const url = new URL(path, base.endsWith('/') ? base : base + '/');
    if (params) Object.entries(params).forEach(([k,v]) => v!=null && url.searchParams.set(k, String(v)));

    const headers = { 
      'Authorization': `Basic ${token}`, 
      'Accept': accept,
      'User-Agent': 'Dentalux-Multi-RFC/2.0'
    };
    if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';

    console.log(`📡 ${method} ${url.toString()}`);
    console.log(`🔑 Authorization: Basic ${token.substring(0, 20)}...`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const r = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      console.log(`📨 Response: ${r.status} ${r.statusText}`);

      if (!r.ok) {
        const errorText = await r.text().catch(() => '');
        console.log(`❌ Error response body: ${errorText.substring(0, 200)}`);
        throw new Error(`Facturama ${method} ${url} -> ${r.status} ${errorText || r.statusText}`);
      }

      if (respType === 'arraybuffer') {
        return Buffer.from(await r.arrayBuffer());
      } else {
        const data = await r.json().catch(() => ({}));
        return data;
      }
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Timeout: ${method} ${url} tardó más de 60 segundos`);
      }
      throw error;
    }
  };

  return {
    get: (p, params, respType, accept) => doFetch('GET', p, { params, respType, accept }),
    post: (p, body) => doFetch('POST', p, { body }),
  };
}

// ====== Normalización ======
const RFC_LEN_FISICA = 13;
const RFC_LEN_MORAL = 12;

function padCP(cp) {
  const s = String(cp || '');
  return s.length >= 5 ? s : s.padStart(5, '0');
}

function deduceRegimeFromRFC(rfc, provided) {
  if (!rfc) return provided || undefined;
  const clean = String(rfc).trim().toUpperCase();
  const isPF = clean.length === RFC_LEN_FISICA;
  const isPM = clean.length === RFC_LEN_MORAL;
  if (isPF) {
    const regimenesPF = ['612', '605', '606', '607', '608', '614', '615', '616', '625', '626'];
    if (provided && regimenesPF.includes(String(provided))) return String(provided);
    return '612';
  }
  if (isPM) {
    const regimenesPM = ['601', '603', '620', '623'];
    if (provided && regimenesPM.includes(String(provided))) return String(provided);
    return '601';
  }
  return provided || '612';
}

function normalizeReceiver(receiver = {}) {
  const r = { ...receiver };
  const rfc = String(r.Rfc || '').trim().toUpperCase();
  r.FiscalRegime = deduceRegimeFromRFC(rfc, r.FiscalRegime);
  r.CfdiUse = String(r.CfdiUse || 'G03').toUpperCase();
  r.TaxZipCode = padCP(r.TaxZipCode || process.env.CODIGO_POSTAL || '21395');
  const isPF = rfc && rfc.length === RFC_LEN_FISICA;
  if (isPF && r.CfdiUse === 'D01') {
    const regimenesPF = ['612', '605', '606', '607', '608', '614', '615', '616', '625', '626'];
    if (!regimenesPF.includes(r.FiscalRegime)) r.FiscalRegime = '612';
  }
  if (r.FiscalRegime === '601' && r.CfdiUse === 'D01') {
    r.CfdiUse = 'G03';
  }
  return r;
}

async function getIssuerConfig(sucursalId) {
  console.log('🔍 ===== DEBUG getIssuerConfig =====');
  console.log('📍 sucursal_id recibido:', sucursalId);
  console.log('📍 tipo:', typeof sucursalId);
  
  try {
    let { rows } = await q(
      `SELECT 
        rfc, razon_social, regimen_fiscal, codigo_postal,
        pac_proveedor, pac_usuario, pac_password, 
        pac_url_timbrado, pac_url_cancelacion,
        serie_facturas, ultimo_folio, ambiente, activo,
        logo_url,
        cer_file, 
        key_file, 
        key_password,
        created_at,
        (CASE WHEN (SELECT 1 FROM information_schema.columns
                     WHERE table_name='facturacion_configuracion' AND column_name='logo_image' LIMIT 1) = 1
              THEN octet_length(logo_image) ELSE NULL END) AS logo_len,
        (CASE WHEN (SELECT 1 FROM information_schema.columns
                     WHERE table_name='facturacion_configuracion' AND column_name='logo_mime' LIMIT 1) = 1
              THEN logo_mime ELSE NULL END) AS logo_mime
       FROM facturacion_configuracion
       WHERE sucursal_id = $1 OR sucursal_id IS NULL
       ORDER BY 
         (sucursal_id = $1) DESC,
         (
           (cer_file IS NOT NULL)::int +
           (key_file IS NOT NULL)::int +
           (key_password IS NOT NULL AND key_password <> '')::int
         ) DESC,
         created_at DESC NULLS LAST
       LIMIT 1`,
      [sucursalId]
    );

    console.log('📊 Filas encontradas en BD:', rows.length);
    
    if (rows.length > 0) {
      const config = rows[0];
      
      console.log('🔍 DEBUG - Certificados en BD:', {
        tiene_cer_file: !!config.cer_file,
        tiene_key_file: !!config.key_file,
        tiene_key_password: !!config.key_password,
        cer_length: config.cer_file ? config.cer_file.length : 0,
        key_length: config.key_file ? config.key_file.length : 0
      });
      
      console.log('✅ Config encontrada en BD:', {
        rfc: config.rfc,
        razon_social: config.razon_social,
        regimen_fiscal: config.regimen_fiscal
      });
      
      return config;
    }

    console.log('⚠️ NO se encontró config en BD, usando ENV');
    return {
      rfc: process.env.EMISOR_RFC || '',
      razon_social: process.env.EMISOR_NOMBRE || '',
      regimen_fiscal: process.env.EMISOR_REGIMEN || '601',
      codigo_postal: process.env.CODIGO_POSTAL || '21395',
      pac_proveedor: process.env.PAC_PROVEEDOR || 'facturama',
      pac_usuario: process.env.FACTURAMA_USER || '',
      pac_password: process.env.FACTURAMA_PASS || '',
      pac_url_timbrado: process.env.PAC_URL_TIMBRADO || '',
      pac_url_cancelacion: process.env.PAC_URL_CANCELACION || '',
      serie_facturas: process.env.SERIE_FACTURAS || '',
      ultimo_folio: Number(process.env.ULTIMO_FOLIO || 1),
      ambiente: (process.env.FACTURAMA_ENV === 'production' ? 'produccion' : 'pruebas'),
      activo: true,
      logo_url: '',
      cer_file: null,
      key_file: null,
      key_password: null,
    };
  } catch (error) {
    console.error('❌ Error getting issuer config:', error);
    return {
      rfc: process.env.EMISOR_RFC || '',
      razon_social: process.env.EMISOR_NOMBRE || '',
      regimen_fiscal: process.env.EMISOR_REGIMEN || '601',
      codigo_postal: process.env.CODIGO_POSTAL || '21395',
      pac_proveedor: process.env.PAC_PROVEEDOR || 'facturama',
      pac_usuario: process.env.FACTURAMA_USER || '',
      pac_password: process.env.FACTURAMA_PASS || '',
      pac_url_timbrado: process.env.PAC_URL_TIMBRADO || '',
      pac_url_cancelacion: process.env.PAC_URL_CANCELACION || '',
      serie_facturas: process.env.SERIE_FACTURAS || '',
      ultimo_folio: Number(process.env.ULTIMO_FOLIO || 1),
      ambiente: (process.env.FACTURAMA_ENV === 'production' ? 'produccion' : 'pruebas'),
      activo: true,
      logo_url: '',
      cer_file: null,
      key_file: null,
      key_password: null,
    };
  }
}

function normalizePayloadForFacturama(payload = {}) {
  const p = { ...payload };
  p.CfdiType = p.CfdiType || 'I';
  p.ExpeditionPlace = padCP(p.ExpeditionPlace || process.env.CODIGO_POSTAL || '21395');
  p.PaymentForm = String(p.PaymentForm || '01');
  p.PaymentMethod = String(p.PaymentMethod || 'PUE');
  p.Receiver = normalizeReceiver(p.Receiver || {});
  return p;
}

// ====== Normalización para SANDBOX ======
function normalizarParaSandbox(payload) {
  const env = String(process.env.FACTURAMA_ENV || 'sandbox').toLowerCase();
  
  console.log(`🌍 Ambiente detectado: ${env.toUpperCase()}`);
  
  if (env === 'sandbox') {
    console.log('⚠️ SANDBOX MODE: Validando RFCs con catálogo del SAT');
    
    // RFCs válidos en sandbox según Facturama
    const rfcsValidosSandbox = [
      'XAXX010101000',  // Público en General (Nacional)
      'XEXX010101000',  // Público en General (Extranjero)
      'EKU9003173C9',   // Escuela Kemper Urgate
    ];
    
    // Validar RECEPTOR
    if (!rfcsValidosSandbox.includes(payload.Receiver?.Rfc)) {
      console.log(`📝 Receptor original: ${payload.Receiver?.Rfc} → Cambiando a RFC de prueba`);
      
      // Configuración correcta para Público en General Nacional
      payload.Receiver.Rfc = 'XAXX010101000';
      payload.Receiver.Name = 'PUBLICO EN GENERAL';
      payload.Receiver.FiscalRegime = '616';
      payload.Receiver.CfdiUse = 'S01';
      payload.Receiver.TaxZipCode = payload.ExpeditionPlace || '21395';
      
      // ✅ AGREGAR GlobalInformation (REQUERIDO para XAXX010101000)
      payload.GlobalInformation = {
        Periodicity: "04",  // Mensual
        Months: new Date().getMonth() + 1 < 10 
          ? `0${new Date().getMonth() + 1}` 
          : `${new Date().getMonth() + 1}`,
        Year: new Date().getFullYear()
      };
      
      console.log('✅ Receptor configurado:', {
        rfc: payload.Receiver.Rfc,
        nombre: payload.Receiver.Name,
        regimen: payload.Receiver.FiscalRegime,
        uso: payload.Receiver.CfdiUse,
        globalInfo: payload.GlobalInformation
      });
    }
    
    // VALIDACIÓN ADICIONAL: Si el RFC es XAXX010101000, forzar configuración correcta
    if (payload.Receiver?.Rfc === 'XAXX010101000') {
      payload.Receiver.Name = 'PUBLICO EN GENERAL';
      payload.Receiver.FiscalRegime = '616';
      payload.Receiver.CfdiUse = 'S01';
      
      // ✅ Asegurar que GlobalInformation existe
      if (!payload.GlobalInformation) {
        payload.GlobalInformation = {
          Periodicity: "04",  // Mensual
          Months: new Date().getMonth() + 1 < 10 
            ? `0${new Date().getMonth() + 1}` 
            : `${new Date().getMonth() + 1}`,
          Year: new Date().getFullYear()
        };
      }
      
      console.log('✅ RFC XAXX010101000 detectado, configuración normalizada con GlobalInformation');
    }
  }
  
  return payload;
}

// ====== Utilidades DB ======
async function tableHasColumn(table, col) {
  const { rows } = await q(
    `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2 LIMIT 1`,
    [table, col]
  );
  return !!rows[0];
}

async function updateFacturaAfterStamp({ facturaId, sucursalId, cfdiId, uuid, serie, folio }) {
  const sets = [];
  const params = [];
  let i = 1;
  if (await tableHasColumn('facturas', 'cfdi_id')) { sets.push(`cfdi_id=$${i++}`); params.push(cfdiId || null); }
  if (await tableHasColumn('facturas', 'uuid'))    { sets.push(`uuid=$${i++}`);    params.push(uuid || null); }
  if (await tableHasColumn('facturas', 'serie'))   { sets.push(`serie=$${i++}`);   params.push(serie || null); }
  if (await tableHasColumn('facturas', 'folio'))   { sets.push(`folio=$${i++}`);   params.push(folio || null); }
  if (await tableHasColumn('facturas', 'estado'))  { sets.push(`estado=$${i++}`);  params.push('timbrada'); }
  if (await tableHasColumn('facturas', 'status'))  { sets.push(`status=$${i++}`);  params.push('Timbrada'); }
  if (await tableHasColumn('facturas', 'timbrada_at'))   sets.push(`timbrada_at=NOW()`);
  if (await tableHasColumn('facturas', 'fecha_timbrado')) sets.push(`fecha_timbrado=NOW()`);
  if (!sets.length) return null;

  params.push(facturaId, sucursalId);
  const { rows } = await q(
    `UPDATE facturas SET ${sets.join(', ')}
     WHERE id=$${i++} AND (sucursal_id=$${i} OR sucursal_id IS NULL)
     RETURNING *`,
    params
  );
  return rows[0] || null;
}
async function buildPayloadFromFacturaId(facturaId, sucursalId) {
  // ✅ OBTENER DATOS FISCALES DEL CLIENTE (no sus credenciales PAC)
const clientConfig = await getIssuerConfig(sucursalId);

// Solo validar que tienes datos fiscales del cliente
if (!clientConfig.rfc || !clientConfig.razon_social) {
  throw new Error('Faltan datos fiscales del cliente (RFC y razón social)');
}

// =================== NUEVO: calcular siguiente folio ===================
const nextFolio = Number(clientConfig.ultimo_folio || 0) + 1;
// ======================================================================

const Fq = await q(
  `SELECT id, cliente, forma_pago, metodo_pago, total, sucursal_id
   FROM facturas
   WHERE id=$1 AND (sucursal_id=$2 OR sucursal_id IS NULL)
   LIMIT 1`,
  [String(facturaId), String(sucursalId)]
);
const F = Fq.rows[0];
if (!F) throw new Error('Factura no encontrada');

// =================== RECEPTOR (R) ===================
let R = null;

// 1) Intentar primero en facturacion_clientes usando RAZON SOCIAL (exacto o ILIKE)
try {
  const rq = await q(
    `SELECT rfc,
            razon_social,
            regimen_fiscal,
            codigo_postal,
            uso_cfdi
     FROM facturacion_clientes
     WHERE (razon_social = $1 OR razon_social ILIKE $2)
       AND (sucursal_id = $3 OR sucursal_id IS NULL)
     ORDER BY (sucursal_id = $3) DESC, created_at DESC NULLS LAST
     LIMIT 1`,
    [F.cliente, `%${F.cliente}%`, sucursalId]
  );
  if (rq.rows[0]) R = rq.rows[0];
} catch (e) {
  console.log('⚠️ No se pudo consultar facturacion_clientes:', e?.message || e);
}

// 2) Fallback: intentar en tabla "clientes" sin asumir columna "nombre"
//    Probamos varias columnas posibles: razon_social, nombre_completo, cliente, name, full_name
async function tryClientesBy(colName) {
  try {
    const sql = `
      SELECT rfc,
             COALESCE(razon_social, ${colName}) AS razon_social,
             regimen_fiscal,
             COALESCE(codigo_postal, cp, zip, '00000') AS codigo_postal,
             COALESCE(uso_cfdi, 'G03') AS uso_cfdi
      FROM clientes
      WHERE ${colName} = $1 OR ${colName} ILIKE $2
      ORDER BY created_at DESC NULLS LAST
      LIMIT 1
    `;
    const r = await q(sql, [F.cliente, `%${F.cliente}%`]);
    return r.rows[0] || null;
  } catch (e) {
    // Si la columna no existe, PostgreSQL falla; solo log y probamos la siguiente
    console.log(`ℹ️ clientes.${colName} no disponible:`, e?.message || e);
    return null;
  }
}

if (!R) {
  const cols = ['razon_social', 'nombre_completo', 'cliente', 'name', 'full_name'];
  for (const c of cols) {
    const found = await tryClientesBy(c);
    if (found) { R = found; break; }
  }
}

// 3) Validar que tengamos RFC del receptor
if (!R || !R.rfc) {
  throw new Error(`No se encontraron datos fiscales del receptor (RFC) para: ${F.cliente}. Configura el cliente en "Facturación → Clientes" (RFC y razón social).`);
}

// 4) Normalizaciones de receptor
R.rfc = String(R.rfc || '').toUpperCase();
R.razon_social = String(R.razon_social || F.cliente || '').trim();
R.regimen_fiscal = String(R.regimen_fiscal || deduceRegimeFromRFC(R.rfc));
R.codigo_postal = String(R.codigo_postal || '00000').padStart(5, '0');
R.uso_cfdi = String(R.uso_cfdi || 'G03');


// =================== CONCEPTOS / ITEMS ===================
let Items = [];

// --- Helper de mapeo desde objeto de "concepto" (como llega del front) -> Item Facturama
function mapConceptToItem(c) {
  const qty = Number(c.cantidad || 1);
  const unitPrice = Number(c.valor_unitario ?? c.unit_price ?? c.precio ?? 0);
  const subtotal = Number(c.importe ?? (qty * unitPrice) ?? 0);
  const taxObject = String(c.objeto_imp || c.tax_object || '01'); // '01'=No objeto | '02'=Sí objeto

  const Taxes = (taxObject === '02')
    ? [{
        Total: 0,
        Name: 'IVA',
        Base: subtotal,
        Rate: 0,
        IsRetention: false
      }]
    : undefined;

  return {
    ProductCode: String(c.clave_prod_serv || c.product_code || '85121800'),
    UnitCode: String(c.unidad || c.unit_code || 'ACT'),
    Description: String(c.descripcion || c.description || 'SERVICIO DENTAL').trim(),
    UnitPrice: unitPrice,
    Quantity: qty,
    Subtotal: subtotal,
    TaxObject: taxObject,
    Total: subtotal,     // si no manejas IVA > 0, Total = Subtotal
    ...(Taxes ? { Taxes } : {})
  };
}

// --- 1) Intentar leer JSON de la propia tabla "facturas"
async function tryConceptsFromColumn(colName) {
  try {
    const r = await q(
      `SELECT ${colName}
       FROM facturas
       WHERE id = $1
       LIMIT 1`,
      [facturaId]
    );
    if (!r.rows[0]) return [];
    let raw = r.rows[0][colName];
    if (!raw) return [];
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (e) { /* no-op */ }
    }
    if (Array.isArray(raw)) {
      return raw.map(mapConceptToItem).filter(Boolean);
    }
    return [];
  } catch (e) {
    // La columna puede no existir: solo log y seguimos
    console.log(`ℹ️ facturas.${colName} no disponible:`, e?.message || e);
    return [];
  }
}

if (!Items.length) {
  // intenta en orden común de nombres de columna
  const cols = ['conceptos', 'items', 'detalle', 'conceptos_json'];
  for (const c of cols) {
    const arr = await tryConceptsFromColumn(c);
    if (arr.length) { Items = arr; break; }
  }
}

// --- 2) (OPCIONAL) Si tienes otra tabla con detalle (deja como comentario para futuro)
// try { ... } catch { ... }  // <- omitido porque ya vimos que esas tablas no existen

// --- 3) Fallback: si no hay conceptos, crea 1 renglón con el total
if (!Items.length) {
  const fallbackSubtotal = Number(F.total || 0);
  if (fallbackSubtotal <= 0) {
    throw new Error('La factura no tiene conceptos. Agrega al menos un concepto antes de timbrar.');
  }

  Items = [{
    ProductCode: '85121800',        // Servicios de salud/dental (ajústalo si usas otro)
    UnitCode: 'ACT',                // Actividad / servicio
    Description: (F.nota || 'SERVICIO DENTAL'), // usa nota si existiera
    UnitPrice: fallbackSubtotal,
    Quantity: 1,
    Subtotal: fallbackSubtotal,
    TaxObject: '01',               // sin objeto de impuesto por defecto
    Total: fallbackSubtotal
  }];
}



// ✅ PAYLOAD: Usa datos fiscales del CLIENTE pero se timbrará con credenciales MAESTRAS
const payload = {
  CfdiType: 'I',
  ExpeditionPlace: padCP(clientConfig.codigo_postal), // CP del cliente
  Serie: clientConfig.serie_facturas ? String(clientConfig.serie_facturas).trim() : undefined,
  Folio: nextFolio,                         // 👈👈👈 **NUEVO OBLIGATORIO PARA API-LITE v3**
  PaymentForm: String(F.forma_pago || '01'),
  PaymentMethod: String(F.metodo_pago || 'PUE'),
  Issuer: {
    // ✅ ESTOS DATOS SON DEL CLIENTE (aparecen en la factura)
    Rfc: String(clientConfig.rfc).toUpperCase(),
    Name: String(clientConfig.razon_social),
    FiscalRegime: String(clientConfig.regimen_fiscal || '612'),
  },
  Receiver: {
    Rfc: String(R.rfc).toUpperCase(),
    Name: String(R.razon_social),
    CfdiUse: String(R.uso_cfdi || 'G03'),
    FiscalRegime: String(R.regimen_fiscal || deduceRegimeFromRFC(R.rfc)),
    TaxZipCode: padCP(R.codigo_postal || clientConfig.codigo_postal),
  },
  Items,
};

console.log('✅ Payload construido con datos del cliente:', {
  emisor_rfc: payload.Issuer.Rfc,
  emisor_nombre: payload.Issuer.Name,
  receptor_rfc: payload.Receiver.Rfc
});

return normalizePayloadForFacturama(payload);
}

/* ====================== RUTAS FACTURAMA ====================== */

router.get('/test', ah(async (req, res) => {
  const suc = getSucursalFromReq(req);
  const cfg = await getIssuerConfig(suc);
  const client = clientFromConfig(cfg);
  const data = await client.get('cfdi', { type: 'issued', Page: 1 });
  res.json({ ok: true, count: Array.isArray(data) ? data.length : 0 });
}));

// ✅ Diagnóstico: verificar que el CP/Serie existen en Facturama para ESTE usuario
router.get('/diagnostico/expedition-place', ah(async (req, res) => {
  const suc = getSucursalFromReq(req);
  const cfg = await getIssuerConfig(suc);
  const client = clientFromConfig(cfg);                 // usa las credenciales con las que timbras
  const cp = String(cfg.codigo_postal || '').trim().padStart(5,'0');

  const offices = await client.get('BranchOffice').catch(() => []);
  const listado = (Array.isArray(offices) ? offices : []).map(o => ({
    name: o?.Name || '',
    zip: String(o?.Address?.ZipCode || ''),
    series: (o?.Series || []).map(s => s?.Name).filter(Boolean),
    isDefault: !!o?.IsDefault,
  }));

  const office = listado.find(o => o.zip === cp);
  const serieBD = (cfg.serie_facturas || '').trim();
  const serieOk = !serieBD || !!(office && office.series.includes(serieBD));

  res.json({
    sucursal: suc,
    expeditionPlace: cp,
    existe_en_facturama: !!office,
    serie_en_bd: serieBD || null,
    serie_valida_en_esa_sucursal: serieOk,
    branch_offices: listado,
  });
}));


router.get('/verificar-multirfc', ah(async (req, res) => {
  try {
    const client = createEnvClient();
    
    // Intentar obtener información de la cuenta
    const accountInfo = await client.get('catalogs/taxentities').catch(() => null);
    
    res.json({
      success: true,
      tieneMultiRFC: accountInfo !== null,
      plan: accountInfo ? 'Compatible con Multi-RFC' : 'Plan básico',
      info: accountInfo,
      recomendacion: accountInfo 
        ? '✅ Puedes usar Multi-RFC con certificados CSD' 
        : '⚠️ Contacta a Facturama para activar Multi-RFC'
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      recomendacion: '⚠️ Contacta a Facturama para verificar tu plan'
    });
  }
}));

router.post('/timbrar', ah(async (req, res) => {
  const sucursalId = getSucursalFromReq(req);
  let payload = null;
  let facturaId = null;
  
  if (req.body?.factura_id) {
    facturaId = String(req.body.factura_id);
    payload = await buildPayloadFromFacturaId(facturaId, sucursalId);
  } else if (req.body?.payload) {
    payload = normalizePayloadForFacturama(req.body.payload);
    facturaId = req.body.factura_id ? String(req.body.factura_id) : null;
  } else {
    return res.status(400).json({ ok: false, error: 'Falta factura_id o payload' });
  }
  
  if (!payload.Issuer || !payload.Issuer.Rfc || !payload.Issuer.Name) {
    throw new Error('El payload debe incluir información completa del emisor (RFC y nombre)');
  }

  // ✅ VALIDACIÓN: GlobalInformation para RFC genérico
  if (payload.Receiver?.Rfc === 'XAXX010101000') {
    console.log('🔄 RFC GENÉRICO: Agregando GlobalInformation (OBLIGATORIO)');
    const now = new Date();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    payload.GlobalInformation = {
      Periodicity: "04",
      Months: month,
      Year: year
    };
    payload.Receiver.Name = 'PUBLICO EN GENERAL';
    payload.Receiver.FiscalRegime = '616';
    payload.Receiver.CfdiUse = 'S01';
    console.log('✅ GlobalInformation agregado:', payload.GlobalInformation);
  }

  payload = normalizarParaSandbox(payload);

// REEMPLAZAR la función verifyRFCInFacturama por esta versión corregida:

async function verifyRFCInFacturama(rfc) {
  try {
    const client = createEnvClient();
    const csds = await client.get('api-lite/csds');
    
    console.log(`🔍 Verificando RFC ${rfc} en Facturama...`);
    console.log(`📋 Respuesta completa de api-lite/csds:`, JSON.stringify(csds, null, 2));
    
    if (Array.isArray(csds)) {
      console.log(`📊 Total de CSDs encontrados: ${csds.length}`);
      
      // Mostrar todos los CSDs para debug
      csds.forEach((csd, index) => {
        console.log(`📄 CSD ${index + 1}:`, {
          rfc: csd.Rfc,
          status: csd.Status || 'NO_STATUS',
          validTo: csd.ValidTo || 'NO_VALID_TO',
          certificate: csd.Certificate ? 'PRESENTE' : 'AUSENTE'
        });
      });
      
      // Buscar RFC específico
      const found = csds.find(csd => {
        const csdRfc = String(csd.Rfc || '').trim().toUpperCase();
        const targetRfc = String(rfc || '').trim().toUpperCase();
        console.log(`🔍 Comparando: "${csdRfc}" === "${targetRfc}"`);
        return csdRfc === targetRfc;
      });
      
      if (found) {
        console.log(`✅ RFC ${rfc} encontrado en Facturama:`, {
          rfc: found.Rfc,
          status: found.Status || 'SIN_STATUS',
          validTo: found.ValidTo || 'SIN_FECHA',
          isActive: !found.Status || found.Status === 'Active' || found.Status === 'ACTIVE'
        });
        
        // Considerar activo si no tiene status o si status es Active
        const isActive = !found.Status || 
                        String(found.Status).toLowerCase() === 'active' || 
                        found.Certificate; // Si tiene certificado, asumimos que está activo
        
        if (isActive) {
          return true;
        } else {
          console.log(`⚠️ RFC ${rfc} encontrado pero inactivo. Status: ${found.Status}`);
          return true; // Por ahora permitir incluso si status no es "Active"
        }
      } else {
        console.log(`❌ RFC ${rfc} NO encontrado en la lista de CSDs`);
        console.log(`📋 RFCs disponibles:`, csds.map(c => c.Rfc || 'SIN_RFC'));
        return false;
      }
    } else {
      console.log(`⚠️ Respuesta no es array:`, typeof csds, csds);
      return true; // Si no podemos verificar, permitir continuar
    }
  } catch (error) {
    console.log(`⚠️ Error verificando RFC en Facturama:`, error.message);
    console.log(`🔄 Permitiendo continuar debido al error de verificación`);
    return true; // En caso de error, permitir continuar
  }
}
  
  console.log('Payload a enviar a Facturama:', JSON.stringify(payload, null, 2));

// ✅✅✅ MULTI-RFC: Cargar certificados del cliente ✅✅✅
  const clientConfig = await getIssuerConfig(sucursalId);
  
  console.log('🏢 Modo MULTI-RFC activado');
  console.log('📄 RFC del cliente (emisor):', clientConfig.rfc);
  console.log('📄 Nombre del cliente:', clientConfig.razon_social);
  
  // ✅ FORZAR ACTUALIZACIÓN DEL ISSUER CON DATOS DE LA BD
  payload.Issuer = {
    Rfc: String(clientConfig.rfc).toUpperCase(),
    Name: String(clientConfig.razon_social),
    FiscalRegime: String(clientConfig.regimen_fiscal || '612'),
  };
  payload.ExpeditionPlace = padCP(clientConfig.codigo_postal);
  
  console.log('✅ Issuer actualizado en payload:', payload.Issuer);
  
  // ✅ DEBUG: Ver qué tipo de datos llegan
  console.log('🔍 DEBUG Certificados:', {
    tiene_cer: !!clientConfig.cer_file,
    tipo_cer: typeof clientConfig.cer_file,
    tiene_key: !!clientConfig.key_file,
    tipo_key: typeof clientConfig.key_file,
    tiene_password: !!clientConfig.key_password
  });


  // Validar datos básicos del emisor
  if (!clientConfig.rfc || !clientConfig.razon_social) {
    throw new Error(
      `❌ DATOS DEL EMISOR INCOMPLETOS\n\n` +
      `Para timbrar con Multi-RFC necesitas:\n` +
      `• RFC del emisor: ${clientConfig.rfc || 'FALTANTE'}\n` +
      `• Razón social: ${clientConfig.razon_social || 'FALTANTE'}\n\n` +
      `Los certificados están en Facturama, pero necesitamos los datos fiscales básicos.`
    );
  }

  console.log('🔵 Multi-RFC: Usando certificados almacenados en Facturama');
  console.log('🔐 Timbrado con credenciales MAESTRAS + RFC del cliente en payload');

  // Usar credenciales maestras (las tuyas)
  const client = createEnvClient();

const stamp = await client.post('api-lite/3/cfdis', payload);

// CORRECCIÓN: Separar claramente ID de Facturama vs UUID del SAT
const facturamaId = stamp?.Id || stamp?.id || null;  // ID corto de Facturama (para descargas)

// Extraer UUID del SAT desde el complemento (para mostrar en facturas)
let satUuid = stamp?.Complement?.TaxStamp?.Uuid 
            || stamp?.Complement?.TimbreFiscalDigital?.UUID 
            || null;

let serie = stamp?.Serie || stamp?.series || null;
let folio = stamp?.Folio || stamp?.folio || payload.Folio || null;

console.log('🔍 VALORES EXTRAÍDOS:', {
  facturamaId: facturamaId,
  satUuid: satUuid,
  facturamaIdLength: facturamaId ? facturamaId.length : 0,
  satUuidLength: satUuid ? satUuid.length : 0
});

// Solo si no tenemos UUID del SAT, consultar detalles con retry
if (!satUuid && facturamaId) {
  try {
    // Primer intento con delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    const det = await client.get(`api-lite/3/cfdis/${facturamaId}`);
    satUuid = det?.Complement?.TaxStamp?.Uuid || det?.Complement?.TimbreFiscalDigital?.UUID || det?.Uuid || null;
    if (!serie) serie = det?.Serie || det?.Series || det?.SerieName || null;
    if (!folio) folio = det?.Folio || det?.FolioNumber || det?.folio || null;
  } catch (retryError) {
    console.log('⚠️ Primer intento de obtener detalles falló, reintentando...');
    try {
      // Segundo intento con más delay
      await new Promise(resolve => setTimeout(resolve, 5000));
      const det = await client.get(`api-lite/3/cfdis/${facturamaId}`);
      satUuid = det?.Complement?.TaxStamp?.Uuid || det?.Complement?.TimbreFiscalDigital?.UUID || det?.Uuid || null;
      if (!serie) serie = det?.Serie || det?.Series || det?.SerieName || null;
      if (!folio) folio = det?.Folio || det?.FolioNumber || det?.folio || null;
    } catch (finalError) {
      console.log('⚠️ No se pudieron obtener detalles del CFDI, pero el timbrado fue exitoso');
    }
  }
}

let updated = null;
if (facturaId) {
  updated = await updateFacturaAfterStamp({ 
    facturaId, 
    sucursalId, 
    cfdiId: facturamaId,    // ID de Facturama (para descargas)
    uuid: satUuid,          // UUID del SAT (para mostrar)
    serie, 
    folio 
  });
}

// =================== MEJORADO: avanzar ultimo_folio si corresponde ===================
try {
  const usedFolio = Number(folio || payload.Folio || 0) || 0;

  if (usedFolio > 0) {
    // Verificar si la columna 'id' existe
    const hasIdColumn = await tableHasColumn('facturacion_configuracion', 'id');
    
    if (hasIdColumn) {
      const cfgRow = await q(
        `SELECT id, ultimo_folio FROM facturacion_configuracion
         WHERE (sucursal_id=$1 OR sucursal_id IS NULL)
         ORDER BY (sucursal_id=$1) DESC, created_at DESC NULLS LAST
         LIMIT 1`,
        [sucursalId]
      );

      if (cfgRow.rows[0]) {
        const current = Number(cfgRow.rows[0].ultimo_folio || 0);
        if (usedFolio > current) {
          await q(
            `UPDATE facturacion_configuracion SET ultimo_folio=$1 WHERE id=$2`,
            [usedFolio, cfgRow.rows[0].id]
          );
          console.log(`📢 ultimo_folio actualizado a ${usedFolio} para ${sucursalId}`);
        }
      }
    } else {
      // Fallback: usar sucursal_id como clave
      const updateResult = await q(
        `UPDATE facturacion_configuracion SET ultimo_folio=$1 WHERE sucursal_id=$2`,
        [usedFolio, sucursalId]
      );
      if (updateResult.rowCount > 0) {
        console.log(`📢 ultimo_folio actualizado a ${usedFolio} para ${sucursalId} (usando sucursal_id)`);
      }
    }
  }
} catch (e) {
  console.log('⚠️ No se pudo actualizar ultimo_folio:', e?.message || e);
}

res.json({ 
  ok: true, 
  sucursalId, 
  facturaId, 
  cfdiId: facturamaId,      // Retornar ID de Facturama
  uuid: satUuid,            // Retornar UUID del SAT
  serie, 
  folio, 
  facturama: stamp, 
  updated 
});
}));

function isPDF(buffer) {
  return buffer && buffer.length > 6 && buffer.slice(0,5).toString('utf8') === '%PDF-';
}

function isXML(buffer) {
  return buffer && buffer.length > 5 && /^\s*<\?xml/i.test(buffer.slice(0,80).toString('utf8'));
}

function isZIP(buffer) {
  return buffer && buffer.length > 1 && buffer.slice(0,2).toString('utf8') === 'PK';
}

function isJSON(buffer) {
  return buffer && buffer.length > 0 && buffer[0] === 0x7B;
}

// === Helper: detectar si el parámetro es un UUID SAT ===
function isUUIDStr(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || ''));
}


// REEMPLAZAR COMPLETAMENTE la función downloadFacturamaFileFixed:

// ================== FIX DESCARGA FACTURAS BASE64 ==================
async function downloadFacturamaFileFixed(cfdiId, format = 'pdf', sucursalId = null) {
  if (!cfdiId) throw new Error('CFDI ID es requerido');

  console.log(`📥 ===== DESCARGA DE ${format.toUpperCase()} =====`);
  console.log(`🆔 CFDI ID: ${cfdiId}`);
  console.log(`🏢 Sucursal: ${sucursalId}`);
  console.log(`📄 Tipo: ${format}`);

  const user = String(process.env.FACTURAMA_USER || '');
  const pass = String(process.env.FACTURAMA_PASS || '');
  const env  = String(process.env.FACTURAMA_ENV || 'sandbox').toLowerCase();
  if (!user || !pass) throw new Error('Faltan credenciales FACTURAMA_USER/FACTURAMA_PASS');

  const base = env === 'production' ? 'https://api.facturama.mx/' : 'https://apisandbox.facturama.mx/';
  const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

  // issuedLite usa el ID corto de Facturama (no el UUID SAT)
  const endpoint = `cfdi/${format}/issuedLite/${cfdiId}`;
  const url = `${base}${endpoint}`;
  console.log(`🎯 Endpoint: ${endpoint}`);
  console.log(`📡 GET ${url}`);

  // No forzar sólo application/pdf: Facturama a veces devuelve JSON con base64
  const accept = format === 'zip' ? 'application/zip,*/*' : '*/*';

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': auth,
        'Accept': accept,
        'User-Agent': 'Dentalux-Multi-RFC/2.0'
      }
    });

    console.log(`📨 Response: ${res.status} ${res.statusText}`);
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      console.log(`⚠️ Error response body: ${errorText.substring(0, 200)}`);
      if (res.status === 404) throw new Error(`El CFDI ${cfdiId} no existe en Facturama o no tienes permisos para acceder`);
      if (res.status === 401 || res.status === 403) throw new Error('Credenciales de Facturama incorrectas o sin permisos');
      if (res.status === 408) throw new Error('Timeout: Facturama tardó demasiado en responder');
      throw new Error(`Error descargando ${format}: ${errorText || res.statusText}`);
    }

    // ---------- Manejo de JSON con base64 ----------
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      const j = await res.json().catch(() => null);
      if (!j || !j.Content) throw new Error(`Respuesta JSON inesperada al descargar ${format}`);

      if ((j.ContentEncoding || '').toLowerCase() === 'base64') {
        const buf = Buffer.from(String(j.Content), 'base64');

        if (format === 'pdf') {
          const header = buf.slice(0, 5).toString('utf8');
          if (header !== '%PDF-') {
            console.log('⚠️ Contenido base64 no inicia con %PDF- (primeros 100 bytes):', buf.slice(0, 100).toString('utf8'));
            throw new Error('El archivo descargado no es un PDF válido');
          }
        } else if (format === 'xml') {
          const start = buf.slice(0, 100).toString('utf8');
          if (!start.includes('<?xml') && !start.includes('<cfdi:')) {
            throw new Error('El archivo descargado no es un XML válido');
          }
        } else if (format === 'zip') {
          if (buf.slice(0, 2).toString('utf8') !== 'PK') {
            throw new Error('El archivo descargado no es un ZIP válido');
          }
        }

        console.log(`✅ ${format.toUpperCase()} (base64) decodificado correctamente – ${buf.length} bytes`);
        return buf;
      }

      throw new Error(`JSON recibido sin ContentEncoding base64 para ${format}`);
    }
    // ------------------------------------------------

    // Si no es JSON, leer como binario directo
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error(`Respuesta inválida: no se recibió contenido válido para ${format}`);
    }

    // Validaciones rápidas por tipo
    if (format === 'pdf') {
      const header = buffer.slice(0, 5).toString('utf8');
      if (header !== '%PDF-') {
        console.log('⚠️ Contenido recibido (primeros 100 bytes):', buffer.slice(0, 100).toString('utf8'));
        throw new Error('El archivo descargado no es un PDF válido');
      }
    } else if (format === 'xml') {
      const start = buffer.slice(0, 100).toString('utf8');
      if (!start.includes('<?xml') && !start.includes('<cfdi:')) {
        throw new Error('El archivo descargado no es un XML válido');
      }
    } else if (format === 'zip') {
      if (buffer.slice(0, 2).toString('utf8') !== 'PK') {
        throw new Error('El archivo descargado no es un ZIP válido');
      }
    }

    console.log(`✅ ${format.toUpperCase()} descargado exitosamente – ${buffer.length} bytes`);
    return buffer;

  } catch (error) {
    console.error(`❌ Error descargando ${format}:`, error.message);
    throw error;
  }
}

// FUNCIÓN AUXILIAR: Buscar/Resolver cfdi_id por UUID y actualizar BD si falta (ROBUSTA)
async function buscarCfdiIdPorUuid(uuid, sucursalId) {
  console.log('🔍 Resolver cfdi_id para UUID:', uuid);

  // 0) Ver si YA lo tenemos en BD
  const db = await q(
    `SELECT id, uuid, cfdi_id, serie, folio
       FROM facturas
      WHERE uuid = $1 AND (sucursal_id = $2 OR sucursal_id IS NULL)
      ORDER BY (sucursal_id = $2) DESC, fecha_timbrado DESC NULLS LAST
      LIMIT 1`,
    [uuid, sucursalId]
  );
  const row = db.rows[0] || null;
  if (!row) {
    console.log('❌ No hay factura con ese UUID en BD');
    return null;
  }
  if (row.cfdi_id) {
    console.log('✅ Ya estaba mapeado en BD:', row.cfdi_id);
    return row;
  }

  const client = createEnvClient();

  // INTENTO 1 — API LITE v3 (preferido)
  try {
    // Doc de Facturama (cuentas multi-RFC): /api-lite/3/cfdis?FolioFiscal=UUID
    const lista = await client.get('api-lite/3/cfdis', { FolioFiscal: uuid });
    const item = Array.isArray(lista) ? lista.find(x =>
      String(x?.FolioFiscal || x?.UUID || '').toLowerCase() === String(uuid).toLowerCase()
    ) : null;

    const cfdiId = item?.Id || item?.id || null;
    if (cfdiId) {
      await q(`UPDATE facturas SET cfdi_id=$1, updated_at=NOW() WHERE id=$2`, [cfdiId, row.id]);
      console.log('✅ (lite v3) Resuelto y guardado:', cfdiId);
      return { ...row, cfdi_id: cfdiId };
    }
  } catch (e) {
    console.log('ℹ️ api-lite/3/cfdis no resolvió:', e?.message || e);
  }

  // INTENTO 2 — API clásica listando emitidos y filtrando por FolioFiscal
  try {
    // Nota: algunos planes responden en 'cfdi?type=issued&FolioFiscal=...'
    const lista = await client.get('cfdi', { type: 'issued', FolioFiscal: uuid });
    const arr = Array.isArray(lista) ? lista : [];
    const m = arr.find(x =>
      String(x?.FolioFiscal || x?.UUID || '').toLowerCase() === String(uuid).toLowerCase()
    );
    const cfdiId = m?.Id || m?.id || null;
    if (cfdiId) {
      await q(`UPDATE facturas SET cfdi_id=$1, updated_at=NOW() WHERE id=$2`, [cfdiId, row.id]);
      console.log('✅ (cfdi issued) Resuelto y guardado:', cfdiId);
      return { ...row, cfdi_id: cfdiId };
    }
  } catch (e) {
    console.log('ℹ️ cfdi?type=issued no resolvió:', e?.message || e);
  }

  // INTENTO 3 — issuedLite directo (algunos tenants)
  try {
    // A veces exponen /cfdi/issuedLite?FolioFiscal=...
    const data = await client.get('cfdi/issuedLite', { FolioFiscal: uuid });
    const arr = Array.isArray(data) ? data : (data?.Items || []);
    const m = arr.find(x =>
      String(x?.FolioFiscal || x?.UUID || '').toLowerCase() === String(uuid).toLowerCase()
    );
    const cfdiId = m?.Id || m?.id || null;
    if (cfdiId) {
      await q(`UPDATE facturas SET cfdi_id=$1, updated_at=NOW() WHERE id=$2`, [cfdiId, row.id]);
      console.log('✅ (issuedLite) Resuelto y guardado:', cfdiId);
      return { ...row, cfdi_id: cfdiId };
    }
  } catch (e) {
    console.log('ℹ️ issuedLite no resolvió:', e?.message || e);
  }

  console.log('❌ No se pudo resolver cfdi_id para el UUID', uuid);
  return row; // regresamos la fila (aún sin cfdi_id) para que el caller decida
}

// ====== RUTAS CORTAS: /api/facturama/:id_o_uuid/(pdf|xml|zip) ======
router.get('/:ident/pdf', ah(async (req, res) => {
  const suc = getSucursalFromReq(req);
  const ident = String(req.params.ident || '');

  // Si es UUID, resolver cfdi_id; si no, se asume que ya es cfdi_id
  if (isUUIDStr(ident)) {
    const factura = await buscarCfdiIdPorUuid(ident, suc);
    if (!factura || !factura.cfdi_id) {
      return res.status(404).json({
        ok: false,
        error: 'UUID no mapeado en BD y no se pudo resolver cfdi_id',
        uuid: ident
      });
    }
    const buf = await downloadFacturamaFileFixed(factura.cfdi_id, 'pdf', suc);
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${(factura.serie || '')}${(factura.folio || '')}-${factura.id}.pdf"`);
    res.setHeader('Content-Length', String(buf.length));
    return res.end(buf);
  } else {
    const buf = await downloadFacturamaFileFixed(ident, 'pdf', suc);
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="factura_${ident}.pdf"`);
    res.setHeader('Content-Length', String(buf.length));
    return res.end(buf);
  }
}));


router.get('/:ident/xml', ah(async (req, res) => {
  const suc = getSucursalFromReq(req);
  const ident = String(req.params.ident || '');

  if (isUUIDStr(ident)) {
    const factura = await buscarCfdiIdPorUuid(ident, suc);
    if (!factura || !factura.cfdi_id) {
      return res.status(404).json({ ok:false, error: 'UUID no mapeado', uuid: ident });
    }
    const buf = await downloadFacturamaFileFixed(factura.cfdi_id, 'xml', suc);
    res.setHeader('Content-Type','application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${(factura.serie || '')}${(factura.folio || '')}-${factura.id}.xml"`);
    return res.end(buf);
  } else {
    const buf = await downloadFacturamaFileFixed(ident, 'xml', suc);
    res.setHeader('Content-Type','application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="factura_${ident}.xml"`);
    return res.end(buf);
  }
}));



router.get('/:ident/zip', ah(async (req, res) => {
  const suc = getSucursalFromReq(req);
  const ident = String(req.params.ident || '');
  if (isUUIDStr(ident)) {
    const factura = await buscarCfdiIdPorUuid(ident, suc);
    if (!factura || !factura.cfdi_id) {
      return res.status(404).json({ ok:false, error: 'UUID no mapeado', uuid: ident });
    }
    const buf = await downloadFacturamaFileFixed(factura.cfdi_id, 'zip', suc);
    res.setHeader('Content-Type','application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${(factura.serie || '')}${(factura.folio || '')}-${factura.id}.zip"`);
    return res.end(buf);
  } else {
    const buf = await downloadFacturamaFileFixed(ident, 'zip', suc);
    res.setHeader('Content-Type','application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="factura_${ident}.zip"`);
    return res.end(buf);
  }
}));




/* ====================== DESCARGAS ====================== */

router.get('/facturas/:id/pdf', ah(async (req, res) => {
  const s = getSucursalFromReq(req);
  const ident = String(req.params.id || '');
  console.log(`📄 PDF REQUEST: ${ident}, sucursal: ${s}`);
  
  const isUUID = ident.includes('-') && ident.length >= 32;
  console.log(`🔍 Es UUID: ${isUUID}, longitud: ${ident.length}`);
  
  if (isUUID) {
    const factura = await buscarCfdiIdPorUuid(ident, s);
    if (!factura) {
      return res.status(404).json({ 
        error: 'Factura no encontrada por UUID',
        uuid: ident.substring(0, 8) + '...',
        sucursal: s,
        sugerencia: 'Ejecuta POST /api/facturama/repair-cfdi-ids para reparar'
      });
    }
    
    try {
      const buffer = await downloadFacturamaFile(factura.cfdi_id, 'pdf', s);
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${ident.substring(0, 8)}.pdf"`);
      res.setHeader('Content-Length', String(buffer.length));
      return res.end(buffer);
    } catch (downloadError) {
      console.log('❌ Error en descarga:', downloadError.message);
      return res.status(500).json({ 
        error: 'Error descargando PDF', 
        details: downloadError.message,
        cfdi_id_usado: factura.cfdi_id,
        sugerencia: 'Si el error persiste, verifica en el portal de Facturama'
      });
    }
  }

  // Para IDs numéricos
  const { rows } = await q(`SELECT id, serie, folio, uuid, cfdi_id FROM facturas WHERE id=$1 AND (sucursal_id=$2 OR sucursal_id IS NULL)`, [ident, s]);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Factura no encontrada' });

  const downloadId = row.cfdi_id;
  if (!downloadId) return res.status(400).json({ 
    error: 'Sin CFDI ID de Facturama - ejecuta reparación: POST /api/facturama/repair-cfdi-ids' 
  });

  const buffer = await downloadFacturamaFile(downloadId, 'pdf', s);
  const fname = `${row.serie || ''}${row.folio || ''}-${row.id}.pdf`;
  
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${fname}"`);
  res.setHeader('Content-Length', String(buffer.length));
  return res.end(buffer);
}));

router.get('/facturas/:id/xml', ah(async (req, res) => {
  const s = getSucursalFromReq(req);
  const ident = String(req.params.id || '');
  
  const isUUID = ident.includes('-') && ident.length >= 32;
  if (isUUID) {
    const factura = await buscarCfdiIdPorUuid(ident, s);
    if (!factura) {
      return res.status(404).json({ error: 'Factura no encontrada por UUID' });
    }
    
    const buffer = await downloadFacturamaFile(factura.cfdi_id, 'xml', s);
    res.setHeader('Content-Type','application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${ident.substring(0, 8)}.xml"`);
    return res.end(buffer);
  }

  const { rows } = await q(`SELECT id, serie, folio, uuid, cfdi_id FROM facturas WHERE id=$1 AND (sucursal_id=$2 OR sucursal_id IS NULL)`, [ident, s]);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Factura no encontrada' });

  const downloadId = row.cfdi_id;
  if (!downloadId) return res.status(400).json({ 
    error: 'Sin CFDI ID de Facturama - ejecuta reparación: POST /api/facturama/repair-cfdi-ids' 
  });

  const buffer = await downloadFacturamaFile(downloadId, 'xml', s);
  const fname = `${row.serie || ''}${row.folio || ''}-${row.id}.xml`;
  
  res.setHeader('Content-Type','application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  return res.end(buffer);
}));

router.get('/facturas/:id/zip', ah(async (req, res) => {
  const s = getSucursalFromReq(req);
  const ident = String(req.params.id || '');
  
  const isUUID = ident.includes('-') && ident.length >= 32;
  if (isUUID) {
    const factura = await buscarCfdiIdPorUuid(ident, s);
    if (!factura) {
      return res.status(404).json({ error: 'Factura no encontrada por UUID' });
    }
    
    const buffer = await downloadFacturamaFile(factura.cfdi_id, 'zip', s);
    res.setHeader('Content-Type','application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${ident.substring(0, 8)}.zip"`);
    return res.end(buffer);
  }

  const { rows } = await q(`SELECT id, serie, folio, uuid, cfdi_id FROM facturas WHERE id=$1 AND (sucursal_id=$2 OR sucursal_id IS NULL)`, [ident, s]);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Factura no encontrada' });

  const downloadId = row.cfdi_id;
  if (!downloadId) return res.status(400).json({ 
    error: 'Sin CFDI ID de Facturama - ejecuta reparación: POST /api/facturama/repair-cfdi-ids' 
  });

  const buffer = await downloadFacturamaFile(downloadId, 'zip', s);
  const fname = `${row.serie || ''}${row.folio || ''}-${row.id}.zip`;
  
  res.setHeader('Content-Type','application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  return res.end(buffer);
}));



router.get('/test-auth', ah(async (req, res) => {
  try {
    const envClient = createEnvClient();
    const envTest = await envClient.get('api-lite/csds');
    res.json({
      success: true,
      env_credentials: {
        user: process.env.FACTURAMA_USER || 'NOT_SET',
        results: Array.isArray(envTest) ? envTest.length : 'not_array'
      }
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
}));


router.get('/mis-cfdis', ah(async (req, res) => {
  try {
    const client = createEnvClient();
    const cfdis = await client.get('cfdi', { type: 'issued', Page: 1 });
    
    if (Array.isArray(cfdis) && cfdis.length > 0) {
      res.json({
        success: true,
        total: cfdis.length,
        cfdis: cfdis.slice(0, 10).map(c => ({
          id: c.Id || c.id,
          serie: c.Serie,
          folio: c.Folio,
          fecha: c.Date,
          total: c.Total,
          receptor: c.Receiver?.Name
        }))
      });
    } else {
      res.json({ success: true, total: 0, message: 'No hay CFDIs' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}));

router.post('/crear-cfdi-prueba', ah(async (req, res) => {
  try {
    const client = createEnvClient();
    const cfdiPrueba = {
      CfdiType: "I",
      PaymentForm: "01",
      PaymentMethod: "PUE",
      ExpeditionPlace: "21395",
      Issuer: { Rfc: "XAXX010101000", Name: "EMPRESA DE PRUEBA SA DE CV", FiscalRegime: "601" },
      Receiver: { Rfc: "XEXX010101000", Name: "CLIENTE DE PRUEBA SA DE CV", CfdiUse: "G03", FiscalRegime: "601", TaxZipCode: "21395" },
      Items: [{
        ProductCode: "01010101",
        UnitCode: "E48",
        Description: "Servicio de prueba",
        UnitPrice: 100.00,
        Quantity: 1,
        Subtotal: 100.00,
        Total: 116.00,
        TaxObject: "02",
        Taxes: [{ Total: 16.00, Name: "IVA", Base: 100.00, Rate: 0.16, IsRetention: false }]
      }]
    };
    
   const resultado = await client.post('api-lite/3/cfdis', cfdiPrueba);
const cfdiId = resultado.Id || resultado.id;

let detalles = null;
try {
  detalles = await client.get(`api-lite/3/cfdis/${cfdiId}`);
} catch (_) {}

    
    res.json({ success: true, cfdiId, message: 'CFDI de prueba creado', detalles, testDownload: `/api/facturama/${cfdiId}/pdf` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}));

router.get('/test-download/:cfdiId', ah(async (req, res) => {
  const cfdiId = req.params.cfdiId;
  try {
    const client = createEnvClient();
const cfdiDetalle = await client.get(`api-lite/3/cfdis/${cfdiId}`);

const endpoints = [
  { url: `cfdi/pdf?type=issued&id=${cfdiId}`, nombre: 'Query params' },
  { url: `cfdi/${cfdiId}/pdf?type=issued`, nombre: 'REST' },
  { url: `3/cfdis/${cfdiId}/pdf`, nombre: 'API v3' }
];

    
    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[i];
      try {
        const response = await client.get(endpoint.url, {}, 'arraybuffer', 'application/pdf');
        if (Buffer.isBuffer(response) && response.length > 6 && response.slice(0, 5).toString('utf8') === '%PDF-') {
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `inline; filename="test-${cfdiId}.pdf"`);
          return res.end(response);
        }
      } catch (_) {}
    }
    
    res.status(500).json({ success: false, error: 'No se pudo descargar' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}));

/* =================== CONFIGURACIÓN =================== */

router.get('/configuracion', ah(async (req, res) => {
  const sucursalId = getSucursalFromReq(req);
  const cfg = await getIssuerConfig(sucursalId);

  let logo_url = cfg.logo_url || '';
  const hasLogoImage = await tableHasColumn('facturacion_configuracion', 'logo_image');
  if (hasLogoImage) {
    const { rows } = await q(
      `SELECT (logo_image IS NOT NULL) AS has_img FROM facturacion_configuracion
       WHERE (sucursal_id=$1 OR sucursal_id IS NULL)
       ORDER BY sucursal_id DESC NULLS LAST LIMIT 1`,
      [sucursalId]
    );
    if (rows[0]?.has_img) {
      const basePath = req.baseUrl || '';
      logo_url = `${basePath.replace(/\/$/, '')}/configuracion/logo/view?sucursal_id=${encodeURIComponent(sucursalId)}`;
    }
  }

  res.json({
    rfc: cfg.rfc || '',
    razon_social: cfg.razon_social || '',
    regimen_fiscal: cfg.regimen_fiscal || '601',
    codigo_postal: cfg.codigo_postal || '',
    pac_proveedor: cfg.pac_proveedor || 'facturama',
    pac_usuario: cfg.pac_usuario || '',
    pac_password: cfg.pac_password || '',
    pac_url_timbrado: cfg.pac_url_timbrado || '',
    pac_url_cancelacion: cfg.pac_url_cancelacion || '',
    serie_facturas: cfg.serie_facturas || '',
    ultimo_folio: Number(cfg.ultimo_folio || 1),
    ambiente: cfg.ambiente || (process.env.FACTURAMA_ENV === 'production' ? 'produccion' : 'pruebas'),
    activo: !!cfg.activo,
    logo_url,
  });
}));

router.put('/configuracion', express.json({ limit: '2mb' }), ah(async (req, res) => {
  const sucursalId = getSucursalFromReq(req);
  const fields = req.body || {};
  const cols = [];
  const vals = [];
  let i = 1;

  const allowed = ['rfc','razon_social','regimen_fiscal','codigo_postal','pac_proveedor','pac_usuario','pac_password','pac_url_timbrado','pac_url_cancelacion','serie_facturas','ultimo_folio','ambiente','activo','logo_url'];

  allowed.forEach((k) => {
    if (k in fields && fields[k] !== undefined) {
      // ✅ Convertir activo a booleano explícitamente
      let value = fields[k];
      if (k === 'activo') {
        value = Boolean(value);
      }
      cols.push(`${k}=$${i++}`);
      vals.push(value);
    }
  });

  const base = await getIssuerConfig(sucursalId);
  await q(`
    INSERT INTO facturacion_configuracion
      (sucursal_id, rfc, razon_social, regimen_fiscal, codigo_postal, pac_proveedor, pac_usuario, pac_password, ultimo_folio, ambiente, activo)
    VALUES ($1,$2,$3,$4,$5, COALESCE($6,'facturama'), COALESCE($7,''), COALESCE($8,''), COALESCE($9,1), COALESCE($10,'pruebas'), true)
    ON CONFLICT (sucursal_id) DO NOTHING
  `, [
    sucursalId,
    base?.rfc || 'XAXX010101000',
    base?.razon_social || 'SIN NOMBRE',
    base?.regimen_fiscal || '601',
    base?.codigo_postal || '21395',
    base?.pac_proveedor || 'facturama',
    base?.pac_usuario || '',
    base?.pac_password || '',
    Number(base?.ultimo_folio || 1),
    base?.ambiente || 'pruebas',
  ]);

  if (!cols.length) {
    const cfg = await getIssuerConfig(sucursalId);
    return res.json(cfg);
  }

  vals.push(sucursalId);
  const sql = `
    INSERT INTO facturacion_configuracion (sucursal_id, ${cols.map((c) => c.split('=')[0]).join(', ')})
    VALUES ($${i}, ${vals.slice(0, -1).map((_, idx) => `$${idx + 1}`).join(', ')})
    ON CONFLICT (sucursal_id) DO UPDATE SET ${cols.join(', ')}
    RETURNING *`;
  const { rows } = await q(sql, vals);

  res.json(rows[0]);
}));

router.post('/configuracion/logo', upload.single('logo'), ah(async (req, res) => {
  const sucursalId = getSucursalFromReq(req);

  let buf = null, mime = null;
  if (req.file) {
    buf = req.file.buffer;
    mime = req.file.mimetype || 'image/png';
  } else if (req.body?.logo_base64) {
    const raw = String(req.body.logo_base64);
    const m = raw.match(/^data:(.+?);base64,(.+)$/i);
    const b64 = m ? m[2] : raw;
    buf = Buffer.from(b64, 'base64');
    mime = (m && m[1]) || 'image/png';
  } else {
    return res.status(400).json({ ok: false, error: 'Falta archivo' });
  }

  const base = await getIssuerConfig(sucursalId);
  await q(`
    INSERT INTO facturacion_configuracion
      (sucursal_id, rfc, razon_social, regimen_fiscal, codigo_postal, pac_proveedor, pac_usuario, pac_password, ultimo_folio, ambiente, activo)
    VALUES ($1,$2,$3,$4,$5, COALESCE($6,'facturama'), COALESCE($7,''), COALESCE($8,''), COALESCE($9,1), COALESCE($10,'pruebas'), true)
    ON CONFLICT (sucursal_id) DO NOTHING
  `, [
    sucursalId,
    base?.rfc || 'XAXX010101000',
    base?.razon_social || 'SIN NOMBRE',
    base?.regimen_fiscal || '601',
    base?.codigo_postal || '21395',
    base?.pac_proveedor || 'facturama',
    base?.pac_usuario || '',
    base?.pac_password || '',
    Number(base?.ultimo_folio || 1),
    base?.ambiente || 'pruebas',
  ]);

  await q(`
    INSERT INTO facturacion_configuracion (sucursal_id, logo_image, logo_mime)
    VALUES ($1,$2,$3)
    ON CONFLICT (sucursal_id) DO UPDATE SET logo_image = EXCLUDED.logo_image, logo_mime = EXCLUDED.logo_mime
  `, [sucursalId, buf, mime]);

  const basePath = req.baseUrl || '';
  const url = `${basePath.replace(/\/$/, '')}/configuracion/logo/view?sucursal_id=${encodeURIComponent(sucursalId)}`;
  res.json({ ok: true, url });
}));

router.get('/configuracion/logo/view', ah(async (req, res) => {
  const sucursalId = getSucursalFromReq(req);
  const hasBin = await tableHasColumn('facturacion_configuracion', 'logo_image');

  if (!hasBin) {
    const { rows } = await q(`SELECT logo_url FROM facturacion_configuracion WHERE sucursal_id=$1 LIMIT 1`, [sucursalId]);
    const url = rows[0]?.logo_url || '';
    const m = String(url).match(/^data:(.+?);base64,(.+)$/);
    if (!m) return res.status(404).send('No hay logo');
    const mime = m[1];
    const buf = Buffer.from(m[2], 'base64');
    res.setHeader('Content-Type', mime);
    return res.send(buf);
  }

  const { rows } = await q(`SELECT logo_image, logo_mime FROM facturacion_configuracion WHERE sucursal_id=$1 LIMIT 1`, [sucursalId]);
  if (!rows[0]?.logo_image) return res.status(404).send('No hay logo');
  res.setHeader('Content-Type', rows[0].logo_mime || 'image/png');
  return res.send(rows[0].logo_image);
}));

/* =================== CERTIFICADOS CSD =================== */

router.post('/configuracion/certificados', upload.fields([
  { name: 'cer', maxCount: 1 },
  { name: 'key', maxCount: 1 }
]), ah(async (req, res) => {
  const sucursalId = getSucursalFromReq(req);
  const keyPassword = req.body?.key_password || '';

  console.log('');
  console.log('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
  console.log('🔐 SUBIENDO CERTIFICADOS CSD');
  console.log('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');
  console.log('🔑 Sucursal:', sucursalId);

  // Validaciones
  if (!req.files?.cer || !req.files?.key) {
    console.error('❌ Faltan archivos');
    return res.status(400).json({ 
      ok: false, 
      error: 'Debes subir ambos archivos: .cer y .key',
      received: req.files ? Object.keys(req.files) : []
    });
  }

  if (!keyPassword || keyPassword.trim() === '') {
    console.error('❌ Falta contraseña');
    return res.status(400).json({ 
      ok: false, 
      error: 'Debes proporcionar la contraseña de la llave privada (.key)' 
    });
  }

  const cerBuffer = req.files.cer[0].buffer;
  const keyBuffer = req.files.key[0].buffer;

  console.log('📏 Tamaño .cer:', cerBuffer.length, 'bytes');
  console.log('📏 Tamaño .key:', keyBuffer.length, 'bytes');

  if (cerBuffer.length < 100 || keyBuffer.length < 100) {
    console.error('❌ Archivos muy pequeños (posiblemente corruptos)');
    return res.status(400).json({ 
      ok: false, 
      error: 'Los archivos parecen estar vacíos o dañados',
      cerSize: cerBuffer.length,
      keySize: keyBuffer.length
    });
  }

  try {
    // 🔧 SOLUCIÓN: Primero verificar estructura de columnas
    const checkCols = await q(`
      SELECT 
        column_name, 
        data_type,
        is_nullable
      FROM information_schema.columns
      WHERE table_name = 'facturacion_configuracion'
        AND column_name IN ('cer_file', 'key_file', 'key_password')
      ORDER BY column_name
    `);

    console.log('📋 Estructura de columnas:', checkCols.rows);

    // 🔧 Verificar que las columnas existan y sean del tipo correcto
    const cerCol = checkCols.rows.find(r => r.column_name === 'cer_file');
    const keyCol = checkCols.rows.find(r => r.column_name === 'key_file');
    const passCol = checkCols.rows.find(r => r.column_name === 'key_password');

    if (!cerCol || !keyCol || !passCol) {
      console.error('❌ Faltan columnas en la tabla');
      return res.status(500).json({
        ok: false,
        error: 'La tabla facturacion_configuracion no tiene las columnas necesarias para certificados',
        columnas_encontradas: checkCols.rows.map(r => r.column_name)
      });
    }

    console.log('✅ Columnas verificadas:', {
      cer_file: cerCol.data_type,
      key_file: keyCol.data_type,
      key_password: passCol.data_type
    });

    // 🔧 VERIFICAR ESTADO ACTUAL
    const estadoActual = await q(`
      SELECT 
        sucursal_id,
        rfc,
        razon_social,
        (cer_file IS NOT NULL) as tiene_cer_not_null,
        (key_file IS NOT NULL) as tiene_key_not_null,
        (key_password IS NOT NULL) as tiene_pass_not_null,
        CASE 
          WHEN cer_file IS NULL THEN 0
          ELSE octet_length(cer_file)
        END as cer_size_actual,
        CASE 
          WHEN key_file IS NULL THEN 0
          ELSE octet_length(key_file)
        END as key_size_actual
      FROM facturacion_configuracion
      WHERE sucursal_id = $1
      LIMIT 1
    `, [sucursalId]);

    console.log('📊 Estado ANTES de guardar:', estadoActual.rows[0]);

    // 🔧 GUARDAR CON DELETE + INSERT (más confiable que UPDATE)
    console.log('🗑️ Eliminando registro anterior (si existe)...');
    await q(`DELETE FROM facturacion_configuracion WHERE sucursal_id = $1`, [sucursalId]);

    console.log('💾 Insertando nuevo registro con certificados...');
    const insertResult = await q(`
      INSERT INTO facturacion_configuracion (
        sucursal_id, 
        rfc, 
        razon_social, 
        regimen_fiscal, 
        codigo_postal,
        pac_proveedor, 
        pac_usuario, 
        pac_password, 
        ultimo_folio, 
        ambiente, 
        activo,
        cer_file, 
        key_file, 
        key_password
      ) VALUES (
        $1, 
        COALESCE($2, 'XAXX010101000'),
        COALESCE($3, 'CONFIGURACIÓN PENDIENTE'),
        COALESCE($4, '601'),
        COALESCE($5, '21395'),
        'facturama',
        COALESCE($6, ''),
        COALESCE($7, ''),
        COALESCE($8, 1),
        COALESCE($9, 'pruebas'),
        true,
        $10::bytea,
        $11::bytea,
        $12
      )
      RETURNING 
        sucursal_id,
        rfc,
        razon_social,
        (cer_file IS NOT NULL) as tiene_cer,
        (key_file IS NOT NULL) as tiene_key,
        (key_password IS NOT NULL) as tiene_pass,
        octet_length(cer_file) as cer_size,
        octet_length(key_file) as key_size
    `, [
      sucursalId,
      estadoActual.rows[0]?.rfc || 'XAXX010101000',
      estadoActual.rows[0]?.razon_social || 'CONFIGURACIÓN PENDIENTE',
      '612', // régimen fiscal por defecto
      '21395', // código postal por defecto
      '', // pac_usuario
      '', // pac_password
      1, // ultimo_folio
      'pruebas', // ambiente
      cerBuffer,
      keyBuffer,
      keyPassword
    ]);

    console.log('✅ INSERT ejecutado');
    console.log('📄 Registro creado:', insertResult.rows[0]);

    // 🔧 VERIFICACIÓN FINAL DIRECTA (sin getIssuerConfig)
    const verificacion = await q(`
      SELECT 
        sucursal_id,
        rfc,
        razon_social,
        (cer_file IS NOT NULL) as tiene_cer,
        (key_file IS NOT NULL) as tiene_key,
        (key_password IS NOT NULL AND key_password != '') as tiene_pass,
        CASE 
          WHEN cer_file IS NULL THEN 0
          ELSE octet_length(cer_file)
        END as cer_size,
        CASE 
          WHEN key_file IS NULL THEN 0
          ELSE octet_length(key_file)
        END as key_size
      FROM facturacion_configuracion
      WHERE sucursal_id = $1
      LIMIT 1
    `, [sucursalId]);

    console.log('📊 Estado DESPUÉS de guardar:', verificacion.rows[0]);

    const v = verificacion.rows[0];
    const tiene = v && v.tiene_cer && v.tiene_key && v.tiene_pass && v.cer_size > 0 && v.key_size > 0;

    if (!tiene) {
      console.error('❌ Los certificados NO se guardaron correctamente');
      console.error('Estado final:', v);
      
      return res.status(500).json({
        ok: false,
        error: 'Los certificados no se guardaron correctamente en la base de datos',
        debug: {
          tiene_cer: v?.tiene_cer,
          tiene_key: v?.tiene_key,
          tiene_pass: v?.tiene_pass,
          cer_size: v?.cer_size,
          key_size: v?.key_size
        }
      });
    }

    console.log('');
    console.log('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
    console.log('✅ CERTIFICADOS GUARDADOS EXITOSAMENTE');
    console.log('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');
    console.log('');

    res.json({ 
      ok: true, 
      message: 'Certificados CSD cargados correctamente',
      verificacion: {
        tiene_certificados: true,
        cer_size: v.cer_size,
        key_size: v.key_size,
      }
    });

  } catch (error) {
    console.error('');
    console.error('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
    console.error('❌ ERROR GUARDANDO CERTIFICADOS');
    console.error('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    console.error('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');
    console.error('');

    return res.status(500).json({
      ok: false,
      error: 'Error al guardar certificados: ' + (error?.message || 'Error desconocido'),
      details: {
        message: error?.message,
        code: error?.code,
        detail: error?.detail
      }
    });
  }
}));

router.get('/configuracion/certificados/status', ah(async (req, res) => {
  const sucursalId = getSucursalFromReq(req);

  console.log('🔍 Verificando certificados para sucursal:', sucursalId);

  try {
    // Usa la misma fuente de verdad que timbrado
    const cfg = await getIssuerConfig(sucursalId);

    const normLen = (v) => {
      if (!v) return 0;
      if (Buffer.isBuffer(v)) return v.length;
      if (typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data)) return v.data.length;
      try { return Buffer.from(v).length; } catch { return 0; }
    };

    const tiene_cer = !!cfg?.cer_file;
    const tiene_key = !!cfg?.key_file;
    const tiene_password = !!(cfg?.key_password && String(cfg.key_password).trim());
    const cer_size = normLen(cfg?.cer_file);
    const key_size = normLen(cfg?.key_file);
    const completo = tiene_cer && tiene_key && tiene_password;

    console.log('📊 Estado de certificados:', {
      tiene_cer,
      tiene_key,
      tiene_password,
      cer_size,
      key_size,
      completo
    });

    res.json({
      tiene_certificados: completo,
      tiene_cer,
      tiene_key,
      tiene_password,
      cer_size,
      key_size,
      mensaje: completo
        ? 'Certificados CSD configurados correctamente (fuente: getIssuerConfig)'
        : 'Faltan certificados o contraseña (fuente: getIssuerConfig)'
    });
  } catch (error) {
    console.error('❌ Error verificando certificados:', error);
    res.status(500).json({
      tiene_certificados: false,
      error: error?.message || 'Error al verificar certificados'
    });
  }
}));

// 🔍 ENDPOINT DE DEBUG - DEBE ESTAR ANTES DE OTRAS RUTAS CON PARÁMETROS
router.get('/debug-certificados-status', ah(async (req, res) => {
  const sucursalId = getSucursalFromReq(req);
  console.log('🔍 DEBUG CERTIFICADOS para sucursal:', sucursalId);

  try {
    const result = await q(`
      SELECT 
        id,
        sucursal_id,
        rfc,
        razon_social,
        pg_typeof(cer_file) as tipo_cer,
        pg_typeof(key_file) as tipo_key,
        CASE WHEN cer_file IS NULL THEN 'NULL' ELSE 'NOT NULL' END as cer_status,
        CASE WHEN key_file IS NULL THEN 'NULL' ELSE 'NOT NULL' END as key_status,
        CASE WHEN key_password IS NULL THEN 'NULL' ELSE 'NOT NULL' END as pass_status,
        CASE WHEN cer_file IS NULL THEN 0 ELSE octet_length(cer_file) END as cer_bytes,
        CASE WHEN key_file IS NULL THEN 0 ELSE octet_length(key_file) END as key_bytes,
        length(key_password) as pass_chars,
        created_at,
        updated_at
      FROM facturacion_configuracion
      WHERE sucursal_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [sucursalId]);

    if (result.rows.length === 0) {
      return res.json({
        success: false,
        mensaje: '❌ No existe configuración para esta sucursal',
        sucursal_id: sucursalId
      });
    }

    const row = result.rows[0];
    
    const analisis = {
      basico: {
        sucursal: row.sucursal_id,
        rfc: row.rfc,
        razon_social: row.razon_social
      },
      certificados: {
        cer: {
          status: row.cer_status,
          tipo: row.tipo_cer,
          bytes: row.cer_bytes,
          es_valido: row.cer_bytes >= 100
        },
        key: {
          status: row.key_status,
          tipo: row.tipo_key,
          bytes: row.key_bytes,
          es_valido: row.key_bytes >= 100
        },
        password: {
          status: row.pass_status,
          caracteres: row.pass_chars || 0,
          es_valido: (row.pass_chars || 0) >= 4
        }
      },
      diagnostico: {
        todo_ok: row.cer_bytes >= 100 && row.key_bytes >= 100 && (row.pass_chars || 0) >= 4,
        mensaje: row.cer_bytes >= 100 && row.key_bytes >= 100 && (row.pass_chars || 0) >= 4
          ? '✅ Certificados completos'
          : '❌ Faltan certificados o contraseña'
      }
    };

    res.json({
      success: true,
      sucursal_id: sucursalId,
      analisis
    });

  } catch (error) {
    console.error('❌ Error en debug:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Error desconocido',
      stack: error?.stack
    });
  }
}));

router.get('/:id/pdf', ah(async (req, res) => {
  const s = getSucursalFromReq(req);
  let ident = String(req.params.id || '');

  // Si llega UUID por error, intenta mapearlo a cfdi_id (ID de Facturama).
  const esUUID = ident.includes('-') && ident.length >= 32;
  if (esUUID) {
    const factura = await buscarCfdiIdPorUuid(ident, s);
    if (!factura || !factura.cfdi_id) {
      return res.status(404).json({
        ok: false,
        error: 'Para descargar usa el ID de Facturama (cfdi_id). Este UUID no está mapeado en la BD.',
        uuid: ident
      });
    }
    ident = factura.cfdi_id; // ahora sí, ID de Facturama
  }

  // A partir de aquí SIEMPRE usamos el ID de Facturama con issuedLite
  const buffer = await downloadFacturamaFile(ident, 'pdf', s);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${ident}.pdf"`);
  return res.end(buffer);
}));


router.get('/:id/xml', ah(async (req, res) => {
  const s = getSucursalFromReq(req);
  let ident = String(req.params.id || '');

  const esUUID = ident.includes('-') && ident.length >= 32;
  if (esUUID) {
    const factura = await buscarCfdiIdPorUuid(ident, s);
    if (!factura || !factura.cfdi_id) {
      return res.status(404).json({
        ok: false,
        error: 'Para descargar usa el ID de Facturama (cfdi_id). Este UUID no está mapeado en la BD.',
        uuid: ident
      });
    }
    ident = factura.cfdi_id;
  }

  const buffer = await downloadFacturamaFile(ident, 'xml', s);
  res.setHeader('Content-Type','application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${ident}.xml"`);
  return res.end(buffer);
}));


router.get('/:id/zip', ah(async (req, res) => {
  const s = getSucursalFromReq(req);
  let ident = String(req.params.id || '');

  const esUUID = ident.includes('-') && ident.length >= 32;
  if (esUUID) {
    const factura = await buscarCfdiIdPorUuid(ident, s);
    if (!factura || !factura.cfdi_id) {
      return res.status(404).json({
        ok: false,
        error: 'Para descargar usa el ID de Facturama (cfdi_id). Este UUID no está mapeado en la BD.',
        uuid: ident
      });
    }
    ident = factura.cfdi_id;
  }

  const buffer = await downloadFacturamaFile(ident, 'zip', s);
  res.setHeader('Content-Type','application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${ident}.zip"`);
  return res.end(buffer);
}));


module.exports = router;