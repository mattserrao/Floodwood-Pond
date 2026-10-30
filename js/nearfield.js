// v0.9.0 near field: everything that makes the land read as real when you're close to it.
//  - detailed trees: within ~110 m the simple cone trees are swapped for jagged spruce, windswept white pine, maple and
//    birch models (several variants each), with root flare, bark grain and backlit foliage; they cast shadows
//  - a ground-detail ring (~65 m) that fills the forest floor and shore as you move: needle duff and moss patches,
//    ferns, low shrubs, sedge, sticks, cones, rocks, stumps, roots, fallen logs and saplings
//  - soft contact shadows under trunks, rocks and stumps
// Everything is instanced (one draw call per kind) and rebuilt only when the canoe has moved a few metres.
import * as THREE from 'three';
import { clamp, lerp, rnd, fbm, pondSD, heightAt, fullHeight, inPatch, inCampBox, CAMP, ISLE, inIsleBox, beachFactor, WORLD, swayMaterial, foliageLight, LEAF_COLS, distFade, NEAR_FADE } from './world.js?v=0.9.1';

// ------------------------------------------------------------------ geometry helpers
/** a mesh builder that collects triangles with colours and a bark flag */
class Builder {
  constructor() { this.P = []; this.C = []; this.B = []; }
  tri(a, b, c, col, bark = 0, cb = col, cc = col) { this.P.push(...a, ...b, ...c); this.C.push(...col, ...cb, ...cc); this.B.push(bark, bark, bark); }
  add(geo, col, bark = 0, tf = null, jitter = 0, rng = Math.random, shadeY = null) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone(); if (tf) g.applyMatrix4(tf);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (jitter) { const h = Math.sin(x * 12.9 + y * 78.2 + z * 37.7) * 43758.5; const j = (h - Math.floor(h) - 0.5) * jitter; x += j; z -= j * 0.7; y += j * 0.4; }
      this.P.push(x, y, z); const k = shadeY ? shadeY(y) : 1; this.C.push(col[0] * k, col[1] * k, col[2] * k); this.B.push(bark); }
  }
  geometry() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3)); g.setAttribute('aBark', new THREE.Float32BufferAttribute(this.B, 1)); g.computeVertexNormals(); return g; }
}
const seeded = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V3 = new THREE.Vector3(), S3 = new THREE.Vector3(), COL = new THREE.Color();

/** a tapering, slightly leaning trunk with a flared root collar */
function trunk(b, h, r0, r1, col, lean, R, seg = 7) {
  const rings = 6, pts = [];
  for (let i = 0; i <= rings; i++) { const t = i / rings, y = t * h, r = lerp(r0, r1, Math.pow(t, 0.8)) * (1 + 0.75 * Math.pow(Math.max(0, 1 - t * 7), 2)); const ox = lean[0] * t * t * h, oz = lean[1] * t * t * h;
    const ring = []; for (let k = 0; k < seg; k++) { const a = (k / seg) * Math.PI * 2, rr = r * (1 + (t < 0.15 ? 0.25 * Math.sin(a * 3 + R() * 6) : 0.06 * Math.sin(a * 5 + i))); ring.push([ox + Math.cos(a) * rr, y, oz + Math.sin(a) * rr]); } pts.push(ring); }
  for (let i = 0; i < rings; i++) for (let k = 0; k < seg; k++) { const a = pts[i][k], c = pts[i][(k + 1) % seg], d = pts[i + 1][k], e = pts[i + 1][(k + 1) % seg]; const sh = 0.85 + 0.25 * (i / rings);
    const cc = [col[0] * sh, col[1] * sh, col[2] * sh]; b.tri(a, d, c, cc, 1); b.tri(c, d, e, cc, 1); }
  return (y) => { const t = y / h; return [lean[0] * t * t * h, lean[1] * t * t * h]; };   // trunk centre at height y
}
/** one whorl of a spruce: a jagged star-shaped skirt, long drooping points with short ones between, dark underneath */
function whorl(b, cx, cz, yTop, yRim, r, k, R, tipDroop = 0.35) {
  const rim = [];
  for (let i = 0; i < k * 2; i++) { const a = (i / (k * 2)) * Math.PI * 2 + R() * 0.25, long = i % 2 === 0, rr = r * (long ? 0.9 + R() * 0.25 : 0.5 + R() * 0.12);
    rim.push([cx + Math.cos(a) * rr, yRim - (long ? tipDroop * r * (0.6 + R() * 0.6) : 0), cz + Math.sin(a) * rr, long]); }
  const apex = [cx, yTop, cz], under = [cx, yRim + (yTop - yRim) * 0.28, cz];
  for (let i = 0; i < rim.length; i++) { const p = rim[i], q = rim[(i + 1) % rim.length];
    const cp = p[3] ? [1.12, 1.12, 1.05] : [0.72, 0.72, 0.72], cq = q[3] ? [1.12, 1.12, 1.05] : [0.72, 0.72, 0.72];
    b.tri(apex, [q[0], q[1], q[2]], [p[0], p[1], p[2]], [0.95, 0.95, 0.95], 0, cq, cp);
    b.tri(under, [p[0], p[1], p[2]], [q[0], q[1], q[2]], [0.42, 0.42, 0.42], 0, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]); }
}
/** a lumpy, jittered foliage clump (maple / birch / pine tufts) */
function clump(b, x, y, z, sx, sy, sz, R, shade = 1) {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 0.82 + R() * 0.36; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }
  b.add(g, [shade, shade, shade], 0, M4.compose(V3.set(x, y, z), Q.setFromEuler(E.set(R() * 0.5, R() * 6, R() * 0.5)), S3.set(sx, sy, sz)), 0, R, (yy) => 0.62 + 0.5 * clamp((yy - (y - sy)) / (2 * sy), 0, 1));
}

