// Generic stadium renderer. Seat layout (stands, tiers, seat positions and ids)
// comes from shared/layout.js, which the server also uses; this file only draws:
// field surface per sport, stands, pavilion, roofs, floodlights, screens.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeLayout, arcPoints, nearestIndex } from '../../shared/layout.js';
import {
  bandTexture, fieldTexture, pitchTexture, windowTexture, floodlightTexture, glowTexture, beamTexture,
} from './textures.js';

const DEG = Math.PI / 180;
const ds = THREE.DoubleSide;

// Small deterministic 0..1 noise per seat, for natural colour variation.
const jitter = (i) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// Point and unit tangent at arc length s along arcPoints() output.
function pointAtS(P, s) {
  let k = 0;
  while (k < P.n - 2 && P.s[k + 1] < s) k++;
  const f = (s - P.s[k]) / (P.s[k + 1] - P.s[k] || 1);
  const tx = P.x[k + 1] - P.x[k];
  const tz = P.z[k + 1] - P.z[k];
  const tl = Math.hypot(tx, tz) || 1;
  return { x: P.x[k] + tx * f, z: P.z[k] + tz * f, tx: tx / tl, tz: tz / tl };
}

// Collects box instances (position, yaw along a tangent, size) for one InstancedMesh.
class BoxInstances {
  constructor() { this.items = []; }

  add(x, y, z, tx, tz, sx, sy, sz) { this.items.push([x, y, z, Math.atan2(-tz, tx), sx, sy, sz]); }

  mesh(material) {
    if (!this.items.length) return null;
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, this.items.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    this.items.forEach(([x, y, z, yaw, sx, sy, sz], i) => {
      m.setMatrixAt(i, m4.compose(p.set(x, y, z), q.setFromAxisAngle(up, yaw), s.set(sx, sy, sz)));
    });
    m.computeBoundingSphere();
    return m;
  }
}

class Builder {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.idx = [];
  }

  // Quad strip between point sets A (at height yA) and B (at height yB).
  strip(A, yA, B, yB, uScale = 0, v0 = 0, v1 = 1) {
    const base = this.pos.length / 3;
    for (let i = 0; i < A.n; i++) {
      this.pos.push(A.x[i], yA, A.z[i], B.x[i], yB, B.z[i]);
      this.uv.push(A.s[i] * uScale, v0, A.s[i] * uScale, v1);
    }
    for (let i = 0; i < A.n - 1; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    return this;
  }

  quad(p0, p1, p2, p3) {
    const base = this.pos.length / 3;
    for (const p of [p0, p1, p2, p3]) this.pos.push(...p);
    this.uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

// Paint a whole geometry one vertex colour (multiplied by each seat's instance colour).
function tint(geo, value) {
  const n = geo.attributes.position.count;
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 3).fill(value), 3));
  return geo;
}

// Per-vertex shade from a height test, e.g. dark hair on the top of a head.
function tintBy(geo, fn) {
  const p = geo.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) c.fill(fn(p.getX(i), p.getY(i), p.getZ(i)), i * 3, i * 3 + 3);
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
const merge = (parts) => mergeGeometries(parts.map((g) => {
  const n = g.index ? g.toNonIndexed() : g;
  n.clearGroups();
  return n;
}));

// Seated spectator, same local frame as the chair (origin on the floor, facing +z).
// Body and head are separate meshes so the shirt colour and the skin tone can differ.
// Vertex colours: 1 = shirt/skin colour, lower = darker (trousers, hair).
function personGeometry(detail = 'near') {
  if (detail === 'far') {
    return {
      body: merge([tint(new THREE.BoxGeometry(0.38, 0.62, 0.3).translate(0, 0.78, -0.04), 1)]),
      head: merge([tintBy(new THREE.BoxGeometry(0.19, 0.22, 0.2).translate(0, 1.26, -0.05), (x, y) => (y > 1.33 ? 0.25 : 1))]),
    };
  }
  const torso = new THREE.CylinderGeometry(0.165, 0.19, 0.52, 6, 1, true).scale(1, 1, 0.62).translate(0, 0.86, -0.07);
  const body = merge([
    tint(torso, 1),
    tint(new THREE.BoxGeometry(0.34, 0.13, 0.4).translate(0, 0.535, 0.08), 0.3), // thighs (trousers)
    tint(new THREE.BoxGeometry(0.28, 0.44, 0.12).translate(0, 0.26, 0.26), 0.28), // lower legs
    tint(new THREE.BoxGeometry(0.085, 0.36, 0.1).translate(-0.225, 0.84, -0.04), 1), // upper arms
    tint(new THREE.BoxGeometry(0.085, 0.36, 0.1).translate(0.225, 0.84, -0.04), 1),
    tint(new THREE.BoxGeometry(0.08, 0.08, 0.27).translate(-0.17, 0.64, 0.08), 0.95), // forearms on the lap
    tint(new THREE.BoxGeometry(0.08, 0.08, 0.27).translate(0.17, 0.64, 0.08), 0.95),
  ]);
  const head = merge([
    tintBy(new THREE.SphereGeometry(0.105, 7, 5).scale(0.92, 1.08, 1).translate(0, 1.27, -0.05), (x, y, z) => (y > 1.3 || (z < -0.1 && y > 1.2) ? 0.22 : 1)),
    tint(new THREE.CylinderGeometry(0.048, 0.055, 0.1, 5, 1, true).translate(0, 1.15, -0.06), 1), // neck
  ]);
  return { body, head };
}

