// src/api/client.ts
import { api, buildApiUrl } from '../lib/api';

// helper para armar querystring limpio
function toQuery(params?: Record<string, any>) {
  if (!params) return '';
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    flat[k] = String(v);
  }
  const qs = new URLSearchParams(flat).toString();
  return qs ? `?${qs}` : '';
}

// GET JSON usando api(...)
export async function getJSON<T = unknown>(path: string, params?: Record<string, any>) {
  return api(`${path}${toQuery(params)}`) as Promise<T>;
}

// POST JSON usando api(...)
export async function postJSON<T = unknown>(path: string, body?: unknown, init?: RequestInit) {
  return api(path, { method: 'POST', json: body, ...(init || {}) }) as Promise<T>;
}

// PUT JSON usando api(...)
export async function putJSON<T = unknown>(path: string, body?: unknown, init?: RequestInit) {
  return api(path, { method: 'PUT', json: body, ...(init || {}) }) as Promise<T>;
}

// DELETE usando api(...)
export async function delJSON<T = unknown>(path: string, params?: Record<string, any>) {
  return api(`${path}${toQuery(params)}`, { method: 'DELETE' }) as Promise<T>;
}

// Abrir una ruta del backend en nueva pestaña (útil para /debug/*)
export function openInBackend(path: string) {
  window.open(buildApiUrl(path), '_blank');
}
