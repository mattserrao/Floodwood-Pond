import * as THREE from 'three';
import { MAP } from './mapdata.js';
import { WIND, GUST_GLSL } from './wind.js';
import { mergeGeometries } from '../lib/BufferGeometryUtils.js';

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function hash2(x, z) { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z); let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  return lerp(lerp(hash2(ix, iz), hash2(ix + 1, iz), fx), lerp(hash2(ix, iz + 1), hash2(ix + 1, iz + 1), fx), fz);
}
export function fbm(x, z, o = 4) { let s = 0, a = 0.5; for (let i = 0; i < o; i++) { s += a * vnoise(x, z); x *= 2.03; z *= 2.03; a *= 0.5; } return s; }
let seed = 20261028;
export const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// ---------- tree sizing: tall at the water's edge, shrinking inland to exaggerate depth ----------
const QS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const TREES = { mult: QS.has('trees') ? parseFloat(QS.get('trees')) : 3, falloff: QS.get('treefall') !== '0', legacy: QS.get('trees') === 'legacy' };
/** height factor for a tree d metres from the water */
export function treeHeight(d) {
  if (TREES.legacy || !(TREES.mult > 0)) return d > 450 ? 1.5 : 1;
  return TREES.mult * (TREES.falloff ? lerp(1, 0.42, sstep(20, 900, d)) : 1);
}
const treeWidth = (k) => Math.pow(k, 0.62); // taller trees stay slender

export const EXT = { minX: -1700, minZ: -1400, W: 3400, D: 2800, CELL: 10 };
EXT.NX = EXT.W / EXT.CELL + 1; EXT.NZ = EXT.D / EXT.CELL + 1;

// ---------- geometry helpers ----------
function ringSegs(ring, out) { for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; out.push(a[0], a[1], b[0], b[1]); } }
function pip(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function evenOdd(rings, x, z) { let inside = false; for (const r of rings) if (pip(r, x, z)) inside = !inside; return inside; }
// ---------- the southwest island: enlarged, tall, with a landing beach on its SW corner ----------
export const ISLE = (() => {
  let best = -1, bd = 1e9;
  MAP.pond.forEach((r, i) => { if (i === 0) return; const cx = r.reduce((a, p) => a + p[0], 0) / r.length, cz = r.reduce((a, p) => a + p[1], 0) / r.length, d = Math.hypot(cx + 599, cz - 306); if (d < bd) { bd = d; best = i; } });
  const r0 = MAP.pond[best], cx = r0.reduce((a, p) => a + p[0], 0) / r0.length, cz = r0.reduce((a, p) => a + p[1], 0) / r0.length;
  let ring = r0.map((p) => [cx + (p[0] - cx) * 1.6, cz + (p[1] - cz) * 1.6]);
  for (let it = 0; it < 2; it++) { // Chaikin smoothing for a more natural outline
    const o = []; for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; o.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); } ring = o;
  }
  ring = ring.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
  MAP.pond[best] = ring;
  // beach = the most south-westerly shore point (+z is south, -x is west)
  let bp = ring[0]; ring.forEach((p) => { if (-(p[0] - cx) + (p[1] - cz) > -(bp[0] - cx) + (bp[1] - cz)) bp = p; });
  const bl = Math.hypot(bp[0] - cx, bp[1] - cz);
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
  return { index: best, ring, cx, cz, beach: bp, bdx: (bp[0] - cx) / bl, bdz: (bp[1] - cz) / bl,
    box: { x0: Math.min(...xs) - 30, x1: Math.max(...xs) + 30, z0: Math.min(...zs) - 30, z1: Math.max(...zs) + 30 } };
})();
export const inIsleBox = (x, z) => x > ISLE.box.x0 && x < ISLE.box.x1 && z > ISLE.box.z0 && z < ISLE.box.z1;
/** 0..1: how much (x,z) belongs to the landing beach sector on the SW corner. */
export function beachFactor(x, z) {
  const ux = x - ISLE.cx, uz = z - ISLE.cz, r = Math.hypot(ux, uz) || 1;
  return sstep(0.72, 0.93, (ux * ISLE.bdx + uz * ISLE.bdz) / r) * (1 - sstep(20, 38, Math.hypot(x - ISLE.beach[0], z - ISLE.beach[1])));
}
function isleLandHeight(x, z, dd) {
  const cliff = Math.min(dd * 0.9, 5.5) + sstep(4, 40, dd) * 15 + fbm(x * 0.06, z * 0.06) * 3 * sstep(3, 14, dd);
  const beach = 0.2 + dd * 0.09 + sstep(10, 24, dd) * 3 + fbm(x * 0.2, z * 0.2) * 0.25;
  return lerp(cliff, Math.min(beach, cliff), beachFactor(x, z));
}
const pondSegsArr = []; MAP.pond.forEach((r) => ringSegs(r, pondSegsArr));
const otherSegsArr = []; MAP.others.forEach((o) => ringSegs(o.ring, otherSegsArr));
const pondSegs = new Float32Array(pondSegsArr);
const allSegs = new Float32Array([...pondSegsArr, ...otherSegsArr]);
const NQ = { x: 0, z: 0, creek: false };
function nearest(segs, x, z) {
  let best = 1e18, qx = 0, qz = 0;
  for (let i = 0; i < segs.length; i += 4) {
    const ax = segs[i], az = segs[i + 1], dx = segs[i + 2] - ax, dz = segs[i + 3] - az;
    const l2 = dx * dx + dz * dz; let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + t * dx, pz = az + t * dz, d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d2 < best) { best = d2; qx = px; qz = pz; }
  }
  NQ.x = qx; NQ.z = qz; return Math.sqrt(best);
}

// ---------- the SW creek: a narrow, rocky outlet from the pond's south-west tip ----------
export const CREEK = (() => {
  const outer = MAP.pond[0];
  let tip = outer[0]; outer.forEach((p) => { if (-p[0] + p[1] > -tip[0] + tip[1]) tip = p; });
  // start inside the pond, a little up the SW arm
  let sx = tip[0], sz = tip[1];
  for (let k = 0; k < 120; k++) { sx += 0.72; sz -= 0.69; if (evenOdd(MAP.pond, sx, sz) && nearest(pondSegs, sx, sz) > 9) break; }
  const pts = []; let x = sx, z = sz, s = 0; const base = Math.atan2(0.67, -0.74); // heading SW: x decreases (west), z increases (south)
  const L = 400, STEP = 8;
  while (s <= L) {
    const w = 6.2 + 1.1 * Math.sin(s / 29) - 1.2 * sstep(L * 0.6, L, s);
    pts.push([x, z, w, s]);
    const a = base + 0.42 * Math.sin(s / 47) + 0.22 * Math.sin(s / 19 + 1.3);
    x += Math.cos(a) * STEP; z += Math.sin(a) * STEP; s += STEP;
  }
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  const box = { x0: Math.min(...xs) - 45, x1: Math.max(...xs) + 45, z0: Math.min(...zs) - 45, z1: Math.max(...zs) + 45 };
  // rocks: bank boulders and a few in mid-stream, always leaving a channel
  const rocks = [];
  for (let i = 3; i < pts.length - 1; i++) {
    const [px, pz, w] = pts[i], [qx, qz] = pts[i + 1], l = Math.hypot(qx - px, qz - pz), nx = -(qz - pz) / l, nz = (qx - px) / l;
    const side = rnd() < 0.5 ? -1 : 1;
    if (rnd() < 0.8) { const r = 0.6 + rnd() * 0.9, o = side * (w - r * 0.6 - rnd() * 0.8); rocks.push({ x: px + nx * o, z: pz + nz * o, r, h: 0.4 + rnd() * 0.8 }); }
    if (rnd() < 0.3) { const r = 0.45 + rnd() * 0.4, o = -side * (0.8 + rnd() * 1.4); rocks.push({ x: px + nx * o + (qx - px) * 0.5, z: pz + nz * o + (qz - pz) * 0.5, r, h: 0.25 + rnd() * 0.4 }); }
  }
  return { pts, L, box, rocks, tip };
})();
const CQ = { x: 0, z: 0, s: 0 };
/** Signed distance to the creek bank (+ in the creek). Sets CQ to the nearest bank point and CQ.s to the distance along the creek. */
export function creekSD(x, z) {
  const b = CREEK.box; if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return -1e9;
  let best = 1e18, bw = 0, cx = 0, cz = 0, bs = 0; const P = CREEK.pts;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], c = P[i + 1], dx = c[0] - a[0], dz = c[1] - a[1], l2 = dx * dx + dz * dz;
    let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a[0] + t * dx, pz = a[1] + t * dz, d2 = (x - px) ** 2 + (z - pz) ** 2;
    if (d2 < best) { best = d2; cx = px; cz = pz; bw = lerp(a[2], c[2], t); bs = lerp(a[3], c[3], t); }
  }
  const d = Math.sqrt(best), ux = d > 1e-6 ? (x - cx) / d : 1, uz = d > 1e-6 ? (z - cz) / d : 0;
  CQ.x = cx + ux * bw; CQ.z = cz + uz * bw; CQ.s = bs;
  return bw - d;
}
export { CQ };
export const inCreekBox = (x, z) => x > CREEK.box.x0 && x < CREEK.box.x1 && z > CREEK.box.z0 && z < CREEK.box.z1;