// Muted clothing so the crowd never competes with the bright price colours
const SHIRTS = ['#1f2a44', '#2b2f36', '#b9b6ae', '#3d4f63', '#5a3232', '#2f4a3a', '#6b6f78', '#15171b', '#7d6e52', '#2c3e66', '#4a3d5c', '#9a978f']
  .map((c) => new THREE.Color(c));
const SKINS = ['#8d5524', '#c68642', '#e0ac69', '#f1c27d', '#ffdbac', '#5c3a21', '#a86b3c', '#d29a6a'].map((c) => new THREE.Color(c));

// Show a spectator on every taken seat (called whenever availability changes).
// `clearAround`: a position; seats within 1.3 m of it stay empty (the viewer's
// neighbours and the person directly in front, whose heads would otherwise fill
// the view-from-seat).
const m4c = new THREE.Matrix4();
const qc = new THREE.Quaternion();
const upc = new THREE.Vector3(0, 1, 0);
const sc3 = new THREE.Vector3();
export function fillCrowd(stadium, clearAround = null) {
  for (const stand of stadium.stands.values()) {
    const crowd = stand.crowd;
    if (!crowd) continue;
    let k = 0;
    for (const s of stand.seats) {
      if (!s.taken) continue;
      if (clearAround && s.pos.distanceToSquared(clearAround) < 1.69) continue;
      const r = jitter(s.index * 3.7 + 1.3);
      qc.setFromAxisAngle(upc, Math.atan2(-s.outward.x, -s.outward.z) + (r - 0.5) * 0.35);
      m4c.compose(s.pos, qc, sc3.setScalar(0.92 + jitter(s.index * 5.1) * 0.16));
      crowd.body.setMatrixAt(k, m4c);
      crowd.head.setMatrixAt(k, m4c);
      crowd.body.setColorAt(k, SHIRTS[Math.floor(jitter(s.index * 7.3) * SHIRTS.length)]);
      crowd.head.setColorAt(k, SKINS[Math.floor(jitter(s.index * 11.9) * SKINS.length)]);
      k++;
    }
    for (const m of [crowd.body, crowd.head]) {
      m.count = k;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

// Stadium seat. 'high': moulded plastic bucket seat (curved pan + reclined back,
// rounded edges) on a dark metal pedestal. 'low': simple boxes for phones.
function chairGeometry(detail = 'high') {
  if (detail === 'far') {
    // Seen from far away a seat is a few pixels: seat pan + backrest only (24 triangles)
    return mergeGeometries([
      new THREE.BoxGeometry(0.46, 0.08, 0.42).translate(0, 0.44, 0.02),
      new THREE.BoxGeometry(0.46, 0.46, 0.07).translate(0, 0.68, -0.2),
    ].map((g) => tint(g, 1)));
  }
  if (detail === 'low') {
    const parts = [
      new THREE.BoxGeometry(0.46, 0.09, 0.42).translate(0, 0.44, 0.02),
      new THREE.BoxGeometry(0.46, 0.5, 0.07).translate(0, 0.72, -0.19),
      new THREE.BoxGeometry(0.05, 0.4, 0.34).translate(-0.2, 0.2, 0),
      new THREE.BoxGeometry(0.05, 0.4, 0.34).translate(0.2, 0.2, 0),
    ].map((g) => tint(g, 1));
    return mergeGeometries(parts);
  }
  // Side profile in (u = backwards, v = up); extruded across the seat width
  const s = new THREE.Shape();
  s.moveTo(-0.215, 0.405); // front lip, underside
  s.lineTo(-0.225, 0.455); // front lip, top
  s.lineTo(0.02, 0.448); // dip of the seat pan
  s.lineTo(0.12, 0.468); // back of the pan
  s.lineTo(0.175, 0.62); // lumbar curve
  s.lineTo(0.2, 0.9); // top of backrest, front
  s.lineTo(0.245, 0.89); // top of backrest, rear
  s.lineTo(0.215, 0.6);
  s.lineTo(0.165, 0.45);
  s.lineTo(0.11, 0.418);
  s.lineTo(-0.215, 0.405);
  const shell = new THREE.ExtrudeGeometry(s, {
    depth: 0.4, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.012, bevelSegments: 1, curveSegments: 1,
  });
  shell.rotateY(Math.PI / 2); // u → -z (front faces +z), extrusion → x
  shell.translate(-0.2, 0, 0);
  const pedestal = new THREE.BoxGeometry(0.07, 0.42, 0.07).translate(0, 0.21, -0.06);
  const foot = new THREE.BoxGeometry(0.2, 0.02, 0.16).translate(0, 0.01, -0.06);
  const parts = [tint(shell.toNonIndexed(), 1), tint(pedestal.toNonIndexed(), 0.22), tint(foot.toNonIndexed(), 0.22)];
  for (const p of parts) p.clearGroups();
  return mergeGeometries(parts);
}

function bandMesh(points, y0, y1, parts, opts) {
  const tex = bandTexture(parts, opts);
  const geo = new Builder().strip(points, y0, points, y1, 1 / (32 * (y1 - y0))).geometry();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.5, side: ds,
  }));
}

