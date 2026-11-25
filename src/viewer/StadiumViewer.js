// Imperative three.js scene for the match page. React owns the UI around it
// (bar, legend, tooltip, checkout); this class owns the canvas, camera, seat
// colours and picking, and reports changes through callbacks:
//   onChange()                       — mode / focus / selection / availability changed
//   onHover(info, x, y)              — info: { kind: 'stand'|'seat'|'other', stand, seat } or null
//   onSeatArrived()                  — the camera reached the chosen seat
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { gsap } from 'gsap';
import { buildStadium, disposeStadium } from './stadium.js';
import { screenTexture } from './textures.js';
import { seatPrice } from '../../shared/layout.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const PALETTE = ['#2fa35f', '#2f86e0', '#8b5cf6', '#e0a43a', '#e2574c'];
const COL = { taken: new THREE.Color('#353941'), hover: new THREE.Color('#ffffff'), selected: new THREE.Color('#f5c451') };
const lookDir = (yaw, pitch, out = new THREE.Vector3()) =>
  out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));

// 'high' on desktops; 'low' on phones/tablets and small or weak devices.
// Override with ?quality=low|high in the page URL.
export function detectQuality() {
  const forced = new URLSearchParams(window.location.search).get('quality');
  if (forced === 'low' || forced === 'high') return forced;
  const touch = window.matchMedia?.('(pointer: coarse)').matches;
  const small = Math.min(window.screen.width, window.screen.height) < 700;
  const weak = (navigator.hardwareConcurrency || 8) <= 4;
  return touch || small || weak ? 'low' : 'high';
}

// Night sky: dark zenith, warm city glow at the horizon, a few stars. Follows the camera.
function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#020309') },
      mid: { value: new THREE.Color('#070b16') },
      horizon: { value: new THREE.Color('#2a2430') },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon;
      varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main() {
        float h = vDir.y;
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.22, h));
        c = mix(c, top, smoothstep(0.22, 0.85, h));
        float star = step(0.9986, hash(floor(vDir * 420.0))) * smoothstep(0.08, 0.35, h);
        c += vec3(star) * 0.55;
        if (h < 0.0) c = horizon * 0.5;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 16), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}

export class StadiumViewer {
  constructor(container, {
    onChange = () => {}, onHover = () => {}, onSeatArrived = () => {}, quality,
  } = {}) {
    this.container = container;
    this.onChange = onChange;
    this.onHover = onHover;
    this.onSeatArrived = onSeatArrived;
    this.stadium = null;
    this.match = null;
    this.bands = [];
    this.state = { mode: 'overview', flying: false, focus: null, hoverStand: null, hoverSeat: null, selected: null };
    this.view = { target: new THREE.Vector3() };
    this.look = { yaw: 0, pitch: 0, yaw0: 0, eye: new THREE.Vector3() };
    this.tmp = new THREE.Color();
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.pickPending = false;
    this.down = null;
    this.flight = null;
    this.alive = true;

    this.quality = quality || detectQuality();
    const high = this.quality === 'high';
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    this.renderer = new THREE.WebGLRenderer({ antialias: !high, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 2 : 1.5));
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    if (high) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05070c');
    this.scene.fog = new THREE.FogExp2('#0a0f18', 0.00055);
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.25, 2500);

    // Image-based lighting: soft reflections on seats, glass and metal
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.32;

    this.scene.add(new THREE.HemisphereLight('#c9d8ff', '#22301f', 0.95));
    // Key light = the floodlights; casts the stand/roof shadows onto the field
    this.key = new THREE.DirectionalLight('#fff6e6', 2.1);
    this.key.position.set(60, 120, 80);
    this.key.castShadow = high;
    this.key.shadow.mapSize.set(4096, 4096);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.06;
    this.fill = new THREE.DirectionalLight('#dfe8ff', 0.55);
    this.fill.position.set(-80, 90, -60);
    const fieldLight = new THREE.SpotLight('#fff8e8', 1.0, 0, 0.9, 0.8, 0);
    fieldLight.position.set(0, 90, 0);
    this.scene.add(this.key, this.key.target, this.fill, fieldLight, fieldLight.target);
    this.sky = makeSky();
    this.scene.add(this.sky);