/** Signed distance to Floodwood Pond shoreline (+ in water, - on land/islands). Sets NQ to the nearest shore point. */
export function pondSD(x, z) {
  const d = nearest(pondSegs, x, z), sd = evenOdd(MAP.pond, x, z) ? d : -d;
  const c = creekSD(x, z);
  if (c > sd) { NQ.x = CQ.x; NQ.z = CQ.z; NQ.creek = true; return c; }
  NQ.creek = false; return sd;
}
export { NQ };
export function inPond(x, z) { return evenOdd(MAP.pond, x, z) || creekSD(x, z) > 0; }

// ---------- terrain ----------
let SD, H;
function bil(arr, x, z) {
  let fx = (x - EXT.minX) / EXT.CELL, fz = (z - EXT.minZ) / EXT.CELL;
  fx = clamp(fx, 0, EXT.NX - 1.001); fz = clamp(fz, 0, EXT.NZ - 1.001);
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, i = iz * EXT.NX + ix;
  return lerp(lerp(arr[i], arr[i + 1], tx), lerp(arr[i + EXT.NX], arr[i + EXT.NX + 1], tx), tz);
}
// v0.6.2: the campsite - a fine ground patch around the tent with worn dirt, needle duff and a path to the water
export const CAMP = (() => {
  const L = MAP.launch; const d = nearest(pondSegs, L[0], L[1]); const qx = NQ.x, qz = NQ.z;
  const e = 4, gx = pondSD(qx + e, qz) - pondSD(qx - e, qz), gz = pondSD(qx, qz + e) - pondSD(qx, qz - e), gl = Math.hypot(gx, gz) || 1;
  const nx = gx / gl, nz = gz / gl, side = [nz, -nx];
  // v0.6.7: a 9 m launch dock runs from the bank out over the water; the canoe waits afloat along its far side
  const D0 = -2.6, DL = 9, DECK = 0.55, CB = 1.55, CS = 3.8;                   // dock start (m along n from the shoreline), length, deck height, canoe offset, canoe station
  const dock = { root: [qx + nx * D0, qz + nz * D0], end: [qx + nx * (D0 + DL), qz + nz * (D0 + DL)], len: DL, half: 0.9, deck: DECK };
  const start = [qx + nx * CS - side[0] * CB, qz + nz * CS - side[1] * CB];  // where the canoe waits (matches story/main)
  const tent = [qx - nx * 22 + side[0] * 4.5, qz - nz * 22 + side[1] * 4.5];  // same spot as before, up on the bank
  const R = 26;
  return { q: [qx, qz], tent, start, dock, walkEnd: dock.root, n: [nx, nz], side, R, box: { x0: tent[0] - R - 6, x1: tent[0] + R + 6, z0: tent[1] - R - 6, z1: tent[1] + R + 6 } };
})();
/** deck height if (x,z) is on the launch dock (with a little margin), else null */
export function onDock(x, z, m = 0) { const D = CAMP.dock, n = CAMP.n, dx = x - D.root[0], dz = z - D.root[1], a = dx * n[0] + dz * n[1], b = dx * CAMP.side[0] + dz * CAMP.side[1];
  return a > -m && a < D.len + m && Math.abs(b) < D.half + m ? D.deck : null; }
export const inCampBox = (x, z) => x > CAMP.box.x0 && x < CAMP.box.x1 && z > CAMP.box.z0 && z < CAMP.box.z1;
/** 0..1 how much (x,z) is on the worn path from the tent door to the canoe */
export function campPath(x, z) {
  const a = CAMP.tent, b = CAMP.walkEnd, abx = b[0] - a[0], abz = b[1] - a[1], l2 = abx * abx + abz * abz;
  const t = clamp(((x - a[0]) * abx + (z - a[1]) * abz) / l2, 0, 1), px = a[0] + abx * t, pz = a[1] + abz * t;
  const wob = 0.6 * Math.sin(t * 9) ; const d = Math.hypot(x - px, z - pz) + wob * 0.3;
  return 1 - sstep(0.7, 1.9, d);
}
export const inPatch = (x, z) => inIsleBox(x, z) || inCreekBox(x, z) || inCampBox(x, z);
export const heightAt = (x, z) => (inPatch(x, z) ? fullHeight(x, z) : bil(H, x, z));
export const gridSD = (x, z) => bil(SD, x, z);

function landHeight(d, x, z) {
  const bank = Math.min(d * 0.12, 1.2) + Math.min(d, 40) * 0.03;
  const k = sstep(18, 380, d);
  const hill = Math.max(fbm(x * 0.0017 + 3.1, z * 0.0017 + 7.7) - 0.34, 0);
  const bowl = sstep(450, 1550, Math.hypot(x * 0.9, z * 1.2)) * 85;
  return bank + k * (hill * 90 + 6 * fbm(x * 0.012, z * 0.012) + bowl * 0.6) + bowl * 0.4 * k;
}
function waterHeight(sd, x, z) {
  const shelf = inIsleBox(x, z) ? 1 - 0.65 * beachFactor(x, z) : 1; // shallow sandy shelf off the landing beach
  return -shelf * (Math.min(sd * 0.3, 2.8) + sstep(50, 260, sd) * 3.2 + fbm(x * 0.02, z * 0.02) * 0.6 * sstep(5, 40, sd));
}

