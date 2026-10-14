// src/lib/backend.ts
import { api } from './api';

// Ya no usamos BACKEND_URL directo; todas las llamadas van por api()/buildApiUrl() del helper.

export type BackendPayment = {
  doctorId: string;
  amount: number;
  date: string;      // YYYY-MM-DD
  patient?: string;
  paymentMethod?: string;
  serviceId?: string | number;
  appointmentId?: string | number;
  service?: string;  // nombre del servicio (opcional)
  note?: string;
  id?: string | number;
};

export async function createPayment(p: BackendPayment) {
  if (!p.patient?.trim() || !(p.amount > 0) || !p.date || !p.paymentMethod?.trim()) {
    throw new Error('Se requieren paciente, monto positivo, fecha y método de pago');
  }
  if (p.note?.trim()) throw new Error('La ruta de pagos no admite notas; no se guardó el pago');
  let serviceId = p.serviceId;
  if (serviceId == null && p.service?.trim()) {
    const services = await api('/services');
    const matches = (Array.isArray(services) ? services : []).filter(
      (service: {name?: string}) => service.name?.trim().toLowerCase() === p.service!.trim().toLowerCase()
    );
    if (matches.length !== 1) throw new Error('Selecciona un servicio existente y sin ambigüedad');
    serviceId = matches[0].id;
  }
  return api('/payments', { method: 'POST', body: JSON.stringify({
    doctor_id: p.doctorId, amount: p.amount, date: p.date, patient: p.patient.trim(),
    payment_method: p.paymentMethod.trim(), service_id: serviceId, appointment_id: p.appointmentId,
  }) });
}
export async function fetchDoctors() {
  return api('/doctors');
}

export async function createDoctor(name: string) {
  return api('/doctors', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}
