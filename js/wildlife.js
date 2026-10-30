// v0.4 wildlife: ducks, a heron, an eagle and kingfisher, deer, a beaver and its lodge, otters and muskrats,
// a rare moose, and the odd distant paddler. Everything is low-poly, pooled, spawned only near the player,
// shy of the canoe, and only animated in detail when it is close enough to see.
import * as THREE from 'three';
import { MAP } from './mapdata.js?v=0.7.2';
import { clamp, lerp, sstep, rnd, pondSD, NQ, heightAt, inIsleBox, inCreekBox, ISLE } from './world.js?v=0.7.2';
import { WIND } from './wind.js?v=0.7.2';

const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...extra });
const TAU = Math.PI * 2;
const angDiff = (a, b) => ((b - a + Math.PI * 3) % TAU) - Math.PI;
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const v3 = new THREE.Vector3();

// ------------------------------------------------------------------ spot finding
/** random water point with sd in [sdMin, sdMax] at rMin..rMax from (cx, cz) */
function waterSpot(cx, cz, rMin, rMax, sdMin, sdMax, tries = 160) {
  for (let k = 0; k < tries; k++) {
    const a = rnd() * TAU, r = lerp(rMin, rMax, Math.sqrt(rnd())), x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const sd = pondSD(x, z); if (sd >= sdMin && sd <= sdMax && !NQ.creek) return [x, z];
  }
  return null;
}
/** unit vector pointing from land toward open water at (x, z) */
function waterNormal(x, z) {
  const e = 3, gx = pondSD(x + e, z) - pondSD(x - e, z), gz = pondSD(x, z + e) - pondSD(x, z - e), l = Math.hypot(gx, gz) || 1;
  return [gx / l, gz / l];
}
/** a point on land `back` metres from the shore, rMin..rMax from (cx, cz); returns {x, z, nx, nz, sx, sz} (s = shoreline point) */
function shoreSpot(cx, cz, rMin, rMax, back, tries = 120) {
  for (let k = 0; k < tries; k++) {
    const p = waterSpot(cx, cz, rMin, rMax, 0.5, 14, 6); if (!p) continue;
    pondSD(p[0], p[1]); const sx = NQ.x, sz = NQ.z; if (NQ.creek) continue;
    const [nx, nz] = waterNormal(sx, sz), x = sx - nx * back, z = sz - nz * back;
    if (pondSD(x, z) > -back * 0.6 || inCreekBox(x, z)) continue;
    const h = heightAt(x, z); if (h > 5 || h < 0.05) continue;
    if (MAP.camps.some((c) => dist2(c[0], c[1], x, z) < 18)) continue;
    return { x, z, nx, nz, sx, sz, h };
  }
  return null;
}

// ------------------------------------------------------------------ shared low-poly parts
function makeBird(o) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const bm = flat(o.body), wm = flat(o.wing ?? o.body, { side: THREE.DoubleSide }), hm = flat(o.head ?? o.body);
  const torso = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), bm); torso.scale.set(o.w ?? 0.7, o.h ?? 0.6, o.len); body.add(torso);
  const neck = new THREE.Group(); neck.position.set(0, (o.h ?? 0.6) * 0.3, o.len * 0.42); body.add(neck);
  const nl = o.neck ?? 0.25;
  const nm = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * o.len, 0.09 * o.len, nl, 5), o.neckMat ? flat(o.neckMat) : hm); nm.position.y = nl / 2; neck.add(nm);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13 * o.len, 0), hm); head.position.set(0, nl, 0.06 * o.len); head.scale.set(0.9, 0.9, 1.3); neck.add(head);
  const bill = new THREE.Mesh(new THREE.ConeGeometry(0.035 * o.len, o.bill ?? 0.25 * o.len, 4), flat(o.billCol ?? 0x2a2a28)); bill.rotation.x = Math.PI / 2; bill.position.set(0, nl - 0.01, 0.1 * o.len + (o.bill ?? 0.25 * o.len) / 2); neck.add(bill);
  if (o.tail) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.3 * o.len, 0.03, 0.3 * o.len), flat(o.tail)); t.position.set(0, 0.02, -o.len * 0.55); body.add(t); }
  const span = o.span, chord = o.chord ?? o.len * 0.38;
  const wgeo = (s) => { const b = new THREE.BoxGeometry(span / 2, 0.025, chord); b.translate(s * span / 4, 0, 0); return b; };
  const wr = new THREE.Mesh(wgeo(1), wm), wl = new THREE.Mesh(wgeo(-1), wm);
  wr.position.set(0.15 * o.len, 0.12, 0.05); wl.position.set(-0.15 * o.len, 0.12, 0.05); body.add(wr, wl);
  let legs = null;
  if (o.legs) { legs = new THREE.Group(); const lm = flat(o.legCol ?? 0x3a3530); [-1, 1].forEach((s) => { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, o.legs, 4), lm); l.position.set(s * 0.08, -o.legs / 2 - (o.h ?? 0.6) * 0.25, -0.05); legs.add(l); }); body.add(legs); }
  return { g, body, neck, head, wr, wl, legs, flap(a) { wr.rotation.z = a; wl.rotation.z = -a; }, fold(k) { wr.scale.x = wl.scale.x = lerp(1, 0.18, k); } };
}
function quadruped(o) {
  // o: { len, height, col, legLen, neckLen, headLen, tail }
  const g = new THREE.Group(), m = flat(o.col), dark = flat(o.dark ?? o.col);
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), m); body.scale.set(o.w ?? o.len * 0.38, o.bh ?? o.len * 0.42, o.len); body.position.y = o.legLen + (o.bh ?? o.len * 0.42) * 0.42; g.add(body);
  const legs = [];
  [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([sx, sz]) => {
    const pivot = new THREE.Group(); pivot.position.set(sx * (o.w ?? o.len * 0.38) * 0.35, o.legLen + 0.05, sz * o.len * 0.38); g.add(pivot);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(o.legR ?? 0.05, (o.legR ?? 0.05) * 0.7, o.legLen, 4), dark); leg.position.y = -o.legLen / 2; pivot.add(leg); legs.push(pivot);
  });
  const neck = new THREE.Group(); neck.position.set(0, o.legLen + (o.bh ?? o.len * 0.42) * 0.8, o.len * 0.45); g.add(neck);
  const nm = new THREE.Mesh(new THREE.CylinderGeometry((o.neckW ?? 0.18) * 0.4, (o.neckW ?? 0.18) * 0.6, o.neckLen, 5), m); nm.position.set(0, o.neckLen / 2, 0); neck.add(nm);
  neck.rotation.x = 0.5;
  const head = new THREE.Group(); head.position.y = o.neckLen; neck.add(head);
  const hm = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), m); hm.scale.set(o.headW ?? 0.16, o.headH ?? 0.18, o.headLen); hm.position.z = o.headLen * 0.35; head.add(hm);
  let tail = null;
  if (o.tail) { tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, o.tail, 0.05), flat(o.tailCol ?? o.col)); tail.position.set(0, o.legLen + (o.bh ?? o.len * 0.42) * 0.8, -o.len * 0.5); g.add(tail); }
  return { g, body, legs, neck, head, tail };
}
/** V-shaped wake: two small ripples behind a swimmer every so often */
function wake(rip, st, x, z, h, dt, every = 0.5, size = 1.4) {
  st.wk = (st.wk || 0) - dt;
  if (st.wk < 0) { st.wk = every; rip.spawn(x - Math.sin(h) * 0.4, z - Math.cos(h) * 0.4, size, 2.4, 0.28, 0.15); }
}