// ---------------------------------------------------------------------------
export function buildStadium(config, { quality = 'high' } = {}) {
  const group = new THREE.Group();
  group.name = config.id;
  const high = quality === 'high';
  const sport = config.sport || 'cricket';
  const field = config.field || {};
  const layout = computeLayout(config);
  const { base, a, b, maxD } = layout;

  // Treads (walked on, lighter) and risers/walls (vertical, darker) read as real concrete steps
  const concrete = new Builder();
  const risers = new Builder();
  const glass = new Builder();
  const rails = new Builder();
  const aisleSteps = new BoxInstances();
  const nosing = new BoxInstances();
  const structureMat = new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.92, side: ds });
  const riserMat = new THREE.MeshStandardMaterial({ color: '#181b20', roughness: 0.95, side: ds });
  // Level of detail: every stand starts with the light seat; the viewer swaps in
  // the detailed one for stands close to the camera (see StadiumViewer.updateDetail)
  const chairs = { near: chairGeometry(high ? 'high' : 'low'), far: chairGeometry('far') };
  // Spectators on taken seats (detailed figures only on 'high', near the camera)
  const farPeople = personGeometry('far');
  const people = { near: high ? personGeometry('near') : farPeople, far: farPeople };
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, vertexColors: true });
  const headMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, vertexColors: true });
  const chair = chairs.far;
  // Glossy moulded plastic; vertex colours keep the pedestal dark
  const seatMat = new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: high ? 0.38 : 0.55, metalness: 0, vertexColors: true,
  });
  const animated = [];
  const fx = []; // glow/beam effects: skipped by the ambient-occlusion pass
  const beams = []; // floodlight beams: only shown from high views (side-on they look like lines)
  const roofGroup = new THREE.Group();
  const roofStands = new Set([...(config.extras?.roof?.stands || []), ...config.stands.filter((s) => s.roof).map((s) => s.id)]);

  const stands = new Map();
  const seats = [];
  const seatById = new Map();
  const meshes = [];
  const screensPending = [];

  for (const ls of layout.stands) {
    const sc = ls.config;
    const { idx } = ls;
    const stand = {
      id: ls.id, name: ls.name, type: ls.type, config: sc, tiers: ls.tiers,
      seats: [], capacity: 0, available: 0, minPrice: null,
      dEnd: ls.dEnd, yTop: ls.yTop, midIndex: ls.midIndex,
    };

    for (const tier of ls.tiers) {
      const { t, rows, d0, y0, dEnd, yTop } = tier;
      if (tier.structure) {
        // Treads, risers, end walls, back wall
        const ends = [idx[0], idx[idx.length - 1]];
        for (let rr = 0; rr < rows; rr++) {
          const y = y0 + rr * t.rise;
          const dIn = rr === 0 ? d0 - t.depth / 2 - 0.3 : d0 + rr * t.depth - t.depth / 2;
          const dOut = d0 + rr * t.depth + t.depth / 2;
          const A = arcPoints(base, idx, dIn);
          concrete.strip(A, y, arcPoints(base, idx, dOut), y);
          if (rr > 0) risers.strip(A, y - t.rise, A, y);
          for (const k of ends) {
            const p = (d, yy) => [base.px[k] + base.nx[k] * d, yy, base.pz[k] + base.nz[k] * d];
            risers.quad(p(dIn, 0), p(dOut, 0), p(dOut, y), p(dIn, y));
          }

          // Aisle stairs between seat blocks: a half-height step on each row plus
          // yellow safety edges, at the same block boundaries the seats use
          if (high) {
            const dc = d0 + rr * t.depth;
            const P = arcPoints(base, idx, dc);
            const L = P.s[P.n - 1];
            const usable = L - 2 * t.edge;
            const blockLen = usable / tier.blocks;
            // Stairs between blocks, plus side stairs in the walkway at each end of the stand
            const spots = [];
            for (let k = 1; k < tier.blocks; k++) spots.push([t.edge + k * blockLen, Math.max(0.6, t.aisle * 0.85)]);
            if (t.edge >= 0.8) spots.push([t.edge / 2, t.edge * 0.8], [L - t.edge / 2, t.edge * 0.8]);
            for (const [sAt, w] of spots) {
              const at = pointAtS(P, sAt);
              // Outward normal at this point = tangent rotated 90° (same rule as the base curve)
              const nx = at.tz;
              const nz = -at.tx;
              const place = (dd, yy, h, depth, list) => list.add(at.x + nx * dd, yy, at.z + nz * dd, at.tx, at.tz, w, h, depth);
              // Light tread for the aisle at this row, a half-height step on its back half
              place(0, y + 0.01, 0.02, t.depth, aisleSteps);
              if (rr < rows - 1 && t.rise > 0) place(t.depth / 4, y + t.rise / 4, t.rise / 2, t.depth / 2, aisleSteps);
              place(-t.depth / 2 + 0.05, y + 0.024, 0.012, 0.1, nosing);
              if (rr < rows - 1 && t.rise > 0) place(0.05, y + t.rise / 2 + 0.006, 0.012, 0.1, nosing);
            }
          }
        }
        const back = arcPoints(base, idx, dEnd);
        risers.strip(back, 0, back, yTop + 1.1);

        // Glass safety barrier with a metal top rail along the front of upper tiers
        if (high && tier.prevTop != null) {
          const front = arcPoints(base, idx, d0 - t.depth / 2 - 0.3);
          glass.strip(front, y0, front, y0 + 0.95);
          rails.strip(front, y0 + 0.95, arcPoints(base, idx, d0 - t.depth / 2 - 0.22), y0 + 0.95);
        }

        // Front fascia LED band with the tier/stand name
        const fasciaD = d0 - t.depth / 2 - 0.3;
        const fy0 = tier.prevTop != null ? tier.prevTop + 0.4 : 0;
        const label = (tier.name || sc.name).toUpperCase();
        group.add(bandMesh(arcPoints(base, idx, fasciaD), fy0, y0, [[label, 'fg'], ['◆', 'dim']],
          sc.type === 'pavilion' ? { bg: '#14100a', fg: '#f0c46a' } : undefined));
      }
      if (roofStands.has(sc.id) && tier === ls.tiers[ls.tiers.length - 1]) {
        const roofY = yTop + 10;
        const roofGeo = new Builder()
          .strip(arcPoints(base, idx, d0 - 4), roofY, arcPoints(base, idx, dEnd + 1), roofY + 1.5)
          .geometry();
        const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({
          color: '#d9dde3', roughness: 0.35, metalness: 0.5, side: ds, transparent: true,
        }));
        roof.castShadow = true;
        roofGroup.add(roof);
      }
    }

    if (sc.type === 'pavilion') {
      const building = pavilionBuilding(base, idx, stand, sc);
      building.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      group.add(building);
    }

    // Seats: one instanced mesh per stand (cheap ray tests via per-stand bounding sphere)
    const mesh = new THREE.InstancedMesh(chair, seatMat, ls.seats.length);
    mesh.userData.stand = stand;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const sv = new THREE.Vector3();
    ls.seats.forEach((ss, i) => {
      const seat = {
        ...ss,
        index: seats.length, local: i, mesh, stand,
        pos: new THREE.Vector3(ss.x, ss.y, ss.z),
        outward: new THREE.Vector3(ss.nx, 0, ss.nz),
        shade: 0.9 + jitter(seats.length) * 0.14, // slight per-seat colour variation (fading, dust)
        price: 0, taken: false,
      };
      q.setFromAxisAngle(up, Math.atan2(-ss.nx, -ss.nz));
      m4.compose(seat.pos, q, sv.setScalar(ss.scale));
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, new THREE.Color('#888'));
      seats.push(seat);
      stand.seats.push(seat);
      seatById.set(seat.id, seat);
    });
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true; // seats receive stand/roof shadows; they don't cast (too costly)
    group.add(mesh);
    meshes.push(mesh);

    // Crowd for this stand: one slot per seat, filled by fillCrowd() with the taken seats.
    // Bounding spheres are computed with a person on every seat so culling stays correct.
    const body = new THREE.InstancedMesh(people.far.body, bodyMat, ls.seats.length);
    const head = new THREE.InstancedMesh(people.far.head, headMat, ls.seats.length);
    const white = new THREE.Color('#ffffff');
    stand.seats.forEach((s, i) => {
      mesh.getMatrixAt(i, m4);
      body.setMatrixAt(i, m4);
      head.setMatrixAt(i, m4);
      body.setColorAt(i, white);
      head.setColorAt(i, white);
    });
    body.computeBoundingSphere();
    head.computeBoundingSphere();
    body.count = 0;
    head.count = 0;
    body.receiveShadow = true;
    head.receiveShadow = true;
    stand.crowd = { body, head };
    group.add(body, head);

    // Camera framing for the stand view
    stand.capacity = stand.seats.length;
    const center = new THREE.Vector3();
    const outward = new THREE.Vector3();
    for (const s of stand.seats) {
      center.add(s.pos);
      outward.add(s.outward);
    }
    center.divideScalar(stand.seats.length || 1);
    outward.setY(0).normalize();
    const f0 = arcPoints(base, idx, ls.tiers[0].d0);
    const width = Math.hypot(f0.x[f0.n - 1] - f0.x[0], f0.z[f0.n - 1] - f0.z[0]);
    const backOff = THREE.MathUtils.clamp(width * 1.1, 40, 120);
    stand.center = center;
    stand.camTarget = center.clone();
    stand.camPos = center.clone().addScaledVector(outward, -backOff).add(new THREE.Vector3(0, 4 + stand.yTop * 0.5, 0));
    stands.set(stand.id, stand);
  }

  const treadMesh = new THREE.Mesh(concrete.geometry(), structureMat);
  const riserMesh = new THREE.Mesh(risers.geometry(), riserMat);
  for (const m of [treadMesh, riserMesh]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  if (glass.idx.length) {
    const glassMesh = new THREE.Mesh(glass.geometry(), new THREE.MeshStandardMaterial({
      color: '#a9c8e8', transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.2, side: ds, depthWrite: false,
    }));
    group.add(glassMesh);
    fx.push(glassMesh);
    group.add(new THREE.Mesh(rails.geometry(), new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: 0.3, metalness: 0.8, side: ds })));
  }
  // Aisles read as lighter stripes running up the stand, with bright yellow step edges
  const steps = aisleSteps.mesh(new THREE.MeshStandardMaterial({ color: '#5a606b', roughness: 0.85 }));
  if (steps) { steps.receiveShadow = true; group.add(steps); }
  const edges = nosing.mesh(new THREE.MeshStandardMaterial({ color: '#e9b92c', emissive: '#1e1600', roughness: 0.7 }));
  if (edges) group.add(edges);
  group.add(roofGroup);

  // ---- Field ---------------------------------------------------------------
  const shape = new THREE.Shape();
  for (let k = 0; k < base.M; k++) {
    if (k === 0) shape.moveTo(base.px[k], -base.pz[k]);
    else shape.lineTo(base.px[k], -base.pz[k]);
  }
  const surface = fieldTexture(sport, 2 * a, 2 * b);
  surface.repeat.set(1 / (2 * a), 1 / (2 * b));
  surface.offset.set(0.5, 0.5);
  const fieldMesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: surface, roughness: sport === 'basketball' ? 0.35 : 0.95 }),
  );
  fieldMesh.position.y = 0.05;
  fieldMesh.receiveShadow = true;
  group.add(fieldMesh);

  const all = [...Array(base.M).keys(), 0];
  const indoor = sport === 'basketball' || config.extras?.indoor;
  const surroundMesh = new THREE.Mesh(
    new Builder().strip(arcPoints(base, all, 0), 0.0, arcPoints(base, all, 4.5), 0.0).geometry(),
    new THREE.MeshStandardMaterial({ color: indoor ? '#11151d' : '#244a2a', roughness: 1, side: ds }),
  );
  surroundMesh.receiveShadow = true;
  group.add(surroundMesh);

  // LED advertising boards around the playing area (outdoor grounds), scrolling slowly
  if (high && !indoor) {
    const boardD = Math.min(1.2, ...config.stands.map((s) => (s.frontGap ?? 4) - 1.2));
    if (boardD > 0.2) {
      const tex = bandTexture([
        ['MATCH TICKETS', 'fg'], ['BOOK YOUR EXACT SEAT ONLINE', 'accent'], ['◆', 'dim'],
        ['SEE THE VIEW BEFORE YOU BUY', 'fg'], ['◆', 'dim'],
      ], { bg: '#04060a', fg: '#ffffff', accent: '#f5c451' });
      const ring = arcPoints(base, all, boardD);
      const boardGeo = new Builder().strip(ring, 0.05, ring, 0.95, 1 / (32 * 0.9)).geometry();
      // Strip faces point outward, so the field-facing (inner) side is the back side:
      // the LED text faces the field; spectators behind see a plain dark back.
      const face = new THREE.Mesh(boardGeo, new THREE.MeshStandardMaterial({
        map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.9, roughness: 0.4, side: THREE.BackSide,
      }));
      const back = new THREE.Mesh(boardGeo, new THREE.MeshStandardMaterial({ color: '#15181d', roughness: 0.8, side: THREE.FrontSide }));
      group.add(face, back);
      animated.push({ texture: tex, speed: 0.012 });
    }
  }
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(600, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#0a0d0b', roughness: 1 }),
  );
  ground.position.y = -0.6;
  group.add(ground);

  if (sport === 'cricket') addCricketField(group, base, all, field, config);
  if (sport === 'football') addGoals(group);
  if (sport === 'basketball') addHoops(group);

  // Indoor venues get a full roof (faded from above like other roofs)
  if (indoor) {
    const roofH = maxD * 0.55 + 16;
    const wall = arcPoints(base, all, maxD + 0.6);
    const shell = new Builder().strip(wall, 0, wall, roofH).geometry();
    group.add(new THREE.Mesh(shell, new THREE.MeshStandardMaterial({ color: '#0d1015', roughness: 1, side: ds })));
    const capShape = new THREE.Shape();
    for (let i = 0; i < wall.n; i++) {
      if (i === 0) capShape.moveTo(wall.x[i], -wall.z[i]);
      else capShape.lineTo(wall.x[i], -wall.z[i]);
    }
    const cap = new THREE.Mesh(
      new THREE.ShapeGeometry(capShape, 1).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#0b0d12', roughness: 1, side: ds, transparent: true }),
    );
    cap.position.y = roofH;
    roofGroup.add(cap);
  }
  if (config.extras?.scoreboard) {
    const mat = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveIntensity: 0.9, transparent: true });
    const body = new THREE.MeshStandardMaterial({ color: '#0b0d12', transparent: true });
    const box = new THREE.Mesh(new THREE.BoxGeometry(8, 4.5, 8), [mat, mat, body, body, mat, mat]);
    box.position.y = 17;
    roofGroup.add(box);
    screensPending.push({ mesh: box, material: mat, aspect: 8 / 4.5 });
  }

  // ---- Floodlights -----------------------------------------------------------
  const fl = config.extras?.floodlights;
  const towers = typeof fl === 'object' ? fl.towers : fl;
  const lamps = [];
  if (towers) {
    const headTex = floodlightTexture();
    const glow = high ? glowTexture() : null;
    const beam = high ? beamTexture() : null;
    const poleMat = new THREE.MeshStandardMaterial({ color: '#5d646e', metalness: 0.6, roughness: 0.45 });
    const headMat = new THREE.MeshStandardMaterial({
      map: headTex, emissiveMap: headTex, emissive: '#ffffff', emissiveIntensity: 2.2,
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: '#2a2e35', metalness: 0.6, roughness: 0.5 });
    for (let i = 0; i < towers; i++) {
      const angle = (360 / towers) * i + 180 / towers;
      const k = nearestIndex(base, angle);
      const d = maxD + 8;
      const x = base.px[k] + base.nx[k] * d;
      const z = base.pz[k] + base.nz[k] * d;
      const h = 55;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.4, h, 10), poleMat);
      pole.position.set(x, h / 2, z);
      pole.castShadow = true;
      const head = new THREE.Mesh(new THREE.BoxGeometry(12, 7, 1), headMat);
      head.position.set(x, h + 2, z);
      head.lookAt(0, 0, 0);
      // Dark frame behind the lamp panel
      const frame = new THREE.Mesh(new THREE.BoxGeometry(12.8, 7.8, 0.8), frameMat);
      frame.position.copy(head.position).addScaledVector(new THREE.Vector3(x, 0, z).normalize(), 0.7);
      frame.quaternion.copy(head.quaternion);
      group.add(pole, head, frame);
      lamps.push(new THREE.Vector3(x, h + 2, z));

      if (high) {
        // Soft glow around the lamps
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glow, color: '#fff6e0', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        sprite.position.copy(head.position).addScaledVector(new THREE.Vector3(-x, 0, -z).normalize(), 1.5);
        sprite.scale.setScalar(34);
        group.add(sprite);
        fx.push(sprite);
        // Faint light beam towards the field (brightest at the lamp)
        const lamp = head.position.clone();
        const target = new THREE.Vector3(x * 0.25, 0, z * 0.25);
        const len = lamp.distanceTo(target);
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(len * 0.22, len, 24, 1, true),
          new THREE.MeshBasicMaterial({
            map: beam, transparent: true, opacity: 0.028, blending: THREE.AdditiveBlending, depthWrite: false, side: ds, fog: false,
          }),
        );
        cone.position.copy(lamp).lerp(target, 0.5);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), lamp.clone().sub(target).normalize());
        group.add(cone);
        fx.push(cone);
        beams.push(cone);
      }
    }
  }

  // ---- Big screens -------------------------------------------------------------
  const screens = [...screensPending];
  for (const sc of config.extras?.screens || []) {
    const stand = stands.get(sc.inFrontOf);
    if (!stand) continue;
    const m = /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*ft/i.exec(sc.size || '');
    const w = m ? +m[1] * 0.3048 : 20;
    const h = m ? +m[2] * 0.3048 : 8;
    const k = stand.midIndex;
    const d = stand.dEnd + 1.5;
    const mat = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveIntensity: 1 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    screen.position.set(base.px[k] + base.nx[k] * d, stand.yTop + h / 2 + 2.5, base.pz[k] + base.nz[k] * d);
    screen.rotation.y = Math.atan2(-base.nx[k], -base.nz[k]);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, h + 0.8, 0.6), structureMat);
    frame.position.copy(screen.position).addScaledVector(new THREE.Vector3(base.nx[k], 0, base.nz[k]), 0.35);
    frame.rotation.y = screen.rotation.y;
    group.add(frame, screen);
    screens.push({ mesh: screen, material: mat, aspect: w / h });
  }

  return {
    config, group, stands, seats, seatById, meshes, roofGroup, screens, animated, lamps, indoor, fx, chairs, beams, people,
    extent: Math.max(a, b) + maxD + 12,
  };
}