/** Exact (non-gridded) terrain height; used for the detailed island patch. */
/** Shared terrain sampler: returns { h, sd, dd, water } for any point (sd > 0 in water). */
function sampleTerrain(x, z) {
  const d0 = nearest(allSegs, x, z), c = creekSD(x, z);
  const inPoly = evenOdd(MAP.pond, x, z) || MAP.others.some((o) => pip(o.ring, x, z));
  if (inPoly || c > 0) { const sd = inPoly ? Math.max(d0, c) : c; return { h: waterHeight(sd, x, z), sd, dd: 0, water: true }; }
  const dd = Math.min(d0, -c);
  let h = pip(ISLE.ring, x, z) ? isleLandHeight(x, z, dd) : landHeight(dd, x, z);
  if (inCampBox(x, z)) {
    const dt = Math.hypot(x - CAMP.tent[0], z - CAMP.tent[1]), k = 1 - sstep(CAMP.R - 8, CAMP.R, dt);
    const bumps = (fbm(x * 0.35 + 11, z * 0.35) - 0.5) * 0.5 + (fbm(x * 1.4, z * 1.4 + 3) - 0.5) * 0.12;
    const pad = 1 - sstep(1.8, 3.2, dt);                                          // flattened where the tent sits
    h += k * (bumps * (1 - pad * 0.85) - 0.08 * campPath(x, z) - 0.03 * pad);
  }
  return { h, sd: -dd, dd, water: false };
}
export function fullHeight(x, z) { return sampleTerrain(x, z).h; }
function terrainColor(x, z, h, dd, water, c) {
  if (inIsleBox(x, z) && (water || pip(ISLE.ring, x, z))) return isleColor(x, z, h, dd, c);
  if (!water && inCampBox(x, z)) { const k = 1 - sstep(CAMP.R - 8, CAMP.R, Math.hypot(x - CAMP.tent[0], z - CAMP.tent[1])); if (k > 0) { campColor(x, z, dd, c); return c; } }
  const n1 = fbm(x * 0.02, z * 0.02), n2 = fbm(x * 0.07 + 9, z * 0.07);
  if (water) c.setRGB(0.12 + 0.04 * n1, 0.11 + 0.04 * n1, 0.07 + 0.02 * n1);
  else if (dd < 4) c.setRGB(0.5 + 0.1 * n2, 0.43 + 0.08 * n2, 0.29);
  else if (dd < 26) { c.setRGB(0.26 + 0.08 * n2, 0.3 + 0.06 * n1, 0.12); if (n1 > 0.58) c.setRGB(0.42, 0.32, 0.12); }
  else {
    c.setRGB(0.1, 0.19, 0.08).lerp(new THREE.Color(0.24, 0.16, 0.08), sstep(0.38, 0.62, n1)).lerp(new THREE.Color(0.38, 0.28, 0.08), sstep(0.55, 0.75, n2) * 0.7);
    if (h > 55) c.lerp(new THREE.Color(0.28, 0.3, 0.26), sstep(55, 110, h) * 0.8);
  }
  return c;
}
function campColor(x, z, dd, c) {
  const dt = Math.hypot(x - CAMP.tent[0], z - CAMP.tent[1]), k = 1 - sstep(CAMP.R - 8, CAMP.R, dt);
  const n = fbm(x * 0.3, z * 0.3 + 7), f = fbm(x * 1.6 + 2, z * 1.6), path = campPath(x, z), pad = 1 - sstep(2, 4, dt);
  // v0.7.0 (photos): bare rust-orange white-pine duff, almost no undergrowth; a little moss only in the damp hollows
  const duff = new THREE.Color(0.36, 0.18, 0.08).lerp(new THREE.Color(0.5, 0.27, 0.12), f).lerp(new THREE.Color(0.3, 0.15, 0.07), sstep(0.6, 0.8, n) * 0.6);
  const moss = new THREE.Color(0.2, 0.25, 0.1); const dirt = new THREE.Color(0.4, 0.33, 0.23).lerp(new THREE.Color(0.47, 0.39, 0.27), f);
  const sand = new THREE.Color(0.5, 0.44, 0.31);
  c.copy(duff).lerp(moss, sstep(0.72, 0.85, n) * 0.35).lerp(dirt, Math.max(path, pad * 0.9) * 0.7).lerp(sand, 1 - sstep(2, 9, dd));
  // the base colour this patch blends back into at its edge
  const base = new THREE.Color(); const n1 = fbm(x * 0.02, z * 0.02), n2 = fbm(x * 0.07 + 9, z * 0.07);
  if (dd < 4) base.setRGB(0.5 + 0.1 * n2, 0.43 + 0.08 * n2, 0.29); else if (dd < 26) base.setRGB(0.26 + 0.08 * n2, 0.3 + 0.06 * n1, 0.12); else base.setRGB(0.1, 0.19, 0.08).lerp(new THREE.Color(0.24, 0.16, 0.08), sstep(0.38, 0.62, n1));
  c.lerp(base, 1 - k); return c;
}
function isleColor(x, z, h, dd, c) {
  const n = fbm(x * 0.15, z * 0.15), rock = fbm(x * 0.4 + 5, z * 0.4), bf = beachFactor(x, z);
  if (h < 0) { c.setRGB(0.16 + 0.12 * bf, 0.14 + 0.1 * bf, 0.08 + 0.06 * bf); return c; }
  if (bf > 0.35 && dd < 26) { c.setRGB(0.62 + 0.06 * n, 0.55 + 0.05 * n, 0.4); if (rock > 0.6) c.setRGB(0.42, 0.41, 0.38); return c; }
  if (dd < 9) { c.setRGB(0.36 + 0.05 * n, 0.35 + 0.04 * n, 0.32); if (rock < 0.45) c.setRGB(0.24, 0.24, 0.16); return c; } // granite ledges + lichen
  c.setRGB(0.15 + 0.08 * n, 0.14 + 0.05 * n, 0.07); return c; // needle duff
}
function buildPatch(scene, box, C = 2.5) {
  const { x0, x1, z0, z1 } = box, nx = Math.ceil((x1 - x0) / C) + 1, nz = Math.ceil((z1 - z0) / C) + 1;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), c = new THREE.Color();
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * C, z = z0 + j * C, k = j * nx + i, T = sampleTerrain(x, z), h = T.h;
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    terrainColor(x, z, h, T.dd, T.water, c); col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1; idx.push(a, d, b, b, d, e); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 })));
}

export function buildTerrain(scene) {
  const { NX, NZ, CELL, minX, minZ } = EXT;
  SD = new Float32Array(NX * NZ); H = new Float32Array(NX * NZ);
  const pos = new Float32Array(NX * NZ * 3), col = new Float32Array(NX * NZ * 3);
  const depth = new Uint8Array(NX * NZ);
  const c = new THREE.Color();
  for (let iz = 0; iz < NZ; iz++) {
    for (let ix = 0; ix < NX; ix++) {
      const i = iz * NX + ix, x = minX + ix * CELL, z = minZ + iz * CELL;
      const T = sampleTerrain(x, z), h = T.h; SD[i] = T.sd;
      H[i] = h; pos[i * 3] = x; pos[i * 3 + 1] = inPatch(x, z) ? Math.min(h, 0) - 2 : h; pos[i * 3 + 2] = z;
      depth[i] = T.water ? Math.round(clamp(-h / 8, 0, 1) * 255) : 0;
      terrainColor(x, z, h, T.dd, T.water, c);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
  }
  const idx = new Uint32Array((NX - 1) * (NZ - 1) * 6); let k = 0;
  for (let iz = 0; iz < NZ - 1; iz++) for (let ix = 0; ix < NX - 1; ix++) {
    const a = iz * NX + ix, b = a + 1, cc = a + NX, d = cc + 1;
    if ((ix + iz) & 1) { idx[k++] = a; idx[k++] = cc; idx[k++] = b; idx[k++] = b; idx[k++] = cc; idx[k++] = d; }
    else { idx[k++] = a; idx[k++] = cc; idx[k++] = d; idx[k++] = a; idx[k++] = d; idx[k++] = b; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }));
  scene.add(mesh);
  buildPatch(scene, ISLE.box); buildPatch(scene, CREEK.box); buildPatch(scene, CAMP.box, 0.5);
  // v0.6: a 'shelter' map for mist and wind lanes - 1 in bays and against shores, 0 far out on open water, 0 on land
  const shelter = new Uint8Array(NX * NZ);
  for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
    const i = iz * NX + ix, sd = SD[i]; if (sd <= 0) { shelter[i] = 0; continue; }
    // count land in a ring around the point (coarse): more land nearby = more sheltered
    let land = 0, n = 0; for (let a = 0; a < 12; a++) { const ang = (a / 12) * 6.283; for (const r of [6, 12, 20]) { const jx = ix + Math.round(Math.cos(ang) * r), jz = iz + Math.round(Math.sin(ang) * r); n++; if (jx < 0 || jz < 0 || jx >= NX || jz >= NZ || SD[jz * NX + jx] <= 0) land++; } }
    shelter[i] = Math.round(clamp(land / n * 1.6, 0, 1) * 255);
  }
  const shelterTex = new THREE.DataTexture(shelter, NX, NZ, THREE.RedFormat, THREE.UnsignedByteType);
  shelterTex.magFilter = shelterTex.minFilter = THREE.LinearFilter; shelterTex.needsUpdate = true; WORLD.shelterTex = shelterTex;
  const depthTex = new THREE.DataTexture(depth, NX, NZ, THREE.RedFormat, THREE.UnsignedByteType);
  depthTex.magFilter = depthTex.minFilter = THREE.LinearFilter; depthTex.needsUpdate = true;
  return { mesh, depthTex };
}

// ---------- ribbons for roads / trails / streams ----------
function ribbon(points, width, yOff, color, waterY) {
  const pts = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 8));
    for (let j = 0; j < n; j++) pts.push([lerp(a[0], b[0], j / n), lerp(a[1], b[1], j / n)]);
  }
  pts.push(points[points.length - 1]);
  if (pts.length < 2) return null;
  const pos = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(pts.length - 1, i + 1)];
    let dx = p1[0] - p0[0], dz = p1[1] - p0[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const nx = -dz * width / 2, nz = dx * width / 2, x = pts[i][0], z = pts[i][1];
    const y = waterY !== undefined ? waterY : Math.max(heightAt(x, z), 0.05) + yOff;
    pos.push(x + nx, y, z + nz, x - nx, y, z - nz);
    if (i < pts.length - 1) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true, side: THREE.DoubleSide }));
}

