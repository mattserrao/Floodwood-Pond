import * as THREE from 'three';
import { MAP } from './mapdata.js?v=0.9.0';
import { clamp, lerp, sstep, pondSD, NQ, heightAt, CREEK, CQ, creekSD, ISLE, glowTexture, CAMP, onDock } from './world.js?v=0.9.0';
import { Voices } from './voices.js?v=0.9.0';
import { recolor } from './models.js?v=0.9.0';

// v0.6.1: Blender-built models, loaded by main.js before the story is created (null entries fall back to primitives)
let M = {};
export function setModels(m) { M = m || {}; }

// =====================================================================================================
// v0.5 "memories": wake in the tent, walk to the canoe, and paddle a drifting journey of ghost memories.
// The mist closes in behind you, pulling you toward Big Island and on down the creek, where it ends.
// =====================================================================================================
const rand = (a, b) => a + Math.random() * (b - a);
const ease = (k) => k * k * (3 - 2 * k);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const angDiff = (a, b) => ((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const centroid = (r) => [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
const ringNear = (x, z) => MAP.pond.slice(1).map((r) => ({ r, c: centroid(r) })).sort((a, b) => Math.hypot(a.c[0] - x, a.c[1] - z) - Math.hypot(b.c[0] - x, b.c[1] - z))[0];
function grad(x, z) { const e = 3, gx = pondSD(x + e, z) - pondSD(x - e, z), gz = pondSD(x, z + e) - pondSD(x, z - e), l = Math.hypot(gx, gz) || 1; return [gx / l, gz / l]; }
/** nudge a point out into open water until it is at least `min` metres from any shore */
function toWater(x, z, min = 20) { for (let k = 0; k < 80 && pondSD(x, z) < min; k++) { const [gx, gz] = grad(x, z); x += gx * 3; z += gz * 3; } return [x, z]; }

// ------------------------------------------------------------------ route: launch -> round Big Island -> creek
function buildRoute(start) {
  const BIG = ringNear(-380, -19), SMALL = ringNear(-647, -363);
  const xs = BIG.r.map((p) => p[0]);
  const via = toWater(Math.min(...xs) - 45, BIG.c[1] + 10, 28);          // down the island's west side
  const goal = [CREEK.pts[1][0], CREEK.pts[1][1]];
  const B = { x0: -1250, x1: 1250, z0: -880, z1: 900 }, S = 10, NX = Math.ceil((B.x1 - B.x0) / S), NZ = Math.ceil((B.z1 - B.z0) / S);
  const sd = new Float32Array(NX * NZ);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) sd[j * NX + i] = pondSD(B.x0 + i * S, B.z0 + j * S);
  const cell = (x, z) => [clamp(Math.round((x - B.x0) / S), 0, NX - 1), clamp(Math.round((z - B.z0) / S), 0, NZ - 1)];
  function astar(a, b) {
    const [ai, aj] = cell(a[0], a[1]), [bi, bj] = cell(b[0], b[1]), N = NX * NZ;
    const g = new Float32Array(N).fill(1e12), from = new Int32Array(N).fill(-1), done = new Uint8Array(N); g[aj * NX + ai] = 0;
    const H = (k) => Math.hypot((k % NX) - bi, Math.floor(k / NX) - bj);
    // binary min-heap of [f, cell]
    const heap = [[0, aj * NX + ai]];
    const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const open = { get length() { return heap.length; } };
    while (open.length) {
      const [, k] = pop(); if (done[k]) continue; done[k] = 1; const ki = k % NX, kj = Math.floor(k / NX);
      if (ki === bi && kj === bj) break;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const ni = ki + di, nj = kj + dj; if (ni < 0 || nj < 0 || ni >= NX || nj >= NZ) continue;
        const n = nj * NX + ni, s = sd[n]; if (s < 6) continue;
        const c = g[k] + Math.hypot(di, dj) * (1 + 30 / Math.max(s, 1));      // prefer the middle of the water
        if (c < g[n]) { g[n] = c; from[n] = k; push([c + H(n), n]); }
      }
    }
    const out = []; let k = bi + bj * NX; while (k >= 0) { out.push([B.x0 + (k % NX) * S, B.z0 + Math.floor(k / NX) * S]); k = from[k]; }
    return out.reverse();
  }
  let pts = [...astar(start, via), ...astar(via, goal).slice(1)];
  // string-pull, then smooth and resample every 8 m
  const clear = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let d = 0; d <= L; d += 4) { const t = d / L; if (pondSD(lerp(a[0], b[0], t), lerp(a[1], b[1], t)) < 14) return false; } return true; };
  const pulled = [pts[0]]; let i = 0;
  while (i < pts.length - 1) { let j = pts.length - 1; while (j > i + 1 && !clear(pts[i], pts[j])) j--; pulled.push(pts[j]); i = j; }
  pts = [start, ...pulled.slice(1)];
  for (let it = 0; it < 2; it++) { const o = [pts[0]]; for (let k = 0; k < pts.length - 1; k++) { const a = pts[k], b = pts[k + 1]; o.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); } o.push(pts[pts.length - 1]); pts = o; }
  CREEK.pts.slice(2).forEach((p) => pts.push([p[0], p[1]]));               // then down the creek
  const R = []; let acc = 0;
  for (let k = 0; k < pts.length - 1; k++) { const a = pts[k], b = pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 8)); for (let q = 0; q < n; q++) { R.push({ x: lerp(a[0], b[0], q / n), z: lerp(a[1], b[1], q / n), s: acc + (L * q) / n }); } acc += L; }
  R.push({ x: pts[pts.length - 1][0], z: pts[pts.length - 1][1], s: acc });
  let sVia = 0, best = 1e9; R.forEach((p) => { const d = Math.hypot(p.x - via[0], p.z - via[1]); if (d < best) { best = d; sVia = p.s; } });
  let sCreek = acc; R.forEach((p) => { if (p.s < sCreek && creekSD(p.x, p.z) > 0 && pondSD(p.x, p.z) === creekSD(p.x, p.z)) sCreek = Math.min(sCreek, p.s); });
  return { R, L: acc, sVia, sCreek, BIG, SMALL, via };
}
function routeAt(route, s) { const R = route.R; let lo = 0, hi = R.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (R[m].s < s) lo = m; else hi = m; } const a = R[lo], b = R[hi], t = clamp((s - a.s) / Math.max(1e-6, b.s - a.s), 0, 1); return { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), dx: (b.x - a.x) / Math.max(1e-6, Math.hypot(b.x - a.x, b.z - a.z)), dz: (b.z - a.z) / Math.max(1e-6, Math.hypot(b.x - a.x, b.z - a.z)) }; }

// ------------------------------------------------------------------ ghost models
const GHOST = 0xffb468; // memories glow warm against the cold grey present
let HALO_TEX = null;
function G0() {
  const g = new THREE.Group(); g.userData.mats = []; g.userData.o = 0; g.visible = false;
  HALO_TEX = HALO_TEX || glowTexture();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: HALO_TEX, color: 0xffc98a, blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false }));
  halo.scale.set(8, 3.6, 1); halo.position.y = 0.7; halo.material.userData.k = 0.8; g.userData.mats.push(halo.material); g.add(halo);
  return g;
}
function gm(g, color = GHOST, k = 1) { /* normal blend: additive vanishes against bright mist */ const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }); m.userData.k = k; g.userData.mats.push(m); return m; }
let MOTES = null;
function fadeGhost(g, o, t) {
  const prev = g.userData.o || 0; if (MOTES && o < prev - 1e-4 && prev > 0.02) MOTES.dissolve(g, (prev - o) * 900);   // fading out: it crumbles into drifting light
  g.userData.o = o; g.visible = o > 0.004; g.userData.mats.forEach((m, i) => { m.opacity = o * m.userData.k * (0.84 + 0.16 * Math.sin(t * 2.3 + i * 1.7)); }); }
function person(g, m, kind = 'kayaker') {
  const src = M[kind]; if (src) { const w = new THREE.Group(), fig = recolor(src.clone(true), m); w.add(fig); w.userData.uarms = []; w.userData.arms = [];   // wrapped: callers may rotate it freely without undoing the loader's turn-round
    fig.traverse((o) => { if (o.isMesh && /_uarm/i.test(o.name)) w.userData.uarms.push(o); if (o.isMesh && /_(u|l)arm/i.test(o.name)) w.userData.arms.push(o); }); return w; }
  const p = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.32, 3, 8), m); torso.position.y = 0.48; p.add(torso);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), m); head.position.y = 0.88; p.add(head);
  return p;
}
function kayak(tandem) {
  const g = G0(), hull = gm(g, GHOST, 0.75), body = gm(g, GHOST, 0.9), L = tandem ? 4.8 : 3.4;
  const roll = new THREE.Group(); g.add(roll);
  const src = M[tandem ? 'kayak2' : 'kayak1'];
  if (src) { const h = recolor(src.clone(true), hull); h.position.y = 0.3; roll.add(h); }
  else { const h = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, L - 0.66, 4, 10), hull); h.rotation.x = Math.PI / 2; h.scale.set(1, 1, 0.42); h.position.y = 0.06; roll.add(h); }
  const seats = tandem ? [0.75, -0.75] : [0.1]; g.userData.paddles = [];
  seats.forEach((z, i) => {
    const pp = person(g, body, 'kayaker'); pp.position.set(0, src ? 0.0 : 0.0, z - (src ? 0.25 : 0)); roll.add(pp);
    const pad = new THREE.Group(); pad.position.set(0, 0.62, z + 0.25); roll.add(pad);
    if (M.paddleDouble) { const pd = recolor(M.paddleDouble.clone(true), body); pd.rotation.z = Math.PI / 2; pd.position.x = 1.1; pad.add(pd); }   // shaft 0..2.2 along Y -> -2.2..0 along X; centre it
    else { const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 2.2, 5), body); shaft.rotation.z = Math.PI / 2; pad.add(shaft);
      [-1, 1].forEach((s) => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.02), body); b.position.x = s * 1.1; b.rotation.x = s * 0.6; pad.add(b); }); }
    const ent = { pad, ph: i * 0.7 }; rigArms(g, body, pp, ent, [[-0.36, 0, 0], [0.36, 0, 0]]); g.userData.paddles.push(ent);
  });
  g.userData.roll = roll; return g;
}
function ghostCanoe(n = 2) {
  const g = G0(), hull = gm(g, GHOST, 0.75), body = gm(g, GHOST, 0.9);
  const roll = new THREE.Group(); g.add(roll);
  const cs = M.canoeAlu || M.canoe; if (cs) { const h = recolor(cs.clone(true), hull); h.position.y = 0.34; roll.add(h); }   // v0.7.0: dented aluminum canoes, like the ones in the photos
  else { const h = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 4.0, 4, 10), hull); h.rotation.x = Math.PI / 2; h.scale.set(1, 1, 0.5); h.position.y = 0.12; roll.add(h); }
  g.userData.paddles = [];
  if (n >= 3) { const mid = person(g, body, 'kayaker'); mid.position.set(0, 0.0, -0.15); roll.add(mid); g.userData.middle = mid; }
  [1.6, -1.75].slice(0, Math.min(n, 2)).forEach((z, i) => {
    const pp = person(g, body, 'paddler'); pp.position.set(0, 0.08, z - 0.2); roll.add(pp);
    const pad = new THREE.Group(); pad.position.set(i ? -0.42 : 0.42, 0.75, z + 0.2); roll.add(pad);
    if (M.paddleSingle) { const pd = recolor(M.paddleSingle.clone(true), body); pd.position.y = 0.33 - 1.51; pad.add(pd); }   // grip at the hands, blade hanging down
    else { const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.4, 5), body); shaft.position.y = -0.4; pad.add(shaft);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.02), body); b.position.y = -1.15; pad.add(b); }
    const ent = { pad, ph: i * 0.5, single: true, side: i ? -1 : 1 }; rigArms(g, body, pp, ent, [[0, 0.02, 0], [0, -0.6, 0]]); g.userData.paddles.push(ent);
  });
  g.userData.roll = roll; return g;
}
function picnicTable(g) {
  const m = gm(g, 0xe6ddd0, 0.85), t = new THREE.Group();
  if (M.picnicTable) { const pt = recolor(M.picnicTable.clone(true), m); pt.rotation.y = Math.PI / 2; pt.position.y = -0.3; t.add(pt); return t; }
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.06, 1.9), m); top.position.y = 0.42; t.add(top);
  [-1, 1].forEach((s) => {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 1.9), m); bench.position.set(s * 0.6, 0.05, 0); t.add(bench);
    [-0.7, 0.7].forEach((z) => { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.95, 0.08), m); leg.position.set(s * 0.32, 0.0, z); leg.rotation.z = s * 0.55; t.add(leg); });
  });
  return t;
}
/** v0.7.2: give a ghost paddler real arms that follow the paddle - the model's baked arms are hidden and two simple
 *  arm segments run from each shoulder to a grip on the shaft every frame */