// ------------------------------------------------------------------ tree variants (sized to match the cone trees they replace: ~11 m tall, ~2.4 m skirt)
function spruce(seed) { const R = seeded(seed), b = new Builder(), H = 10.8 + R() * 0.8, lean = [(R() - 0.5) * 0.03, (R() - 0.5) * 0.03];
  const at = trunk(b, H * 0.96, 0.3, 0.05, [0.26, 0.18, 0.12], lean, R);
  const n = 8 + Math.floor(R() * 2);
  for (let i = 0; i < n; i++) { const t = i / n, yTop = 2.2 + t * (H - 2.6) + 1.3, yRim = yTop - (1.7 - t * 0.6), r = 2.55 * Math.pow(1 - t, 0.85) + 0.3; const [cx, cz] = at(yRim); whorl(b, cx, cz, yTop, yRim, r, 7 + Math.floor(R() * 3), R); }
  const [tx, tz] = at(H); whorl(b, tx, tz, H + 0.9, H - 0.2, 0.35, 5, R, 0.1);
  return b.geometry(); }
function whitePine(seed) { const R = seeded(seed), b = new Builder(), H = 11 + R(), lean = [(R() - 0.5) * 0.05, (R() - 0.5) * 0.05], wind = R() * 6.28;
  const at = trunk(b, H * 0.88, 0.34, 0.08, [0.3, 0.23, 0.17], lean, R);
  const n = 5 + Math.floor(R() * 2);
  for (let i = 0; i < n; i++) { const t = i / (n - 1), y = H * (0.48 + 0.48 * t), [cx, cz] = at(y), reach = (2.4 - t * 1.4) * (0.8 + R() * 0.4), a = wind + (R() - 0.5) * 1.6;
    const ox = cx + Math.cos(a) * reach * 0.45, oz = cz + Math.sin(a) * reach * 0.45;
    b.add(new THREE.CylinderGeometry(0.03, 0.07, reach, 4), [0.3, 0.23, 0.17], 1, M4.compose(V3.set((cx + ox) / 2, y - 0.1, (cz + oz) / 2), Q.setFromEuler(E.set(0, -a, Math.PI / 2.2)), S3.set(1, 1, 1)));
    clump(b, ox, y + 0.15, oz, reach * 0.75, 0.45 + R() * 0.15, reach * 0.6, R, 0.95);
    if (R() < 0.6) clump(b, ox + Math.cos(a + 1.2) * 0.8, y + 0.3, oz + Math.sin(a + 1.2) * 0.8, reach * 0.4, 0.35, reach * 0.35, R, 0.85); }
  return b.geometry(); }