/** Split a path where it crosses the creek; returns dry runs plus bridge spans [a, b]. */
function splitAtCreek(points) {
  const pts = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
    for (let j = 0; j < n; j++) pts.push([lerp(a[0], b[0], j / n), lerp(a[1], b[1], j / n)]);
  }
  pts.push(points[points.length - 1]);
  const runs = [], spans = []; let cur = [], lastDry = null;
  for (const p of pts) {
    const wet = creekSD(p[0], p[1]) > -3;
    if (!wet) { if (!cur.length && lastDry && runs.length) spans.push([lastDry, p]); cur.push(p); lastDry = p; }
    else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return { runs, spans };
}
function bridge(g, a, b, width) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b5236, flatShading: true, roughness: 1 });
  const ya = Math.max(heightAt(a[0], a[1]), 0), yb = Math.max(heightAt(b[0], b[1]), 0), y = Math.max(ya, yb, 2.3) + 0.2;
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) + 3, ang = Math.atan2(dx, dz);
  const grp = new THREE.Group(); grp.position.set((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2); grp.rotation.y = ang; g.add(grp);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(width, 0.25, L), wood); grp.add(deck);
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, L), wood); rail.position.set(sx * width / 2, 0.9, 0); grp.add(rail);
    for (let k = -L / 2 + 0.5; k <= L / 2; k += 2.2) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.95, 0.14), wood); post.position.set(sx * width / 2, 0.45, k); grp.add(post); }
    for (const sz of [-1, 1]) { const pile = new THREE.Mesh(new THREE.BoxGeometry(0.35, y + 2, 0.35), wood); pile.position.set(sx * (width / 2 - 0.2), -(y + 2) / 2, sz * (L / 2 - 1)); grp.add(pile); }
  }
}
export function buildPaths(scene) {
  const g = new THREE.Group();
  const add = (list, width, yOff, colorFn) => list.forEach((r) => {
    const { runs, spans } = splitAtCreek(r.pts);
    runs.forEach((run) => { if (run.length > 1) { const m = ribbon(run, width, yOff, colorFn(r)); if (m) g.add(m); } });
    spans.forEach(([a, b]) => bridge(g, a, b, Math.max(width, 2.4)));
  });
  add(MAP.roads, 5, 0.2, () => 0x6e6046);
  add(MAP.trails, 1.6, 0.18, (r) => (/Rail/.test(r.name) ? 0x6b665a : 0x5a4a30));
  MAP.streams.forEach((r) => { const m = ribbon(r.pts, 3.2, 0, 0x1a3a40, 0.04); if (m) g.add(m); });
  scene.add(g); return g;
}

export function buildCreek(scene) {
  const rocks = CREEK.rocks;
  const im = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }), rocks.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  rocks.forEach((r, i) => {
    q.setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd() * 0.5));
    m4.compose(new THREE.Vector3(r.x, r.h - r.r * 0.75, r.z), q, new THREE.Vector3(r.r, r.r * 0.85, r.r * (0.9 + rnd() * 0.3))); im.setMatrixAt(i, m4);
    const gg = 0.3 + rnd() * 0.12, moss = rnd() < 0.4; c.setRGB(moss ? gg * 0.8 : gg, gg * (moss ? 1.05 : 0.98), gg * (moss ? 0.7 : 0.93)); im.setColorAt(i, c);
  });
  scene.add(im);
  // reeds and sedge tufts along both banks
  const tuft = new THREE.ConeGeometry(0.12, 1.4, 4); tuft.translate(0, 0.7, 0);
  const tufts = [];
  CREEK.pts.forEach(([x, z, w], i) => {
    const n = CREEK.pts[Math.min(i + 1, CREEK.pts.length - 1)], dx = n[0] - x, dz = n[1] - z, l = Math.hypot(dx, dz) || 1;
    for (let k = 0; k < 8; k++) { const side = k % 2 ? 1 : -1, o = side * (w - 0.5 + rnd() * 1.8), t = rnd(); tufts.push([x + dx * t - dz / l * o, z + dz * t + dx / l * o]); }
  });
  const tm = new THREE.InstancedMesh(tuft, new THREE.MeshStandardMaterial({ color: 0xa48a4a, flatShading: true }), tufts.length);
  tufts.forEach((p, i) => { m4.compose(new THREE.Vector3(p[0], Math.max(heightAt(p[0], p[1]), -0.2), p[1]), q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.4, rnd() * 6, (rnd() - 0.5) * 0.4)), new THREE.Vector3(1, 0.6 + rnd() * 0.9, 1)); tm.setMatrixAt(i, m4); });
  scene.add(tm);
  // v0.7.0 (photos 39-44): lush banks - a dense band of tall grass and ferns, and deadfall lying out across the amber water
  const grass = new THREE.ConeGeometry(0.05, 1.1, 3); grass.translate(0, 0.55, 0);
  const fern = (() => { const parts = []; for (let i = 0; i < 6; i++) { const f = new THREE.PlaneGeometry(0.14, 0.7, 1, 2); f.translate(0, 0.35, 0); f.rotateX(-0.9); f.rotateY((i / 6) * 6.283); parts.push(f.toNonIndexed()); }
    const P = []; parts.forEach((g) => { const a2 = g.attributes.position; for (let i = 0; i < a2.count; i++) P.push(a2.getX(i), a2.getY(i), a2.getZ(i)); }); const o = new THREE.BufferGeometry(); o.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); o.computeVertexNormals(); return o; })();
  const gr = [], fe = [];
  CREEK.pts.forEach(([x, z, w], i) => {
    const nx2 = CREEK.pts[Math.min(i + 1, CREEK.pts.length - 1)], dx = nx2[0] - x, dz = nx2[1] - z, l = Math.hypot(dx, dz) || 1;
    for (let k = 0; k < 26; k++) { const side = k % 2 ? 1 : -1, o = side * (w + 0.2 + rnd() * 5), t = rnd(), px = x + dx * t - dz / l * o, pz = z + dz * t + dx / l * o; if (creekSD(px, pz) > -0.3) continue; (rnd() < 0.7 ? gr : fe).push([px, pz]); }
  });
  const gm2 = new THREE.InstancedMesh(grass, new THREE.MeshStandardMaterial({ color: 0x8a8a3c, flatShading: true }), gr.length), cc = new THREE.Color();
  gr.forEach((p, i) => { m4.compose(new THREE.Vector3(p[0], heightAt(p[0], p[1]) - 0.05, p[1]), q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.5, rnd() * 6, (rnd() - 0.5) * 0.5)), new THREE.Vector3(1, 0.7 + rnd() * 0.8, 1)); gm2.setMatrixAt(i, m4); const j = 0.75 + rnd() * 0.4; gm2.setColorAt(i, cc.setRGB(0.75 * j, 0.68 * j, 0.36 * j)); });
  scene.add(gm2);
  const fm2 = new THREE.InstancedMesh(fern, new THREE.MeshStandardMaterial({ flatShading: true, side: THREE.DoubleSide }), fe.length);
  fe.forEach((p, i) => { m4.compose(new THREE.Vector3(p[0], heightAt(p[0], p[1]) - 0.03, p[1]), q.setFromEuler(new THREE.Euler(0, rnd() * 6, 0)), new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + rnd() * 0.8)); fm2.setMatrixAt(i, m4); const j = 0.8 + rnd() * 0.4; fm2.setColorAt(i, cc.setRGB((rnd() < 0.6 ? 0.55 : 0.3) * j, (rnd() < 0.6 ? 0.4 : 0.36) * j, 0.12 * j)); });
  scene.add(fm2);
  // deadfall: bare trunks lying from the bank out over the water, branches poking up
  const bark = new THREE.MeshStandardMaterial({ color: 0x7c7064, flatShading: true, roughness: 1 });
  for (let k = 0; k < 9; k++) {
    const i = Math.floor((0.12 + 0.8 * (k + rnd() * 0.6) / 9) * (CREEK.pts.length - 1)), [x, z, w] = CREEK.pts[i], nx2 = CREEK.pts[Math.min(i + 1, CREEK.pts.length - 1)], dx = nx2[0] - x, dz = nx2[1] - z, l = Math.hypot(dx, dz) || 1;
    const side = k % 2 ? 1 : -1, bx = x - dz / l * side * (w + 2.5), bz = z + dx / l * side * (w + 2.5), len = 2.5 + w * 0.5 + rnd() * 0.6;
    const g = new THREE.Group(); g.position.set(bx, Math.max(heightAt(bx, bz), 0.1) + 0.1, bz); g.rotation.y = Math.atan2(-(-dz / l * side), -(dx / l * side)) + (rnd() - 0.5) * 0.7; scene.add(g);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, len, 6), bark); t.rotation.x = Math.PI / 2 - 0.06; t.position.z = len / 2; g.add(t);
    for (let b2 = 0; b2 < 6; b2++) { const br = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.04, 0.5 + rnd() * 1.1, 4), bark); br.position.set((rnd() - 0.5) * 0.2, 0.2, 0.8 + rnd() * (len - 1)); br.rotation.set(rnd() - 0.5, 0, (rnd() < 0.5 ? -1 : 1) * (0.3 + rnd() * 0.8)); g.add(br); }
  }
}

// ---------- vegetation ----------
function mergeGeoms(parts) {
  const P = [], C = [];
  for (const { geo, color, y = 0, rotX = 0 } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo; g.translate(0, y, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      P.push(p.getX(i), p.getY(i), p.getZ(i));
      const shade = 0.55 + 0.45 * clamp(p.getY(i) / 14, 0, 1);
      C.push(color[0] * shade, color[1] * shade, color[2] * shade);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); out.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); out.computeVertexNormals();
  return out;
}
const cone = (r, h, seg = 6) => new THREE.ConeGeometry(r, h, seg, 1, true);


