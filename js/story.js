import * as THREE from 'three';
import { MAP } from './mapdata.js?v=0.13.0';
import { clamp, lerp, sstep, pondSD, NQ, heightAt, CREEK, CQ, creekSD, ISLE, glowTexture, CAMP, onDock } from './world.js?v=0.13.0';
import { Voices } from './voices.js?v=0.13.0';
import { COLLAPSE, colWob } from './collapse.js?v=0.13.0';

// v0.6.1: Blender-built models, loaded by main.js before the story is created (null entries fall back to primitives)
let M = {};
export function setModels(m) { M = m || {}; }

// =====================================================================================================
// The journey: start in the canoe at the dock and paddle - the mist closes in behind you, pulling you toward
// Big Island and on down the creek, where it ends. (v0.13.0: the ghost memories are gone.)
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

export function createStory(C) {
  const { scene, camera, P, G, audio, ripples, canoe, launchInfo, post } = C;
  const voices = new Voices(audio);
  const $ = (id) => document.getElementById(id);
  const S = { active: true, glanceYaw: 0, fogMul: 1, events: [], ended: false, playT: 0, sNow: 0, idx: 0 };
  S.voices = voices;
  const route = buildRoute(launchInfo.end);
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

  // ---------------- v0.13.0: no tent scene - the game opens in the canoe at the dock (the tent stays up on the bank)
  S.begin = () => { S.ended = false; canoe.person.visible = true; canoe.paddle.visible = true; };
  S.endIntro = S.begin;

  // ---------------- events
  const tmp = new THREE.Vector3(), WHITE = new THREE.Color(1, 1, 1), INK = new THREE.Color(0.01, 0.012, 0.02);
  const playerFwd = () => [Math.sin(P.psi), Math.cos(P.psi)], playerLeft = () => [Math.cos(P.psi), -Math.sin(P.psi)];
  function ev(name, test, run) { S.events.push({ name, test, run, fired: false, live: null }); }
  const near = (x, z, r) => Math.hypot(P.x - x, P.z - z) < r;

  // ---------- attention: draw the camera to whatever is happening (the deer) ----------
  const ATT = { fn: null, until: 0, k: 0, t: 0 };
  /** turn the player's view toward posFn() for `sec` seconds (eases in and out; manual dragging always wins) */
  function attend(posFn, sec, delay = 1.3) { ATT.fn = posFn; ATT.from = S.playT + delay; ATT.until = S.playT + delay + sec; }
  S.focus = () => (ATT.fn && ATT.k > 0.01 ? Object.assign({ k: ATT.k }, ATT.fn()) : null);
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

  const bigR = Math.max(...route.BIG.r.map((p) => Math.hypot(p[0] - route.BIG.c[0], p[1] - route.BIG.c[1])));

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

  // ---------- v0.10.0: the collapse ----------
  // a third of the way to Big Island the ground lurches: the world behind you breaks away into the dark, the pond pours
  // over the edge, and the edge keeps coming - slowly, but it never stops until it has driven you to the island
  const COL = C.collapse ? { on: false, t: 0, k: 0, after: 0 } : null;
  const colO = [launchInfo.end[0], launchInfo.end[1]];
  const colA = (() => { const dx = route.BIG.c[0] - colO[0], dz = route.BIG.c[1] - colO[1], l = Math.hypot(dx, dz); return [dx / l, dz / l]; })();
  const sAx = (x, z) => (x - colO[0]) * colA[0] + (z - colO[1]) * colA[1];
  const sIsl = sAx(route.BIG.c[0], route.BIG.c[1]);
  const COL_TRIG = (sIsl - bigR) / 3, COL_CAP = sIsl - bigR - 55;
  S.col = COL; S.colTrig = COL_TRIG; S.colCap = COL_CAP; S.sAx = sAx;
  function colStart(sP) { C.collapse.start(colO[0], colO[1], colA[0], colA[1], sP - 230); COL.on = true; COL.t = 0; COL.k = 0; COL.f0 = sP - 230; COL.sP0 = sP; }
  function colReset() { if (!COL) return; COL.on = false; COL.t = 0; COL.k = 0; COL.after = 0; C.collapse.reset(); S.colMusic = 0; S.colSwell = 0; COLLAPSE.uniforms.uQuake.value = 0; if (audio.quake) audio.quake(0, 0, 0); }
  S.colReset = colReset;
  S.updateCollapse = (dt) => {
    if (!COL) return;
    const sP = sAx(P.x, P.z), cs = C.collapse.S, wl = colWob(-(P.x - colO[0]) * colA[1] + (P.z - colO[1]) * colA[0]);   // the ragged edge where you are
    if (!COL.on) {
      if (OBJ.stage === 1 && S.nightT0 === undefined && S.playT > 35 && sP > COL_TRIG) { colStart(sP); say('paddle to the island'); S.glance = { t: -1.2, hold: 10, lift: 1, side: Math.random() < 0.5 ? -1 : 1 }; }   // the camera whips round to watch the world go
      else return;
    }
    COL.t += dt;
    // the front: one great slump right behind you, then a slow, relentless creep (faster if you pull far ahead, so it stays in sight)
    let f;
    if (COL.t < 6) f = lerp(COL.f0, COL.sP0 - 70, 1 - Math.pow(1 - COL.t / 6, 2.2));   // most of it goes in the first seconds
    else { const gap = sP - cs.front - wl; f = cs.front + (0.8 + clamp((gap - 130) * 0.05, 0, 3.5)) * dt; }
    f = Math.min(f, COL_CAP, sP - 3 - wl); C.collapse.setFront(Math.max(f, cs.front));
    const capped = cs.front >= COL_CAP - 0.5;
    // the shaking: a violent first quake, a long rumble while the edge is moving, aftershocks now and then
    const big = COL.t < 1.5 ? ease(COL.t / 1.5) : COL.t < 7 ? 1 : 0.22 + 0.78 * Math.exp(-(COL.t - 7) / 3);
    if (!capped && COL.t > 15 && Math.random() < dt / 22) COL.after = 0.55 + Math.random() * 0.35;
    COL.after = Math.max(0, COL.after - dt * 0.22);
    COL.k = capped ? Math.max(0, COL.k - dt / 10) : Math.max(big, COL.after);
    COLLAPSE.uniforms.uQuake.value = COL.k;
    // the edge drives you on: a constant nudge, a hard shove when it is right on you, and it never lets you fall back over
    const gap = sP - cs.front - wl, push = 0.04 + 0.6 * sstep(45, 6, gap);
    P.vx += colA[0] * push * dt; P.vz += colA[1] * push * dt;
    if (gap < 4) { const vA = P.vx * colA[0] + P.vz * colA[1]; if (vA < 1.2) { P.vx += colA[0] * (1.2 - vA); P.vz += colA[1] * (1.2 - vA); } P.x += colA[0] * (4 - gap); P.z += colA[1] * (4 - gap); }
    if (audio.quake) audio.quake(COL.k, sstep(260, 25, gap), dt);
    // the minor theme rises with it (the night crossing takes it from there)
    S.colMusic = sstep(0, 5, COL.t) * 0.9; S.colSwell = 0.55 * clamp((cs.front - COL.f0) / Math.max(1, COL_CAP - COL.f0), 0, 1);
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
    // attention ramps in when something happens and back out when it ends
    const want = ATT.fn && S.playT >= ATT.from && S.playT < ATT.until ? 1 : 0; ATT.k = clamp(ATT.k + (want ? dt / 2.2 : -dt / 2.5), 0, 1); if (!want && ATT.k === 0 && S.playT >= (ATT.from || 0)) ATT.fn = null;
    // glance back over the shoulder now and then to watch the mist (not while something is happening)
    //   1) a little way out from the dock, 2) as Big Island comes alongside, 3) at the mouth of the creek
    S.glanceBeats = S.glanceBeats || [420, route.sVia - 40, (route.sCreek || route.L) - 25];
    /* v0.6.4: forced look-backs removed */ if (false && !S.glance && S.glanceBeats.length && S.sNow > S.glanceBeats[0] && !C.dragging() && ATT.k < 0.05) { S.glanceBeats.shift(); S.glance = { t: 0, side: Math.random() < 0.5 ? -1 : 1 }; }
    if (S.glance) { const g = S.glance, H = g.hold || 6; g.t += dt; const k = g.t < 0 ? 0 : g.t < 2.8 ? ease(g.t / 2.8) : g.t < H ? 1 : 1 - ease(Math.min(1, (g.t - H) / 2.8)); S.glanceYaw = g.side * Math.PI * 0.8 * k; S.glanceLift = g.lift ? g.lift * k : 0; if (g.t > H + 2.8) { S.glance = null; S.glanceYaw = 0; S.glanceLift = 0; } }
    S.updateObjective(dt, T); S.updateCollapse(dt); updateNight(dt, T, inCreek, creekS);
    // events (just the deer)
    for (const e of S.events) {
      if (!e.fired && e.test()) { e.fired = true; e.live = e.run(); }
      if (e.live && e.live(dt, T)) e.live = null;
    }
    // the end: deep in the creek fog
    if (story && inCreek && creekS > CREEK.L * 0.86 && !S.ended) end();
  };
  // ---------- v0.6.8 test build: skip-ahead points (pause menu "Skip to", or ?at=<name> on the URL) ----------
  // each point puts the canoe on the route at that spot (the deer point starts the deer)
  const firstS = (f) => { for (const r of route.R) if (f(r)) return r.s; return route.L; };
  const creekAt = (k) => firstS((r) => { creekSD(r.x, r.z); return creekSD(r.x, r.z) > -2 && CQ.s > CREEK.L * k; });
  S.skips = [
    ['start', 'On the water', 0, null],
    ['island', 'Big Island', firstS((r) => Math.hypot(r.x - route.BIG.c[0], r.z - route.BIG.c[1]) < bigR + 140), null],
    ['deer', 'Deer in the creek', creekAt(0.25), 'deer'],
    ['creek', 'Creek mouth', (route.sCreek || route.L) - 30, null],
    ['ending', 'Ending', creekAt(0.8), null],
  ];
  S.skips.sort((a, b) => a[2] - b[2]);
  S.skipTo = (name) => {
    const sk = S.skips.find((k) => k[0] === name); if (!sk) return false;
    const [, , sAt, evName] = sk, r = routeAt(route, clamp(sAt, 0, route.L)), ahead = routeAt(route, clamp(sAt + 8, 0, route.L));
    if (G.mode === 'intro' || G.mode === 'title' || G.mode === 'launch') { S.endIntro(); G.mode = 'play'; document.body.classList.add('play'); }
    // wind up whatever event is still playing (silently), so the jump starts clean
    voices.silent = true;
    S.events.forEach((e) => { for (let i = 0; e.live && i < 400; i++) if (e.live(0.25, S.playT + i * 0.25)) e.live = null; e.live = null; });
    voices.silent = false; voices.resetDuck(); ATT.fn = null; ATT.k = 0;
    $('blackout').style.transition = 'none'; $('blackout').style.opacity = 0; $('veil').style.opacity = 0; G.fog = 0; G.fogLift = 0;
    const p = sAt <= 0 ? { x: launchInfo.end[0], z: launchInfo.end[1] } : r;
    P.x = p.x; P.z = p.z; P.psi = Math.atan2(ahead.x - r.x, ahead.z - r.z); if (sAt <= 0) P.psi = launchInfo.psi; P.vx = P.vz = P.w = 0;
    let bi = 0, bd = 1e18; route.R.forEach((q, k) => { const d = (q.x - P.x) ** 2 + (q.z - P.z) ** 2; if (d < bd) { bd = d; bi = k; } }); S.idx = bi; S.sNow = route.R[bi].s;
    S.maxProg = clamp(S.sNow / route.L, 0, 1); S.playT = Math.max(S.playT, sAt <= 0 ? 0 : 60); G.manualHour = null; G.snap = true; G.hour = S.hour();
    // events before this point count as played; the chosen one starts right away
    const order = ['deer'];
    const upto = evName ? order.indexOf(evName) : sAt <= 0 ? 0 : order.findIndex((n) => (S.skips.find((k) => k[3] === n) || [0, 0, 1e9])[2] > sAt);
    S.events.forEach((e) => { const i = order.indexOf(e.name); if (i >= 0 && (upto < 0 || i < upto)) e.fired = true; else if (!e.live) e.fired = false; });
    if (evName) { const e = S.events.find((x) => x.name === evName); if (e) { e.fired = true; e.live = e.run(); } }
    OBJ.stage = sAt > route.sVia ? 3 : sAt > 0 ? 1 : 0; OBJ.reachedT = S.playT;
    const islandS = (S.skips.find((k) => k[0] === 'island') || [0, 0, route.sVia])[2];
    // v0.10.0: before the quake the world is whole; well past it, the edge has already eaten everything behind
    if (COL) { const sP = sAx(P.x, P.z); if (sP > COL_TRIG + 25) { if (!COL.on) colStart(sP); COL.t = 40; C.collapse.setFront(Math.min(COL_CAP, sP - 90)); } else colReset(); }
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
    if (audio.setDark) audio.setDark(NIGHT.crest ? 0 : Math.max(NIGHT.dark, S.colMusic || 0), ease(Math.max(NIGHT.swell, S.colSwell || 0)));
    // the peak: entering the creek, toward the light
    if (on && !NIGHT.crest && inCreek && creekS > CREEK.L * 0.08) { NIGHT.crest = true; audio.crescendo && audio.crescendo(); }
    // the trail: soft pools of light on the water ahead, a slow pulse running toward the creek; they fade into the creek's own lit fog
    // v0.8.0: as the fog clears, the way to Big Island glows on the water for ~10 s, then fades
    if (!on) {
      if (S.pathT0 === undefined && S.fogLift() > 0.97) S.pathT0 = S.playT;
      const pt = S.pathT0 === undefined ? -1 : S.playT - S.pathT0, pk = pt < 0 ? 0 : sstep(0, 1.5, pt) * (1 - sstep(7, 10, pt));
      if (pk > 0.001) {
        if (!S.pathPts) { const R = route.R, tgt = route.sVia * 0.85; const pts = [new THREE.Vector3(P.x, 0, P.z)]; for (let k = S.idx; k < R.length && R[k].s <= tgt; k += 2) pts.push(new THREE.Vector3(R[k].x, 0, R[k].z));
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
    const veil = $('veil'); veil.style.transition = 'opacity 5s ease, background-color 5s ease'; veil.style.background = '#d9dbd8';
    veil.style.opacity = 1;
    const q = $('quote'); q.classList.add('on');
    [...q.querySelectorAll('span')].forEach((el, i) => setTimeout(() => el.classList.add('on'), 5200 + i * 2300));
    const hold = 5200 + q.querySelectorAll('span').length * 2300 + 7000;
    setTimeout(() => { q.classList.add('out'); const b = $('blackout'); b.style.transition = 'opacity 6s ease'; b.style.opacity = 1; setTimeout(() => audio.master && audio.master.gain.setTargetAtTime(0, audio.ctx.currentTime, 2.5), 2500); }, hold);
    setTimeout(() => { $('endcard').classList.add('on'); }, hold + 7000);
  }
  return S;
}
