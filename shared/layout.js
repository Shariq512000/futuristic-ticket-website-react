// Seat layout maths shared by the browser (3D) and the server (validation, pricing).
// Pure JavaScript: no three.js, no DOM. Given a stadium config it returns every
// stand, tier and seat with a stable seat id, so both sides agree on what exists.
//
// Angles: degrees clockwise seen from above, 0 = the +x end of the field.
// Distances (d) are measured outward from the field edge.

const DEG = Math.PI / 180;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

// Defaults for every tier; a tier in the config can override any of these.
export const TIER_DEFAULTS = {
  depth: 0.8, // row depth (m)
  rise: 0.42, // row rise (m)
  spacing: 0.5, // seat width (m)
  aisle: 1.2, // gap between blocks (m)
  edge: 1.2, // gap at each end of the stand (m)
  blockLength: 18, // target block width when `sections` is not given (m)
  maxRows: 90,
  scale: 1,
};
export const TIER_PRESETS = {
  vvip: { depth: 1.0, rise: 0.45, spacing: 0.62, scale: 1.15 },
  boxes: { depth: 1.3, rise: 0.5, spacing: 0.66, aisle: 0.8, scale: 1.2 },
};

// Field-edge curve: superellipse |x/a|^n + |z/b|^n = 1 (n = 2 is an ellipse),
// resampled at even spacing, with outward normals and the angle of each sample.
export function buildBase(a, b, n = 2, step = 0.25) {
  const N = 8192;
  const p = 2 / n;
  const dense = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    dense.push([a * Math.sign(c) * Math.abs(c) ** p, b * Math.sign(s) * Math.abs(s) ** p]);
  }
  const cum = [0];
  for (let i = 1; i <= N; i++) {
    const P = dense[i - 1];
    const Q = dense[i % N];
    cum.push(cum[i - 1] + Math.hypot(Q[0] - P[0], Q[1] - P[1]));
  }
  const M = Math.round(cum[N] / step);
  const px = new Float64Array(M);
  const pz = new Float64Array(M);
  let j = 0;
  for (let k = 0; k < M; k++) {
    const target = (k / M) * cum[N];
    while (cum[j + 1] < target) j++;
    const f = (target - cum[j]) / (cum[j + 1] - cum[j] || 1);
    const P = dense[j];
    const Q = dense[(j + 1) % N];
    px[k] = P[0] + (Q[0] - P[0]) * f;
    pz[k] = P[1] + (Q[1] - P[1]) * f;
  }
  const nx = new Float64Array(M);
  const nz = new Float64Array(M);
  const ang = new Float64Array(M);
  for (let k = 0; k < M; k++) {
    const tx = px[(k + 1) % M] - px[(k - 1 + M) % M];
    const tz = pz[(k + 1) % M] - pz[(k - 1 + M) % M];
    const len = Math.hypot(tx, tz);
    nx[k] = tz / len;
    nz[k] = -tx / len;
    ang[k] = ((Math.atan2(pz[k], px[k]) / DEG) + 360) % 360;
  }
  return { px, pz, nx, nz, ang, M };
}

const inRange = (a, from, to) => (from <= to ? a >= from && a <= to : a >= from || a <= to);

// Base sample indices covering [from, to] degrees, in order.
export function arcIndices(base, from, to) {
  const { M, ang } = base;
  let start = -1;
  for (let k = 0; k < M; k++) {
    if (inRange(ang[k], from, to) && !inRange(ang[(k - 1 + M) % M], from, to)) {
      start = k;
      break;
    }
  }
  if (start < 0) return [...Array(M).keys(), 0];
  const idx = [];
  for (let k = start; idx.length < M && inRange(ang[k % M], from, to); k++) idx.push(k % M);
  return idx;
}

// Points along base indices pushed out by d, with cumulative arc length.
export function arcPoints(base, idx, d) {
  const n = idx.length;
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = idx[i];
    x[i] = base.px[k] + base.nx[k] * d;
    z[i] = base.pz[k] + base.nz[k] * d;
    if (i) s[i] = s[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
  }
  return { x, z, s, n };
}

export function nearestIndex(base, angle) {
  let best = 0;
  let bestDiff = Infinity;
  for (let k = 0; k < base.M; k++) {
    const diff = Math.abs(((base.ang[k] - angle + 540) % 360) - 180);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = k;
    }
  }
  return best;
}

// Seats along one row of a stand.
function rowSeats(base, idx, d, t, nBlocks) {
  const P = arcPoints(base, idx, d);
  const L = P.s[P.n - 1];
  const usable = L - 2 * t.edge;
  if (usable < t.spacing) return [];
  const count = Math.floor(usable / t.spacing);
  const pad = (usable - count * t.spacing) / 2;
  const blockLen = usable / nBlocks;
  const out = [];
  let k = 0;
  for (let i = 0; i < count; i++) {
    const s = t.edge + pad + (i + 0.5) * t.spacing;
    const rel = s - t.edge;
    const block = Math.min(nBlocks - 1, Math.floor(rel / blockLen));
    const off = rel - block * blockLen;
    if (nBlocks > 1 && ((block > 0 && off < t.aisle / 2) || (block < nBlocks - 1 && blockLen - off < t.aisle / 2))) continue;
    while (k < P.n - 2 && P.s[k + 1] < s) k++;
    const f = (s - P.s[k]) / (P.s[k + 1] - P.s[k] || 1);
    const ka = idx[k];
    const kb = idx[k + 1];
    let nx = base.nx[ka] + (base.nx[kb] - base.nx[ka]) * f;
    let nz = base.nz[ka] + (base.nz[kb] - base.nz[ka]) * f;
    const nl = Math.hypot(nx, nz);
    nx /= nl;
    nz /= nl;
    out.push({
      x: P.x[k] + (P.x[k + 1] - P.x[k]) * f,
      z: P.z[k] + (P.z[k + 1] - P.z[k]) * f,
      nx, nz, block, s,
    });
  }
  return out;
}

