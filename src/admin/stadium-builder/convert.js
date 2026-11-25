// Converts between the stadium config JSON (what the server and 3D engine use)
// and a simple form model for the visual builder. Unknown/advanced fields on the
// original config are kept, so editing in the builder never loses data.
//
// Angles: degrees clockwise seen from above, 0 = right-hand end of the map.
// On the builder map: 0 = East (right), 90 = South (bottom), 180 = West (left), 270 = North (top).

export const SPORTS = [
  { id: 'cricket', label: 'Cricket', hint: 'Oval ground with pitch, boundary rope and sight screens' },
  { id: 'football', label: 'Football', hint: 'Rectangular pitch with goals' },
  { id: 'basketball', label: 'Basketball', hint: 'Indoor arena with court and hoops' },
];

export const LEVEL_KINDS = [
  { id: 'normal', label: 'Regular seats' },
  { id: 'vip', label: 'VIP seats' },
  { id: 'boxes', label: 'Private boxes' },
  { id: 'floor', label: 'Floor seats (courtside)' },
];

export const FIELD_DEFAULTS = {
  cricket: { length: 140, width: 130, superellipse: 2 },
  football: { length: 124, width: 88, superellipse: 8 },
  basketball: { length: 36, width: 24, superellipse: 4 },
};
const FRONT_GAP = { cricket: 4, football: 3, basketball: 1 };
export const defaultFrontGap = (sport) => FRONT_GAP[sport] ?? 3;

export const norm = (a) => ((Math.round(a) % 360) + 360) % 360;
export const arcWidth = (from, to) => (norm(to) - norm(from) + 360) % 360 || 360;
const DIRS = ['East', 'South-East', 'South', 'South-West', 'West', 'North-West', 'North', 'North-East'];
export const direction = (a) => DIRS[Math.round(norm(a) / 45) % 8];
export const midAngle = (from, to) => norm(from + arcWidth(from, to) / 2);

export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '')
  .trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

