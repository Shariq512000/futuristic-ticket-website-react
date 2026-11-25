// REST API: sports, matches, seat availability, seat holds and orders.
import { randomUUID } from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import {
  Sport, Stadium, Match, Booking, Order,
} from './models.js';
import { seatsFor, layoutFor, seatPrice } from './layouts.js';
import { availabilityBits, markSold } from './availability.js';

export const HOLD_MINUTES = 10;
export const FEE_RATE = 0.05;
const MAX_SEATS_PER_ORDER = 10;

const router = express.Router();

// Wrap async handlers so thrown errors reach the error middleware.
const route = (fn) => (req, res, next) => fn(req, res, next).catch(next);

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function fromPrice(prices = {}) {
  const all = [prices.default, ...Object.values(prices.stands || {}), ...Object.values(prices.tiers || {})]
    .filter((p) => typeof p === 'number');
  return all.length ? Math.min(...all) : null;
}

function publicMatch(m, venue) {
  return {
    id: m._id,
    sport: m.sport,
    competition: m.competition,
    stage: m.stage,
    title: m.title,
    short: m.short,
    home: m.home,
    away: m.away,
    date: m.date,
    currency: m.currency,
    status: m.status,
    stadiumId: m.stadiumId,
    venue: venue ? { id: venue._id, name: venue.name, city: venue.city } : undefined,
    fromPrice: fromPrice(m.prices),
  };
}

const upcomingFilter = (extra = {}) => ({ status: 'scheduled', date: { $gte: new Date() }, ...extra });

// ---- Catalogue ----------------------------------------------------------------

