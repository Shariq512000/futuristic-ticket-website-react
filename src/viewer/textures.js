// Procedural canvas textures: grass, pitch, LED ribbon bands, big screens, pavilion glass.
import * as THREE from 'three';

const FONT = '"Inter", "Segoe UI", Arial, sans-serif';

export function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2147483646) + 1;
}

function makeTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Outfield grass for a field of length L (x) by W (z) metres, with mowing
// stripes and the 30-yard circle painted on.
function drawGrass(g, w, h, L, stripeM = 9) {
  const stripes = Math.round(L / stripeM);
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? '#2d6a34' : '#367a3c';
    g.fillRect((i * w) / stripes, 0, w / stripes + 1, h);
  }
  const rnd = rng(5);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},0.035)`;
    g.fillRect(rnd() * w, rnd() * h, 3, 3);
  }
}

// Field surface for a field area L (x) by W (z) metres, by sport.
export function fieldTexture(sport, L, W) {
  if (sport === 'football') return footballTexture(L, W);
  if (sport === 'basketball') return courtTexture(L, W);
  return cricketTexture(L, W);
}

function cricketTexture(L, W) {
  const w = 2048;
  const h = Math.round((w * W) / L);
  return makeTexture(w, h, (g) => {
    const sx = w / L;
    const sy = h / W;
    drawGrass(g, w, h, L);
    // 30-yard (27.43 m) fielding circle
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineWidth = 0.22 * sx;
    g.setLineDash([1.2 * sx, 0.9 * sx]);
    g.beginPath();
    g.ellipse(w / 2, h / 2, 27.43 * sx, 27.43 * sy, 0, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  });
}

// Standard 105 x 68 m pitch markings centred in the field area.
function footballTexture(L, W) {
  const w = 2048;
  const h = Math.round((w * W) / L);
  return makeTexture(w, h, (g) => {
    const S = w / L;
    drawGrass(g, w, h, L, 105 / 14);
    const cx = w / 2;
    const cy = h / 2;
    const X = (m) => cx + m * S;
    const Y = (m) => cy + m * S;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 0.12 * S;
    g.strokeRect(X(-52.5), Y(-34), 105 * S, 68 * S);
    g.beginPath();
    g.moveTo(cx, Y(-34));
    g.lineTo(cx, Y(34));
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, 9.15 * S, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(cx, cy, 0.25 * S, 0, Math.PI * 2);
    g.fill();
    for (const s of [-1, 1]) {
      const gx = s * 52.5;
      // penalty area, goal area, penalty spot, arc
      g.strokeRect(Math.min(X(gx), X(gx - s * 16.5)), Y(-20.16), 16.5 * S, 40.32 * S);
      g.strokeRect(Math.min(X(gx), X(gx - s * 5.5)), Y(-9.16), 5.5 * S, 18.32 * S);
      g.beginPath();
      g.arc(X(gx - s * 11), cy, 0.25 * S, 0, Math.PI * 2);
      g.fill();
      const a = Math.acos(5.5 / 9.15);
      g.beginPath();
      if (s > 0) g.arc(X(gx - 11), cy, 9.15 * S, Math.PI - a, Math.PI + a);
      else g.arc(X(gx + 11), cy, 9.15 * S, -a, a);
      g.stroke();
      for (const t of [-1, 1]) {
        g.beginPath();
        g.arc(X(gx), Y(t * 34), 1 * S, 0, Math.PI * 2);
        g.stroke();
      }
    }
  });
}

// 28.65 x 15.24 m hardwood court centred in a dark arena floor.
function courtTexture(L, W) {
  const w = 2048;
  const h = Math.round((w * W) / L);
  return makeTexture(w, h, (g) => {
    const S = w / L;
    const CL = 28.65;
    const CW = 15.24;
    g.fillStyle = '#15213a';
    g.fillRect(0, 0, w, h);
    const x0 = w / 2 - (CL * S) / 2;
    const y0 = h / 2 - (CW * S) / 2;
    const rnd = rng(11);
    for (let y = y0; y < y0 + CW * S; y += 0.11 * S) {
      let x = x0 - rnd() * 200;
      while (x < x0 + CL * S) {
        const len = 160 + rnd() * 260;
        g.fillStyle = `hsl(${28 + rnd() * 4}, ${42 + rnd() * 8}%, ${55 + rnd() * 8}%)`;
        const xa = Math.max(x, x0);
        const xb = Math.min(x + len - 2, x0 + CL * S);
        if (xb > xa) g.fillRect(xa, y + 1, xb - xa, 0.11 * S - 1);
        x += len;
      }
    }
    const m = (v) => v * S;
    g.strokeStyle = '#f4f1ea';
    g.lineWidth = m(0.05);
    const navy = '#1c2b4a';
    g.save();
    g.translate(x0, y0);
    const end = () => {
      g.fillStyle = navy;
      g.fillRect(0, m(CW / 2 - 2.45), m(5.8), m(4.9));
      g.strokeRect(0, m(CW / 2 - 2.45), m(5.8), m(4.9));
      g.beginPath();
      g.arc(m(5.8), m(CW / 2), m(1.8), -Math.PI / 2, Math.PI / 2);
      g.stroke();
      const cy = CW / 2 - 0.9;
      const a = Math.asin(cy / 6.75);
      g.beginPath();
      g.moveTo(0, m(0.9));
      g.lineTo(m(1.575 + Math.sqrt(6.75 ** 2 - cy ** 2)), m(0.9));
      g.arc(m(1.575), m(CW / 2), m(6.75), -a, a);
      g.lineTo(0, m(CW - 0.9));
      g.stroke();
    };
    end();
    g.save();
    g.translate(m(CL), 0);
    g.scale(-1, 1);
    end();
    g.restore();
    g.strokeRect(0, 0, m(CL), m(CW));
    g.beginPath();
    g.moveTo(m(CL / 2), 0);
    g.lineTo(m(CL / 2), m(CW));
    g.stroke();
    g.fillStyle = navy;
    g.beginPath();
    g.arc(m(CL / 2), m(CW / 2), m(1.8), 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
  });
}

// 22-yard pitch strip: 24 m along x, 3.05 m across.
export function pitchTexture() {
  const L = 24;
  const W = 3.05;
  return makeTexture(1024, 130, (g, w, h) => {
    const sx = w / L;
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, '#b89d68');
    grd.addColorStop(0.5, '#cfb784');
    grd.addColorStop(1, '#b89d68');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    const rnd = rng(9);
    for (let i = 0; i < 1500; i++) {
      g.fillStyle = 'rgba(90,60,30,0.08)';
      g.fillRect(rnd() * w, rnd() * h, 2, 2);
    }
    g.strokeStyle = '#ffffff';
    g.lineWidth = 0.05 * sx;
    const x = (m) => w / 2 + m * sx;
    for (const side of [-1, 1]) {
      // bowling crease, popping crease, return creases
      g.beginPath();
      g.moveTo(x(side * 10.06), h * 0.12);
      g.lineTo(x(side * 10.06), h * 0.88);
      g.moveTo(x(side * 11.28), 0);
      g.lineTo(x(side * 11.28), h);
      g.moveTo(x(side * 9.6), h * 0.12);
      g.lineTo(x(side * 11.28), h * 0.12);
      g.moveTo(x(side * 9.6), h * 0.88);
      g.lineTo(x(side * 11.28), h * 0.88);
      g.stroke();
    }
  });
}

// A seamless horizontal LED ribbon. `parts` = [[text, 'fg' | 'accent' | 'dim'], ...]
export function bandTexture(parts, { bg = '#07080b', fg = '#f2f2f2', accent = '#9aa4b2' } = {}) {
  const t = makeTexture(2048, 64, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.font = `800 29px ${FONT}`;
    g.textBaseline = 'middle';
    try { g.letterSpacing = '3px'; } catch { /* older canvas */ }
    const gap = 36;
    const widths = parts.map(([s]) => g.measureText(s).width);
    const cycle = widths.reduce((a, b) => a + b + gap, 0);
    const reps = Math.max(1, Math.round(w / cycle));
    g.save();
    g.scale(w / (reps * cycle), 1);
    let x = gap / 2;
    for (let r = 0; r < reps; r++) {
      parts.forEach(([s, kind], i) => {
        g.fillStyle = kind === 'accent' ? accent : kind === 'dim' ? '#596070' : fg;
        g.fillText(s, x, h / 2 + 1);
        x += widths[i] + gap;
      });
    }
    g.restore();
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, h - 2, w, 2);
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// Big screen content for the current match.
export function screenTexture(match, stadium, aspect = 2.6) {
  const w = 1024;
  const h = Math.round(w / aspect);
  return makeTexture(w, h, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#0c2a1a');
    grd.addColorStop(1, '#04100a');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(120,255,170,0.35)';
    g.lineWidth = 6;
    g.strokeRect(10, 10, w - 20, h - 20);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const s = Math.min(1, h / 390);
    g.fillStyle = '#ffffff';
    g.font = `800 ${Math.round(110 * s)}px ${FONT}`;
    g.fillText(match.short, w / 2, h * 0.42);
    g.fillStyle = '#9fe0b8';
    g.font = `600 ${Math.round(40 * s)}px ${FONT}`;
    g.fillText(`${match.stage.toUpperCase()} · ${stadium.name.toUpperCase()}`, w / 2, h * 0.72);
  });
}

// Lit glass facade, tiled per floor.
export function windowTexture() {
  const t = makeTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#0b1016';
    g.fillRect(0, 0, w, h);
    const rnd = rng(3);
    for (let x = 0; x < 4; x++) {
      const warm = rnd();
      g.fillStyle = warm < 0.7 ? `rgba(255,${200 + Math.round(rnd() * 40)},150,${0.55 + rnd() * 0.4})` : 'rgba(120,160,200,0.25)';
      g.fillRect(x * 64 + 4, 40, 56, 180);
    }
    g.fillStyle = '#2a3038';
    g.fillRect(0, 0, w, 24);
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function floodlightTexture() {
  return makeTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#20242b';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 8; x++) {
        g.fillStyle = '#fffdf2';
        g.fillRect(8 + x * 31, 8 + y * 30, 24, 22);
      }
    }
  });
}
