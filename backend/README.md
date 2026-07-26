# Dentalux Backend (Autogestionado)

Stack: **Node.js + Express + Prisma (PostgreSQL) + Socket.IO (real-time)**

## 🚀 Inicio rápido

```bash
cd backend
cp .env.example .env   # edita DATABASE_URL
npm i
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

### Opcional: sembrar doctores
```bash
npm run seed
```

API corre en `http://localhost:4000`

## 🔌 Endpoints

- `GET /api/health` → `{ ok: true }`
- `GET /api/doctors`
- `POST /api/doctors` `{ name, active? }`
- `GET /api/payments?from=YYYY-MM-DD&to=YYYY-MM-DD&doctorId=...`
- `POST /api/payments` `{ doctorId, amount, date, patient?, service?, note? }`

## 📡 Tiempo real

Evento: `payment.created` (se emite al crear pago).

Cliente (React):
```ts
import { io } from "socket.io-client";
const socket = io(import.meta.env.VITE_BACKEND_URL || "http://localhost:4000");
socket.on("payment.created", (pago) => { /* actualizar estado */ });
```

## 🗃️ Prisma schema (Postgres)

- **Doctor**: `id, name, active`
- **Payment**: `id, doctorId, amount:Float, date:DateTime, patient?, service?, note?, createdAt`

> Sugerencia: en producción guarda montos en **centavos** (Int) para evitar decimales.