function maple(seed) { const R = seeded(seed), b = new Builder(), H = 10 + R(), lean = [(R() - 0.5) * 0.06, (R() - 0.5) * 0.06];
  const at = trunk(b, H * 0.55, 0.34, 0.16, [0.3, 0.25, 0.2], lean, R);
  const [cx, cz] = at(H * 0.55);
  for (let i = 0; i < 3; i++) { const a = R() * 6.28, L = 2 + R(); b.add(new THREE.CylinderGeometry(0.06, 0.13, L, 5), [0.3, 0.25, 0.2], 1, M4.compose(V3.set(cx + Math.cos(a) * L * 0.3, H * 0.55 + L * 0.35, cz + Math.sin(a) * L * 0.3), Q.setFromEuler(E.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6)), S3.set(1, 1, 1))); }
  const n = 7 + Math.floor(R() * 3);
  for (let i = 0; i < n; i++) { const a = R() * 6.28, rr = R() * 2.2, y = H * 0.68 + R() * H * 0.28; clump(b, cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr, 1.4 + R() * 0.8, 1.1 + R() * 0.5, 1.4 + R() * 0.8, R); }
  return b.geometry(); }
function birch(seed) { const R = seeded(seed), b = new Builder(), H = 10 + R();
  const stems = R() < 0.5 ? 2 : 1;
  for (let s = 0; s < stems; s++) { const lean = [(R() - 0.5) * 0.12 + (s ? 0.06 : 0), (R() - 0.5) * 0.12]; const ox = s ? 0.35 : 0;
    // white bark with dark lenticel bands: build the trunk ring by ring with alternating colours
    const seg = 6, rings = 9, h = H * (0.82 - s * 0.1), pts = [];
    for (let i = 0; i <= rings; i++) { const t = i / rings, y = t * h, r = lerp(0.2, 0.05, t) * (1 + 0.5 * Math.max(0, 1 - t * 6)); const cx = ox + lean[0] * t * t * h, cz = lean[1] * t * t * h; const ring = []; for (let k = 0; k < seg; k++) { const a = (k / seg) * 6.283; ring.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]); } pts.push(ring); }
    for (let i = 0; i < rings; i++) for (let k = 0; k < seg; k++) { const band = (i * 3 + k) % 5 === 0, col = band ? [0.2, 0.19, 0.18] : [0.88, 0.86, 0.8];
      const a = pts[i][k], c = pts[i][(k + 1) % seg], d = pts[i + 1][k], e = pts[i + 1][(k + 1) % seg]; b.tri(a, d, c, col, 1); b.tri(c, d, e, col, 1); }
    const top = pts[rings][0];
    for (let i = 0; i < 6; i++) { const a = R() * 6.28, rr = R() * 1.4; clump(b, top[0] + Math.cos(a) * rr, h * (0.72 + R() * 0.3), top[2] + Math.sin(a) * rr, 1.0 + R() * 0.6, 0.9 + R() * 0.4, 1.0 + R() * 0.6, R); } }
  return b.geometry(); }

// ------------------------------------------------------------------ ground-detail geometry
function decal(R, n = 9, r = 1) { const b = new Builder(), c = [0, 0.01, 0]; let prev = null, first = null;
  for (let i = 0; i <= n; i++) { const a = (i / n) * 6.283, rr = r * (0.55 + R() * 0.55), p = [Math.cos(a) * rr, 0, Math.sin(a) * rr]; if (!first) first = p; if (prev) b.tri(c, i === n ? first : p, prev, [1, 1, 1]); prev = p; } return b.geometry(); }
function fernGeo(R) { const b = new Builder(); for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.283 + R() * 0.3, L = 0.55 + R() * 0.35, w = 0.09;
  const base = [0, 0.02, 0], mid = [Math.cos(a) * L * 0.55, L * 0.42, Math.sin(a) * L * 0.55], tip = [Math.cos(a) * L, L * 0.2, Math.sin(a) * L], px = -Math.sin(a) * w, pz = Math.cos(a) * w;
  b.tri(base, [mid[0] + px, mid[1], mid[2] + pz], mid, [0.8, 0.8, 0.8]); b.tri(base, mid, [mid[0] - px, mid[1], mid[2] - pz], [0.75, 0.75, 0.75]);
  b.tri(mid, [mid[0] + px, mid[1], mid[2] + pz], tip, [1, 1, 1]); b.tri(mid, tip, [mid[0] - px, mid[1], mid[2] - pz], [0.95, 0.95, 0.95]); } return b.geometry(); }
