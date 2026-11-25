// Express server: JSON API under /api, and the built site (dist/) in production.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import compression from 'compression';
import mongoose from 'mongoose';
import api from './api.js';
import admin from './admin.js';
import { Booking } from './models.js';

const PORT = Number(process.env.PORT) || 4000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/match-tickets';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '300kb' }));
app.use('/api/admin', admin);
app.use('/api', api);

// Serve the built React app when it exists (npm run build). Every other GET
// returns index.html so React Router handles /sport/..., /match/..., /admin/...
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(dist, 'index.html')) : next()));
}

async function start() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await Booking.syncIndexes(); // unique (match, seat) + TTL on holds
  console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}/api`));
}

start().catch((err) => {
  console.error(`Could not start: ${err.message}`);
  console.error(`Is MongoDB running at ${MONGODB_URI}? Set MONGODB_URI in .env to change it.`);
  process.exit(1);
});
