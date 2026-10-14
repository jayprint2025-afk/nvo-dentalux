// Browser cache identity only. Authorization is always enforced by the server.
export function sessionScope(): string {
  try {
    const token = localStorage.getItem('dentalux_auth_token') || '';
    const part = token.split('.')[1];
    if (!part) return 'unauthenticated';
    const raw = part.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(raw.padEnd(Math.ceil(raw.length / 4) * 4, '=')));
    const tenant = payload.tenantId || payload.tenant_id;
    if (!tenant) return 'unauthenticated';
    const branch = localStorage.getItem('sucursal_actual') || localStorage.getItem('dentalux_sucursal_actual') || 'sucursal_1';
    return `${tenant}:${payload.userId || payload.sub || payload.id || 'session'}:${branch}`;
  } catch { return 'unauthenticated'; }
}
export function scopedStorageKey(key: string): string {
  return `cliniqone:${sessionScope()}:${key}`;
}
