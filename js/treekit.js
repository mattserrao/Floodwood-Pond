// v0.15.0: the tree kit, ported from bikefree main (js/world/toolbox/vegetation/upstate-trees.js, the conifer builder of
// packs/northern-rockies.js and core/model-builder.js). Every tree is grown as a skeleton (the EZ-Tree / three.js
// TreeGenerator way): a trunk of curved, tapered tube sections, limbs spread up it at the golden angle and splayed
// out, each much thinner than its parent, pulled toward the light; leaves hang in clusters of crossed cards at the
// branch ends, with normals spherized from the crown's centre (so the crown shades as one volume) and a darker inside.
// Conifers are tiers of branches: a cone whose rim zigzags (tips out, notches in) and droops, a darker underside.
// Broadleaves come in variants by how far they've turned (green / turning / turned): Floodwood is peak foliage.
// Species: the St. Regis mix - sugar and red maple, paper birch, beech; red spruce, balsam fir, hemlock, white pine
// and tamarack (gold). The kit is only ever photographed (treeengine.js): no tree is drawn as a 3D model.
//
//   const kit = makeKit()  -> { entries: [{ key, sp, v, wood, leaves }], leafTexture }
import * as THREE from 'three';

// ------------------------------------------------------------------ model builder (bikefree core/model-builder.js)
let SMOOTH = false;
function withSmooth(on, fn) { const was = SMOOTH; SMOOTH = !!on; try { return fn(); } finally { SMOOTH = was; } }
class Builder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.prt = []; this.part = 0; this.anyPart = false; }
  /** tag what follows as a surface kind (aTree: 0 foliage, 1 bark, 3 plated bark, 4 white bark, 7 deadwood, 8 broadleaf) */
  as(part) { this.part = part; if (part) this.anyPart = true; return this; }
  add(geometry, matrix, color, jitter = 0, rand = Math.random) {
    const smooth = SMOOTH && (geometry.userData.sphere || !!geometry.index);
    if (smooth && geometry.userData.sphere) {
      const p = geometry.attributes.position, n = new Float32Array(p.count * 3), v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); n.set([v.x, v.y, v.z], i * 3); }
      geometry.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    }
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.applyMatrix4(matrix); if (!smooth) g.computeVertexNormals();
    const p = g.attributes.position.array, n = g.attributes.normal.array, c = new THREE.Color(color);
    for (let i = 0; i < p.length; i += 9) {
      const j = rand(), k = SMOOTH ? 1 : 1 + (j - .5) * jitter;
      for (let v = 0; v < 3; v++) {
        this.pos.push(p[i + v * 3], p[i + v * 3 + 1], p[i + v * 3 + 2]);
        this.nor.push(n[i + v * 3], n[i + v * 3 + 1], n[i + v * 3 + 2]);
        this.col.push(c.r * k, c.g * k, c.b * k); this.prt.push(this.part);
      }
    }
    g.dispose(); if (g !== geometry) geometry.dispose();
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aTree', new THREE.Float32BufferAttribute(this.prt, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
const M = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const cyl = (rTop, rBot, h, seg) => new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, true).translate(0, h / 2, 0);
const cone = (r, h, seg) => new THREE.ConeGeometry(r, h, seg, 1, true).translate(0, h / 2, 0);
const blob = (detail) => { const g = new THREE.IcosahedronGeometry(1, detail); g.userData.sphere = true; return g; };
/** seeded random (bikefree core/random.js) */
function randomSequence(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const LEAF = 0, BARK = 1, PLATED = 3, WHITE = 4, DEAD = 7, SHRUB = 8;
const Y = new THREE.Vector3(0, 1, 0);
const dirOf = (az, el) => new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
const mixHex = (a, b, t) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
function limb(b, p, dir, len, r0, r1, seg, color) {
  const q = new THREE.Quaternion().setFromUnitVectors(Y, dir);
  b.add(cyl(r1, r0, len, seg), new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(1, 1, 1)), color);
}

// ------------------------------------------------------------------ conifers (bikefree packs/northern-rockies.js)
/** a tier of branches: a cone whose rim zigzags (tips out, notches in) and droops at the tips */
function whorl(r, h, seg, droop, jag, rand) {
  const n = seg * 2, pos = [0, h, 0], idx = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + (rand() - .5) * .2, tip = i % 2 === 0;
    const rr = r * (tip ? 1 + (rand() - .5) * .22 : 1 - jag * (.8 + rand() * .4));
    const y = tip ? -droop * r * (.6 + rand() * .6) : -droop * r * .15 + h * .08;
    pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
  }
  for (let i = 0; i < n; i++) idx.push(0, 1 + ((i + 1) % n), 1 + i);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** the tier's shaded underside (seen from the water, low down: the dark inside of the tree) */
