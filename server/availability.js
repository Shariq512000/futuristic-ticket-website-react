// Fast seat availability.
//
// Sold seats change only when this server confirms an order, so each match's
// sold set is loaded from MongoDB once and then updated in memory. Holds are
// few and short-lived, so they are queried on every request. The cache reloads
// every few minutes so it self-heals if the database is changed elsewhere
// (e.g. by `npm run seed`). With several server instances, put this set in a
// shared store such as Redis instead.
import { Booking } from './models.js';

const RELOAD_MS = 5 * 60 * 1000;
const sold = new Map(); // matchId -> { set, loadedAt, loading }

async function soldSet(matchId) {
  const entry = sold.get(matchId);
  if (entry?.set && Date.now() - entry.loadedAt < RELOAD_MS) return entry.set;
  if (entry?.loading) return entry.loading;
  const loading = Booking.find({ matchId, status: 'sold' }).select('seatId -_id').lean()
    .then((docs) => {
      const set = new Set(docs.map((d) => d.seatId));
      sold.set(matchId, { set, loadedAt: Date.now() });
      return set;
    })
    .catch((err) => {
      sold.delete(matchId);
      throw err;
    });
  sold.set(matchId, { ...entry, loading });
  return loading;
}

export function markSold(matchId, seatIds) {
  const entry = sold.get(matchId);
  if (entry?.set) for (const id of seatIds) entry.set.add(id);
}

export function unmarkSold(matchId, seatIds) {
  const entry = sold.get(matchId);
  if (entry?.set) for (const id of seatIds) entry.set.delete(id);
}

export function forgetMatch(matchId) {
  sold.delete(matchId);
}

// Bitmask (base64) over the shared layout order: bit i set = seat i unavailable.
export async function availabilityBits(matchId, layout, excludeHoldId) {
  const [soldIds, held] = await Promise.all([
    soldSet(matchId),
    Booking.find({
      matchId,
      status: 'held',
      expiresAt: { $gt: new Date() },
      ...(excludeHoldId ? { holdId: { $ne: excludeHoldId } } : {}),
    }).select('seatId -_id').lean(),
  ]);
  const bytes = new Uint8Array(Math.ceil(layout.count / 8));
  let unavailable = 0;
  const mark = (id) => {
    const i = layout.index.get(id);
    if (i === undefined || bytes[i >> 3] & (1 << (i & 7))) return;
    bytes[i >> 3] |= 1 << (i & 7);
    unavailable += 1;
  };
  for (const id of soldIds) mark(id);
  for (const h of held) mark(h.seatId);
  return { bits: Buffer.from(bytes).toString('base64'), count: layout.count, unavailable };
}
