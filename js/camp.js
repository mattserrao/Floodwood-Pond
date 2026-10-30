import * as THREE from 'three';
import { clamp, lerp, sstep, rnd, fbm, pondSD, heightAt, CAMP, campPath, LEAF_COLS, leafGeometry, glowTexture } from './world.js';

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

export function buildCamp(scene, treePositions = []) {
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
  for (let i = 0; i < 2600; i++) {
    const a = rnd() * 6.283, r = Math.sqrt(rnd()) * R, x = T[0] + Math.cos(a) * r, z = T[1] + Math.sin(a) * r;
    if (!inCamp(x, z)) continue;
    const path = campPath(x, z), pad = 1 - sstep(1.6, 3.0, near(x, z));
    if (rnd() < Math.max(path, pad) * 0.92) continue;                        // worn bare where people walk and sleep
    const woods = sstep(0.4, 0.7, fbm(x * 0.25 + 4, z * 0.25)) * 0.6 + 0.4;  // clumps under the trees
    if (rnd() > woods) continue;
    const y = onGround(x, z, 0.012 + rnd() * 0.02), rot = E((rnd() - 0.5) * 0.5, rnd() * 6.283, (rnd() - 0.5) * 0.5);
    const kind = rnd();
    if (kind < 0.5) { const b = LEAF_COLS[Math.floor(rnd() * LEAF_COLS.length)], j = 0.7 + rnd() * 0.4; leaves.push({ pos: V(x, y, z), rot, scl: V(0.8 + rnd() * 0.6, 1, 0.8 + rnd() * 0.6), col: [b[0] * j, b[1] * j, b[2] * j] }); }
    else if (kind < 0.9) { const j = 0.8 + rnd() * 0.4; needles.push({ pos: V(x, y, z), rot: E(0, rnd() * 6.283, 0), scl: V(1, 1, 0.7 + rnd() * 0.7), col: rnd() < 0.5 ? [0.72 * j, 0.55 * j, 0.14 * j] : [0.45 * j, 0.3 * j, 0.12 * j] }); } // larch gold / pine brown
    else if (kind < 0.96) { const j = 0.85 + rnd() * 0.3; cones.push({ pos: V(x, y + 0.03, z), rot: E((rnd() - 0.5) * 0.4, rnd() * 6.283, 0), scl: V(1, 1, 1).multiplyScalar(0.9 + rnd() * 0.5), col: [0.33 * j, 0.22 * j, 0.1 * j] }); }
    else { const j = 0.8 + rnd() * 0.4; twigs.push({ pos: V(x, y, z), rot: E(0, rnd() * 6.283, (rnd() - 0.5) * 0.15), scl: V(0.6 + rnd() * 1.2, 1, 1), col: [0.35 * j, 0.27 * j, 0.17 * j] }); }
  }
  const leafMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.95, side: THREE.DoubleSide });
  instanced(scene, leafGeo, leafMat, leaves); instanced(scene, needleGeo, leafMat, needles); instanced(scene, coneGeo, flat(0xffffff), cones); instanced(scene, twigGeo, flat(0xffffff), twigs);

  // ---- fire ring: blackened stones, ash, a half-burnt log, between the tent and the water ----
  const fire = [T[0] + n[0] * 5.5 - side[0] * 3.2, T[1] + n[1] * 5.5 - side[1] * 3.2]; const fy = onGround(...fire);
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
    const a = rnd() * 6.283, r = 6 + Math.sqrt(rnd()) * (R - 6), x = T[0] + Math.cos(a) * r, z = T[1] + Math.sin(a) * r;
    if (!inCamp(x, z) || campPath(x, z) > 0.1) continue;
    const treeNear = treePositions.some((t) => Math.hypot(t[0] - x, t[1] - z) < 4.5), shade = fbm(x * 0.2, z * 0.2 + 9);
    if (!(treeNear || shade > 0.58) || rnd() > 0.55) continue;
    const y = onGround(x, z) - 0.02;
    if (rnd() < 0.7) { const j = 0.8 + rnd() * 0.4; ferns.push({ pos: V(x, y, z), rot: E(0, rnd() * 6.283, 0), scl: V(1, 1, 1).multiplyScalar(0.7 + rnd() * 0.7), col: rnd() < 0.6 ? [0.5 * j, 0.36 * j, 0.1 * j] : [0.25 * j, 0.35 * j, 0.12 * j] }); } // bronze bracken / still green
    else { const j = 0.8 + rnd() * 0.4; bushes.push({ pos: V(x, y, z), rot: E(0, rnd() * 6.283, 0), scl: V(1, 1, 1).multiplyScalar(0.6 + rnd() * 0.8), col: [0.55 * j, 0.12 * j, 0.1 * j] }); }   // blueberry turned scarlet
  }
  instanced(scene, fernGeo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1, side: THREE.DoubleSide }), ferns);
  instanced(scene, bushGeo, flat(0xffffff), bushes);

  // ---- roots breaking the surface around the big trunks ----
  const rootGeo = (() => { const g = []; for (let i = 0; i < 3; i++) { const path = new THREE.CatmullRomCurve3([V(0, 0.02, 0), V(0.5 + i * 0.1, 0.13, (i - 1) * 0.25), V(1.3 + i * 0.2, 0.06, (i - 1) * 0.5), V(2.0 + i * 0.3, -0.05, (i - 1) * 0.7)]); g.push(new THREE.TubeGeometry(path, 8, 0.06 - i * 0.012, 5)); } return merge(g); })();
  const roots = [];
  treePositions.forEach((t) => { if (near(t[0], t[1]) > R + 3) return; for (let k = 0; k < 2 + Math.floor(rnd() * 3); k++) { const a = rnd() * 6.283; roots.push({ pos: V(t[0], onGround(t[0], t[1]) - 0.04, t[1]), rot: E(0, a, 0), scl: V(0.7 + rnd() * 0.8, 1, 0.7 + rnd() * 0.6), col: [0.3, 0.22, 0.14] }); } });
  instanced(scene, rootGeo, bark, roots);

  // ---- dew: tiny bright points on the ground that catch the low sun ----
  const N = 900, dp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const a = rnd() * 6.283, r = Math.sqrt(rnd()) * R, x = T[0] + Math.cos(a) * r, z = T[1] + Math.sin(a) * r; dp[i * 3] = x; dp[i * 3 + 1] = onGround(x, z, 0.03); dp[i * 3 + 2] = z; }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dm = new THREE.PointsMaterial({ map: glowTexture(), color: 0xfff4dc, size: 0.035, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const dew = new THREE.Points(dg, dm); dew.frustumCulled = false; scene.add(dew);
  return {
    fire, stack,
    /** sunUp: 0..1 how high the sun is; facing: dot(camera forward, sun dir) */
    update(t, sunUp, facing) { dm.opacity = 0.35 * sstep(-0.02, 0.08, sunUp) * (1 - sstep(0.2, 0.42, sunUp)) * clamp(0.35 + 0.65 * facing, 0, 1) * (0.7 + 0.3 * Math.sin(t * 2.1)); wisp.material.opacity = 0.1 + 0.04 * Math.sin(t * 0.7); wisp.position.x = fire[0] + Math.sin(t * 0.35) * 0.2; },
  };
}