router.get('/health', (req, res) => {
  res.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

router.get('/sports', route(async (req, res) => {
  const [sports, counts] = await Promise.all([
    Sport.find().sort({ order: 1 }).lean(),
    Match.aggregate([{ $match: upcomingFilter() }, { $group: { _id: '$sport', n: { $sum: 1 } } }]),
  ]);
  const bySport = Object.fromEntries(counts.map((c) => [c._id, c.n]));
  res.json(sports.map((s) => ({ id: s._id, name: s.name, tagline: s.tagline, upcoming: bySport[s._id] || 0 })));
}));

router.get('/sports/:id', route(async (req, res) => {
  const s = await Sport.findById(req.params.id).lean();
  if (!s) throw new HttpError(404, 'Sport not found');
  res.json({ id: s._id, name: s.name, tagline: s.tagline });
}));

// Upcoming matches. Filters: ?sport=cricket&stadium=harbour-oval&limit=4
router.get('/matches', route(async (req, res) => {
  const filter = upcomingFilter();
  if (req.query.sport) filter.sport = String(req.query.sport);
  if (req.query.stadium) filter.stadiumId = String(req.query.stadium);
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const matches = await Match.find(filter).sort({ date: 1 }).limit(limit).lean();
  const venues = await Stadium.find({ _id: { $in: [...new Set(matches.map((m) => m.stadiumId))] } })
    .select('name city').lean();
  const byId = Object.fromEntries(venues.map((v) => [v._id, v]));
  res.json(matches.map((m) => publicMatch(m, byId[m.stadiumId])));
}));

// One match with its prices and the full stadium layout config.
router.get('/matches/:id', route(async (req, res) => {
  const m = await Match.findById(req.params.id).lean();
  if (!m) throw new HttpError(404, 'Match not found');
  const venue = await Stadium.findById(m.stadiumId).lean();
  if (!venue) throw new HttpError(404, 'Stadium not found');
  res.json({ match: { ...publicMatch(m, venue), prices: m.prices }, stadium: venue.config });
}));

// Seats that cannot be bought right now (sold, or held by someone else), as a
// base64 bitmask in shared layout order: bit i set = seat i unavailable.
// Pass ?hold=<holdId> so your own held seats are not reported as taken.
router.get('/matches/:id/availability', route(async (req, res) => {
  const m = await Match.findById(req.params.id).select('stadiumId').lean();
  if (!m) throw new HttpError(404, 'Match not found');
  const venue = await Stadium.findById(m.stadiumId);
  const result = await availabilityBits(m._id, layoutFor(venue), req.query.hold ? String(req.query.hold) : null);
  res.set('Cache-Control', 'no-store');
  res.json({ matchId: m._id, ...result, at: new Date() });
}));

// ---- Holds ----------------------------------------------------------------------

async function loadMatchSeats(matchId) {
  const m = await Match.findById(matchId).lean();
  if (!m) throw new HttpError(404, 'Match not found');
  if (m.status !== 'scheduled' || m.date < new Date()) throw new HttpError(409, 'This match is not on sale');
  const venue = await Stadium.findById(m.stadiumId);
  if (!venue) throw new HttpError(404, 'Stadium not found');
  return { match: m, seats: seatsFor(venue) };
}

function priceSummary(lines) {
  const subtotal = lines.reduce((sum, l) => sum + l.price, 0);
  const fee = Math.round(subtotal * FEE_RATE);
  return { subtotal, fee, total: subtotal + fee };
}

// Hold seats for HOLD_MINUTES. Body: { matchId, seatIds: [...] }
router.post('/holds', route(async (req, res) => {
  const { matchId } = req.body || {};
  const seatIds = [...new Set(req.body?.seatIds || [])].map(String);
  if (!matchId || !seatIds.length) throw new HttpError(400, 'matchId and seatIds are required');
  if (seatIds.length > MAX_SEATS_PER_ORDER) throw new HttpError(400, `At most ${MAX_SEATS_PER_ORDER} seats per order`);

  const { match, seats } = await loadMatchSeats(String(matchId));
  const lines = seatIds.map((id) => {
    const seat = seats.get(id);
    if (!seat) throw new HttpError(400, `Unknown seat ${id}`);
    const price = seatPrice(match.prices, seat);
    if (typeof price !== 'number') throw new HttpError(400, `Seat ${id} is not on sale`);
    return { seatId: id, label: seat.label, price };
  });

  const now = new Date();
  // Clear expired holds on these seats first (the TTL monitor may not have run yet)
  await Booking.deleteMany({ matchId: match._id, seatId: { $in: seatIds }, status: 'held', expiresAt: { $lte: now } });

  const holdId = randomUUID();
  const expiresAt = new Date(now.getTime() + HOLD_MINUTES * 60 * 1000);
  try {
    await Booking.insertMany(lines.map((l) => ({
      matchId: match._id, seatId: l.seatId, status: 'held', price: l.price, holdId, expiresAt,
    })), { ordered: false });
  } catch (err) {
    // Duplicate key = seat already held or sold. Undo our partial hold and report which seats.
    await Booking.deleteMany({ holdId });
    if (err.code === 11000 || err.writeErrors?.some((e) => e.code === 11000) || /E11000/.test(err.message)) {
      const taken = await Booking.find({ matchId: match._id, seatId: { $in: seatIds } }).select('seatId -_id').lean();
      throw new HttpError(409, 'Some seats are no longer available', { unavailable: taken.map((t) => t.seatId) });
    }
    throw err;
  }

  res.status(201).json({
    holdId, matchId: match._id, expiresAt, currency: match.currency, seats: lines, ...priceSummary(lines),
  });
}));

const releaseHold = route(async (req, res) => {
  const r = await Booking.deleteMany({ holdId: req.params.holdId, status: 'held' });
  res.json({ released: r.deletedCount });
});
router.delete('/holds/:holdId', releaseHold);
router.post('/holds/:holdId/release', releaseHold); // for navigator.sendBeacon when a tab closes

// ---- Orders -----------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Turn a hold into an order. Body: { holdId, customer: { name, email } }
// Demo only: no payment step.
router.post('/orders', route(async (req, res) => {
  const holdId = String(req.body?.holdId || '');
  const name = String(req.body?.customer?.name || '').trim().slice(0, 120);
  const email = String(req.body?.customer?.email || '').trim().toLowerCase().slice(0, 200);
  if (!holdId) throw new HttpError(400, 'holdId is required');
  if (!name) throw new HttpError(400, 'Name is required');
  if (!EMAIL.test(email)) throw new HttpError(400, 'A valid email is required');

  const now = new Date();
  const held = await Booking.find({ holdId, status: 'held', expiresAt: { $gt: now } }).lean();
  if (!held.length) throw new HttpError(410, 'Your hold has expired. Please pick your seats again.');

  const match = await Match.findById(held[0].matchId).lean();
  const venue = await Stadium.findById(match.stadiumId);
  const seats = seatsFor(venue);
  const lines = held.map((b) => ({ seatId: b.seatId, label: seats.get(b.seatId)?.label || b.seatId, price: b.price }));

  const order = await Order.create({
    matchId: match._id, seats: lines, currency: match.currency, customer: { name, email }, ...priceSummary(lines),
  });
  const r = await Booking.updateMany(
    { holdId, status: 'held', expiresAt: { $gt: new Date() } },
    { $set: { status: 'sold', orderId: order._id }, $unset: { expiresAt: 1, holdId: 1 } },
  );
  if (r.modifiedCount !== held.length) {
    // The hold expired part-way through: undo so nothing is half-sold.
    await Booking.updateMany({ orderId: order._id }, { $set: { status: 'held', expiresAt: now }, $unset: { orderId: 1 } });
    await Order.deleteOne({ _id: order._id });
    throw new HttpError(410, 'Your hold expired while confirming. Please pick your seats again.');
  }
  markSold(match._id, lines.map((l) => l.seatId));
  res.status(201).json(publicOrder(order.toObject(), match));
}));

router.get('/orders/:id', route(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Order not found');
  const order = await Order.findById(req.params.id).lean();
  if (!order) throw new HttpError(404, 'Order not found');
  const match = await Match.findById(order.matchId).lean();
  res.json(publicOrder(order, match));
}));

function publicOrder(o, match) {
  return {
    id: o._id,
    status: o.status,
    match: match ? { id: match._id, title: match.title, date: match.date } : { id: o.matchId },
    seats: o.seats,
    subtotal: o.subtotal,
    fee: o.fee,
    total: o.total,
    currency: o.currency,
    customer: { name: o.customer.name },
    createdAt: o.createdAt,
  };
}

// ---- Errors ------------------------------------------------------------------------

router.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  return res.status(500).json({ error: 'Something went wrong' });
});

export default router;