function underside(r, droop, seg) {
  const n = seg * 2, pos = [0, -droop * r * .25, 0], idx = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, rr = r * (i % 2 ? .78 : .98); pos.push(Math.cos(a) * rr, -droop * r * (i % 2 ? .2 : .85), Math.sin(a) * rr); }
  for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + ((i + 1) % n));
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** dead lower limbs: thin grey stubs on the bare trunk */
function stubs(b, rand, n, y0, y1, len, r0 = .12) {
  b.as(DEAD);
  for (let k = 0; k < n; k++) { const y = y0 + (y1 - y0) * rand(), a = rand() * 6.28, l = len * (.5 + rand() * .7); b.add(cyl(.015, .04, l, 3), M(Math.cos(a) * r0, y, Math.sin(a) * r0, 1, 1, 1, -a, 0, 1.35 + (rand() - .5) * .5), '#8c857a'); }
}
/** a conifer of tiers. o: H, R, colors, trunk, droop, jag, crown (where foliage starts, 0-1), top: leader | nod | broken */
function conifer(seed, o) {
  const rand = randomSequence(seed), b = new Builder(), H = o.H, R = o.R;
  b.as(o.bark || BARK).add(cyl(o.trunkTop ?? .1, o.trunkBase ?? .34, H * (o.trunkH ?? .45), 7), M(), o.trunk);
  const crown = o.crown ?? .06;
  if (o.stubs) stubs(b, rand, o.stubs, H * .03, H * crown + 1, R * .45, (o.trunkBase ?? .34) * .8);
  b.as(LEAF);
  const layers = o.layers ?? 9, seg = o.seg ?? 7, top = o.top === 'broken' ? .84 : 1;
  for (let k = 0; k < layers; k++) {
    const t = k / layers; if (t > top - .05) break;
    const r = R * (1 - t * .86) * (.86 + rand() * .28), h = H * (1 - crown) * (1.55 / layers);
    const y = H * (crown + t * (1 - crown) * .9), lean = o.lopsided ? r * .18 : 0, col = o.colors[k % o.colors.length];
    b.add(whorl(r, h, seg, o.droop ?? .22, o.jag ?? .35, rand), M(lean, y, (rand() - .5) * r * .08, 1, 1, 1, rand() * 6.28), col);
    if (k < (o.under ?? 4)) b.add(underside(r * .96, o.droop ?? .22, seg), M(lean, y + .02, 0, 1, 1, 1, rand() * 6.28), shade(col, .55));
  }
  if (o.top === 'broken') b.as(DEAD).add(cyl(.03, .1, H * .14, 4), M(0, H * .84, 0, 1, 1, 1, 0, .08, .05), '#9a948a');
  else if (o.top === 'nod') b.add(cone(R * .16, H * .07, 5), M(R * .08, H * .955, 0, 1, 1, 1, 0, 0, -.5), o.colors[1]);
  else b.add(cone(R * .1, H * .08, 5), M(0, H * .94, 0), o.colors[1]);
  return b.build();
}
/** tamarack (eastern larch): tall and open, short soft tufts along a long trunk; gold in October (bikefree larch) */
function tamarack(v) {
  const rand = randomSequence(1701 + v), b = new Builder(), H = 20 + v * 3, R = 2.4;
  const leaf = ['#d2a53a', '#ddb54a', '#c3922e'];
  b.as(PLATED).add(cyl(.14, .4, H * .92, 6), M(), '#7a5034');
  stubs(b, rand, 6, H * .1, H * .34, 1.1, .32);
  b.as(LEAF);
  // (Floodwood: more, softer tiers than bikefree's larch - seen side-on from the water nine thin discs read as a pagoda)
  for (let k = 0; k < 16; k++) { const t = k / 16, r = R * (1 - t * .82) * (.75 + rand() * .5); b.add(whorl(r, H * .09, 7, .32, .42, rand), M((rand() - .5) * .6, H * (.22 + t * .72), (rand() - .5) * .6, 1, 1, 1, rand() * 6.28), leaf[k % 3]); }
  return b.build();
}
/** eastern white pine: a tall straight trunk, long near-horizontal limbs in whorls carrying flat ragged sprays (bikefree) */
function whitePine(v) {
  const rand = randomSequence(5101 + v), b = new Builder(), H = 30 + v * 3, lean = rand() * 6.28;
  b.as(PLATED); limb(b, new THREE.Vector3(), dirOf(lean, Math.PI / 2 - .02), H * .97, .55, .12, 7, '#584536');
  stubs(b, rand, 6, H * .1, H * .4, 1.2, .45);
  b.as(LEAF);
  const whorls = 9;
  for (let t = 0; t < whorls; t++) {
    const y = H * (.38 + .58 * t / whorls) + (rand() - .5), arms = 4 + (rand() < .4 ? 1 : 0);
    for (let a = 0; a < arms; a++) {
      if (rand() < .15) continue;
      const az = lean * .4 + a / arms * 6.28 + (rand() - .5) * 1.1 + t * .9, reach = (7 - t * .55) * (.6 + rand() * .55);
      if (reach < 1) continue;
      b.as(PLATED); limb(b, new THREE.Vector3(0, y - .3, 0), dirOf(az, .1 + rand() * .12), reach, .18, .05, 4, '#584536'); b.as(LEAF);
      for (let k = 0; k < 3; k++) {
        const f = .45 + k * .25, len = reach * (.5 - k * .07), x = Math.cos(az) * reach * f, z = Math.sin(az) * reach * f;
        b.add(whorl(len, .55, 7, .2, .42, rand), M(x, y + .1 + (rand() - .5) * .5 - k * .15, z, 1, 1, .7, -az + (rand() - .5) * .5), ['#2b4734', '#33523b', '#3d5f43'][k], 0, rand);
        b.add(underside(len * .95, .2, 7), M(x, y + .08 - k * .15, z, 1, 1, .7, -az), '#1f3528', 0, rand);
      }
    }
  }
  b.add(blob(0), M(Math.cos(lean) * .7, H * .99, Math.sin(lean) * .7, 2.4, .9, 1.8, -lean), '#33513a', 0, rand);
  return b.build();
}