// ---------- v0.4: wind sway (GPU only) and tiled instancing (so the forest can be culled) ----------
export const SWAY = { uTime: { value: 0 } };
/** Bend instanced vegetation with the shared gust field. hScale: height (m) at which the bend reaches amp metres. */
export function swayMaterial(mat, hScale = 30, amp = 1) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, WIND.uniforms, SWAY);
    sh.vertexShader = 'uniform float uTime;\n' + GUST_GLSL + '\n' + sh.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        vec3 ib = instanceMatrix[3].xyz;
        float hy = max(mvPosition.y - ib.y, 0.) / ${hScale.toFixed(1)};
        float gu = gustAt(ib.xz), ph = dot(ib.xz, vec2(.37, .61));
        float bend = hy * hy * ${amp.toFixed(2)};
        float osc = .55 * sin(uTime * 1.3 + ph) + .3 * sin(uTime * 2.9 + ph * 1.7);
        mvPosition.xz += uWindDir * bend * (gu * 1.1 + osc * (.12 + .5 * gu)) + vec2(-uWindDir.y, uWindDir.x) * bend * .15 * sin(uTime * 2.2 + ph * 2.3) * gu;
      #endif
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  mat.customProgramCacheKey = () => 'sway' + hScale + '_' + amp;
  return mat;
}
export const TILES = [];
const TILE = 400;
/** Split one big instance list into ~400 m tiles; each tile is its own InstancedMesh with a bounding sphere.
 *  lodGeo: a much simpler stand-in drawn instead when the tile is far away (shares the instance buffers). */
function tiled(scene, geo, mat, list, write, tag, lodGeo, cardGeo, cardMat) {
  const buckets = new Map();
  list.forEach((r, i) => { const k = Math.floor((r[0] - EXT.minX) / TILE) + ',' + Math.floor((r[2] - EXT.minZ) / TILE); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(i); });
  const out = [];
  buckets.forEach((idx) => {
    const im = new THREE.InstancedMesh(geo, mat, idx.length);
    idx.forEach((li, j) => write(im, j, list[li]));
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere(); im.userData.full = idx.length; im.userData.tag = tag;
    scene.add(im); out.push(im); TILES.push(im);
    if (lodGeo) {
      const lod = new THREE.InstancedMesh(lodGeo, mat, idx.length);
      lod.instanceMatrix = im.instanceMatrix; lod.instanceColor = im.instanceColor; lod.boundingSphere = im.boundingSphere; lod.visible = false;
      im.userData.lod = lod; scene.add(lod);
      if (cardGeo) { // v0.6 third level: a crossed pair of flat cards, unlit, for the far treeline
        const card = new THREE.InstancedMesh(cardGeo, cardMat, idx.length);
        card.instanceMatrix = im.instanceMatrix; card.instanceColor = im.instanceColor; card.boundingSphere = im.boundingSphere; card.visible = false;
        im.userData.card = card; scene.add(card);
      }
    }
  });
  return out;
}
export const CULL = { lodDist: 520, cardDist: 1100 };
/** hide whole tiles beyond what the fog lets you see (frustum culling does the rest); far tree tiles switch to the LOD */
export function cullTiles(camPos, visDist, litterDist, reedDist = visDist) {
  for (const im of TILES) {
    const s = im.boundingSphere, d = Math.hypot(s.center.x - camPos.x, s.center.z - camPos.z) - s.radius, tag = im.userData.tag;
    const vis = d < (tag === 'litter' ? litterDist : tag === 'reed' ? reedDist : visDist), lod = im.userData.lod;
    if (lod) { const card = im.userData.card, near = d < CULL.lodDist, mid = d < CULL.cardDist || !card; im.visible = vis && near; lod.visible = vis && !near && mid; if (card) card.visible = vis && !mid; } else im.visible = vis;
  }
}
/** scale how many litter clusters are drawn (instances are shuffled, so any prefix is an even sample) */
export function setLitterScale(k) { for (const im of TILES) if (im.userData.tag === 'litter') im.count = Math.floor(im.userData.full * k); }

