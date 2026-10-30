import * as THREE from 'three';
import { clamp, lerp, rnd, pondSD, inPond, NQ, glowTexture } from './world.js?v=0.8.0';

const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });
/** v0.4: bake a set of static child meshes into one vertex-coloured mesh (one draw call instead of many) */
function mergeStatic(parent, meshes, matOpts = {}) {
  const P = [], N = [], C = [], m = new THREE.Matrix4(), inv = new THREE.Matrix4().copy(parent.matrixWorld).invert(), nm = new THREE.Matrix3(), v = new THREE.Vector3(), n = new THREE.Vector3();
  parent.updateMatrixWorld(true);
  inv.copy(parent.matrixWorld).invert();
  let side = THREE.FrontSide;
  for (const mesh of meshes) {
    m.multiplyMatrices(inv, mesh.matrixWorld); nm.getNormalMatrix(m);
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone(); g.computeVertexNormals();
    const p = g.attributes.position, nn = g.attributes.normal, col = mesh.material.color;
    if (mesh.material.side === THREE.DoubleSide) side = THREE.DoubleSide;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m); n.fromBufferAttribute(nn, i).applyMatrix3(nm).normalize(); P.push(v.x, v.y, v.z); N.push(n.x, n.y, n.z); C.push(col.r, col.g, col.b); }
    mesh.parent.remove(mesh);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  const out = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, side, ...matOpts })); parent.add(out); return out;
}

