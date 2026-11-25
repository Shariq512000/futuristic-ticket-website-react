// Admin API (/api/admin): sign-in, dashboard stats, and management of
// matches, orders, stadiums and sports. Everything except /login needs a session.
import express from 'express';
import mongoose from 'mongoose';
import {
  Admin, Sport, Stadium, Match, Booking, Order,
} from './models.js';
import {
  requireAdmin, verifyPassword, setSessionCookie, clearSessionCookie,
  loginAllowed, recordLoginFailure, clearLoginFailures,
} from './auth.js';
import { layoutFor } from './layouts.js';
import { computeLayout } from '../shared/layout.js';
import { unmarkSold, forgetMatch } from './availability.js';

const router = express.Router();
const route = (fn) => (req, res, next) => fn(req, res, next).catch(next);

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const bad = (msg, extra) => new HttpError(400, msg, extra);
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const str = (v, max = 200) => (v == null ? undefined : String(v).trim().slice(0, max));

// ---- Session --------------------------------------------------------------------

router.post('/login', route(async (req, res) => {
  const ip = req.ip;
  if (!loginAllowed(ip)) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const admin = email ? await Admin.findOne({ email }) : null;
  // Always run a hash check so response time doesn't reveal whether the email exists
  const ok = await verifyPassword(password, admin?.passwordHash || 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
  if (!admin || !ok) {
    recordLoginFailure(ip);
    throw new HttpError(401, 'Wrong email or password');
  }
  clearLoginFailures(ip);
  admin.lastLoginAt = new Date();
  await admin.save();
  setSessionCookie(res, admin);
  res.json({ email: admin.email, name: admin.name });
}));

router.use(requireAdmin);

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => res.json({ email: req.admin.email, name: req.admin.name }));

// ---- Dashboard ----------------------------------------------------------------------

router.get('/stats', route(async (req, res) => {
  const now = new Date();
  const [orderTotals, perMatchOrders, perMatchBookings, activeHolds, matches, recent] = await Promise.all([
    Order.aggregate([
      { $match: { status: 'confirmed' } },
      { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$total' }, tickets: { $sum: { $size: '$seats' } } } },
    ]),
    Order.aggregate([
      { $match: { status: 'confirmed' } },
      { $group: { _id: '$matchId', orders: { $sum: 1 }, revenue: { $sum: '$total' }, tickets: { $sum: { $size: '$seats' } } } },
    ]),
    Booking.aggregate([{ $match: { status: 'sold' } }, { $group: { _id: '$matchId', sold: { $sum: 1 } } }]),
    Booking.countDocuments({ status: 'held', expiresAt: { $gt: now } }),
    Match.find().sort({ date: 1 }).lean(),
    Order.find().sort({ createdAt: -1 }).limit(8).lean(),
  ]);
  const venues = await Stadium.find({ _id: { $in: [...new Set(matches.map((m) => m.stadiumId))] } });
  const venueById = Object.fromEntries(venues.map((v) => [v._id, v]));
  const ordersBy = Object.fromEntries(perMatchOrders.map((o) => [o._id, o]));
  const soldBy = Object.fromEntries(perMatchBookings.map((b) => [b._id, b.sold]));
  const titleBy = Object.fromEntries(matches.map((m) => [m._id, m.title]));

  res.json({
    totals: { ...(orderTotals[0] || { orders: 0, revenue: 0, tickets: 0 }), activeHolds, _id: undefined },
    matches: matches.map((m) => {
      const v = venueById[m.stadiumId];
      return {
        id: m._id, title: m.title, sport: m.sport, date: m.date, status: m.status, currency: m.currency,
        venue: v?.name, capacity: v ? layoutFor(v).count : 0,
        sold: soldBy[m._id] || 0,
        online: ordersBy[m._id] || { orders: 0, revenue: 0, tickets: 0 },
        upcoming: m.date >= now,
      };
    }),
    recentOrders: recent.map((o) => ({
      id: o._id, matchId: o.matchId, match: titleBy[o.matchId], total: o.total, currency: o.currency,
      seats: o.seats.length, customer: o.customer.name, status: o.status, createdAt: o.createdAt,
    })),
  });
}));

// ---- Sports ---------------------------------------------------------------------------

router.get('/sports', route(async (req, res) => {
  const [sports, counts] = await Promise.all([
    Sport.find().sort({ order: 1 }).lean(),
    Match.aggregate([{ $group: { _id: '$sport', n: { $sum: 1 } } }]),
  ]);
  const by = Object.fromEntries(counts.map((c) => [c._id, c.n]));
  res.json(sports.map((s) => ({ id: s._id, name: s.name, tagline: s.tagline, order: s.order, matches: by[s._id] || 0 })));
}));

router.post('/sports', route(async (req, res) => {
  const id = str(req.body?.id, 63)?.toLowerCase();
  const name = str(req.body?.name, 60);
  if (!id || !SLUG.test(id)) throw bad('ID must be lowercase letters, numbers and dashes');
  if (!name) throw bad('Name is required');
  if (await Sport.exists({ _id: id })) throw new HttpError(409, 'A sport with this ID already exists');
  const order = (await Sport.countDocuments()) + 1;
  const s = await Sport.create({ _id: id, name, tagline: str(req.body?.tagline, 120), order });
  res.status(201).json({ id: s._id });
}));

router.put('/sports/:id', route(async (req, res) => {
  const name = str(req.body?.name, 60);
  if (!name) throw bad('Name is required');
  const update = { name, tagline: str(req.body?.tagline, 120) };
  if (req.body?.order != null) update.order = Number(req.body.order) || 0;
  const s = await Sport.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!s) throw new HttpError(404, 'Sport not found');
  res.json({ id: s._id });
}));

