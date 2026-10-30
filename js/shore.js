import * as THREE from 'three';
import { MAP } from './mapdata.js';
import { clamp, lerp, rnd, fbm, pondSD, NQ, heightAt, inIsleBox, inCreekBox, ISLE, beachFactor, TILES } from './world.js';

// v0.6: what a real Adirondack shoreline is made of - dead silver snags, leaning trees, granite boulders,
// driftwood, stumps, a few docks. Everything lives within ~14 m of the water's edge, where the eye actually looks.

function flat(color, extra = {}) { return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1, ...extra }); }
function grad(x, z) { const e = 2, gx = pondSD(x + e, z) - pondSD(x - e, z), gz = pondSD(x, z + e) - pondSD(x, z - e), l = Math.hypot(gx, gz) || 1; return [gx / l, gz / l]; }

/** sample points along the pond shoreline every `step` metres, with the outward (into water) normal */
function shorePoints(step) {
  const pts = [];
  MAP.pond.forEach((ring, ri) => {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / step));
      for (let j = 0; j < n; j++) { const t = (j + rnd()) / n, x = lerp(a[0], b[0], t), z = lerp(a[1], b[1], t); const [nx, nz] = grad(x, z); pts.push({ x, z, nx, nz, ring: ri }); }
    }
  });
  return pts;
}