function addGoals(group) {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.2 });
  const net = new THREE.MeshStandardMaterial({ color: '#dfe6ee', transparent: true, opacity: 0.25, side: ds });
  for (const s of [-1, 1]) {
    const x = s * 52.5;
    const post = (z) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.44, 8), mat);
      p.position.set(x, 1.22, z);
      return p;
    };
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.32, 8).rotateX(Math.PI / 2), mat);
    bar.position.set(x, 2.44, 0);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(7.32, 2.44).rotateY(Math.PI / 2), net);
    back.position.set(x + s * 2, 1.22, 0);
    group.add(post(-3.66), post(3.66), bar, back);
  }
}

function addHoops(group) {
  const dark = new THREE.MeshStandardMaterial({ color: '#15171c', roughness: 0.6 });
  const pad = new THREE.MeshStandardMaterial({ color: '#1c2b4a', roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: '#dfe8f5', transparent: true, opacity: 0.35, roughness: 0.1 });
  const rimMat = new THREE.MeshStandardMaterial({ color: '#ff6a1a', emissive: '#ff4a00', emissiveIntensity: 0.3 });
  for (const s of [-1, 1]) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 2.0), pad);
    base.position.set(s * 16.1, 0.5, 0);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.0, 0.25), dark);
    pole.position.set(s * 16.1, 2.5, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.2, 0.2), dark);
    arm.position.set(s * 14.7, 3.6, 0);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, 1.8), glass);
    board.position.set(s * 13.13, 3.45, 0);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.02, 8, 24).rotateX(Math.PI / 2), rimMat);
    rim.position.set(s * 12.75, 3.05, 0);
    group.add(base, pole, arm, board, rim);
  }
}

