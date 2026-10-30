import * as THREE from 'three';
import { clamp, lerp, sstep, rnd, fbm, pondSD, heightAt, CAMP, campPath, LEAF_COLS, leafGeometry, glowTexture } from './world.js?v=0.8.1';

// v0.6.2: the campsite at the start of the game - leaf litter and needle duff with a worn path, pine cones, twigs,
// a fire ring with cold ash and a half-burnt log, split firewood, a camp chair, ferns and blueberry along the tree line,
// roots breaking the surface, and dew that sparkles toward the low sun for the first minutes.
const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1, ...extra });
const V = (x, y, z) => new THREE.Vector3(x, y, z), E = (x, y, z) => new THREE.Euler(x, y, z);
function instanced(scene, geo, mat, items) {
  if (!items.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, items.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  items.forEach((it, i) => { q.setFromEuler(it.rot); m.compose(it.pos, q, it.scl); im.setMatrixAt(i, m); if (it.col) im.setColorAt(i, c.setRGB(...it.col)); });
  im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); scene.add(im); return im;
}
function merge(geos) {
  const P = [], N = [];
  for (const g0 of geos) { const g = g0.index ? g0.toNonIndexed() : g0; g.computeVertexNormals(); const p = g.attributes.position, n = g.attributes.normal; for (let i = 0; i < p.count; i++) { P.push(p.getX(i), p.getY(i), p.getZ(i)); N.push(n.getX(i), n.getY(i), n.getZ(i)); } }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); return out;
}
const onGround = (x, z, dy = 0) => Math.max(heightAt(x, z), 0.05) + dy;