export function buildTrees(scene) {
  const white = [1, 1, 1];
  const conifer = mergeGeoms([
    { geo: new THREE.CylinderGeometry(0.22, 0.32, 2, 4), color: [0.22, 0.14, 0.08], y: 1 },
    { geo: cone(2.4, 4.2), color: white, y: 3.3 }, { geo: cone(1.9, 3.8), color: white, y: 5.6 },
    { geo: cone(1.3, 3.6), color: white, y: 7.8 }, { geo: cone(0.7, 2.6), color: white, y: 9.6 },
  ]);
  const broad = mergeGeoms([
    { geo: new THREE.CylinderGeometry(0.25, 0.4, 5, 5), color: [0.28, 0.22, 0.16], y: 2.5 },
    { geo: new THREE.IcosahedronGeometry(3.0, 0), color: white, y: 6.4 },
    { geo: new THREE.IcosahedronGeometry(2.1, 0), color: white, y: 8.6 },
  ]);
  // far-away stand-ins: one cone / one blob, ~1/6 of the triangles
  const cardOf = (w, h, y) => { const a = new THREE.PlaneGeometry(w, h); a.translate(0, y, 0); const b = a.clone(); b.rotateY(Math.PI / 2); return mergeGeoms([{ geo: a, color: white, y: 0 }, { geo: b, color: white, y: 0 }]); };
  const coniferCard = cardOf(4.6, 11.5, 5.75), broadCard = cardOf(6.2, 9, 5.2);
  const cardMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const coniferLod = mergeGeoms([{ geo: new THREE.ConeGeometry(2.3, 10.5, 5, 1, true), color: white, y: 5.6 }]);
  const broadLod = mergeGeoms([{ geo: new THREE.CylinderGeometry(0.3, 0.4, 5, 3, 1, true), color: [0.28, 0.22, 0.16], y: 2.5 }, { geo: new THREE.OctahedronGeometry(3.1, 0), color: white, y: 7.0 }]);
  const mat = swayMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }), 30, 1.1);
  const mask = new Uint8Array(EXT.NX * EXT.NZ);
  const markPts = (pts, r) => pts.forEach((p) => {
    const ix = Math.round((p[0] - EXT.minX) / EXT.CELL), iz = Math.round((p[1] - EXT.minZ) / EXT.CELL);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) { const i = (iz + b) * EXT.NX + ix + a; if (i >= 0 && i < mask.length) mask[i] = 1; }
  });
  const densify = (pts) => { const o = []; for (let i = 0; i < pts.length - 1; i++) { const n = Math.ceil(Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) / 5); for (let j = 0; j < n; j++) o.push([lerp(pts[i][0], pts[i + 1][0], j / n), lerp(pts[i][1], pts[i + 1][1], j / n)]); } return o; };
  MAP.roads.forEach((r) => markPts(densify(r.pts), 1)); MAP.trails.forEach((r) => markPts(densify(r.pts), 0));

  const conAt = [], broadAt = [];
  const conCols = [[0.05, 0.17, 0.09], [0.07, 0.2, 0.1], [0.06, 0.15, 0.1], [0.09, 0.22, 0.11], [0.5, 0.36, 0.05]]; // last = golden tamarack
  const broadCols = [[0.62, 0.2, 0.03], [0.5, 0.06, 0.03], [0.72, 0.46, 0.05], [0.14, 0.26, 0.07], [0.35, 0.16, 0.05], [0.7, 0.3, 0.04]];
  const STEP = 13;
  for (let x = EXT.minX + 8; x < EXT.minX + EXT.W - 8; x += STEP) {
    for (let z = EXT.minZ + 8; z < EXT.minZ + EXT.D - 8; z += STEP) {
      const px = x + (rnd() - 0.5) * STEP * 0.9, pz = z + (rnd() - 0.5) * STEP * 0.9;
      const sd = bil(SD, px, pz), d = -sd;
      if (d < 5 || inIsleBox(px, pz)) continue;
      const mi = Math.round((pz - EXT.minZ) / EXT.CELL) * EXT.NX + Math.round((px - EXT.minX) / EXT.CELL);
      if (mask[mi]) continue;
      const dens = d < 450 ? 0.62 : 0.14; // forest hugs the water; hills are sparser (and cheaper)
      if (rnd() > dens * (d < 26 ? 0.5 : 1)) continue;
      const h = inCreekBox(px, pz) ? fullHeight(px, pz) : bil(H, px, pz), k = treeHeight(d), s = 0.75 + rnd() * 0.85;
      const isBroad = d > 26 && rnd() < 0.2 + 0.1 * fbm(px * 0.004, pz * 0.004);
      const rec = [px, h - 0.3, pz, s, rnd() * 6.28, rnd(), 0, k];
      (isBroad ? broadAt : conAt).push(rec);
      if (d < 26 && !isBroad) rec[6] = 4; // shoreline: more tamarack
    }
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), Y = new THREE.Vector3(0, 1, 0), P3 = new THREE.Vector3(), S3 = new THREE.Vector3();
  const mk = (geo, list, cols, tamarack, tag, lodGeo) => {
    list.forEach((r) => {
      let ci = Math.floor(r[5] * cols.length);
      if (tamarack) ci = r[6] === 4 ? 4 : r[5] < 0.1 ? 4 : Math.floor(r[5] * 4 / 0.9) % 4;
      const base = cols[Math.min(ci, cols.length - 1)], j = 0.88 + rnd() * 0.24; r[8] = [base[0] * j, base[1] * j, base[2] * j]; r[9] = ci;
    });
    return tiled(scene, geo, mat, list, (im, i, r) => {
      q.setFromAxisAngle(Y, r[4]); const wk = treeWidth(r[7]);
      m.compose(P3.set(r[0], r[1], r[2]), q, S3.set(r[3] * wk * (0.85 + r[5] * 0.3), r[3] * r[7], r[3] * wk * (0.85 + r[5] * 0.3)));
      im.setMatrixAt(i, m); im.setColorAt(i, c.setRGB(r[8][0], r[8][1], r[8][2]));
    }, tag, lodGeo, tag === 'tree' ? (geo === conifer ? coniferCard : broadCard) : null, cardMat);
  };
  mk(conifer, conAt, conCols, true, 'tree', coniferLod); mk(broad, broadAt, broadCols, false, 'tree', broadLod);
  // maples near the water drop leaves when a gust passes (see leaves.js)
  const maples = broadAt.filter((r) => -bil(SD, r[0], r[2]) < 90 && r[9] !== 3).map((r) => ({ x: r[0], z: r[2], y: r[1] + 6.6 * r[3] * r[7], r: 2.6 * r[3] * treeWidth(r[7]), col: r[8] }));

  // Reeds & cattails along the shoreline (golden in autumn)
  const reedGeo = new THREE.ConeGeometry(0.1, 1.9, 4); reedGeo.translate(0, 0.95, 0);
  const reedPts = [];
  for (let i = 0; i < pondSegs.length; i += 4) {
    const ax = pondSegs[i], az = pondSegs[i + 1], bx = pondSegs[i + 2], bz = pondSegs[i + 3], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 3.5));
    for (let j = 0; j < n; j++) {
      const t = rnd(), x = lerp(ax, bx, t), z = lerp(az, bz, t), nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (let k = 0; k < 5; k++) { const o = (rnd() - 0.5) * 5, px = x + nx * o + rnd() * 1.2, pz = z + nz * o + rnd() * 1.2; const sd = pondSD(px, pz); if (sd > -2 && sd < 7 && rnd() < 0.5 && (!inIsleBox(px, pz) || beachFactor(px, pz) < 0.2)) reedPts.push([px, pz]); }
    }
  }
  const m4 = new THREE.Matrix4(), e = new THREE.Euler();
  const reedMat = swayMaterial(new THREE.MeshStandardMaterial({ color: 0xb59a52, flatShading: true, roughness: 1 }), 1.9, 0.35);
  tiled(scene, reedGeo, reedMat, reedPts.map((p) => [p[0], 0, p[1]]), (im, i, p) => { const s = 0.6 + rnd() * 0.9; e.set((rnd() - 0.5) * 0.35, rnd() * 6, (rnd() - 0.5) * 0.35); m4.compose(P3.set(p[0], 0, p[2]), q.setFromEuler(e), S3.set(1, s, 1)); im.setMatrixAt(i, m4); }, 'reed');

  // Lily pads in the shallows (late-season: olive and brown)
  const padGeo = new THREE.CircleGeometry(0.55, 7); padGeo.rotateX(-Math.PI / 2);
  const pads = []; let guard = 0;
  while (pads.length < 420 && guard++ < 40000) {
    const x = lerp(-1150, 1150, rnd()), z = lerp(-800, 800, rnd()), sd = pondSD(x, z);
    if (sd > 4 && sd < 42 && fbm(x * 0.03, z * 0.03) > 0.5) pads.push([x, z]);
  }
  const padMesh = new THREE.InstancedMesh(padGeo, new THREE.MeshStandardMaterial({ color: 0x5b6b2a, roughness: 0.8, side: THREE.DoubleSide }), pads.length);
  const pc = new THREE.Color();
  pads.forEach((p, i) => { const s = 0.7 + rnd() * 0.9; m4.compose(new THREE.Vector3(p[0], 0.045, p[1]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6), new THREE.Vector3(s, 1, s)); padMesh.setMatrixAt(i, m4); pc.setHSL(0.17 + rnd() * 0.08, 0.5, 0.2 + rnd() * 0.12); padMesh.setColorAt(i, pc); });
  scene.add(padMesh); WORLD.pads = padMesh;
  const litter = buildLitter(scene);
  WORLD.maples = maples;
  WORLD.treePos = [...conAt, ...broadAt].filter((r) => Math.hypot(r[0] - CAMP.tent[0], r[2] - CAMP.tent[1]) < CAMP.R + 10).map((r) => [r[0], r[2]]);
  return { trees: conAt.length + broadAt.length, reeds: reedPts.length, pads: pads.length, litter, tiles: TILES.length };
}


export const WORLD = {};
export const LEAF_COLS = [[0.62, 0.16, 0.04], [0.74, 0.32, 0.05], [0.78, 0.55, 0.12], [0.5, 0.1, 0.05], [0.42, 0.28, 0.12], [0.6, 0.42, 0.1]];
/** a small flat leaf (diamond), lying in the xz plane */
export function leafGeometry(size = 1) {
  const g = new THREE.BufferGeometry(), a = 0.5 * size, b = 0.24 * size;
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, a, b, 0.02, 0, 0, 0, -a * 0.8, 0, 0, a, 0, 0, -a * 0.8, -b, 0.02, 0], 3));
  g.computeVertexNormals(); return g;
}
// ---------- leaf litter: autumn leaves on the banks and the island beach, close to the water only ----------
function buildLitter(scene) {
  // one cluster = a few leaves at odd angles
  const parts = [];
  for (let k = 0; k < 4; k++) { const g = leafGeometry(0.32 + rnd() * 0.12); g.rotateY(rnd() * 6.28); g.rotateX((rnd() - 0.5) * 0.4); g.translate((rnd() - 0.5) * 0.7, 0.01 * k, (rnd() - 0.5) * 0.7); parts.push(g); }
  const P = []; parts.forEach((g) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) P.push(p.getX(i), p.getY(i), p.getZ(i)); });
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.computeVertexNormals();
  const pts = [];
  const scatter = (segs, onIsle) => {
    for (let i = 0; i < segs.length; i += 4) {
      const ax = segs[i], az = segs[i + 1], bx = segs[i + 2], bz = segs[i + 3], L = Math.hypot(bx - ax, bz - az); if (L < 1e-3) continue;
      const n = Math.max(1, Math.round(L / 0.55));
      for (let j = 0; j < n; j++) {
        const t = rnd(), x = lerp(ax, bx, t), z = lerp(az, bz, t), nx = -(bz - az) / L, nz = (bx - ax) / L, o = (rnd() - 0.5) * 30;
        const px = x + nx * o, pz = z + nz * o, sd = pondSD(px, pz);
        if (sd > -1.2 || sd < -16) continue;
        if (!onIsle && inIsleBox(px, pz)) continue;
        if (rnd() > 0.85 - 0.04 * -sd) continue;
        pts.push([px, 0, pz]);
      }
    }
  };
  scatter(pondSegs, false);
  // the island: scattered thinner, with a drift of leaves on the beach sand
  const isl = []; ringSegs(ISLE.ring, isl); scatter(isl, true);
  for (let k = 0; k < 160; k++) { const px = ISLE.beach[0] - ISLE.bdx * (2 + rnd() * 16) + (rnd() - 0.5) * 24, pz = ISLE.beach[1] - ISLE.bdz * (2 + rnd() * 16) + (rnd() - 0.5) * 24; if (pondSD(px, pz) < -1) pts.push([px, 0, pz]); }
  // shuffle so any prefix is an even sample (quality tiers draw a fraction)
  for (let i = pts.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = pts[i]; pts[i] = pts[j]; pts[j] = t; }
  const mat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1, side: THREE.DoubleSide });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color(), V = new THREE.Vector3(), S = new THREE.Vector3();
  tiled(scene, geo, mat, pts, (im, i, p) => {
    const y = heightAt(p[0], p[2]) + 0.04, s = 0.8 + rnd() * 0.9;
    m4.compose(V.set(p[0], y, p[2]), q.setFromEuler(e.set((rnd() - 0.5) * 0.25, rnd() * 6.28, (rnd() - 0.5) * 0.25)), S.set(s, 1, s)); im.setMatrixAt(i, m4);
    const b = LEAF_COLS[Math.floor(rnd() * LEAF_COLS.length)], j = 0.55 + rnd() * 0.35; im.setColorAt(i, c.setRGB(b[0] * j, b[1] * j, b[2] * j));
  }, 'litter');
  return pts.length;
}

