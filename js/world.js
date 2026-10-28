import * as THREE from 'three';
import { MAP } from './mapdata.js';

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
const pondSegsArr = []; MAP.pond.forEach((r) => ringSegs(r, pondSegsArr));
const otherSegsArr = []; MAP.others.forEach((o) => ringSegs(o.ring, otherSegsArr));
const pondSegs = new Float32Array(pondSegsArr);
const allSegs = new Float32Array([...pondSegsArr, ...otherSegsArr]);
const NQ = { x: 0, z: 0 };
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
/** Signed distance to Floodwood Pond shoreline (+ in water, - on land/islands). Sets NQ to the nearest shore point. */
export function pondSD(x, z) { const d = nearest(pondSegs, x, z); return evenOdd(MAP.pond, x, z) ? d : -d; }
export { NQ };
export function inPond(x, z) { return evenOdd(MAP.pond, x, z); }

// ---------- terrain ----------
let SD, H;
function bil(arr, x, z) {
  let fx = (x - EXT.minX) / EXT.CELL, fz = (z - EXT.minZ) / EXT.CELL;
  fx = clamp(fx, 0, EXT.NX - 1.001); fz = clamp(fz, 0, EXT.NZ - 1.001);
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, i = iz * EXT.NX + ix;
  return lerp(lerp(arr[i], arr[i + 1], tx), lerp(arr[i + EXT.NX], arr[i + EXT.NX + 1], tx), tz);
}
export const heightAt = (x, z) => bil(H, x, z);
export const gridSD = (x, z) => bil(SD, x, z);