// Boundary rope, 22-yard pitch with stumps, and sight screens.
function addCricketField(group, base, all, field, config) {
  const rope = arcPoints(base, all, -3);
  const ropePts = [];
  for (let i = 0; i < rope.n - 1; i += 4) ropePts.push(new THREE.Vector3(rope.x[i], 0.12, rope.z[i]));
  group.add(new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ropePts, true), 400, 0.12, 6, true),
    new THREE.MeshStandardMaterial({ color: '#f4f4f4', emissive: '#ffffff', emissiveIntensity: 0.15 }),
  ));

  const pitchGroup = new THREE.Group();
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 3.05).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 0.9 }),
  );
  pitch.position.y = 0.09;
  pitchGroup.add(pitch);
  const stumpMat = new THREE.MeshStandardMaterial({ color: '#f3efe3', roughness: 0.5 });
  for (const side of [-1, 1]) {
    for (const z of [-0.11, 0, 0.11]) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.71, 8), stumpMat);
      st.position.set(side * 10.06, 0.37, z);
      pitchGroup.add(st);
    }
  }
  pitchGroup.rotation.y = -(field.pitchAngle || 0) * DEG;
  group.add(pitchGroup);

  if (config.extras?.sightScreens !== false) {
    const pa = field.pitchAngle || 0;
    for (const angle of [pa, pa + 180]) {
      const k = nearestIndex(base, angle % 360);
      const pos = new THREE.Vector3(base.px[k] + base.nx[k] * 1.6, 3.2, base.pz[k] + base.nz[k] * 1.6);
      const ss = new THREE.Mesh(
        new THREE.BoxGeometry(14, 6.4, 0.4),
        new THREE.MeshStandardMaterial({ color: '#f2f2ee', emissive: '#ffffff', emissiveIntensity: 0.12 }),
      );
      ss.position.copy(pos);
      ss.rotation.y = Math.atan2(base.nx[k], base.nz[k]);
      group.add(ss);
    }
  }
}