// ---------- far mountains ring (St. Regis Mtn & friends, stylised) ----------
export function buildMountains(scene) {
  const g = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mats = [0x1d3a33, 0x23443a, 0x2a4a3c].map((c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 1 }));
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rnd() * 0.15, r = 2600 + rnd() * 1300, w = 500 + rnd() * 700, hh = 220 + rnd() * 420;
    const m = new THREE.Mesh(geo, mats[i % 3]); m.scale.set(w, hh, w * (0.7 + rnd() * 0.5));
    m.position.set(Math.cos(a) * r * 1.15, hh * 0.25 - 40, Math.sin(a) * r); m.rotation.y = rnd() * 6; g.add(m);
  }
  // v0.7.0 (photos 1, 19-21): one distinct rounded peak standing behind the far shore, seen across the pond from camp
  { const ring = MAP.pond[0]; let cx = 0, cz = 0; ring.forEach((p) => { cx += p[0]; cz += p[1]; }); cx /= ring.length; cz /= ring.length;
    let dx = cx - CAMP.q[0], dz = cz - CAMP.q[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const px = cx + dx * 2300 + dz * 300, pz = cz + dz * 2300 - dx * 300, peakMat = new THREE.MeshStandardMaterial({ color: 0x24403a, flatShading: true, roughness: 1 });
    const peak = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), peakMat); peak.scale.set(820, 360, 700); peak.position.set(px, -60, pz); peak.rotation.y = Math.atan2(dx, dz); g.add(peak);
    const sh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), peakMat); sh.scale.set(700, 250, 600); sh.position.set(px + dz * 650, -40, pz - dx * 650); g.add(sh);
    WORLD.peak = { x: px, z: pz }; }
  scene.add(g); return g;
}

// ---------- campsites, tents, dock ----------
export function buildCamps(scene) {
  const tents = new THREE.Group(), glows = [];
  const tentCols = [0xc4561c, 0x2f5f8a, 0x7a8a3a, 0xb8923a];
  const tex = glowTexture();
  const mats = MAP.camps.filter((p) => pondSD(p[0], p[1]) < -1);
  mats.forEach((p, i) => {
    const h = Math.max(heightAt(p[0], p[1]), 0.3);
    if (i % 2 === 0) {
      const t = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.4, 4), new THREE.MeshStandardMaterial({ color: tentCols[i % 4], flatShading: true, roughness: 0.9 }));
      t.position.set(p[0] + 2, h + 0.65, p[1] + 1); t.rotation.y = i; tents.add(t);
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffa95a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
    s.scale.setScalar(i % 3 === 0 ? 14 : 8); s.position.set(p[0], h + 0.9, p[1]); tents.add(s); glows.push({ s, ph: rnd() * 10, big: i % 3 === 0 });
  });
  scene.add(tents);
  return { glows };
}
export function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t;
}

/** v0.6.7: the launch dock (Blender model, merged per material so it costs a handful of draw calls); +Z of the model runs out over the water */
export function buildDock(scene, model) {
  const D = CAMP.dock, g = new THREE.Group();
  g.position.set(D.root[0], D.deck, D.root[1]); g.rotation.y = Math.atan2(CAMP.n[0], CAMP.n[1]);
  if (model) {
    model.updateMatrixWorld(true); const by = new Map();
    model.traverse((o) => { if (!o.isMesh) return; const k = o.material.name || o.material.uuid; if (!by.has(k)) by.set(k, { m: o.material, gs: [] }); const ge = o.geometry.clone(); ge.applyMatrix4(o.matrixWorld); for (const a of Object.keys(ge.attributes)) if (a !== 'position' && a !== 'normal') ge.deleteAttribute(a); by.get(k).gs.push(ge.index ? ge.toNonIndexed() : ge); });
    for (const { m, gs } of by.values()) { const mesh = new THREE.Mesh(mergeGeometries(gs), m); m.color.multiplyScalar(0.8); g.add(mesh); }
  } else {
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b5236, flatShading: true, roughness: 1 });
    for (let z = 0.1; z < D.len; z += 0.2) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.045, 0.17), wood); b.position.set(0, -0.02, z); g.add(b); }
    for (const z of [0.45, 3.3, 6.15, 8.85]) for (const x of [-0.98, 0.98]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 3.6, 7), wood); p.position.set(x, -1.6, z); g.add(p); }
  }
  scene.add(g); return g;
}