const _ARM = new THREE.CylinderGeometry(0.05, 0.042, 1, 5), _V1 = new THREE.Vector3(), _V2 = new THREE.Vector3(), _V3 = new THREE.Vector3(), _UP = new THREE.Vector3(0, 1, 0), _Q = new THREE.Quaternion();
function rigArms(g, mat, who, entry, hands) {
  if (!who.userData.uarms || who.userData.uarms.length < 2) return;
  who.userData.arms.forEach((o) => { o.visible = false; });
  entry.rig = { who, hands: hands.map((h) => new THREE.Vector3(...h)), arms: [0, 1].map(() => { const a = new THREE.Mesh(_ARM, mat); a.renderOrder = 4; g.add(a); return a; }) };
  updateArms(g, entry);
}
function updateArms(g, p) {
  const r = p.rig; if (!r) return; g.updateMatrixWorld(true);
  const sh = r.who.userData.uarms.map((o) => o.getWorldPosition(new THREE.Vector3()).add(_V3.set(0, 0.11, 0)));
  const hd = r.hands.map((h) => p.pad.localToWorld(h.clone()));
  const swap = sh[0].distanceTo(hd[0]) + sh[1].distanceTo(hd[1]) > sh[0].distanceTo(hd[1]) + sh[1].distanceTo(hd[0]);
  r.arms.forEach((a, i) => { _V1.copy(sh[i]); _V2.copy(hd[swap ? 1 - i : i]); g.worldToLocal(_V1); g.worldToLocal(_V2);
    const d = _V2.clone().sub(_V1), L = d.length(); a.position.copy(_V1).addScaledVector(d, 0.5); a.quaternion.copy(_Q.setFromUnitVectors(_UP, d.divideScalar(L || 1))); a.scale.set(1, L, 1); });
}
function animatePaddles(g, t, rate = 1) {
  (g.userData.paddles || []).forEach((p) => {
    const ph = t * 2.4 * rate + p.ph;
    if (p.single) { p.pad.rotation.set(-0.05 - 0.6 * Math.cos(ph), 0, p.side * (0.3 + 0.4 * Math.max(0, -Math.sin(ph)))); }
    else { p.pad.rotation.z = Math.sin(ph) * 0.55; p.pad.rotation.y = Math.cos(ph) * 0.35; }
    if (p.rig) p.rig.who.rotation.y = (p.single ? p.side * 0.15 : 0) + Math.sin(ph) * (p.single ? 0.12 : 0.22);   // the torso turns into each stroke
    updateArms(g, p);
  });
}