// ------------------------------------------------------------------ ducks
class Ducks {
  constructor(scene, n) {
    this.list = []; this.state = 'idle'; this.timer = 25 + rnd() * 30;
    const kinds = [
      { body: 0x4a3a2a, head: 0x3a3022, wing: 0x3f3226, billCol: 0x8a8a40 },            // black duck
      { body: 0x9a9a98, head: 0x8a3a1c, wing: 0x7a7a78, billCol: 0xb0301c },            // merganser (hen/eclipse)
      { body: 0x6a5a44, head: 0x2a4a2a, wing: 0x5a4a38, billCol: 0xc8b040 },            // mallard drake-ish
    ];
    const kind = kinds[Math.floor(rnd() * kinds.length)];
    for (let i = 0; i < n; i++) {
      const k = rnd() < 0.7 ? kind : kinds[Math.floor(rnd() * kinds.length)];
      const b = makeBird({ ...k, len: 0.55, w: 0.42, h: 0.34, span: 0.9, neck: 0.16, bill: 0.12 });
      b.g.visible = false; scene.add(b.g);
      this.list.push({ b, ox: (rnd() - 0.5) * 7, oz: (rnd() - 0.5) * 7, x: 0, z: 0, y: 0, h: 0, ph: rnd() * 6, delay: rnd() * 0.8, tip: 0 });
    }
  }
  update(dt, t, C) {
    const P = C.P; this.timer -= dt;
    const active = C.hour > 5.6 && C.hour < 19;
    if (this.state === 'idle') {
      if (this.timer < 0 && active && !C.rain) {
        const spot = waterSpot(P.x, P.z, 90, 240, 18, 200);
        if (spot) {
          // ducks land into the wind
          const ix = -WIND.dir.x, iz = -WIND.dir.y; this.h = Math.atan2(ix, iz);
          this.spot = spot; this.from = [spot[0] - ix * 260, spot[1] - iz * 260];
          this.state = 'in'; this.k = 0; this.list.forEach((d) => (d.b.g.visible = true, d.landed = false));
        } else this.timer = 10;
      }
      return;
    }
    const cx = this.spot ? this.spot[0] : 0, cz = this.spot ? this.spot[1] : 0;
    if (this.state === 'in') {
      this.k += dt * 13 / 270; // ~13 m/s approach
      for (const d of this.list) {
        const u = clamp(this.k - d.delay * 0.04, 0, 1.08), e = Math.min(u, 1);
        const tx = cx + d.ox, tz = cz + d.oz;
        d.h = this.h;
        if (u < 1) {
          d.x = lerp(this.from[0] + d.ox, tx, e); d.z = lerp(this.from[1] + d.oz, tz, e); d.y = 45 * Math.pow(1 - e, 1.6) + 0.1;
          const flare = sstep(0.8, 1, e); d.b.flap(Math.sin(t * (flare > 0 ? 14 : 9) + d.ph) * (0.6 + 0.3 * flare)); d.b.fold(0); d.b.body.rotation.x = -0.5 * flare;
        } else if (!d.landed) {
          d.landed = true; d.skid = 1; C.audio.splash(0, 0.5, { x: d.x, y: 0, z: d.z }); C.ripples.spawn(d.x, d.z, 3, 2.4, 0.45, 0.3);
        }
        if (d.landed) {
          d.skid = Math.max(0, d.skid - dt * 0.9); d.x += Math.sin(d.h) * d.skid * 4 * dt; d.z += Math.cos(d.h) * d.skid * 4 * dt; d.y = 0;
          if (d.skid > 0.2 && rnd() < dt * 8) C.ripples.spawn(d.x, d.z, 1.5, 1.6, 0.3, 0.2);
          d.b.fold(1 - d.skid); d.b.flap(0.3 * d.skid); d.b.body.rotation.x = 0;
        }
      }
      if (this.list.every((d) => d.landed && d.skid < 0.05)) { this.state = 'swim'; this.timer = 120 + rnd() * 200; this.wander = this.h; C.audio.quack({ x: cx, y: 0, z: cz }); }
    } else if (this.state === 'swim') {
      // the flock drifts as one, each bird paddling around its slot
      this.wander += Math.sin(t * 0.05) * dt * 0.1;
      let nx = cx + Math.sin(this.wander) * 0.35 * dt, nz = cz + Math.cos(this.wander) * 0.35 * dt;
      if (pondSD(nx, nz) < 12) { this.wander += Math.PI * 0.5; nx = cx; nz = cz; }
      this.spot = [nx, nz];
      let near = 1e9;
      for (const d of this.list) {
        const tx = nx + d.ox + Math.sin(t * 0.13 + d.ph) * 1.5, tz = nz + d.oz + Math.cos(t * 0.11 + d.ph) * 1.5;
        const want = Math.atan2(tx - d.x, tz - d.z), dd = Math.hypot(tx - d.x, tz - d.z);
        d.h += angDiff(d.h, want) * Math.min(1, dt * 0.8);
        const sp = Math.min(0.6, dd * 0.3); d.x += Math.sin(d.h) * sp * dt; d.z += Math.cos(d.h) * sp * dt;
        d.y = Math.sin(t * 1.4 + d.ph) * 0.012;
        // dabbling: tip up now and then
        if (d.tip <= 0 && rnd() < dt * 0.04) d.tip = 3;
        if (d.tip > 0) { d.tip -= dt; d.b.body.rotation.x = Math.sin(clamp((3 - d.tip) / 3, 0, 1) * Math.PI) * 1.2; if (d.tip <= 0) C.ripples.spawn(d.x, d.z, 1, 1.4, 0.25, 0.1); }
        else d.b.body.rotation.x = 0;
        near = Math.min(near, dist2(d.x, d.z, P.x, P.z));
      }
      if (near < 45 || this.timer < 0) {
        this.state = 'flush'; this.k = 0; const a = Math.atan2(nx - P.x, nz - P.z); this.h = a + (rnd() - 0.5) * 0.6;
        C.audio.wings({ x: nx, y: 0, z: nz }, 1); C.audio.quack({ x: nx, y: 0, z: nz }, true);
        this.list.forEach((d) => { d.v = 0; d.delay = rnd() * 0.5; C.ripples.spawn(d.x, d.z, 3.2, 2.2, 0.5, 0.3); });
      }
    } else if (this.state === 'flush') {
      this.k += dt; let gone = true;
      for (const d of this.list) {
        const u = this.k - d.delay; if (u < 0) { gone = false; continue; }
        d.h += angDiff(d.h, this.h) * Math.min(1, dt * 2);
        d.v = Math.min(14, d.v + dt * 7); d.x += Math.sin(d.h) * d.v * dt; d.z += Math.cos(d.h) * d.v * dt;
        d.y = Math.min(35, d.y + dt * (u < 1.2 ? 3.5 : 2.2) * (1 + u * 0.4));
        if (d.y < 1 && rnd() < dt * 14) C.ripples.spawn(d.x, d.z, 1.6, 1.4, 0.35, 0.15); // feet slapping the water
        d.b.fold(0); d.b.flap(Math.sin(t * 15 + d.ph) * 0.9); d.b.body.rotation.x = -0.25;
        if (dist2(d.x, d.z, P.x, P.z) < 420) gone = false;
      }
      if (gone) { this.state = 'idle'; this.timer = 70 + rnd() * 120; this.list.forEach((d) => (d.b.g.visible = false)); }
    }
    for (const d of this.list) { d.b.g.position.set(d.x, d.y, d.z); d.b.g.rotation.y = d.h; }
  }
}

