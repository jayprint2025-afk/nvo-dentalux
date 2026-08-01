// modules/tenant-context.js
// Resuelve clinic_id (tenant) por canal y external_id (WA phone_number_id / FB page_id)

function asText(v) { return (v === null || v === undefined) ? '' : String(v); }

async function resolveClinicContext(q, req) {
  const channel =
    asText(req.headers?.['x-channel'] || req.body?.meta?.channel || req.body?.channel).trim().toLowerCase() || null;

  const externalId =
    asText(
      req.headers?.['x-wa-phone-number-id'] ||
      req.headers?.['x-page-id'] ||
      req.body?.meta?.phoneNumberId ||
      req.body?.meta?.pageId ||
      req.body?.external_id
    ).trim() || null;

  if (!channel || !externalId) return null;

  // Intentar obtener clinic_id existente
  let { rows } = await q(
    `SELECT clinic_id
       FROM clinic_channels
      WHERE channel = $1 AND external_id = $2
      LIMIT 1`,
    [channel, externalId]
  );

  // Si no existe, auto-crear con clinic_id = 'default' o basado en external_id
  if (!rows || rows.length === 0) {
    const defaultClinicId = `clinic_${channel}_${externalId}`;
    try {
      await q(
        `INSERT INTO clinic_channels (clinic_id, channel, external_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (channel, external_id) DO NOTHING`,
        [defaultClinicId, channel, externalId]
      );
      
      // Volver a consultar
      ({ rows } = await q(
        `SELECT clinic_id
           FROM clinic_channels
          WHERE channel = $1 AND external_id = $2
          LIMIT 1`,
        [channel, externalId]
      ));
    } catch (e) {
      console.error('Error auto-creating clinic_channels entry:', e.message);
    }
  }

  const clinic_id = rows?.[0]?.clinic_id || null;
  return clinic_id ? { clinic_id, channel, external_id: externalId } : null;
}

function normBranch(v) {
  const s = asText(v).trim().toLowerCase();
  if (!s) return null;
  if (s === '1' || s === 's1' || s === 'sucursal1' || s === 'sucursal_1' || s.includes('victoria')) return 'sucursal_1';
  if (s === '2' || s === 's2' || s === 'sucursal2' || s === 'sucursal_2' || s.includes('condesa')) return 'sucursal_2';
  if (s.startsWith('sucursal_')) return s;
  return null;
}

// Get branch display name (Victoria/Condesa instead of sucursal_1/sucursal_2)
function getBranchDisplayName(branch_key) {
  if (!branch_key) return 'Sucursal';
  const s = asText(branch_key).toLowerCase();
  if (s === 'sucursal_1' || s.includes('victoria')) return 'Victoria';
  if (s === 'sucursal_2' || s.includes('condesa')) return 'Condesa';
  if (s === 'sucursal_3') return 'Sucursal 3';
  return branch_key;
}

// Get clinic branch information from the best available source.
async function getClinicBranch(q, phoneNumberId, branchKey) {
  if (!branchKey) return null;

  const key = String(branchKey);
  const externalId = phoneNumberId ? String(phoneNumberId) : null;

  try {
    const { rows } = await q(
      `SELECT clinic_name, phone, whatsapp, address, city, state, country,
              google_maps_url, business_hours, notes
         FROM clinic_branches
        WHERE ($1::text IS NULL OR phone_number_id = $1::text)
          AND branch_key = $2
          AND is_active = TRUE
        LIMIT 1`,
      [externalId, key]
    );
    if (rows?.[0]) return rows[0];
  } catch (e) {
    if (!/relation "clinic_branches" does not exist/i.test(String(e.message))) {
      console.warn('clinic_branches access failed:', e.message);
    }
  }

  try {
    const { rows } = await q(
      `SELECT
          name AS clinic_name,
          phone,
          phone AS whatsapp,
          address,
          NULL::text AS city,
          NULL::text AS state,
          NULL::text AS country,
          NULL::text AS google_maps_url,
          NULL::text AS business_hours,
          NULL::text AS notes
         FROM branches
        WHERE branch_key = $1
          AND COALESCE(active, TRUE) = TRUE
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1`,
      [key]
    );
    if (rows?.[0]) return rows[0];
  } catch (e) {
    console.warn('branches table access failed:', e.message);
  }

  try {
    const { rows } = await q(
      `SELECT
          COALESCE(config->>'clinic_name', metadata->>'clinic_name', name, clinic_name) AS clinic_name,
          COALESCE(config->>'phone', metadata->>'phone') AS phone,
          COALESCE(config->>'whatsapp', metadata->>'whatsapp') AS whatsapp,
          COALESCE(config->>'address', metadata->>'address') AS address,
          COALESCE(config->>'city', metadata->>'city') AS city,
          COALESCE(config->>'state', metadata->>'state') AS state,
          COALESCE(config->>'country', metadata->>'country') AS country,
          COALESCE(config->>'google_maps_url', metadata->>'google_maps_url') AS google_maps_url,
          COALESCE(config->>'business_hours', metadata->>'business_hours') AS business_hours,
          COALESCE(config->>'notes', metadata->>'notes') AS notes
         FROM clinic_channels
        WHERE ($1::text IS NULL OR external_id = $1 OR phone_number_id = $1)
          AND (
            branch_key = $2
            OR sucursal_id = $2
            OR config->>'branch_key' = $2
            OR metadata->>'branch_key' = $2
          )
          AND COALESCE(active, TRUE) = TRUE
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1`,
      [externalId, key]
    );
    if (rows?.[0]) return rows[0];
  } catch (e) {
    console.warn('clinic_channels branch fallback failed:', e.message);
  }

  try {
    const configured = JSON.parse(process.env.CLINIC_BRANCHES_JSON || '{}');
    const row = configured?.[key] || null;
    if (row && typeof row === 'object') return row;
  } catch (e) {
    console.warn('CLINIC_BRANCHES_JSON inválido:', e.message);
  }

  return null;
}

module.exports = {
  resolveClinicContext,
  normBranch,
  getBranchDisplayName,
  getClinicBranch,
};