// ------------------------------------------------------------------ broadleaves grown as skeletons (bikefree upstate-trees.js)
/** a swept branch: a curved, tapered tube along pts (parallel-transport frames, so it doesn't twist) */
function tube(pts, radii, seg) {
  const n = pts.length, pos = [], idx = [];
  let T = pts[1].clone().sub(pts[0]).normalize(), N = Math.abs(T.y) < .9 ? new THREE.Vector3(0, 1, 0).cross(T).normalize() : new THREE.Vector3(1, 0, 0).cross(T).normalize();
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const T2 = (i < n - 1 ? pts[i + 1].clone().sub(pts[i - 1]) : pts[i].clone().sub(pts[i - 1])).normalize();
      const ax = T.clone().cross(T2), l = ax.length();
      if (l > 1e-6) N.applyAxisAngle(ax.divideScalar(l), Math.acos(Math.max(-1, Math.min(1, T.dot(T2)))));
      T = T2;
    }
    const B = T.clone().cross(N).normalize();
    for (let k = 0; k < seg; k++) { const a = k / seg * Math.PI * 2, c = Math.cos(a) * radii[i], s = Math.sin(a) * radii[i]; pos.push(pts[i].x + N.x * c + B.x * s, pts[i].y + N.y * c + B.y * s, pts[i].z + N.z * c + B.z * s); }
  }
  for (let i = 0; i + 1 < n; i++) for (let k = 0; k < seg; k++) { const a = i * seg + k, b = i * seg + (k + 1) % seg, c = a + seg, d = b + seg; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const BEEF = 2;   // (bikefree: trunks and limbs twice the first build)
/**
 * A broadleaf grown as a skeleton: every branch a curved, tapered tube built section by section - each section
 * tilted a little at random (gnarliness, more on thin branches) and pulled toward the light - the children spread up
 * the parent at the golden angle, splayed out. Leaf clusters (three crossed cards each) hang along the outer branches.
 * turn: how far it has turned (0 green - 1 all autumn colour), the top and outside first.
 */
/** two Builder geometries as one (same attributes) */
function mergeBuilt(a, b) {
  const g = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'color', 'aTree']) {
    const A = a.attributes[k].array, B = b.attributes[k].array, out = new Float32Array(A.length + B.length);
    out.set(A); out.set(B, A.length); g.setAttribute(k, new THREE.BufferAttribute(out, a.attributes[k].itemSize));
  }
  g.computeBoundingBox(); g.computeBoundingSphere(); a.dispose(); b.dispose();
  return g;
}
function grow(seed, o, turn) {
  let berryGeo = null;
  const rand = randomSequence(seed), H = o.H, R = o.R;
  const wood = new Builder(); wood.as(o.bark);
  const clusters = [], up = new THREE.Vector3(0, 1, 0), queue = [], stems = o.stems || 1;
  for (let s = 0; s < stems; s++) {
    const a = s * 2.4 + rand(), tilt = stems > 1 ? .12 + rand() * .08 : rand() * .04;
    queue.push({ level: 0, p: new THREE.Vector3(stems > 1 ? Math.cos(a) * .45 : 0, 0, stems > 1 ? Math.sin(a) * .45 : 0), d: new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)),
      len: H * (o.leader ? .86 : o.fork + .08) * (stems > 1 ? .95 : 1), r: o.trunkR * BEEF * (stems > 1 ? .75 : 1) });
  }
  const L = o.levels, maxLevel = 3;
  while (queue.length) {
    const br = queue.shift(), lv = br.level;
    const sections = Math.max(2, [8, 5, 3, 2][lv]), seg = [8, 6, 4, 3][lv];
    const pts = [br.p.clone()], radii = [br.r], dirs = [br.d.clone()];
    let p = br.p.clone(); const d = br.d.clone(), step = br.len / sections;
    for (let i = 1; i <= sections; i++) {
      const g = o.gnarl * (lv ? 1 : .35) / Math.max(.25, br.r / BEEF * 4);
      d.x += (rand() - .5) * g; d.z += (rand() - .5) * g; d.y += (rand() - .5) * g * .5;
      d.lerp(up, o.up * (lv ? 1 : .3)).normalize();
      p = p.clone().addScaledVector(d, step); pts.push(p); dirs.push(d.clone());
      radii.push(br.r * Math.max(.06, 1 - (i / sections) * (lv === 0 && !o.leader ? .45 : .9)));
    }
    wood.add(tube(pts, radii, seg), new THREE.Matrix4(), o.trunk);
    if (lv === 0 && !o.stems) for (let k = 0; k < 5; k++) { const a = k * 1.26 + rand() * .4; wood.add(cone(br.r * .5, 1.3, 3), M(Math.cos(a) * br.r * .6, 0, Math.sin(a) * br.r * .6, 1, 1, 1, -a, 0, .32), o.trunk); }   // root flare
    if (lv < maxLevel) {
      const [count, start, angle, ratio] = L[lv];
      for (let c = 0; c < count; c++) {
        const t = start + (1 - start) * (count > 1 ? c / (count - 1) : .5) * .94, fi = t * (pts.length - 1), i0 = Math.min(pts.length - 2, Math.floor(fi)), f = fi - i0;
        const cp = pts[i0].clone().lerp(pts[i0 + 1], f), cd = dirs[i0].clone().lerp(dirs[i0 + 1], f).normalize(), cr = radii[i0] + (radii[i0 + 1] - radii[i0]) * f;
        const roll = c * 2.39996 + rand() * .6 + seed;   // the golden angle round the parent
        const side = new THREE.Vector3(1, 0, 0); if (Math.abs(cd.x) > .9) side.set(0, 0, 1);
        const n1 = side.cross(cd).normalize(), n2 = cd.clone().cross(n1), out = n1.multiplyScalar(Math.cos(roll)).add(n2.multiplyScalar(Math.sin(roll)));
        const ang = angle * (.8 + rand() * .4), nd = cd.clone().multiplyScalar(Math.cos(ang)).addScaledVector(out, Math.sin(ang)).normalize();
        queue.push({ level: lv + 1, p: cp, d: nd, len: H * ratio * (1 - (t - start) * .4) * (.8 + rand() * .4), r: Math.max(.04, cr * (lv ? .55 : .62)) });
      }
    }
    if (lv === 1) for (let k = 0; k < 2; k++) { const i = Math.min(pts.length - 1, Math.round((.5 + .4 * rand()) * (pts.length - 1))); if (rand() < .7) clusters.push({ p: pts[i].clone(), size: .55 + rand() * .2 }); }
    if (lv >= maxLevel - 1) for (let k = 0; k < 2; k++) {
      const t = lv === maxLevel ? .45 + .55 * (k + 1) / 2 : .55 + .45 * (k + 1) / 2, i = Math.min(pts.length - 1, Math.round(t * (pts.length - 1)));
      clusters.push({ p: pts[i].clone(), size: (lv === maxLevel ? 1 : 1.25) * (.8 + rand() * .4) });
    }
  }
  const cc = new THREE.Vector3(); for (const c of clusters) cc.add(c.p); cc.divideScalar(Math.max(1, clusters.length));
  let rad = 0, radY = 0; for (const c of clusters) { rad = Math.max(rad, Math.hypot(c.p.x - cc.x, c.p.z - cc.z)); radY = Math.max(radY, Math.abs(c.p.y - cc.y)); }
  rad = Math.max(rad, R * .5); radY = Math.max(radY, 1.5);
  // one tree turns one way (a maple orange, its neighbour red), the top and outside first
  const hue = o.fall[Math.floor(rand() * o.fall.length)], hue2 = o.fall[Math.floor(rand() * o.fall.length)];
  // v0.16.0 (bikefree, 26 Nov: the three crossed quads per cluster read as "crosses"): each cluster is one or two
  // camera-facing leaf clumps - all six vertices at the clump's centre, the corner carried in aCard and opened square to
  // whichever camera draws it (here: the photo's) - a main clump and a smaller, darker one tucked beside it; normals
  // spherized from the crown's centre, so the crown shades as soft overlapping volumes from any side
  const C = { pos: [], nor: [], uv: [], col: [], card: [] }, qn = new THREE.Vector3(), p2 = new THREE.Vector3();
  const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]], UVS = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
  const nAt = (p, lift = .25) => qn.set((p.x - cc.x) / rad, (p.y - cc.y) / radY + lift, (p.z - cc.z) / rad).normalize();
  const leafScale = Math.min(1, Math.max(.24, H / 12));   // (bikefree: a leaf cluster's size is a tree's - a shrub's scaled down with it)
  const pushCard = (c, w, h, roll, n, u0, v0, k) => {
    for (let j = 0; j < 6; j++) {
      C.pos.push(c.x, c.y, c.z); C.nor.push(n.x, n.y, n.z); C.col.push(k.r, k.g, k.b);
      C.uv.push(u0 + UVS[j][0] * .5, v0 + UVS[j][1] * .5); C.card.push(CORNERS[j][0] * w, CORNERS[j][1] * h, roll, 0);
    }
  };
  for (const c of clusters) {
    const out = Math.min(1, Math.hypot((c.p.x - cc.x) / rad, (c.p.y - cc.y) / radY, (c.p.z - cc.z) / rad));
    const g = o.greens[Math.floor(rand() * o.greens.length)], u = rand(), top = (c.p.y - cc.y) / radY;
    const hex = u < turn * (.75 + top * .35 + out * .3) ? (rand() < .7 ? hue : mixHex(hue, hue2, .5)) : u < turn * 1.4 ? mixHex(g, hue, .4) : g;
    const k = new THREE.Color(hex).multiplyScalar(.8 + out * .28);   // depth: darker inside
    const size = 1.5 * c.size * 1.15 * leafScale;
    pushCard(c.p, size, size, rand() * 6.283, nAt(c.p), Math.floor(rand() * 2) * .5, Math.floor(rand() * 2) * .5, k);
    // a second, smaller clump tucked in beside it (outward and a little down), a shade darker: depth inside the mass
    const a = rand() * 6.283, d = size * (.45 + rand() * .3);
    p2.set(c.p.x + Math.cos(a) * d, c.p.y - size * (.1 + rand() * .3), c.p.z + Math.sin(a) * d);
    pushCard(p2, size * (.6 + rand() * .2), size * (.6 + rand() * .2), rand() * 6.283, nAt(p2), Math.floor(rand() * 2) * .5, Math.floor(rand() * 2) * .5, k.clone().multiplyScalar(.82 + rand() * .1));
  }
  // a shrub's fluff (bikefree, 24 Nov): clumps in three nested shells round the crown's middle - small and dark deep
  // inside, middling halfway, large and lit at the rim - so the bush reads as a full, soft mass with depth from any side
  if (o.fluff) {
    const shells = [[.32, 6, .4, .5], [.66, 10, .48, .75], [.97, 14, .54, 1]];   // [radius fraction, cards, size (x R), shade]
    for (const [fr, n, sz, sh] of shells) for (let q = 0; q < n * o.fluff; q++) {
      const a = q * 2.39996 + rand() * .7, hf = rand() * 2 - 1, ring = Math.sqrt(Math.max(0, 1 - hf * hf * .8));
      const size = rad * sz * (.75 + rand() * .5);
      const p = new THREE.Vector3(cc.x + Math.cos(a) * rad * fr * ring, Math.max(size * .85, cc.y + hf * radY * fr * .9), cc.z + Math.sin(a) * rad * fr * ring);
      const g = o.greens[Math.floor(rand() * o.greens.length)], hex = rand() < turn ? (rand() < .7 ? hue : hue2) : g;
      pushCard(p, size, size * .85, (rand() - .5) * .5, nAt(p, .1), Math.floor(rand() * 2) * .5, Math.floor(rand() * 2) * .5, new THREE.Color(hex).multiplyScalar(sh * (.9 + rand() * .2)));
    }
  }
  // berries (winterberry): small red beads along the outer twigs, held clear of the leaves
  if (o.berries) {
    const bw = new Builder(); bw.as(SHRUB);
    for (const c of clusters) for (let q = 0; q < o.berries; q++) {
      const a = rand() * 6.28, d = rad * .12 * rand();
      bw.add(blob(0), M(c.p.x + Math.cos(a) * d * 3, c.p.y + (rand() - .3) * .25, c.p.z + Math.sin(a) * d * 3, .045, .045, .045), rand() < .8 ? '#c42420' : '#e04a2a', 0, rand);
    }
    berryGeo = bw.build();
  }
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(C.pos, 3)); leaves.setAttribute('normal', new THREE.Float32BufferAttribute(C.nor, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(C.uv, 2)); leaves.setAttribute('color', new THREE.Float32BufferAttribute(C.col, 3));
  leaves.setAttribute('aCard', new THREE.Float32BufferAttribute(C.card, 4));
  // (the vertices sit at the clumps' centres: the bounds padded by the largest clump)
  leaves.computeBoundingBox(); leaves.boundingBox.expandByScalar(1.5 * 1.15 * 1.5 * Math.SQRT2);
  leaves.userData.cards = true;
  // (the crown, for the canopy shade: its leaves' extent, unpadded)
  const lb = new THREE.Box3(); for (const c of clusters) lb.expandByPoint(c.p);
  leaves.userData.crown = lb;
  let woodGeo = wood.build();
  if (berryGeo) woodGeo = mergeBuilt(woodGeo, berryGeo);
  return { wood: woodGeo, leaves };
}