// ------------------------------------------------------------------ the story controller
function createMotes(scene) {
  const N = 600, pos = new Float32Array(N * 3), alpha = new Float32Array(N), vel = new Float32Array(N * 3), life = new Float32Array(N), max = new Float32Array(N); let head = 0;
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTex: { value: glowTexture() }, uCol: { value: new THREE.Color(0xffd29a) } },
    vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = clamp(90. / -mv.z, 1.5, 14.); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D uTex; uniform vec3 uCol; varying float vA; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(uCol * t.a * vA, t.a * vA); }` });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 6; scene.add(pts);
  const v = new THREE.Vector3(), box = new THREE.Box3();
  return {
    emit(x, y, z, n = 1, spread = 1) {
      for (let i = 0; i < n; i++) { const k = head++ % N; pos[k * 3] = x + rand(-spread, spread); pos[k * 3 + 1] = y + rand(0, spread); pos[k * 3 + 2] = z + rand(-spread, spread);
        vel[k * 3] = rand(-0.25, 0.25); vel[k * 3 + 1] = rand(0.25, 0.7); vel[k * 3 + 2] = rand(-0.25, 0.25); max[k] = life[k] = rand(2.5, 5); }
    },
    /** emit specks over a ghost's body as it fades */
    dissolve(g, n) {
      const cnt = Math.min(12, Math.floor(n) + (Math.random() < n % 1 ? 1 : 0)); if (!cnt) return;
      box.setFromObject(g); if (box.isEmpty()) return;
      for (let i = 0; i < cnt; i++) { v.set(rand(box.min.x, box.max.x), rand(Math.max(box.min.y, 0), box.max.y), rand(box.min.z, box.max.z)); this.emit(v.x, v.y, v.z, 1, 0.15); }
    },
    update(dt) {
      for (let k = 0; k < N; k++) {
        if (life[k] <= 0) { alpha[k] = 0; continue; }
        life[k] -= dt; const u = life[k] / max[k];
        vel[k * 3] += rand(-0.3, 0.3) * dt; vel[k * 3 + 2] += rand(-0.3, 0.3) * dt;
        pos[k * 3] += vel[k * 3] * dt; pos[k * 3 + 1] += vel[k * 3 + 1] * dt; pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
        alpha[k] = Math.min(1, (1 - u) * 6) * u * 0.9;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.alpha.needsUpdate = true;
    },
  };
}

export function createStory(C) {
  const { scene, camera, P, G, audio, ripples, canoe, launchInfo, post } = C;
  const voices = new Voices(audio);
  const $ = (id) => document.getElementById(id);
  const S = { active: true, glanceYaw: 0, fogMul: 1, events: [], ghosts: [], ended: false, playT: 0, sNow: 0, idx: 0 };
  S.voices = voices;
  const route = buildRoute(launchInfo.end);
  MOTES = createMotes(scene); S.motes = MOTES;
  S.route = route;

  // ---------------- the tent, up on the bank above the launch dock (v0.6.7: twice the size)
  const n = launchInfo.n, side = CAMP.side, TS2 = 2;
  let tx = CAMP.tent[0], tz = CAMP.tent[1];
  const ty = heightAt(tx, tz);
  const tent = new THREE.Group(); tent.position.set(tx, ty, tz); tent.rotation.y = Math.atan2(CAMP.walkEnd[0] - tx, CAMP.walkEnd[1] - tz); tent.scale.setScalar(TS2); scene.add(tent);
  if (M.tent) { const tm = M.tent.clone(true); tm.rotation.y = Math.PI; tent.add(tm); }   // Blender tent: door faces +Y in Blender = +Z after the loader flip; our door is at +Z
  else {
    const sh = new THREE.Shape(); sh.moveTo(-1.15, 0); sh.lineTo(0, 1.25); sh.lineTo(1.15, 0); sh.closePath();
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 2.3, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: 0x5d6b3e, flatShading: true, roughness: 0.9, side: THREE.DoubleSide }));
    body.position.z = -1.15; tent.add(body);
    const door = new THREE.Shape(); door.moveTo(-0.55, 0.02); door.lineTo(0, 0.95); door.lineTo(0.55, 0.02); door.closePath();
    const dm = new THREE.Mesh(new THREE.ShapeGeometry(door), new THREE.MeshBasicMaterial({ color: 0x050505 })); dm.position.z = 1.16; tent.add(dm);
    const flap = new THREE.Mesh(new THREE.ShapeGeometry(door), new THREE.MeshStandardMaterial({ color: 0x6b7a48, flatShading: true, side: THREE.DoubleSide })); flap.position.set(0.62, 0, 1.18); flap.rotation.y = -1.2; flap.scale.set(0.9, 1, 1); tent.add(flap);
    const fly = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 2.6), new THREE.MeshStandardMaterial({ color: 0x3a3022 })); fly.position.set(0, 1.27, 0); tent.add(fly);
    // gear by the door: a pack and a camp mug
    const pack = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 1), new THREE.MeshStandardMaterial({ color: 0x7a3b22, flatShading: true })); pack.scale.set(1, 1.3, 0.8); pack.position.set(-1.0, 0.3, 1.5); tent.add(pack);
  }
  tent.updateMatrixWorld(true); S.tent = tent;
  const tentFront = new THREE.Vector3(0, 0, 1.6).applyMatrix4(tent.matrixWorld);   // local units, so this scales with the tent

  // clear a little campsite: no trees around the (big) tent or on the walk down to the dock; no reeds on the dock or round the canoe
  {
    const a = new THREE.Vector2(tx, tz), b = new THREE.Vector2(CAMP.walkEnd[0], CAMP.walkEnd[1]), m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const segD = (x, z) => { const ab = b.clone().sub(a), t = clamp(((x - a.x) * ab.x + (z - a.y) * ab.y) / ab.lengthSq(), 0, 1); return Math.hypot(x - (a.x + ab.x * t), z - (a.y + ab.y * t)); };
    const st = launchInfo.start, inBoat = (x, z) => { const dx = x - st[0], dz = z - st[1], al = dx * n[0] + dz * n[1], ac = dx * side[0] + dz * side[1]; return Math.abs(al) < 3.6 && Math.abs(ac) < 1.3; };
    const kill = { tree: (x, z) => Math.hypot(x - tx, z - tz) < 10 || segD(x, z) < 3, reed: (x, z) => onDock(x, z, 0.5) !== null || inBoat(x, z) || segD(x, z) < 1.2 };
    scene.traverse((o) => {
      const f = o.isInstancedMesh && o.count <= 200000 && kill[o.userData.tag]; if (!f) return; let touched = false;
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m4); pos.setFromMatrixPosition(m4); if (f(pos.x, pos.z)) { m4.decompose(pos, q, sc); m4.compose(pos, q, sc.set(0, 0, 0)); o.setMatrixAt(i, m4); touched = true; } }
      if (touched) o.instanceMatrix.needsUpdate = true;
    });
  }

  // ---------------- the fallen tree, left of the route as it rounds Big Island toward the creek
  // first spot past the island where the left-hand shore is close enough to see the tree well
  const leftShore = (sv) => { const rp = routeAt(route, sv), left = [rp.dz, -rp.dx]; let qx = rp.x, qz = rp.z, d = 0; while (d < 200 && pondSD(qx, qz) > 0) { qx += left[0] * 2; qz += left[1] * 2; d += 2; } return { rp, left, qx, qz, d }; };
  let sTree = Math.min(route.sVia + 260, (route.sCreek || route.L) - 120), TS = leftShore(sTree);
  for (let sv = route.sVia + 100; sv < (route.sCreek || route.L) - 120; sv += 8) { const c = leftShore(sv); if (c.d >= 14 && c.d <= 48) { sTree = sv; TS = c; break; } }
  const { rp, left, qx, qz } = TS, inWater = clamp(TS.d - 9, 5, 12);
  const treeRoot = [qx + left[0] * 5, qz + left[1] * 5], treeDir = [-left[0] * 0.85 + rp.dx * 0.5, -left[1] * 0.85 + rp.dz * 0.5]; { const l = Math.hypot(...treeDir); treeDir[0] /= l; treeDir[1] /= l; }
  const treeLen = 5 / 0.85 + inWater / 0.85, treeTip = [treeRoot[0] + treeDir[0] * treeLen, treeRoot[1] + treeDir[1] * treeLen];
  {
    const bark = new THREE.MeshStandardMaterial({ color: 0x4a4038, flatShading: true, roughness: 1 }), y0 = Math.max(heightAt(...treeRoot), 0.4);
    const g = new THREE.Group(); g.position.set(treeRoot[0], y0, treeRoot[1]); g.rotation.y = Math.atan2(treeDir[0], treeDir[1]); scene.add(g);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, treeLen + 1, 7), bark); trunk.rotation.x = Math.PI / 2 + 0.09; trunk.position.set(0, -0.6, (treeLen + 1) / 2); g.add(trunk);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.2, 0.5, 9), new THREE.MeshStandardMaterial({ color: 0x3a2e22, flatShading: true })); plate.rotation.x = Math.PI / 2 - 0.2; plate.position.set(0, 0.4, -0.1); g.add(plate);
    for (let i = 0; i < 9; i++) { const z = 3 + i * (treeLen - 3) / 9, br = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.09, rand(1.4, 3.2), 4), bark); br.position.set(rand(-0.3, 0.3), -0.6 - z * 0.09 + 0.9, z); br.rotation.set(rand(-0.5, 0.5), 0, (i % 2 ? 1 : -1) * rand(0.3, 1.1)); g.add(br); }
    // the canoe bumps off the trunk where it lies in the water
    for (let d = 6; d <= treeLen; d += 1.5) CREEK.rocks.push({ x: treeRoot[0] + treeDir[0] * d, z: treeRoot[1] + treeDir[1] * d, r: 0.7, h: 0 });
    S.tree = { root: treeRoot, tip: treeTip, group: g, s: sTree, shoreDist: TS.d };
  }

  // ---------------- swirling mist that crowds in behind you
  const puffTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); for (let i = 0; i < 9; i++) { const px = 30 + Math.random() * 68, py = 30 + Math.random() * 68, r = 25 + Math.random() * 35, gr = x.createRadialGradient(px, py, 0, px, py, r); gr.addColorStop(0, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); } return new THREE.CanvasTexture(c); })();
  const puffs = [];
  for (let i = 0; i < 42; i++) {
    const m = new THREE.SpriteMaterial({ map: puffTex, transparent: true, opacity: 0, depthWrite: false, color: 0xffffff });
    const sp = new THREE.Sprite(m); sp.renderOrder = 5; scene.add(sp);
    puffs.push({ sp, a: rand(-1.15, 1.15), d: rand(35, 170), y: rand(2, 16), s: rand(45, 110), rs: rand(-0.12, 0.12), ph: rand(0, 6.28), cur: null });
  }

  // ---------------- intro: first person, out of the tent and down to the canoe
  const I = { t: 0, phase: 0, steps: 0, cam: new THREE.Vector3(), look: new THREE.Vector3(), yaw: 0, done: false }; S.I = I;
  const seat = () => new THREE.Vector3(launchInfo.start[0] - Math.sin(launchInfo.psi) * 0.6, 0, launchInfo.start[1] - Math.cos(launchInfo.psi) * 0.6);
  S.startIntro = () => {
    I.t = 0; I.done = false; I.steps = 0; I.sat = false; I.yawW = undefined; S.ended = false; canoe.person.visible = false; canoe.paddle.visible = false;
    $('blackout').style.transition = 'none'; $('blackout').style.opacity = 1;
    voices.unzip();
    setTimeout(() => { $('blackout').style.transition = 'opacity 1.6s ease'; $('blackout').style.opacity = 0; }, 900);
  };
  // timeline (s): 0-1.0 black + unzip | 1.0-2.8 crawl out & stand | 2.8-3.8 glance back at the tent | 3.8-4.4 hold | 4.4-5.6 turn to the water
  //   | walk down to the dock and out along it | step down into the canoe | hand off
  const D = CAMP.dock, toDock = () => Math.atan2(D.root[0] - tentFront.x, D.root[1] - tentFront.z);
  const floorY = (x, z) => { const d = onDock(x, z, 0.05); return d !== null ? d : Math.max(heightAt(x, z), 0.1); };
  const lookAhead = (pts, cum, d) => { d = Math.min(d, cum[cum.length - 1]); let i = 1; while (i < cum.length - 1 && cum[i] < d) i++; const k = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1); return pts[i - 1].clone().lerp(pts[i], k); };
  S.introCamera = (dt) => {
    I.t += dt; const t = I.t, s = seat(), face = toDock();
    const out = tentFront.clone().add(new THREE.Vector3(Math.sin(face) * 2.4 * TS2 / 1.6, 0, Math.cos(face) * 2.4 * TS2 / 1.6));
    // walk: out of camp -> foot of the dock -> along the deck to beside the seat
    const sa = (s.x - D.root[0]) * n[0] + (s.z - D.root[1]) * n[1];
    const foot = new THREE.Vector3(D.root[0] - n[0] * 0.6, 0, D.root[1] - n[1] * 0.6), on = new THREE.Vector3(D.root[0] + n[0] * 0.6, 0, D.root[1] + n[1] * 0.6);
    const edge = new THREE.Vector3(D.root[0] + n[0] * sa - side[0] * 0.55, 0, D.root[1] + n[1] * sa - side[1] * 0.55);
    const pts = [out, foot, on, edge], cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const walkLen = cum[cum.length - 1], walkT = walkLen / 2.0, tWalk0 = 5.6, tWalk1 = tWalk0 + walkT, tSit1 = tWalk1 + 1.8;   // v0.7.1: shorter - out, a quick look back, then a brisk walk down
    let pos = new THREE.Vector3(), yaw = face, pitch = -0.08, eye = 1.62, bob = 0, absY = null;
    if (t < 2.8) { const k = ease(clamp((t - 1.0) / 1.8, 0, 1)); pos.lerpVectors(tentFront.clone().add(new THREE.Vector3(-Math.sin(face) * 0.6, 0, -Math.cos(face) * 0.6)), out, k); eye = lerp(0.55, 1.62, ease(clamp((t - 1.6) / 1.2, 0, 1))); pitch = lerp(-0.25, -0.06, k); }
    else if (t < tWalk0) { pos.copy(out); const back = face + Math.PI * 0.94;
      yaw = t < 3.8 ? lerp(face, back, ease((t - 2.8) / 1.0)) : t < 4.4 ? back : lerp(back, face + Math.PI * 2, ease((t - 4.4) / 1.2)); pitch = t < 4.4 ? -0.16 : -0.07; }
    else if (t < tWalk1) { const d = (t - tWalk0) / walkT * walkLen; pos.copy(lookAhead(pts, cum, d)); const ah = lookAhead(pts, cum, d + 2.2); if (ah.distanceTo(pos) > 0.05) yaw = Math.atan2(ah.x - pos.x, ah.z - pos.z);
      bob = Math.abs(Math.sin(d * 1.6)) * 0.05; pitch = -0.1 - 0.1 * clamp(d / walkLen, 0, 1);
      if (I.yawW !== undefined) { let dy = yaw - I.yawW; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); yaw = I.yawW + dy * Math.min(1, dt * 4); } I.yawW = yaw;
      const stepN = Math.floor(d / 0.8); if (stepN > I.steps) { I.steps = stepN; const deck = onDock(pos.x, pos.z, 0.05) !== null; if (deck) { voices.thunk({ x: pos.x, y: D.deck, z: pos.z }, 0.35); voices.step(stepN % 2 ? 0.2 : -0.2, 0.35); } else voices.step(stepN % 2 ? 0.25 : -0.25, 0.9); } }
    else if (t < tSit1) { const k = ease((t - tWalk1) / 1.8), y0 = I.yawW ?? face; let dy = launchInfo.psi - y0; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      pos.lerpVectors(edge, s, ease(clamp((t - tWalk1) / 1.1, 0, 1))); absY = lerp(D.deck + 1.62, 0.1 + 1.05, k) - Math.sin(clamp((t - tWalk1) / 1.1, 0, 1) * Math.PI) * 0.12;
      yaw = y0 + dy * k; pitch = lerp(-0.35, -0.05, k); if (!I.sat && k > 0.5) { I.sat = true; audio.knock(0.22); audio.hullSlap && audio.hullSlap(0.6); ripples.spawn(s.x, s.z, 3, 1.8, 0.35, 0.3); } }
    else { pos.copy(s); eye = 1.05; yaw = launchInfo.psi; absY = 0.1 + 1.05; I.done = true; }
    const y = absY !== null ? absY : floorY(pos.x, pos.z) + eye + bob;
    camera.position.set(pos.x, y, pos.z);
    camera.lookAt(pos.x + Math.sin(yaw) * Math.cos(pitch) * 10, y + Math.sin(pitch) * 10, pos.z + Math.cos(yaw) * Math.cos(pitch) * 10);
    return I.done;
  };
  S.endIntro = () => { canoe.person.visible = true; canoe.paddle.visible = true; };

  // ---------------- events
  const tmp = new THREE.Vector3(), WHITE = new THREE.Color(1, 1, 1), INK = new THREE.Color(0.01, 0.012, 0.02);
  const playerFwd = () => [Math.sin(P.psi), Math.cos(P.psi)], playerLeft = () => [Math.cos(P.psi), -Math.sin(P.psi)];
  // ghosts are transparent and write no depth, so draw them after the (transparent) water or it paints over them
  function addGhost(g) { g.traverse((o) => { o.renderOrder = 4; }); scene.add(g); S.ghosts.push(g); return g; }
  function removeGhost(g) { scene.remove(g); S.ghosts = S.ghosts.filter((x) => x !== g); }
  function ev(name, test, run) { S.events.push({ name, test, run, fired: false, live: null }); }
  const near = (x, z, r) => Math.hypot(P.x - x, P.z - z) < r;

  // ---------- attention: draw the camera to whatever memory is playing ----------
  const ATT = { fn: null, until: 0, k: 0, t: 0 };
  /** turn the player's view toward posFn() for `sec` seconds (eases in and out; manual dragging always wins) */
  function attend(posFn, sec, delay = 1.3) { ATT.fn = posFn; ATT.from = S.playT + delay; ATT.until = S.playT + delay + sec; }
  S.focus = () => (ATT.fn && ATT.k > 0.01 ? Object.assign({ k: ATT.k }, ATT.fn()) : null);
  const gpos = (g, y = 1) => ({ x: g.position.x, y, z: g.position.z });
  /** paddle splashes in time with a ghost boat's animated strokes */
  function strokeSounds(g, T, rate, vol) {
    (g.userData.paddles || []).forEach((pd, i) => {
      const s = Math.sin(T * 2.4 * rate + pd.ph), last = pd.lastS ?? s; pd.lastS = s;
      if ((last < 0 && s >= 0) || (!pd.single && last > 0 && s <= 0)) { g.updateMatrixWorld(); const w = new THREE.Vector3(pd.single ? pd.side * 0.5 : Math.sign(s) * 1.1, 0, 0).applyMatrix4(g.matrixWorld); voices.paddle({ x: w.x, y: 0, z: w.z }, vol * (g.userData.o || 0) * 1.6); ripples.spawn(w.x, w.z, 1.3, 1.4, 0.22 * (g.userData.o || 0) * 1.8, 0.1); }
    });
  }

  // 1. a cantaloupe sails out from the bank and splashes down beside you
  ev('cantaloupe', () => S.playT > 2.5, () => {
    const R = [-Math.cos(P.psi), Math.sin(P.psi)], F = playerFwd();
    const land = [P.x + R[0] * 3.4 + F[0] * 2.5, P.z + R[1] * 3.4 + F[1] * 2.5], from = new THREE.Vector3(launchInfo.q[0] - launchInfo.n[0] * 6, heightAt(launchInfo.q[0] - launchInfo.n[0] * 6, launchInfo.q[1] - launchInfo.n[1] * 6) + 1.7, launchInfo.q[1] - launchInfo.n[1] * 6);
    const geo = new THREE.IcosahedronGeometry(0.17, 2), col = []; const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const v = Math.sin(p.getX(i) * 60) * Math.sin(p.getY(i) * 55) * Math.sin(p.getZ(i) * 58); const k = v > 0.25 ? 0.82 : 1; col.push(0.8 * k, 0.69 * k, 0.48 * k * (1 + 0.12 * Math.sin(p.getY(i) * 20))); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    let melon;
    if (M.cantaloupe) { melon = M.cantaloupe.clone(true); melon.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.renderOrder = 4; } }); melon.scale.setScalar(1.8); scene.add(melon); Object.defineProperty(melon, 'material', { value: { set opacity(v) { melon.traverse((o) => { if (o.isMesh) o.material.opacity = v; }); } } }); }
    else { melon = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, transparent: true, opacity: 1 })); melon.scale.set(1.6, 1.45, 1.6); melon.renderOrder = 4; scene.add(melon); }
    let t = 0, splashed = false, bobbed = 0; const vx = rand(-0.08, 0.08), vz = rand(-0.08, 0.08);
    const at = () => ({ x: melon.position.x, z: melon.position.z });
    voices.memoryIn({ x: land[0], y: 1, z: land[1] });
    voices.line('line_headsup', { x: from.x, y: 1.6, z: from.z }, { vol: 0.9, delay: 0.1 }) || voices.shout({ x: from.x, y: 1.6, z: from.z }, 'hey', { vol: 0.9, delay: 0.1 });       // "heads up!" from the bank
    voices.whoosh({ x: land[0], y: 2, z: land[1] }, 1.2);
    attend(at, 7);
    return (dt, T) => {
      t += dt;
      if (t < 1.2) { const k = t / 1.2; melon.position.set(lerp(from.x, land[0], k), lerp(from.y, 0, k) + Math.sin(k * Math.PI) * 4, lerp(from.z, land[1], k)); melon.rotation.x += dt * 6; }
      else {
        if (!splashed) { splashed = true; ripples.spawn(land[0], land[1], 3.5, 2.6, 0.6, 0.3); ripples.spawn(land[0], land[1], 1.6, 1.6, 0.5, 0.1); voices.bigSplash({ x: land[0], y: 0, z: land[1] }, 0.75); setTimeout(() => voices.laugh({ x: from.x, y: 1.6, z: from.z }, { vol: 0.85, n: 7 }), 700); }
        melon.position.x += vx * dt; melon.position.z += vz * dt; melon.position.y = -0.06 + Math.sin(T * 2.1) * 0.035; melon.rotation.y += dt * 0.2;
        melon.material.opacity = 1 - sstep(5, 13, t); if (t > 5 && Math.random() < dt * 6) MOTES.emit(melon.position.x, 0.1, melon.position.z, 1, 0.25);
        if (t > 1.5 && Math.random() < dt * 0.4) { ripples.spawn(melon.position.x, melon.position.z, 0.8, 1.5, 0.2, 0.2); if (bobbed++ < 6) audio.plop(0, { x: melon.position.x, y: 0, z: melon.position.z }); }
      }
      if (t > 10 && !S._mo1) { S._mo1 = true; voices.memoryOut({ x: melon.position.x, y: 0.5, z: melon.position.z }); }
      if (t > 13.5) { scene.remove(melon); return true; }
    };
  });

  // 2. a kayaker fades in on your right, wobbles, and rolls over
  ev('kayaker', () => S.playT > 14 && Math.hypot(P.x - launchInfo.end[0], P.z - launchInfo.end[1]) > 55, () => {
    const g = addGhost(kayak(false)); let t = 0, flipped = false, yelp = 0, outC = false;
    attend(() => gpos(g, 0.4), 12);
    return (dt, T) => {
      t += dt; const R = [-Math.cos(P.psi), Math.sin(P.psi)], F = playerFwd();
      const want = [P.x + R[0] * 8 + F[0] * 3, P.z + R[1] * 8 + F[1] * 3];
      if (pondSD(want[0], want[1]) < 3) { want[0] = P.x - R[0] * 8 + F[0] * 3; want[1] = P.z - R[1] * 8 + F[1] * 3; }
      if (!g.userData.p) { g.userData.p = want.slice(); voices.memoryIn({ x: want[0], y: 1, z: want[1] }); }
      g.userData.p[0] = lerp(g.userData.p[0], want[0], Math.min(1, dt * 0.8)); g.userData.p[1] = lerp(g.userData.p[1], want[1], Math.min(1, dt * 0.8));
      g.position.set(g.userData.p[0], Math.sin(T * 1.4) * 0.03, g.userData.p[1]); g.rotation.y = P.psi;
      const wob = t < 2.5 ? 0 : t < 7.2 ? Math.sin((t - 2.5) * 3.2) * lerp(0.12, 0.62, (t - 2.5) / 4.7) : 0;
      let roll = wob; if (t >= 7.2) roll = lerp(0.62, Math.PI, ease(clamp((t - 7.2) / 0.55, 0, 1)));
      g.userData.roll.rotation.z = roll;
      // each lurch gets a slap of the hull and a nervous yelp, louder as it gets worse
      const lurch = Math.floor(Math.max(0, t - 2.5) * 3.2 / Math.PI);
      if (t > 2.5 && t < 7.2 && lurch > yelp) { yelp = lurch; audio.knock(0.06 + lurch * 0.03); voices.paddle(gpos(g, 0), 0.6 + lurch * 0.15);
        if (lurch === 2) voices.line('line_whoa', gpos(g), { vol: 0.85, f0: 210 }) || voices.shout(gpos(g), 'oh', { vol: 0.8, f0: 210 }); if (lurch === 4) voices.shout(gpos(g), 'no', { vol: 1, f0: 240 }); }
      if (t > 7.45 && !flipped) { flipped = true; voices.bigSplash(gpos(g, 0), 1.3); ripples.spawn(g.position.x, g.position.z, 5, 3, 0.7, 0.6); ripples.spawn(g.position.x, g.position.z, 2.5, 2, 0.6, 0.3);
        setTimeout(() => voices.erupt({ x: P.x - R[0] * 25 + F[0] * 6, y: 1, z: P.z - R[1] * 25 + F[1] * 6 }, 3, 0.8), 800); }
      if (t < 7.2) { animatePaddles(g, T, 0.6); strokeSounds(g, T, 0.6, 0.7); }
      if (t > 9 && !outC) { outC = true; voices.memoryOut(gpos(g, 0.5)); }
      fadeGhost(g, sstep(0, 2.2, t) * (1 - sstep(9, 12.5, t)) * 0.55, T);
      if (t > 12.6) { removeGhost(g); return true; }
    };
  });

  // 3. two tandem kayaks race past, young men shouting and laughing
  ev('tandems', () => S.sNow > 330 && S.playT > 40, () => {
    const F = playerFwd(), L = playerLeft();
    const boats = [6, 10].map((off, i) => { const g = addGhost(kayak(true)); g.userData.start = [P.x + F[0] * 55 + L[0] * off, P.z + F[1] * 55 + L[1] * off]; g.userData.v = 2.9 + i * 0.25; return g; });
    const dir = [-F[0], -F[1]]; let t = 0, outC = false;
    const mid = () => ({ x: (boats[0].position.x + boats[1].position.x) / 2, y: 1, z: (boats[0].position.z + boats[1].position.z) / 2 });
    voices.memoryIn({ x: boats[0].userData.start[0], y: 1, z: boats[0].userData.start[1] });
    attend(mid, 30);
    // a back-and-forth: one boat calls, the other answers, both crack up; it swells as they pass and trails off
    const call = (i, delay, word) => setTimeout(() => { const b = boats[i]; if (b.visible) voices.shout(gpos(b), word, { vol: 1.15 }); }, delay * 1000);
    const lol = (i, delay, v = 1) => setTimeout(() => { const b = boats[i]; if (b.visible) voices.laugh(gpos(b), { vol: v, n: Math.floor(rand(7, 12)) }); }, delay * 1000);
    setTimeout(() => boats[0].visible && voices.line('line_race', gpos(boats[0]), { vol: 1.15, f0: 230 }), 1200);
    [[0, 2.2, 'hey'], [1, 3.0, 'yeah'], [0, 5.5, 'go'], [1, 6.4, 'dude'], [0, 9.5, 'come'], [1, 10.4, 'woo'], [0, 15, 'go'], [1, 19, 'wait']].forEach(([i, d, w]) => call(i, d, w));
    [[1, 4, 1], [0, 7.2, 1.1], [1, 7.6, 1], [0, 11.5, 1.1], [1, 12.2, 1.1], [0, 16.5, 0.9], [1, 21, 0.7], [0, 24, 0.5]].forEach(([i, d, v]) => lol(i, d, v));
    setTimeout(() => voices.erupt(mid(), 3, 1.1), 8200);
    return (dt, T) => {
      t += dt; let done = true;
      boats.forEach((g, i) => {
        const d = g.userData.v * t; const x = g.userData.start[0] + dir[0] * d, z = g.userData.start[1] + dir[1] * d;
        g.position.set(x, Math.sin(T * 1.5 + i) * 0.03, z); g.rotation.y = Math.atan2(dir[0], dir[1]); animatePaddles(g, T, 1.5); strokeSounds(g, T, 1.5, 0.9);
        g.userData.roll.rotation.z = Math.sin(T * 2 + i) * 0.06;
        if (d < 130) done = false;
        fadeGhost(g, sstep(0, 3, t) * (1 - sstep(90, 125, d)) * 0.55, T);
      });
      if (t * 3 > 90 && !outC) { outC = true; voices.memoryOut(mid()); }
      if (done) { boats.forEach(removeGhost); return true; }
    };
  });

  // 4. halfway between the islands: a canoe towing a picnic table toward Big Island
  const mid = [(route.BIG.c[0] + route.SMALL.c[0]) / 2, (route.BIG.c[1] + route.SMALL.c[1]) / 2];
  ev('picnic', () => near(mid[0], mid[1], 140) || (S.sNow > route.sVia * 0.55 && S.sNow < route.sVia), () => {
    const g = ghostCanoe(2); const tbl = picnicTable(g); g.add(tbl); addGhost(g);
    const tgt = toWater(route.BIG.c[0], route.BIG.c[1] - 60, 10), L = playerLeft();
    const side = Math.sign((tgt[0] - P.x) * L[0] + (tgt[1] - P.z) * L[1]) || 1;
    // start closer, off to one side and ahead, crossing in front of you toward the island
    const start = toWater(P.x + L[0] * 15 * -side + Math.sin(P.psi) * 14, P.z + L[1] * 15 * -side + Math.cos(P.psi) * 14, 8);
    const dir = [tgt[0] - start[0], tgt[1] - start[1]]; const dl = Math.hypot(...dir); dir[0] /= dl; dir[1] /= dl;
    const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: GHOST, transparent: true, opacity: 0 })); rope.material.userData.k = 0.7; g.userData.mats.push(rope.material); rope.renderOrder = 4; scene.add(rope);
    let t = 0, outC = false, nextCreak = 2, nextThunk = 3.5; const v = 1.5;
    const tblW = () => { g.updateMatrixWorld(); const w = new THREE.Vector3(0, 0, -8.5).applyMatrix4(g.matrixWorld); return { x: w.x, y: 0.4, z: w.z }; };
    voices.memoryIn({ x: start[0], y: 1, z: start[1] });
    attend(() => { const a = gpos(g), b = tblW(); return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }; }, 22);
    // quieter, determined: grunts of effort, a few chuckles at the absurdity
    [[3, 'come'], [9, 'go'], [15, 'yeah']].forEach(([d, w]) => setTimeout(() => g.visible && voices.shout(gpos(g), w, { vol: 0.75, f0: rand(150, 190) }), d * 1000));
    [5.5, 11, 17.5].forEach((d) => setTimeout(() => g.visible && voices.laugh(gpos(g), { vol: 0.7, n: 6 }), d * 1000));
    setTimeout(() => g.visible && voices.line('line_pull', gpos(g), { vol: 0.8, f0: 170 }), 7000);
    return (dt, T) => {
      t += dt; const d = Math.min(v * t, dl - 20);
      g.position.set(start[0] + dir[0] * d, Math.sin(T * 1.2) * 0.03, start[1] + dir[1] * d); g.rotation.y = Math.atan2(dir[0], dir[1]); animatePaddles(g, T, 0.8); strokeSounds(g, T, 0.8, 0.8);
      tbl.position.set(Math.sin(T * 0.7) * 0.6, -0.12 + Math.sin(T * 1.6) * 0.04, -8.5); tbl.rotation.set(Math.sin(T * 1.1) * 0.05, Math.sin(T * 0.5) * 0.25, Math.sin(T * 1.3) * 0.06);
      g.updateMatrixWorld(); const a = new THREE.Vector3(0, 0.35, -2.3).applyMatrix4(g.matrixWorld), b = new THREE.Vector3(0, 0.4, -7.6).applyMatrix4(g.matrixWorld);
      rope.geometry.setFromPoints([a, new THREE.Vector3((a.x + b.x) / 2, 0.08, (a.z + b.z) / 2), b]);
      if (t > nextCreak) { nextCreak = t + rand(1.4, 2.6); voices.creak({ x: (a.x + b.x) / 2, y: 0.3, z: (a.z + b.z) / 2 }, g.userData.o * 1.8); }
      if (t > nextThunk) { nextThunk = t + rand(2.5, 5); voices.thunk(tblW(), g.userData.o * 1.8); }
      if (Math.random() < dt * 1.2) { const w = tblW(); ripples.spawn(w.x, w.z, 1.8, 1.8, 0.2, 0.4); }
      if (t > 24 && !outC) { outC = true; voices.memoryOut(gpos(g)); }
      const o = sstep(0, 3.5, t) * (1 - sstep(24, 30, t)) * 0.55; fadeGhost(g, o, T); rope.visible = o > 0.004;
      if (t > 30.5) { removeGhost(g); scene.remove(rope); return true; }
    };
  });

  // 5. Big Island: boys playing somewhere among the trees - "ah beef beef beef beef"
  const bigR = Math.max(...route.BIG.r.map((p) => Math.hypot(p[0] - route.BIG.c[0], p[1] - route.BIG.c[1])));
  ev('island', () => near(route.BIG.c[0], route.BIG.c[1], bigR + 150), () => {
    const spots = route.BIG.r.map((p) => ({ x: lerp(p[0], route.BIG.c[0], 0.04), y: 1.5, z: lerp(p[1], route.BIG.c[1], 0.04) }));
    const closest = () => spots.reduce((a, b) => (Math.hypot(a.x - P.x, a.z - P.z) < Math.hypot(b.x - P.x, b.z - P.z) ? a : b));
    // the boys are in one place (the shore facing you), and move a little along it as you pass
    let home = closest(); const spot = () => ({ x: home.x + rand(-8, 8), y: 1.5, z: home.z + rand(-8, 8) });
    let t = 0, bi = 0, next = 1; const beef = [5, 19];
    const boys = G0(); const bm = gm(boys, GHOST, 0.9); boys.userData.kids = [];
    for (let i = 0; i < 4; i++) { const p = person(boys, bm, i === 1 ? 'boyLeap' : 'boyStand'); p.scale.setScalar(rand(0.85, 1.05)); p.position.set(rand(-4, 4), 0, rand(-2, 2)); boys.add(p); boys.userData.kids.push({ p, ph: rand(0, 6), jump: null }); }
    boys.scale.setScalar(1.7); addGhost(boys);   // larger than life: they're 60-100 m off, across the water
    const shoreAt = (h) => { const [wx, wz] = toWater(h.x, h.z, 2); let x = wx, z = wz; for (let k = 0; k < 40 && pondSD(x, z) > -2; k++) { x += (h.x - wx) * 0.05; z += (h.z - wz) * 0.05; } return { x, z, wx, wz }; };
    voices.memoryIn(home);
    attend(() => home, 9);
    return (dt) => {
      t += dt; const c = closest(); home = { x: lerp(home.x, c.x, Math.min(1, dt * 0.2)), y: 1.5, z: lerp(home.z, c.z, Math.min(1, dt * 0.2)) };
      if (t > next && t < 33) { next = t + rand(0.8, 2.2); if (Math.random() < 0.5) voices.laugh(spot(), { vol: rand(0.8, 1.1) }); else voices.shout(spot(), pick(['hey', 'woo', 'come', 'yeah', 'dude', 'oh', 'no', 'wait']), { vol: rand(0.85, 1.15), f0: rand(190, 280) }); }
      if (bi < beef.length && t > beef[bi]) {
        bi++; const p = spot(); attend(() => p, 6);
        voices.say('beef', 'ah beef beef beef beef', p, { rate: 1.35, pitch: 0.95, volume: 1 });
        setTimeout(() => voices.erupt(p, 3, 1.1), 1900);
      }
      // the boys stand on the shore facing you, horsing around; now and then one leaps in
      const sh = shoreAt(home), gy = Math.max(heightAt(sh.x, sh.z), 0.2);
      boys.position.set(sh.x, gy, sh.z); boys.rotation.y = Math.atan2(P.x - sh.x, P.z - sh.z);
      boys.userData.kids.forEach((kd, i) => {
        if (kd.jump) { const u = (t - kd.jump.t0) / 1.1; kd.p.position.set(kd.jump.x, Math.sin(Math.min(u, 1) * Math.PI) * 1.6 - u * u * 0.9 * gy - (u > 1 ? (u - 1) * 3 : 0), kd.jump.z + u * 5);
          if (u > 1 && !kd.jump.sp) { kd.jump.sp = true; boys.updateMatrixWorld(); const w = kd.p.getWorldPosition(new THREE.Vector3()); ripples.spawn(w.x, w.z, 4, 2.5, 0.6, 0.4); voices.bigSplash({ x: w.x, y: 0, z: w.z }, 0.9); setTimeout(() => voices.erupt({ x: sh.x, y: 1, z: sh.z }, 2.5, 0.9), 300); }
          if (u > 3) { kd.jump = null; kd.p.position.set(rand(-4, 4), 0, rand(-2, 2)); } }
        else { kd.p.position.y = Math.abs(Math.sin(t * 3 + kd.ph)) * 0.18; kd.p.rotation.y = Math.sin(t * 0.8 + kd.ph) * 0.8; }
      });
      if (Math.random() < dt * 0.13 && t < 30) { const kd = boys.userData.kids[Math.floor(Math.random() * 4)]; if (!kd.jump) { kd.jump = { t0: t, x: kd.p.position.x, z: kd.p.position.z }; voices.shout({ x: sh.x, y: 1, z: sh.z }, 'woo', { vol: 1.1 }); } }
      fadeGhost(boys, sstep(0, 3, t) * (1 - sstep(30, 35, t)) * 0.9, t);
      if (t > 33 && !S._mo5) { S._mo5 = true; voices.memoryOut(home); }
      if (t > 36) { removeGhost(boys); return true; }
    };
  });

  // 6. rounding the island: a race - two tandem kayaks and a canoe - one is shoved into the fallen tree
  ev('race', () => S.sNow > sTree - 150 && S.sNow < sTree + 40, () => {
    const F = playerFwd(), L = playerLeft();
    const boats = [kayak(true), kayak(true), ghostCanoe(2)].map((g, i) => { addGhost(g); g.userData.lane = [5, 9, 13][i]; g.userData.v = [4.3, 4.6, 4.2][i]; return g; });
    const canoeG = boats[2];
    boats.forEach((g) => { g.userData.p = [P.x - F[0] * 32 + L[0] * g.userData.lane, P.z - F[1] * 32 + L[1] * g.userData.lane]; });
    let t = 0, beached = false, bt = 0, nextCall = 0.5, outC = false, shoved = false;
    const pack = () => { const c = boats.reduce((a, g) => [a[0] + g.position.x / 3, a[1] + g.position.z / 3], [0, 0]); return { x: c[0], y: 1, z: c[1] }; };
    voices.memoryIn({ x: P.x - F[0] * 30, y: 1, z: P.z - F[1] * 30 });
    attend(() => (beached ? { x: treeTip[0], z: treeTip[1] } : pack()), 40);
    return (dt, T) => {
      t += dt;
      // trash talk while they race: rapid calls, mostly shouting over each other
      if (!beached && t > nextCall) { nextCall = t + rand(0.5, 1.2); const b = boats[Math.floor(Math.random() * 3)]; if (b.visible) (Math.random() < 0.7 ? voices.shout(gpos(b), pick(['go', 'hey', 'no', 'come', 'wait', 'woo', 'dude']), { vol: 1.2, f0: rand(190, 290) }) : voices.laugh(gpos(b), { vol: 1 })); }
      boats.forEach((g, i) => {
        const p = g.userData.p; let tx, tz;
        if (g === canoeG) { tx = treeTip[0] - treeDir[0] * 1.5; tz = treeTip[1] - treeDir[1] * 1.5; }
        else { const ahead = routeAt(route, Math.min(S.sNow + 90, route.L)); tx = ahead.x + L[0] * (g.userData.lane - 2); tz = ahead.z + L[1] * (g.userData.lane - 2); }
        const dx = tx - p[0], dz = tz - p[1], d = Math.hypot(dx, dz);
        if (g === canoeG && !shoved && d < 14) { shoved = true; audio.knock(0.25); voices.shout(gpos(g), 'no', { vol: 1.3, f0: 260 }); voices.shout(gpos(boats[1]), 'go', { vol: 1.2, delay: 0.25 }); }
        let v = g.userData.v * (g === canoeG && beached ? 0 : 1);
        if (g === canoeG && d < 2.5 && !beached) { beached = true; bt = t; voices.scrape({ x: p[0], y: 0.3, z: p[1] }); voices.bigSplash({ x: p[0], y: 0, z: p[1] }, 0.8); ripples.spawn(p[0], p[1], 5, 3, 0.6, 0.6);
          setTimeout(() => voices.erupt({ x: p[0], y: 1, z: p[1] }, 5, 1.3), 450); setTimeout(() => voices.line('line_stuck', { x: p[0], y: 1, z: p[1] }, { vol: 1.2, f0: 260 }), 2600); setTimeout(() => voices.erupt(pack(), 4, 1.1), 1400); }
        if (beached && g !== canoeG) v *= Math.max(0, 1 - (t - bt) / 2.5);                     // the others pull up, laughing
        if (d > 0.5 && v > 0) { p[0] += (dx / d) * v * dt; p[1] += (dz / d) * v * dt; g.rotation.y = lerp(g.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 3)); }
        g.position.set(p[0], Math.sin(T * 1.6 + i) * 0.03, p[1]);
        if (g === canoeG && beached) g.userData.roll.rotation.z = lerp(g.userData.roll.rotation.z, 0.28, Math.min(1, dt * 3));
        else if (v > 0.5) { animatePaddles(g, T, 1.7); strokeSounds(g, T, 1.7, 1); }
        fadeGhost(g, sstep(0, 2.5, t) * (beached ? 1 - sstep(4, 8, t - bt) : 1) * (1 - sstep(38, 42, t)) * 0.55, T);
      });
      if (beached && t - bt > 4 && !outC) { outC = true; voices.memoryOut({ x: treeTip[0], y: 1, z: treeTip[1] }); }
      if ((beached && t - bt > 8.2) || t > 42.5) { boats.forEach(removeGhost); return true; }
    };
  });


  // ---------- v0.6.5 memories ----------
  // A. a flotilla: two tandem kayaks and a canoe, one tandem towing a man in a life jacket on a rope (~180 m in)
  ev('flotilla', () => S.sNow > 170 && S.playT > 26, () => {
    const F = playerFwd(), L = playerLeft();
    const boats = [kayak(true), kayak(true), ghostCanoe(2)].map((g, i) => { addGhost(g); g.userData.lane = [-9, -14, -19][i]; g.userData.ahead = [48, 56, 64][i]; return g; });
    const tow = boats[0];
    // the swimmer: a kayaker figure lying back in the water in his PFD, on a sagging rope 6 m behind
    const swim = G0(); const sm = gm(swim, GHOST, 0.95); const fig = person(swim, sm, 'kayaker'); fig.rotation.x = -1.25; fig.position.set(0, -0.35, 0); swim.add(fig); addGhost(swim);
    const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: GHOST, transparent: true, opacity: 0 }));
    rope.material.userData.k = 0.8; tow.userData.mats.push(rope.material); rope.renderOrder = 4; scene.add(rope);
    const dir = [-F[0], -F[1]], v = 2.6; let t = 0, outC = false, splashT = 0;
    boats.forEach((g) => { g.userData.start = [P.x + F[0] * g.userData.ahead + L[0] * g.userData.lane, P.z + F[1] * g.userData.ahead + L[1] * g.userData.lane]; });
    voices.memoryIn({ x: boats[1].userData.start[0], y: 1, z: boats[1].userData.start[1] });
    attend(() => gpos(swim, 0.3), 22);
    // the swimmer whoops and sputters; the paddlers egg each other on to go faster
    [[2.5, 'woo'], [6, 'go'], [9.5, 'yeah'], [13, 'woo'], [17, 'go']].forEach(([d, w], i) => setTimeout(() => { const b = i % 2 ? swim : boats[i % 3]; b.visible && voices.shout(gpos(b), w, { vol: 1.1, f0: rand(180, 260) }); }, d * 1000));
    [4, 8, 11.5, 15, 19].forEach((d) => setTimeout(() => boats[0].visible && voices.laugh(gpos(boats[Math.floor(rand(0, 3))]), { vol: 1 }), d * 1000));
    setTimeout(() => swim.visible && voices.line('line_faster', gpos(swim, 0.3), { vol: 1.1, f0: 270 }), 7500);
    return (dt, T) => {
      t += dt; let done = true;
      boats.forEach((g, i) => {
        const d = v * t, x = g.userData.start[0] + dir[0] * d, z = g.userData.start[1] + dir[1] * d;
        g.position.set(x, Math.sin(T * 1.5 + i) * 0.03, z); g.rotation.y = Math.atan2(dir[0], dir[1]); animatePaddles(g, T, 1.4); strokeSounds(g, T, 1.4, 0.8);
        g.userData.roll.rotation.z = Math.sin(T * 2 + i) * 0.05;
        if (d < 135) done = false;
        fadeGhost(g, sstep(0, 3, t) * (1 - sstep(95, 130, d)) * 0.55, T);
      });
      // swimmer trails the tow kayak's stern, bouncing in its wake
      tow.updateMatrixWorld(); const stern = new THREE.Vector3(0, 0.25, -2.5).applyMatrix4(tow.matrixWorld);
      const back = [-dir[0], -dir[1]], sx = stern.x + back[0] * 6 + Math.sin(T * 0.9) * 0.6 * dir[1], sz = stern.z + back[1] * 6 - Math.sin(T * 0.9) * 0.6 * dir[0];
      swim.position.set(sx, Math.sin(T * 2.4) * 0.06, sz); swim.rotation.y = Math.atan2(dir[0], dir[1]); swim.rotation.z = Math.sin(T * 1.7) * 0.15;
      rope.geometry.setFromPoints([stern, new THREE.Vector3((stern.x + sx) / 2, 0.05, (stern.z + sz) / 2), new THREE.Vector3(sx, 0.35, sz)]);
      fadeGhost(swim, tow.userData.o * 1.1, T); rope.visible = tow.visible;
      if (t > splashT) { splashT = t + rand(0.4, 0.9); ripples.spawn(sx, sz, 2.4, 1.8, 0.35 * tow.userData.o * 1.8, 0.4); if (Math.random() < 0.4) voices.paddle({ x: sx, y: 0, z: sz }, 0.8 * tow.userData.o * 1.8); }
      if (v * t > 95 && !outC) { outC = true; voices.memoryOut(gpos(boats[1])); }
      if (done) { boats.forEach(removeGhost); removeGhost(swim); scene.remove(rope); return true; }
    };
  });

  // B. a canoe of three: the one in the middle drops the binoculars over the side (in the long stretch after Big Island)
  const sBino = sTree + Math.max(120, ((route.sCreek || route.L) - sTree) * 0.45);
  S.sBino = sBino;
  ev('binoculars', () => S.sNow > sBino - 40 && S.sNow < (route.sCreek || route.L) - 30, () => {
    const F = playerFwd(), L = playerLeft();
    const side = pondSD(P.x + L[0] * 16, P.z + L[1] * 16) > 6 ? 1 : -1;
    const g = ghostCanoe(3); addGhost(g);
    const start = toWater(P.x + F[0] * 26 + L[0] * 14 * side, P.z + F[1] * 26 + L[1] * 14 * side, 6);
    g.userData.p = start.slice(); g.rotation.y = Math.atan2(F[0], F[1]) + 0.25 * side;
    const mid = g.userData.middle, bm = gm(g, GHOST, 0.95);
    const bino = new THREE.Group(); [-0.045, 0.045].forEach((x) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.14, 8), bm); c.rotation.x = Math.PI / 2; c.position.x = x; bino.add(c); });
    bino.position.set(0, 1.05, 0.22); if (mid) mid.add(bino); else g.add(bino);
    let t = 0, dropped = false, splashed = false, outC = false, drop = null; const vb = new THREE.Vector3();
    voices.memoryIn({ x: start[0], y: 1, z: start[1] });
    attend(() => (drop && drop.y > -0.5 ? { x: drop.x, z: drop.z } : gpos(g)), 20);
    setTimeout(() => g.visible && voices.shout(gpos(g), 'hey', { vol: 0.9, f0: 200 }), 2200);                    // "look, there!"
    setTimeout(() => g.visible && voices.shout(gpos(g), 'oh', { vol: 0.8, f0: 230 }), 3600);
    return (dt, T) => {
      t += dt;
      g.userData.p[0] += Math.sin(g.rotation.y) * 0.6 * dt; g.userData.p[1] += Math.cos(g.rotation.y) * 0.6 * dt;
      g.position.set(g.userData.p[0], Math.sin(T * 1.2) * 0.03, g.userData.p[1]);
      if (t < 6.5) { animatePaddles(g, T, 0.4); if (mid) { mid.rotation.y = Math.sin(t * 0.6) * 0.5; bino.rotation.x = -0.15; } }
      // the fumble: he lifts them, reaches out over the gunwale, they slip
      if (t > 6.5 && !dropped) { if (mid) { mid.rotation.y = lerp(mid.rotation.y, 1.2 * side, Math.min(1, dt * 3)); mid.rotation.z = lerp(mid.rotation.z, -0.35 * side, Math.min(1, dt * 3)); } g.userData.roll.rotation.z = lerp(g.userData.roll.rotation.z, 0.12 * -side, Math.min(1, dt * 3)); }
      if (t > 7.6 && !dropped) {
        dropped = true; bino.getWorldPosition(vb); (mid || g).remove(bino); scene.add(bino); bino.position.copy(vb); bino.renderOrder = 4;
        drop = { x: vb.x, y: vb.y, z: vb.z, vx: Math.sin(g.rotation.y + side * Math.PI / 2) * 1.2, vz: Math.cos(g.rotation.y + side * Math.PI / 2) * 1.2, vy: 0.8 };
        voices.line('line_binos', gpos(g), { vol: 1.4, f0: 270 }) || voices.shout(gpos(g), 'no', { vol: 1.4, f0: 270 }); voices.shout(gpos(g), 'no', { vol: 1.2, f0: 190, delay: 0.5 });
      }
      if (drop) {
        if (drop.y > 0 || !splashed) { drop.vy -= 9.8 * dt; drop.x += drop.vx * dt; drop.z += drop.vz * dt; drop.y += drop.vy * dt; bino.position.set(drop.x, drop.y, drop.z); bino.rotation.x += dt * 8; bino.rotation.z += dt * 5; }
        if (drop.y <= 0 && !splashed) { splashed = true; audio.plop(0, { x: drop.x, y: 0, z: drop.z }); ripples.spawn(drop.x, drop.z, 1.8, 2.4, 0.6, 0.1); ripples.spawn(drop.x, drop.z, 3.2, 3.2, 0.4, 0.2);
          // everyone is distraught: a long falling groan, a "no no no", a hand to the head; then silence
          setTimeout(() => voices.shout(gpos(g), 'oh', { vol: 1.3, f0: 210, take: 2 }), 250); setTimeout(() => voices.shout(gpos(g), 'oh', { vol: 1.1, f0: 150, take: 2 }), 500);
          setTimeout(() => { voices.shout(gpos(g), 'no', { vol: 1, f0: 200, take: 2 }); voices.shout(gpos(g), 'no', { vol: 0.9, f0: 200, delay: 0.35 }); voices.shout(gpos(g), 'no', { vol: 0.8, f0: 190, delay: 0.7 }); }, 1400);
          setTimeout(() => voices.line('line_dad', gpos(g), { vol: 0.9, f0: 190 }), 6200);
          setTimeout(() => voices.shout(gpos(g), 'dude', { vol: 1.1, f0: 170 }), 3200); setTimeout(() => voices.shout(gpos(g), 'wait', { vol: 0.8, f0: 160 }), 4600); }
        if (splashed) { drop.y -= dt * 0.6; bino.position.y = drop.y; if (Math.random() < dt * 3 && drop.y > -1.5) ripples.spawn(drop.x, drop.z, 0.6, 1.2, 0.3, 0.05); }   // sinks, trailing bubbles
      }
      // after the splash: all three lean over the side staring into the water, slumped
      if (splashed) { g.userData.roll.rotation.z = lerp(g.userData.roll.rotation.z, 0.18 * -side, Math.min(1, dt * 2)); if (mid) mid.rotation.x = lerp(mid.rotation.x, 0.45, Math.min(1, dt * 2)); }
      if (t > 15 && !outC) { outC = true; voices.memoryOut(gpos(g)); }
      fadeGhost(g, sstep(0, 2.5, t) * (1 - sstep(15, 19, t)) * 0.6, T);
      if (t > 19.5) { removeGhost(g); scene.remove(bino); return true; }
    };
  });

  // ---------- v0.7.0 (photos 70-75): the catch - golden hour, a friend standing in the shallows holding up two fish,
  //            two aluminum canoes nosed onto the bank either side of him; whoops from the shore
  // where the route runs 15-45 m off a shore (either side), so he's close enough to read
  let sCatch = sBino + Math.max(90, ((route.sCreek || route.L) - sBino) * 0.55), CS = null;
  for (let sv = sBino + 90; sv < (route.sCreek || route.L) - 50 && !CS; sv += 6) { const rp = routeAt(route, sv);
    for (const sd of [1, -1]) { let x = rp.x, z = rp.z, d = 0; while (d < 60 && pondSD(x, z) > 0) { x += rp.dz * 2 * sd; z += -rp.dx * 2 * sd; d += 2; } if (d >= 16 && d <= 46 && !CS) { CS = { x, z }; sCatch = sv; } } }
  S.sCatch = sCatch;
  ev('catch', () => S.sNow > sCatch - 45 && S.sNow < (route.sCreek || route.L) - 20, () => {
    const F = playerFwd(), L2 = playerLeft();
    // nearest shore ahead on either side
    let best = CS ? { x: CS.x, z: CS.z } : null; if (!best) for (const sd of [1, -1]) { let x = P.x + F[0] * 22, z = P.z + F[1] * 22, d = 0; while (d < 140 && pondSD(x, z) > 0) { x += L2[0] * 2 * sd; z += L2[1] * 2 * sd; d += 2; } if (!best || d < best.d) best = { x, z, d, sd }; }
    const g = G0(), m = gm(g, GHOST, 0.95), mh = gm(g, GHOST, 0.75);
    const [gx, gz] = grad(best.x, best.z), wx = best.x + gx * 2.2, wz = best.z + gz * 2.2;     // just off the bank, knee-deep
    g.position.set(wx, -0.3, wz); g.rotation.y = Math.atan2(P.x - wx, P.z - wz); g.scale.setScalar(1.5);
    const fisher = new THREE.Group(); fisher.add(M.fisher ? recolor(M.fisher.clone(true), m) : person(g, m, 'paddler')); fisher.rotation.y = Math.PI; g.add(fisher);
    [-1, 1].forEach((sd) => { const c = M.canoeAlu ? recolor(M.canoeAlu.clone(true), mh) : new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 4, 4, 8), mh); const w = new THREE.Group(); w.add(c);
      w.position.set(sd * 1.5, 0.3, -3.3); w.rotation.set(-0.08, sd * 0.18, 0); g.add(w); });   // nosed up on the bank behind him
    addGhost(g);   // after the children, so they all get the ghost draw order
    let t = 0, outC = false, k0 = 0;
    voices.memoryIn({ x: wx, y: 1, z: wz }); attend(() => ({ x: g.position.x, z: g.position.z }), 14);
    setTimeout(() => g.visible && voices.shout(gpos(g), 'woo', { vol: 1, f0: 220 }), 2500);
    setTimeout(() => g.visible && voices.shout(gpos(g), 'yeah', { vol: 0.9, f0: 190, take: 1 }), 4200);
    setTimeout(() => g.visible && voices.laugh(gpos(g), { vol: 0.9, n: 8 }), 6000);
    setTimeout(() => g.visible && voices.shout(gpos(g), 'dude', { vol: 0.8, f0: 170 }), 9500);
    return (dt, T) => {
      t += dt;
      fisher.position.y = Math.max(0, Math.sin(Math.min(t, 6) * 1.2)) * 0.08;                   // hoisting the fish up, bouncing on his heels
      fisher.rotation.z = Math.sin(t * 1.7) * 0.04;
      if (Math.random() < dt * 1.5) ripples.spawn(wx + rand(-0.4, 0.4), wz + rand(-0.4, 0.4), 0.6, 1.2, 0.18, 0.05);
      if (t > 13 && !outC) { outC = true; voices.memoryOut(gpos(g)); }
      fadeGhost(g, sstep(0, 2.5, t) * (1 - sstep(13, 17, t)) * 0.7, T);
      if (t > 17.5) { removeGhost(g); return true; }
    };
  });

  // ---------- v0.7.0 (photos 41-44): a deer in the creek grass - real, not a memory. It lifts its head, watches, and bounds off
  ev('deer', () => creekSD(P.x, P.z) > -2 && CQ.s > CREEK.L * 0.28, () => {
    const F = playerFwd(), L2 = playerLeft(), sd = Math.random() < 0.5 ? 1 : -1;
    let x = P.x + F[0] * 20, z = P.z + F[1] * 20, d = 0; while (d < 30 && creekSD(x, z) > -2.5) { x += L2[0] * sd; z += L2[1] * sd; d++; }
    const deer = M.deer ? M.deer.clone(true) : new THREE.Mesh(new THREE.BoxGeometry(0.4, 1, 1.4), new THREE.MeshStandardMaterial({ color: 0x8a5a32 }));
    const tilt = new THREE.Group(); tilt.add(deer); const g = new THREE.Group(); g.add(tilt); scene.add(g); S.deer = g;   // animate the wrapper, never the model (its own rotation is the loader's turn-round)
    const gy = () => Math.max(heightAt(g.position.x, g.position.z), 0.1);
    g.position.set(x, 0, z); g.position.y = gy(); g.rotation.y = Math.atan2(P.x - x, P.z - z) + Math.PI;   // the model looks along -Z
    let t = 0, fled = -1, hops = 0; const away = [L2[0] * sd, L2[1] * sd];
    return (dt, T) => {
      t += dt; const near2 = Math.hypot(P.x - g.position.x, P.z - g.position.z);
      if (fled < 0) { tilt.rotation.x = t < 1.2 ? 0.25 * (1 - t / 1.2) : Math.sin(t * 0.7) * 0.03;          // head comes up out of the grass
        if (t > 1.5 && t < 2) attend(() => ({ x: g.position.x, z: g.position.z }), 6, 0);
        if (near2 < 11 || t > 9) { fled = t; audio.knock(0.12); voices.whoosh({ x: g.position.x, y: 1, z: g.position.z }, 0.5); g.rotation.y = Math.atan2(-away[0], -away[1]); } }
      else { const u = t - fled; g.position.x += away[0] * 6.5 * dt; g.position.z += away[1] * 6.5 * dt;
        const ph = (u * 2.4) % 1; g.position.y = gy() + Math.sin(ph * Math.PI) * 0.9; tilt.rotation.x = Math.sin(ph * Math.PI * 2) * 0.25;
        if (Math.floor(u * 2.4) > hops) { hops = Math.floor(u * 2.4); audio.knock(0.07 / (1 + hops * 0.4)); }
        if (u > 4) { scene.remove(g); return true; } }
    };
  });

  // ---------- the ghost campsite on Big Island: glows into view as you approach, there all along ----------
  {
    // the stretch of island shore the route passes closest to (before the turn), so it is seen from ~30-40 m
    let best = route.BIG.r[0], bd = 1e9, target = route.R[0];
    route.R.forEach((r) => { if (r.s < route.sVia * 0.5 || r.s > route.sVia + 40) return; route.BIG.r.forEach((p) => { const d = Math.hypot(p[0] - r.x, p[1] - r.z); if (d < bd) { bd = d; best = p; target = r; } }); });
    S.campS = target.s;
    const inX = lerp(best[0], route.BIG.c[0], 0.07), inZ = lerp(best[1], route.BIG.c[1], 0.07), gy = Math.max(heightAt(inX, inZ), 0.3);
    const camp = G0(); camp.position.set(inX, gy, inZ); camp.rotation.y = Math.atan2(target.x - inX, target.z - inZ);
    const cm = gm(camp, GHOST, 0.9), cm2 = gm(camp, GHOST, 1.0); cm.fog = cm2.fog = false; cm.depthWrite = cm2.depthWrite = true; cm.color.set(0xffc27e); cm2.color.set(0xffd09a);   // write depth so the mist pass sees them at their real distance, not the sky behind   // warm and un-fogged so it reads across the water
    [[-3.2, -1.5, 0.5], [3.4, -2.2, -0.4]].forEach(([x, z, r]) => { let t; if (M.tent) { t = recolor(M.tent.clone(true), cm); t.scale.setScalar(0.95); } else { t = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.3, 4), cm); t.position.y = 0.65; } const w = new THREE.Group(); w.add(t); w.position.set(x, 0, z); w.rotation.y = r; camp.add(w); });
    [[-1.3, 1.6, 0.8], [1.4, 1.5, -0.9], [0.1, 2.9, 3.1]].forEach(([x, z, r]) => { const p = person(camp, cm2, 'paddler'); p.position.set(x, -0.05, z); p.rotation.y = r; camp.add(p); });   // sitting round the fire
    const fireTex = glowTexture(); const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, color: 0xffa04a, blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false })); fire.scale.set(4, 4, 1); fire.position.set(0, 0.6, 1.9); fire.material.userData.k = 1.66; camp.userData.mats.push(fire.material); camp.add(fire);
    // v0.7.0 (photos 61-63): a card game round a tarp-covered table
    const tbl = new THREE.Group(); tbl.position.set(-4.4, 0, 1.4); tbl.rotation.y = 0.3; camp.add(tbl);
    const ttop = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 1.6), cm); ttop.position.y = 0.72; tbl.add(ttop);
    const tarpG = new THREE.PlaneGeometry(1.1, 1.95, 4, 6); { const tp = tarpG.attributes.position; for (let i = 0; i < tp.count; i++) { const x = tp.getX(i), y = tp.getY(i); tp.setZ(i, -(Math.max(0, Math.abs(x) - 0.4) + Math.max(0, Math.abs(y) - 0.8)) * 1.4); } }
    const tarp = new THREE.Mesh(tarpG, cm); tarp.rotation.x = -Math.PI / 2; tarp.position.y = 0.76; tbl.add(tarp);
    [[-0.08, 0.2], [0.12, -0.1], [0.0, 0.42], [-0.15, -0.35]].forEach(([x, z]) => { const c = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.13), cm2); c.rotation.set(-Math.PI / 2, 0, x * 9); c.position.set(x, 0.8, z); tbl.add(c); });
    const players = [[-0.75, 0.3, Math.PI / 2], [0.75, -0.2, -Math.PI / 2], [0.1, 1.2, Math.PI]].map(([x, z, r]) => { const p = person(camp, cm2, 'paddler'); p.position.set(x, -0.05, z); p.rotation.y = r; tbl.add(p); return p; });
    // v0.7.0 (photos 55-56, 66-69): a hammock slung between two trees, one friend lying in it, another about to swing it
    const hamT = new THREE.Group(); hamT.position.set(4.6, 0, 1.0); hamT.rotation.y = -0.35; camp.add(hamT);
    const trM = gm(camp, GHOST, 0.3); trM.fog = false; [-2.1, 2.1].forEach((x) => { const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 3.2, 7), trM); tr.position.set(x, 1.6, 0); hamT.add(tr); });   // just the lower trunks, faint
    const swing = new THREE.Group(); swing.position.y = 1.7; hamT.add(swing);   // pivot on the rope line, so it rocks side to side
    const hg = new THREE.PlaneGeometry(2.9, 1.1, 14, 5); { const hp = hg.attributes.position; for (let i = 0; i < hp.count; i++) { const u = hp.getX(i) / 1.45, v = hp.getY(i) / 0.55, sag = 1 - u * u; hp.setY(i, v * 0.55 * (0.25 + 0.75 * Math.sqrt(Math.max(0, sag)))); hp.setZ(i, -0.45 - 0.7 * sag + 0.22 * v * v * sag); } }
    const ham = new THREE.Mesh(hg, cm2); ham.material.side = THREE.DoubleSide; ham.rotation.x = -Math.PI / 2; swing.add(ham);
    [-1, 1].forEach((sg) => { const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 3), cm); rope.rotation.z = Math.PI / 2 + sg * 0.5; rope.position.set(sg * 1.75, -0.25, 0); swing.add(rope); });
    const lier = person(camp, cm2, 'kayaker'); lier.rotation.set(-Math.PI / 2 + 0.25, 0, Math.PI / 2); lier.position.set(-0.1, -1.05, 0.3); swing.add(lier);
    const pusher = person(camp, cm2, M.boyStand ? 'boyStand' : 'paddler'); pusher.position.set(0.2, 0, 1.25); pusher.rotation.y = Math.PI; hamT.add(pusher);
    camp.scale.setScalar(2.3);   // larger than life: it is read from the water, 60-150 m away
    addGhost(camp); S.ghosts = S.ghosts.filter((x) => x !== camp);   // persistent, not part of an event
    { // clear the trees from the campsite so it can be seen from the water
      const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      scene.traverse((o) => { if (!o.isInstancedMesh || o.userData.tag !== 'tree') return; let hit = false;
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m4); pos.setFromMatrixPosition(m4); if (Math.hypot(pos.x - inX, pos.z - inZ) < 14) { m4.decompose(pos, q, sc); m4.compose(pos, q, sc.set(0, 0, 0)); o.setMatrixAt(i, m4); hit = true; } }
        if (hit) o.instanceMatrix.needsUpdate = true; });
    }
    S.ghostCamp = camp;
    S.updateGhostCamp = (T) => {
      const d = Math.hypot(P.x - inX, P.z - inZ), k = sstep(330, 160, d) * (1 - sstep(route.sVia + 60, route.sVia + 200, S.sNow));
      fadeGhost(camp, k * 0.75, T); fire.scale.setScalar(4 * (0.9 + 0.12 * Math.sin(T * 9) * Math.sin(T * 5.3)));
      if (k > 0.3 && !S._campSound) { S._campSound = true; voices.memoryIn({ x: inX, y: 1, z: inZ }); }
      // v0.7.0: once it is in view, the card game and the hammock play out
      if (k > 0.55 && S.campT === undefined) S.campT = 0;
      if (S.campT !== undefined && S.campT < 40) {
        const dt = Math.min(0.1, T - (S._campLast ?? T)); S.campT += dt; const t = S.campT, W = (o, y = 1) => { const v = o.getWorldPosition(new THREE.Vector3()); return { x: v.x, y, z: v.z }; };
        if (t > 1.5 && !S._cards1) { S._cards1 = true; voices.shout(W(tbl), 'oh', { vol: 0.9, f0: 200 }); setTimeout(() => voices.laugh(W(tbl), { vol: 0.9, n: 9 }), 350); }
        players[0].rotation.x = t > 1.4 && t < 3 ? -0.35 * Math.sin((t - 1.4) / 1.6 * Math.PI) : 0;          // a big hand slapped down
        if (t > 4 && !S._hamA) { S._hamA = true; attend(() => W(hamT), 13, 0.4); voices.laugh(W(hamT), { vol: 0.7, n: 5, small: true }); }
        const amp = t < 4 ? 0 : t < 11 ? lerp(0.08, 0.95, (t - 4) / 7) : Math.max(0, 0.95 - (t - 11) * 0.18);
        swing.rotation.x = amp * Math.sin((t - 4) * 2.4); pusher.rotation.x = t > 4 && t < 11 ? Math.max(0, Math.sin((t - 4) * 2.4)) * 0.25 : 0;
        if (t > 11 && !S._dump) { S._dump = true; S._dumpT = t; const wp = lier.getWorldPosition(new THREE.Vector3()); swing.remove(lier); hamT.add(lier); hamT.worldToLocal(wp); lier.position.copy(wp); lier.rotation.set(-1.2, 0.4, 1.4);
          voices.thunk(W(hamT, 0.2), 0.8); voices.shout(W(hamT), 'no', { vol: 1, f0: 240 }); setTimeout(() => voices.erupt(W(hamT), 4, 1.1), 500); }
        if (S._dump) { const u = clamp((t - S._dumpT) / 0.5, 0, 1); lier.position.y = lerp(lier.position.y, 0.05, u); lier.position.z = lerp(lier.position.z, 0.9, u * 0.3); }
        if (t > 19 && !S._cards2) { S._cards2 = true; voices.shout(W(tbl), 'yeah', { vol: 0.9, f0: 230 }); setTimeout(() => voices.laugh(W(tbl), { vol: 0.8 }), 300); }
        players[2].rotation.x = t > 18.8 && t < 20.5 ? -0.3 * Math.sin((t - 18.8) / 1.7 * Math.PI) : 0;
      }
      S._campLast = T;
    };
  }

  // ---------- objectives: 'paddle to the island' (with a faint glow over Big Island), then 'paddle to the creek' ----------
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd7a0, blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  glow.scale.set(150, 90, 1); glow.position.set(route.BIG.c[0], 24, route.BIG.c[1]); glow.renderOrder = 6; scene.add(glow);
  const OBJ = { stage: 0, t: 0 };
  // the island's boundary: 70 m off its shore, or wider if the paddling route never comes that close (it passes ~100 m off)
  const ISL_R = (() => { let m = 1e9; route.R.forEach((r) => { if (r.s > route.sVia + 60) return; route.BIG.r.forEach((q) => { m = Math.min(m, Math.hypot(q[0] - r.x, q[1] - r.z)); }); }); return Math.max(70, m + 30); })(); S.islandR = ISL_R;
  function say(text) { const el = $('objective'); if (!el) return; el.textContent = text; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); clearTimeout(OBJ.h); OBJ.h = setTimeout(() => el.classList.remove('on'), 6500); }
  S.updateObjective = (dt, T) => {
    OBJ.t += dt;
    if (OBJ.stage === 0 && S.playT > 1.2) { OBJ.stage = 1; say('paddle to the island'); }
    const dIsl = Math.hypot(P.x - route.BIG.c[0], P.z - route.BIG.c[1]);
    // v0.7.2: 'reached' means actually alongside the island (within ~45 m of its shore), not just inside its bounding circle
    let dShore = 1e9; if (OBJ.stage === 1) for (const q of route.BIG.r) { const d = (q[0] - P.x) ** 2 + (q[1] - P.z) ** 2; if (d < dShore) dShore = d; } dShore = Math.sqrt(dShore);
    // v0.8.0 draft: freeplay until you cross the island's boundary (within 70 m of its shore) - then the story takes over
    if (OBJ.stage === 1 && dShore < ISL_R) { OBJ.stage = 2; OBJ.reachedT = S.playT; if (S.nightT0 === undefined) { S.nightT0 = S.playT; S.sReach = S.sNow; } }   // v0.7.0: night falls at Big Island
    if (OBJ.stage === 2 && S.playT > OBJ.reachedT + 22) { OBJ.stage = 3; say('paddle to the creek'); }
    const want = OBJ.stage === 1 ? 0.22 * sstep(bigR + 40, bigR + 260, dIsl) : 0;
    glow.material.opacity = lerp(glow.material.opacity, want * (0.85 + 0.15 * Math.sin(T * 0.8)), Math.min(1, dt * 0.8));
    glow.visible = glow.material.opacity > 0.003;
  };

  // ---------------- per-frame
  S.update = (dt, T) => {
    if (G.mode !== 'play' || S.ended) return;
    S.playT += dt;
    // where are we along the journey?
    const R = route.R; let bi = S.idx, bd = 1e18;
    for (let k = Math.max(0, S.idx - 30); k < Math.min(R.length, S.idx + 60); k++) { const d = (R[k].x - P.x) ** 2 + (R[k].z - P.z) ** 2; if (d < bd) { bd = d; bi = k; } }
    if (bd > 120 * 120) for (let k = 0; k < R.length; k++) { const d = (R[k].x - P.x) ** 2 + (R[k].z - P.z) ** 2; if (d < bd) { bd = d; bi = k; } }
    S.idx = bi; S.sNow = R[bi].s;
    const tgt = routeAt(route, Math.min(R[bi].s + 45, route.L)); S.target = tgt;
    let dx = tgt.x - P.x, dz = tgt.z - P.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    // the pull: a slow current along the journey, and a gentle weathervane toward it when you rest the paddle
    const inCreek = creekSD(P.x, P.z) > -2, creekS = CQ.s;
    const story = S.nightT0 !== undefined, sinceIsl = story ? S.playT - S.nightT0 : 0;   // v0.8.0: no current, no mist, no nudging until the island
    const pullA = story ? 0.05 * sstep(0, 12, sinceIsl) * (inCreek ? 1.6 : 1) * (1 + 1.4 * NIGHT.dark) : 0;   // v0.7.2: the darkness pushes you on
    P.vx += dx * pullA * dt; P.vz += dz * pullA * dt;
    if (story) P.w += angDiff(Math.atan2(dx, dz), P.psi) * 0.06 * (1 - P.act) * dt;
    // mist crowds in behind
    const prog = clamp(S.sNow / route.L, 0, 1), behind = story ? sstep(2, 25, sinceIsl) * (0.55 + 0.45 * prog) : 0;
    S.away = [-dx, -dz]; S.behind = behind; S.fogMul = 1 + 0.5 * prog;
    const U = post.uniforms; if (U.uBehind) { U.uBehind.value = behind; U.uAway.value.set(-dx, -dz); U.uPlayer.value.set(P.x, 0, P.z); }
    const fogCol = scene.fog.color, base = Math.atan2(-dx, -dz);
    puffs.forEach((p) => {
      const a = base + p.a + Math.sin(T * 0.05 + p.ph) * 0.25, d = p.d + Math.sin(T * 0.11 + p.ph) * 12;
      const want = new THREE.Vector3(P.x + Math.sin(a) * d, p.y + Math.sin(T * 0.2 + p.ph) * 1.5, P.z + Math.cos(a) * d);
      if (!p.cur) p.cur = want.clone(); p.cur.lerp(want, Math.min(1, dt * 0.35));
      p.sp.position.copy(p.cur); p.sp.scale.setScalar(p.s * (1 + 0.08 * Math.sin(T * 0.3 + p.ph)));
      const nd = S.night ? S.night.dark : 0;   // v0.7.0: past Big Island the puffs turn to pooling darkness
      p.sp.material.rotation += p.rs * dt * (1 + nd); p.sp.material.color.copy(fogCol).lerp(WHITE, 0.25 * (1 - nd)).lerp(INK, nd * 0.92);
      p.sp.material.opacity = behind * (0.42 + 0.3 * nd) * (1 - Math.abs(p.a) / 1.6); p.sp.visible = p.sp.material.opacity > 0.003;
    });
    // attention ramps in when a memory starts and back out when it ends
    const want = ATT.fn && S.playT >= ATT.from && S.playT < ATT.until ? 1 : 0; ATT.k = clamp(ATT.k + (want ? dt / 2.2 : -dt / 2.5), 0, 1); if (!want && ATT.k === 0 && S.playT >= (ATT.from || 0)) ATT.fn = null;
    // glance back over the shoulder now and then to watch the mist (not while a memory is playing)
    //   1) once the first memories are behind you, 2) as Big Island comes alongside, 3) at the mouth of the creek
    S.glanceBeats = S.glanceBeats || [420, route.sVia - 40, (route.sCreek || route.L) - 25];
    /* v0.6.4: forced look-backs removed */ if (false && !S.glance && S.glanceBeats.length && S.sNow > S.glanceBeats[0] && !C.dragging() && ATT.k < 0.05) { S.glanceBeats.shift(); S.glance = { t: 0, side: Math.random() < 0.5 ? -1 : 1 }; }
    if (S.glance) { const g = S.glance; g.t += dt; const k = g.t < 2.8 ? ease(g.t / 2.8) : g.t < 6 ? 1 : 1 - ease((g.t - 6) / 2.8); S.glanceYaw = g.side * Math.PI * 0.8 * k; if (g.t > 8.8) { S.glance = null; S.glanceYaw = 0; } }
    MOTES.update(dt); S.updateGhostCamp(T); S.updateObjective(dt, T); updateNight(dt, T, inCreek, creekS);
    // memories
    for (const e of S.events) {
      if (!e.fired && e.test()) { e.fired = true; e.live = e.run(); }
      if (e.live && e.live(dt, T)) e.live = null;
    }
    // the end: deep in the creek fog
    if (story && inCreek && creekS > CREEK.L * 0.86 && !S.ended) end();
  };
  // ---------- v0.6.8 test build: skip-ahead points (pause menu "Skip to", or ?at=<name> on the URL) ----------
  // each point puts the canoe on the route just before a memory, marks earlier memories as played, and starts that one now
  const firstS = (f) => { for (const r of route.R) if (f(r)) return r.s; return route.L; };
  const creekAt = (k) => firstS((r) => { creekSD(r.x, r.z); return creekSD(r.x, r.z) > -2 && CQ.s > CREEK.L * k; });
  S.skips = [
    ['start', 'On the water', 0, null],
    ['cantaloupe', 'Cantaloupe', 0, 'cantaloupe'],
    ['kayaker', 'Kayaker flips', 60, 'kayaker'],
    ['flotilla', 'Flotilla + tow', 175, 'flotilla'],
    ['tandems', 'Tandem kayaks', 335, 'tandems'],
    ['picnic', 'Picnic table tow', route.sVia * 0.6, 'picnic'],
    ['island', 'Island boys / beef', firstS((r) => Math.hypot(r.x - route.BIG.c[0], r.z - route.BIG.c[1]) < bigR + 140), 'island'],
    ['camp', 'Ghost campsite (cards, hammock)', Math.max(0, (S.campS || route.sVia * 0.8) - 70), null],
    ['race', 'Race to the tree', sTree - 145, 'race'],
    ['binoculars', 'Binoculars', sBino - 35, 'binoculars'],
    ['catch', 'The catch', sCatch - 25, 'catch'],
    ['deer', 'Deer in the creek', creekAt(0.25), 'deer'],
    ['creek', 'Creek mouth', (route.sCreek || route.L) - 30, null],
    ['ending', 'Ending', creekAt(0.8), null],
  ];
  S.skips.sort((a, b) => a[2] - b[2]);
  S.skipTo = (name) => {
    const sk = S.skips.find((k) => k[0] === name); if (!sk) return false;
    const [, , sAt, evName] = sk, r = routeAt(route, clamp(sAt, 0, route.L)), ahead = routeAt(route, clamp(sAt + 8, 0, route.L));
    if (G.mode === 'intro' || G.mode === 'title' || G.mode === 'launch') { S.endIntro(); G.mode = 'play'; document.body.classList.add('play'); }
    // wind up whatever memories are still playing (silently), so the jump starts clean
    voices.silent = true;
    S.events.forEach((e) => { for (let i = 0; e.live && i < 400; i++) if (e.live(0.25, S.playT + i * 0.25)) e.live = null; e.live = null; });
    [...S.ghosts].forEach(removeGhost); voices.silent = false; voices.resetDuck(); ATT.fn = null; ATT.k = 0;
    $('blackout').style.transition = 'none'; $('blackout').style.opacity = 0; $('veil').style.opacity = 0; G.fog = 0; G.fogLift = 0;
    const p = sAt <= 0 ? { x: launchInfo.end[0], z: launchInfo.end[1] } : r;
    P.x = p.x; P.z = p.z; P.psi = Math.atan2(ahead.x - r.x, ahead.z - r.z); if (sAt <= 0) P.psi = launchInfo.psi; P.vx = P.vz = P.w = 0;
    let bi = 0, bd = 1e18; route.R.forEach((q, k) => { const d = (q.x - P.x) ** 2 + (q.z - P.z) ** 2; if (d < bd) { bd = d; bi = k; } }); S.idx = bi; S.sNow = route.R[bi].s;
    S.maxProg = clamp(S.sNow / route.L, 0, 1); S.playT = Math.max(S.playT, sAt <= 0 ? 0 : 60); G.manualHour = null; G.snap = true; G.hour = S.hour();
    // memories before this point count as played; the chosen one starts right away
    const order = ['cantaloupe', 'kayaker', 'flotilla', 'tandems', 'picnic', 'island', 'race', 'binoculars', 'catch', 'deer'];
    const upto = evName ? order.indexOf(evName) : sAt <= 0 ? 0 : order.findIndex((n) => (S.skips.find((k) => k[3] === n) || [0, 0, 1e9])[2] > sAt);
    S.events.forEach((e) => { const i = order.indexOf(e.name); if (i >= 0 && (upto < 0 || i < upto)) e.fired = true; else if (!e.live) e.fired = false; });
    if (evName) { const e = S.events.find((x) => x.name === evName); if (e) { e.fired = true; e.live = e.run(); } }
    OBJ.stage = sAt > route.sVia ? 3 : sAt > 0 ? 1 : 0; OBJ.reachedT = S.playT;
    const islandS = (S.skips.find((k) => k[0] === 'island') || [0, 0, route.sVia])[2];
    if (sAt > islandS + 20) { S.nightT0 = S.playT - 40; S.sReach = islandS; G.hour = 21.5; } else { S.nightT0 = undefined; S.sReach = undefined; S.pathT0 = undefined; S.pathPts = null; NIGHT.dark = 0; NIGHT.swell = 0; NIGHT.crest = false; G.hour = S.hour(); }
    return true;
  };
  // ---------- v0.7.0: the night crossing - Big Island to the creek ----------
  // the mist behind you turns to swirling darkness; a soft trail of light on the water leads to the creek; the music
  // turns to a darker minor theme that swells all the way there, peaks as you enter the creek, and opens back into the home key
  const trailTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const trailM = new THREE.MeshBasicMaterial({ map: trailTex, color: 0xffe6c4, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const trail = []; for (let i = 0; i < 44; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), trailM.clone()); m.rotation.x = -Math.PI / 2; m.renderOrder = 3; m.visible = false; scene.add(m); trail.push(m); }
  const NIGHT = { dark: 0, swell: 0, crest: false };
  function updateNight(dt, T, inCreek, creekS) {
    const on = S.nightT0 !== undefined, sC = route.sCreek || route.L;
    const prog = on ? clamp((S.sNow - (S.sReach ?? route.sVia)) / Math.max(1, sC - (S.sReach ?? route.sVia)), 0, 1) : 0;
    const want = on && !NIGHT.crest ? sstep(0, 12, S.playT - S.nightT0) : 0;
    NIGHT.dark += (want - NIGHT.dark) * Math.min(1, dt * (NIGHT.crest ? 0.15 : 0.4));
    NIGHT.swell = Math.max(NIGHT.swell, prog);
    if (post.uniforms.uDark) post.uniforms.uDark.value = NIGHT.dark;
    if (audio.setDark) audio.setDark(NIGHT.crest ? 0 : NIGHT.dark, ease(NIGHT.swell));
    // the peak: entering the creek, toward the light
    if (on && !NIGHT.crest && inCreek && creekS > CREEK.L * 0.08) { NIGHT.crest = true; audio.crescendo && audio.crescendo(); }
    // the trail: soft pools of light on the water ahead, a slow pulse running toward the creek; they fade into the creek's own lit fog
    // v0.8.0: as the fog clears, the way to Big Island glows on the water for ~10 s, then fades
    if (!on) {
      if (S.pathT0 === undefined && S.fogLift() > 0.97) S.pathT0 = S.playT;
      const pt = S.pathT0 === undefined ? -1 : S.playT - S.pathT0, pk = pt < 0 ? 0 : sstep(0, 1.5, pt) * (1 - sstep(7, 10, pt));
      if (pk > 0.001) {
        if (!S.pathPts) { const R = route.R, tgt = S.campS || route.sVia * 0.85; const pts = [new THREE.Vector3(P.x, 0, P.z)]; for (let k = S.idx; k < R.length && R[k].s <= tgt; k += 2) pts.push(new THREE.Vector3(R[k].x, 0, R[k].z));
          const cum = [0]; for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + pts[k].distanceTo(pts[k - 1])); S.pathPts = { pts, cum, L: cum[cum.length - 1] }; }
        const { pts, cum, L } = S.pathPts, step = Math.max(6.5, L / trail.length);
        trail.forEach((m, i) => { const d = 10 + i * step; if (d > L) { m.visible = false; return; } let k = 1; while (k < cum.length - 1 && cum[k] < d) k++; const u = (d - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
          const a2 = pts[k - 1], b2 = pts[k], dx = b2.x - a2.x, dz = b2.z - a2.z, l = Math.hypot(dx, dz) || 1;
          m.visible = true; m.position.set(a2.x + dx * u, 0.07, a2.z + dz * u); m.scale.set(2.6, 7.5, 1); m.rotation.z = Math.atan2(-dx / l, -dz / l);
          const pulse = 0.55 + 0.45 * Math.sin(d * 0.05 - T * 1.6); const front = 10 + pt * 90; m.material.opacity = 1.0 * pk * pulse * (1 - sstep(front - 14, front, d)); m.scale.set(3.4, 9, 1); });   // it runs out ahead of you toward the island
        return;
      } else if (S.pathPts) { S.pathPts = null; trail.forEach((m) => { m.visible = false; }); }
    }
    const tk = NIGHT.dark * (1 - sstep(sC - 20, sC + 40, S.sNow));
    trail.forEach((m, i) => {
      const sv = S.sNow + 12 + i * 6.5; if (tk < 0.01 || sv > sC + 30) { m.visible = false; return; }
      const r = routeAt(route, sv), w = Math.sin(sv * 0.7) * 1.2; m.visible = true;
      m.position.set(r.x - r.dz * w, 0.07, r.z + r.dx * w); m.scale.set(2.6 + Math.sin(i * 1.7) * 0.6, 7.5, 1); m.rotation.z = Math.atan2(-r.dx, -r.dz);
      const pulse = 0.55 + 0.45 * Math.sin(sv * 0.05 - T * 1.3), near = sstep(10, 30, sv - S.sNow) * (1 - sstep(200, 290, sv - S.sNow));
      m.material.opacity = 0.42 * tk * pulse * near;
    });
  }
  S.night = NIGHT;

  /** v0.7.1: the morning fog lifts after about a minute on the water */
  S.fogLift = () => (G.mode === 'play' || G.mode === 'ending' ? sstep(16, 30, S.playT) : 0);   // v0.8.0: fully gone 30 s after launch
  S.autoTarget = () => S.target ? [S.target.x, S.target.z] : null;
  //   grey dawn at the tent -> morning -> midday on the open water -> golden hour at Big Island -> dusk in the creek
  const HOURS = [[0, 6.35], [0.12, 7.6], [0.3, 10.5], [0.45, 13.5], [0.62, 16.6], [0.76, 17.9], [0.86, 18.7], [0.95, 19.4], [1, 19.9]];
  const dayHour = () => {
    if (S.nightT0 === undefined) return lerp(6.35, 9.8, sstep(0, 45, S.playT));   // v0.8.0: freeplay - the morning brightens as the fog burns off
    S.maxProg = Math.max(S.maxProg || 0, clamp(S.sNow / route.L, 0, 1)); const p = S.maxProg;
    for (let i = 0; i < HOURS.length - 1; i++) { const [a, ha] = HOURS[i], [b, hb] = HOURS[i + 1]; if (p <= b) return lerp(ha, hb, (p - a) / (b - a)); }
    return HOURS[HOURS.length - 1][1];
  };
  // v0.7.0: once you reach Big Island the day drains away into night over ~25 s, and stays night to the creek
  S.hour = () => { const h = dayHour(); if (S.nightT0 === undefined) return h; return lerp(h, 21.5, ease(clamp((S.playT - S.nightT0) / 25, 0, 1))); };   // blue-black night: dark, but the sky still glows enough to see the darkness come

  function end() {
    S.ended = true; G.mode = 'ending'; audio.chime();
    const veil = $('veil'); veil.style.transition = 'opacity 5s ease, background-color 5s ease'; veil.style.background = '#d9dbd8'; veil.style.opacity = 1;
    const q = $('quote'); q.classList.add('on');
    [...q.querySelectorAll('span')].forEach((el, i) => setTimeout(() => el.classList.add('on'), 5200 + i * 2300));
    const hold = 5200 + q.querySelectorAll('span').length * 2300 + 7000;
    setTimeout(() => { q.classList.add('out'); const b = $('blackout'); b.style.transition = 'opacity 6s ease'; b.style.opacity = 1; setTimeout(() => audio.master && audio.master.gain.setTargetAtTime(0, audio.ctx.currentTime, 2.5), 2500); }, hold);
    setTimeout(() => { $('endcard').classList.add('on'); }, hold + 7000);
  }
  return S;
}
