import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import type { Server as IOServer } from 'socket.io';

export const router = Router();

// GET /api/payments?from=YYYY-MM-DD&to=YYYY-MM-DD&doctorId=optional
router.get('/', async (req, res) => {
  const { from, to, doctorId } = req.query as Record<string, string | undefined>;
  const where:any = {};
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from + 'T00:00:00');
    if (to) where.date.lte = new Date(to + 'T23:59:59');
  }
  if (doctorId) where.doctorId = doctorId;
  const payments = await prisma.payment.findMany({ where, orderBy: { date: 'asc' } });
  res.json(payments);
});

// POST /api/payments
const PaymentBody = z.object({
  doctorId: z.string().min(1),
  amount: z.number().finite().nonnegative(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  patient: z.string().optional(),
  service: z.string().optional(),
  note: z.string().optional()
});
router.post('/', async (req, res) => {
  const parse = PaymentBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const data = parse.data;
  const saved = await prisma.payment.create({
    data: {
      doctorId: data.doctorId,
      amount: data.amount,
      date: new Date(data.date + 'T00:00:00'),
      patient: data.patient,
      service: data.service,
      note: data.note
    }
  });
  // Emitir evento real-time
  (globalThis as any).__io?.emit('payment.created', saved);
  res.status(201).json(saved);
});

// Inyección del io en ámbito global para emites rápidos
export function initPaymentsSockets(io: IOServer){
  (globalThis as any).__io = io;
}
