// v0.4 close-up detail: floating leaves, leaves shaken loose by gusts, paddle drips and rain streaks.
// All of it lives in a small radius around the canoe, is instanced (one draw call each) and recycled.
import * as THREE from 'three';
import { clamp, lerp, rnd, pondSD, gridSD, heightAt, WORLD, LEAF_COLS, leafGeometry } from './world.js?v=0.7.1';
import { WIND, gustAt } from './wind.js?v=0.7.1';

const leafMat = () => new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9, side: THREE.DoubleSide });
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3(), c = new THREE.Color();
const leafColor = (j0 = 0.75) => { const b = LEAF_COLS[Math.floor(rnd() * LEAF_COLS.length)], j = j0 + rnd() * 0.3; return [b[0] * j, b[1] * j, b[2] * j]; };

// ------------------------------------------------------------------ floating leaves
export function createFloatingLeaves(scene, max = 300) {
  const im = new THREE.InstancedMesh(leafGeometry(0.42), leafMat(), max); im.frustumCulled = false; im.count = 0; scene.add(im);
  const L = [], R = 45;
  const place = (l, cx, cz, ring) => {
    for (let k = 0; k < 12; k++) {
      const a = rnd() * 6.283, r = ring ? lerp(R * 0.8, R, rnd()) : Math.sqrt(rnd()) * R, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (pondSD(x, z) > 1.5) { l.x = x; l.z = z; l.vx = l.vz = 0; l.rot = rnd() * 6.28; l.spin = (rnd() - 0.5) * 0.2; l.ph = rnd() * 6; l.s = 0.7 + rnd() * 0.7; l.col = leafColor(0.42); l.on = true; return; }
    }
    l.on = false; l.col = l.col || leafColor(0.42); l.x = cx; l.z = cz; l.vx = l.vz = 0; l.s = l.s || 1; l.rot = l.rot || 0; l.spin = 0; l.ph = l.ph || 0; // no water here: park it hidden, retry next frame
  };
  const api = {
    mesh: im, count: max,
    setCount(n) { api.count = Math.min(n, max); },
    /** a falling leaf landed on the water: take over the oldest slot */
    add(x, z, col) { const l = L[(api.next = ((api.next || 0) + 1) % Math.max(1, api.count))]; if (!l) return; l.x = x; l.z = z; l.vx = l.vz = 0; l.col = col; l.on = true; l.s = 0.8 + rnd() * 0.5; l.dirty = true; },
    update(dt, t, P, canoeSpeed) {
      while (L.length < api.count) { const l = {}; place(l, P.x, P.z, false); L.push(l); l.dirty = true; }
      const fx = Math.sin(P.psi), fz = Math.cos(P.psi);
      for (let i = 0; i < api.count; i++) {
        const l = L[i];
        const dx = l.x - P.x, dz = l.z - P.z, d = Math.hypot(dx, dz);
        if (!l.on || d > R) { place(l, P.x, P.z, d < R * 1.6); l.dirty = true; } // far jump (map travel): refill the whole disc
        // drift with the breeze, stronger inside a gust
        const g = gustAt(l.x, l.z);
        l.vx += (WIND.dir.x * (0.05 + 0.25 * g) - l.vx) * dt * 0.3; l.vz += (WIND.dir.y * (0.05 + 0.25 * g) - l.vz) * dt * 0.3;
        // the hull and wake push them aside
        if (d < 4.5 && canoeSpeed > 0.15) {
          const side = Math.sign(dx * fz - dz * fx) || 1, push = (1 - d / 4.5) * canoeSpeed * 0.9;
          l.vx += (fz * side) * push * dt * 3 + dx / (d + 0.1) * push * dt; l.vz += (-fx * side) * push * dt * 3 + dz / (d + 0.1) * push * dt;
          l.spin += (rnd() - 0.5) * push * dt * 4;
        }
        l.vx *= Math.exp(-dt * 0.6); l.vz *= Math.exp(-dt * 0.6);
        l.x += l.vx * dt; l.z += l.vz * dt; l.rot += l.spin * dt; l.spin *= Math.exp(-dt * 0.4);
        if (gridSD(l.x, l.z) < 0.8) { l.vx *= -0.3; l.vz *= -0.3; }
        if (!l.on) { m4.makeScale(0, 0, 0); im.setMatrixAt(i, m4); continue; }
        const bob = Math.sin(t * 1.6 + l.ph + l.x * 0.3) * 0.012;
        m4.compose(V.set(l.x, 0.05 + bob, l.z), q.setFromEuler(e.set(Math.sin(t * 1.2 + l.ph) * 0.08, l.rot, Math.cos(t * 1.1 + l.ph) * 0.08)), S.set(l.s, 1, l.s));
        im.setMatrixAt(i, m4);
        if (l.dirty) { im.setColorAt(i, c.setRGB(l.col[0], l.col[1], l.col[2])); l.dirty = false; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
      }
      im.count = api.count; im.instanceMatrix.needsUpdate = true;
    },
  };
  return api;
}

// ------------------------------------------------------------------ leaves falling from shoreline maples in gusts
export function createFallingLeaves(scene, floating, max = 90) {
  const im = new THREE.InstancedMesh(leafGeometry(0.42), leafMat(), max); im.frustumCulled = false; im.count = max; scene.add(im);
  const L = []; for (let i = 0; i < max; i++) { L.push({ on: false }); m4.makeScale(0, 0, 0); im.setMatrixAt(i, m4); }
  let near = [], scanT = 0, idx = 0;
  return {
    mesh: im,
    update(dt, t, P) {
      // which maples are close enough to matter (re-scan every couple of seconds)
      scanT -= dt;
      if (scanT < 0) { scanT = 2; near = (WORLD.maples || []).filter((m) => Math.hypot(m.x - P.x, m.z - P.z) < 140); }
      for (const m of near) {
        const g = gustAt(m.x, m.z);
        if (g > 0.5 && rnd() < dt * (g - 0.45) * 2.2) {
          const l = L[idx = (idx + 1) % max]; const a = rnd() * 6.28, r = rnd() * m.r;
          Object.assign(l, { on: true, x: m.x + Math.cos(a) * r, y: m.y + (rnd() - 0.5) * 2, z: m.z + Math.sin(a) * r, vy: -0.6 - rnd() * 0.5, ph: rnd() * 6, spin: 1 + rnd() * 2, col: [m.col[0] * 0.8, m.col[1] * 0.8, m.col[2] * 0.8], s: 0.8 + rnd() * 0.5 });
          im.setColorAt(idx, c.setRGB(l.col[0], l.col[1], l.col[2])); if (im.instanceColor) im.instanceColor.needsUpdate = true;
        }
      }
      for (let i = 0; i < max; i++) {
        const l = L[i]; if (!l.on) continue;
        const g = gustAt(l.x, l.z);
        // flutter: sideways sway and a tumbling spin while the wind carries it out over the water
        l.x += (WIND.dir.x * (0.6 + 2.6 * g) + Math.sin(t * 2.3 + l.ph) * 0.6) * dt; l.z += (WIND.dir.y * (0.6 + 2.6 * g) + Math.cos(t * 1.9 + l.ph) * 0.6) * dt;
        l.y += l.vy * dt * (0.7 + 0.5 * Math.sin(t * 3 + l.ph));
        const ground = Math.max(heightAt(l.x, l.z), 0);
        if (l.y <= ground + 0.05) {
          l.on = false; m4.makeScale(0, 0, 0); im.setMatrixAt(i, m4);
          if (pondSD(l.x, l.z) > 1) floating.add(l.x, l.z, l.col);
          continue;
        }
        m4.compose(V.set(l.x, l.y, l.z), q.setFromEuler(e.set(Math.sin(t * l.spin + l.ph) * 1.2, t * l.spin * 0.7, Math.cos(t * l.spin * 1.3 + l.ph) * 0.9)), S.set(l.s, 1, l.s));
        im.setMatrixAt(i, m4);
      }
      im.instanceMatrix.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------------ paddle drips
export function createDrips(scene, max = 60) {
  const g = new THREE.BufferGeometry(), pos = new Float32Array(max * 3); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xdfe8ee, size: 0.05, transparent: true, opacity: 0.75, depthWrite: false });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; scene.add(pts);
  const D = []; for (let i = 0; i < max; i++) { D.push({ on: false }); pos[i * 3 + 1] = -10; }
  let k = 0;
  return {
    points: pts,
    /** emit n drops at world position p with a little initial velocity */
    emit(p, n, vx = 0, vz = 0) { for (let j = 0; j < n; j++) { const d = D[k = (k + 1) % max]; Object.assign(d, { on: true, x: p.x + (rnd() - 0.5) * 0.12, y: p.y - rnd() * 0.15, z: p.z + (rnd() - 0.5) * 0.12, vx: vx * 0.3 + (rnd() - 0.5) * 0.2, vy: -rnd() * 0.3, vz: vz * 0.3 + (rnd() - 0.5) * 0.2 }); } },
    update(dt, ripples, onHit) {
      for (let i = 0; i < max; i++) {
        const d = D[i]; if (!d.on) continue;
        d.vy -= 9.8 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        if (d.y <= 0.05) { d.on = false; pos[i * 3 + 1] = -10; ripples.spawn(d.x, d.z, 0.35 + rnd() * 0.2, 0.9, 0.35, 0.03); if (onHit && rnd() < 0.3) onHit(d); continue; }
        pos[i * 3] = d.x; pos[i * 3 + 1] = d.y; pos[i * 3 + 2] = d.z;
      }
      g.attributes.position.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------------ rain streaks around the camera
export function createRain(scene, max = 1400) {
  const g = new THREE.BufferGeometry(), pos = new Float32Array(max * 6); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xc8d2dc, transparent: true, opacity: 0, depthWrite: false });
  const lines = new THREE.LineSegments(g, mat); lines.frustumCulled = false; lines.visible = false; scene.add(lines);
  const D = []; const R = 26;
  for (let i = 0; i < max; i++) D.push({ x: (rnd() - 0.5) * 2 * R, y: rnd() * 16, z: (rnd() - 0.5) * 2 * R, s: 0.8 + rnd() * 0.4 });
  let count = max;
  return {
    lines,
    setCount(n) { count = Math.min(max, n); g.setDrawRange(0, count * 2); },
    update(dt, cam, level, tint) {
      lines.visible = level > 0.02; if (!lines.visible) return;
      mat.opacity = 0.5 * level; if (tint) mat.color.copy(tint);
      const n = Math.floor(count * clamp(level * 1.2, 0, 1)); g.setDrawRange(0, n * 2);
      const wx = WIND.dir.x * (1 + WIND.base * 3), wz = WIND.dir.y * (1 + WIND.base * 3);
      for (let i = 0; i < n; i++) {
        const d = D[i]; d.y -= 9 * d.s * dt; d.x += wx * dt; d.z += wz * dt;
        if (d.y < 0) { d.y += 16; d.x = (rnd() - 0.5) * 2 * R; d.z = (rnd() - 0.5) * 2 * R; }
        const x = cam.x + d.x, z = cam.z + d.z, y = cam.y - 4 + d.y, L = 0.9 * d.s;
        pos.set([x, y, z, x - wx * 0.06, y + L, z - wz * 0.06], i * 6);
      }
      g.attributes.position.needsUpdate = true;
    },
  };
}