// ------------------------------------------------------------------ canoe + paddler
export function createCanoe(M = {}) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  if (M.canoe && M.paddler) return createCanoeFromModels(root, body, M);
  const L = 2.75, N = 13;
  const sections = [];
  for (let i = 0; i < N; i++) {
    const s = (i / (N - 1)) * 2 - 1, a = Math.abs(s);
    const w = 0.5 * Math.pow(Math.max(1 - Math.pow(a, 2.4), 0), 0.5) + 0.015;
    const gun = 0.3 + 0.38 * Math.pow(a, 3.2), keel = -0.17 + 0.2 * Math.pow(a, 2.2);
    sections.push({ z: s * L, w, gun, keel });
  }
  const profile = (sec, inner) => {
    const k = inner ? 0.93 : 1, dy = inner ? 0.035 : 0, { w, gun, keel } = sec;
    const pts = [[-w, gun], [-w * 0.97, lerp(keel, gun, 0.45)], [-w * 0.62, keel + 0.05], [0, keel], [w * 0.62, keel + 0.05], [w * 0.97, lerp(keel, gun, 0.45)], [w, gun]];
    return pts.map(([x, y]) => [x * k, y - (inner ? 0.02 : 0) + dy]);
  };
  const hull = (inner, color) => {
    const P = [], I = [];
    sections.forEach((sec) => profile(sec, inner).forEach(([x, y]) => P.push(x, y, sec.z * (inner ? 0.97 : 1))));
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < 6; j++) { const a = i * 7 + j, b = a + 1, c = a + 7, d = c + 1; I.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals();
    return new THREE.Mesh(g, flat(color, { side: THREE.DoubleSide }));
  };
  body.add(hull(false, 0x1f5a44), hull(true, 0xb9894f));
  // gunwale rails
  for (const side of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3(sections.map((s) => new THREE.Vector3(side * s.w, s.gun + 0.01, s.z)));
    body.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.028, 5), flat(0x8a5f30)));
  }
  const wood = flat(0x8a5f30);
  [[0.55, 0.0], [-0.65, 0.0]].forEach(([z]) => { const t = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.04, 0.09), wood); t.position.set(0, 0.34, z + 0.45); body.add(t); });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.3), wood); seat.position.set(0, 0.2, -0.55); body.add(seat);
  // paddler
  const person = new THREE.Group(); person.position.set(0, 0, -0.55); body.add(person);
  // A soft, shapeless figure: one bundled mass in a hooded parka, no face or distinct limbs.
  const cloak = flat(0x8a3a2c, { roughness: 1 });
  const base = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), cloak); base.scale.set(1.15, 0.6, 1.25); base.position.set(0, 0.3, 0.05); person.add(base);
  const torso = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), cloak); torso.scale.set(1.0, 1.25, 0.85); torso.position.y = 0.6; person.add(torso);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), cloak); head.scale.set(1, 1.1, 1.05); head.position.set(0, 0.95, -0.01); person.add(head);
  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.28, 2, 6), cloak), armR = armL.clone(); person.add(armL, armR);
  // paddle
  const paddle = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.45, 6), wood); shaft.position.y = -0.4; paddle.add(shaft);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.025), flat(0xc9a46a)); blade.position.y = -1.3; paddle.add(blade);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.04), wood); grip.position.y = 0.33; paddle.add(grip);
  body.add(paddle);
  // Depth-only "dry hull" mask at the waterline: hides the water plane inside the canoe.
  const wl = [];
  const NS = 24;
  for (let i = 0; i <= NS; i++) { const s = -0.7 + (1.4 * i) / NS, w = 0.5 * Math.pow(Math.max(1 - Math.pow(Math.abs(s), 2.4), 0), 0.5); wl.push([s * L, 0.7 * w * Math.sqrt(Math.max(1 - Math.pow(s / 0.72, 2), 0))]); }
  const shape = new THREE.Shape();
  wl.forEach(([z, w], i) => (i ? shape.lineTo(w, z) : shape.moveTo(w, z)));
  for (let i = wl.length - 1; i >= 0; i--) shape.lineTo(-wl[i][1], wl[i][0]);
  const maskGeo = new THREE.ShapeGeometry(shape); maskGeo.rotateX(Math.PI / 2); // shape (x,y) -> (x,0,y)
  const mask = new THREE.Mesh(maskGeo, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
  mask.renderOrder = 0.5; mask.frustumCulled = false; body.add(mask);
  // lantern pole: rises from the bow seat and arcs forward past the bow, lantern dangling from the tip
  const poleCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.3, 1.95), new THREE.Vector3(0, 1.05, 2.25), new THREE.Vector3(0, 1.6, 2.75), new THREE.Vector3(0, 1.82, 3.25), new THREE.Vector3(0, 1.8, 3.55),
  ]);
  body.add(new THREE.Mesh(new THREE.TubeGeometry(poleCurve, 20, 0.022, 5), wood));
  const hang = new THREE.Group(); hang.position.set(0, 1.78, 3.55); body.add(hang); // pivot at the pole tip
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.26, 4), wood); cord.position.y = -0.13; hang.add(cord);
  const cage = flat(0x2a2620);
  const capTop = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.07, 6), cage); capTop.position.y = -0.29; hang.add(capTop);
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.07, 0.03, 6), cage); lampBase.position.y = -0.5; hang.add(lampBase);
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4, bar = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.19, 0.01), cage); bar.position.set(Math.cos(a) * 0.06, -0.41, Math.sin(a) * 0.06); hang.add(bar); }
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.17, 8), new THREE.MeshBasicMaterial({ color: 0xffc27a }));
  lantern.position.y = -0.41; hang.add(lantern);
  const light = new THREE.PointLight(0xffb066, 0, 7, 2); light.position.y = -0.41; hang.add(light);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffa95a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
  halo.scale.setScalar(1.1); halo.position.y = -0.41; hang.add(halo);
  mergeStatic(body, body.children.filter((o) => o.isMesh && o !== mask));
  return { root, body, paddle, person, armL, armR, light, halo, lantern, hang, blade, mask };
}