// ------------------------------------------------------------------ great blue heron
class Heron {
  constructor(scene) {
    this.b = makeBird({ body: 0x6f7c88, head: 0xc8ccd0, wing: 0x5f6c78, neckMat: 0x9aa4ac, billCol: 0xc8a040, len: 0.9, w: 0.42, h: 0.55, span: 1.9, chord: 0.45, neck: 0.85, bill: 0.32, legs: 0.85, legCol: 0x3a3a34 });
    this.b.g.visible = false; scene.add(this.b.g); this.state = 'hidden'; this.timer = 15 + rnd() * 20; this.x = this.z = this.y = this.h = 0;
  }
  findSpot(C, rMin, rMax) { return waterSpot(C.P.x, C.P.z, rMin, rMax, 1.2, 3.2); }
  update(dt, t, C) {
    const b = this.b, P = C.P; this.timer -= dt;
    const active = C.hour > 5.2 && C.hour < 19.6;
    if (this.state === 'hidden') {
      if (this.timer < 0 && active) { const s = this.findSpot(C, 90, 260); if (s) { [this.x, this.z] = s; this.y = 0; this.state = 'stand'; this.h = rnd() * TAU; b.g.visible = true; this.timer = 0; } else this.timer = 8; }
      return;
    }
    const d = dist2(this.x, this.z, P.x, P.z);
    if (this.state === 'stand') {
      // statue-still, then the slow neck sway and the odd strike at a fish
      b.fold(1); b.flap(0); b.legs.visible = true; b.body.rotation.x = 0;
      b.neck.rotation.x = -0.15 + Math.sin(t * 0.3) * 0.05; this.strike = (this.strike || 0) - dt;
      if (this.strike < 0 && rnd() < dt * 0.05) this.strike = 1.2;
      if (this.strike > 0) { b.neck.rotation.x = 1.4 * Math.sin((1.2 - this.strike) / 1.2 * Math.PI); if (Math.abs(this.strike - 0.6) < dt) C.ripples.spawn(this.x + Math.sin(this.h) * 1, this.z + Math.cos(this.h) * 1, 1.2, 1.4, 0.3, 0.1); }
      this.y = 0.55;
      if (d < 42) {
        this.state = 'fly'; this.k = 0; C.audio.heron({ x: this.x, y: 1, z: this.z }); C.audio.wings({ x: this.x, y: 1, z: this.z }, 0.6);
        // fly off along the shore, away from the canoe
        pondSD(this.x, this.z); const sx = NQ.x - this.x, sz = NQ.z - this.z; const away = Math.atan2(this.x - P.x, this.z - P.z);
        const tang = Math.atan2(-sz, sx); this.h = Math.abs(angDiff(tang, away)) < Math.PI / 2 ? tang : tang + Math.PI;
        this.dest = null;
      }
      if (d > 600) { this.state = 'hidden'; b.g.visible = false; this.timer = 30; }
    } else if (this.state === 'fly') {
      this.k += dt; b.legs.visible = true; b.fold(0);
      b.flap(Math.sin(t * 4.2) * 0.75); // slow, deep wingbeats
      b.neck.rotation.x = lerp(b.neck.rotation.x, -1.1, Math.min(1, dt * 2)); b.body.rotation.x = -0.1;
      const sp = Math.min(7, 2 + this.k * 3); this.x += Math.sin(this.h) * sp * dt; this.z += Math.cos(this.h) * sp * dt;
      // keep roughly along the shoreline: steer toward 25 m offshore
      const sd = pondSD(this.x, this.z); if (sd < 6) this.h += dt * 0.6; else if (sd > 40) this.h -= dt * 0.6;
      this.y = lerp(this.y, this.k > 26 ? 0.6 : 9, Math.min(1, dt * 0.6));
      if (this.k > 26) {
        const s = sd > 0.8 && sd < 3.5;
        if (s && this.y < 1.2) { this.state = 'stand'; this.y = 0.55; C.ripples.spawn(this.x, this.z, 1.6, 1.8, 0.35, 0.2); }
        if (this.k > 50) { this.state = 'hidden'; b.g.visible = false; this.timer = 60 + rnd() * 60; }
      }
    }
    b.g.position.set(this.x, this.state === 'stand' ? this.y + 0.25 : this.y + 0.9, this.z); b.g.rotation.y = this.h;
  }
}