export const S_GEAR = {};
export function buildCamp(scene, treePositions = [], post = null) {
  const T = CAMP.tent, R = CAMP.R, n = CAMP.n, side = CAMP.side;
  const near = (x, z) => Math.hypot(x - T[0], z - T[1]);
  const inCamp = (x, z) => near(x, z) < R && pondSD(x, z) < -1.2;
  const rnd2 = (a, b) => a + rnd() * (b - a);

  // ---- leaf litter: dense near the maples/tree line, kicked off the path and the tent pad ----
  const leaves = [], needles = [], cones = [], twigs = [];
  const leafGeo = leafGeometry(0.3);
  const needleGeo = new THREE.BoxGeometry(0.018, 0.004, 0.22);
  const coneGeo = (() => { const c = new THREE.ConeGeometry(0.05, 0.12, 6); c.rotateX(Math.PI / 2); const b = new THREE.SphereGeometry(0.045, 6, 4); b.translate(0, 0, 0.03); return merge([c, b]); })();
  const twigGeo = (() => { const a = new THREE.CylinderGeometry(0.008, 0.012, 0.5, 4); a.rotateZ(Math.PI / 2); const b = new THREE.CylinderGeometry(0.005, 0.008, 0.22, 4); b.rotateZ(Math.PI / 2 - 0.9); b.translate(0.12, 0.05, 0); return merge([a, b]); })();
  for (let i = 0; i < 3400; i++) {
    const a = rnd() * 6.283, r = Math.sqrt(rnd()) * R, x = T[0] + Math.cos(a) * r, z = T[1] + Math.sin(a) * r;
    if (!inCamp(x, z)) continue;
    const path = campPath(x, z), pad = 1 - sstep(3.0, 4.8, near(x, z));
    if (rnd() < Math.max(path, pad) * 0.92) continue;                        // worn bare where people walk and sleep
    const woods = sstep(0.4, 0.7, fbm(x * 0.25 + 4, z * 0.25)) * 0.6 + 0.4;  // clumps under the trees
    if (rnd() > woods) continue;
    const y = onGround(x, z, 0.012 + rnd() * 0.02), rot = E((rnd() - 0.5) * 0.5, rnd() * 6.283, (rnd() - 0.5) * 0.5);
    const kind = rnd();
    if (kind < 0.12) { const b = LEAF_COLS[Math.floor(rnd() * LEAF_COLS.length)], j = 0.7 + rnd() * 0.4; leaves.push({ pos: V(x, y, z), rot, scl: V(0.8 + rnd() * 0.6, 1, 0.8 + rnd() * 0.6), col: [b[0] * j, b[1] * j, b[2] * j] }); }
    else if (kind < 0.9) { const j = 0.8 + rnd() * 0.4; needles.push({ pos: V(x, y, z), rot: E(0, rnd() * 6.283, 0), scl: V(1, 1, 0.7 + rnd() * 0.7), col: rnd() < 0.5 ? [0.66 * j, 0.33 * j, 0.13 * j] : [0.5 * j, 0.25 * j, 0.1 * j] }); } // larch gold / pine brown
    else if (kind < 0.96) { const j = 0.85 + rnd() * 0.3; cones.push({ pos: V(x, y + 0.03, z), rot: E((rnd() - 0.5) * 0.4, rnd() * 6.283, 0), scl: V(1, 1, 1).multiplyScalar(0.9 + rnd() * 0.5), col: [0.33 * j, 0.22 * j, 0.1 * j] }); }
    else { const j = 0.8 + rnd() * 0.4; twigs.push({ pos: V(x, y, z), rot: E(0, rnd() * 6.283, (rnd() - 0.5) * 0.15), scl: V(0.6 + rnd() * 1.2, 1, 1), col: [0.35 * j, 0.27 * j, 0.17 * j] }); }
  }
  const leafMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.95, side: THREE.DoubleSide });
  instanced(scene, leafGeo, leafMat, leaves); instanced(scene, needleGeo, leafMat, needles); instanced(scene, coneGeo, flat(0xffffff), cones); instanced(scene, twigGeo, flat(0xffffff), twigs);

  // ---- fire ring: blackened stones, ash, a half-burnt log, between the tent and the water ----
  const fire = [T[0] + n[0] * 7.2 - side[0] * 3.4, T[1] + n[1] * 7.2 - side[1] * 3.4]; const fy = onGround(...fire);
  const stones = [];
  for (let i = 0; i < 11; i++) { const a = (i / 11) * 6.283 + rnd() * 0.3, r = 0.62 + rnd() * 0.08, s = 0.13 + rnd() * 0.1, g = 0.2 + rnd() * 0.12, k = rnd() < 0.5 ? 0.45 : 1; stones.push({ pos: V(fire[0] + Math.cos(a) * r, fy + s * 0.35, fire[1] + Math.sin(a) * r), rot: E(rnd(), rnd() * 6, rnd() * 0.5), scl: V(s * (1 + rnd() * 0.5), s * 0.75, s * (1 + rnd() * 0.4)), col: [g * k, g * k * 0.97, g * k * 0.92] }); }
  instanced(scene, new THREE.DodecahedronGeometry(1, 0), flat(0xffffff, { roughness: 0.9 }), stones);
  const ash = new THREE.Mesh(new THREE.CircleGeometry(0.52, 12), flat(0x2b2a28)); ash.rotation.x = -Math.PI / 2; ash.position.set(fire[0], fy + 0.015, fire[1]); scene.add(ash);
  const charLog = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.7, 6), flat(0x1a1612)); charLog.rotation.set(0.1, 0.6, Math.PI / 2 - 0.3); charLog.position.set(fire[0] + 0.15, fy + 0.08, fire[1] - 0.05); scene.add(charLog);
  const charLog2 = charLog.clone(); charLog2.rotation.set(0.05, -0.8, Math.PI / 2 + 0.2); charLog2.position.set(fire[0] - 0.12, fy + 0.07, fire[1] + 0.12); scene.add(charLog2);
  // a thin wisp of last night's smoke
  const wisp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xb8b4ac, transparent: true, opacity: 0.12, depthWrite: false })); wisp.scale.set(0.9, 1.6, 1); wisp.position.set(fire[0], fy + 0.9, fire[1]); scene.add(wisp);

  // ---- split firewood stacked against a tree, and a camp chair ----
  const wood = flat(0x7a5a38), bark = flat(0x4a3826);
  const stack = [T[0] - side[0] * 6.5 + n[0] * 1.5, T[1] - side[1] * 6.5 + n[1] * 1.5], sy = onGround(...stack);
  const splitGeo = (() => { const g = new THREE.CylinderGeometry(0.08, 0.08, 0.42, 5, 1, false, 0, Math.PI); g.rotateZ(Math.PI / 2); return g; })();
  const logs = [];
  for (let row = 0; row < 3; row++) for (let i = 0; i < 5 - row; i++) { const j = 0.85 + rnd() * 0.3; logs.push({ pos: V(stack[0] + side[0] * (i * 0.17 + row * 0.085 - 0.35) + n[0] * rnd() * 0.06, sy + 0.08 + row * 0.14, stack[1] + side[1] * (i * 0.17 + row * 0.085 - 0.35) + n[1] * rnd() * 0.06), rot: E(0, Math.atan2(n[0], n[1]) + (rnd() - 0.5) * 0.2, rnd() * 6.283), scl: V(1, 1, 1), col: [0.62 * j, 0.47 * j, 0.3 * j] }); }
  instanced(scene, splitGeo, flat(0xffffff), logs);
  { // chair by the fire, facing it
    const ch = new THREE.Group(); const cm = flat(0x274a3a), fm = flat(0x2a2a2c, { metalness: 0.4, roughness: 0.5 });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.45), cm); seat.position.y = 0.42; ch.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.03), cm); back.position.set(0, 0.68, -0.2); back.rotation.x = -0.25; ch.add(back);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 4), fm); leg.position.set(sx * 0.22, 0.22, sz * 0.2); leg.rotation.z = sx * 0.1; leg.rotation.x = -sz * 0.1; ch.add(leg); }
    for (const sx of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.45), fm); arm.position.set(sx * 0.27, 0.62, 0); ch.add(arm); }
    ch.position.set(fire[0] - side[0] * 1.9 - n[0] * 0.4, onGround(fire[0] - side[0] * 1.9, fire[1] - side[1] * 1.9), fire[1] - side[1] * 1.9 - n[1] * 0.4); ch.rotation.y = Math.atan2(fire[0] - ch.position.x, fire[1] - ch.position.z); scene.add(ch);
  }

  // ---- ferns and blueberry along the tree line, moss already in the ground colour ----
  const fernGeo = (() => { const g = []; for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.283; const f = new THREE.PlaneGeometry(0.1, 0.55, 1, 3); f.translate(0, 0.27, 0); f.rotateX(-0.95 - rnd() * 0.3); f.rotateY(a); g.push(f); } return merge(g); })();
  const bushGeo = (() => { const g = []; for (let i = 0; i < 4; i++) { const b = new THREE.IcosahedronGeometry(0.16 + rnd() * 0.08, 0); b.translate((rnd() - 0.5) * 0.3, 0.16 + rnd() * 0.08, (rnd() - 0.5) * 0.3); g.push(b); } return merge(g); })();
  const ferns = [], bushes = [];
  for (let i = 0; i < 700; i++) {
    const a = rnd() * 6.283, r = 15 + Math.sqrt(rnd()) * (R - 15), x = T[0] + Math.cos(a) * r, z = T[1] + Math.sin(a) * r;   // v0.7.0: open floor; ferns only at the fringe
    if (!inCamp(x, z) || campPath(x, z) > 0.1 || rnd() < 0.5) continue;
    const treeNear = treePositions.some((t) => Math.hypot(t[0] - x, t[1] - z) < 4.5), shade = fbm(x * 0.2, z * 0.2 + 9);
    if (!(treeNear || shade > 0.58) || rnd() > 0.55) continue;
    const y = onGround(x, z) - 0.02;
    if (rnd() < 0.95) { const j = 0.8 + rnd() * 0.4; ferns.push({ pos: V(x, y, z), rot: E(0, rnd() * 6.283, 0), scl: V(1, 1, 1).multiplyScalar(0.7 + rnd() * 0.7), col: rnd() < 0.6 ? [0.5 * j, 0.36 * j, 0.1 * j] : [0.25 * j, 0.35 * j, 0.12 * j] }); } // bronze bracken / still green
    else { const j = 0.8 + rnd() * 0.4; bushes.push({ pos: V(x, y, z), rot: E(0, rnd() * 6.283, 0), scl: V(1, 1, 1).multiplyScalar(0.6 + rnd() * 0.8), col: [0.55 * j, 0.12 * j, 0.1 * j] }); }   // blueberry turned scarlet
  }
  instanced(scene, fernGeo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1, side: THREE.DoubleSide }), ferns);
  instanced(scene, bushGeo, flat(0xffffff), bushes);

  // ---- roots breaking the surface around the big trunks ----
  const rootGeo = (() => { const g = []; for (let i = 0; i < 3; i++) { const path = new THREE.CatmullRomCurve3([V(0, 0.02, 0), V(0.5 + i * 0.1, 0.13, (i - 1) * 0.25), V(1.3 + i * 0.2, 0.06, (i - 1) * 0.5), V(2.0 + i * 0.3, -0.05, (i - 1) * 0.7)]); g.push(new THREE.TubeGeometry(path, 8, 0.06 - i * 0.012, 5)); } return merge(g); })();
  const roots = [];
  treePositions.forEach((t) => { if (near(t[0], t[1]) > R + 3) return; for (let k = 0; k < 2 + Math.floor(rnd() * 3); k++) { const a = rnd() * 6.283; roots.push({ pos: V(t[0], onGround(t[0], t[1]) - 0.04, t[1]), rot: E(0, a, 0), scl: V(0.7 + rnd() * 0.8, 1, 0.7 + rnd() * 0.6), col: [0.3, 0.22, 0.14] }); } });
  instanced(scene, rootGeo, bark, roots);

  // ---- v0.7.0 (photos): a few giant white pines right in camp - thick furrowed trunks, flared roots, crowns far overhead ----
  const P2 = (a, b) => [T[0] + side[0] * a + n[0] * b, T[1] + side[1] * a + n[1] * b];
  const barkG = flat(0x5a4436), crownM = flat(0x1f3a24);
  const trunkGeo = (() => {
    const g = new THREE.CylinderGeometry(0.4, 0.72, 30, 11, 10, true), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), r = Math.hypot(x, z), h = (y + 15) / 30;
      const flare = 1 + 0.9 * Math.pow(Math.max(0, 1 - h * 9), 2), furrow = 1 + 0.07 * Math.sin(a * 11) + 0.03 * Math.sin(a * 5 + y);
      const k = flare * furrow; p.setX(i, Math.cos(a) * r * k); p.setZ(i, Math.sin(a) * r * k); }
    g.translate(0, 15, 0); g.computeVertexNormals(); return g;
  })();
  const tierGeo = (() => { const g = new THREE.CylinderGeometry(0.8, 3.2, 1.4, 8, 1); return g; })();
  const bigPines = [];
  [[7, -3.3], [7, 1.3], [-8, -3], [3.5, -6.8], [-7, 12], [10, 9], [-11, 5]].forEach(([a, b], i) => {
    const [x, z] = P2(a, b), y = onGround(x, z) - 0.15, g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rnd() * 6.28;
    const sc = 0.85 + rnd() * 0.35; const tr = new THREE.Mesh(trunkGeo, barkG); tr.scale.set(sc, 1, sc); g.add(tr);
    [[19, 0.9, 0.3], [22.5, 1.0, -0.5], [25.5, 0.85, 0.6], [28.5, 0.55, 0]].forEach(([h, s, o]) => { const t = new THREE.Mesh(tierGeo, crownM); t.position.set(o, h + rnd() * 1.5, -o * 0.6); t.scale.set(s * (1 + rnd() * 0.4), 1, s * (1 + rnd() * 0.4)); g.add(t); });
    for (let k = 0; k < 3; k++) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.08, 0.9, 4), barkG); const hh = 5 + rnd() * 10, aa = rnd() * 6.28; st.position.set(Math.cos(aa) * 0.5 * sc, hh, Math.sin(aa) * 0.5 * sc); st.rotation.set(0, -aa, Math.PI / 2.3); g.add(st); }   // dead branch stubs
    scene.add(g); bigPines.push({ x, z, r: 0.6 * sc, g });
  });

  // ---- camp gear from the photos: folding table under a blue tarp, red/blue/green chairs round the fire, a cooler, a hammock ----
  {
    const tarpM = new THREE.MeshStandardMaterial({ color: 0x2c55b0, flatShading: true, roughness: 0.7, side: THREE.DoubleSide }), legM = flat(0x6c6c6c, { metalness: 0.5, roughness: 0.5 });
    const [tx, tz] = P2(-6.4, 9.8), ty = onGround(tx, tz), tb = new THREE.Group(); tb.position.set(tx, ty, tz); tb.rotation.y = Math.atan2(n[0], n[1]) + 0.15; scene.add(tb);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.04, 1.83), flat(0xd8d4c8)); top.position.y = 0.72; tb.add(top);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.72, 4), legM); l.position.set(sx * 0.33, 0.36, sz * 0.82); tb.add(l); }
    const tg = new THREE.PlaneGeometry(1.25, 2.3, 6, 10), tp = tg.attributes.position;
    for (let i = 0; i < tp.count; i++) { const x = tp.getX(i), y = tp.getY(i), ox = Math.max(0, Math.abs(x) - 0.38), oy = Math.max(0, Math.abs(y) - 0.92); tp.setZ(i, -(ox + oy) * 1.5 + (rnd() - 0.5) * 0.02); }   // drapes over the edges
    tg.computeVertexNormals(); const tarp = new THREE.Mesh(tg, tarpM); tarp.rotation.x = -Math.PI / 2; tarp.position.y = 0.75; tb.add(tarp);
    [[0.15, 0.3, 0xe8a020], [-0.1, 0.45, 0xf0d040], [0.05, -0.5, 0xd06a20]].forEach(([x, z, c]) => { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.11, 7), flat(c)); cup.position.set(x, 0.81, z); tb.add(cup); });
    for (let k = 0; k < 6; k++) { const card = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.09), flat(0xf4f0e6)); card.rotation.set(-Math.PI / 2, 0, rnd() * 6); card.position.set((rnd() - 0.5) * 0.4, 0.765, (rnd() - 0.5) * 0.5 - 0.1); tb.add(card); }
    const chairAt = (a, b, col) => { const ch = new THREE.Group(), cm = flat(col), fm = flat(0x2a2a2c, { metalness: 0.4, roughness: 0.5 });
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.45), cm); seat.position.y = 0.42; ch.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.03), cm); back.position.set(0, 0.68, -0.2); back.rotation.x = -0.25; ch.add(back);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 4), fm); leg.position.set(sx * 0.22, 0.22, sz * 0.2); ch.add(leg); }
      for (const sx of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.45), cm); arm.position.set(sx * 0.27, 0.62, 0); ch.add(arm); }
      const [x, z] = P2(a, b); ch.position.set(x, onGround(x, z), z); ch.rotation.y = Math.atan2(fire[0] - x, fire[1] - z) + (rnd() - 0.5) * 0.4; scene.add(ch); };
    chairAt(-1.5, 8.4, 0xb8282c); chairAt(-2.6, 5.4, 0x2a50a8); chairAt(-4.6, 9.0, 0x2f7a3a);
    const [cx, cz] = P2(3.9, 4.2), cool = new THREE.Group(); cool.position.set(cx, onGround(cx, cz), cz); cool.rotation.y = rnd() * 3; scene.add(cool);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.42, 0.42), flat(0x2f8a4a)); body.position.y = 0.21; cool.add(body);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.77, 0.07, 0.44), flat(0xeeeeea)); lid.position.y = 0.45; cool.add(lid);
    // hammock slung between the first two giant pines
    const A = bigPines[0], B = bigPines[1], ax = new THREE.Vector3(B.x - A.x, 0, B.z - A.z), L = ax.length(); ax.normalize();
    const mid = new THREE.Vector3((A.x + B.x) / 2, 0, (A.z + B.z) / 2), gy = onGround(mid.x, mid.z), hl = 1.45, span = L / 2 - Math.max(A.r, B.r) * 1.3;
    const hg = new THREE.PlaneGeometry(hl * 2, 1.15, 18, 6), hp = hg.attributes.position;
    for (let i = 0; i < hp.count; i++) { const u = hp.getX(i) / hl, v = hp.getY(i) / 0.575, sag = 1 - u * u, w = 0.25 + 0.75 * Math.sqrt(Math.max(0, sag));
      hp.setX(i, u * hl); hp.setY(i, v * 0.575 * w); hp.setZ(i, 1.25 - 0.7 * sag + 0.22 * v * v * sag); }
    hg.computeVertexNormals();
    const ham = new THREE.Mesh(hg, new THREE.MeshStandardMaterial({ color: 0x9db3aa, flatShading: true, roughness: 0.9, side: THREE.DoubleSide }));
    const hamG = new THREE.Group(); hamG.position.set(mid.x, gy, mid.z); hamG.rotation.y = Math.atan2(-ax.z, ax.x); scene.add(hamG);
    ham.rotation.x = -Math.PI / 2; ham.rotation.z = 0; hamG.add(ham);
    // the plane's X runs along the hammock; after rotation.x the plane's Z is up
    const ropeM = new THREE.LineBasicMaterial({ color: 0x8a8070 });
    for (const sgn of [-1, 1]) { const g2 = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(sgn * hl, 1.25, 0), new THREE.Vector3(sgn * span, 1.75, 0)]); hamG.add(new THREE.Line(g2, ropeM)); }
    // the plane is laid in X/Y; rotating by -PI/2 about X maps local Z (height) -> world Y and local Y (width) -> world -Z
    S_GEAR.hammock = { group: hamG, mid, ax, span, gy };
  }

  // ---- smoky sunbeams: shafts of low sun slanting between the trunks, through a haze of last night's smoke ----
  const shaftTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 256; const x = c.getContext('2d');
    const gx = x.createLinearGradient(0, 0, 64, 0); gx.addColorStop(0, 'rgba(255,255,255,0)'); gx.addColorStop(0.5, 'rgba(255,255,255,1)'); gx.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gx; x.fillRect(0, 0, 64, 256);
    x.globalCompositeOperation = 'destination-in'; const gy2 = x.createLinearGradient(0, 0, 0, 256); gy2.addColorStop(0, 'rgba(0,0,0,0)'); gy2.addColorStop(0.25, 'rgba(0,0,0,1)'); gy2.addColorStop(0.8, 'rgba(0,0,0,0.8)'); gy2.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gy2; x.fillRect(0, 0, 64, 256);
    return new THREE.CanvasTexture(c); })();
  // drawn after the post pass (over the mist, which they are lighting), fading where the scene's own depth says something is in front
  const U = post ? post.uniforms : null;
  const shaftM = new THREE.ShaderMaterial({
    uniforms: { map: { value: shaftTex }, color: { value: new THREE.Color(0xffe2b0) }, opacity: { value: 0 }, tDepth: U ? U.tDepth : { value: null }, uRes: post ? post.overlayCanvas : { value: new THREE.Vector2(1, 1) }, uProjInv: U ? U.uProjInv : { value: new THREE.Matrix4() }, uUseDepth: post ? post.overlayDepth : { value: 0 } },
    vertexShader: 'varying vec2 vUv; varying vec3 vV, vN; void main(){ vUv = uv; vN = normalMatrix * normal; vec4 mv = modelViewMatrix * vec4(position,1.); vV = mv.xyz; gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform sampler2D map, tDepth; uniform vec3 color; uniform float opacity, uUseDepth; uniform vec2 uRes; uniform mat4 uProjInv; varying vec2 vUv; varying vec3 vV, vN;
      void main(){ float k = smoothstep(0.15, 0.6, abs(dot(normalize(vN), normalize(-vV))));   /* edge-on planes would read as hard lines */
        if (uUseDepth > 0.5) { vec2 uv = gl_FragCoord.xy / uRes; float d = texture2D(tDepth, uv).r; vec4 v = uProjInv * vec4(uv*2.-1., d*2.-1., 1.); v /= v.w; k *= smoothstep(0., 3., length(v.xyz) - length(vV)); }
        gl_FragColor = vec4(color * texture2D(map, vUv).a * opacity * k, 1.); }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  Object.defineProperty(shaftM, 'opacityV', { get: () => shaftM.uniforms.opacity.value, set: (v) => { shaftM.uniforms.opacity.value = v; } });
  const shafts = [];
  for (let i = 0; i < 9; i++) {
    const a = rnd() * 6.283, r = 5 + rnd() * 16, x = T[0] + Math.cos(a) * r, z = T[1] + Math.sin(a) * r, w = 2.5 + rnd() * 3;
    const g = new THREE.Group(); g.position.set(x, onGround(x, z) + 5, z);
    for (const ry of [0, Math.PI / 2]) { const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, 14), shaftM); pl.rotation.y = ry; g.add(pl); }
    (post ? post.overlay : scene).add(g); shafts.push({ g, ph: rnd() * 6 });
  }
  const smokeM = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xd9d2c4, transparent: true, opacity: 0, depthWrite: false });
  const smoke = []; for (let i = 0; i < 10; i++) { const sp = new THREE.Sprite(smokeM.clone()); sp.scale.set(5 + rnd() * 5, 2.5 + rnd() * 2, 1); scene.add(sp); smoke.push({ sp, a: rnd() * 6.28, r: 2 + rnd() * 9, h: 1.5 + rnd() * 4, ph: rnd() * 6 }); }
  const up = new THREE.Vector3(0, 1, 0), qd = new THREE.Quaternion(), sd = new THREE.Vector3();

  // ---- dew: tiny bright points on the ground that catch the low sun ----
  const N = 900, dp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const a = rnd() * 6.283, r = Math.sqrt(rnd()) * R, x = T[0] + Math.cos(a) * r, z = T[1] + Math.sin(a) * r; dp[i * 3] = x; dp[i * 3 + 1] = onGround(x, z, 0.03); dp[i * 3 + 2] = z; }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dm = new THREE.PointsMaterial({ map: glowTexture(), color: 0xfff4dc, size: 0.035, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const dew = new THREE.Points(dg, dm); dew.frustumCulled = false; scene.add(dew);
  return {
    fire, stack,
    /** sunUp: 0..1 how high the sun is; facing: dot(camera forward, sun dir) */
    bigPines, gear: S_GEAR,
    update(t, sunUp, facing, sunDir) {
      // sunbeams: strongest with the sun low (dawn, the intro), slanting along the light, breathing slowly
      const low = sstep(-0.02, 0.06, sunUp) * (1 - sstep(0.28, 0.5, sunUp));
      if (sunDir) { sd.copy(sunDir); sd.y = Math.max(sd.y, 1.1); sd.normalize(); qd.setFromUnitVectors(up, sd); }   // a low sun, but steep enough to read as shafts between the trunks
      shafts.forEach((s2, i) => { s2.g.quaternion.copy(qd); s2.g.visible = low > 0.01; });
      shaftM.opacityV = 0.32 * low * clamp(0.6 + 0.4 * facing, 0.6, 1) * (0.85 + 0.15 * Math.sin(t * 0.3));
      smoke.forEach((s2) => { const a = s2.a + t * 0.01; s2.sp.position.set(fire[0] + Math.cos(a) * s2.r, onGround(fire[0], fire[1]) + s2.h + Math.sin(t * 0.2 + s2.ph) * 0.4, fire[1] + Math.sin(a) * s2.r); s2.sp.material.opacity = 0.05 + 0.06 * low; }); dm.opacity = 0.35 * sstep(-0.02, 0.08, sunUp) * (1 - sstep(0.2, 0.42, sunUp)) * clamp(0.35 + 0.65 * facing, 0, 1) * (0.7 + 0.3 * Math.sin(t * 2.1)); wisp.material.opacity = 0.1 + 0.04 * Math.sin(t * 0.7); wisp.position.x = fire[0] + Math.sin(t * 0.35) * 0.2; },
  };
}
