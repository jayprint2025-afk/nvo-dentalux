import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';

export const router = Router();

// GET /api/doctors
// routes/doctors.js
router.get('/', async (req, res) => {
  const { sucursal } = req.query;                    // 👈 Nuevo
  const sucursalId = sucursal || 'sucursal_1';       // 👈 Nuevo
  
  console.log(`🏢 Consultando doctores para ${sucursalId}`); // 👈 Debug
  
  const doctors = await db.query(
    'SELECT * FROM doctors WHERE sucursal_id = $1',  // 👈 Filtrar por sucursal
    [sucursalId]
  );
  res.json(doctors);
});

// POST /api/doctors
const DoctorBody = z.object({
  name: z.string().min(1),
  active: z.boolean().optional().default(true),
});
router.post('/', async (req, res) => {
  const parse = DoctorBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const doc = await prisma.doctor.create({ data: parse.data });
  res.status(201).json(doc);
});