// ------------------------------------------------------------------ bald eagle (high, circling) + kingfisher (low along the shore)
class Eagle {
  constructor(scene) {
    this.b = makeBird({ body: 0x2a2018, head: 0xf0eee6, wing: 0x241c14, tail: 0xeeeeea, billCol: 0xe0b020, len: 0.95, w: 0.5, h: 0.4, span: 2.2, chord: 0.55, neck: 0.12, bill: 0.16 });
    this.b.g.visible = false; scene.add(this.b.g); this.timer = 60 + rnd() * 60; this.on = false; this.a = 0;
  }
  update(dt, t, C) {
    const b = this.b; this.timer -= dt;
    if (!this.on) {
      if (this.timer < 0 && C.hour > 8 && C.hour < 17 && !C.rain) { const s = waterSpot(C.P.x, C.P.z, 150, 450, -300, 1e9, 10) || [C.P.x + 200, C.P.z]; this.cx = s[0]; this.cz = s[1]; this.on = true; this.timer = 100 + rnd() * 80; this.r = 55 + rnd() * 30; this.alt = 85 + rnd() * 40; b.g.visible = true; this.call = 4; }
      return;
    }
    this.a += dt * 0.12; this.cx += WIND.dir.x * dt * 0.8; this.cz += WIND.dir.y * dt * 0.8;
    const x = this.cx + Math.cos(this.a) * this.r, z = this.cz + Math.sin(this.a) * this.r;
    b.g.position.set(x, this.alt + Math.sin(t * 0.2) * 4, z); b.g.rotation.set(0, Math.atan2(-Math.sin(this.a), Math.cos(this.a)), 0);
    b.body.rotation.z = -0.25; b.fold(0); b.flap(0.05 + (Math.sin(t * 0.3) > 0.93 ? Math.sin(t * 7) * 0.4 : 0));
    this.call -= dt; if (this.call < 0) { this.call = 30 + rnd() * 40; if (rnd() < 0.6) C.audio.eagle({ x, y: this.alt, z }); }
    if (this.timer < 0) { this.alt += dt * 6; if (this.alt > 220) { this.on = false; b.g.visible = false; this.timer = 140 + rnd() * 200; } }
  }
}
class Kingfisher {
  constructor(scene) {
    this.b = makeBird({ body: 0x4a6a8a, head: 0x3a5a7a, wing: 0x3e5e7e, billCol: 0x1a1a1a, len: 0.3, w: 0.36, h: 0.36, span: 0.5, neck: 0.06, bill: 0.12 });
    this.b.body.scale.setScalar(1); this.b.g.visible = false; scene.add(this.b.g); this.timer = 40 + rnd() * 60; this.on = false;
  }
  update(dt, t, C) {
    const b = this.b, P = C.P; this.timer -= dt;
    if (!this.on) {
      if (this.timer < 0 && C.hour > 6.5 && C.hour < 18.5) {
        this.timer = 6;
        const sd = pondSD(P.x, P.z); if (sd > 160) return;
        // start ahead of the canoe on the nearest shore, rattle, then dash along it
        const sx = NQ.x, sz = NQ.z, [nx, nz] = waterNormal(sx, sz);
        const tx = -nz, tz = nx, dir = (tx * Math.sin(P.psi) + tz * Math.cos(P.psi)) >= 0 ? 1 : -1;
        this.x = sx + nx * 5 - tx * dir * 30; this.z = sz + nz * 5 - tz * dir * 30; this.h = Math.atan2(tx * dir, tz * dir); this.k = 0; this.on = true;
        b.g.visible = true; C.audio.kingfisher({ x: this.x, y: 3, z: this.z });
      }
      return;
    }
    this.k += dt; const sp = 12;
    // follow the shore: hold ~5 m off the bank
    const sd = pondSD(this.x, this.z), [nx, nz] = waterNormal(NQ.x, NQ.z);
    let tx = -nz, tz = nx; if (tx * Math.sin(this.h) + tz * Math.cos(this.h) < 0) { tx = -tx; tz = -tz; }
    const corr = clamp((5 - sd) * 0.15, -0.8, 0.8); this.h += angDiff(this.h, Math.atan2(tx + nx * corr, tz + nz * corr)) * Math.min(1, dt * 3);
    this.x += Math.sin(this.h) * sp * dt; this.z += Math.cos(this.h) * sp * dt;
    // undulating flight: bursts of flapping, short glides
    const burst = Math.sin(this.k * 3.1) > -0.2; b.flap(burst ? Math.sin(t * 28) * 0.9 : 0.1); b.fold(0);
    b.g.position.set(this.x, 2.4 + Math.sin(this.k * 3.1) * 0.5, this.z); b.g.rotation.y = this.h;
    if (this.k > 1.2 && this.k < 1.3 && rnd() < 0.5) C.audio.kingfisher({ x: this.x, y: 3, z: this.z });
    if (this.k > 14 || dist2(this.x, this.z, P.x, P.z) > 220) { this.on = false; b.g.visible = false; this.timer = 70 + rnd() * 90; }
  }
}

