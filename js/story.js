import * as THREE from 'three';
import { MAP } from './mapdata.js';
import { clamp, lerp, sstep, pondSD, NQ, heightAt, CREEK, CQ, creekSD, ISLE, glowTexture } from './world.js';
import { Voices } from './voices.js';
import { recolor } from './models.js';

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
  const src = M[kind]; if (src) { const p = recolor(src.clone(true), m); return p; }
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
    if (M.paddleDouble) { const pd = recolor(M.paddleDouble.clone(true), body); pd.rotation.z = Math.PI / 2; pd.position.x = -1.1; pad.add(pd); }
    else { const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 2.2, 5), body); shaft.rotation.z = Math.PI / 2; pad.add(shaft);
      [-1, 1].forEach((s) => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.02), body); b.position.x = s * 1.1; b.rotation.x = s * 0.6; pad.add(b); }); }
    g.userData.paddles.push({ pad, ph: i * 0.7 });
  });
  g.userData.roll = roll; return g;
}
function ghostCanoe(n = 2) {
  const g = G0(), hull = gm(g, GHOST, 0.75), body = gm(g, GHOST, 0.9);
  const roll = new THREE.Group(); g.add(roll);
  if (M.canoe) { const h = recolor(M.canoe.clone(true), hull); h.position.y = 0.34; roll.add(h); }
  else { const h = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 4.0, 4, 10), hull); h.rotation.x = Math.PI / 2; h.scale.set(1, 1, 0.5); h.position.y = 0.12; roll.add(h); }
  g.userData.paddles = [];
  [1.6, -1.75].slice(0, n).forEach((z, i) => {
    const pp = person(g, body, 'paddler'); pp.position.set(0, 0.08, z - 0.2); roll.add(pp);
    const pad = new THREE.Group(); pad.position.set(i ? -0.42 : 0.42, 0.75, z + 0.2); roll.add(pad);
    if (M.paddleSingle) { const pd = recolor(M.paddleSingle.clone(true), body); pd.rotation.z = Math.PI; pd.position.y = 0.35; pad.add(pd); } // model is built along +Y with the blade at the origin: flip so the blade hangs down
    else { const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.4, 5), body); shaft.position.y = -0.4; pad.add(shaft);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.02), body); b.position.y = -1.15; pad.add(b); }
    g.userData.paddles.push({ pad, ph: i * 0.5, single: true, side: i ? -1 : 1 });
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
function animatePaddles(g, t, rate = 1) {
  (g.userData.paddles || []).forEach((p) => {
    const ph = t * 2.4 * rate + p.ph;
    if (p.single) { p.pad.rotation.set(-0.05 - 0.6 * Math.cos(ph), 0, p.side * (0.3 + 0.4 * Math.max(0, -Math.sin(ph)))); }
    else { p.pad.rotation.z = Math.sin(ph) * 0.55; p.pad.rotation.y = Math.cos(ph) * 0.35; }
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
  const route = buildRoute(launchInfo.end);
  MOTES = createMotes(scene); S.motes = MOTES;
  S.route = route;

  // ---------------- the tent, on the bank behind the canoe
  const n = launchInfo.n, side = [n[1], -n[0]];
  let tx = launchInfo.start[0] - n[0] * 13 + side[0] * 4.5, tz = launchInfo.start[1] - n[1] * 13 + side[1] * 4.5;
  const ty = heightAt(tx, tz);
  const tent = new THREE.Group(); tent.position.set(tx, ty, tz); tent.rotation.y = Math.atan2(launchInfo.start[0] - tx, launchInfo.start[1] - tz); scene.add(tent);
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
  const tentFront = new THREE.Vector3(0, 0, 1.6).applyMatrix4(tent.matrixWorld);

  // clear a little campsite: no trees, reeds or litter around the tent or on the walk down to the canoe
  {
    const a = new THREE.Vector2(tx, tz), b = new THREE.Vector2(launchInfo.start[0], launchInfo.start[1]), m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const segD = (x, z) => { const ab = b.clone().sub(a), t = clamp(((x - a.x) * ab.x + (z - a.y) * ab.y) / ab.lengthSq(), 0, 1); return Math.hypot(x - (a.x + ab.x * t), z - (a.y + ab.y * t)); };
    scene.traverse((o) => {
      if (!o.isInstancedMesh || o.count > 200000 || o.userData.tag !== 'tree') return; let touched = false;
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m4); pos.setFromMatrixPosition(m4); if (Math.hypot(pos.x - tx, pos.z - tz) < 7 || segD(pos.x, pos.z) < 3) { m4.decompose(pos, q, sc); m4.compose(pos, q, sc.set(0, 0, 0)); o.setMatrixAt(i, m4); touched = true; } }
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
    I.t = 0; I.done = false; S.ended = false; canoe.person.visible = false; canoe.paddle.visible = false;
    $('blackout').style.transition = 'none'; $('blackout').style.opacity = 1;
    voices.unzip();
    setTimeout(() => { $('blackout').style.transition = 'opacity 2.6s ease'; $('blackout').style.opacity = 0; }, 1700);
  };
  // timeline (s): 0-1.7 black + unzip | 1.7-4.2 crawl out & stand | 4.2-6.6 turn back to the tent | 6.6-8.4 hold | 8.4-10.6 turn to the water | walk | sit | hand off
  const toCanoe = () => { const s = seat(); return Math.atan2(s.x - tentFront.x, s.z - tentFront.z); };
  S.introCamera = (dt) => {
    I.t += dt; const t = I.t, s = seat(), face = toCanoe();
    const out = tentFront.clone().add(new THREE.Vector3(Math.sin(face) * 2.4, 0, Math.cos(face) * 2.4));
    const walkLen = Math.hypot(s.x - out.x, s.z - out.z), walkT = walkLen / 1.15, tWalk0 = 10.6, tWalk1 = tWalk0 + walkT, tSit1 = tWalk1 + 2.2;
    let pos = new THREE.Vector3(), yaw = face, pitch = -0.08, eye = 1.62, bob = 0;
    if (t < 4.2) { const k = ease(clamp((t - 1.7) / 2.5, 0, 1)); pos.lerpVectors(tentFront.clone().add(new THREE.Vector3(-Math.sin(face) * 0.6, 0, -Math.cos(face) * 0.6)), out, k); eye = lerp(0.55, 1.62, ease(clamp((t - 2.6) / 1.6, 0, 1))); pitch = lerp(-0.25, -0.06, k); }
    else if (t < tWalk0) { pos.copy(out); const back = face + Math.PI * 0.94;
      yaw = t < 6.6 ? lerp(face, back, ease((t - 4.2) / 2.4)) : t < 8.4 ? back : lerp(back, face + Math.PI * 2, ease((t - 8.4) / 2.2)); pitch = t < 8.4 ? -0.16 : -0.07; }
    else if (t < tWalk1) { const k = (t - tWalk0) / walkT; pos.lerpVectors(out, s, k); bob = Math.abs(Math.sin(k * walkLen * 1.6)) * 0.05; pitch = -0.1 - 0.12 * k;
      const stepN = Math.floor(k * walkLen / 0.72); if (stepN > I.steps) { I.steps = stepN; voices.step(stepN % 2 ? 0.25 : -0.25, 0.9); } }
    else if (t < tSit1) { const k = ease((t - tWalk1) / 2.2); pos.copy(s); eye = lerp(1.62, 1.05, k); yaw = lerp(face, launchInfo.psi, k); pitch = lerp(-0.22, -0.05, k); if (!I.sat && k > 0.5) { I.sat = true; audio.knock(0.22); audio.hullSlap && audio.hullSlap(0.6); } }
    else { pos.copy(s); eye = 1.05; yaw = launchInfo.psi; I.done = true; }
    const gy = Math.max(heightAt(pos.x, pos.z), 0.1);
    camera.position.set(pos.x, gy + eye + bob, pos.z);
    camera.lookAt(pos.x + Math.sin(yaw) * Math.cos(pitch) * 10, gy + eye + bob + Math.sin(pitch) * 10, pos.z + Math.cos(yaw) * Math.cos(pitch) * 10);
    return I.done;
  };
  S.endIntro = () => { canoe.person.visible = true; canoe.paddle.visible = true; };

  // ---------------- events
  const tmp = new THREE.Vector3(), WHITE = new THREE.Color(1, 1, 1);
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
    voices.shout({ x: from.x, y: 1.6, z: from.z }, 'hey', { vol: 0.9, delay: 0.1 });       // "heads up!" from the bank
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
        if (lurch === 2) voices.shout(gpos(g), 'oh', { vol: 0.8, f0: 210 }); if (lurch === 4) voices.shout(gpos(g), 'no', { vol: 1, f0: 240 }); }
      if (t > 7.45 && !flipped) { flipped = true; voices.bigSplash(gpos(g, 0), 1.3); ripples.spawn(g.position.x, g.position.z, 5, 3, 0.7, 0.6); ripples.spawn(g.position.x, g.position.z, 2.5, 2, 0.6, 0.3);
        setTimeout(() => voices.erupt({ x: P.x - R[0] * 25 + F[0] * 6, y: 1, z: P.z - R[1] * 25 + F[1] * 6 }, 3, 0.8), 800); }
      if (t < 7.2) { animatePaddles(g, T, 0.6); strokeSounds(g, T, 0.6, 0.7); }
      if (t > 9 && !outC) { outC = true; voices.memoryOut(gpos(g, 0.5)); }
      fadeGhost(g, sstep(0, 2.2, t) * (1 - sstep(9, 12.5, t)) * 0.55, T);
      if (t > 12.6) { removeGhost(g); return true; }
    };
  });

  // 3. two tandem kayaks race past, young men shouting and laughing
  ev('tandems', () => S.sNow > 260 && S.playT > 40, () => {
    const F = playerFwd(), L = playerLeft();
    const boats = [6, 10].map((off, i) => { const g = addGhost(kayak(true)); g.userData.start = [P.x + F[0] * 55 + L[0] * off, P.z + F[1] * 55 + L[1] * off]; g.userData.v = 2.9 + i * 0.25; return g; });
    const dir = [-F[0], -F[1]]; let t = 0, outC = false;
    const mid = () => ({ x: (boats[0].position.x + boats[1].position.x) / 2, y: 1, z: (boats[0].position.z + boats[1].position.z) / 2 });
    voices.memoryIn({ x: boats[0].userData.start[0], y: 1, z: boats[0].userData.start[1] });
    attend(mid, 30);
    // a back-and-forth: one boat calls, the other answers, both crack up; it swells as they pass and trails off
    const call = (i, delay, word) => setTimeout(() => { const b = boats[i]; if (b.visible) voices.shout(gpos(b), word, { vol: 1.15 }); }, delay * 1000);
    const lol = (i, delay, v = 1) => setTimeout(() => { const b = boats[i]; if (b.visible) voices.laugh(gpos(b), { vol: v, n: Math.floor(rand(7, 12)) }); }, delay * 1000);
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
          setTimeout(() => voices.erupt({ x: p[0], y: 1, z: p[1] }, 5, 1.3), 450); setTimeout(() => voices.erupt(pack(), 4, 1.1), 1400); }
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
    const pullA = 0.05 * sstep(4, 20, S.playT) * (inCreek ? 1.6 : 1);
    P.vx += dx * pullA * dt; P.vz += dz * pullA * dt;
    P.w += angDiff(Math.atan2(dx, dz), P.psi) * 0.06 * (1 - P.act) * dt;
    // mist crowds in behind
    const prog = clamp(S.sNow / route.L, 0, 1), behind = sstep(6, 70, S.playT) * (0.55 + 0.45 * prog);
    S.away = [-dx, -dz]; S.behind = behind; S.fogMul = 1 + 0.5 * prog;
    const U = post.uniforms; if (U.uBehind) { U.uBehind.value = behind; U.uAway.value.set(-dx, -dz); U.uPlayer.value.set(P.x, 0, P.z); }
    const fogCol = scene.fog.color, base = Math.atan2(-dx, -dz);
    puffs.forEach((p) => {
      const a = base + p.a + Math.sin(T * 0.05 + p.ph) * 0.25, d = p.d + Math.sin(T * 0.11 + p.ph) * 12;
      const want = new THREE.Vector3(P.x + Math.sin(a) * d, p.y + Math.sin(T * 0.2 + p.ph) * 1.5, P.z + Math.cos(a) * d);
      if (!p.cur) p.cur = want.clone(); p.cur.lerp(want, Math.min(1, dt * 0.35));
      p.sp.position.copy(p.cur); p.sp.scale.setScalar(p.s * (1 + 0.08 * Math.sin(T * 0.3 + p.ph)));
      p.sp.material.rotation += p.rs * dt; p.sp.material.color.copy(fogCol).lerp(WHITE, 0.25);
      p.sp.material.opacity = behind * 0.42 * (1 - Math.abs(p.a) / 1.6); p.sp.visible = p.sp.material.opacity > 0.003;
    });
    // attention ramps in when a memory starts and back out when it ends
    const want = ATT.fn && S.playT >= ATT.from && S.playT < ATT.until ? 1 : 0; ATT.k = clamp(ATT.k + (want ? dt / 2.2 : -dt / 2.5), 0, 1); if (!want && ATT.k === 0 && S.playT >= (ATT.from || 0)) ATT.fn = null;
    // glance back over the shoulder now and then to watch the mist (not while a memory is playing)
    //   1) once the first memories are behind you, 2) as Big Island comes alongside, 3) at the mouth of the creek
    S.glanceBeats = S.glanceBeats || [420, route.sVia - 40, (route.sCreek || route.L) - 25];
    if (!S.glance && S.glanceBeats.length && S.sNow > S.glanceBeats[0] && !C.dragging() && ATT.k < 0.05) { S.glanceBeats.shift(); S.glance = { t: 0, side: Math.random() < 0.5 ? -1 : 1 }; }
    if (S.glance) { const g = S.glance; g.t += dt; const k = g.t < 2.8 ? ease(g.t / 2.8) : g.t < 6 ? 1 : 1 - ease((g.t - 6) / 2.8); S.glanceYaw = g.side * Math.PI * 0.8 * k; if (g.t > 8.8) { S.glance = null; S.glanceYaw = 0; } }
    MOTES.update(dt);
    // memories
    for (const e of S.events) {
      if (!e.fired && e.test()) { e.fired = true; e.live = e.run(); }
      if (e.live && e.live(dt, T)) e.live = null;
    }
    // the end: deep in the creek fog
    if (inCreek && creekS > CREEK.L * 0.86 && !S.ended) end();
  };
  S.autoTarget = () => S.target ? [S.target.x, S.target.z] : null;
  //   grey dawn at the tent -> morning -> midday on the open water -> golden hour at Big Island -> dusk in the creek
  const HOURS = [[0, 6.35], [0.12, 7.6], [0.3, 10.5], [0.45, 13.5], [0.62, 16.6], [0.76, 17.9], [0.86, 18.7], [0.95, 19.4], [1, 19.9]];
  S.hour = () => {
    S.maxProg = Math.max(S.maxProg || 0, clamp(S.sNow / route.L, 0, 1)); const p = S.maxProg;
    for (let i = 0; i < HOURS.length - 1; i++) { const [a, ha] = HOURS[i], [b, hb] = HOURS[i + 1]; if (p <= b) return lerp(ha, hb, (p - a) / (b - a)); }
    return HOURS[HOURS.length - 1][1];
  };

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