    // Post-processing: multisampled render target (smooth edges), ambient occlusion, bloom
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: high ? 4 : 0 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (high) {
      // Ambient occlusion is soft, so it runs at half resolution (about a quarter of the cost)
      const dpr = this.renderer.getPixelRatio();
      this.ao = new GTAOPass(this.scene, this.camera, (w * dpr) / 2, (h * dpr) / 2);
      const aoSetSize = this.ao.setSize.bind(this.ao);
      this.ao.setSize = (sw, sh) => aoSetSize(Math.max(1, Math.round(sw / 2)), Math.max(1, Math.round(sh / 2)));
      this.ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.5, thickness: 1.2, scale: 1.1, samples: 8 });
      this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 8 });
      this.ao.blendIntensity = 0.85;
      // Skip glow/beam/glass effects when computing occlusion
      const render = this.ao.render.bind(this.ao);
      this.ao.render = (...args) => {
        const fx = this.stadium?.fx || [];
        const was = fx.map((o) => o.visible);
        for (const o of fx) o.visible = false;
        render(...args);
        fx.forEach((o, i) => { o.visible = was[i]; });
      };
      this.composer.addPass(this.ao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.6, 0.86);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.clock = new THREE.Clock();

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target = this.view.target;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.5;
    this.controls.enabled = false;

    this.bindInput();
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }

  // ---- Loading -------------------------------------------------------------------
  /** Show a match. Rebuilds the stadium only when the venue changes. */
  load(match, stadiumConfig) {
    this.match = match;
    const rebuild = !this.stadium || this.stadium.config.id !== stadiumConfig.id;
    if (rebuild) {
      if (this.stadium) {
        this.scene.remove(this.stadium.group);
        disposeStadium(this.stadium);
      }
      this.stadium = buildStadium(stadiumConfig, { quality: this.quality });
      this.scene.add(this.stadium.group);
      this.fitLights();
    }
    this.applyPrices();
    for (const s of this.stadium.seats) s.taken = false;
    for (const st of this.stadium.stands.values()) this.updateStandStats(st);
    const p = this.overviewPose();
    if (rebuild) {
      this.camera.position.set(p.pos.x + p.pos.z * 0.6, p.pos.y * 1.3, -p.pos.z * 0.8);
      this.camera.lookAt(p.target);
    }
    this.resetFocus('overview');
    this.flyTo(p.pos, p.target, p.fov, rebuild ? 2.6 : 1.4).then(() => this.state.mode === 'overview' && this.setControls('overview'));
  }

  // Aim the shadow-casting key light from the first floodlight tower and fit its
  // shadow camera to the stadium.
  fitLights() {
    const { extent, lamps } = this.stadium;
    const dir = lamps?.length ? lamps[0].clone().setY(0).normalize() : new THREE.Vector3(0.6, 0, 0.45).normalize();
    this.key.position.set(dir.x * extent * 0.9, extent * 1.3, dir.z * extent * 0.9);
    this.key.target.position.set(0, 0, 0);
    const cam = this.key.shadow.camera;
    Object.assign(cam, {
      left: -extent * 1.1, right: extent * 1.1, top: extent * 1.1, bottom: -extent * 1.1, near: 1, far: extent * 4,
    });
    cam.updateProjectionMatrix();
    this.fill.position.set(-dir.x * extent, extent, -dir.z * extent);
  }

  applyPrices() {
    const { stadium, match } = this;
    for (const s of stadium.seats) s.price = seatPrice(match.prices, s);
    const prices = [...new Set(stadium.seats.map((s) => s.price))].sort((x, y) => x - y);
    const nb = Math.min(PALETTE.length, prices.length);
    this.bands = Array.from({ length: nb }, (_, i) => ({ color: PALETTE[i], col: new THREE.Color(PALETTE[i]), min: Infinity, max: 0 }));
    const bandOf = new Map(prices.map((p, i) => [p, Math.floor((i * nb) / prices.length)]));
    for (const s of stadium.seats) {
      s.band = bandOf.get(s.price);
      const b = this.bands[s.band];
      b.min = Math.min(b.min, s.price);
      b.max = Math.max(b.max, s.price);
    }
    for (const sc of stadium.screens) {
      const old = sc.material.emissiveMap;
      sc.material.emissiveMap = screenTexture(match, stadium.config, sc.aspect);
      sc.material.needsUpdate = true;
      old?.dispose();
    }
  }

  /** `bits`: base64 bitmask in shared layout order (bit i set = seat i unavailable). */
  applyAvailability({ bits, count }) {
    if (!this.stadium) return;
    if (count !== this.stadium.seats.length) console.warn(`Layout mismatch: server ${count}, browser ${this.stadium.seats.length}`);
    const raw = atob(bits);
    this.stadium.seats.forEach((s, i) => {
      s.taken = ((raw.charCodeAt(i >> 3) >> (i & 7)) & 1) === 1;
    });
    for (const st of this.stadium.stands.values()) this.updateStandStats(st);
    this.paintAll();
    this.onChange();
  }

  markTaken(seat) {
    seat.taken = true;
    this.updateStandStats(seat.stand);
    this.paint([seat]);
    this.onChange();
  }

  updateStandStats(st) {
    const free = st.seats.filter((s) => !s.taken);
    st.available = free.length;
    st.minPrice = free.length ? Math.min(...free.map((s) => s.price)) : null;
  }

  get totals() {
    const seats = this.stadium?.seats || [];
    return { total: seats.length, left: seats.filter((s) => !s.taken).length };
  }

  // ---- Colours -------------------------------------------------------------------
  seatColor(s) {
    const { state, tmp } = this;
    if (s === state.selected) return tmp.copy(COL.selected);
    if (!s.taken && s === state.hoverSeat) return tmp.copy(COL.hover);
    tmp.copy(s.taken ? COL.taken : this.bands[s.band].col).multiplyScalar(s.shade ?? 1);
    if (s.stand.id === state.hoverStand) tmp.lerp(COL.hover, s.taken ? 0.12 : 0.4);
    else if (state.mode !== 'overview' && state.focus && s.stand.id !== state.focus) tmp.multiplyScalar(0.35);
    return tmp;
  }

  paint(list) {
    const dirty = new Set();
    for (const s of list) {
      s.mesh.setColorAt(s.local, this.seatColor(s));
      dirty.add(s.mesh);
    }
    for (const m of dirty) m.instanceColor.needsUpdate = true;
  }

  paintStand(id) { if (id) this.paint(this.stadium.stands.get(id).seats); }
  paintAll() { this.paint(this.stadium.seats); }

  setHoverStand(id) {
    if (id === this.state.hoverStand) return;
    const prev = this.state.hoverStand;
    this.state.hoverStand = id;
    this.paintStand(prev);
    this.paintStand(id);
  }

  setHoverSeat(s) {
    if (s === this.state.hoverSeat) return;
    const prev = this.state.hoverSeat;
    this.state.hoverSeat = s;
    if (prev) this.paint([prev]);
    if (s) this.paint([s]);
  }

  // ---- Camera ----------------------------------------------------------------------
  overviewPose() {
    const aspect = this.camera.aspect;
    const D = this.stadium.extent * 2.15 * Math.max(1, 1.5 / aspect);
    return { pos: new THREE.Vector3(0, D * 0.8, D * 0.6), target: new THREE.Vector3(0, 0, this.stadium.extent * 0.05), fov: 40 };
  }

  setControls(mode) {
    const { controls } = this;
    controls.enabled = mode !== 'seat';
    const e = this.stadium.extent;
    if (mode === 'overview') {
      Object.assign(controls, { minDistance: e * 0.6, maxDistance: e * 11, minPolarAngle: 0.1, maxPolarAngle: 1.3 });
    } else if (mode === 'stand') {
      Object.assign(controls, { minDistance: 6, maxDistance: e * 1.6, minPolarAngle: 0.25, maxPolarAngle: 1.5 });
    }
    if (controls.enabled) controls.update();
  }

  flyTo(pos, target, fov, duration = 1.9) {
    this.flight?.kill();
    this.state.flying = true;
    this.controls.enabled = false;
    const { camera, view } = this;
    return new Promise((resolve) => {
      this.flight = gsap.timeline({
        onUpdate: () => camera.lookAt(view.target),
        onComplete: () => {
          this.state.flying = false;
          resolve();
        },
      })
        .to(camera.position, { x: pos.x, y: pos.y, z: pos.z, duration, ease: 'power3.inOut' }, 0)
        .to(view.target, { x: target.x, y: target.y, z: target.z, duration, ease: 'power3.inOut' }, 0)
        .to(camera, { fov, duration, ease: 'power2.inOut', onUpdate: () => camera.updateProjectionMatrix() }, 0);
    });
  }

  // ---- Navigation --------------------------------------------------------------------
  resetFocus(mode, focus = null) {
    Object.assign(this.state, { mode, focus, selected: null, hoverSeat: null, hoverStand: null });
    this.paintAll();
    this.onHover(null);
    this.onChange();
  }

  async goOverview() {
    this.resetFocus('overview');
    const p = this.overviewPose();
    await this.flyTo(p.pos, p.target, p.fov, 1.8);
    if (this.state.mode === 'overview') this.setControls('overview');
  }

  async goStand(id) {
    const st = this.stadium.stands.get(id);
    const fromSeat = this.state.mode === 'seat';
    this.resetFocus('stand', id);
    await this.flyTo(st.camPos, st.camTarget, 45, fromSeat ? 1.6 : 2.0);
    if (this.state.mode === 'stand') this.setControls('stand');
  }

  async goSeat(seat) {
    const { state, look } = this;
    Object.assign(state, { mode: 'seat', focus: seat.stand.id, selected: seat, hoverSeat: null, hoverStand: null });
    this.paintAll();
    this.onHover(null);
    this.onChange();
    this.setControls('seat');
    const eye = seat.pos.clone().add(new THREE.Vector3(0, 1.15 * seat.scale, 0));
    const toCentre = new THREE.Vector3(0, 1, 0).sub(eye).normalize();
    look.eye.copy(eye);
    look.yaw0 = look.yaw = Math.atan2(toCentre.x, toCentre.z);
    look.pitch = Math.asin(toCentre.y);
    await this.flyTo(eye, eye.clone().add(lookDir(look.yaw, look.pitch).multiplyScalar(10)), 60, 2.2);
    if (this.state.mode === 'seat' && this.state.selected === seat) this.onSeatArrived();
  }

  /** One step back. Returns false when already at the overview. */
  back() {
    if (this.state.flying) return true;
    if (this.state.mode === 'seat') { this.goStand(this.state.focus); return true; }
    if (this.state.mode === 'stand') { this.goOverview(); return true; }
    return false;
  }

  // ---- Picking & input ------------------------------------------------------------------
  setPointer(e) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer = { x: e.clientX, y: e.clientY };
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  pick() {
    this.pickPending = false;
    const { state } = this;
    if (!this.stadium || state.flying || state.mode === 'seat' || (this.down && this.down.moved)) return;
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.stadium.meshes, false)[0];
    const seat = hit ? hit.object.userData.stand.seats[hit.instanceId] : null;
    this.canvas.style.cursor = seat ? 'pointer' : '';
    const { x, y } = this.pointer || { x: 0, y: 0 };
    if (!seat) {
      this.setHoverStand(null);
      this.setHoverSeat(null);
      this.onHover(null);
      return;
    }
    const st = seat.stand;
    if (state.mode === 'overview') {
      this.setHoverStand(st.id);
      this.onHover({ kind: 'stand', stand: st }, x, y);
    } else if (st.id === state.focus) {
      this.setHoverStand(null);
      this.setHoverSeat(seat.taken ? null : seat);
      this.onHover({ kind: 'seat', stand: st, seat }, x, y);
    } else {
      this.setHoverSeat(null);
      this.setHoverStand(st.id);
      this.onHover({ kind: 'other', stand: st }, x, y);
    }
  }

  handleClick() {
    const { state } = this;
    if (state.flying) return;
    this.pick();
    if (state.mode === 'overview' && state.hoverStand) this.goStand(state.hoverStand);
    else if (state.mode === 'stand') {
      if (state.hoverSeat) this.goSeat(state.hoverSeat);
      else if (state.hoverStand) this.goStand(state.hoverStand);
    }
  }

  bindInput() {
    const c = this.canvas;
    this.listeners = [
      [c, 'pointerdown', (e) => {
        this.setPointer(e);
        this.down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
        if (this.state.mode === 'seat') c.setPointerCapture(e.pointerId);
      }],
      [c, 'pointermove', (e) => {
        this.setPointer(e);
        const { down, look, state } = this;
        if (down) {
          if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) {
            down.moved = true;
            this.onHover(null);
          }
          if (state.mode === 'seat' && !state.flying) {
            look.yaw = clamp(look.yaw + (e.clientX - down.lx) * 0.004, look.yaw0 - 2.2, look.yaw0 + 2.2);
            look.pitch = clamp(look.pitch + (e.clientY - down.ly) * 0.004, -1.1, 1.2);
          }
          down.lx = e.clientX;
          down.ly = e.clientY;
        } else {
          this.pickPending = true;
        }
      }],
      [c, 'pointerup', (e) => {
        this.setPointer(e);
        const wasClick = this.down && !this.down.moved;
        this.down = null;
        if (wasClick) this.handleClick();
      }],
      [c, 'pointerleave', () => {
        if (this.down || !this.stadium) return;
        this.setHoverStand(null);
        this.setHoverSeat(null);
        this.onHover(null);
      }],
      [c, 'wheel', (e) => {
        if (this.state.mode !== 'seat' || this.state.flying) return;
        this.camera.fov = clamp(this.camera.fov + e.deltaY * 0.03, 25, 80);
        this.camera.updateProjectionMatrix();
      }, { passive: true }],
      [window, 'resize', () => this.resize()],
    ];
    for (const [target, type, fn, opts] of this.listeners) target.addEventListener(type, fn, opts);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
  }

  // ---- Loop -----------------------------------------------------------------------------
  update() {
    const { state, look, camera, controls, stadium } = this;
    if (state.flying) {
      camera.lookAt(this.view.target);
    } else if (state.mode === 'seat') {
      const target = look.eye.clone().add(lookDir(look.yaw, look.pitch).multiplyScalar(10));
      camera.position.copy(look.eye);
      camera.lookAt(target);
    } else if (controls.enabled) {
      controls.update();
    }
    if (this.pickPending) this.pick();
    // Roofs turn see-through from high up so the overview shows the seats
    const e = stadium.extent;
    const o = clamp((e * 1.25 - camera.position.y) / (e * 0.7), 0.08, 1);
    for (const m of stadium.roofGroup.children) {
      for (const mat of [].concat(m.material)) mat.opacity = o;
    }
    this.updateDetail();
    // Sky stays centred on the camera (infinitely far); LED boards scroll
    this.sky.position.copy(camera.position);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    for (const a of stadium.animated || []) a.texture.offset.x = (a.texture.offset.x + a.speed * dt) % 1;
  }

  // Detailed seats only for stands near the camera; ambient occlusion only in
  // close-up views (from the overview it's invisible but doubles the cost).
  updateDetail() {
    const { stadium, camera } = this;
    const { near, far } = stadium.chairs;
    for (const m of stadium.meshes) {
      const s = m.boundingSphere;
      const dist = camera.position.distanceTo(s.center) - s.radius;
      const geo = dist < 25 ? near : far;
      if (m.geometry !== geo) m.geometry = geo;
    }
    if (this.ao) this.ao.enabled = this.state.mode !== 'overview' || camera.position.y < stadium.extent * 0.5;
    const showBeams = camera.position.y > stadium.extent * 0.7;
    for (const b of stadium.beams || []) b.visible = showBeams;
  }

  tick() {
    if (!this.alive) return;
    this.raf = requestAnimationFrame(this.tick);
    if (!this.stadium) return;
    this.update();
    this.composer.render();
  }

  /** Finish any camera flight and return the current frame (used by tests). */
  snapshot() {
    this.flight?.progress(1);
    this.update();
    this.composer.render();
    return this.canvas.toDataURL('image/jpeg', 0.9);
  }

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.flight?.kill();
    for (const [target, type, fn, opts] of this.listeners) target.removeEventListener(type, fn, opts);
    this.controls.dispose();
    if (this.stadium) disposeStadium(this.stadium);
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.envMap.dispose();
    this.ao?.dispose();
    this.composer.dispose?.();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