// ------------------------------------------------------------------ white-tailed deer at the water's edge
function makeDeer(fawn) {
  const s = fawn ? 0.7 : 1;
  const d = quadruped({ len: 1.4 * s, w: 0.42 * s, bh: 0.55 * s, legLen: 0.8 * s, legR: 0.035 * s, neckLen: 0.55 * s, neckW: 0.16 * s, headLen: 0.38 * s, headW: 0.15 * s, headH: 0.17 * s, col: 0x7a5a3e, dark: 0x5a4430, tail: 0.22 * s, tailCol: 0xece6da });
  const em = flat(0x6a4c34); [-1, 1].forEach((sx) => { const e = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16 * s, 0.08 * s), em); e.position.set(sx * 0.09 * s, 0.12 * s, 0); e.rotation.z = sx * 0.5; d.head.add(e); });
  if (!fawn && rnd() < 0.5) { const am = flat(0xd8ccb0); [-1, 1].forEach((sx) => { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.32, 3), am); a.position.set(sx * 0.06, 0.2, 0.02); a.rotation.set(-0.3, 0, sx * 0.45); d.head.add(a); }); }
  return d;
}
class Deer {
  constructor(scene) {
    this.herd = []; for (let i = 0; i < 3; i++) { const d = makeDeer(i === 2); d.g.visible = false; scene.add(d.g); this.herd.push({ d, ox: 0, oz: 0, ph: rnd() * 6, head: 0 }); }
    this.state = 'hidden'; this.timer = 20 + rnd() * 25;
  }
  update(dt, t, C) {
    const P = C.P; this.timer -= dt;
    const dawnDusk = (C.hour > 5.1 && C.hour < 8.6) || (C.hour > 16.4 && C.hour < 19.9);
    if (this.state === 'hidden') {
      if (this.timer < 0 && dawnDusk) {
        const s = shoreSpot(P.x, P.z, 80, 260, 2.2);
        if (s) {
          this.s = s; this.state = 'drink'; const n = 1 + Math.floor(rnd() * 2.6);
          this.herd.forEach((h, i) => { h.on = i < n; h.d.g.visible = h.on; const tx = -s.nz, tz = s.nx, o = (i - (n - 1) / 2) * 3.2; h.x = s.x + tx * o - s.nx * rnd(); h.z = s.z + tz * o - s.nz * rnd(); h.h = Math.atan2(s.nx, s.nz) + (rnd() - 0.5) * 0.8; h.y = Math.max(heightAt(h.x, h.z), 0); h.alert = 0; h.flee = 0; });
        } else this.timer = 10;
      }
      return;
    }
    let anyOn = false;
    for (const h of this.herd) {
      if (!h.on) continue; anyOn = true;
      const d = dist2(h.x, h.z, P.x, P.z), D = h.d;
      if (this.state === 'drink') {
        // heads down to drink, lift and look around now and then; tail flicks
        h.alert = lerp(h.alert, d < 80 ? 1 : 0, Math.min(1, dt * 1.5));
        const look = Math.sin(t * 0.4 + h.ph) > 0.7 ? 1 : 0, up = Math.max(h.alert, look);
        D.neck.rotation.x = lerp(D.neck.rotation.x, lerp(1.9, 0.35, up), Math.min(1, dt * 2));
        if (h.alert > 0.5) { const want = Math.atan2(P.x - h.x, P.z - h.z); D.neck.rotation.y = clamp(angDiff(h.h, want), -1, 1) * 0.7; }
        if (D.tail) D.tail.rotation.x = Math.sin(t * 6 + h.ph) > 0.95 ? 0.6 : 0;
        if (d < 45 || (h.alert > 0.9 && rnd() < dt * 0.05)) { this.state = 'flee'; this.timer = 9; C.audio.snort({ x: h.x, y: 1, z: h.z }); }
      } else {
        // bound away from the water with the white tail flagged
        h.flee += dt; const away = Math.atan2(-this.s.nx, -this.s.nz) + (h.ph - 3) * 0.08;
        h.h += angDiff(h.h, away) * Math.min(1, dt * 4);
        const sp = Math.min(7, h.flee * 9); h.x += Math.sin(h.h) * sp * dt; h.z += Math.cos(h.h) * sp * dt;
        const hop = Math.abs(Math.sin(h.flee * 4.2 + h.ph)); h.y = Math.max(heightAt(h.x, h.z), 0) + hop * 0.7;
        D.neck.rotation.x = 0.3; D.neck.rotation.y = 0; if (D.tail) D.tail.rotation.x = -1.2;
        D.legs.forEach((l, i) => (l.rotation.x = (i < 2 ? 1 : -1) * (hop - 0.5) * 1.1));
        if (h.flee > 0.2 && h.flee < 0.3) C.audio.hooves({ x: h.x, y: 0, z: h.z });
      }
      if (this.state === 'drink') { h.y = Math.max(heightAt(h.x, h.z), 0); D.legs.forEach((l) => (l.rotation.x = 0)); }
      D.g.position.set(h.x, h.y, h.z); D.g.rotation.y = h.h;
    }
    if (!anyOn || (this.state === 'flee' && this.timer < 0) || (this.state === 'drink' && !dawnDusk && rnd() < dt * 0.02) || dist2(this.s.x, this.s.z, P.x, P.z) > 650) {
      this.state = 'hidden'; this.herd.forEach((h) => { h.on = false; h.d.g.visible = false; }); this.timer = 90 + rnd() * 140;
    }
  }
}