function shrubGeo(R) { const b = new Builder();   // a loose, twiggy low shrub: small leaf tufts on thin stems
  for (let i = 0; i < 6; i++) { const a = R() * 6.28, L = 0.35 + R() * 0.35, tx = Math.cos(a) * L * 0.6, tz = Math.sin(a) * L * 0.6, ty = L;
    b.add(new THREE.CylinderGeometry(0.006, 0.014, L, 3), [0.35, 0.25, 0.18], 1, M4.compose(V3.set(tx / 2, ty / 2, tz / 2), Q.setFromEuler(E.set(Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55)), S3.set(1, 1, 1)));
    clump(b, tx, ty, tz, 0.16 + R() * 0.1, 0.11 + R() * 0.06, 0.16 + R() * 0.1, R); if (R() < 0.6) clump(b, tx * 0.6, ty * 0.7, tz * 0.6, 0.12, 0.09, 0.12, R, 0.85); }
  return b.geometry(); }
function sedgeGeo(R) { const b = new Builder(); for (let i = 0; i < 9; i++) { const a = R() * 6.28, L = 0.45 + R() * 0.45, lean = 0.15 + R() * 0.3; b.tri([Math.cos(a + 1.6) * 0.03, 0, Math.sin(a + 1.6) * 0.03], [Math.cos(a) * L * lean, L, Math.sin(a) * L * lean], [Math.cos(a - 1.6) * 0.03, 0, Math.sin(a - 1.6) * 0.03], [1, 1, 1], 0, [1.2, 1.2, 1.1], [0.8, 0.8, 0.8]); } return b.geometry(); }
function stickGeo() { const b = new Builder(); b.add(new THREE.CylinderGeometry(0.018, 0.028, 1, 4), [1, 1, 1], 1, M4.compose(V3.set(0, 0.03, 0), Q.setFromEuler(E.set(0, 0, Math.PI / 2)), S3.set(1, 1, 1))); b.add(new THREE.CylinderGeometry(0.008, 0.014, 0.35, 3), [1, 1, 1], 1, M4.compose(V3.set(0.15, 0.08, 0.06), Q.setFromEuler(E.set(0.6, 0, Math.PI / 2 - 0.7)), S3.set(1, 1, 1))); return b.geometry(); }
function coneGeo() { const b = new Builder(); b.add(new THREE.ConeGeometry(0.04, 0.11, 6), [1, 1, 1], 1, M4.compose(V3.set(0, 0.04, 0), Q.setFromEuler(E.set(Math.PI / 2, 0, 0)), S3.set(1, 1, 1))); return b.geometry(); }
function rockGeo(R) { const b = new Builder(), g = new THREE.DodecahedronGeometry(1, 0), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const k = 0.8 + R() * 0.4; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.65, p.getZ(i) * k); }
  b.add(g, [1, 1, 1], 1, null, 0, R, (y) => (y > 0.35 ? 1.12 : 0.85)); return b.geometry(); }   // the top catches light (and reads as moss when tinted green)
function stumpGeo(R) { const b = new Builder(); b.add(new THREE.CylinderGeometry(0.26, 0.36, 0.55, 8), [0.55, 0.42, 0.3], 1, M4.compose(V3.set(0, 0.27, 0), Q.identity(), S3.set(1, 1, 1)), 0.03, R);
  b.add(new THREE.CircleGeometry(0.26, 8), [0.78, 0.62, 0.42], 1, M4.compose(V3.set(0, 0.551, 0), Q.setFromEuler(E.set(-Math.PI / 2, 0, 0)), S3.set(1, 1, 1)));
  for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.28 + R(); b.add(new THREE.CylinderGeometry(0.05, 0.12, 0.8, 5), [0.5, 0.38, 0.27], 1, M4.compose(V3.set(Math.cos(a) * 0.42, 0.05, Math.sin(a) * 0.42), Q.setFromEuler(E.set(0, -a, Math.PI / 2 - 0.25)), S3.set(1, 1, 1))); }
  return b.geometry(); }
