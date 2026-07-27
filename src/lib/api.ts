// Configuración de la API
const API_BASE = import.meta.env.VITE_API_BASE || 'https://localhost:5173/';
const USE_MELISSA = import.meta.env.VITE_USE_MELISSA === 'true';
const AUTH_TOKEN_KEY = 'dentalux_auth_token';

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
  
  let token = '';
  try { token = localStorage.getItem(AUTH_TOKEN_KEY) || ''; } catch {}

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'x-sucursal': currentSucursal,
    ...(options.headers || {}),
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch {}
      window.dispatchEvent(new CustomEvent('dentalux:auth-expired'));
    }

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
  database: USE_MELISSA ? 'MELISSA-APP-DB' : 'dentalux-db',
  sucursalActual: currentSucursal,
  timestamp: new Date().toISOString()
});

export const testSucursalAPI = async () => {
  try {
    const url = buildApiUrl('/health');
    const response = await fetch(url, {
      headers: {
        'x-sucursal': currentSucursal,
        ...(localStorage.getItem(AUTH_TOKEN_KEY) ? { Authorization: `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` } : {})
      }
    });
    return { ok: response.ok, status: response.status, url };
  } catch (error) {
    console.error('Test API failed:', error);
    return { ok: false, status: 0, url: API_BASE };
  }
};


// ===================== Empresas =====================
export const fetchCompanies = () => api('/companies');
export const createCompany = (data: unknown) => api('/companies', { method: 'POST', body: JSON.stringify(data) });
export const updateCompany = (id: string, data: unknown) => api(`/companies/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const activateCompany = (id: string) => api(`/companies/${id}/activate`, { method: 'PATCH' });
export const suspendCompany = (id: string) => api(`/companies/${id}/suspend`, { method: 'PATCH' });