// ------------------------------------------------------------------ beaver + lodge
class Beaver {
  constructor(scene) {
    // the lodge: a low mound of peeled sticks and mud at a quiet bend of the shore, well away from the launch
    let best = null;
    for (let k = 0; k < 200 && !best; k++) {
      const ring = MAP.pond[0], p = ring[Math.floor(rnd() * ring.length)], [nx, nz] = waterNormal(p[0], p[1]);
      const x = p[0] + nx * 2.5, z = p[1] + nz * 2.5;
      if (dist2(x, z, MAP.launch[0], MAP.launch[1]) < 300 || inCreekBox(x, z) || inIsleBox(x, z)) continue;
      if (MAP.camps.some((c) => dist2(c[0], c[1], x, z) < 60)) continue;
      if (pondSD(x + nx * 25, z + nz * 25) < 18) continue; // needs open water in front
      best = { x, z, nx, nz };
    }
    this.lodge = best || { x: 0, z: 0, nx: 1, nz: 0 };
    const L = this.lodge, g = new THREE.Group(); g.position.set(L.x, -0.4, L.z); scene.add(g);
    const mud = new THREE.Mesh(new THREE.ConeGeometry(3.8, 2.3, 9, 2), flat(0x3c3024)); mud.scale.set(1, 1, 0.8); mud.position.y = 1.0; mud.rotation.y = rnd(); g.add(mud);
    const stick = flat(0x8a7558), dark = flat(0x4a3a2a), sg = new THREE.CylinderGeometry(0.04, 0.05, 1, 4);
    const sticks = new THREE.InstancedMesh(sg, stick, 70), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < 70; i++) {
      const a = rnd() * TAU, r = rnd() * 3.4, y = 2.2 * (1 - r / 3.8) + 0.1, len = 1.2 + rnd() * 2;
      m4.compose(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r * 0.8), q.setFromEuler(e.set(Math.PI / 2 - 0.3 + rnd() * 0.6, rnd() * 6, 0.5 + rnd() * 0.8)), new THREE.Vector3(1, len, 1)); sticks.setMatrixAt(i, m4);
      sticks.setColorAt(i, new THREE.Color().setRGB(0.55 + rnd() * 0.25, 0.46 + rnd() * 0.2, 0.34 + rnd() * 0.15));
    }
    g.add(sticks);
    // a few chewed stumps on the bank behind it
    for (let i = 0; i < 4; i++) { const sx = L.x - L.nx * (5 + rnd() * 6) + (rnd() - 0.5) * 8, sz = L.z - L.nz * (5 + rnd() * 6) + (rnd() - 0.5) * 8, st = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 5), dark); st.position.set(sx, Math.max(heightAt(sx, sz), 0) + 0.2, sz); scene.add(st); }
    // the beaver: just a head and a low back above the water, a flat tail for the slap
    const b = new THREE.Group(), fur = flat(0x4a3424);
    const back = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), fur); back.scale.set(0.85, 0.35, 1.5); b.add(back);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), fur); head.position.set(0, 0.05, 0.5); head.scale.set(1, 0.85, 1.25); b.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.42), flat(0x2a2420)); tail.position.set(0, 0, -0.6); b.add(tail);
    b.visible = false; scene.add(b); this.b = b; this.tail = tail;
    this.state = 'lodge'; this.timer = 10 + rnd() * 20; this.x = L.x; this.z = L.z; this.h = 0;
  }
  update(dt, t, C) {
    const P = C.P, L = this.lodge, active = C.hour > 16.6 || C.hour < 7.6; this.timer -= dt;
    const dP = dist2(this.x, this.z, P.x, P.z);
    if (this.state === 'lodge') {
      if (this.timer < 0 && active && dist2(L.x, L.z, P.x, P.z) < 700) {
        this.state = 'swim'; this.x = L.x + L.nx * 5; this.z = L.z + L.nz * 5; this.h = Math.atan2(L.nx, L.nz); this.k = 0; this.b.visible = true; C.ripples.spawn(this.x, this.z, 2, 2, 0.35, 0.2);
        // an out-and-back route along the shore
        this.leg = rnd() < 0.5 ? 1 : -1; this.timer = 70 + rnd() * 60;
      }
      return;
    }
    if (this.state === 'swim') {
      this.k += dt;
      const home = this.timer < 0, want = home ? Math.atan2(L.x - this.x, L.z - this.z) : this.h + this.leg * clamp((pondSD(this.x, this.z) - 14) * 0.02, -0.3, 0.3);
      this.h += angDiff(this.h, want) * Math.min(1, dt * (home ? 1 : 0.6));
      this.x += Math.sin(this.h) * 0.9 * dt; this.z += Math.cos(this.h) * 0.9 * dt;
      if (pondSD(this.x, this.z) < 3 && !home) this.h += this.leg * dt * 1.5;
      wake(C.ripples, this, this.x, this.z, this.h, dt, 0.55, 1.7);
      this.b.position.set(this.x, -0.08 + Math.sin(t * 2) * 0.01, this.z); this.b.rotation.y = this.h; this.tail.rotation.x = 0;
      if (home && dist2(this.x, this.z, L.x, L.z) < 4) { this.state = 'lodge'; this.b.visible = false; this.timer = 40 + rnd() * 60; }
      if (dP < 26) { this.state = 'slap'; this.k = 0; }
      if (!active && !home) this.timer = -1;
    } else if (this.state === 'slap') {
      // tail up... and down with a crack that rolls off the hills, then gone
      this.k += dt; this.tail.rotation.x = this.k < 0.35 ? -this.k * 4 : Math.min(0, -1.4 + (this.k - 0.35) * 14);
      this.b.position.y = -0.08 - Math.max(0, this.k - 0.4) * 1.2;
      if (this.k > 0.4 && !this.slapped) { this.slapped = true; C.audio.tailSlap({ x: this.x, y: 0, z: this.z }); C.ripples.spawn(this.x, this.z, 6, 3, 0.65, 0.4); C.ripples.spawn(this.x, this.z, 3, 2, 0.6, 0.2); }
      if (this.k > 1.2) { this.state = 'under'; this.b.visible = false; this.k = 0; this.slapped = false; }
    } else if (this.state === 'under') {
      this.k += dt; this.x += Math.sin(this.h + 2) * 1.6 * dt; this.z += Math.cos(this.h + 2) * 1.6 * dt;
      if (pondSD(this.x, this.z) < 4) { this.h += Math.PI * 0.7; }
      if (this.k > 18 + rnd() * 10) {
        if (dP < 45) { this.state = 'lodge'; this.timer = 60; }
        else { this.state = 'swim'; this.b.visible = true; C.ripples.spawn(this.x, this.z, 2.2, 2.2, 0.4, 0.2); this.timer = 20; }
      }
    }
  }
}