let uidCounter = 0;
const uid = () => `u${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

function uniqueId(base, taken) {
  const root = slugify(base) || 'stand';
  let id = root;
  for (let i = 2; taken.has(id); i++) id = `${root}-${i}`;
  return id;
}

// ---- config → form ------------------------------------------------------------------

function levelKind(t) {
  if (t.key === 'boxes') return 'boxes';
  if (t.rise === 0) return 'floor';
  if (t.key === 'vvip') return 'vip';
  return 'normal';
}

export function toForm(config) {
  const sport = config.sport || 'cricket';
  return {
    raw: config,
    id: config.id || '',
    name: config.name || '',
    sport,
    city: config.city || '',
    country: config.country || '',
    field: { ...FIELD_DEFAULTS[sport], ...(config.field || {}) },
    stands: (config.stands || []).map((s) => {
      const tiers = s.tiers?.length ? s.tiers : [{ key: 'lower' }];
      const each = s.capacity ? Math.round(s.capacity / tiers.length) : 0;
      return {
        uid: uid(),
        isNew: false,
        raw: s,
        id: s.id,
        name: s.name || s.id,
        type: s.type === 'pavilion' ? 'pavilion' : 'stand',
        floors: s.floors || 4,
        from: norm(s.from ?? 0),
        to: norm(s.to ?? 40),
        roof: !!s.roof || !!config.extras?.roof?.stands?.includes(s.id),
        frontGap: s.frontGap ?? defaultFrontGap(sport),
        levels: tiers.map((t) => ({
          uid: uid(), raw: t, kind: levelKind(t), name: t.name || '', capacity: t.capacity ?? each, boxes: t.boxes || 12,
        })),
      };
    }),
    extras: {
      floodlights: typeof config.extras?.floodlights === 'object' ? (config.extras.floodlights.towers || 0) : (config.extras?.floodlights || 0),
      sightScreens: config.extras?.sightScreens !== false,
      indoor: !!config.extras?.indoor,
      scoreboard: !!config.extras?.scoreboard,
      screens: (config.extras?.screens || []).map((sc) => {
        const m = /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i.exec(sc.size || '');
        return { uid: uid(), raw: sc, standId: sc.inFrontOf || '', width: m ? +m[1] : 60, height: m ? +m[2] : 24 };
      }),
    },
  };
}

// ---- form → config ----------------------------------------------------------------------

const SHAPE_FIELDS = ['rise', 'depth', 'spacing', 'edge', 'scale', 'aisle'];

function levelToTier(level, index, levels) {
  const sameKind = level.raw && levelKind(level.raw) === level.kind;
  // Keep every advanced field; if the level type changed, drop its old shape settings
  const t = { ...(level.raw || {}) };
  for (const k of ['key', 'name', 'capacity', 'boxes', 'firstBox']) delete t[k];
  if (!sameKind) for (const k of SHAPE_FIELDS) delete t[k];
  const name = level.name.trim();
  const capacity = Math.max(0, Math.round(Number(level.capacity) || 0));
  const normalsBefore = levels.slice(0, index).filter((l) => l.kind === 'normal').length;
  const existingKey = sameKind ? level.raw.key : null;

  if (level.kind === 'normal') {
    t.key = existingKey || ['lower', 'upper'][normalsBefore] || `level-${normalsBefore + 1}`;
    if (!sameKind && normalsBefore > 0) t.rise = 0.55; // upper levels are steeper
  } else if (level.kind === 'vip') {
    t.key = existingKey || 'vvip';
  } else if (level.kind === 'boxes') {
    t.key = 'boxes';
    t.boxes = Math.max(1, Math.round(Number(level.boxes) || 1));
    const before = levels.slice(0, index).filter((l) => l.kind === 'boxes').reduce((n, l) => n + (Math.round(Number(l.boxes)) || 0), 0);
    if (before) t.firstBox = before + 1;
  } else if (level.kind === 'floor') {
    t.key = existingKey || 'floor';
    if (!sameKind) Object.assign(t, { rise: 0, depth: 1.0, spacing: 0.62, edge: 0.3, scale: 1.15 });
    t.rise = 0;
  }
  if (name) t.name = name;
  t.capacity = capacity;
  return t;
}

export function toConfig(form) {
  const keep = { ...(form.raw || {}) };
  const config = {
    ...keep,
    id: form.id,
    name: form.name.trim(),
    sport: form.sport,
    city: form.city.trim(),
    country: form.country.trim(),
    field: { ...(keep.field || {}), ...form.field },
  };
  if (!config.country) delete config.country;

  config.stands = form.stands.map((s) => {
    const st = { ...(s.raw || {}) };
    delete st.capacity; // capacities live on each level
    Object.assign(st, {
      id: s.id, name: s.name.trim() || s.id, from: norm(s.from), to: norm(s.to), frontGap: Number(s.frontGap),
    });
    if (s.type === 'pavilion') { st.type = 'pavilion'; st.floors = Math.max(1, Math.round(Number(s.floors) || 4)); } else { delete st.type; delete st.floors; }
    if (s.roof) st.roof = true; else delete st.roof;
    st.tiers = s.levels.map((l, i) => levelToTier(l, i, s.levels));
    return st;
  });

  const extras = { ...(keep.extras || {}) };
  if (form.extras.floodlights > 0) extras.floodlights = { ...(typeof extras.floodlights === 'object' ? extras.floodlights : {}), towers: Math.round(form.extras.floodlights) };
  else delete extras.floodlights;
  if (form.sport === 'cricket') extras.sightScreens = form.extras.sightScreens; else delete extras.sightScreens;
  if (form.extras.indoor) extras.indoor = true; else delete extras.indoor;
  if (form.extras.scoreboard) extras.scoreboard = true; else delete extras.scoreboard;
  const screens = form.extras.screens.filter((sc) => sc.standId).map((sc) => ({
    ...(sc.raw || {}), size: `${Math.round(sc.width)} x ${Math.round(sc.height)} ft`, inFrontOf: sc.standId,
  }));
  if (screens.length) extras.screens = screens; else delete extras.screens;
  // Old-style extras.roof.stands is replaced by the per-stand roof checkbox (notes are kept)
  if (extras.roof?.stands) extras.roof = { ...extras.roof, stands: [] };
  config.extras = extras;
  return config;
}

// ---- Editing helpers ------------------------------------------------------------------------

export function newLevel(kind = 'normal', capacity = 2000) {
  return { uid: uid(), raw: null, kind, name: '', capacity, boxes: 12 };
}

export function newStand(form, from, to, name) {
  const taken = new Set(form.stands.map((s) => s.id));
  const label = name || `Stand ${form.stands.length + 1}`;
  return {
    uid: uid(), isNew: true, raw: null, id: uniqueId(label, taken), name: label, type: 'stand', floors: 4,
    from: norm(from), to: norm(to), roof: false, frontGap: defaultFrontGap(form.sport), levels: [newLevel('normal', 3000)],
  };
}

// New stands keep their id in step with their name until the stadium is saved.
export function renameStand(form, stand, name) {
  if (!stand.isNew) return { ...stand, name };
  const taken = new Set(form.stands.filter((s) => s.uid !== stand.uid).map((s) => s.id));
  return { ...stand, name, id: uniqueId(name, taken) };
}

// Largest free arc between existing stands, as { from, to }.
export function freeArc(stands) {
  if (!stands.length) return { from: 340, to: 20 };
  const sorted = stands.map((s) => ({ from: norm(s.from), to: norm(s.to) })).sort((a, b) => a.from - b.from);
  let best = null;
  sorted.forEach((s, i) => {
    const next = sorted[(i + 1) % sorted.length];
    const gap = (next.from - s.to + 360) % 360;
    if (!best || gap > best.gap) best = { gap, start: s.to };
  });
  if (!best || best.gap < 8) return null;
  const width = Math.min(best.gap - 6, 60);
  const start = best.start + (best.gap - width) / 2;
  return { from: norm(start), to: norm(start + width) };
}

// Stands that overlap: same angles AND same distance from the field.
// (Courtside rows in front of a stand share its angles but not its distance, so they're fine.)
// `depth(stand)` returns [nearest, farthest] metres from the field edge, or null if unknown.
export function overlaps(stands, depth = () => null) {
  const covers = (s, a) => {
    const w = arcWidth(s.from, s.to);
    return ((norm(a) - norm(s.from) + 360) % 360) <= w;
  };
  const sameDepth = (A, B) => {
    const a = depth(A);
    const b = depth(B);
    return !a || !b || (a[0] < b[1] && b[0] < a[1]);
  };
  const out = new Set();
  for (let i = 0; i < stands.length; i++) {
    for (let j = i + 1; j < stands.length; j++) {
      const A = stands[i];
      const B = stands[j];
      if (!sameDepth(A, B)) continue;
      if (covers(A, B.from + 0.5) || covers(A, B.to - 0.5) || covers(B, A.from + 0.5) || covers(B, A.to - 0.5)) {
        out.add(A.uid);
        out.add(B.uid);
      }
    }
  }
  return out;
}

// ---- Starting layouts per sport ----------------------------------------------------------

const around = (centre, half) => ({ from: norm(centre - half), to: norm(centre + half) });

export function template(sport, name = 'New Ground') {
  const base = { id: slugify(name), name, sport, city: '', field: { ...FIELD_DEFAULTS[sport] } };
  if (sport === 'cricket') {
    const stands = DIRS.map((d, i) => ({
      id: slugify(`${d} stand`), name: `${d} Stand`, ...around(i * 45, 20), frontGap: 4,
      tiers: [{ key: 'lower', capacity: 3000 }],
    }));
    stands[0] = { ...stands[0], id: 'pavilion', name: 'Pavilion', type: 'pavilion', floors: 4, tiers: [{ key: 'vvip', name: 'Members', capacity: 1500 }, { key: 'boxes', name: 'Hospitality Boxes', capacity: 500, boxes: 12 }] };
    return { ...base, stands, extras: { floodlights: { towers: 6 }, sightScreens: true } };
  }
  if (sport === 'basketball') {
    return {
      ...base,
      stands: [
        { id: 'courtside-south', name: 'Courtside South', ...around(90, 42), frontGap: -2.2, tiers: [{ key: 'floor', name: 'Courtside South', capacity: 44, rise: 0, depth: 1, spacing: 0.62, edge: 0.3, scale: 1.15 }] },
        { id: 'courtside-north', name: 'Courtside North', ...around(270, 42), frontGap: -2.2, tiers: [{ key: 'floor', name: 'Courtside North', capacity: 44, rise: 0, depth: 1, spacing: 0.62, edge: 0.3, scale: 1.15 }] },
        { id: 'south-side', name: 'South Sideline', ...around(90, 53), frontGap: 1, tiers: [{ key: 'lower', name: 'South Lower', capacity: 2200 }, { key: 'upper', name: 'South Upper', capacity: 2600, rise: 0.55 }] },
        { id: 'west-end', name: 'West Baseline', ...around(180, 33), frontGap: 1, tiers: [{ key: 'lower', name: 'West Lower', capacity: 1500 }, { key: 'upper', name: 'West Upper', capacity: 1900, rise: 0.55 }] },
        { id: 'north-side', name: 'North Sideline', ...around(270, 53), frontGap: 1, tiers: [{ key: 'lower', name: 'North Lower', capacity: 2200 }, { key: 'upper', name: 'North Upper', capacity: 2600, rise: 0.55 }] },
        { id: 'east-end', name: 'East Baseline', ...around(0, 33), frontGap: 1, tiers: [{ key: 'lower', name: 'East Lower', capacity: 1500 }, { key: 'upper', name: 'East Upper', capacity: 1900, rise: 0.55 }] },
      ],
      extras: { indoor: true, scoreboard: true },
    };
  }
  return {
    ...base,
    stands: [
      { id: 'main-stand', name: 'Main Stand', ...around(90, 51), frontGap: 3, roof: true, type: 'pavilion', floors: 3, tiers: [{ key: 'lower', name: 'Main Lower', capacity: 5000 }, { key: 'boxes', name: 'Executive Boxes', capacity: 400, boxes: 16 }] },
      { id: 'west-end', name: 'West End', ...around(180, 33), frontGap: 3, roof: true, tiers: [{ key: 'lower', capacity: 6000, rise: 0.5 }] },
      { id: 'north-stand', name: 'North Stand', ...around(270, 51), frontGap: 3, roof: true, tiers: [{ key: 'lower', name: 'North Lower', capacity: 4500 }, { key: 'upper', name: 'North Upper', capacity: 4500, rise: 0.55 }] },
      { id: 'east-end', name: 'East End', ...around(0, 33), frontGap: 3, roof: true, tiers: [{ key: 'lower', capacity: 6000, rise: 0.5 }] },
    ],
    extras: { floodlights: { towers: 4 } },
  };
}