function instanced(scene, geo, mat, items, tag = 'shore') {
  if (!items.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, items.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  items.forEach((it, i) => { q.setFromEuler(it.rot); m.compose(it.pos, q, it.scl); im.setMatrixAt(i, m); if (it.col) im.setColorAt(i, c.setRGB(...it.col)); });
  im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.computeBoundingSphere(); im.userData.tag = tag; im.userData.full = items.length; im.frustumCulled = true;
  scene.add(im); TILES.push(im); return im;
}

export function buildShore(scene) {
  const skip = (x, z) => inIsleBox(x, z) && beachFactor(x, z) > 0.2;
  const pts = shorePoints(6);
  const E = (x, y, z) => new THREE.Euler(x, y, z), V = (x, y, z) => new THREE.Vector3(x, y, z);
  const snags = [], leaners = [], rocks = [], drift = [], stumps = [], roots = [];
  pts.forEach((p) => {
    if (skip(p.x, p.z)) return;
    const n = fbm(p.x * 0.01 + 3, p.z * 0.01), rocky = n > 0.55, marsh = n < 0.4;
    const land = (d) => [p.x - p.nx * d, p.z - p.nz * d];
    // dead silver snag standing just inland, bare branches
    if (rnd() < (marsh ? 0.22 : 0.1)) { const [x, z] = land(1.5 + rnd() * 5); snags.push({ pos: V(x, heightAt(x, z) - 0.2, z), rot: E((rnd() - 0.5) * 0.12, rnd() * 6.28, (rnd() - 0.5) * 0.12), scl: V(1, 0.7 + rnd() * 0.9, 1) }); }
    // tree leaning out over the water
    if (rnd() < 0.07) { const [x, z] = land(2 + rnd() * 2); const ang = Math.atan2(p.nx, p.nz); leaners.push({ pos: V(x, heightAt(x, z) - 0.3, z), rot: E(0, ang, 0), scl: V(1, 0.8 + rnd() * 0.6, 1), lean: 0.5 + rnd() * 0.35 }); }
    // granite boulders at the waterline and just into the water
    if (rnd() < (rocky ? 0.55 : 0.12)) { const d = rnd() * 7 - 2.5, [x, z] = land(d), r = 0.5 + rnd() * (rocky ? 1.8 : 1.0); const g = 0.36 + rnd() * 0.14; rocks.push({ pos: V(x, Math.max(heightAt(x, z), -0.4) + r * 0.15, z), rot: E(rnd(), rnd() * 6.28, rnd() * 0.6), scl: V(r * (1 + rnd() * 0.7), r * 0.6, r * (1 + rnd() * 0.5)), col: [g, g * 0.98, g * 0.94] }); }
    // driftwood log lying along the shore, half in the water
    if (rnd() < 0.08) { const [x, z] = land(rnd() * 2 - 0.5); const ang = Math.atan2(p.nz, -p.nx) + (rnd() - 0.5) * 0.6; const g = 0.5 + rnd() * 0.15; drift.push({ pos: V(x, Math.max(heightAt(x, z), 0) + 0.12, z), rot: E(0, ang, (rnd() - 0.5) * 0.15), scl: V(1, 0.7 + rnd() * 0.5, 0.6 + rnd() * 0.8), col: [g, g * 0.92, g * 0.8] }); }
    // beaver-chewed stump
    if (rnd() < 0.05) { const [x, z] = land(2 + rnd() * 6); stumps.push({ pos: V(x, heightAt(x, z) - 0.1, z), rot: E(0, rnd() * 6.28, 0), scl: V(0.7 + rnd() * 0.6, 0.6 + rnd() * 0.8, 0.7 + rnd() * 0.6) }); }
    // an upturned root plate of a blown-down tree
    if (rnd() < 0.025) { const [x, z] = land(3 + rnd() * 5); roots.push({ pos: V(x, heightAt(x, z) + 0.6, z), rot: E(0, rnd() * 6.28, 0), scl: V(1 + rnd() * 0.8, 1 + rnd() * 0.8, 1) }); }
  });

  // --- geometry ---
  const silver = flat(0xa8a39a), bark = flat(0x4e4034), gran = flat(0x8d8a84, { roughness: 0.85 });
  const snagGeo = (() => {
    const g = []; const trunk = new THREE.CylinderGeometry(0.06, 0.34, 11, 5, 1); trunk.translate(0, 5.5, 0); g.push(trunk);
    for (let i = 0; i < 7; i++) { const b = new THREE.CylinderGeometry(0.02, 0.09, 1.6 + rnd() * 2.2, 4, 1); const y = 3 + i * 1.1, a = i * 2.1; b.translate(0, 0.9, 0); b.rotateZ(1.1 + rnd() * 0.5); b.rotateY(a); b.translate(0, y, 0); g.push(b); }
    const top = new THREE.ConeGeometry(0.06, 1.4, 4); top.translate(0, 11.5, 0); g.push(top);
    return merge(g);
  })();
  const leanGeo = (() => { // bent trunk reaching out, with a tuft of needles at the end
    const path = new THREE.CatmullRomCurve3([V(0, 0, 0), V(0, 2.5, 0.4), V(0, 4.5, 2.2), V(0, 5.8, 4.8), V(0, 6.4, 7.5)]);
    const t = new THREE.TubeGeometry(path, 10, 0.26, 5); const g = [t];
    for (let i = 0; i < 4; i++) { const c = new THREE.ConeGeometry(1.1 + rnd() * 0.6, 2.2, 5, 1, true); c.rotateX(-0.9); c.translate(rnd() - 0.5, 5.9 + rnd() * 0.6, 5 + i * 0.9); g.push(c); }
    return merge(g);
  })();
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const driftGeo = (() => { const t = new THREE.CylinderGeometry(0.16, 0.28, 6, 6, 1); t.rotateZ(Math.PI / 2); const s1 = new THREE.CylinderGeometry(0.04, 0.1, 1.2, 4); s1.rotateZ(0.9); s1.translate(1.4, 0.5, 0); const s2 = new THREE.CylinderGeometry(0.03, 0.08, 0.9, 4); s2.rotateX(1.2); s2.translate(-1.8, 0.2, 0.4); return merge([t, s1, s2]); })();
  const stumpGeo = (() => { const c = new THREE.CylinderGeometry(0.42, 0.55, 1.1, 7); c.translate(0, 0.55, 0); const tip = new THREE.ConeGeometry(0.42, 0.5, 7); tip.translate(0, 1.35, 0); return merge([c, tip]); })();
  const rootGeo = (() => { const g = []; const plate = new THREE.CylinderGeometry(1.6, 1.4, 0.5, 9); plate.rotateX(Math.PI / 2 + 0.3); g.push(plate); for (let i = 0; i < 8; i++) { const r = new THREE.CylinderGeometry(0.03, 0.1, 0.8 + rnd() * 0.8, 4); const a = (i / 8) * 6.28; r.translate(0, 0.5, 0); r.rotateX(Math.PI / 2 + (rnd() - 0.5) * 0.4); r.rotateZ(a); r.translate(Math.cos(a) * 1.3, Math.sin(a) * 1.3, 0); g.push(r); } return merge(g); })();

  instanced(scene, snagGeo, silver, snags);
  instanced(scene, leanGeo, new THREE.MeshStandardMaterial({ color: 0x3b5a3a, flatShading: true, roughness: 1 }), leaners.map((l) => ({ ...l, scl: l.scl })));
  instanced(scene, rockGeo, gran, rocks);
  instanced(scene, driftGeo, silver, drift);
  instanced(scene, stumpGeo, bark, stumps);
  instanced(scene, rootGeo, bark, roots);
  // chewed stumps get a pale chewed tip: separate little cones in silver
  const chewed = stumps.map((s) => ({ pos: s.pos.clone().add(V(0, 1.1 * s.scl.y, 0)), rot: s.rot, scl: V(s.scl.x, s.scl.y * 0.5, s.scl.z) }));
  instanced(scene, new THREE.ConeGeometry(0.42, 0.5, 7).translate(0, 0.25, 0), flat(0xd8c7a0), chewed);

  // --- a few campsite docks and a tin boat pulled up at the best camps ---
  const docks = [];
  MAP.camps.forEach((c, i) => {
    if (i % 4 !== 1) return; const sd = pondSD(c[0], c[1]); if (sd > -2 || sd < -40) return;
    const qx = NQ.x, qz = NQ.z, [nx, nz] = grad(qx, qz); if (skip(qx, qz)) return;
    docks.push({ x: qx, z: qz, nx, nz, boat: i % 8 === 1 });
  });
  const wood = flat(0x6b5236);
  docks.forEach((d) => {
    const g = new THREE.Group(); g.position.set(d.x - d.nx * 1.5, Math.max(heightAt(d.x - d.nx * 1.5, d.z - d.nz * 1.5), 0.15), d.z - d.nz * 1.5); g.rotation.y = Math.atan2(d.nx, d.nz);
    for (let i = 0; i < 9; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.4), wood); b.position.set(0, 0.35, i * 0.5); g.add(b); }
    for (const s of [-1, 1]) for (const z of [0.3, 2.2, 4.1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.4, 0.14), wood); p.position.set(s * 0.85, -0.3, z); g.add(p); }
    if (d.boat) { const boat = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 2.6, 3, 7), flat(0x8b9a9f, { metalness: 0.25, roughness: 0.6 })); boat.rotation.x = Math.PI / 2; boat.rotation.z = Math.PI; boat.scale.set(1, 1, 0.45); boat.position.set(2.6, 0.32, -0.5); boat.rotation.y = 0.4; g.add(boat); }
    scene.add(g);
  });
  return { snags: snags.length, leaners: leaners.length, rocks: rocks.length, drift: drift.length, stumps: stumps.length, roots: roots.length, docks: docks.length };
}

function merge(geos) {
  const P = [], N = [];
  for (const g0 of geos) { const g = g0.index ? g0.toNonIndexed() : g0; g.computeVertexNormals(); const p = g.attributes.position, n = g.attributes.normal; for (let i = 0; i < p.count; i++) { P.push(p.getX(i), p.getY(i), p.getZ(i)); N.push(n.getX(i), n.getY(i), n.getZ(i)); } }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); return out;
}