// ------------------------------------------------------------------ otters (porpoising pair) and a muskrat with its little V-wake
class SmallSwimmers {
  constructor(scene) {
    const fur = flat(0x3a2c20), mfur = flat(0x5a4632);
    this.otters = [0, 1].map(() => {
      const g = new THREE.Group(), body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.8, 2, 6), fur); body.rotation.x = Math.PI / 2; g.add(body);
      const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), fur); head.position.set(0, 0.06, 0.6); g.add(head);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.6, 4), fur); tail.rotation.x = -Math.PI / 2; tail.position.z = -0.75; g.add(tail);
      g.visible = false; scene.add(g); return { g, x: 0, z: 0, h: 0, ph: rnd() * 6, dive: 0 };
    });
    const mg = new THREE.Group(), mb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), mfur); mb.scale.set(1, 0.6, 1.5); mg.add(mb);
    mg.visible = false; scene.add(mg); this.musk = { g: mg, x: 0, z: 0, h: 0, on: false };
    this.oState = 'off'; this.oTimer = 40 + rnd() * 60; this.mTimer = 30 + rnd() * 40;
  }
  update(dt, t, C) {
    const P = C.P;
    // ---- otters: daytime + twilight, a pair that porpoises along, chirping
    this.oTimer -= dt;
    if (this.oState === 'off') {
      if (this.oTimer < 0 && C.hour > 6 && C.hour < 19.5) {
        const s = waterSpot(P.x, P.z, 70, 200, 5, 40);
        if (s) { this.oState = 'on'; this.h = rnd() * TAU; this.otters.forEach((o, i) => { o.x = s[0] + i * 2; o.z = s[1] + i; o.h = this.h; o.dive = 0; o.g.visible = true; }); this.oTimer = 60 + rnd() * 50; this.call = 3; }
        else this.oTimer = 10;
      }
    } else {
      let far = true;
      this.otters.forEach((o, i) => {
        const lead = this.otters[0], want = i === 0 ? this.h : Math.atan2(lead.x - o.x, lead.z - o.z);
        o.h += angDiff(o.h, want) * Math.min(1, dt * 1.5);
        const sp = i === 0 ? 1.6 : Math.min(2.4, dist2(lead.x, lead.z, o.x, o.z) * 0.6);
        o.x += Math.sin(o.h) * sp * dt; o.z += Math.cos(o.h) * sp * dt;
        const sd = pondSD(o.x, o.z); if (i === 0 && (sd < 4 || sd > 60)) this.h += dt * 0.8;
        // porpoise: an arc out of the water then under, every few seconds
        const cyc = (t * 0.22 + o.ph * 0.1 + i * 0.12) % 1;
        if (cyc < 0.18) { const u = cyc / 0.18; o.g.position.set(o.x, Math.sin(u * Math.PI) * 0.35 - 0.05, o.z); o.g.rotation.set(-Math.cos(u * Math.PI) * 0.9, o.h, 0); o.g.visible = true; if (u > 0.92 && !o.sp) { o.sp = true; C.ripples.spawn(o.x, o.z, 1.8, 1.8, 0.35, 0.15); } }
        else if (cyc < 0.45) { o.sp = false; o.g.visible = false; }
        else { o.g.visible = true; o.g.position.set(o.x, -0.1 + Math.sin(t * 2 + i) * 0.02, o.z); o.g.rotation.set(0, o.h, 0); wake(C.ripples, o, o.x, o.z, o.h, dt, 0.6, 1.2); }
        if (dist2(o.x, o.z, P.x, P.z) < 18) { this.h = Math.atan2(o.x - P.x, o.z - P.z); }
        if (dist2(o.x, o.z, P.x, P.z) < 450) far = false;
      });
      this.call -= dt; if (this.call < 0) { this.call = 6 + rnd() * 10; C.audio.otter({ x: this.otters[0].x, y: 0, z: this.otters[0].z }); }
      if (far || this.oTimer < 0) { this.oState = 'off'; this.otters.forEach((o) => (o.g.visible = false)); this.oTimer = 90 + rnd() * 120; }
    }
    // ---- muskrat: dusk/dawn, cruising the shallows with a neat V-wake
    const M = this.musk; this.mTimer -= dt;
    if (!M.on) {
      if (this.mTimer < 0 && (C.hour > 16.8 || C.hour < 8)) { const s = waterSpot(P.x, P.z, 40, 140, 2, 8); if (s) { M.on = true; M.x = s[0]; M.z = s[1]; M.h = rnd() * TAU; M.g.visible = true; M.k = 0; } else this.mTimer = 8; }
    } else {
      M.k += dt; const sd = pondSD(M.x, M.z);
      M.h += (sd < 2 ? 0.8 : sd > 9 ? -0.8 : Math.sin(t * 0.2) * 0.2) * dt;
      M.x += Math.sin(M.h) * 0.6 * dt; M.z += Math.cos(M.h) * 0.6 * dt; wake(C.ripples, M, M.x, M.z, M.h, dt, 0.5, 1.1);
      M.g.position.set(M.x, -0.03, M.z); M.g.rotation.y = M.h;
      if (dist2(M.x, M.z, P.x, P.z) < 14 || M.k > 80) { C.ripples.spawn(M.x, M.z, 1.4, 1.6, 0.35, 0.1); if (M.k <= 80) C.audio.plop(0, { x: M.x, y: 0, z: M.z }); M.on = false; M.g.visible = false; this.mTimer = 60 + rnd() * 90; }
    }
  }
}

// ------------------------------------------------------------------ moose (rare): standing in a marshy shallow, feeding
class Moose {
  constructor(scene) {
    const d = quadruped({ len: 2.6, w: 0.8, bh: 1.0, legLen: 1.35, legR: 0.07, neckLen: 0.65, neckW: 0.34, headLen: 0.75, headW: 0.26, headH: 0.32, col: 0x3a2a1e, dark: 0x2c2018 });
    const hump = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.9), flat(0x33251a)); hump.position.set(0, 1.35 + 1.0, 0.7); d.g.add(hump);
    const bell = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.12), flat(0x2c2018)); bell.position.set(0, -0.22, 0.2); d.head.add(bell);
    const am = flat(0x9a8a6a);
    [-1, 1].forEach((sx) => { const palm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.35), am); palm.position.set(sx * 0.42, 0.2, -0.05); palm.rotation.set(0.1, sx * 0.25, sx * 0.35); d.head.add(palm); });
    d.g.visible = false; scene.add(d.g); this.d = d; this.on = false; this.rolledFor = -1;
  }
  update(dt, t, C) {
    const P = C.P, D = this.d;
    const win = C.hour > 5.3 && C.hour < 8.3 ? 1 : C.hour > 17 && C.hour < 19.8 ? 2 : 0;
    if (!this.on) {
      const key = Math.floor(C.clock / C.dayLen) * 3 + win;
      if (win && this.rolledFor !== key) {
        this.rolledFor = key;
        if (rnd() < 0.12 || C.forceMoose) {
          const s = waterSpot(P.x, P.z, 160, 360, 1.8, 6);
          if (s) { this.on = true; this.x = s[0]; this.z = s[1]; pondSD(this.x, this.z); this.h = Math.atan2(NQ.x - this.x, NQ.z - this.z) + Math.PI * 0.5; D.g.visible = true; this.state = 'feed'; this.k = 0; }
        }
      }
      return;
    }
    const d = dist2(this.x, this.z, P.x, P.z); this.k += dt;
    if (this.state === 'feed') {
      // head down into the water for a long while, then up with water streaming off
      const cyc = (this.k * 0.07) % 1, down = cyc < 0.7;
      D.neck.rotation.x = lerp(D.neck.rotation.x, down ? 2.2 : 0.5, Math.min(1, dt * 0.8));
      if (!down && !this.dripped) { this.dripped = true; C.ripples.spawn(this.x + Math.sin(this.h) * 1.8, this.z + Math.cos(this.h) * 1.8, 2.4, 2.2, 0.4, 0.2); C.audio.splash(0, 0.35, { x: this.x, y: 1, z: this.z }); }
      if (down) this.dripped = false;
      if (d < 38) { this.state = 'leave'; pondSD(this.x, this.z); this.goal = Math.atan2(NQ.x - this.x, NQ.z - this.z); this.k = 0; C.audio.moose({ x: this.x, y: 1.5, z: this.z }); }
    } else {
      this.h += angDiff(this.h, this.goal) * Math.min(1, dt * 0.8); this.x += Math.sin(this.h) * 1.2 * dt; this.z += Math.cos(this.h) * 1.2 * dt;
      D.neck.rotation.x = 0.4; D.legs.forEach((l, i) => (l.rotation.x = Math.sin(this.k * 3 + (i % 2) * Math.PI + (i > 1 ? 1.5 : 0)) * 0.4));
      if (pondSD(this.x, this.z) > 0 && rnd() < dt * 2) C.ripples.spawn(this.x, this.z, 2, 2, 0.3, 0.3);
      if (this.k > 40) { this.on = false; D.g.visible = false; }
    }
    if (!win && this.state === 'feed' && rnd() < dt * 0.01) { this.state = 'leave'; pondSD(this.x, this.z); this.goal = Math.atan2(NQ.x - this.x, NQ.z - this.z); this.k = 0; }
    const ground = heightAt(this.x, this.z);
    D.g.position.set(this.x, Math.max(ground, -1.0), this.z); D.g.rotation.y = this.h;
  }
}

