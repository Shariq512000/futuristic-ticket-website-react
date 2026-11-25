// Seat layouts computed from stadium configs, cached per stadium version.
// `index` gives each seat's position in layout order, which the browser shares,
// so availability can be sent as a compact bitmask.
import { computeLayout, seatPrice } from '../shared/layout.js';

const cache = new Map(); // stadiumId -> { version, seats, index, count }

export function layoutFor(stadium) {
  const version = stadium.updatedAt?.getTime?.() ?? 0;
  const hit = cache.get(stadium._id);
  if (hit && hit.version === version) return hit;
  const layout = computeLayout(stadium.config);
  const entry = {
    version,
    seats: new Map(layout.seats.map((s) => [s.id, s])),
    index: new Map(layout.seats.map((s, i) => [s.id, i])),
    count: layout.seats.length,
  };
  cache.set(stadium._id, entry);
  return entry;
}

export const seatsFor = (stadium) => layoutFor(stadium).seats;

export { seatPrice };