/**
 * Full seat layout for a stadium config.
 * Seat id format: `<standId>:<tierIndex>:<blockIndex>:<row>:<num>` (stable for a given config).
 */
export function computeLayout(config) {
  const field = config.field || {};
  const a = (field.length || 140) / 2;
  const b = (field.width || 130) / 2;
  const base = buildBase(a, b, field.superellipse || 2);
  const stands = [];
  const seats = [];
  let maxD = 0;

  for (const sc of config.stands) {
    const idx = arcIndices(base, sc.from, sc.to);
    const stand = { id: sc.id, name: sc.name, type: sc.type || 'stand', config: sc, idx, tiers: [], seats: [] };
    const tierConfigs = sc.tiers?.length ? sc.tiers : [{ key: 'lower' }];
    let prev = null;

    tierConfigs.forEach((tc, tierIndex) => {
      const t = { ...TIER_DEFAULTS, ...(TIER_PRESETS[tc.key] || {}), ...tc };
      const d0 = prev ? prev.dEnd + 1.4 : (sc.frontGap ?? 4);
      const y0 = tc.y0 ?? (prev ? prev.yTop + 2.8 : (t.rise === 0 ? 0 : 1.2));
      const cap = tc.capacity ?? (sc.capacity ? Math.round(sc.capacity / tierConfigs.length) : null);
      const fixedRows = cap == null ? (tc.rows ?? 20) : null;
      const front = arcPoints(base, idx, d0);
      const nBlocks = tc.sections ?? tc.boxes ?? Math.max(1, Math.round(front.s[front.n - 1] / t.blockLength));

      const tierSeats = [];
      let r = 0;
      while (r < t.maxRows) {
        const y = y0 + r * t.rise;
        let row = rowSeats(base, idx, d0 + r * t.depth + 0.05, t, nBlocks);
        if (cap != null && tierSeats.length + row.length > cap) {
          const need = cap - tierSeats.length;
          const cut = Math.floor((row.length - need) / 2);
          row = row.slice(cut, cut + need);
        }
        for (const c of row) tierSeats.push({ ...c, y, r });
        r++;
        if (cap != null ? tierSeats.length >= cap : r >= fixedRows) break;
      }
      const rows = r;
      const tier = {
        index: tierIndex, key: tc.key, name: tc.name || null, config: tc, t,
        rows, d0, y0, blocks: nBlocks,
        dEnd: d0 + (rows - 1) * t.depth + t.depth / 2,
        yTop: y0 + (rows - 1) * t.rise,
        prevTop: prev ? prev.yTop : null,
        structure: t.rise !== 0, // flat floor-level rows (e.g. courtside) need no stand
      };
      stand.tiers.push(tier);

      // Number seats left-to-right within each block and row (boxes: within each box)
      tierSeats.sort((p, q) => p.r - q.r || p.block - q.block || p.s - q.s);
      let num = 0;
      let key = '';
      for (const c of tierSeats) {
        const k = tc.key === 'boxes' ? `${c.block}` : `${c.block}|${c.r}`;
        if (k !== key) { key = k; num = 0; }
        num += 1;
        const blockName = tc.sectionNames?.[c.block]
          || (tc.key === 'boxes' ? `Box ${(tc.firstBox ?? 1) + c.block}` : `Block ${LETTERS[c.block] || c.block + 1}`);
        const where = tc.sectionNames ? blockName : `${tc.name || stand.name} · ${blockName}`;
        const seat = {
          id: `${sc.id}:${tierIndex}:${c.block}:${c.r + 1}:${num}`,
          standId: sc.id, tierIndex, tierKey: tc.key, tierName: tc.name || null,
          block: blockName, row: c.r + 1, num, scale: t.scale,
          x: c.x, y: c.y, z: c.z, nx: c.nx, nz: c.nz,
          label: tc.key === 'boxes' ? `${where} · Seat ${num}` : `${where} · Row ${c.r + 1} · Seat ${num}`,
        };
        seats.push(seat);
        stand.seats.push(seat);
      }
      prev = tier;
    });

    stand.dEnd = prev.dEnd;
    stand.yTop = prev.yTop;
    stand.midIndex = idx[Math.floor(idx.length / 2)];
    maxD = Math.max(maxD, stand.dEnd);
    stands.push(stand);
  }

  return { base, a, b, stands, seats, maxD };
}

// Price of one seat for one match: tier price > stand price > default.
export function seatPrice(prices, seat) {
  return prices?.tiers?.[`${seat.standId}.${seat.tierKey}`] ?? prices?.stands?.[seat.standId] ?? prices?.default;
}