// levels: per level [children, start (0-1 up the parent), splay (rad), length (x H)]; turn: one entry per variant
const BROAD = {
  // sugar maple: a dense oval crown on stout ascending limbs; brilliant orange
  sugarmaple: { H: 22, R: 6.5, fork: .34, trunkR: .45, trunk: '#5e5145', bark: BARK, gnarl: .22, up: .06,
    levels: [[6, .7, .62, .46], [4, .3, .65, .24], [3, .35, .6, .12]],
    greens: ['#4e7a37', '#57833c', '#476f33', '#5d8a40'], fall: ['#e07b22', '#d8641f', '#eaa232', '#c94b1d'], turn: [.95, .7, .3] },
  // red maple: smaller, rounder, smooth grey bark; scarlet (wet ground by the water)
  redmaple: { H: 18, R: 5.2, fork: .3, trunkR: .32, trunk: '#7c7a74', bark: BARK, gnarl: .25, up: .05,
    levels: [[5, .65, .7, .46], [4, .3, .7, .25], [3, .35, .6, .13]],
    greens: ['#55803c', '#4d7737', '#5f8842'], fall: ['#c4321e', '#d84a24', '#a8261b', '#e06a2a'], turn: [1, .65] },
  // paper birch: white stems (two from the base), a light airy crown, yellow
  birch: { H: 17, R: 3.8, fork: .5, trunkR: .2, trunk: '#e6e2d6', bark: WHITE, leader: true, stems: 2, gnarl: .18, up: .08,
    levels: [[5, .45, .7, .26], [3, .3, .6, .16], [3, .4, .55, .09]],
    greens: ['#6f9a48', '#7ca452', '#668f43'], fall: ['#e2c548', '#d8b13a', '#ecd469'], turn: [.95, .55] },
  // American beech: smooth silver-grey trunk, long limbs from low down, a broad crown; bronze
  beech: { H: 21, R: 7, fork: .22, trunkR: .45, trunk: '#9a9890', bark: BARK, leader: true, flat: true, gnarl: .2, up: .03,
    levels: [[7, .2, 1.05, .4], [4, .3, .65, .22], [3, .35, .6, .11]],
    greens: ['#5a843c', '#628c42', '#527a37'], fall: ['#b07a34', '#9a6a30', '#c9a440'], turn: [.9] },
};
const CONIFERS = {
  // red spruce: a narrow spire, branches near the ground, the occasional broken top
  spruce: [0, 1].map((v) => () => conifer(5301 + v, { H: 20 + v * 3, R: 3.6, colors: ['#25412f', '#2d4b37', '#345440'], trunk: '#4d3b2e', trunkBase: .36, droop: .5, jag: .3, seg: 7, layers: 10, crown: .03, top: v ? 'broken' : 'leader', under: 5, lopsided: v === 1, stubs: 2 })),
  // balsam fir: very narrow and dense, dark blue-green
  fir: [0].map((v) => () => conifer(1501 + v, { H: 16, R: 2.2, colors: ['#22402f', '#294834', '#30503b'], trunk: '#4d4036', trunkBase: .26, droop: .18, jag: .32, seg: 6, layers: 11, crown: .03, top: 'leader', under: 3 })),
  // eastern hemlock: soft feathery tiers and a nodding leader
  hemlock: [0].map((v) => () => conifer(5201 + v, { H: 22, R: 4.2, colors: ['#2c4a38', '#355643', '#294536'], trunk: '#5b4636', trunkBase: .5, trunkTop: .18, trunkH: .55, droop: .45, jag: .28, seg: 7, layers: 9, crown: .12, top: 'nod', stubs: 3 })),
  whitepine: [0, 1].map((v) => () => whitePine(v)),
  tamarack: [0].map((v) => () => tamarack(v)),
};

