import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as IOServer } from 'socket.io';
import { router as doctorsRouter } from './routes/doctors.js';
import { router as paymentsRouter, initPaymentsSockets } from './routes/payments.js';

const app = express();
app.use(express.json());
app.use(cors({ origin: '*'})); // ajusta CORS en prod

// HTTP + Socket.IO
const httpServer = createServer(app);
export const io = new IOServer(httpServer, {
  cors: { origin: '*' } // ajusta en prod
});

// Hello
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Rutas
app.use('/api/doctors', doctorsRouter);
app.use('/api/payments', paymentsRouter);

// Inicializar canales socket para pagos
initPaymentsSockets(io);

// Arranque
const PORT = process.env.PORT || 4001;
httpServer.listen(PORT, () => {
  console.log('✅ Dentalux backend listening on port', PORT);
});