// ---------- island vegetation, boulders and the sword tree ----------
export function buildIsland(scene) {
  const SPR = [0.06, 0.18, 0.1], PIN = [0.1, 0.24, 0.13], white = [1, 1, 1], mat = swayMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }), 30, 1.1);
  const spruce = mergeGeoms([
    { geo: new THREE.CylinderGeometry(0.22, 0.32, 2, 5), color: [0.22, 0.14, 0.08], y: 1 },
    { geo: cone(2.4, 4.2), color: SPR, y: 3.3 }, { geo: cone(1.9, 3.8), color: SPR, y: 5.6 },
    { geo: cone(1.3, 3.6), color: SPR, y: 7.8 }, { geo: cone(0.7, 2.6), color: SPR, y: 9.6 },
  ]);
  // Eastern white pine: tall bare trunk, a few flat, windswept tiers up top
  const tier = (r, h, y, ox, oz) => { const g = new THREE.CylinderGeometry(r * 0.35, r, h, 7, 1); g.translate(ox, 0, oz); return { geo: g, color: PIN, y }; };
  const pine = mergeGeoms([
    { geo: new THREE.CylinderGeometry(0.2, 0.42, 9, 6), color: [0.3, 0.22, 0.15], y: 4.5 },
    tier(2.6, 1.3, 7.6, 0.6, 0), tier(2.2, 1.2, 9.4, -0.5, 0.4), tier(2.4, 1.2, 11.2, 0.4, -0.3), tier(1.4, 1.2, 12.8, 0, 0.2),
  ]);
  const inIsle = (x, z) => pip(ISLE.ring, x, z);
  const dist = (x, z) => nearest(allSegs, x, z);
  // sword tree spot: walk inland from the beach until ~13 m from the water
  let sx = ISLE.beach[0], sz = ISLE.beach[1];
  for (let k = 0; k < 80 && !(inIsle(sx, sz) && dist(sx, sz) > 13); k++) { sx -= ISLE.bdx; sz -= ISLE.bdz; }
  const swordTree = { x: sx, z: sz };

  const tall = [], scrub = [], rocks = [];
  const { x0, x1, z0, z1 } = ISLE.box;
  for (let x = x0; x < x1; x += 6.5) for (let z = z0; z < z1; z += 6.5) {
    const px = x + (rnd() - 0.5) * 5, pz = z + (rnd() - 0.5) * 5;
    if (!inIsle(px, pz)) continue;
    const dd = dist(px, pz), bf = beachFactor(px, pz);
    if (dd < 7 || bf > 0.3 && dd < 24) continue;
    if (Math.hypot(px - swordTree.x, pz - swordTree.z) < 9) continue;
    if (rnd() < 0.85) tall.push([px, fullHeight(px, pz) - 0.3, pz, 1.45 + rnd() * 0.75, rnd() * 6.28, rnd() < 0.38]);
  }
  for (let x = x0; x < x1; x += 2.1) for (let z = z0; z < z1; z += 2.1) {
    const px = x + (rnd() - 0.5) * 2, pz = z + (rnd() - 0.5) * 2;
    if (!inIsle(px, pz)) continue;
    const dd = dist(px, pz), bf = beachFactor(px, pz);
    if (bf > 0.35 && dd < 20) { if (dd > 15 && rnd() < 0.5) scrub.push([px, pz, dd]); continue; } // keep the sand open
    if (dd > 0.6 && dd < 11 && rnd() < 0.75) scrub.push([px, pz, dd]);
    else if (dd >= 11 && rnd() < 0.12) scrub.push([px, pz, dd]);
  }
  // boulders: granite along the shoreline and scattered on the beach
  for (let i = 0; i < ISLE.ring.length; i += 2) {
    const p = ISLE.ring[i]; if (rnd() < 0.45) rocks.push([p[0] + (rnd() - 0.5) * 4, p[1] + (rnd() - 0.5) * 4, 0.5 + rnd() * 1.1]);
  }
  for (let i = 0; i < 9; i++) rocks.push([ISLE.beach[0] - ISLE.bdx * rnd() * 16 + (rnd() - 0.5) * 22, ISLE.beach[1] - ISLE.bdz * rnd() * 16 + (rnd() - 0.5) * 22, 0.25 + rnd() * 0.5]);

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  const place = (geo, list, colorFn, material = mat) => {
    const im = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((r, i) => { const [pos, rot, scl] = r; q.setFromEuler(rot); m4.compose(pos, q, scl); im.setMatrixAt(i, m4); im.setColorAt(i, colorFn(i)); });
    if (im.instanceColor) im.instanceColor.needsUpdate = true; scene.add(im); return im;
  };
  const E = (y) => new THREE.Euler(0, y, 0), V = (x, y, z) => new THREE.Vector3(x, y, z);
  const tallPine = tall.filter((t) => t[5]), tallSpruce = tall.filter((t) => !t[5]);
  const ik = TREES.legacy ? 1 : TREES.mult, iw = treeWidth(ik);
  place(pine, tallPine.map((t) => [V(t[0], t[1], t[2]), E(t[4]), V(t[3] * 0.9 * iw, t[3] * 1.05 * ik, t[3] * 0.9 * iw)]), () => { const j = 0.85 + rnd() * 0.3; return c.setRGB(j, j, j); });
  place(spruce, tallSpruce.map((t) => [V(t[0], t[1], t[2]), E(t[4]), V(t[3] * 0.85 * iw, t[3] * ik, t[3] * 0.85 * iw)]), () => { const j = 0.85 + rnd() * 0.3; return c.setRGB(j, j, j); });
  const shrubGeo = new THREE.IcosahedronGeometry(1, 0); shrubGeo.scale(1.25, 0.62, 1.25); shrubGeo.translate(0, 0.35, 0);
  const shrubCols = [[0.46, 0.1, 0.05], [0.3, 0.24, 0.09], [0.2, 0.24, 0.09], [0.1, 0.19, 0.08], [0.55, 0.22, 0.06]];
  place(shrubGeo, scrub.map((s) => { const k = 0.45 + rnd() * 0.85; return [V(s[0], fullHeight(s[0], s[1]) - 0.15, s[1]), E(rnd() * 6), V(k * (0.8 + rnd() * 0.5), k, k * (0.8 + rnd() * 0.5))]; }),
    () => { const b = shrubCols[Math.floor(rnd() * shrubCols.length)], j = 0.85 + rnd() * 0.3; return c.setRGB(b[0] * j, b[1] * j, b[2] * j); },
    new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 }));
  place(new THREE.DodecahedronGeometry(1, 0), rocks.map((r) => [V(r[0], Math.max(fullHeight(r[0], r[1]), -0.6) - r[2] * 0.35, r[1]), new THREE.Euler(rnd(), rnd() * 6, rnd()), V(r[2] * (1 + rnd() * 0.6), r[2] * 0.7, r[2] * (1 + rnd() * 0.5))]),
    () => { const g = 0.36 + rnd() * 0.12; return c.setRGB(g, g * 0.98, g * 0.93); }, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }));

  // --- the sword tree: an old white pine with a katana driven into its trunk ~3 m (10 ft) up, facing the beach
  const gy = fullHeight(swordTree.x, swordTree.z);
  const tree = new THREE.Group(); tree.position.set(swordTree.x, gy - 0.3, swordTree.z); scene.add(tree);
  const bark = new THREE.MeshStandardMaterial({ color: 0xa08a74, flatShading: true, roughness: 1 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.6, 15, 7), bark); trunk.position.y = 7.5; tree.add(trunk);
  const needles = new THREE.MeshStandardMaterial({ color: 0x1d3a22, flatShading: true, roughness: 1 });
  [[3.2, 1.6, 11.2, 0.9, 0.2], [2.7, 1.4, 13.2, -0.8, 0.5], [3.0, 1.4, 15.0, 0.5, -0.6], [1.8, 1.4, 16.8, 0, 0.1]].forEach(([r, h, y, ox, oz]) => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r, h, 7), needles); t.position.set(ox, y, oz); tree.add(t);
  });
  [[5.5, 0.9], [7.4, 2.6], [9.2, 4.4]].forEach(([y, a]) => { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 1.4, 5), bark); b.position.set(Math.cos(a) * 0.6, y, Math.sin(a) * 0.6); b.rotation.set(0, -a, Math.PI / 2.4); tree.add(b); });
  const sword = makeKatana();
  const trunkR = lerp(0.6, 0.34, 3.3 / 15);
  // stuck into the side of the trunk, so it shows in profile from the beach
  const tx = -ISLE.bdz, tz = ISLE.bdx;
  sword.position.set(tx * (trunkR - 0.24), 3.35, tz * (trunkR - 0.24)); // ~3 m (10 ft) above the ground
  sword.rotation.y = Math.atan2(-tz, tx);
  tree.add(sword);
  { const saya = new THREE.Group(), lac = new THREE.MeshStandardMaterial({ color: 0x0c0b0c, roughness: 0.35, metalness: 0.2 });   // black lacquered scabbard leaning on the roots, red cord
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.95, 6), lac); body.position.y = 0.47; saya.add(body);
    const cord = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 4, 8), new THREE.MeshStandardMaterial({ color: 0xb01c1c, roughness: 0.8 })); cord.position.y = 0.78; cord.rotation.x = 1.2; saya.add(cord);
    saya.position.set(-tz * 0.75 + tx * 0.2, 0.25, tx * 0.75 + tz * 0.2); saya.rotation.set(0.35, 0, 0.25); saya.scale.setScalar(1.3); tree.add(saya); }
  return { swordTree, beach: ISLE.beach, counts: { tall: tall.length, scrub: scrub.length, rocks: rocks.length } };
}

function makeKatana() {
  // v0.7.0 (photo 0): red-wrapped hilt with dark diamonds showing through, an ornate gold guard, gold collar and pommel.
  // Built along +x: the tip (x = 0) is buried in the trunk, the handle sticks out.
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xd4dae2, metalness: 0.15, roughness: 0.28, emissive: 0x1c1f24 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc89a34, metalness: 0.7, roughness: 0.3, emissive: 0x2a1c06 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb01c1c, roughness: 0.75, emissive: 0x200404 }), dark = new THREE.MeshStandardMaterial({ color: 0x141214, roughness: 0.8 });
  const shape = new THREE.Shape(); const L = 0.72, Wd = 0.032, curve = (t) => 0.018 * t * t; // gentle sori
  shape.moveTo(0, curve(0) + 0.006);
  for (let i = 1; i <= 12; i++) { const t = i / 12; shape.lineTo(t * L, curve(1 - t) + (i === 12 ? Wd : Wd * Math.min(1, 0.4 + t * 3))); }
  shape.lineTo(L, 0); for (let i = 11; i >= 0; i--) { const t = i / 12; shape.lineTo(t * L, curve(1 - t) - (i === 0 ? -0.006 : 0)); }
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.007, bevelEnabled: false }), steel); blade.position.set(0, -0.016, -0.0035); g.add(blade);
  const habaki = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.016), gold); habaki.position.set(L + 0.012, 0.002, 0); g.add(habaki);
  // ornate guard: a gold disc with a scalloped rim
  const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.009, 14), gold); tsuba.rotation.z = Math.PI / 2; tsuba.position.set(L + 0.03, 0.002, 0); g.add(tsuba);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, b = new THREE.Mesh(new THREE.SphereGeometry(0.011, 5, 4), gold); b.position.set(L + 0.03, 0.002 + Math.cos(a) * 0.05, Math.sin(a) * 0.05); g.add(b); }
  const tsuka = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.032, 0.024), dark); tsuka.position.set(L + 0.165, 0.002, 0); g.add(tsuka);
  for (let i = 0; i < 9; i++) { for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.036, 0.008), red); w.position.set(L + 0.05 + i * 0.026, 0.002, s * 0.012); w.rotation.y = s * 0.0; w.rotation.z = s * 0.55; g.add(w); } }   // crossing red cord, diamonds of dark between
  const kashira = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.038, 0.03), gold); kashira.position.set(L + 0.302, 0.002, 0); g.add(kashira);
  const tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.012, 0.12, 4), red); tassel.position.set(L + 0.31, -0.06, 0); g.add(tassel);
  g.scale.setScalar(1.3);
  return g;
}