router.delete('/sports/:id', route(async (req, res) => {
  if (await Match.exists({ sport: req.params.id })) throw new HttpError(409, 'This sport still has matches');
  if (await Stadium.exists({ sport: req.params.id })) throw new HttpError(409, 'Stadiums still use this sport');
  await Sport.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
}));

// ---- Stadiums ---------------------------------------------------------------------------

function standSummary(config) {
  const layout = computeLayout(config);
  return {
    seats: layout.seats.length,
    stands: layout.stands.map((s) => ({
      id: s.id, name: s.name, seats: s.seats.length,
      tiers: s.tiers.map((t) => ({ key: t.key, name: t.name, rows: t.rows, seats: s.seats.filter((x) => x.tierIndex === t.index).length })),
    })),
  };
}

function validateStadiumConfig(config, id) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw bad('Config must be a JSON object');
  if (id && config.id !== id) throw bad(`"id" must stay "${id}"`);
  if (!config.id || !SLUG.test(config.id)) throw bad('"id" must be lowercase letters, numbers and dashes');
  if (!config.name) throw bad('"name" is required');
  if (!['cricket', 'football', 'basketball', undefined].includes(config.sport)) throw bad('"sport" must be cricket, football or basketball (it picks the playing surface)');
  if (!Array.isArray(config.stands) || !config.stands.length) throw bad('"stands" must be a non-empty list');
  const ids = new Set();
  for (const [i, s] of config.stands.entries()) {
    if (!s.id || !SLUG.test(s.id)) throw bad(`Stand ${i + 1}: "id" must be lowercase letters, numbers and dashes`);
    if (ids.has(s.id)) throw bad(`Duplicate stand id "${s.id}"`);
    ids.add(s.id);
    if (!s.name) throw bad(`Stand "${s.id}": "name" is required`);
    for (const k of ['from', 'to']) {
      if (typeof s[k] !== 'number' || s[k] < 0 || s[k] > 360) throw bad(`Stand "${s.id}": "${k}" must be an angle 0–360`);
    }
  }
  let summary;
  try {
    summary = standSummary(config);
  } catch (err) {
    throw bad(`Layout could not be built: ${err.message}`);
  }
  if (!summary.seats) throw bad('This layout has no seats');
  return summary;
}

router.get('/stadiums', route(async (req, res) => {
  const [stadiums, counts] = await Promise.all([
    Stadium.find().sort({ name: 1 }),
    Match.aggregate([{ $group: { _id: '$stadiumId', n: { $sum: 1 } } }]),
  ]);
  const by = Object.fromEntries(counts.map((c) => [c._id, c.n]));
  res.json(stadiums.map((s) => ({
    id: s._id, name: s.name, sport: s.sport, city: s.city, sample: s.sample, seats: layoutFor(s).count,
    stands: s.config.stands.length, matches: by[s._id] || 0, updatedAt: s.updatedAt,
  })));
}));

router.get('/stadiums/:id', route(async (req, res) => {
  const s = await Stadium.findById(req.params.id).lean();
  if (!s) throw new HttpError(404, 'Stadium not found');
  res.json({ id: s._id, config: s.config, summary: standSummary(s.config) });
}));

// Check a config without saving (seat counts per stand).
router.post('/stadiums/validate', route(async (req, res) => {
  res.json(validateStadiumConfig(req.body?.config, req.body?.id));
}));