// Multi-storey pavilion block behind the pavilion's seating.
function pavilionBuilding(base, idx, stand, sc) {
  const floors = sc.floors || 4;
  const H = Math.max(stand.yTop + 5, floors * 4.2);
  const d0 = stand.dEnd + 0.3;
  const d1 = d0 + 16;
  const g = new THREE.Group();
  const front = arcPoints(base, idx, d0);
  const win = windowTexture();
  const facade = new Builder().strip(front, stand.yTop + 1.1, front, H, 1 / 8, 0, (H - stand.yTop - 1.1) / 4.2).geometry();
  g.add(new THREE.Mesh(facade, new THREE.MeshStandardMaterial({
    map: win, emissiveMap: win, emissive: '#ffffff', emissiveIntensity: 0.7, roughness: 0.2, metalness: 0.4, side: ds,
  })));
  const shell = new Builder();
  const backPts = arcPoints(base, idx, d1);
  shell.strip(front, H, backPts, H).strip(backPts, 0, backPts, H);
  for (const k of [idx[0], idx[idx.length - 1]]) {
    const p = (d, y) => [base.px[k] + base.nx[k] * d, y, base.pz[k] + base.nz[k] * d];
    shell.quad(p(d0, 0), p(d1, 0), p(d1, H), p(d0, H));
  }
  // Off-white cladding, dark enough not to blow out under the floodlights + bloom
  g.add(new THREE.Mesh(shell.geometry(), new THREE.MeshStandardMaterial({ color: '#9c988f', roughness: 0.8, side: ds })));
  const lip = new Builder().strip(arcPoints(base, idx, d0 - 3), H, arcPoints(base, idx, d0), H).geometry();
  g.add(new THREE.Mesh(lip, new THREE.MeshStandardMaterial({ color: '#b3aea4', roughness: 0.6, side: ds })));
  return g;
}

export function disposeStadium(stadium) {
  stadium.chairs?.near.dispose();
  stadium.chairs?.far.dispose();
  for (const g of [stadium.people?.near, stadium.people?.far]) {
    g?.body.dispose();
    g?.head.dispose();
  }
  stadium.group.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) {
      for (const key of ['map', 'emissiveMap']) m[key]?.dispose();
      m.dispose();
    }
  });
}