function rootGeo(R) { const b = new Builder(); for (let i = 0; i < 3; i++) { const path = new THREE.CatmullRomCurve3([V3.clone().set(0, 0.02, 0), new THREE.Vector3(0.5 + R() * 0.3, 0.12, (i - 1) * 0.25), new THREE.Vector3(1.3 + R() * 0.4, 0.05, (i - 1) * 0.55), new THREE.Vector3(2 + R() * 0.6, -0.06, (i - 1) * 0.8)]);
  b.add(new THREE.TubeGeometry(path, 6, 0.06 - i * 0.01, 4), [1, 1, 1], 1); } return b.geometry(); }
function logGeo(R) { const b = new Builder(), L = 4 + R() * 3; b.add(new THREE.CylinderGeometry(0.17, 0.22, L, 7), [1, 1, 1], 1, M4.compose(V3.set(0, 0.16, 0), Q.setFromEuler(E.set(0, 0, Math.PI / 2)), S3.set(1, 1, 1)), 0.02, R);
  for (let i = 0; i < 5; i++) { const x = (R() - 0.5) * L * 0.8; b.add(new THREE.CylinderGeometry(0.015, 0.04, 0.5 + R() * 0.8, 4), [1, 1, 1], 1, M4.compose(V3.set(x, 0.35, (R() - 0.5) * 0.2), Q.setFromEuler(E.set(R() - 0.5, 0, (R() - 0.5) * 1.6)), S3.set(1, 1, 1))); }
  b.add(new THREE.CircleGeometry(0.22, 7), [1.5, 1.3, 1.1], 1, M4.compose(V3.set(L / 2 + 0.001, 0.16, 0), Q.setFromEuler(E.set(0, Math.PI / 2, 0)), S3.set(1, 1, 1)));   // the pale cut end
  return b.geometry(); }
const blobTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.45, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();