// ------------------------------------------------------------------ distant paddlers: a silhouette on the far side, never close
class Paddlers {
  constructor(scene) {
    const g = new THREE.Group(), hull = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.32, 4.8, 1, 1, 3), flat(0x8a3a24)), pos = hull.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { const z = pos.getZ(i), k = 1 - Math.pow(Math.abs(z) / 2.4, 2.2); pos.setX(i, pos.getX(i) * Math.max(k, 0.08)); if (pos.getY(i) < 0) pos.setX(i, pos.getX(i) * 0.6); }
    hull.geometry.computeVertexNormals(); hull.position.y = 0.12; g.add(hull);
    const cloth = flat(0x3a4a5a), cloth2 = flat(0x6a6a3a), wood = flat(0x6a5038);
    this.people = [[-1.2, cloth], [1.3, cloth2]].map(([z, m]) => {
      const p = new THREE.Group(); p.position.set(0, 0.25, z); g.add(p);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.3), m); b.position.y = 0.35; p.add(b);
      const h = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), m); h.position.y = 0.75; p.add(h);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.5, 0.05), wood); pad.position.set(0.3, 0.3, 0); p.add(pad); return { p, pad };
    });
    g.visible = false; scene.add(g); this.g = g; this.on = false; this.timer = 150 + rnd() * 120;
  }
  update(dt, t, C) {
    const P = C.P; this.timer -= dt;
    if (!this.on) {
      if (this.timer < 0) {
        this.timer = 30;
        if (C.hour < 7.2 || C.hour > 18.4 || C.rain || rnd() > 0.55) { this.timer = 160 + rnd() * 160; return; }
        const a = waterSpot(P.x, P.z, 330, 700, 25, 1e9);
        if (!a) return;
        // destination across open water, path clear of land
        for (let k = 0; k < 30; k++) {
          const b = waterSpot(a[0], a[1], 350, 900, 25, 1e9, 10); if (!b) continue;
          let ok = true; for (let s = 0.05; s < 1; s += 0.05) if (pondSD(lerp(a[0], b[0], s), lerp(a[1], b[1], s)) < 14) { ok = false; break; }
          if (!ok) continue;
          this.on = true; this.x = a[0]; this.z = a[1]; this.dest = b; this.h = Math.atan2(b[0] - a[0], b[1] - a[1]); this.g.visible = true; this.st = 0; break;
        }
      }
      return;
    }
    const d = dist2(this.x, this.z, P.x, P.z);
    let want = Math.atan2(this.dest[0] - this.x, this.dest[1] - this.z);
    if (d < 260) want = Math.atan2(this.x - P.x, this.z - P.z); // keep their distance
    this.h += angDiff(this.h, want) * Math.min(1, dt * 0.25);
    if (pondSD(this.x + Math.sin(this.h) * 20, this.z + Math.cos(this.h) * 20) < 10) this.h += dt * 0.5;
    this.x += Math.sin(this.h) * 1.15 * dt; this.z += Math.cos(this.h) * 1.15 * dt;
    this.g.position.set(this.x, Math.sin(t * 1.3) * 0.02, this.z); this.g.rotation.y = this.h;
    const ph = (t * 0.75) % 1;
    this.people.forEach((p, i) => { const s = (i ? -1 : 1); p.pad.position.x = s * 0.32; p.pad.rotation.x = Math.sin(ph * TAU + i) * 0.8; p.pad.rotation.z = s * 0.25; p.p.rotation.x = Math.sin(ph * TAU + i) * 0.08; });
    const prev = this.st; this.st = ph; if (prev > ph) C.audio.farPaddle({ x: this.x, y: 0, z: this.z });
    if (dist2(this.x, this.z, this.dest[0], this.dest[1]) < 20 || d > 1100) { this.on = false; this.g.visible = false; this.timer = 200 + rnd() * 200; }
  }
}

// ------------------------------------------------------------------ manager
export function createWildlife(scene, scale = 1) {
  const W = {
    ducks: new Ducks(scene, Math.max(3, Math.round(6 * scale))), heron: new Heron(scene), eagle: new Eagle(scene), kingfisher: new Kingfisher(scene),
    deer: new Deer(scene), beaver: new Beaver(scene), small: new SmallSwimmers(scene), moose: new Moose(scene), paddlers: new Paddlers(scene),
  };
  const order = Object.values(W);
  return {
    W,
    update(dt, t, C) { if (dt <= 0) return; for (const a of order) a.update(dt, t, C); },
    lodge: W.beaver.lodge,
  };
}
