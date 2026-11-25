// Load sports, stadiums and matches from the JSON files into MongoDB.
//
//   npm run seed                 upsert sports, stadiums, matches (keeps bookings/orders)
//   npm run seed -- --demo-sales also mark each match's `sold` share of seats as sold
//   npm run seed -- --reset      wipe bookings and orders first
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import {
  Sport, Stadium, Match, Booking, Order,
} from './models.js';
import { computeLayout, seatPrice } from '../shared/layout.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const args = new Set(process.argv.slice(2));
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/match-tickets';

function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2147483646) + 1;
}

async function main() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  console.log(`Connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
  await Booking.syncIndexes();

  if (args.has('--reset')) {
    const b = await Booking.deleteMany({});
    const o = await Order.deleteMany({});
    console.log(`Reset: removed ${b.deletedCount} bookings, ${o.deletedCount} orders`);
  }

  // Sports
  const { sports } = readJson('data/sports.json');
  for (const [i, s] of sports.entries()) {
    await Sport.findByIdAndUpdate(s.id, { name: s.name, tagline: s.tagline, order: i }, { upsert: true });
  }
  console.log(`Sports: ${sports.length}`);

  // Stadiums (whole config stored so the browser and server use the same layout)
  const files = fs.readdirSync(path.join(root, 'stadiums')).filter((f) => f.endsWith('.json'));
  const layouts = {};
  for (const f of files) {
    const cfg = readJson(`stadiums/${f}`);
    await Stadium.findByIdAndUpdate(cfg.id, {
      name: cfg.name, sport: cfg.sport || 'cricket', city: cfg.city, country: cfg.country, sample: !!cfg.sample, config: cfg,
    }, { upsert: true });
    layouts[cfg.id] = computeLayout(cfg);
    console.log(`Stadium: ${cfg.name} (${layouts[cfg.id].seats.length.toLocaleString()} seats)`);
  }

  // Matches
  const { matches, currency } = readJson('data/matches.json');
  for (const m of matches) {
    if (!layouts[m.stadiumId]) {
      console.warn(`Skipping ${m.id}: unknown stadium ${m.stadiumId}`);
      continue;
    }
    await Match.findByIdAndUpdate(m.id, {
      sport: m.sport, stadiumId: m.stadiumId, competition: m.competition, stage: m.stage,
      title: m.title, short: m.short, home: m.home, away: m.away,
      date: new Date(m.date), currency: m.currency || currency || 'PKR', prices: m.prices, status: 'scheduled',
    }, { upsert: true });
  }
  console.log(`Matches: ${matches.length}`);

  // Optional demo sales: pre-sell each match's `sold` share so maps look realistic
  if (args.has('--demo-sales')) {
    for (const m of matches) {
      const layout = layouts[m.stadiumId];
      if (!layout || !m.sold) continue;
      await Booking.deleteMany({ matchId: m.id, source: 'seed' });
      const rand = rng(hashSeed(`${m.id}:${m.stadiumId}`));
      const docs = layout.seats.filter(() => rand() < m.sold).map((s) => ({
        matchId: m.id, seatId: s.id, status: 'sold', price: seatPrice(m.prices, s), source: 'seed',
      }));
      for (let i = 0; i < docs.length; i += 5000) {
        try {
          await Booking.insertMany(docs.slice(i, i + 5000), { ordered: false });
        } catch (err) {
          if (!(err.code === 11000 || /E11000/.test(err.message))) throw err; // seat already booked by a real order
        }
      }
      console.log(`Demo sales: ${m.id} ${docs.length.toLocaleString()} seats sold`);
    }
  }

  await mongoose.disconnect();
  console.log('Seed complete.');
}

main().catch(async (err) => {
  console.error(`Seed failed: ${err.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