// ------------------------------------------------------------------ ripples
// v0.4: one instanced draw call for every ring on the pond (wildlife, drips and rain add a lot of them)
export class Ripples {
  constructor(scene, n = 160) {
    const geo = new THREE.RingGeometry(0.9, 1, 40); geo.rotateX(-Math.PI / 2);
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(n), 1); geo.setAttribute('aFade', this.fade);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uColor: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: `attribute float aFade; varying float vF; void main(){ vF = aFade; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.); }`,
      fragmentShader: `uniform vec3 uColor; varying float vF; void main(){ if (vF <= 0.001) discard; gl_FragColor = vec4(uColor, vF);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, n); this.mesh.frustumCulled = false; this.mesh.renderOrder = 3; scene.add(this.mesh);
    this.items = []; this.i = 0; this.m4 = new THREE.Matrix4();
    for (let k = 0; k < n; k++) { this.items.push({ t: 1, life: 1, r: 1, a: 0, x: 0, z: 0, r0: 0.2 }); this.mesh.setMatrixAt(k, this.m4.makeScale(0, 0, 0)); }
  }
  spawn(x, z, r = 2.5, life = 2.4, a = 0.5, r0 = 0.2) {
    const it = this.items[this.i++ % this.items.length]; it.t = 0; it.life = life; it.r = r; it.a = a; it.r0 = r0; it.x = x; it.z = z;
  }
  update(dt, tint) {
    const m = this.m4, f = this.fade.array;
    this.mat.uniforms.uColor.value.copy(tint);
    this.items.forEach((it, k) => {
      if (it.t >= it.life) { if (f[k] !== 0) { f[k] = 0; m.makeScale(0, 0, 0); this.mesh.setMatrixAt(k, m); } return; }
      it.t += dt; const u = clamp(it.t / it.life, 0, 1);
      const s = lerp(it.r0, it.r, 1 - Math.pow(1 - u, 2));
      m.makeScale(s, 1, s); m.setPosition(it.x, 0.06, it.z); this.mesh.setMatrixAt(k, m);
      f[k] = it.a * (1 - u) * (1 - u);
    });
    this.fade.needsUpdate = true; this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ loons
function makeLoon() {
  const g = new THREE.Group(), black = flat(0x15181c), white = flat(0xeeeeea);
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), black); body.scale.set(0.8, 0.5, 1.7); body.position.y = 0.05; g.add(body);
  const belly = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), white); belly.scale.set(0.7, 0.2, 1.4); belly.position.set(0, -0.08, 0.05); g.add(belly);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.11, 0.5, 6), black); neck.position.set(0, 0.42, 0.62); neck.rotation.x = 0.2; g.add(neck);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.09, 6), white); collar.position.set(0, 0.35, 0.6); g.add(collar);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), black); head.position.set(0, 0.7, 0.68); head.scale.set(0.9, 0.9, 1.3); g.add(head);
  const bill = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.3, 4), flat(0x2a2a2a)); bill.rotation.x = Math.PI / 2; bill.position.set(0, 0.69, 0.9); g.add(bill);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 3), new THREE.MeshBasicMaterial({ color: 0xd22 })); eye.position.set(0.07, 0.73, 0.74); g.add(eye);
  const eye2 = eye.clone(); eye2.position.x = -0.07; g.add(eye2);
  // checkered back
  for (let i = 0; i < 9; i++) { const d = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.08), white); d.position.set((i % 3 - 1) * 0.16, 0.22, -0.15 - Math.floor(i / 3) * 0.2); g.add(d); }
  // v0.4: wings for the running take-off (folded flat against the back while swimming)
  const wg = (s) => { const b = new THREE.BoxGeometry(0.75, 0.025, 0.34); b.translate(s * 0.375, 0, 0); return b; };
  const wm = flat(0x15181c, { side: THREE.DoubleSide });
  const wr = new THREE.Mesh(wg(1), wm), wl = new THREE.Mesh(wg(-1), wm); wr.position.set(0.22, 0.2, 0.05); wl.position.set(-0.22, 0.2, 0.05);
  mergeStatic(g, g.children.filter((o) => o.isMesh));
  g.add(wr, wl);
  g.userData.wings = [wr, wl];
  return g;
}
export class Loons {
  constructor(scene, count = 3) {
    this.list = [];
    for (let i = 0; i < count; i++) {
      const g = makeLoon(); scene.add(g);
      const l = { g, x: 0, z: 0, tx: 0, tz: 0, h: rnd() * 6, state: 'swim', timer: 5 + rnd() * 15, sink: 0 };
      this.place(l); this.list.push(l);
    }
  }
  /** running take-off, a wide circuit of the pond, and a skidding landing somewhere else */
  air(l, dt, t, ripples, canoePos) {
    const [wr, wl] = l.g.userData.wings; l.k += dt;
    if (l.state === 'run') {
      l.v = Math.min(13, l.v + dt * 1.9); const lift = clamp((l.v - 8) / 5, 0, 1);
      if (pondSD(l.x + Math.sin(l.h) * 30, l.z + Math.cos(l.h) * 30) < 10) l.h += dt * 0.8;
      l.x += Math.sin(l.h) * l.v * dt; l.z += Math.cos(l.h) * l.v * dt;
      l.y = lift * 1.2; l.pat = (l.pat || 0) - dt;
      if (l.pat < 0 && lift < 0.9) { l.pat = 0.11; ripples.spawn(l.x - Math.sin(l.h) * 0.4, l.z - Math.cos(l.h) * 0.4, 1.3, 1.5, 0.35, 0.1); }
      const f = Math.sin(t * 13) * 0.9; wr.scale.x = wl.scale.x = 1; wr.rotation.z = f; wl.rotation.z = -f; l.g.rotation.x = -0.15;
      if (lift >= 1) { l.state = 'fly'; l.k = 0; l.turn = rnd() < 0.5 ? 1 : -1; }
    } else if (l.state === 'fly') {
      l.h += l.turn * dt * 0.09; l.x += Math.sin(l.h) * 15 * dt; l.z += Math.cos(l.h) * 15 * dt;
      l.y = Math.min(32, l.y + dt * 2.2); const f = Math.sin(t * 9) * 0.6; wr.rotation.z = f; wl.rotation.z = -f; l.g.rotation.x = 0;
      if (l.k > 28 && pondSD(l.x, l.z) > 60) { l.state = 'land'; l.k = 0; }
      if (l.k > 70) { l.k = 28; l.turn *= -1; }
    } else {
      l.x += Math.sin(l.h) * 12 * dt; l.z += Math.cos(l.h) * 12 * dt; l.y = Math.max(0, l.y - dt * 4.5);
      const f = Math.sin(t * 7) * 0.35; wr.rotation.z = f; wl.rotation.z = -f; l.g.rotation.x = 0.12;
      if (pondSD(l.x, l.z) < 25) l.h += l.turn * dt * 0.6;
      if (l.y <= 0) { ripples.spawn(l.x, l.z, 5, 2.8, 0.55, 0.4); ripples.spawn(l.x + Math.sin(l.h) * 4, l.z + Math.cos(l.h) * 4, 3, 2.2, 0.4, 0.3); this.onLand && this.onLand(l); l.state = 'swim'; l.timer = 25 + rnd() * 30; [l.tx, l.tz] = this.randomWater(); }
    }
    l.g.position.set(l.x, -0.02 + l.y, l.z); l.g.rotation.y = l.h;
  }
  randomWater() { for (let k = 0; k < 400; k++) { const x = lerp(-1050, 1050, rnd()), z = lerp(-720, 720, rnd()); if (pondSD(x, z) > 40) return [x, z]; } return [0, 0]; }
  place(l) { const [x, z] = this.randomWater(); l.x = x; l.z = z; [l.tx, l.tz] = this.randomWater(); }
  update(dt, t, canoePos, ripples, onPlop) {
    for (const l of this.list) {
      l.timer -= dt;
      if (l.state === 'swim') {
        const dx = l.tx - l.x, dz = l.tz - l.z, d = Math.hypot(dx, dz);
        const away = Math.hypot(l.x - canoePos.x, l.z - canoePos.z); // shy: keep ~25 m from the canoe
        const target = Math.atan2(dx, dz);
        let diff = ((target - l.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI; l.h += diff * Math.min(1, dt * 0.8);
        const sp = away < 35 ? 1.4 : 0.55;
        const nx = l.x + Math.sin(l.h) * sp * dt, nz = l.z + Math.cos(l.h) * sp * dt;
        if (pondSD(nx, nz) > 12) { l.x = nx; l.z = nz; } else [l.tx, l.tz] = this.randomWater();
        if (d < 8) [l.tx, l.tz] = this.randomWater();
        if (l.timer < 0 || away < 14) {
          // usually a dive; sometimes the long pattering run across the surface and away into the air
          if (rnd() < 0.22 && pondSD(l.x + Math.sin(l.h) * 120, l.z + Math.cos(l.h) * 120) > 15) { l.state = 'run'; l.v = 0.8; l.k = 0; this.onRun && this.onRun(l); }
          else { l.state = 'dive'; l.timer = 1.1; ripples.spawn(l.x, l.z, 3, 2.2, 0.45); onPlop && onPlop(l.x, l.z); }
        }
        l.g.position.set(l.x, -0.02 + Math.sin(t * 1.3 + l.h) * 0.015, l.z);
        l.g.rotation.y = l.h; l.g.rotation.z = Math.sin(t * 1.1 + l.h) * 0.02;
        l.g.userData.wings.forEach((w) => { w.rotation.z = 0; w.scale.x = 0.2; }); l.g.rotation.x = 0;
      } else if (l.state === 'dive') {
        l.sink = clamp(l.sink + dt * 1.3, 0, 1); l.g.position.y = -0.02 - l.sink * 0.9;
        if (l.timer < 0) { l.state = 'under'; l.timer = 7 + rnd() * 8; l.g.visible = false; }
      } else if (l.state === 'run' || l.state === 'fly' || l.state === 'land') {
        this.air(l, dt, t, ripples, canoePos);
      } else { // under: swim a bit
        l.x += Math.sin(l.h) * 2.2 * dt; l.z += Math.cos(l.h) * 2.2 * dt;
        if (pondSD(l.x, l.z) < 14) { l.h += Math.PI; }
        if (l.timer < 0) {
          l.state = 'swim'; l.timer = 20 + rnd() * 35; l.sink = 0; l.g.visible = true; l.tx = l.x + (rnd() - 0.5) * 300; l.tz = l.z + (rnd() - 0.5) * 300;
          if (pondSD(l.tx, l.tz) < 30) [l.tx, l.tz] = this.randomWater();
          ripples.spawn(l.x, l.z, 3.5, 2.6, 0.5);
        }
      }
    }
  }
}

// ------------------------------------------------------------------ geese (autumn V formation)
export class Geese {
  constructor(scene) {
    this.g = new THREE.Group(); this.g.visible = false; scene.add(this.g); this.birds = []; this.t = -1; this.next = 25; this.dir = new THREE.Vector3();
    const mat = new THREE.MeshBasicMaterial({ color: 0x14181c, side: THREE.DoubleSide });
    const wingGeo = new THREE.BufferGeometry(); wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.5, 2.6, 0, -0.4, 0, 0, -0.5], 3)); wingGeo.computeVertexNormals();
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Group(), body = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.6, 5), mat); body.rotation.x = Math.PI / 2; b.add(body);
      const neck = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.9, 4), mat); neck.rotation.x = Math.PI / 2; neck.position.z = 1.0; b.add(neck);
      const wr = new THREE.Mesh(wingGeo, mat), wl = new THREE.Mesh(wingGeo, mat); wl.scale.x = -1; wr.position.y = wl.position.y = 0.1; b.add(wr, wl);
      const k = Math.ceil(i / 2) * (i % 2 ? 1 : -1); b.position.set(k * 7, 0, -Math.abs(k) * 7);
      this.g.add(b); this.birds.push({ b, wr, wl, ph: rnd() * 6 });
    }
  }
  launch(from, honk) {
    this.t = 0; this.g.visible = true; const a = rnd() * 0.8 - 0.4 + Math.PI * 0.5;
    this.dir.set(Math.cos(a) * 0.3, 0, Math.sin(a)).normalize();
    this.start = new THREE.Vector3(from.x - this.dir.x * 1800 + (rnd() - 0.5) * 800, 95 + rnd() * 50, from.z - this.dir.z * 1800);
    this.g.rotation.y = Math.atan2(this.dir.x, this.dir.z); honk && honk();
  }
  update(dt, time, canoePos, honk, active) {
    if (this.t < 0) { this.next -= dt; if (this.next < 0 && active) { this.launch(canoePos, honk); this.next = 90 + rnd() * 120; } return; }
    this.t += dt; const sp = 30;
    this.g.position.set(this.start.x + this.dir.x * sp * this.t, this.start.y, this.start.z + this.dir.z * sp * this.t);
    this.birds.forEach((o) => { const f = Math.sin(time * 5 + o.ph) * 0.55; o.wr.rotation.z = f; o.wl.rotation.z = -f; });
    if (this.t * sp > 3600) { this.t = -1; this.g.visible = false; }
  }
}

// ------------------------------------------------------------------ fireflies & mist
export function createFireflies(scene, n = 140) {
  const pos = new Float32Array(n * 3), seeds = [];
  for (let i = 0; i < n; i++) seeds.push([rnd() * 6.28, rnd() * 6.28, 0.3 + rnd() * 0.7, rnd() * 10]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ map: glowTexture(), color: 0xd9ff7a, size: 1.1, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, sizeAttenuation: true });
  const p = new THREE.Points(g, m); p.frustumCulled = false; scene.add(p);
  return { p, update(center, t, level) {
    m.opacity = level * (0.6 + 0.4 * Math.sin(t * 3));
    m.visible = level > 0.02;
    const a = g.attributes.position;
    for (let i = 0; i < n; i++) {
      const s = seeds[i], ang = s[0] + t * 0.05 * s[2], r = 6 + 34 * ((i * 0.618) % 1);
      a.setXYZ(i, center.x + Math.cos(ang + i) * r + Math.sin(t * 0.7 + s[3]) * 2, 0.4 + 1.8 * (0.5 + 0.5 * Math.sin(t * 0.5 * s[2] + s[3])), center.z + Math.sin(ang + i) * r + Math.cos(t * 0.6 + s[3]) * 2);
    }
    a.needsUpdate = true;
  } };
}

export function createMist(scene) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c), group = new THREE.Group(), mats = [];
  for (let i = 0; i < 46; i++) {
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, color: 0xffffff });
    const s = 260 + rnd() * 380, q = new THREE.Mesh(new THREE.PlaneGeometry(s, s * 0.7), m);
    q.rotation.x = -Math.PI / 2; q.rotation.z = rnd() * 6; q.position.set(lerp(-1100, 1100, rnd()), 2 + rnd() * 5, lerp(-800, 800, rnd())); q.renderOrder = 4;
    q.userData = { v: [(rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.4], base: 0.5 + rnd() * 0.5 }; group.add(q); mats.push(m);
  }
  scene.add(group);
  // v0.4: a sheet fades out as the camera nears its height (seen edge-on it showed as a hard line across the view)
  return { group, update(dt, level, color, camY = 99) { group.children.forEach((q) => { q.position.x += q.userData.v[0] * dt; q.position.z += q.userData.v[1] * dt; const k = Math.min(1, Math.max(0, (camY - q.position.y - 0.8) / 3)); q.material.opacity = level * 0.32 * q.userData.base * k * k; q.material.color.copy(color); }); group.visible = level > 0.01; } };
}

// ------------------------------------------------------------------ towed swimmer (easter egg)
export function createSwimmer(scene) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body); g.visible = false; scene.add(g);
  const vest = flat(0xff6a14, { roughness: 0.7 }), strap = flat(0x1d1d22), skin = flat(0x8a5a44), suit = flat(0x2d3e5c);
  // lying back in the water, head toward the canoe (+z local), feet trailing
  const torso = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 1), vest); torso.scale.set(1.25, 0.75, 1.35); torso.position.set(0, 0.02, 0); body.add(torso);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.07, 6, 10), vest); collar.rotation.x = Math.PI / 2.4; collar.position.set(0, 0.1, 0.3); body.add(collar);
  [-0.12, 0.08].forEach((z) => { const s = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.03, 0.05), strap); s.position.set(0, 0.17, z); body.add(s); });
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 1), skin); head.position.set(0, 0.16, 0.5); body.add(head);
  const hat = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 1), flat(0x2f6a8a)); hat.scale.set(1, 0.7, 1); hat.position.set(0, 0.24, 0.53); body.add(hat);
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.7, 2, 6), suit); legs.rotation.x = Math.PI / 2 - 0.25; legs.position.set(0, -0.18, -0.65); legs.scale.x = 1.7; body.add(legs);
  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.45, 2, 5), vest.clone()); armL.material.color.set(0x2d3e5c);
  const armR = armL.clone(); body.add(armL, armR);
  armL.position.set(0.14, 0.12, 0.62); armL.rotation.set(Math.PI / 2 - 0.5, 0, -0.35);
  armR.position.set(-0.14, 0.12, 0.62); armR.rotation.set(Math.PI / 2 - 0.5, 0, 0.35);
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0xe8d9a8, roughness: 0.9 });
  let rope = null;
  const pos = new THREE.Vector3(), vel = new THREE.Vector3(), stern = new THREE.Vector3(), hands = new THREE.Vector3(), tmp = new THREE.Vector3();
  const LEN = 7;
  const api = {
    group: g, on: false,
    toggle(canoeRoot) {
      api.on = !api.on; g.visible = api.on;
      if (api.on) { canoeRoot.localToWorld(stern.set(0, 0.35, -2.6)); tmp.set(-Math.sin(canoeRoot.rotation.y), 0, -Math.cos(canoeRoot.rotation.y)); pos.copy(stern).addScaledVector(tmp, LEN - 0.5); pos.y = 0; vel.set(0, 0, 0); }
      if (!api.on && rope) { g.parent.remove(rope); rope.geometry.dispose(); rope = null; }
      return api.on;
    },
    position: pos,
    update(dt, t, canoeRoot, ripples) {
      if (!api.on) return;
      canoeRoot.localToWorld(stern.set(0, 0.36, -2.62));
      // water drag + rope constraint (rope only pulls, never pushes)
      vel.multiplyScalar(Math.exp(-1.6 * dt)); pos.addScaledVector(vel, dt);
      tmp.set(pos.x - stern.x, 0, pos.z - stern.z); const d = tmp.length();
      if (d > 3 * LEN) { tmp.normalize(); pos.set(stern.x + tmp.x * LEN, 0, stern.z + tmp.z * LEN); vel.set(0, 0, 0); }
      else if (d > LEN) { tmp.multiplyScalar(1 / d); const over = d - LEN; pos.x -= tmp.x * over; pos.z -= tmp.z * over; const vn = vel.x * tmp.x + vel.z * tmp.z; if (vn > 0) { vel.x -= tmp.x * vn; vel.z -= tmp.z * vn; } vel.x -= tmp.x * over * 3; vel.z -= tmp.z * over * 3; }
      const speed = Math.hypot(vel.x, vel.z);
      g.position.set(pos.x, -0.05 + Math.sin(t * 1.7) * 0.03 + Math.min(speed, 2) * 0.03, pos.z);
      g.rotation.y = Math.atan2(stern.x - pos.x, stern.z - pos.z);
      body.rotation.z = Math.sin(t * 1.3) * 0.12; body.rotation.x = -0.12 - Math.min(speed, 2.5) * 0.05;
      armL.rotation.z = -0.35 + Math.sin(t * 2.1) * 0.08; armR.rotation.z = 0.35 - Math.sin(t * 2.1 + 1) * 0.08;
      api.wake = (api.wake || 0) - dt;
      if (speed > 0.4 && api.wake < 0) { api.wake = 0.5; ripples.spawn(pos.x, pos.z, 1.6 + speed * 0.6, 2.2, 0.28, 0.4); }
      // sagging rope from the stern to the swimmer's hands
      body.localToWorld(hands.set(0, 0.2, 0.95));
      const slack = clamp(1 - d / LEN, 0, 1), pts = [];
      for (let i = 0; i <= 10; i++) {
        const u = i / 10, p = new THREE.Vector3().lerpVectors(stern, hands, u);
        p.y -= Math.sin(u * Math.PI) * (0.12 + slack * 0.6); p.y = Math.max(p.y, 0.02); pts.push(p);
      }
      const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.012, 4);
      if (rope) { rope.geometry.dispose(); rope.geometry = geo; } else { rope = new THREE.Mesh(geo, ropeMat); g.parent.add(rope); }
    },
  };
  return api;
}

/** v0.6.1: the player's canoe built from the Blender canoe + paddler + single paddle, keeping the same hooks main.js animates */
function createCanoeFromModels(root, body, M) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5f30, flatShading: true, roughness: 0.85 });
  const hull = M.canoe.clone(true); hull.position.y = 0.34; body.add(hull);
  // v0.6.11: the player is a cloaked shadow figure (Blender rower.glb); ghosts keep the hatted paddler
  // wrapped so the paddling sway (person.rotation) never touches the model's own orientation; the figure faces the bow
  const person = new THREE.Group(), fig = (M.rower || M.paddler).clone(true); fig.rotation.set(0, 0, 0); person.add(fig); person.position.set(0, 0.1, -0.75); body.add(person);
  const armL = new THREE.Group(), armR = new THREE.Group(); person.add(armL, armR);   // real arms are baked into the model
  const paddle = new THREE.Group(); body.add(paddle);
  // model: blade spans y -0.48..0, shaft 0..1.45, T-grip at 1.51 (Blender Z-up -> Y-up). The pivot is the upper hand,
  // so hang the paddle with the grip just above it and the blade down in the water (same proportions as the old primitive)
  const pd = M.paddleSingle.clone(true); pd.position.y = 0.33 - 1.51; paddle.add(pd);
  const blade = new THREE.Object3D(); blade.position.y = 0.33 - 1.51 - 0.24; paddle.add(blade);   // blade centre, for splashes/drips
  // waterline mask (same as the primitive canoe)
  const L = 2.5, wl = [], NS = 24;
  for (let i = 0; i <= NS; i++) { const s = -0.7 + (1.4 * i) / NS, w = 0.45 * Math.pow(Math.max(1 - Math.pow(Math.abs(s), 2.4), 0), 0.5); wl.push([s * L, 0.8 * w * Math.sqrt(Math.max(1 - Math.pow(s / 0.72, 2), 0))]); }
  const shape = new THREE.Shape(); wl.forEach(([z, w], i) => (i ? shape.lineTo(w, z) : shape.moveTo(w, z))); for (let i = wl.length - 1; i >= 0; i--) shape.lineTo(-wl[i][1], wl[i][0]);
  const maskGeo = new THREE.ShapeGeometry(shape); maskGeo.rotateX(Math.PI / 2);
  const mask = new THREE.Mesh(maskGeo, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })); mask.renderOrder = 0.5; mask.frustumCulled = false; body.add(mask);
  // lantern pole + hanging lantern (unchanged)
  const poleCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.3, 1.95), new THREE.Vector3(0, 1.05, 2.25), new THREE.Vector3(0, 1.6, 2.75), new THREE.Vector3(0, 1.82, 3.25), new THREE.Vector3(0, 1.8, 3.55)]);
  body.add(new THREE.Mesh(new THREE.TubeGeometry(poleCurve, 20, 0.022, 5), wood));
  const hang = new THREE.Group(); hang.position.set(0, 1.78, 3.55); body.add(hang);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.26, 4), wood); cord.position.y = -0.13; hang.add(cord);
  const cage = new THREE.MeshStandardMaterial({ color: 0x2a2620, flatShading: true });
  const capTop = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.07, 6), cage); capTop.position.y = -0.29; hang.add(capTop);
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.07, 0.03, 6), cage); lampBase.position.y = -0.5; hang.add(lampBase);
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4, bar = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.19, 0.01), cage); bar.position.set(Math.cos(a) * 0.06, -0.41, Math.sin(a) * 0.06); hang.add(bar); }
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.17, 8), new THREE.MeshBasicMaterial({ color: 0xffc27a })); lantern.position.y = -0.41; hang.add(lantern);
  const light = new THREE.PointLight(0xffb066, 0, 7, 2); light.position.y = -0.41; hang.add(light);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffa95a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
  halo.scale.setScalar(1.1); halo.position.y = -0.41; hang.add(halo);
  return { root, body, paddle, person, armL, armR, light, halo, lantern, hang, blade, mask };
}