/**
 * The leaf-cluster texture (v0.16.0: bikefree's painterly clusters, fidelity step 6): four clusters (one per quarter),
 * each fewer, larger leaves that merge into one soft mass, lit from above (a light top, a shaded underside), little
 * leaf-to-leaf contrast and no midribs - the old 130 small leaves a quadrant, each its own shade with a dark rib, read
 * as single-pixel noise once photographed. Light greys: the vertex colour tints them by species and season.
 */
function makeLeafTexture(size = 512) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d'), rand = randomSequence(777), h = size / 2;
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * h, oy = Math.floor(q / 2) * h, leaves = [];
    for (let k = 0; k < 62; k++) {
      const r = Math.pow(rand(), .6) * h * .4, a = rand() * 6.28, x = ox + h / 2 + Math.cos(a) * r, y = oy + h / 2 + Math.sin(a) * r;
      leaves.push({ x, y, r, L: h * (.13 + rand() * .06), w: .55 + rand() * .2, rot: a + (rand() - .5) * 1.2, n: rand() });
    }
    leaves.sort((p, q2) => p.y - q2.y);   // (drawn top to bottom: the lit upper leaves overlap the shaded lower ones' tips)
    for (const l of leaves) {
      const up = 1 - (l.y - oy) / h;      // 1 at the cluster's top, 0 at its foot
      const v = Math.round(255 * (.8 + .2 * up) * (.94 + .06 * l.n) * (.9 + .1 * (1 - l.r / (h * .4))));
      g.save(); g.translate(l.x, l.y); g.rotate(l.rot); g.fillStyle = `rgb(${v},${v},${v})`;
      const L = l.L, W = L * l.w;
      g.beginPath(); g.moveTo(-L * .5, 0); g.quadraticCurveTo(0, -W, L * .5, 0); g.quadraticCurveTo(0, W, -L * .5, 0); g.fill();
      g.restore();
    }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ v0.17.0: the understory (bikefree upstate-trees.js
// fern(), its shrubs grown as the trees are, saplings) - the pond's late-October edge
/** a leaf blade, both faces: base at the origin, tip at +y (length 1), widest at `at` up it, width 1 */
function bladeGeo(at = .4) {
  const P = [0, 0, 0, -.5, at, 0, -.18, .82, 0, 0, 1, 0, .18, .82, 0, .5, at, 0], N = [], I = [];
  const pos = [...P, ...P];
  for (let k = 0; k < 6; k++) N.push(0, 0, 1); for (let k = 0; k < 6; k++) N.push(0, 0, -1);
  for (const [a, b, c] of [[0, 5, 4], [0, 4, 3], [0, 3, 2], [0, 2, 1]]) { I.push(a, b, c); I.push(c + 6, b + 6, a + 6); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setIndex(I);
  return g;
}
/**
 * A fern (bikefree, 24 Nov: "green paper strips" -> "Real fern fronds"): a crown of arching, twice-divided fronds - each
 * a rachis with paired pinnae, long in the middle and tapering to a fine tip, each pinna a row of little lobes. o:
 * { L (frond length), up (how high it arches), n (fronds), cols (late-October colours, weighted by repeats), droop
 * (share of fronds gone limp), flat (bracken: one tiered blade held flat on a tall stalk), erect (cinnamon: a vase) }
 */
function fern(seed, o) {
  const rand = randomSequence(seed), b = new Builder(), Y = new THREE.Vector3(0, 1, 0);
  const lobe = (p, dir, up, len, w, col) => {
    const x = new THREE.Vector3().crossVectors(dir, up).normalize(), zN = new THREE.Vector3().crossVectors(x, dir).normalize();
    const m = new THREE.Matrix4().makeBasis(x.multiplyScalar(w), dir.clone().multiplyScalar(len), zN).setPosition(p);
    b.add(bladeGeo(.45), m, col, 0, rand);
  };
  b.as(SHRUB);
  const fronds = o.n + Math.floor(rand() * 3);
  for (let f = 0; f < fronds; f++) {
    const a = f * 2.4 + rand() * .5, L = o.L * (.75 + rand() * .45), out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const limp = rand() < (o.droop ?? .1), col = o.cols[Math.floor(rand() * o.cols.length)];
    const up = (o.up ?? .55) * (.8 + rand() * .4) - (limp ? .35 : 0);
    const lift = o.flat ? o.L * .9 : 0;   // bracken: the blade on a bare stalk
    if (o.flat) lobe(new THREE.Vector3(0, 0, 0), new THREE.Vector3(out.x * .15, 1, out.z * .15).normalize(), out, lift, .012, shade(col, .8));
    const at = (t) => out.clone().multiplyScalar(L * t * (o.erect ? .55 : 1) + .03).add(new THREE.Vector3(0, lift + Math.max(.02, up * (o.erect ? 1.6 : 1) * Math.sin(Math.PI * t * (o.flat ? .25 : .7)) - (.12 + (limp ? .35 : 0)) * t * t * L), 0));
    const N = 10;
    for (let k = 1; k <= N; k++) {
      const t = k / N, p0 = at(t - 1 / N), p = at(t), d = p.clone().sub(p0), dl = d.length(); d.normalize();
      const side = new THREE.Vector3().crossVectors(d, Y).normalize(), top = new THREE.Vector3().crossVectors(side, d).normalize();
      lobe(p0, d, top, dl * 1.05, .018, col);   // the rachis
      const plen = ((o.flat ? .3 : .22) * Math.sin(Math.PI * Math.min(1, t * 1.1)) + .025) * (.9 + rand() * .2) * (o.L / .95);
      for (const sg of [-1, 1]) {
        const pd = side.clone().multiplyScalar(sg).addScaledVector(d, .45).addScaledVector(top, -.12).normalize();
        const lobes = Math.max(1, Math.min(3, Math.round(plen / .08)));
        for (let q = 0; q < lobes; q++) {
          const u = (q + .5) / lobes, c = p.clone().addScaledVector(pd, plen * u);
          const ld = d.clone().addScaledVector(pd, .4).normalize(), lw = plen * .5 * (1 - u * .6);
          lobe(c, ld, top, Math.max(.02, lw), lw * .55, col);
        }
        lobe(p, pd, top, plen, .02, col);   // its midrib
      }
    }
  }
  return b.build();
}
// late-October colours (weighted by repeats): cinnamon rusts first, royal goes gold-tan, bracken bronze, hay-scented
// bleaches to cream - a few fronds still green on each
const FERNS = {
  cinnamon: { L: 1.0, up: .7, n: 8, erect: true, droop: .2, cols: ['#b0602a', '#c27434', '#9a5226', '#b0602a', '#8a4a22', '#6f7a3a'] },
  royal: { L: .95, up: .55, n: 7, droop: .15, cols: ['#c49a4a', '#b88c3c', '#d2ab58', '#a87c34', '#7c8a3e'] },
  bracken: { L: .6, up: .1, n: 3, flat: true, droop: .1, cols: ['#9a6a34', '#a87a3a', '#8a5a2c', '#b48a44'] },
  hayscented: { L: .7, up: .45, n: 9, droop: .25, cols: ['#d8c070', '#cdb35e', '#e2cf8a', '#c4a650', '#8f9a50'] },
};
// the pond's shrubs (grown as the trees are: several thin stems, twiggy branching, leaf clumps in shells)
const SHRUBS = {
  // leatherleaf: the bog's low evergreen thicket, leaves gone bronze and maroon for the winter
  leatherleaf: { H: 1.0, R: .9, fluff: 1.1, fork: .2, trunkR: .02, trunk: '#5a3f30', bark: BARK, stems: 6, gnarl: .4, up: .12,
    levels: [[4, .3, .6, .45], [3, .3, .6, .25], [2, .4, .6, .12]], greens: ['#6a6a34', '#5e6230'], fall: ['#8a4430', '#9a5034', '#7a3a2c', '#a8643a'], turn: [.8, .55] },
  // sweet gale: grey-olive, upright, a little taller; browning
  sweetgale: { H: 1.4, R: .9, fluff: .8, fork: .25, trunkR: .025, trunk: '#4f4339', bark: BARK, stems: 5, gnarl: .3, up: .14,
    levels: [[4, .35, .5, .45], [3, .3, .55, .25], [2, .4, .6, .12]], greens: ['#5f6a44', '#69704a', '#56603e'], fall: ['#7a6a3a', '#8a7440', '#6a5a34'], turn: [.5] },
  // highbush blueberry: the shore's scarlet - wiry stems, a loose vase
  blueberry: { H: 2.2, R: 1.3, fluff: .9, fork: .25, trunkR: .03, trunk: '#6a3a2c', bark: BARK, stems: 6, gnarl: .4, up: .1,
    levels: [[4, .3, .55, .45], [3, .3, .6, .25], [2, .4, .6, .12]], greens: ['#5a7a3a'], fall: ['#c4321e', '#a8261b', '#d84a24', '#8a2020'], turn: [.95, .8] },
  // winterberry: leaves yellowing and thinning, the red berries showing
  winterberry: { H: 2.4, R: 1.2, fluff: .55, fork: .25, trunkR: .03, trunk: '#55504a', bark: BARK, stems: 5, gnarl: .3, up: .12, berries: 3,
    levels: [[4, .3, .55, .45], [3, .3, .6, .25], [2, .4, .6, .12]], greens: ['#6a7a3a', '#7a8440'], fall: ['#b4a040', '#a08a34', '#c2ae52'], turn: [.7] },
};
/**
 * The understory kit (v0.17.0): ferns, shrubs and conifer seedlings, photographed by a second tree engine. Every entry
 * keeps its model (`near`: the engine draws it in 3D close to the camera).
 */
export function makeUnderstoryKit() {
  return withSmooth(true, () => {
    const entries = [];
    Object.entries(FERNS).forEach(([sp, o], k) => [0, 1].forEach((v) => entries.push({ key: `${sp}:${v}`, sp, v, wood: fern(7001 + k * 31 + v * 7, o), leaves: null, near: true })));
    Object.entries(SHRUBS).forEach(([sp, o], k) => o.turn.forEach((turn, v) => { const t = grow(7301 + k * 37 + v * 7, o, turn); entries.push({ key: `${sp}:${v}`, sp, v, turn, ...t, near: true }); }));
    // seedlings: balsam fir and red spruce no taller than a person, a young maple in red
    entries.push({ key: 'firling:0', sp: 'firling', v: 0, wood: conifer(1551, { H: 2.6, R: .9, colors: ['#22402f', '#294834', '#30503b'], trunk: '#4d4036', trunkBase: .05, trunkTop: .02, droop: .2, jag: .3, seg: 6, layers: 8, crown: .02, top: 'leader', under: 3 }), leaves: null, foliageGain: 2.3, near: true });
    entries.push({ key: 'sprucling:0', sp: 'sprucling', v: 0, wood: conifer(5351, { H: 3.4, R: 1.1, colors: ['#25412f', '#2d4b37', '#345440'], trunk: '#4d3b2e', trunkBase: .06, trunkTop: .02, droop: .4, jag: .3, seg: 6, layers: 8, crown: .03, top: 'leader', under: 3 }), leaves: null, foliageGain: 2.3, near: true });
    { const t = grow(7501, { ...BROAD.redmaple, H: 3.2, R: 1.1, trunkR: .05, fluff: .5 }, .95); entries.push({ key: 'maplet:0', sp: 'maplet', v: 0, turn: .95, ...t, near: true }); }
    return { entries, leafTexture: makeLeafTexture(512) };
  });
}

/** every species' variants: { key: 'sp:v', sp, v, wood, leaves (null for conifers), turn } */
export function makeKit() {
  return withSmooth(true, () => {
    const entries = [];
    Object.entries(BROAD).forEach(([sp, o], k) => o.turn.forEach((turn, v) => { const t = grow(4001 + k * 37 + v * 7, o, turn); entries.push({ key: `${sp}:${v}`, sp, v, turn, ...t }); }));
    // (Floodwood: bikefree's evergreen greens are ~2.5x darker than this pond's palette; the photos lift them to match)
    for (const [sp, list] of Object.entries(CONIFERS)) list.forEach((fn, v) => entries.push({ key: `${sp}:${v}`, sp, v, wood: fn(), leaves: null, foliageGain: sp === 'tamarack' ? 1 : 2.3, crownFrom: { whitepine: .4, tamarack: .25, hemlock: .15 }[sp] ?? .06 }));
    return { entries, leafTexture: makeLeafTexture(512) };
  });
}
