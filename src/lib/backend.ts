// src/lib/backend.ts
import { api, buildApiUrl } from './api';

// Ya no usamos BACKEND_URL directo; todas las llamadas van por api()/buildApiUrl() del helper.

export type BackendPayment = {
  doctorId: string;
  amount: number;
  date: string;      // YYYY-MM-DD
  patient?: string;
  service?: string;  // nombre del servicio (opcional)
  note?: string;
  id?: string | number;
};

export async function createPayment(p: BackendPayment) {
  return api('/payments', { method: 'POST', json: payload });
export async function fetchDoctors() {
  return api('/doctors');
}

export async function createDoctor(name: string) {
  return api('/doctors', {
    method: 'POST',
    json: { name },
  });
}
