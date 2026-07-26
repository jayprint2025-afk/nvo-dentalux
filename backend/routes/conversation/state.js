// backend/conversation/state.js
// Sistema centralizado de gestión de estado de conversaciones

const STATE_TYPES = Object.freeze({
  IDLE: 'idle',                     // Sin contexto activo
  VIEWING_AVAILABILITY: 'viewing',  // Consultando horarios
  SCHEDULING: 'scheduling',         // En proceso de agendar (esperando hora+nombre)
  CONFIRMING: 'confirming',         // Esperando confirmación de cita
  RELAY: 'relay',                   // Conversación con asesor humano
  ASKING_TREATMENT: 'treatment'     // Preguntando sobre tratamiento específico
});

const STATE_TIMEOUTS = {
  [STATE_TYPES.IDLE]: 30 * 60 * 1000,              // 30 min
  [STATE_TYPES.VIEWING_AVAILABILITY]: 5 * 60 * 1000, // 5 min
  [STATE_TYPES.SCHEDULING]: 10 * 60 * 1000,         // 10 min
  [STATE_TYPES.CONFIRMING]: 60 * 60 * 1000,         // 60 min
  [STATE_TYPES.RELAY]: Infinity,                    // Sin timeout
  [STATE_TYPES.ASKING_TREATMENT]: 5 * 60 * 1000     // 5 min
};

class ConversationState {
  constructor(phone) {
    this.phone = phone;
    this.type = STATE_TYPES.IDLE;
    this.data = {};
    this.lastUpdate = Date.now();
    this.history = [];
    this.metadata = {
      conversationStarted: Date.now(),
      stateChanges: 0
    };
  }

  /**
   * Actualiza el estado de la conversación
   */
  updateState(type, data = {}) {
    if (!Object.values(STATE_TYPES).includes(type)) {
      console.warn(`⚠️ Estado inválido: ${type}`);
      return;
    }

    const previousState = this.type;
    this.type = type;
    this.data = { ...this.data, ...data };
    this.lastUpdate = Date.now();
    this.metadata.stateChanges++;

    console.log(`🔄 CAMBIO DE ESTADO [${this.phone}]: ${previousState} → ${type}`, {
      newData: data,
      totalChanges: this.metadata.stateChanges
    });
  }

  /**
   * Agrega un mensaje al historial reciente
   */
  addMessage(role, text) {
    this.history.push({
      role,
      text: String(text).slice(0, 200), // Limitar longitud
      timestamp: Date.now()
    });

    // Mantener solo últimos 5 mensajes
    if (this.history.length > 5) {
      this.history.shift();
    }

    this.lastUpdate = Date.now();
  }

  /**
   * Verifica si el estado debe resetearse por timeout
   */
  shouldReset() {
    const timeout = STATE_TIMEOUTS[this.type] || (10 * 60 * 1000);
    const elapsed = Date.now() - this.lastUpdate;
    
    if (elapsed > timeout) {
      console.log(`⏰ TIMEOUT [${this.phone}]: ${this.type} (${Math.round(elapsed/1000)}s)`);
      return true;
    }
    
    return false;
  }

  /**
   * Obtiene el contexto completo para la IA
   */
  getContext() {
    return {
      state: this.type,
      data: this.data,
      recentMessages: this.history,
      metadata: this.metadata,
      timeInState: Date.now() - this.lastUpdate
    };
  }

  /**
   * Verifica si hay datos específicos
   */
  hasData(key) {
    return this.data.hasOwnProperty(key) && this.data[key] !== null && this.data[key] !== undefined;
  }

  /**
   * Obtiene un dato específico
   */
  getData(key, defaultValue = null) {
    return this.data[key] ?? defaultValue;
  }

  /**
   * Resetea el estado a IDLE
   */
  reset(reason = 'manual') {
    console.log(`🔄 RESET [${this.phone}]: ${this.type} → IDLE (${reason})`);
    
    this.type = STATE_TYPES.IDLE;
    this.data = {};
    this.lastUpdate = Date.now();
  }

  /**
   * Verifica si está en proceso de agendar
   */
  isScheduling() {
    return this.type === STATE_TYPES.SCHEDULING;
  }

  /**
   * Verifica si está consultando disponibilidad
   */
  isViewingAvailability() {
    return this.type === STATE_TYPES.VIEWING_AVAILABILITY;
  }

  /**
   * Verifica si está en relay con asesor
   */
  isInRelay() {
    return this.type === STATE_TYPES.RELAY;
  }

  /**
   * Verifica si está inactivo
   */
  isIdle() {
    return this.type === STATE_TYPES.IDLE;
  }

  /**
   * Obtiene resumen del estado (para debugging)
   */
  getSummary() {
    return {
      phone: this.phone,
      state: this.type,
      dataKeys: Object.keys(this.data),
      messageCount: this.history.length,
      lastUpdate: new Date(this.lastUpdate).toISOString(),
      timeInState: Math.round((Date.now() - this.lastUpdate) / 1000) + 's'
    };
  }
}

// Almacenamiento en memoria de estados
const conversationStates = new Map();

/**
 * Obtiene o crea el estado de una conversación
 */
function getConversationState(phone) {
  const normalizedPhone = String(phone).trim();
  
  if (!conversationStates.has(normalizedPhone)) {
    conversationStates.set(normalizedPhone, new ConversationState(normalizedPhone));
  }

  const state = conversationStates.get(normalizedPhone);

  // Auto-reset si pasó el timeout
  if (state.shouldReset()) {
    state.reset('timeout');
  }

  return state;
}

/**
 * Elimina el estado de una conversación
 */
function clearConversationState(phone) {
  const normalizedPhone = String(phone).trim();
  conversationStates.delete(normalizedPhone);
  console.log(`🗑️ Estado eliminado: ${normalizedPhone}`);
}

/**
 * Obtiene estadísticas generales
 */
function getStats() {
  const states = Array.from(conversationStates.values());
  
  return {
    totalConversations: states.length,
    byState: states.reduce((acc, s) => {
      acc[s.type] = (acc[s.type] || 0) + 1;
      return acc;
    }, {}),
    avgMessagesPerConversation: states.length > 0 
      ? (states.reduce((sum, s) => sum + s.history.length, 0) / states.length).toFixed(1)
      : 0
  };
}

/**
 * Limpieza periódica de estados inactivos
 */
function cleanupInactiveStates() {
  const now = Date.now();
  const maxInactivity = 60 * 60 * 1000; // 1 hora sin actividad
  
  let cleaned = 0;
  
  for (const [phone, state] of conversationStates.entries()) {
    if ((now - state.lastUpdate) > maxInactivity) {
      conversationStates.delete(phone);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 Limpieza: ${cleaned} estados inactivos eliminados`);
  }
  
  return cleaned;
}

// Ejecutar limpieza cada 30 minutos
setInterval(cleanupInactiveStates, 30 * 60 * 1000);

module.exports = {
  getConversationState,
  clearConversationState,
  getStats,
  cleanupInactiveStates,
  STATE_TYPES
};