router.post('/stadiums', route(async (req, res) => {
  const config = req.body?.config;
  const summary = validateStadiumConfig(config);
  if (await Stadium.exists({ _id: config.id })) throw new HttpError(409, 'A stadium with this ID already exists');
  await Stadium.create({
    _id: config.id, name: config.name, sport: config.sport || 'cricket', city: config.city, country: config.country, sample: !!config.sample, config,
  });
  res.status(201).json({ id: config.id, summary });
}));

// Update a layout. Refuses (409) if seats that are already sold or held would
// disappear, unless ?force=1 is given.
router.put('/stadiums/:id', route(async (req, res) => {
  const stadium = await Stadium.findById(req.params.id);
  if (!stadium) throw new HttpError(404, 'Stadium not found');
  const config = req.body?.config;
  const summary = validateStadiumConfig(config, stadium._id);

  const matchIds = (await Match.find({ stadiumId: stadium._id }).select('_id').lean()).map((m) => m._id);
  if (matchIds.length) {
    const newIds = new Set(computeLayout(config).seats.map((s) => s.id));
    const booked = await Booking.distinct('seatId', { matchId: { $in: matchIds } });
    const missing = booked.filter((id) => !newIds.has(id));
    if (missing.length && req.query.force !== '1') {
      throw new HttpError(409, `${missing.length.toLocaleString()} sold or held seats would no longer exist in this layout`, {
        missing: missing.length, sample: missing.slice(0, 5),
      });
    }
  }
  Object.assign(stadium, {
    name: config.name, sport: config.sport || 'cricket', city: config.city, country: config.country, sample: !!config.sample, config,
  });
  stadium.markModified('config');
  await stadium.save();
  for (const id of matchIds) forgetMatch(id);
  res.json({ id: stadium._id, summary });
}));

router.delete('/stadiums/:id', route(async (req, res) => {
  if (await Match.exists({ stadiumId: req.params.id })) throw new HttpError(409, 'This stadium still has matches');
  await Stadium.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
}));

// ---- Matches ------------------------------------------------------------------------------

async function validateMatch(body, existing) {
  const out = {};
  for (const k of ['title', 'short', 'competition', 'stage', 'home', 'away']) out[k] = str(body[k], 120) ?? '';
  if (!out.title) throw bad('Title is required');
  out.short = out.short || out.title.slice(0, 24).toUpperCase();
  out.currency = (str(body.currency, 3) || 'PKR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(out.currency)) throw bad('Currency must be a 3-letter code');

  out.date = new Date(body.date);
  if (Number.isNaN(out.date.getTime())) throw bad('Date is not valid');

  out.sport = str(body.sport, 63);
  if (!(await Sport.exists({ _id: out.sport }))) throw bad('Pick an existing sport');
  out.stadiumId = str(body.stadiumId, 63);
  const venue = await Stadium.findById(out.stadiumId);
  if (!venue) throw bad('Pick an existing stadium');
  if (existing && existing.stadiumId !== out.stadiumId && await Booking.exists({ matchId: existing._id })) {
    throw new HttpError(409, 'Seats are already sold or held for this match, so its stadium cannot change');
  }

  // Prices must only refer to stands/tiers that exist in the venue layout
  const p = body.prices || {};
  const num = (v, label) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw bad(`${label}: price must be a number ≥ 0`);
    return Math.round(n);
  };
  if (p.default === undefined || p.default === '') throw bad('A default price is required');
  const prices = { default: num(p.default, 'Default'), stands: {}, tiers: {} };
  const layout = computeLayout(venue.config);
  const standIds = new Set(layout.stands.map((s) => s.id));
  const tierKeys = new Set(layout.stands.flatMap((s) => s.tiers.map((t) => `${s.id}.${t.key}`)));
  for (const [k, v] of Object.entries(p.stands || {})) {
    if (v === '' || v == null) continue;
    if (!standIds.has(k)) throw bad(`Unknown stand "${k}" for this stadium`);
    prices.stands[k] = num(v, k);
  }
  for (const [k, v] of Object.entries(p.tiers || {})) {
    if (v === '' || v == null) continue;
    if (!tierKeys.has(k)) throw bad(`Unknown tier "${k}" for this stadium`);
    prices.tiers[k] = num(v, k);
  }
  out.prices = prices;
  if (body.status) {
    if (!['scheduled', 'cancelled'].includes(body.status)) throw bad('Status must be scheduled or cancelled');
    out.status = body.status;
  }
  return out;
}

