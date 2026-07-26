// Configuración de la API
const API_BASE = import.meta.env.VITE_API_BASE || 'https://dentalux-sucs.onrender.com';
const USE_MELISSA = import.meta.env.VITE_USE_MELISSA === 'true';

// Identificador de app (para separar DB por app en el backend)
// En Render (Static Site):
//  - App1: VITE_APP_ID=app1
//  - App2: VITE_APP_ID=app2
const APP_ID = String(import.meta.env.VITE_APP_ID || 'app1').toLowerCase().trim();

let currentSucursal = 'sucursal_1';

// Intenta cargar de localStorage de forma segura
try {
  const stored = localStorage.getItem('sucursal_actual');
  if (stored) currentSucursal = stored;
} catch (e) {
  console.warn('No se pudo acceder a localStorage');
}

export const getSucursalActual = () => currentSucursal;

export const setSucursal = (sucursalId: string) => {
  currentSucursal = sucursalId;
  try {
    localStorage.setItem('sucursal_actual', sucursalId);
  } catch (e) {
    console.warn('No se pudo guardar en localStorage');
  }
};

export async function api(endpoint: string, options: RequestInit = {}) {
  let normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  // Si USE_MELISSA es true, agregar prefijo /melissa
  if (USE_MELISSA) {
    if (!normalizedEndpoint.startsWith('/api/')) {
      normalizedEndpoint = `/api/melissa${normalizedEndpoint}`;
    } else if (normalizedEndpoint.startsWith('/api/') && !normalizedEndpoint.startsWith('/api/melissa/')) {
      normalizedEndpoint = normalizedEndpoint.replace('/api/', '/api/melissa/');
    }
  } else {
    // NO usar melissa, endpoints normales
    if (!normalizedEndpoint.startsWith('/api/')) {
      normalizedEndpoint = `/api${normalizedEndpoint}`;
    }
  }

  const url = `${API_BASE}${normalizedEndpoint}`;

  console.log(`🔍 API Request ${USE_MELISSA ? '(MELISSA)' : '(DENTALUX)'}:`, url);

  // IMPORTANTE:
  // - options.headers primero (por compatibilidad)
  // - y al final imponemos x-sucursal y x-app SIEMPRE
  //   para que cada app quede amarrada a su DB.
  const headers: HeadersInit = {
    ...(options.headers || {}),
    'Content-Type': 'application/json',
    'x-sucursal': currentSucursal,
    'x-app': APP_ID,
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('❌ API Error:', url, response.status, errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    // ✅ Si es 204 No Content (muy común en DELETE)
    if (response.status === 204) return null;

    // ✅ Leer body de forma segura
    const text = await response.text().catch(() => '');
    if (!text) return null;

    // ✅ Si trae JSON lo parseamos, si no devolvemos texto
    try {
      return JSON.parse(text);
    } catch {
      return text as any;
    }
  } catch (error) {
    console.error('❌ Fetch Error:', url, error);
    throw error;
  }
}

export const buildApiUrl = (endpoint: string): string => {
  let normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  if (USE_MELISSA) {
    if (!normalizedEndpoint.startsWith('/api/')) {
      normalizedEndpoint = `/api/melissa${normalizedEndpoint}`;
    } else if (normalizedEndpoint.startsWith('/api/') && !normalizedEndpoint.startsWith('/api/melissa/')) {
      normalizedEndpoint = normalizedEndpoint.replace('/api/', '/api/melissa/');
    }
  } else {
    if (!normalizedEndpoint.startsWith('/api/')) {
      normalizedEndpoint = `/api${normalizedEndpoint}`;
    }
  }
  return `${API_BASE}${normalizedEndpoint}`;
};

export const debugSucursalConfig = () => ({
  API_BASE,
  USE_MELISSA,
  APP_ID,
  database: USE_MELISSA ? 'MELISSA-APP-DB' : 'dentalux-db',
  sucursalActual: currentSucursal,
  timestamp: new Date().toISOString(),
});

export const testSucursalAPI = async () => {
  try {
    const url = buildApiUrl('/health');
    const response = await fetch(url, {
      headers: {
        'x-sucursal': currentSucursal,
        'x-app': APP_ID,
      },
    });
    return { ok: response.ok, status: response.status, url, app: APP_ID, sucursal: currentSucursal };
  } catch (error) {
    console.error('Test API failed:', error);
    return { ok: false, status: 0, url: API_BASE, app: APP_ID, sucursal: currentSucursal };
  }
};
