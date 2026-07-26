// backend/ai/assistant.js
// Asistente con acceso a funciones de disponibilidad real y base de conocimiento Dentalux

const fs = require("fs");
const path = require("path");

const DEFAULT_MODEL = process.env.AI_MODEL || "gpt-3.5-turbo";
const MAX_TOOL_STEPS = 3;

let EXTERNAL_FNS = {};

// ---------- CATÁLOGO DINÁMICO (TRATAMIENTOS) ----------
function loadCatalog() {
  try {
    const jsonPath = process.env.TREATMENTS_PATH ||
      path.resolve(__dirname, "tratamientos.json");
    const raw = fs.readFileSync(jsonPath, "utf8");
    const catalog = JSON.parse(raw);
    return Object.entries(catalog)
      .map(([id, item]) => ({
        id,
        nombre: String(item.nombre || id),
        descripcion: String(item.descripcion || "Tratamiento dental según diagnóstico."),
        costo: String(item.costo || "Variable"),
        nota: String(item.nota || "El precio puede variar según valoración y complejidad.")
      }))
      .filter(x => !/^=+/.test(x.nombre) && x.nombre.length > 2);
  } catch (e) {
    console.error("[assistant] No se pudo cargar tratamientos.json:", e?.message || e);
    return [];
  }
}

let CATALOGO = loadCatalog();