const adminMatch = (m) => ({
  id: m._id, sport: m.sport, stadiumId: m.stadiumId, competition: m.competition, stage: m.stage,
  title: m.title, short: m.short, home: m.home, away: m.away, date: m.date, currency: m.currency,
  prices: m.prices, status: m.status, updatedAt: m.updatedAt,
});

router.get('/matches', route(async (req, res) => {
  const filter = {};
  if (req.query.sport) filter.sport = String(req.query.sport);
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.when === 'upcoming') filter.date = { $gte: new Date() };
  if (req.query.when === 'past') filter.date = { $lt: new Date() };
  const matches = await Match.find(filter).sort({ date: 1 }).lean();
  res.json(matches.map(adminMatch));
}));

router.get('/matches/:id', route(async (req, res) => {
  const m = await Match.findById(req.params.id).lean();
  if (!m) throw new HttpError(404, 'Match not found');
  const [booked, orders] = await Promise.all([Booking.countDocuments({ matchId: m._id }), Order.countDocuments({ matchId: m._id })]);
  res.json({ ...adminMatch(m), bookings: booked, orders });
}));

router.post('/matches', route(async (req, res) => {
  const data = await validateMatch(req.body || {});
  const base = (str(req.body?.id, 40) || `${data.sport.slice(0, 1)}-${Date.now().toString(36)}`).toLowerCase();
  if (!SLUG.test(base)) throw bad('ID must be lowercase letters, numbers and dashes');
  if (await Match.exists({ _id: base })) throw new HttpError(409, 'A match with this ID already exists');
  const m = await Match.create({ _id: base, ...data, status: data.status || 'scheduled' });
  res.status(201).json(adminMatch(m.toObject()));
}));

router.put('/matches/:id', route(async (req, res) => {
  const existing = await Match.findById(req.params.id);
  if (!existing) throw new HttpError(404, 'Match not found');
  const data = await validateMatch(req.body || {}, existing);
  Object.assign(existing, data);
  existing.markModified('prices');
  await existing.save();
  res.json(adminMatch(existing.toObject()));
}));

router.delete('/matches/:id', route(async (req, res) => {
  if (await Order.exists({ matchId: req.params.id })) {
    throw new HttpError(409, 'This match has orders. Cancel it instead of deleting it.');
  }
  await Booking.deleteMany({ matchId: req.params.id });
  forgetMatch(req.params.id);
  await Match.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
}));

// ---- Orders ----------------------------------------------------------------------------------

router.get('/orders', route(async (req, res) => {
  const filter = {};
  if (req.query.matchId) filter.matchId = String(req.query.matchId);
  if (req.query.status) filter.status = String(req.query.status);
  const q = str(req.query.q, 100);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [
      { 'customer.name': rx }, { 'customer.email': rx },
      { $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: escapeRegex(q.toLowerCase()) } } },
    ];
  }
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 25;
  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Order.countDocuments(filter),
  ]);
  const titles = Object.fromEntries((await Match.find({ _id: { $in: [...new Set(orders.map((o) => o.matchId))] } })
    .select('title').lean()).map((m) => [m._id, m.title]));
  res.json({
    page, pages: Math.max(1, Math.ceil(total / limit)), total,
    orders: orders.map((o) => ({
      id: o._id, matchId: o.matchId, match: titles[o.matchId], seats: o.seats.length, total: o.total, currency: o.currency,
      customer: o.customer, status: o.status, createdAt: o.createdAt,
    })),
  });
}));

router.get('/orders/:id', route(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Order not found');
  const o = await Order.findById(req.params.id).lean();
  if (!o) throw new HttpError(404, 'Order not found');
  const m = await Match.findById(o.matchId).select('title date').lean();
  res.json({ ...o, id: o._id, match: m ? { id: m._id, title: m.title, date: m.date } : { id: o.matchId } });
}));

// Cancel an order and put its seats back on sale. (Refunds are outside this demo.)
router.post('/orders/:id/cancel', route(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Order not found');
  const o = await Order.findById(req.params.id);
  if (!o) throw new HttpError(404, 'Order not found');
  if (o.status === 'cancelled') throw new HttpError(409, 'Order is already cancelled');
  o.status = 'cancelled';
  await o.save();
  const seatIds = o.seats.map((s) => s.seatId);
  await Booking.deleteMany({ orderId: o._id });
  unmarkSold(o.matchId, seatIds);
  res.json({ id: o._id, status: o.status, released: seatIds.length });
}));

// ---- Errors -----------------------------------------------------------------------------------

router.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
  console.error(err);
  return res.status(500).json({ error: 'Something went wrong' });
});

export default router;