function landHeight(d, x, z) {
  const bank = Math.min(d * 0.12, 1.2) + Math.min(d, 40) * 0.03;
  const k = sstep(18, 380, d);
  const hill = Math.max(fbm(x * 0.0017 + 3.1, z * 0.0017 + 7.7) - 0.34, 0);
  const bowl = sstep(450, 1550, Math.hypot(x * 0.9, z * 1.2)) * 85;
  return bank + k * (hill * 90 + 6 * fbm(x * 0.012, z * 0.012) + bowl * 0.6) + bowl * 0.4 * k;
}
function waterHeight(sd, x, z) {
  return -(Math.min(sd * 0.3, 2.8) + sstep(50, 260, sd) * 3.2 + fbm(x * 0.02, z * 0.02) * 0.6 * sstep(5, 40, sd));
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
      const dd = nearest(allSegs, x, z);
      const water = evenOdd(MAP.pond, x, z) || MAP.others.some((o) => pip(o.ring, x, z));
      const sd = water ? dd : -dd; SD[i] = sd;
      let h;
      if (water) h = waterHeight(sd, x, z); else h = landHeight(dd, x, z);
      H[i] = h; pos[i * 3] = x; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z;
      depth[i] = water ? Math.round(clamp(-h / 8, 0, 1) * 255) : 0;
      // colours
      const n1 = fbm(x * 0.02, z * 0.02), n2 = fbm(x * 0.07 + 9, z * 0.07);
      if (water) {
        c.setRGB(0.12 + 0.04 * n1, 0.11 + 0.04 * n1, 0.07 + 0.02 * n1);
      } else if (dd < 4) {
        c.setRGB(0.5 + 0.1 * n2, 0.43 + 0.08 * n2, 0.29);
      } else if (dd < 26) {
        c.setRGB(0.26 + 0.08 * n2, 0.3 + 0.06 * n1, 0.12); // sedge & marsh
        if (n1 > 0.58) c.setRGB(0.42, 0.32, 0.12);          // golden tamarack litter
      } else {
        const green = new THREE.Color(0.1, 0.19, 0.08), brown = new THREE.Color(0.24, 0.16, 0.08), gold = new THREE.Color(0.38, 0.28, 0.08);
        c.copy(green).lerp(brown, sstep(0.38, 0.62, n1)).lerp(gold, sstep(0.55, 0.75, n2) * 0.7);
        if (h > 55) c.lerp(new THREE.Color(0.28, 0.3, 0.26), sstep(55, 110, h) * 0.8);
      }
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

export function buildPaths(scene) {
  const g = new THREE.Group();
  MAP.roads.forEach((r) => { const m = ribbon(r.pts, 5, 0.2, 0x6e6046); if (m) g.add(m); });
  MAP.trails.forEach((r) => { const m = ribbon(r.pts, 1.6, 0.18, /Rail/.test(r.name) ? 0x6b665a : 0x5a4a30); if (m) g.add(m); });
  MAP.streams.forEach((r) => { const m = ribbon(r.pts, 3.2, 0, 0x1a3a40, 0.04); if (m) g.add(m); });
  scene.add(g); return g;
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
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
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
      if (d < 5) continue;
      const mi = Math.round((pz - EXT.minZ) / EXT.CELL) * EXT.NX + Math.round((px - EXT.minX) / EXT.CELL);
      if (mask[mi]) continue;
      const dens = d < 450 ? 0.62 : 0.14; // forest hugs the water; hills are sparser (and cheaper)
      if (rnd() > dens * (d < 26 ? 0.5 : 1)) continue;
      const h = bil(H, px, pz), far = d > 450 ? 1.5 : 1, s = (0.75 + rnd() * 0.85) * far;
      const isBroad = d > 26 && rnd() < 0.2 + 0.1 * fbm(px * 0.004, pz * 0.004);
      const rec = [px, h - 0.3, pz, s, rnd() * 6.28, rnd()];
      (isBroad ? broadAt : conAt).push(rec);
      if (d < 26 && !isBroad) rec[6] = 4; // shoreline: more tamarack
    }
  }
  const mk = (geo, list, cols, tamarack) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    list.forEach((r, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r[4]);
      m.compose(new THREE.Vector3(r[0], r[1], r[2]), q, new THREE.Vector3(r[3] * (0.85 + r[5] * 0.3), r[3], r[3] * (0.85 + r[5] * 0.3)));
      im.setMatrixAt(i, m);
      let ci = Math.floor(r[5] * cols.length);
      if (tamarack) ci = r[6] === 4 ? 4 : r[5] < 0.1 ? 4 : Math.floor(r[5] * 4 / 0.9) % 4;
      const base = cols[Math.min(ci, cols.length - 1)], j = 0.88 + rnd() * 0.24;
      c.setRGB(base[0] * j, base[1] * j, base[2] * j); im.setColorAt(i, c);
    });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.frustumCulled = false; scene.add(im); return im;
  };
  mk(conifer, conAt, conCols, true); mk(broad, broadAt, broadCols, false);

  // Reeds & cattails along the shoreline (golden in autumn)
  const reedGeo = new THREE.ConeGeometry(0.1, 1.9, 4); reedGeo.translate(0, 0.95, 0);
  const reedPts = [];
  for (let i = 0; i < pondSegs.length; i += 4) {
    const ax = pondSegs[i], az = pondSegs[i + 1], bx = pondSegs[i + 2], bz = pondSegs[i + 3], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 3.5));
    for (let j = 0; j < n; j++) {
      const t = rnd(), x = lerp(ax, bx, t), z = lerp(az, bz, t), nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (let k = 0; k < 5; k++) { const o = (rnd() - 0.5) * 5, px = x + nx * o + rnd() * 1.2, pz = z + nz * o + rnd() * 1.2; const sd = pondSD(px, pz); if (sd > -2 && sd < 7 && rnd() < 0.5) reedPts.push([px, pz]); }
    }
  }
  const reeds = new THREE.InstancedMesh(reedGeo, new THREE.MeshStandardMaterial({ color: 0xb59a52, flatShading: true, roughness: 1 }), reedPts.length);
  const m4 = new THREE.Matrix4(), e = new THREE.Euler();
  reedPts.forEach((p, i) => { const s = 0.6 + rnd() * 0.9; e.set((rnd() - 0.5) * 0.35, rnd() * 6, (rnd() - 0.5) * 0.35); m4.compose(new THREE.Vector3(p[0], 0, p[1]), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(1, s, 1)); reeds.setMatrixAt(i, m4); });
  reeds.frustumCulled = false; scene.add(reeds);

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
  scene.add(padMesh);
  return { trees: conAt.length + broadAt.length, reeds: reedPts.length, pads: pads.length };
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

export function buildDock(scene, p, dirX, dirZ) {
  const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0x6b5236, flatShading: true, roughness: 1 });
  for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.45), wood); b.position.set(0, 0.12, -1.2 + i * 0.52); g.add(b); }
  for (const s of [-1, 1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 3.1), wood); rail.position.set(s * 1.1, 0.04, 0.2); g.add(rail); }
  g.position.set(p[0], Math.max(heightAt(p[0], p[1]), 0.1), p[1]); g.rotation.y = Math.atan2(dirX, dirZ); scene.add(g);
}