// ------------------------------------------------------------------ the system
export function createNearField(scene, opts = {}) {
  const recs = WORLD.treeRecs || [], tileMat = WORLD.treeMat;
  const nearMat = foliageLight(swayMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }), 30, 1.1), 'near');
  distFade(nearMat, 'in', 'tree');
  const groundMat = distFade(foliageLight(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, side: THREE.DoubleSide }), 'ground'), 'in', 'ground');
  const saplingMat = distFade(foliageLight(swayMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }), 30, 1.1), 'sap'), 'in', 'ground');
  const mkIM = (geo, mat, max, shadow = true) => { const im = new THREE.InstancedMesh(geo, mat, max); im.count = 0; im.frustumCulled = false; im.castShadow = shadow; im.receiveShadow = true;
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); scene.add(im); return im; };

  // --- detailed trees
  const V = { con: [0, 1, 2].map((i) => spruce(101 + i * 17)), pine: [0, 1].map((i) => whitePine(301 + i * 29)), maple: [0, 1].map((i) => maple(501 + i * 31)), birch: [birch(707)] };
  const kinds = []; Object.entries(V).forEach(([k, list]) => list.forEach((g, i) => kinds.push({ key: k + i, kind: k, im: mkIM(g, nearMat, 1400) })));
  const kindFor = (r) => { if (r.kind === 'con') return r[5] < 0.3 && r[6] !== 4 ? 'pine' + (r[5] < 0.15 ? 0 : 1) : 'con' + (Math.floor(r[5] * 97) % 3);
    const yellow = r[8] && r[8][0] > 0.6 && r[8][1] > 0.35; return yellow && r[5] > 0.4 ? 'birch0' : 'maple' + (Math.floor(r[5] * 89) % 2); };
  const byKey = Object.fromEntries(kinds.map((k) => [k.key, k]));
  // spatial grid of tree records
  const GC = 40, grid = new Map(); recs.forEach((r) => { if (!r.im) return; const k = Math.floor(r[0] / GC) + ',' + Math.floor(r[2] / GC); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(r); });
  const around = (x, z, R2) => { const out = [], g0x = Math.floor((x - R2) / GC), g1x = Math.floor((x + R2) / GC), g0z = Math.floor((z - R2) / GC), g1z = Math.floor((z + R2) / GC);
    for (let gx = g0x; gx <= g1x; gx++) for (let gz = g0z; gz <= g1z; gz++) { const l = grid.get(gx + ',' + gz); if (l) for (const r of l) if ((r[0] - x) ** 2 + (r[2] - z) ** 2 < R2 * R2) out.push(r); } return out; };
  const nearestTree = (x, z) => { let best = 1e9; for (const r of around(x, z, 7)) best = Math.min(best, Math.hypot(r[0] - x, r[2] - z)); return best; };
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  let swapped = new Set(); const saved = new Map();
  const blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), distFade(new THREE.MeshBasicMaterial({ map: blobTex, color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 'alpha', 'ground'), 4000);
  blobs.count = 0; blobs.frustumCulled = false; blobs.renderOrder = 1; scene.add(blobs);

  // --- ground detail ring
  const R0 = seeded(9);
  const G = {
    duff: mkIM(decal(R0, 10, 1.3), groundMat, 1600, false), moss: mkIM(decal(R0, 9, 0.9), groundMat, 900, false),
    fern: mkIM(fernGeo(R0), groundMat, 1400), shrub: mkIM(shrubGeo(R0), groundMat, 700), sedge: mkIM(sedgeGeo(R0), groundMat, 1400, false),
    stick: mkIM(stickGeo(), groundMat, 900, false), cone: mkIM(coneGeo(), groundMat, 700, false), rock: mkIM(rockGeo(R0), groundMat, 500), stump: mkIM(stumpGeo(R0), groundMat, 120),
    root: mkIM(rootGeo(R0), groundMat, 500), log: mkIM(logGeo(R0), groundMat, 160), sapling: mkIM(spruce(909), saplingMat, 600),
  };
  blobs.receiveShadow = false;
  groundMat.polygonOffset = false;
  const CELL = 16, cells = new Map();
  const landY = (x, z) => (inPatch(x, z) ? fullHeight(x, z) : heightAt(x, z));
  function genCell(cx, cz) {
    const R = seeded((cx * 73856093) ^ (cz * 19349663)), items = [], x0 = cx * CELL, z0 = cz * CELL;
    const put = (type, x, z, s, rotY, col, tilt = 0, dy = 0) => { const y = landY(x, z); items.push([type, x, y + dy, z, s, rotY, col, tilt]); };
    const N = (k) => Math.floor(k + R());
    const tries = 64;
    for (let i = 0; i < tries; i++) {
      const x = x0 + R() * CELL, z = z0 + R() * CELL, sd = pondSD(x, z), d = -sd;
      if (d < 0.6) continue;                                                     // water
      if (inCampBox(x, z) && Math.hypot(x - CAMP.tent[0], z - CAMP.tent[1]) < CAMP.R) continue;   // the campsite is dressed by camp.js
      if (inIsleBox(x, z) && beachFactor(x, z) > 0.3 && d < 26) continue;      // keep the island beach open
      if (landY(x, z) < 0.1) continue;
      const n1 = fbm(x * 0.06 + 3, z * 0.06), n2 = fbm(x * 0.21, z * 0.21 + 7), tree = nearestTree(x, z), j = 0.82 + R() * 0.36, pick = R();
      if (d < 6) {                                                               // the water's edge: roots, rocks, sedge, moss and dark mud
        if (pick < 0.3) put('sedge', x, z, 0.7 + R() * 0.8, R() * 6.3, [0.62 * j, 0.55 * j, 0.3 * j]);
        else if (pick < 0.45) put('rock', x, z, 0.15 + R() * 0.45, R() * 6.3, n2 > 0.5 ? [0.16 * j, 0.2 * j, 0.1 * j] : [0.22 * j, 0.22 * j, 0.2 * j], (R() - 0.5) * 0.4, -0.06);
        else if (pick < 0.6) put('moss', x, z, 0.5 + R() * 0.6, R() * 6.3, [0.13 * j, 0.19 * j, 0.08 * j]);
        else if (pick < 0.75) put('duff', x, z, 0.8 + R() * 0.9, R() * 6.3, [0.2 * j, 0.15 * j, 0.1 * j]);   // wet dark mud
        else if (pick < 0.85 && tree < 6) put('root', x, z, 0.6 + R() * 0.6, R() * 6.3, [0.36 * j, 0.27 * j, 0.19 * j]);
        else if (pick < 0.92) put('stick', x, z, 0.6 + R() * 1.2, R() * 6.3, [0.62 * j, 0.6 * j, 0.55 * j]);   // bleached driftwood twigs
        continue;
      }
      // the forest floor
      if (pick < 0.32) put('duff', x, z, 0.9 + R() * 1.1, R() * 6.3, n1 > 0.55 ? [0.42 * j, 0.24 * j, 0.11 * j] : [0.3 * j, 0.24 * j, 0.13 * j]);
      else if (pick < 0.43) put('moss', x, z, 0.4 + R() * 0.6, R() * 6.3, [0.13 * j, 0.19 * j, 0.07 * j]);
      else if (pick < 0.55 && (n2 > 0.45 || tree < 4)) put('fern', x, z, 0.7 + R() * 0.8, R() * 6.3, R() < 0.55 ? [0.6 * j, 0.42 * j, 0.14 * j] : [0.32 * j, 0.42 * j, 0.15 * j]);
      else if (pick < 0.6 && n1 < 0.45) put('shrub', x, z, 0.7 + R() * 0.8, R() * 6.3, [[0.5, 0.12, 0.08], [0.32, 0.3, 0.12], [0.45, 0.28, 0.1]][Math.floor(R() * 3)].map((v) => v * j));
      else if (pick < 0.71) put('stick', x, z, 0.5 + R() * 1.4, R() * 6.3, [0.4 * j, 0.31 * j, 0.21 * j]);
      else if (pick < 0.76) put('cone', x, z, 0.9 + R() * 0.5, R() * 6.3, [0.36 * j, 0.24 * j, 0.11 * j]);
      else if (pick < 0.8) put('rock', x, z, 0.2 + R() * 0.7, R() * 6.3, R() < 0.6 ? [0.16 * j, 0.2 * j, 0.1 * j] : [0.22 * j, 0.22 * j, 0.2 * j], (R() - 0.5) * 0.3, -0.1);
      else if (pick < 0.84 && tree < 5) put('root', x, z, 0.6 + R() * 0.7, R() * 6.3, [0.34 * j, 0.26 * j, 0.18 * j]);
      else if (pick < 0.87 && tree > 3) put('sapling', x, z, 0.12 + R() * 0.3, R() * 6.3, R() < 0.2 ? [0.5, 0.36, 0.06] : [0.07 * j, 0.2 * j, 0.1 * j]);
      else if (pick < 0.885) put('stump', x, z, 0.8 + R() * 0.6, R() * 6.3, [0.62 * j, 0.55 * j, 0.48 * j]);
      else if (pick < 0.9 && tree > 2.5) put('log', x, z, 0.8 + R() * 0.4, R() * 6.3, [0.4 * j, 0.34 * j, 0.28 * j], (R() - 0.5) * 0.08, -0.05);
    }
    return items;
  }
  function rebuildGround(cx, cz, radius) {
    const want = new Set(), r = Math.ceil(radius / CELL);
    for (let i = -r; i <= r; i++) for (let k = -r; k <= r; k++) { if ((i * CELL) ** 2 + (k * CELL) ** 2 > (radius + CELL) ** 2) continue; const key = (cx + i) + ',' + (cz + k); want.add(key); if (!cells.has(key)) cells.set(key, genCell(cx + i, cz + k)); }
    for (const key of [...cells.keys()]) if (!want.has(key)) cells.delete(key);
    Object.values(G).forEach((im) => { im.count = 0; });
    let nb = blobs.userData.groundStart = blobs.count;
    for (const key of want) for (const it of cells.get(key) || []) {
      const [type, x, y, z, s, ry, col, tilt] = it, im = G[type]; if (!im || im.count >= im.instanceMatrix.count) continue;
      const sc = type === 'log' || type === 'root' || type === 'stick' ? S3.set(s, s, s) : type === 'duff' || type === 'moss' ? S3.set(s, 1, s * (0.6 + 0.4 * ((ry * 7) % 1))) : S3.set(s, s, s);
      M4.compose(V3.set(x, y + (type === 'duff' ? 0.015 : type === 'moss' ? 0.025 : 0), z), Q.setFromEuler(E.set(tilt, ry, tilt * 0.5)), sc); im.setMatrixAt(im.count, M4); COL.setRGB(col[0], col[1], col[2]); im.setColorAt(im.count, COL); im.count++;
      if ((type === 'rock' || type === 'stump' || type === 'sapling' || type === 'log') && nb < blobs.instanceMatrix.count) { const bs = type === 'log' ? s * 4 : type === 'sapling' ? s * 9 : s * 2.4; M4.compose(V3.set(x, y + 0.03, z), Q.setFromEuler(E.set(0, ry, 0)), S3.set(bs, 1, type === 'log' ? s * 1.1 : bs)); blobs.setMatrixAt(nb++, M4); }
    }
    blobs.count = nb;
    Object.values(G).forEach((im) => { im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; }); blobs.instanceMatrix.needsUpdate = true;
  }

  function rebuildTrees(x, z, radius) {
    // detailed twins exist out to the ring edge; the far tree is only hidden well inside it,
    // so across the outer band both draw and the shaders cross-dissolve them (no pop)
    const now = new Set(around(x, z, radius)), inner = radius - 38;
    const hide = new Set(); for (const r of now) if ((r[0] - x) ** 2 + (r[2] - z) ** 2 < inner * inner) hide.add(r);
    for (const r of swapped) if (!hide.has(r)) { r.im.setMatrixAt(r.j, saved.get(r)); r.im.instanceMatrix.needsUpdate = true; saved.delete(r); }
    kinds.forEach((k) => { k.im.count = 0; });
    let nb = 0; const m = new THREE.Matrix4();
    for (const r of now) {
      if (saved.has(r)) m.copy(saved.get(r)); else r.im.getMatrixAt(r.j, m);
      if (hide.has(r) && !saved.has(r)) { saved.set(r, m.clone()); r.im.setMatrixAt(r.j, ZERO); r.im.instanceMatrix.needsUpdate = true; }
      const k = byKey[kindFor(r)]; if (!k || k.im.count >= k.im.instanceMatrix.count) continue;
      k.im.setMatrixAt(k.im.count, m); COL.setRGB(r[8][0], r[8][1], r[8][2]); k.im.setColorAt(k.im.count, COL); k.im.count++;
      V3.setFromMatrixScale(m); const bs = 2.2 * Math.max(V3.x, 0.6); M4.compose(V3.set(r[0], r[1] + 0.33, r[2]), Q.identity(), S3.set(bs, 1, bs)); blobs.setMatrixAt(nb++, M4);
    }
    swapped = hide; blobs.count = nb;
    kinds.forEach((k) => { k.im.instanceMatrix.needsUpdate = true; k.im.instanceColor.needsUpdate = true; }); blobs.instanceMatrix.needsUpdate = true;
  }

  const S = { last: null, treeR: opts.treeR ?? 110, groundR: opts.groundR ?? 64, enabled: true };
  const syncFade = () => { NEAR_FADE.uTreeR.value = S.enabled ? S.treeR : 0; NEAR_FADE.uGroundR.value = S.enabled ? S.groundR : 0; }; syncFade();
  return {
    meshes: () => [...kinds.map((k) => k.im), ...Object.values(G)],
    setQuality(q) { S.treeR = q.nearTrees ?? 110; S.groundR = q.nearGround ?? 64; S.last = null; syncFade(); },
    update(pos) {
      if (!S.enabled) return;
      if (S.last && Math.hypot(pos.x - S.last.x, pos.z - S.last.z) < 7) return;
      S.last = { x: pos.x, z: pos.z };
      rebuildTrees(pos.x, pos.z, S.treeR);
      rebuildGround(Math.floor(pos.x / CELL), Math.floor(pos.z / CELL), S.groundR);
    },
    stats: () => ({ trees: kinds.reduce((a, k) => a + k.im.count, 0), ground: Object.fromEntries(Object.entries(G).map(([k, im]) => [k, im.count])), blobs: blobs.count }),
  };
}