// ---------- BASE DE CONOCIMIENTO DENTALUX ----------
function loadKnowledgeBase() {
  try {
    const jsonPath = process.env.KNOWLEDGE_PATH ||
      path.resolve(__dirname, "dentalux-knowledge.json");
    const raw = fs.readFileSync(jsonPath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    console.error("[assistant] No se pudo cargar dentalux-knowledge.json:", e?.message || e);
    return null;
  }
}

let KNOWLEDGE_BASE = loadKnowledgeBase();

function refreshCatalog() {
  CATALOGO = loadCatalog();
  KNOWLEDGE_BASE = loadKnowledgeBase();
  return CATALOGO.length;
}

// ---------- Utils ----------
function safeJson(s) {
  if (!s || typeof s !== "string") return null;
  try {
    const cleaned = s.trim().replace(/^```json\s*/i, "").replace(/```$/i, "");
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function normalizeButtons(btns) {
  if (!Array.isArray(btns)) return null;
  return btns.slice(0, 3).map(b => ({
    id: String(b.id || "AGENDAR_HOY").slice(0, 64),
    title: String(b.title || "Agendar").slice(0, 20)
  }));
}

// ---------- BÚSQUEDA EN BASE DE CONOCIMIENTO ----------
function searchKnowledge(query) {
  if (!KNOWLEDGE_BASE) return null;
  const q = (query || "").toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 1. FAQs
  for (const category of Object.keys(KNOWLEDGE_BASE.faqs || {})) {
    for (const faq of KNOWLEDGE_BASE.faqs[category] || []) {
      const pregunta = (faq.pregunta || "").toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (pregunta.includes(q) || q.includes(pregunta.substring(0, 15))) {
        return { type: 'faq', category, data: faq };
      }
    }
  }

  // 2. Sucursales
  if (/(direccion|ubicacion|donde|como llegar|mapa)/i.test(q)) {
    const sucursal = detectSucursalInText(query) || 'victoria';
    return { type: 'sucursal', data: KNOWLEDGE_BASE.sucursales[sucursal] };
  }

  // 3. Horarios
  if (/(horario|hora|abre|cierra|atiende)/i.test(q)) {
    const sucursal = detectSucursalInText(query) || 'ambas';
    if (sucursal === 'ambas') {
      return {
        type: 'horarios',
        data: {
          victoria: KNOWLEDGE_BASE.sucursales.victoria.horarios,
          condesa: KNOWLEDGE_BASE.sucursales.condesa.horarios
        }
      };
    }
    return { type: 'horarios', data: KNOWLEDGE_BASE.sucursales[sucursal].horarios };
  }

  // 4. Contacto
  if (/(telefono|whatsapp|contacto|correo|email|pagina\s*web|sitio\s*web|website|facebook|instagram|redes)/i.test(q)) {
    return { type: 'contacto', data: KNOWLEDGE_BASE.contacto_general };
  }

  // 5. Promociones
  if (/(promocion|oferta|descuento|paquete)/i.test(q)) {
    return { type: 'promociones', data: KNOWLEDGE_BASE.promociones };
  }

  // 6. Tips
  if (/(cepill|hilo|enjuague|cuidado|higiene|prevencion)/i.test(q)) {
    return { type: 'tips', data: KNOWLEDGE_BASE.tips_salud_dental };
  }

  // 7. Clínica
  if (/(mision|vision|historia|valores|experiencia|fundacion)/i.test(q)) {
    return { type: 'clinica', data: KNOWLEDGE_BASE.clinica };
  }

  return null;
}

// ---------- FORMATEAR RESPUESTA DE BÚSQUEDA ----------
function formatKnowledgeResponse(result) {
  if (!result) return null;

  switch (result.type) {
    case 'faq':
      return {
        text: `**${result.data.pregunta}**\n\n${result.data.respuesta}`,
        buttons: [
          { id: "OTRA_PREGUNTA", title: "Otra pregunta" },
          { id: "AGENDAR_HOY", title: "Agendar" }
        ]
      };

    case 'sucursal': {
      const suc = result.data;
      return {
        text:
          `📍 **${suc.nombre}**\n\n` +
          `**Dirección:** ${suc.direccion}\n` +
          `${suc.ciudad}, ${suc.estado} ${suc.codigo_postal}\n\n` +
          `**Referencias:** ${suc.referencias}\n\n` +
          `**Horarios:**\n` +
          `• Lunes a Viernes: ${suc.horarios.lunes_viernes}\n` +
          `• Sábados: ${suc.horarios.sabado}\n` +
          `• Domingos: ${suc.horarios.domingo}\n\n` +
          `📞 **Contacto:** ${suc.contacto.whatsapp}\n` +
          `📧 **Email:** ${suc.contacto.email}\n\n` +
          `🗺️ Ver en mapa: ${suc.google_maps}`,
        buttons: [
          { id: "AGENDAR_HOY", title: "Agendar" },
          { id: "OTRA_SUCURSAL", title: "Otra sucursal" }
        ]
      };
    }

    case 'horarios':
      if (result.data.victoria && result.data.condesa) {
        return {
          text:
            `🕐 **Horarios Dentalux**\n\n` +
            `**Victoria:**\n` +
            `• Lunes a Viernes: ${result.data.victoria.lunes_viernes}\n` +
            `• Sábados: ${result.data.victoria.sabado}\n\n` +
            `**Condesa:**\n` +
            `• Lunes a Viernes: ${result.data.condesa.lunes_viernes}\n` +
            `• Sábados: ${result.data.condesa.sabado}\n\n` +
            `Domingos: Cerrado`,
          buttons: [
            { id: "AGENDAR_HOY", title: "Agendar" },
            { id: "VER_DISPONIBILIDAD", title: "Ver disponibilidad" }
          ]
        };
      }
      return {
        text:
          `🕐 **Horarios:**\n` +
          `• Lunes a Viernes: ${result.data.lunes_viernes}\n` +
          `• Sábados: ${result.data.sabado}\n` +
          `• Domingos: ${result.data.domingo}`,
        buttons: [{ id: "AGENDAR_HOY", title: "Agendar" }]
      };

    case 'contacto': {
      const d = result.data;
      let contactText = `📞 **Contacto Dentalux**\n\n`;
      contactText += `**WhatsApp Victoria:** ${d.whatsapp_victoria}\n`;
      contactText += `**WhatsApp Condesa:** ${d.whatsapp_condesa}\n`;
      contactText += `**Administrativo:** ${d.administrativo}\n\n`;
      contactText += `📧 **Emails:**\n`;
      contactText += `• General: ${d.email_general}\n`;
      contactText += `• Quejas: ${d.email_quejas}\n\n`;
      contactText += `🌐 **Página Web:** ${d.sitio_web}\n`;
      contactText += `📘 **Facebook:** ${d.facebook}`;
      return {
        text: contactText,
        buttons: [
          { id: "AGENDAR_HOY", title: "Agendar" },
          { id: "INFORMACION", title: "Más info" }
        ]
      };
    }

    case 'promociones': {
      const promos = (result.data || []).slice(0, 3).map(p =>
        `🎁 **${p.nombre}**\n${p.descripcion}\n💰 $${p.precio}${p.ahorro_porcentaje ? ` (${p.ahorro_porcentaje}% ahorro)` : ''}`
      ).join('\n\n');
      return {
        text: `**🎉 Promociones Vigentes:**\n\n${promos}\n\n¿Te interesa alguna promoción?`,
        buttons: [
          { id: "AGENDAR_HOY", title: "Agendar" },
          { id: "MAS_PROMOCIONES", title: "Más promos" }
        ]
      };
    }

    case 'tips':
      return {
        text:
          `🦷 **Tips de Salud Dental**\n\n` +
          `**Cepillado correcto:**\n${result.data.cepillado.descripcion}\n` +
          `• Duración: ${result.data.cepillado.duracion}\n` +
          `• Frecuencia: ${result.data.cepillado.frecuencia}\n\n` +
          `**Hilo dental:**\n${result.data.hilo_dental.tecnica}\n\n` +
          `**Enjuague:**\n${result.data.enjuague.descripcion}`,
        buttons: [
          { id: "MAS_TIPS", title: "Más tips" },
          { id: "AGENDAR_LIMPIEZA", title: "Agendar limpieza" }
        ]
      };

    case 'clinica':
      return {
        text:
          `**Clínica Dentalux**\n\n` +
          `📅 Fundada en ${result.data.fundacion}\n` +
          `👥 ${result.data.anos_experiencia} años de experiencia\n` +
          `🏆 ${result.data.logros}\n\n` +
          `**Misión:**\n${result.data.mision}\n\n` +
          `**Visión:**\n${result.data.vision}`,
        buttons: [
          { id: "AGENDAR_HOY", title: "Agendar" },
          { id: "VER_EQUIPO", title: "Ver equipo" }
        ]
      };

    default:
      return null;
  }
}

// ---------- Detección de sucursal en texto ----------
function detectSucursalInText(text) {
  const normalized = (text || '').toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (/\b(condesa)\b/.test(normalized)) return 'condesa';
  if (/\b(victoria)\b/.test(normalized)) return 'victoria';
  return null;
}

// ---------- Detección de fecha en texto ----------
function detectDateIntent(text) {
  const t = (text || '').toLowerCase();
  if (/\bhoy\b/.test(t)) return 'today';
  if (/\bma[ñn]ana\b/.test(t)) return 'tomorrow';

  const days = ['lunes', 'martes', 'miércoles', 'miercoles', 'jueves', 'viernes', 'sábado', 'sabado'];
  for (const day of days) {
    if (new RegExp(`\\b${day}\\b`).test(t)) return day;
  }
  if (/\d{1,2}[\/\-]\d{1,2}/.test(t)) return 'specific_date';
  return null;
}

// ---------- Calcular fecha según intención (helpers robustos TZ) ----------
function tzNow(timezone = 'America/Tijuana') {
  return new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
}
function isoDateTZ(d, timezone = 'America/Tijuana') {
  const y = d.toLocaleString('en-US', { timeZone: timezone, year:  'numeric' });
  const m = d.toLocaleString('en-US', { timeZone: timezone, month: '2-digit' });
  const day = d.toLocaleString('en-US', { timeZone: timezone, day:   '2-digit' });
  return `${y}-${m}-${day}`;
}
function getCurrentDateInTimezone(timezone = 'America/Tijuana') {
  try {
    return isoDateTZ(tzNow(timezone), timezone);
  } catch {
    const utc = new Date();
    return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth()+1).padStart(2,'0')}-${String(utc.getUTCDate()).padStart(2,'0')}`;
  }
}
// Empuja fechas “viejas” al año actual si por error vienen de otro año
function sanityForward(dateYmd, timezone = 'America/Tijuana') {
  const base = tzNow(timezone);
  const target = new Date(String(dateYmd) + 'T12:00:00');
  if (target.getFullYear() < base.getFullYear()) {
    target.setFullYear(base.getFullYear());
    return isoDateTZ(target, timezone);
  }
  return dateYmd;
}
// Normaliza cualquier fecha que llegue de la IA (p. ej., 2023 → año actual)
function normalizeClinicDate(ymd, tz = 'America/Tijuana') {
  if (!ymd) return isoDateTZ(tzNow(tz), tz);
  const d = new Date(String(ymd) + 'T12:00:00');
  const now = tzNow(tz);
  if (isNaN(d.getTime())) return isoDateTZ(now, tz);
  if (d.getFullYear() < now.getFullYear()) d.setFullYear(now.getFullYear());
  return isoDateTZ(d, tz);
}

// ---------- Helper para formatear fecha en español ----------
function formatDateMX(isoDate) {
  const date = new Date(isoDate + 'T00:00:00');
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const dayName = days[date.getDay()];
  const day = date.getDate();
  const monthName = months[date.getMonth()];
  return `${dayName} ${day} de ${monthName}`;
}

// ---------- Helper para mapear sucursales ----------
function mapToDisplaySucursal(s) {
  const SUCURSAL_DISPLAY = {
    'sucursal_1': 'Victoria',
    'sucursal_2': 'Condesa',
    'victoria': 'Victoria',
    'condesa': 'Condesa'
  };
  const key = (s || '').toLowerCase().trim();
  return SUCURSAL_DISPLAY[key] || s || 'Victoria';
}

// ---------- Respuestas rápidas contextuales ----------
function getQuickResponse(text, context = {}) {
  const t = (text || '').toLowerCase().trim();

  if (/^(s[ií]|claro|va|ok|sale|perfecto|correcto|exacto|adelante|de\s*acuerdo|yes|afirmativo)$/i.test(t)) {
    if (context.pendingAppointment) {
      return {
        text: "¡Perfecto! Para completar tu cita necesito:\n\n✅ Tu nombre completo\n✅ Confirmar la hora que prefieres\n\n¿Cuál es tu nombre?",
        buttons: []
      };
    }
    if (context.lastAvailableSlots && context.lastAvailableSlots.length > 0) {
      return {
        text: "¡Excelente! ¿Qué horario te viene mejor de los disponibles?",
        buttons: context.lastAvailableSlots.slice(0, 3).map(slot => ({
          id: `SELECT_SLOT_${slot.time}`,
          title: slot.time
        }))
      };
    }
    return {
      text: "¡Genial! ¿En qué puedo ayudarte?\n\n📅 Agendar cita\n💰 Ver precios\nℹ️ Información de tratamientos",
      buttons: [
        { id: "AGENDAR_HOY", title: "Agendar" },
        { id: "PRECIOS", title: "Precios" },
        { id: "INFORMACION", title: "Más info" }
      ]
    };
  }

  if (/^(no|nah|nel|gracias\s*no|no\s*gracias|nope)$/i.test(t)) {
    return {
      text: "Sin problema. ¿Prefieres otra fecha u hora, o te ayudo con otra cosa?",
      buttons: [
        { id: "OTRA_FECHA", title: "Otra fecha" },
        { id: "VER_HORARIOS", title: "Ver horarios" },
        { id: "INFORMACION", title: "Información" }
      ]
    };
  }

  if (/^(hola|buenos|buenas|hey|que\s*tal|qu[eé]\s*onda)$/i.test(t)) {
    const hour = tzNow(process.env.TZ || 'America/Tijuana').getHours();
    let greeting = "¡Hola!";
    if (hour < 12) greeting = "¡Buenos días!";
    else if (hour < 19) greeting = "¡Buenas tardes!";
    else greeting = "¡Buenas noches!";
    return {
      text: `${greeting} Soy el asistente de Dentalux. ¿Te ayudo a agendar una cita o tienes alguna pregunta sobre nuestros tratamientos? 🦷`,
      buttons: [
        { id: "AGENDAR_HOY", title: "Agendar" },
        { id: "PRECIOS", title: "Precios" },
        { id: "INFORMACION", title: "Información" }
      ]
    };
  }

  return null;
}

/* ================== NUEVO: mejoras de flujo sin romper lógica existente ================== */
function enhanceReplyWithContext(reply, itemName) {
  const base = reply || {};
  const ctx = Object.assign({}, base.contextUpdate, {
    pendingAppointment: true,
    lastTopic: itemName || 'cita'
  });
  return Object.assign({}, base, { contextUpdate: ctx });
}

function getQuickResponseEnhanced(text, context = {}) {
  const t = (text || '').toLowerCase().trim();
  if (/^(s[ií]|claro|va|ok|sale|perfecto|correcto|exacto|adelante|de\s*acuerdo|yes|afirmativo)$/i.test(t)) {
    if (context.pendingAppointment) {
      if (Array.isArray(context.lastAvailableSlots) && context.lastAvailableSlots.length > 0) {
        return {
          text: `¡Excelente! ¿Qué horario te viene mejor para tu ${context.lastTopic || "cita"}?`,
          buttons: context.lastAvailableSlots.slice(0, 3).map(slot => ({
            id: `SELECT_SLOT_${slot.time}`,
            title: slot.time
          }))
        };
      }
      return {
        text: `Perfecto, agendemos tu ${context.lastTopic || "cita"}. Para completar necesito:\n\n✅ Tu nombre completo\n✅ Confirmar la hora que prefieres\n\n¿Cuál es tu nombre?`,
        buttons: []
      };
    }
    if (context.lastTopic) {
      return {
        text: `Perfecto, continuemos con *${context.lastTopic}*. Para agendar necesito:\n\n✅ Tu nombre completo\n✅ Confirmar la hora que prefieres\n\n¿Cuál es tu nombre?`,
        buttons: []
      };
    }
  }
  return null;
}
/* ================== FIN DE MEJORAS ================== */

// ---------- Emparejamiento de tratamiento ----------
function matchTratamiento(userText) {
  const t = (userText || "").toLowerCase();

  let best = null;
  for (const item of CATALOGO) {
    const id = item.id.toLowerCase();
    const nombre = item.nombre.toLowerCase();
    if (t.includes(id) || t.includes(nombre)) {
      best = item;
      break;
    }
  }
  if (best) return best;

  const heur = [
    ["limpieza", ["limpieza","profilaxis"]],
    ["resina",   ["resina","caries"]],
    ["endodoncia", ["endodon","conducto"]],
    ["extracción", ["extraccion","extraer","quitar muela","cirugia de tercera"]],
    ["implante", ["implante"]],
    ["ortodoncia", ["ortodon","brackets","invisalign","alineadores"]],
    ["blanqueamiento", ["blanquea","blanco"]],
    ["consulta", ["consulta","valoracion","valoración","revisión"]],
    ["urgencia", ["urgenc","dolor","emergencia"]],
  ];

  for (const [label, keys] of heur) {
    if (keys.some(k => t.includes(k))) {
      const cand = CATALOGO.find(x => x.nombre.toLowerCase().includes(label));
      if (cand) return cand;
    }
  }
  return null;
}

// ---------- Plantilla de respuesta de tratamiento ----------
function buildTreatmentReply(item) {
  const costos = item.costo || "Variable";
  const nota = item.nota || "El precio puede variar según valoración y complejidad.";
  const desc = item.descripcion || "Tratamiento dental según diagnóstico.";
  const texto = `**${item.nombre}**\n${desc}\n\n**Costo:** ${costos}\n_${nota}_\n\n¿Te ayudo a agendar tu valoración?`;
  return { text: texto, buttons: [{ id: "AGENDAR_HOY", title: "Agendar" }] };
}

// ---------- OpenAI client ----------
function makeOpenAI() {
  let OpenAI;
  try { OpenAI = require("openai"); } catch {}
  const Client = OpenAI?.default || OpenAI;
  if (!Client) throw new Error("openai package not installed");
  return new Client({ apiKey: process.env.OPENAI_API_KEY });
}

async function runSimpleChatLoop({ client, model, messages, tools, functionsMap }) {
  const resp = await client.chat.completions.create({
    model,
    messages,
    tools: tools?.length ? tools : undefined,
    tool_choice: tools?.length ? "auto" : undefined,
    temperature: 0.3,
    max_tokens: 500
  });

  const msg = resp.choices?.[0]?.message || {};
  const content = (msg.content || "").trim();

  if (!content || content === '') {
    console.warn('⚠️ OpenAI devolvió respuesta vacía, usando fallback');
    return {
      text: "¿En qué más puedo ayudarte?",
      buttons: [
        { id: "AGENDAR_HOY", title: "Agendar" },
        { id: "INFORMACION", title: "Más info" }
      ]
    };
  }

  const parsed = safeJson(content);
  if (parsed && parsed.text && parsed.text.trim() !== '') {
    return { text: parsed.text.trim(), buttons: normalizeButtons(parsed.buttons) };
  }

  if (content && !content.includes('{') && !content.includes('"text"')) {
    return {
      text: content,
      buttons: [
        { id: "AGENDAR_HOY", title: "Agendar" },
        { id: "INFORMACION", title: "Más info" }
      ]
    };
  }

  console.warn('⚠️ No se pudo parsear respuesta de OpenAI, usando fallback final');
  return {
    text: "¿Te ayudo a agendar una cita o tienes alguna pregunta?",
    buttons: [
      { id: "AGENDAR_HOY", title: "Agendar" },
      { id: "PRECIOS", title: "Precios" },
      { id: "INFORMACION", title: "Info" }
    ]
  };
}

// ---------- Asistente principal ----------
async function generateAIReply(args = {}) {
  const { userText, phoneE164, context = {}, text, from, functions } = args;

  const USER_TEXT = (userText || text || "").trim();
  const PHONE_E164 = phoneE164 || from || "";
  EXTERNAL_FNS = functions || {};

  const conversationState = context.conversationState || 'idle';
  const stateData = context.stateData || {};
  const recentMessages = context.recentMessages || [];

  console.log('🧠 IA procesando mensaje completo:', {
    texto: USER_TEXT.slice(0, 50),
    estado: conversationState,
    datos: Object.keys(stateData),
    funciones_disponibles: Object.keys(EXTERNAL_FNS)
  });

  if (!USER_TEXT) {
    return {
      text: "¡Hola! Soy el asistente de Dentalux. ¿En qué puedo ayudarte hoy?",
      buttons: [
        { id: "AGENDAR_HOY", title: "Agendar cita" },
        { id: "PRECIOS", title: "Ver precios" },
        { id: "INFORMACION", title: "Información" }
      ]
    };
  }

  // RESPUESTAS RÁPIDAS
  const quick = getQuickResponse(USER_TEXT, {
    conversationState,
    stateData,
    lastAvailableSlots: stateData.lastSlots || []
  });
  if (quick) return quick;

  // BÚSQUEDA EN CONOCIMIENTO
  const knowledgeResult = searchKnowledge(USER_TEXT);
  if (knowledgeResult) {
    const formatted = formatKnowledgeResponse(knowledgeResult);
    if (formatted) {
      console.log('📚 RESPUESTA DESDE BASE DE CONOCIMIENTO:', knowledgeResult.type);
      return formatted;
    }
  }

  // PRECIOS por tratamiento
  if (/(precio|costo|cuanto|vale)/i.test(USER_TEXT)) {
    const item = matchTratamiento(USER_TEXT);
    if (item) {
      const costos = item.costo || "Variable";
      const nota = item.nota || "El precio puede variar según valoración y complejidad.";
      const desc = item.descripcion || "Tratamiento dental según diagnóstico.";
      return {
        text: `**${item.nombre}**\n${desc}\n\n**Costo:** ${costos}\n_${nota}_\n\n¿Te ayudo a agendar tu valoración?`,
        buttons: [
          { id: "AGENDAR_HOY", title: "Agendar hoy" },
          { id: "AGENDAR_MANANA", title: "Agendar mañana" }
        ]
      };
    }
    const destacados = CATALOGO.slice(0, 10).map(x => `• ${x.nombre} — ${x.costo}`).join("\n");
    return {
      text: `Te comparto costos orientativos:\n\n${destacados}\n\nSi me dices el tratamiento exacto, te doy el costo del catálogo.`,
      buttons: [
        { id: "AGENDAR_HOY", title: "Agendar" },
        { id: "INFORMACION", title: "Más info" }
      ]
    };
  }

  // OPENAI con herramientas
  if (process.env.OPENAI_API_KEY && KNOWLEDGE_BASE) {
    const clinicaInfo = `Clínica Dentalux - ${KNOWLEDGE_BASE.clinica.anos_experiencia} años de experiencia
Sucursales: Victoria (${KNOWLEDGE_BASE.sucursales.victoria.contacto.whatsapp}) y Condesa (${KNOWLEDGE_BASE.sucursales.condesa.contacto.whatsapp})
Horarios: Lunes a Viernes ${KNOWLEDGE_BASE.sucursales.victoria.horarios.lunes_viernes}, Sábados ${KNOWLEDGE_BASE.sucursales.victoria.sabado}
Promociones actuales: ${KNOWLEDGE_BASE.promociones.map(p => p.nombre).join(', ')}`;

    const system = `Eres el asistente virtual COMPLETO de Dentalux.
- Usa SIEMPRE las funciones para consultar disponibilidad y crear citas.
- Formato de fecha: YYYY-MM-DD en la zona horaria de Tijuana (no UTC).
- Si el usuario dice "mañana" u otro día, calcula la fecha local correcta.

Funciones:
1. getAvailableSlots(date, sucursalId)
2. checkAvailability(date, time, sucursalId)
3. aiCreateAppointment(date, time, name, phone, sucursalId)
4. requestAdvisorHandoff(patientName)
5. suggestAlternativeDates(date, sucursalId)
6. formatAvailabilityText(slots, date)

Responde SIEMPRE con JSON válido:
{
  "text": "tu respuesta natural",
  "buttons": [{"id":"...","title":"..."}],
  "appointmentCreated": true/false,
  "appointmentId": número
}

Contexto:
- Estado: ${conversationState}
- Datos: ${JSON.stringify(stateData)}
- Mensajes: ${recentMessages.map(m => `${m.role}: ${m.text}`).join(' | ')}

Información clínica:
${clinicaInfo}`;

    const promptUser = `Usuario dice: "${USER_TEXT}"
Si necesitas consultar disponibilidad, crea o verifica citas, usa las funciones. Devuelve JSON válido.`;

    try {
      const client = makeOpenAI();

      const tools = [
        {
          type: "function",
          function: {
            name: "getAvailableSlots",
            description: "Consulta horarios disponibles para una fecha y sucursal",
            parameters: {
              type: "object",
              properties: {
                date: { type: "string", description: "YYYY-MM-DD (TZ local)" },
                sucursalId: { type: "string", description: "victoria o condesa" }
              },
              required: ["date", "sucursalId"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "aiCreateAppointment",
            description: "Crea una nueva cita",
            parameters: {
              type: "object",
              properties: {
                date: { type: "string", description: "YYYY-MM-DD (TZ local)" },
                time: { type: "string", description: "HH:MM" },
                name: { type: "string" },
                phone: { type: "string" },
                sucursalId: { type: "string" }
              },
              required: ["date", "time", "name", "phone", "sucursalId"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "checkAvailability",
            description: "Verifica disponibilidad en horario específico",
            parameters: {
              type: "object",
              properties: {
                date: { type: "string", description: "YYYY-MM-DD (TZ local)" },
                time: { type: "string", description: "HH:MM" },
                sucursalId: { type: "string" }
              },
              required: ["date", "time", "sucursalId"]
            }
          }
        }
      ];

      const result = await runAdvancedChatLoop({
        client,
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: promptUser }
        ],
        tools,
        functionsMap: EXTERNAL_FNS
      });

      if (result && result.text && result.text.trim() !== '') {
        return result;
      }
    } catch (e) {
      console.error("[assistant] Error OpenAI:", e?.message || e);
    }
  }

  // FALLBACK
  return {
    text: "Hola, soy el asistente de Dentalux. ¿Te ayudo a agendar una cita o tienes alguna pregunta?",
    buttons: [
      { id: "AGENDAR_HOY", title: "Agendar" },
      { id: "PRECIOS", title: "Precios" },
      { id: "INFORMACION", title: "Info" }
    ]
  };
}

// ---------- Loop avanzado con NORMALIZACIÓN DE FECHAS ----------
async function runAdvancedChatLoop({ client, model, messages, tools, functionsMap }) {
  let currentMessages = [...messages];
  let maxIterations = 3;
  let iteration = 0;
  const TIMEZONE = process.env.TZ || process.env.DEFAULT_TZ || 'America/Tijuana';

  // Normaliza args ANTES de llamar a tus funciones reales
  function normalizeToolArgs(name, args) {
    const a = Object.assign({}, args || {});
    if (a.date) a.date = normalizeClinicDate(a.date, TIMEZONE);
    if (a.targetDate) a.date = normalizeClinicDate(a.targetDate, TIMEZONE);
    if (a.time) a.time = String(a.time).slice(0,5); // HH:MM
    if (!a.sucursalId && a.sucursal_id) a.sucursalId = a.sucursal_id;
    if (a.sucursalId) a.sucursalId = String(a.sucursalId).toLowerCase().includes('cond') ? 'condesa' : 'victoria';
    return a;
  }

  while (iteration < maxIterations) {
    const resp = await client.chat.completions.create({
      model,
      messages: currentMessages,
      tools: tools?.length ? tools : undefined,
      tool_choice: tools?.length ? "auto" : undefined,
      temperature: 0.3,
      max_tokens: 800
    });

    const msg = resp.choices?.[0]?.message || {};

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      currentMessages.push(msg);

      for (const toolCall of msg.tool_calls) {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments || "{}");
        const normalizedArgs = normalizeToolArgs(functionName, functionArgs);

        console.log(`🔧 IA llamando función: ${functionName}`, normalizedArgs);

        let result;
        if (functionsMap[functionName]) {
          try {
            result = await functionsMap[functionName](normalizedArgs);
          } catch (error) {
            result = { error: error.message };
          }
        } else {
          result = { error: `Función ${functionName} no disponible` };
        }

        currentMessages.push({
          tool_call_id: toolCall.id,
          role: "tool",
          content: JSON.stringify(result)
        });
      }

      iteration++;
      continue;
    }

    // Respuesta final
    const content = (msg.content || "").trim();

    if (!content) {
      return {
        text: "¿En qué más puedo ayudarte?",
        buttons: [
          { id: "AGENDAR_HOY", title: "Agendar" },
          { id: "PRECIOS", title: "Precios" }
        ]
      };
    }

    const parsed = safeJson(content);
    if (parsed && parsed.text) {
      return {
        text: parsed.text.trim(),
        buttons: normalizeButtons(parsed.buttons),
        appointmentCreated: parsed.appointmentCreated || false,
        appointmentId: parsed.appointmentId || null,
        confirmationText: parsed.confirmationText || null
      };
    }

    return {
      text: content,
      buttons: [
        { id: "AGENDAR_HOY", title: "Agendar" },
        { id: "INFORMACION", title: "Más info" }
      ]
    };
  }

  return {
    text: "¿Te ayudo a agendar una cita o tienes alguna pregunta?",
    buttons: [
      { id: "AGENDAR_HOY", title: "Agendar" },
      { id: "PRECIOS", title: "Precios" }
    ]
  };
}

module.exports = { generateAIReply, refreshCatalog };