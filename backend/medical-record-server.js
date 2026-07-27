// medical-record-server.js - Módulo del servidor para Expediente Médico Dental

// Helper para async/await con manejo de errores
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Helper para obtener sucursal desde request
function getSucursal(req) {
  return req.query.sucursal || req.headers['x-sucursal'] || req.body?.sucursal_id || 'sucursal_1';
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

// Función para crear las tablas del expediente médico dental
async function createMedicalRecordTables(query) {
  try {
    console.log('🏥 Creando tablas del expediente médico dental...');

    // Tabla principal de expedientes médicos
    await query(`
      CREATE TABLE IF NOT EXISTS expedientes_medicos (
        id SERIAL PRIMARY KEY,
        paciente_id TEXT NOT NULL,
        nombre_paciente TEXT NOT NULL,
        telefono TEXT,
        email TEXT,
        fecha_nacimiento DATE,
        edad INTEGER,
        genero TEXT CHECK (genero IN ('masculino', 'femenino', 'otro')),
        direccion TEXT,
        ocupacion TEXT,
        estado_civil TEXT,
        contacto_emergencia TEXT,
        telefono_emergencia TEXT,
        sucursal_id TEXT NOT NULL,
        tenant_id UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Tabla de historia clínica dental
    await query(`
      CREATE TABLE IF NOT EXISTS historia_clinica_dental (
        id SERIAL PRIMARY KEY,
        expediente_id INTEGER REFERENCES expedientes_medicos(id) ON DELETE CASCADE,
        appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
        tenant_id UUID,
        motivo_consulta TEXT,
        enfermedad_actual TEXT,
        antecedentes_personales TEXT,
        antecedentes_familiares TEXT,
        antecedentes_odontologicos TEXT,
        habitos_nocivos TEXT,
        alergias TEXT,
        medicamentos_actuales TEXT,
        examen_extraoral TEXT,
        examen_intraoral TEXT,
        diagnostico_presuntivo TEXT,
        plan_tratamiento TEXT,
        observaciones TEXT,
        doctor_id TEXT,
        fecha_registro DATE NOT NULL,
        sucursal_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Tabla del odontograma
    await query(`
      CREATE TABLE IF NOT EXISTS odontograma (
        id SERIAL PRIMARY KEY,
        expediente_id INTEGER REFERENCES expedientes_medicos(id) ON DELETE CASCADE,
        appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
        tenant_id UUID,
        diente_numero INTEGER NOT NULL CHECK (diente_numero >= 11 AND diente_numero <= 48),
        estado TEXT NOT NULL CHECK (estado IN ('sano', 'cariado', 'obturado', 'extraido', 'endodoncia', 'corona', 'implante', 'protesis')),
        superficie TEXT,
        observaciones TEXT,
        fecha_registro DATE NOT NULL,
        doctor_id TEXT,
        sucursal_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(expediente_id, diente_numero)
      )
    `);

    // Tabla de tratamientos dentales
    await query(`
      CREATE TABLE IF NOT EXISTS tratamientos_dentales (
        id SERIAL PRIMARY KEY,
        expediente_id INTEGER REFERENCES expedientes_medicos(id) ON DELETE CASCADE,
        appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
        tenant_id UUID,
        fecha DATE NOT NULL,
        diente_numero INTEGER CHECK (diente_numero >= 11 AND diente_numero <= 48),
        procedimiento TEXT NOT NULL,
        descripcion TEXT,
        materiales_usados TEXT,
        duracion_minutos INTEGER,
        costo DECIMAL(10,2),
        estado TEXT NOT NULL CHECK (estado IN ('planificado', 'en_progreso', 'completado', 'cancelado')) DEFAULT 'planificado',
        observaciones TEXT,
        doctor_id TEXT,
        sucursal_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Tabla de consentimientos informados
    await query(`
      CREATE TABLE IF NOT EXISTS consentimientos_informados (
        id SERIAL PRIMARY KEY,
        expediente_id INTEGER REFERENCES expedientes_medicos(id) ON DELETE CASCADE,
        appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
        tenant_id UUID,
        tipo_tratamiento TEXT NOT NULL,
        descripcion_tratamiento TEXT,
        riesgos_beneficios TEXT,
        alternativas TEXT,
        costo_estimado DECIMAL(10,2),
        fecha_consentimiento DATE NOT NULL,
        firma_paciente BOOLEAN DEFAULT FALSE,
        firma_doctor BOOLEAN DEFAULT FALSE,
        testigo_nombre TEXT,
        testigo_identificacion TEXT,
        doctor_id TEXT,
        sucursal_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Tabla de documentos y radiografías
    await query(`
      CREATE TABLE IF NOT EXISTS documentos_radiografias (
        id SERIAL PRIMARY KEY,
        expediente_id INTEGER REFERENCES expedientes_medicos(id) ON DELETE CASCADE,
        appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
        tenant_id UUID,
        tipo TEXT NOT NULL CHECK (tipo IN ('radiografia', 'fotografia', 'documento', 'laboratorio')),
        nombre TEXT NOT NULL,
        descripcion TEXT,
        fecha_toma DATE NOT NULL,
        datos_base64 TEXT,
        url TEXT,
        doctor_id TEXT,
        sucursal_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Migración multi-tenant y relación expediente ↔ citas
    await query(`ALTER TABLE expedientes_medicos ADD COLUMN IF NOT EXISTS tenant_id UUID`);
    await query(`ALTER TABLE historia_clinica_dental ADD COLUMN IF NOT EXISTS tenant_id UUID`);
    await query(`ALTER TABLE odontograma ADD COLUMN IF NOT EXISTS tenant_id UUID`);
    await query(`ALTER TABLE tratamientos_dentales ADD COLUMN IF NOT EXISTS tenant_id UUID`);
    await query(`ALTER TABLE consentimientos_informados ADD COLUMN IF NOT EXISTS tenant_id UUID`);
    await query(`ALTER TABLE documentos_radiografias ADD COLUMN IF NOT EXISTS tenant_id UUID`);

    await query(`ALTER TABLE historia_clinica_dental ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL`);
    await query(`ALTER TABLE odontograma ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL`);
    await query(`ALTER TABLE tratamientos_dentales ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL`);
    await query(`ALTER TABLE consentimientos_informados ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL`);
    await query(`ALTER TABLE documentos_radiografias ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL`);

    await query(`
      CREATE TABLE IF NOT EXISTS expediente_citas (
        id BIGSERIAL PRIMARY KEY,
        expediente_id INTEGER NOT NULL REFERENCES expedientes_medicos(id) ON DELETE CASCADE,
        appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL,
        sucursal_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, appointment_id)
      )
    `);

    // Backfill seguro cuando la instalación tiene una sola empresa.
    await query(`
      DO $$
      DECLARE only_tenant UUID;
      BEGIN
        SELECT id INTO only_tenant FROM tenants ORDER BY created_at LIMIT 1;
        IF only_tenant IS NOT NULL AND (SELECT COUNT(*) FROM tenants) = 1 THEN
          UPDATE expedientes_medicos SET tenant_id = only_tenant WHERE tenant_id IS NULL;
          UPDATE historia_clinica_dental h SET tenant_id = e.tenant_id FROM expedientes_medicos e WHERE h.expediente_id=e.id AND h.tenant_id IS NULL;
          UPDATE odontograma o SET tenant_id = e.tenant_id FROM expedientes_medicos e WHERE o.expediente_id=e.id AND o.tenant_id IS NULL;
          UPDATE tratamientos_dentales t SET tenant_id = e.tenant_id FROM expedientes_medicos e WHERE t.expediente_id=e.id AND t.tenant_id IS NULL;
          UPDATE consentimientos_informados c SET tenant_id = e.tenant_id FROM expedientes_medicos e WHERE c.expediente_id=e.id AND c.tenant_id IS NULL;
          UPDATE documentos_radiografias d SET tenant_id = e.tenant_id FROM expedientes_medicos e WHERE d.expediente_id=e.id AND d.tenant_id IS NULL;
        END IF;
      END $$
    `).catch(() => {});

    const medicalTables = [
      'expedientes_medicos','historia_clinica_dental','odontograma',
      'tratamientos_dentales','consentimientos_informados',
      'documentos_radiografias','expediente_citas'
    ];
    for (const table of medicalTables) {
      await query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`).catch(() => {});
      await query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`).catch(() => {});
      await query(`DROP POLICY IF EXISTS ${table}_tenant_isolation ON ${table}`).catch(() => {});
      await query(`
        CREATE POLICY ${table}_tenant_isolation ON ${table}
        USING (
          current_setting('app.tenant_bypass', true) = 'on'
          OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        )
        WITH CHECK (
          current_setting('app.tenant_bypass', true) = 'on'
          OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        )
      `).catch(() => {});
    }

    // Índices para mejor rendimiento
    await query(`CREATE INDEX IF NOT EXISTS idx_expedientes_paciente ON expedientes_medicos(tenant_id, paciente_id, sucursal_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_expediente_citas_lookup ON expediente_citas(tenant_id, appointment_id, expediente_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_expedientes_nombre ON expedientes_medicos(LOWER(nombre_paciente), sucursal_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_historia_expediente ON historia_clinica_dental(expediente_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_odontograma_expediente ON odontograma(expediente_id, diente_numero)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_tratamientos_expediente ON tratamientos_dentales(expediente_id, fecha DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_consentimientos_expediente ON consentimientos_informados(expediente_id, fecha_consentimiento DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_documentos_expediente ON documentos_radiografias(expediente_id, fecha_toma DESC)`);

    console.log('✅ Tablas del expediente médico dental creadas exitosamente');
  } catch (error) {
    console.error('❌ Error creando tablas del expediente médico:', error);
    throw error;
  }
}

// Función para registrar las rutas del expediente médico
function setupMedicalRecordRoutes(app, query, options = {}) {
  const medicalAuth = options.authRequired || ((req, res, next) => {
    if (!req?.auth?.tenantId) return res.status(401).json({ error: 'Sesión requerida' });
    next();
  });
  console.log('🔗 Configurando rutas del expediente médico dental...');

  // ============= RUTAS DE EXPEDIENTES MÉDICOS =============

  async function cargarExpedienteCompleto(expediente, appointmentId, tenantId) {
    const historiaResult = await query(`
      SELECT * FROM historia_clinica_dental
      WHERE expediente_id=$1 AND tenant_id=$2
      ORDER BY (appointment_id=$3) DESC, created_at DESC LIMIT 1
    `, [expediente.id, tenantId, appointmentId || null]);
    const odontogramaResult = await query(`SELECT * FROM odontograma WHERE expediente_id=$1 AND tenant_id=$2 ORDER BY diente_numero`, [expediente.id, tenantId]);
    const tratamientosResult = await query(`SELECT * FROM tratamientos_dentales WHERE expediente_id=$1 AND tenant_id=$2 ORDER BY fecha DESC, created_at DESC`, [expediente.id, tenantId]);
    const consentimientosResult = await query(`SELECT * FROM consentimientos_informados WHERE expediente_id=$1 AND tenant_id=$2 ORDER BY fecha_consentimiento DESC, created_at DESC`, [expediente.id, tenantId]);
    const radiografiasResult = await query(`
      SELECT id, expediente_id, appointment_id, tenant_id, tipo, nombre, descripcion, fecha_toma, doctor_id, sucursal_id, created_at,
             CASE WHEN LENGTH(datos_base64) > 100 THEN 'true' ELSE 'false' END AS tiene_datos
      FROM documentos_radiografias WHERE expediente_id=$1 AND tenant_id=$2 ORDER BY fecha_toma DESC, created_at DESC
    `, [expediente.id, tenantId]);
    return {
      expediente,
      appointment_id: appointmentId || null,
      historia_clinica: historiaResult.rows[0] || null,
      odontograma: odontogramaResult.rows,
      tratamientos: tratamientosResult.rows,
      consentimientos: consentimientosResult.rows,
      radiografias: radiografiasResult.rows
    };
  }

  // Obtener expediente directamente desde la cita seleccionada en agenda
  app.get('/api/expediente-medico/cita/:appointmentId', medicalAuth, ah(async (req, res) => {
    const tenantId = getTenantId(req);
    const sucursalId = getSucursal(req);
    const appointmentId = Number(req.params.appointmentId);
    if (!Number.isInteger(appointmentId)) return res.status(400).json({ error: 'ID de cita inválido' });

    const appointmentResult = await query(`
      SELECT id, patient, phone, sucursal_id
      FROM appointments
      WHERE id=$1 AND tenant_id=$2 AND sucursal_id=$3
      LIMIT 1
    `, [appointmentId, tenantId, sucursalId]);
    const appointment = appointmentResult.rows[0];
    if (!appointment) return res.status(404).json({ error: 'Cita no encontrada para esta empresa' });

    let expedienteResult = await query(`
      SELECT e.* FROM expediente_citas ec
      JOIN expedientes_medicos e ON e.id=ec.expediente_id
      WHERE ec.appointment_id=$1 AND ec.tenant_id=$2
      LIMIT 1
    `, [appointmentId, tenantId]);

    if (!expedienteResult.rows.length) {
      expedienteResult = await query(`
        SELECT * FROM expedientes_medicos
        WHERE tenant_id=$1 AND sucursal_id=$2
          AND (
            (NULLIF(regexp_replace(COALESCE(telefono,''), '\\D','','g'),'') IS NOT NULL
             AND RIGHT(regexp_replace(COALESCE(telefono,''), '\\D','','g'),10)=RIGHT(regexp_replace(COALESCE($3,''), '\\D','','g'),10))
            OR LOWER(nombre_paciente)=LOWER($4)
          )
        ORDER BY created_at DESC LIMIT 1
      `, [tenantId, sucursalId, appointment.phone || '', appointment.patient || '']);
      if (expedienteResult.rows.length) {
        await query(`INSERT INTO expediente_citas(expediente_id,appointment_id,tenant_id,sucursal_id) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,appointment_id) DO NOTHING`, [expedienteResult.rows[0].id, appointmentId, tenantId, sucursalId]);
      }
    }

    if (!expedienteResult.rows.length) return res.status(404).json({ error: 'Expediente médico no encontrado', appointment });
    return res.json(await cargarExpedienteCompleto(expedienteResult.rows[0], appointmentId, tenantId));
  }));

  // Obtener expediente médico completo por nombre de paciente
  app.get('/api/expediente-medico/paciente/:nombrePaciente', medicalAuth, ah(async (req, res) => {
    const { nombrePaciente } = req.params;
    const sucursalId = getSucursal(req);
    const tenantId = getTenantId(req);

    try {
      console.log(`🔍 Buscando expediente médico para: ${nombrePaciente} en sucursal: ${sucursalId}`);

      // Buscar expediente médico por nombre (case insensitive)
      const expedienteResult = await query(`
        SELECT * FROM expedientes_medicos 
        WHERE LOWER(nombre_paciente) = LOWER($1) 
        AND sucursal_id = $2 AND tenant_id = $3
        ORDER BY created_at DESC
        LIMIT 1
      `, [decodeURIComponent(nombrePaciente), sucursalId, tenantId]);

      if (expedienteResult.rows.length === 0) {
        console.log(`❌ Expediente médico no encontrado para: ${nombrePaciente}`);
        return res.status(404).json({ error: 'Expediente médico no encontrado' });
      }

      const expediente = expedienteResult.rows[0];
      console.log(`✅ Expediente médico encontrado: ID ${expediente.id}`);

      // Obtener historia clínica dental
      const historiaResult = await query(`
        SELECT * FROM historia_clinica_dental 
        WHERE expediente_id = $1 
        ORDER BY created_at DESC
        LIMIT 1
      `, [expediente.id]);

      // Obtener odontograma
      const odontogramaResult = await query(`
        SELECT * FROM odontograma 
        WHERE expediente_id = $1 
        ORDER BY diente_numero ASC
      `, [expediente.id]);

      // Obtener tratamientos
      const tratamientosResult = await query(`
        SELECT * FROM tratamientos_dentales 
        WHERE expediente_id = $1 
        ORDER BY fecha DESC, created_at DESC
      `, [expediente.id]);

      // Obtener consentimientos informados
      const consentimientosResult = await query(`
        SELECT * FROM consentimientos_informados 
        WHERE expediente_id = $1 
        ORDER BY fecha_consentimiento DESC, created_at DESC
      `, [expediente.id]);

      // Obtener radiografías y documentos (sin datos base64 para listar)
      const radiografiasResult = await query(`
        SELECT id, expediente_id, tipo, nombre, descripcion, fecha_toma, doctor_id, sucursal_id, created_at,
               CASE WHEN LENGTH(datos_base64) > 100 THEN 'true' ELSE 'false' END as tiene_datos
        FROM documentos_radiografias 
        WHERE expediente_id = $1 
        ORDER BY fecha_toma DESC, created_at DESC
      `, [expediente.id]);

      res.json({
        expediente,
        historia_clinica: historiaResult.rows[0] || null,
        odontograma: odontogramaResult.rows,
        tratamientos: tratamientosResult.rows,
        consentimientos: consentimientosResult.rows,
        radiografias: radiografiasResult.rows
      });

    } catch (error) {
      console.error('Error obteniendo expediente médico:', error);
      res.status(500).json({ error: error.message });
    }
  }));

  // Crear nuevo expediente médico
  app.post('/api/expediente-medico', medicalAuth, ah(async (req, res) => {
    const sucursalId = getSucursal(req);
    const tenantId = getTenantId(req);
    const {
      paciente_id,
      appointment_id,
      nombre_paciente,
      telefono,
      email,
      fecha_nacimiento,
      edad,
      genero,
      direccion,
      ocupacion,
      estado_civil,
      contacto_emergencia,
      telefono_emergencia
    } = req.body;

    if (!nombre_paciente) {
      return res.status(400).json({ error: 'El nombre del paciente es requerido' });
    }

    try {
      console.log(`➕ Creando nuevo expediente médico para: ${nombre_paciente}`);

      const result = await query(`
        INSERT INTO expedientes_medicos (
          paciente_id, nombre_paciente, telefono, email, fecha_nacimiento, edad,
          genero, direccion, ocupacion, estado_civil, contacto_emergencia,
          telefono_emergencia, sucursal_id, tenant_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *
      `, [
        paciente_id || `paciente_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        nombre_paciente,
        telefono,
        email,
        fecha_nacimiento,
        edad,
        genero,
        direccion,
        ocupacion,
        estado_civil,
        contacto_emergencia,
        telefono_emergencia,
        sucursalId,
        tenantId
      ]);

      if (appointment_id) {
        const cita = await query(`SELECT id FROM appointments WHERE id=$1 AND tenant_id=$2 AND sucursal_id=$3`, [Number(appointment_id), tenantId, sucursalId]);
        if (!cita.rows.length) return res.status(400).json({ error: 'La cita no pertenece a esta empresa o sucursal' });
        await query(`INSERT INTO expediente_citas(expediente_id,appointment_id,tenant_id,sucursal_id) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,appointment_id) DO NOTHING`, [result.rows[0].id, Number(appointment_id), tenantId, sucursalId]);
      }

      console.log(`✅ Expediente médico creado: ID ${result.rows[0].id}`);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error creando expediente médico:', error);
      res.status(500).json({ error: error.message });
    }
  }));

 // Actualizar expediente médico
app.put('/api/expediente-medico/:id', medicalAuth, ah(async (req, res) => {
  const { id } = req.params;
  const sucursalId = getSucursal(req);
    const tenantId = getTenantId(req);

  const {
    nombre_paciente,
    telefono,
    email,
    fecha_nacimiento,
    edad,
    genero,
    direccion,
    ocupacion,
    estado_civil,
    contacto_emergencia,
    telefono_emergencia,
  } = req.body;

  // Hacemos UPDATE filtrando también por sucursal para que
  // no puedas editar expedientes de otra sucursal
  const result = await query(`
    UPDATE expedientes_medicos
    SET
      nombre_paciente = $1,
      telefono = $2,
      email = $3,
      fecha_nacimiento = $4,
      edad = $5,
      genero = $6,
      direccion = $7,
      ocupacion = $8,
      estado_civil = $9,
      contacto_emergencia = $10,
      telefono_emergencia = $11,
      updated_at = NOW()
    WHERE id = $12
    AND sucursal_id = $13 AND tenant_id = $14
    RETURNING *
  `, [
    nombre_paciente || null,
    telefono || null,
    email || null,
    fecha_nacimiento || null,
    edad || null,
    genero || null,
    direccion || null,
    ocupacion || null,
    estado_civil || null,
    contacto_emergencia || null,
    telefono_emergencia || null,
    id,
    sucursalId,
    tenantId
  ]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Expediente no encontrado o no pertenece a esta sucursal' });
  }

  res.json(result.rows[0]);
}));

// Crear historia clínica dental
app.post('/api/historia-clinica-dental', medicalAuth, ah(async (req, res) => {
  const sucursalId = getSucursal(req);
    const tenantId = getTenantId(req);

  const {
    expediente_id,
      appointment_id,
    motivo_consulta,
    enfermedad_actual,
    antecedentes_personales,
    antecedentes_familiares,
    antecedentes_odontologicos,
    habitos_nocivos,
    alergias,
    medicamentos_actuales,
    examen_extraoral,
    examen_intraoral,
    diagnostico_presuntivo,
    plan_tratamiento,
    observaciones,
    doctor_id,
    fecha_registro
  } = req.body;

  const result = await query(`
    INSERT INTO historia_clinica_dental (
      expediente_id, appointment_id, tenant_id,
      motivo_consulta,
      enfermedad_actual,
      antecedentes_personales,
      antecedentes_familiares,
      antecedentes_odontologicos,
      habitos_nocivos,
      alergias,
      medicamentos_actuales,
      examen_extraoral,
      examen_intraoral,
      diagnostico_presuntivo,
      plan_tratamiento,
      observaciones,
      doctor_id,
      fecha_registro,
      sucursal_id
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
    )
    RETURNING *
  `, [
    expediente_id,
    appointment_id || null,
    tenantId,
    motivo_consulta || '',
    enfermedad_actual || '',
    antecedentes_personales || '',
    antecedentes_familiares || '',
    antecedentes_odontologicos || '',
    habitos_nocivos || '',
    alergias || '',
    medicamentos_actuales || '',
    examen_extraoral || '',
    examen_intraoral || '',
    diagnostico_presuntivo || '',
    plan_tratamiento || '',
    observaciones || '',
    doctor_id || null,
    fecha_registro || new Date().toISOString().split('T')[0],
    sucursalId
  ]);

  res.status(201).json(result.rows[0]);
}));


// Actualizar historia clínica dental
app.put('/api/historia-clinica-dental/:id', medicalAuth, ah(async (req, res) => {
  const { id } = req.params;
  const sucursalId = getSucursal(req);
    const tenantId = getTenantId(req);

  const {
    motivo_consulta,
    enfermedad_actual,
    antecedentes_personales,
    antecedentes_familiares,
    antecedentes_odontologicos,
    habitos_nocivos,
    alergias,
    medicamentos_actuales,
    examen_extraoral,
    examen_intraoral,
    diagnostico_presuntivo,
    plan_tratamiento,
    observaciones,
    doctor_id,
    fecha_registro
  } = req.body;

  const result = await query(`
    UPDATE historia_clinica_dental
    SET
      motivo_consulta = $1,
      enfermedad_actual = $2,
      antecedentes_personales = $3,
      antecedentes_familiares = $4,
      antecedentes_odontologicos = $5,
      habitos_nocivos = $6,
      alergias = $7,
      medicamentos_actuales = $8,
      examen_extraoral = $9,
      examen_intraoral = $10,
      diagnostico_presuntivo = $11,
      plan_tratamiento = $12,
      observaciones = $13,
      doctor_id = $14,
      fecha_registro = $15
    WHERE id = $16
    AND sucursal_id = $17 AND tenant_id = $18
    RETURNING *
  `, [
    motivo_consulta || '',
    enfermedad_actual || '',
    antecedentes_personales || '',
    antecedentes_familiares || '',
    antecedentes_odontologicos || '',
    habitos_nocivos || '',
    alergias || '',
    medicamentos_actuales || '',
    examen_extraoral || '',
    examen_intraoral || '',
    diagnostico_presuntivo || '',
    plan_tratamiento || '',
    observaciones || '',
    doctor_id || null,
    fecha_registro || new Date().toISOString().split('T')[0],
    id,
    sucursalId,
    tenantId
  ]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Historia clínica no encontrada o no pertenece a esta sucursal' });
  }

  res.json(result.rows[0]);
}));

  // ============= RUTAS DE ODONTOGRAMA =============

  // Crear/actualizar estado de diente en odontograma
  app.post('/api/odontograma', medicalAuth, ah(async (req, res) => {
    const sucursalId = getSucursal(req);
    const tenantId = getTenantId(req);
    const {
      expediente_id,
      appointment_id,
      diente_numero,
      estado,
      superficie,
      observaciones,
      fecha_registro,
      doctor_id
    } = req.body;

    if (!expediente_id || !diente_numero || !estado) {
      return res.status(400).json({ error: 'Expediente ID, número de diente y estado son requeridos' });
    }

    try {
      console.log(`🦷 Actualizando diente ${diente_numero} para expediente ID: ${expediente_id}`);

      const result = await query(`
        INSERT INTO odontograma (
          expediente_id, appointment_id, tenant_id, diente_numero, estado, superficie, observaciones,
          fecha_registro, doctor_id, sucursal_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (expediente_id, diente_numero) 
        DO UPDATE SET 
          estado = EXCLUDED.estado,
          superficie = EXCLUDED.superficie,
          observaciones = EXCLUDED.observaciones,
          fecha_registro = EXCLUDED.fecha_registro,
          doctor_id = EXCLUDED.doctor_id,
          appointment_id = EXCLUDED.appointment_id,
          tenant_id = EXCLUDED.tenant_id
        RETURNING *
      `, [
        expediente_id,
        appointment_id || null,
        tenantId,
        diente_numero,
        estado,
        superficie,
        observaciones,
        fecha_registro || new Date().toISOString().split('T')[0],
        doctor_id,
        sucursalId
      ]);

      console.log(`✅ Diente ${diente_numero} actualizado en odontograma`);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error actualizando odontograma:', error);
      res.status(500).json({ error: error.message });
    }
  }));

  // Actualizar estado de diente existente
  app.put('/api/odontograma/:id', medicalAuth, ah(async (req, res) => {
    const { id } = req.params;
    const sucursalId = getSucursal(req);
    const tenantId = getTenantId(req);
    const { estado, superficie, observaciones, fecha_registro, doctor_id } = req.body;

    try {
      console.log(`📝 Actualizando entrada de odontograma ID: ${id}`);

      const result = await query(`
        UPDATE odontograma 
        SET estado = $1, superficie = $2, observaciones = $3, 
            fecha_registro = $4, doctor_id = $5
        WHERE id = $6 AND sucursal_id = $7 AND tenant_id = $8
        RETURNING *
      `, [estado, superficie, observaciones, fecha_registro, doctor_id, id, sucursalId, tenantId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Entrada de odontograma no encontrada' });
      }

      console.log(`✅ Entrada de odontograma actualizada: ID ${id}`);
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error actualizando entrada de odontograma:', error);
      res.status(500).json({ error: error.message });
    }
  }));

  // ============= RUTAS DE TRATAMIENTOS DENTALES =============

  // Crear tratamiento dental
  app.post('/api/tratamiento-dental', medicalAuth, ah(async (req, res) => {
    const sucursalId = getSucursal(req);
    const tenantId = getTenantId(req);
    const {
      expediente_id,
      appointment_id,
      fecha,
      diente_numero,
      procedimiento,
      descripcion,
      materiales_usados,
      duracion_minutos,
      costo,
      estado,
      observaciones,
      doctor_id
    } = req.body;

    if (!expediente_id || !procedimiento) {
      return res.status(400).json({ error: 'Expediente ID y procedimiento son requeridos' });
    }

    try {
      console.log(`🦷 Creando tratamiento dental para expediente ID: ${expediente_id}`);

      const result = await query(`
        INSERT INTO tratamientos_dentales (
          expediente_id, appointment_id, tenant_id, fecha, diente_numero, procedimiento, descripcion,
          materiales_usados, duracion_minutos, costo, estado, observaciones,
          doctor_id, sucursal_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *
      `, [
        expediente_id,
        appointment_id || null,
        tenantId,
        fecha || new Date().toISOString().split('T')[0],
        diente_numero,
        procedimiento,
        descripcion,
        materiales_usados,
        duracion_minutos,
        costo,
        estado || 'planificado',
        observaciones,
        doctor_id,
        sucursalId
      ]);

      console.log(`✅ Tratamiento dental creado: ID ${result.rows[0].id}`);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error creando tratamiento dental:', error);
      res.status(500).json({ error: error.message });
    }
  }));

  // Actualizar tratamiento dental
  app.put('/api/tratamiento-dental/:id', medicalAuth, ah(async (req, res) => {
    const { id } = req.params;
    const sucursalId = getSucursal(req);
    const tenantId = getTenantId(req);
    const updateFields = req.body;

    try {
      console.log(`📝 Actualizando tratamiento dental ID: ${id}`);

      const setClause = Object.keys(updateFields)
        .filter(key => key !== 'id' && key !== 'sucursal_id')
        .map((key, index) => `${key} = $${index + 1}`)
        .join(', ');

      const values = Object.keys(updateFields)
        .filter(key => key !== 'id' && key !== 'sucursal_id')
        .map(key => updateFields[key]);

      values.push(id, sucursalId);

      const result = await query(`
        UPDATE tratamientos_dentales 
        SET ${setClause}
        WHERE id = $${values.length - 1} AND sucursal_id = $${values.length}
        RETURNING *
      `, values);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Tratamiento dental no encontrado' });
      }

      console.log(`✅ Tratamiento dental actualizado: ID ${id}`);
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error actualizando tratamiento dental:', error);
      res.status(500).json({ error: error.message });
    }
  }));

  // Eliminar tratamiento dental
  app.delete('/api/tratamiento-dental/:id', medicalAuth, ah(async (req, res) => {
    const { id } = req.params;
    const sucursalId = getSucursal(req);
    const tenantId = getTenantId(req);

    try {
      console.log(`🗑️ Eliminando tratamiento dental ID: ${id}`);

      const result = await query(`
        DELETE FROM tratamientos_dentales 
        WHERE id = $1 AND sucursal_id = $2 AND tenant_id = $3
        RETURNING id
      `, [id, sucursalId, tenantId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Tratamiento dental no encontrado' });
      }

      console.log(`✅ Tratamiento dental eliminado: ID ${id}`);
      res.json({ message: 'Tratamiento dental eliminado exitosamente' });
    } catch (error) {
      console.error('Error eliminando tratamiento dental:', error);
      res.status(500).json({ error: error.message });
    }
  }));

  // ============= RUTAS DE CONSENTIMIENTOS INFORMADOS =============

  // Crear consentimiento informado
  app.post('/api/consentimiento-informado', medicalAuth, ah(async (req, res) => {
    const sucursalId = getSucursal(req);
    const tenantId = getTenantId(req);
    const {
      expediente_id,
      appointment_id,
      tipo_tratamiento,
      descripcion_tratamiento,
      riesgos_beneficios,
      alternativas,
      costo_estimado,
      fecha_consentimiento,
      firma_paciente,
      firma_doctor,
      testigo_nombre,
      testigo_identificacion,
      doctor_id
    } = req.body;

    if (!expediente_id || !tipo_tratamiento) {
      return res.status(400).json({ error: 'Expediente ID y tipo de tratamiento son requeridos' });
    }

    try {
      console.log(`📄 Creando consentimiento informado para expediente ID: ${expediente_id}`);

      const result = await query(`
        INSERT INTO consentimientos_informados (
          expediente_id, appointment_id, tenant_id, tipo_tratamiento, descripcion_tratamiento, riesgos_beneficios,
          alternativas, costo_estimado, fecha_consentimiento, firma_paciente,
          firma_doctor, testigo_nombre, testigo_identificacion, doctor_id, sucursal_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *
      `, [
        expediente_id,
        appointment_id || null,
        tenantId,
        tipo_tratamiento,
        descripcion_tratamiento,
        riesgos_beneficios,
        alternativas,
        costo_estimado,
        fecha_consentimiento || new Date().toISOString().split('T')[0],
        firma_paciente || false,
        firma_doctor || false,
        testigo_nombre,
        testigo_identificacion,
        doctor_id,
        sucursalId
      ]);

      console.log(`✅ Consentimiento informado creado: ID ${result.rows[0].id}`);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error creando consentimiento informado:', error);
      res.status(500).json({ error: error.message });
    }
  }));

  // Actualizar firmas de consentimiento
  app.put('/api/consentimiento-informado/:id/firmas', medicalAuth, ah(async (req, res) => {
    const { id } = req.params;
    const sucursalId = getSucursal(req);
    const tenantId = getTenantId(req);
    const { firma_paciente, firma_doctor } = req.body;

    try {
      console.log(`✍️ Actualizando firmas del consentimiento ID: ${id}`);

      const result = await query(`
        UPDATE consentimientos_informados 
        SET firma_paciente = $1, firma_doctor = $2
        WHERE id = $3 AND sucursal_id = $4 AND tenant_id = $5
        RETURNING *
      `, [firma_paciente, firma_doctor, id, sucursalId, tenantId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Consentimiento informado no encontrado' });
      }

      console.log(`✅ Firmas del consentimiento actualizadas: ID ${id}`);
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error actualizando firmas del consentimiento:', error);
      res.status(500).json({ error: error.message });
    }
  }));

  // ============= RUTAS DE DOCUMENTOS Y RADIOGRAFÍAS =============

  // Subir documento o radiografía
  app.post('/api/documento-radiografia', medicalAuth, ah(async (req, res) => {
    const sucursalId = getSucursal(req);
    const tenantId = getTenantId(req);
    const {
      expediente_id,
      appointment_id,
      tipo,
      nombre,
      descripcion,
      fecha_toma,
      datos_base64,
      url,
      doctor_id
    } = req.body;

    if (!expediente_id || !nombre || !tipo) {
      return res.status(400).json({ error: 'Expediente ID, nombre y tipo son requeridos' });
    }

    if (!url && !datos_base64) {
      return res.status(400).json({ error: 'URL o datos base64 son requeridos' });
    }

    try {
      console.log(`📸 Subiendo ${tipo}: ${nombre} para expediente ID: ${expediente_id}`);

      // Limitar tamaño de base64 (aproximadamente 10MB)
      if (datos_base64 && datos_base64.length > 14000000) {
        return res.status(400).json({ error: 'Archivo demasiado grande (máximo 10MB)' });
      }

      const result = await query(`
        INSERT INTO documentos_radiografias (
          expediente_id, appointment_id, tenant_id, tipo, nombre, descripcion, fecha_toma,
          datos_base64, url, doctor_id, sucursal_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id, expediente_id, appointment_id, tenant_id, tipo, nombre, descripcion, fecha_toma, doctor_id, sucursal_id, created_at
      `, [
        expediente_id,
        appointment_id || null,
        tenantId,
        tipo,
        nombre,
        descripcion,
        fecha_toma || new Date().toISOString().split('T')[0],
        datos_base64,
        url,
        doctor_id,
        sucursalId
      ]);

      console.log(`✅ ${tipo} subido: ID ${result.rows[0].id}`);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error subiendo documento/radiografía:', error);
      res.status(500).json({ error: error.message });
    }
  }));

  // Descargar documento o radiografía
  app.get('/api/documento-radiografia/:id/download', medicalAuth, ah(async (req, res) => {
    const { id } = req.params;
    const sucursalId = getSucursal(req);
    const tenantId = getTenantId(req);

    try {
      console.log(`📥 Descargando documento/radiografía ID: ${id}`);

      const result = await query(`
        SELECT nombre, tipo, datos_base64
        FROM documentos_radiografias 
        WHERE id = $1 AND sucursal_id = $2 AND tenant_id = $3
      `, [id, sucursalId, tenantId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Documento no encontrado' });
      }

      const documento = result.rows[0];
      
      if (!documento.datos_base64) {
        return res.status(404).json({ error: 'Datos del documento no disponibles' });
      }

      // Extraer datos base64
      const base64Data = documento.datos_base64.split(',')[1] || documento.datos_base64;
      const buffer = Buffer.from(base64Data, 'base64');

      res.setHeader('Content-Type', documento.tipo || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${documento.nombre}"`);
      res.send(buffer);

      console.log(`✅ Documento descargado: ${documento.nombre}`);
    } catch (error) {
      console.error('Error descargando documento:', error);
      res.status(500).json({ error: error.message });
    }
  }));

  // Eliminar documento o radiografía
  app.delete('/api/documento-radiografia/:id', medicalAuth, ah(async (req, res) => {
    const { id } = req.params;
    const sucursalId = getSucursal(req);
    const tenantId = getTenantId(req);

    try {
      console.log(`🗑️ Eliminando documento/radiografía ID: ${id}`);

      const result = await query(`
        DELETE FROM documentos_radiografias 
        WHERE id = $1 AND sucursal_id = $2
        RETURNING id
      `, [id, sucursalId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Documento no encontrado' });
      }

      console.log(`✅ Documento eliminado: ID ${id}`);
      res.json({ message: 'Documento eliminado exitosamente' });
    } catch (error) {
      console.error('Error eliminando documento:', error);
      res.status(500).json({ error: error.message });
    }
  }));

  // ============= RUTAS DE BÚSQUEDA Y ESTADÍSTICAS =============

  // Buscar pacientes
  app.get('/api/expediente-medico/buscar-pacientes', medicalAuth, ah(async (req, res) => {
    const { q: searchQuery } = req.query;
    const sucursalId = getSucursal(req);
    const tenantId = getTenantId(req);

    if (!searchQuery || searchQuery.length < 2) {
      return res.json([]);
    }

    try {
      const result = await query(`
        SELECT id, paciente_id, nombre_paciente, telefono, email, edad, created_at
        FROM expedientes_medicos 
        WHERE sucursal_id = $1 AND tenant_id = $2
        AND (LOWER(nombre_paciente) LIKE LOWER($3) OR telefono LIKE $3)
        ORDER BY nombre_paciente
        LIMIT 20
      `, [sucursalId, tenantId, `%${searchQuery}%`]);

      res.json(result.rows);
    } catch (error) {
      console.error('Error buscando pacientes:', error);
      res.status(500).json({ error: error.message });
    }
  }));

  // Obtener estadísticas del expediente médico
  app.get('/api/expediente-medico/estadisticas', medicalAuth, ah(async (req, res) => {
    const sucursalId = getSucursal(req);
    const tenantId = getTenantId(req);

    try {
      const stats = await query(`
        SELECT 
          COUNT(DISTINCT e.id) as total_expedientes,
          COUNT(h.id) as total_historias,
          COUNT(t.id) as total_tratamientos,
          COUNT(c.id) as total_consentimientos,
          COUNT(d.id) as total_documentos
        FROM expedientes_medicos e
        LEFT JOIN historia_clinica_dental h ON e.id = h.expediente_id
        LEFT JOIN tratamientos_dentales t ON e.id = t.expediente_id
        LEFT JOIN consentimientos_informados c ON e.id = c.expediente_id
        LEFT JOIN documentos_radiografias d ON e.id = d.expediente_id
        WHERE e.sucursal_id = $1 AND e.tenant_id = $2
      `, [sucursalId, tenantId]);

      const tratamientosRecientes = await query(`
        SELECT COUNT(*) as tratamientos_ultima_semana
        FROM tratamientos_dentales 
        WHERE sucursal_id = $1 AND tenant_id = $2
        AND fecha >= CURRENT_DATE - INTERVAL '7 days'
      `, [sucursalId, tenantId]);

      const odontogramaStats = await query(`
        SELECT 
          estado,
          COUNT(*) as cantidad
        FROM odontograma 
        WHERE sucursal_id = $1 AND tenant_id = $2
        GROUP BY estado
        ORDER BY cantidad DESC
      `, [sucursalId, tenantId]);

      res.json({
        ...stats.rows[0],
        tratamientos_ultima_semana: tratamientosRecientes.rows[0].tratamientos_ultima_semana,
        estadisticas_odontograma: odontogramaStats.rows
      });
    } catch (error) {
      console.error('Error obteniendo estadísticas:', error);
      res.status(500).json({ error: error.message });
    }
  }));

  console.log('✅ Rutas del expediente médico dental configuradas');
}

// Exportar las funciones principales
module.exports = {
  createMedicalRecordTables,
  setupMedicalRecordRoutes,
  getSucursal,
  getTenantId,
  ah
};
