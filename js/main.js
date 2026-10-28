import * as THREE from 'three';
import { MAP } from './mapdata.js';
import { AmbientAudio } from './audio.js';
import { clamp, lerp, sstep, rnd, pondSD, NQ, EXT, heightAt, buildTerrain, buildPaths, buildTrees, buildMountains, buildCamps, buildDock } from './world.js';
import { createSky, createWater, samplePalette, sunDirection, moonDirection } from './sky.js';
import { createCanoe, Ripples, Loons, Geese, createFireflies, createMist } from './canoe.js';

const DAY_LEN = 540;           // real seconds per 24 in-game hours
const START_HOUR = 5.45;       // just before sunrise: pink horizon, mist on the water
const $ = (id) => document.getElementById(id);
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add('touch');

// ------------------------------------------------------------------ renderer / scene
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xaabbcc, 0.0007);
const camera = new THREE.PerspectiveCamera(58, 1, 0.3, 9000);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 1);
const sunLight = new THREE.DirectionalLight(0xffffff, 1), moonLight = new THREE.DirectionalLight(0x8fa8ff, 0);
scene.add(hemi, sunLight, sunLight.target, moonLight, moonLight.target);

// ------------------------------------------------------------------ build the world
let world = {}, canoe, ripples, loons, geese, flies, mist, sky, water, camps, audio = new AmbientAudio();
const launchInfo = {};
function build() {
  const { depthTex } = buildTerrain(scene);
  sky = createSky(); scene.add(sky);
  water = createWater(depthTex); scene.add(water);
  buildPaths(scene); buildMountains(scene);
  world.stats = buildTrees(scene);
  camps = buildCamps(scene);
  // find the hand launch on the shore, and which way is water
  const L = MAP.launch; pondSD(L[0], L[1]); const qx = NQ.x, qz = NQ.z;
  const e = 4, gx = pondSD(qx + e, qz) - pondSD(qx - e, qz), gz = pondSD(qx, qz + e) - pondSD(qx, qz - e), gl = Math.hypot(gx, gz) || 1;
  const nx = gx / gl, nz = gz / gl;
  let far = 12; while (pondSD(qx + nx * far, qz + nz * far) < 7 && far < 40) far += 4;
  Object.assign(launchInfo, { q: [qx, qz], n: [nx, nz], start: [qx - nx * 9, qz - nz * 9], end: [qx + nx * far, qz + nz * far], psi: Math.atan2(nx, nz) });
  buildDock(scene, [qx - nx * 2.5, qz - nz * 2.5], nx, nz);
  canoe = createCanoe(); scene.add(canoe.root);
  ripples = new Ripples(scene); loons = new Loons(scene, 3); geese = new Geese(scene); flies = createFireflies(scene); mist = createMist(scene);
}

// ------------------------------------------------------------------ state
const P = { x: 0, z: 0, psi: 0, vx: 0, vz: 0, w: 0, phase: 0, side: 1, act: 0, roll: 0, pitch: 0, wakeT: 0, bump: 0 };
const G = { mode: 'title', t: 0, hour: START_HOUR, jump: null, launchT: 0, idle: 0, time: 0 };
const cam = { heading: 0, yaw: 0, pitch: 0.28, dist: 11, pos: new THREE.Vector3(), look: new THREE.Vector3() };
const keys = new Set(); const joy = { x: 0, y: 0 };

function resetPlayer() {
  P.x = launchInfo.start[0]; P.z = launchInfo.start[1]; P.psi = launchInfo.psi; P.vx = P.vz = P.w = 0;
  cam.heading = P.psi; cam.yaw = 0.9;
}

// ------------------------------------------------------------------ input
addEventListener('keydown', (e) => {
  if (e.repeat) return; const k = e.key.toLowerCase(); keys.add(k);
  if (k === 'm') toggleMute();
  if (k >= '1' && k <= '4') jumpTo([5.7, 12, 18.3, 22.5][+k - 1]);
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); G.idle = 0; });
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  cam.yaw -= (e.clientX - drag.x) * 0.0055; cam.pitch = clamp(cam.pitch + (e.clientY - drag.y) * 0.004, 0.04, 1.25);
  drag.x = e.clientX; drag.y = e.clientY; G.idle = 0;
});
const endDrag = (e) => { if (drag && drag.id === e.pointerId) drag = null; };
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => { cam.dist = clamp(cam.dist + e.deltaY * 0.01, 5, 30); }, { passive: true });
// virtual joystick
const joyEl = $('joy'), nub = joyEl.querySelector('i'); let joyId = null;
function joyMove(e) {
  const r = joyEl.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let dx = (e.clientX - cx) / 50, dy = (e.clientY - cy) / 50; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
  joy.x = dx; joy.y = dy; nub.style.transform = `translate(${dx * 38}px,${dy * 38}px)`;
}
joyEl.addEventListener('pointerdown', (e) => { joyId = e.pointerId; joyEl.setPointerCapture(e.pointerId); joyMove(e); e.stopPropagation(); });
joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyMove(e); });
const joyEnd = (e) => { if (e.pointerId === joyId) { joyId = null; joy.x = joy.y = 0; nub.style.transform = ''; } };
joyEl.addEventListener('pointerup', joyEnd); joyEl.addEventListener('pointercancel', joyEnd);

function toggleMute() { audio.setMuted(!audio.muted); $('mute').textContent = audio.muted ? 'Sound off' : 'Sound on'; }
$('mute').addEventListener('click', toggleMute);
document.querySelectorAll('#btns [data-t]').forEach((b) => b.addEventListener('click', () => jumpTo(+b.dataset.t)));
function jumpTo(h) { let to = h; if (to <= G.hour) to += 24; G.jump = { from: G.hour, to, t: 0 }; }

// ------------------------------------------------------------------ minimap
const mini = $('miniC'), mctx = mini.getContext('2d');
const MM = { x0: -1250, x1: 1250, z0: -880, z1: 880 };
const mmX = (x) => ((x - MM.x0) / (MM.x1 - MM.x0)) * mini.width, mmZ = (z) => ((z - MM.z0) / (MM.z1 - MM.z0)) * mini.height;
const staticMap = document.createElement('canvas'); staticMap.width = mini.width; staticMap.height = mini.height;
function drawStaticMap() {
  const c = staticMap.getContext('2d');
  c.fillStyle = '#2b3b2a'; c.fillRect(0, 0, staticMap.width, staticMap.height);
  c.strokeStyle = 'rgba(214,190,140,.7)'; c.lineWidth = 2;
  MAP.roads.forEach((r) => { c.beginPath(); r.pts.forEach((p, i) => (i ? c.lineTo(mmX(p[0]), mmZ(p[1])) : c.moveTo(mmX(p[0]), mmZ(p[1])))); c.stroke(); });
  c.strokeStyle = 'rgba(214,190,140,.35)'; c.lineWidth = 1;
  MAP.trails.forEach((r) => { c.beginPath(); r.pts.forEach((p, i) => (i ? c.lineTo(mmX(p[0]), mmZ(p[1])) : c.moveTo(mmX(p[0]), mmZ(p[1])))); c.stroke(); });
  c.fillStyle = '#3d6e86';
  MAP.others.forEach((o) => { c.beginPath(); o.ring.forEach((p, i) => (i ? c.lineTo(mmX(p[0]), mmZ(p[1])) : c.moveTo(mmX(p[0]), mmZ(p[1])))); c.closePath(); c.fill(); });
  c.beginPath(); MAP.pond.forEach((r) => { r.forEach((p, i) => (i ? c.lineTo(mmX(p[0]), mmZ(p[1])) : c.moveTo(mmX(p[0]), mmZ(p[1])))); c.closePath(); });
  c.fillStyle = '#4f8fb0'; c.fill('evenodd');
  c.fillStyle = '#e8873a'; MAP.camps.forEach((p) => { c.fillRect(mmX(p[0]) - 1.5, mmZ(p[1]) - 1.5, 3, 3); });
  c.fillStyle = '#fff'; c.font = '16px Georgia'; c.fillText('N ↑', 8, 20);
}
function drawMini() {
  mctx.drawImage(staticMap, 0, 0);
  mctx.save(); mctx.translate(mmX(P.x), mmZ(P.z)); mctx.rotate(-P.psi + Math.PI);
  mctx.fillStyle = '#ffe9a8'; mctx.strokeStyle = '#1b2a2a'; mctx.lineWidth = 2;
  mctx.beginPath(); mctx.moveTo(0, -10); mctx.lineTo(6, 8); mctx.lineTo(0, 4); mctx.lineTo(-6, 8); mctx.closePath(); mctx.fill(); mctx.stroke(); mctx.restore();
}

// ------------------------------------------------------------------ physics
const fwdV = new THREE.Vector3(), tmpV = new THREE.Vector3();
function stepCanoe(dt, controllable) {
  let throttle = 0, steer = 0;
  if (controllable) {
    if (keys.has('w') || keys.has('arrowup')) throttle += 1;
    if (keys.has('s') || keys.has('arrowdown')) throttle -= 1;
    if (keys.has('a') || keys.has('arrowleft')) steer += 1;
    if (keys.has('d') || keys.has('arrowright')) steer -= 1;
    if (Math.abs(joy.x) > 0.12 || Math.abs(joy.y) > 0.12) { steer += -joy.x * 1.2; throttle += joy.y < -0.15 ? -joy.y : joy.y > 0.5 ? -0.6 : 0; }
    steer = clamp(steer, -1, 1); throttle = clamp(throttle, -1, 1);
  }
  const hard = controllable && (keys.has('shift') || keys.has(' ')) ? 1.6 : 1;
  const fx = Math.sin(P.psi), fz = Math.cos(P.psi), lx = fz, lz = -fx;
  let vf = P.vx * fx + P.vz * fz, vl = P.vx * lx + P.vz * lz;
  const wants = Math.abs(throttle) > 0.05 || Math.abs(steer) > 0.1;
  P.act = lerp(P.act, wants ? 1 : 0, Math.min(1, dt * 4));
  let thrust = 0;
  if (wants) {
    const prev = P.phase; P.phase += dt / (1.45 / Math.sqrt(hard));
    if (P.phase >= 1) { P.phase -= 1; P.side *= -1; }
    if (prev < 0.04 && P.phase >= 0.04) catchStroke(Math.abs(throttle) > 0.05 ? 1 : 0.6);
    const u = P.phase;
    if (u < 0.5) thrust = Math.sin((u / 0.5) * Math.PI) * 1.55 * hard * (Math.abs(throttle) > 0.05 ? Math.sign(throttle) * (throttle > 0 ? 1 : 0.45) : 0.18);
  } else { P.phase = lerp(P.phase, 0.0, Math.min(1, dt * 2)); }
  vf += (thrust - 0.16 * vf - 0.045 * vf * Math.abs(vf)) * dt;
  vl *= Math.exp(-2.8 * dt);
  const wT = steer * 0.7 * (0.55 + Math.min(Math.abs(vf), 2.2) / 2.2 * 0.5) + (wants ? -P.side * 0.05 * Math.max(thrust, 0) : 0);
  P.w += (wT - P.w) * Math.min(1, dt * 1.8);
  P.psi += P.w * dt;
  P.vx = fx * vf + lx * vl; P.vz = fz * vf + lz * vl;
  P.x += P.vx * dt; P.z += P.vz * dt;
  // keep the canoe on the water
  if (controllable) {
    const sd = pondSD(P.x, P.z);
    if (sd < 4.5) {
      let dx = P.x - NQ.x, dz = P.z - NQ.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; if (sd < 0) { dx = -dx; dz = -dz; }
      const push = 4.5 - sd; P.x += dx * push; P.z += dz * push;
      const vn = P.vx * dx + P.vz * dz;
      if (vn < 0) { if (vn < -0.9 && P.bump <= 0) { audio.knock(); P.bump = 0.6; } P.vx -= dx * vn * 1.15; P.vz -= dz * vn * 1.15; }
    }
  }
  P.bump -= dt;
  const speed = Math.hypot(P.vx, P.vz);
  // wake ripples
  P.wakeT -= dt;
  if (speed > 0.5 && P.wakeT < 0) { P.wakeT = 0.45; ripples.spawn(P.x - fx * 2.5, P.z - fz * 2.5, 2.2 + speed, 2.6, 0.22, 0.5); }
  return { speed, throttle, steer, thrust };
}
function catchStroke(power) {
  const w = new THREE.Vector3(); canoe.blade.getWorldPosition(w);
  ripples.spawn(w.x, w.z, 2.2, 2.2, 0.45, 0.15); ripples.spawn(w.x, w.z, 1.2, 1.2, 0.5, 0.1);
  audio.splash(clamp(-P.side * 0.45, -1, 1), power);
}

function poseCanoe(dt, t, speed) {
  const c = canoe;
  const bob = Math.sin(t * 1.25) * 0.012 + Math.sin(t * 2.1 + 1) * 0.006;
  P.roll = lerp(P.roll, clamp(-P.w * 0.18, -0.12, 0.12) + Math.sin(t * 0.9) * 0.006, Math.min(1, dt * 3));
  P.pitch = lerp(P.pitch, Math.sin(t * 1.1 + 2) * 0.008 + (G.mode === 'launch' ? -0.03 : 0), Math.min(1, dt * 3));
  const groundY = Math.max(heightAt(P.x, P.z), 0);
  c.root.position.set(P.x, 0.1 + bob + (groundY > 0.05 ? groundY : 0), P.z);
  c.root.rotation.set(P.pitch, P.psi, P.roll, 'YXZ');
  // paddle pose
  const u = P.phase, s = P.side, a = P.act;
  let pitch, roll;
  if (u < 0.5) { pitch = lerp(-0.7, 0.6, u / 0.5); roll = 0.3; } else { pitch = lerp(0.6, -0.7, (u - 0.5) / 0.5); roll = lerp(0.3, 1.05, Math.sin(((u - 0.5) / 0.5) * Math.PI)); }
  const px = lerp(0, s * 0.42, a), py = lerp(0.32, 0.95, a), pz = lerp(-0.1, -0.45, a);
  c.paddle.position.set(px, py, pz);
  c.paddle.rotation.set(pitch * a, 0, lerp(Math.PI / 2, s * roll, a));
  c.armL.position.set(0.27, 0.58, 0.14); c.armR.position.set(-0.27, 0.58, 0.14);
  c.armL.rotation.set(-0.8 - pitch * 0.4 * a, 0, -0.15 * a * (s > 0 ? 1.8 : 0.5));
  c.armR.rotation.set(-0.8 - pitch * 0.4 * a, 0, 0.15 * a * (s < 0 ? 1.8 : 0.5));
  c.person.rotation.x = 0.1 * pitch * a; c.person.rotation.z = -s * 0.04 * a;
}

// ------------------------------------------------------------------ camera
function updateCamera(dt, t) {
  let targetYaw = cam.yaw;
  if (G.mode === 'title') {
    cam.heading = launchInfo.psi; cam.yaw = 0.9 + Math.sin(t * 0.07) * 0.5; cam.pitch = 0.2; cam.dist = 15 + Math.sin(t * 0.05) * 2; targetYaw = cam.yaw;
  } else if (G.mode === 'launch') {
    const k = clamp(G.launchT / 8, 0, 1); cam.yaw = lerp(0.9, 0, sstep(0, 1, k)); cam.pitch = lerp(0.2, 0.3, k); cam.dist = lerp(15, 11, k);
  } else {
    G.idle += dt; if (G.idle > 5 && !drag) { cam.yaw *= Math.exp(-dt * 0.45); cam.pitch = lerp(cam.pitch, 0.3, Math.min(1, dt * 0.3)); }
    cam.heading += (((P.psi - cam.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 1.6);
  }
  const a = cam.heading + cam.yaw, cp = Math.cos(cam.pitch);
  tmpV.set(P.x - Math.sin(a) * cp * cam.dist, 0.9 + Math.sin(cam.pitch) * cam.dist, P.z - Math.cos(a) * cp * cam.dist);
  tmpV.y = Math.max(tmpV.y, Math.max(heightAt(tmpV.x, tmpV.z), 0) + 1.4);
  cam.pos.lerp(tmpV, G.mode === 'title' ? 1 : Math.min(1, dt * 6));
  camera.position.copy(cam.pos);
  cam.look.set(P.x + Math.sin(P.psi) * 3, 1.0, P.z + Math.cos(P.psi) * 3);
  camera.lookAt(cam.look);
}

// ------------------------------------------------------------------ day / night
const sunV = new THREE.Vector3(), moonV = new THREE.Vector3(), tintC = new THREE.Color();
let lastHud = 0;
function updateEnvironment(dt, t) {
  if (G.jump) {
    G.jump.t += dt / 2.6; const k = clamp(G.jump.t, 0, 1), e = k * k * (3 - 2 * k);
    G.hour = (lerp(G.jump.from, G.jump.to, e)) % 24; if (k >= 1) G.jump = null;
  } else if (G.mode !== 'title') G.hour = (G.hour + (dt * 24) / DAY_LEN) % 24;
  const h = G.hour, pal = samplePalette(h);
  sunDirection(h, sunV); moonDirection(h, moonV);
  const sunI = sstep(-0.03, 0.2, sunV.y), moonVis = sstep(-0.02, 0.2, moonV.y) * (1 - sstep(0.0, 0.3, sunV.y));
  const night = 1 - sstep(-0.18, 0.04, sunV.y), glow = sstep(-0.16, 0.06, sunV.y);
  const stars = clamp((-sunV.y - 0.04) / 0.25, 0, 1);
  const twilight = sstep(-0.3, -0.04, sunV.y) * (1 - sstep(0.0, 0.2, sunV.y));
  const day = sstep(0.04, 0.35, sunV.y);
  // lights
  sunLight.color.copy(pal.sun); sunLight.intensity = 3.2 * sunI; sunLight.position.set(P.x + sunV.x * 300, sunV.y * 300 + 20, P.z + sunV.z * 300); sunLight.target.position.set(P.x, 0, P.z);
  moonLight.intensity = 0.8 * moonVis; moonLight.position.set(P.x + moonV.x * 300, moonV.y * 300 + 20, P.z + moonV.z * 300); moonLight.target.position.set(P.x, 0, P.z);
  hemi.color.copy(pal.hemiS); hemi.groundColor.copy(pal.hemiG); hemi.intensity = pal.hemiI * 1.15;
  scene.fog.color.copy(pal.fog); scene.fog.density = pal.fogD; scene.background = null;
  // sky
  const su = sky.material.uniforms; su.uTop.value.copy(pal.top); su.uMid.value.copy(pal.mid); su.uHor.value.copy(pal.hor);
  su.uSun.value.copy(sunV); su.uMoon.value.copy(moonV); su.uSunCol.value.copy(pal.sun.clone().multiplyScalar(0.9));
  su.uSunI.value = sstep(-0.012, 0.03, sunV.y); su.uGlow.value = glow; su.uMoonI.value = moonVis; su.uStars.value = stars; su.uTime.value = t;
  su.uCloudLit.value.copy(pal.hor).lerp(tintC.set(0xffffff), 0.45 * day).multiplyScalar(0.8 + 0.5 * day); su.uCloudShade.value.copy(pal.mid).multiplyScalar(0.55);
  sky.position.copy(camera.position);
  // water
  const wu = water.material.uniforms; wu.uTime.value = t; wu.uSun.value.copy(sunV); wu.uMoon.value.copy(moonV); wu.uSunCol.value.copy(pal.sun);
  wu.uSunI.value = sstep(-0.02, 0.1, sunV.y); wu.uMoonI.value = moonVis; wu.uSkyTop.value.copy(pal.top).lerp(pal.mid, 0.3); wu.uSkyHor.value.copy(pal.hor);
  wu.uFog.value.copy(pal.fog); wu.uFogD.value = pal.fogD; wu.uLight.value = clamp(0.1 + 0.9 * sstep(-0.1, 0.4, sunV.y) + 0.14 * moonVis, 0, 1);
  // lanterns
  const lamp = 1 - sstep(-0.06, 0.14, sunV.y), flick = 0.85 + 0.15 * Math.sin(t * 9) * Math.sin(t * 5.3);
  canoe.light.intensity = 9 * lamp; canoe.halo.material.opacity = 0.85 * lamp; canoe.lantern.material.color.setRGB(1, 0.6 + 0.2 * (1 - lamp), 0.35 + 0.3 * (1 - lamp));
  canoe.lantern.getWorldPosition(tmpV); wu.uLantern.value.copy(tmpV); wu.uLanternI.value = lamp;
  camps.glows.forEach((g) => { g.s.material.opacity = lamp * (g.big ? 0.8 : 0.45) * (0.82 + 0.18 * Math.sin(t * 7 + g.ph) * Math.sin(t * 3.1 + g.ph)); });
  // wildlife & atmosphere
  const bothTw = twilight;
  flies.update(P, t, clamp((night * 0.9 + bothTw * 0.6) * (h > 17 || h < 5 ? 1 : 0.2), 0, 0.95));
  const mistLevel = sstep(4.6, 5.6, h) * (1 - sstep(7.2, 9.6, h)) * 1.0 + 0.12 * twilight;
  mist.update(dt, clamp(mistLevel, 0, 1), tintC.copy(pal.fog).lerp(new THREE.Color(1, 1, 1), 0.35));
  ripples.update(dt, tintC.copy(pal.hor).lerp(new THREE.Color(1, 1, 1), 0.35 * day + 0.1));
  loons.update(dt, t, P, ripples, (x, z) => audio.plop(clamp((x - P.x) / 200, -1, 1)));
  geese.update(dt, t, P, () => audio.honkFlock(clamp(rnd() * 2 - 1, -0.7, 0.7)), day + (h > 5 && h < 8 ? 1 : 0) > 0.5);
  // fish rising
  if (G.mode === 'play' && rnd() < dt * 0.18) { const a = rnd() * 6.28, r = 12 + rnd() * 70, x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r; if (pondSD(x, z) > 6) { ripples.spawn(x, z, 3.2, 3, 0.55, 0.2); ripples.spawn(x, z, 1.6, 1.6, 0.4, 0.1); audio.plop(clamp((x - P.x) / 80, -1, 1)); } }
  // audio state + HUD
  const dawn = sstep(4.6, 5.8, h) * (1 - sstep(7.5, 9.5, h)), dusk = sstep(16.5, 18, h) * (1 - sstep(19.8, 21, h));
  audio.update({ night, day, dawn, dusk, speed: Math.hypot(P.vx, P.vz) });
  if (t - lastHud > 0.25) {
    lastHud = t; const hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ap = hh >= 12 ? 'PM' : 'AM', h12 = hh % 12 || 12;
    $('time').textContent = `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
    $('phase').textContent = h < 4.5 || h >= 20.5 ? 'Night' : h < 5.4 ? 'Before dawn' : h < 7 ? 'Sunrise' : h < 11 ? 'Morning' : h < 15 ? 'Midday' : h < 17.4 ? 'Afternoon' : h < 18.5 ? 'Golden hour' : h < 19.4 ? 'Sunset' : 'Dusk';
  }
}

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock(); let started = false;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05); G.time += dt;
  let info = { speed: 0 };
  if (G.mode === 'launch') {
    G.launchT += dt; const k = clamp(G.launchT / 6.5, 0, 1), e = k * k * (3 - 2 * k);
    P.x = lerp(launchInfo.start[0], launchInfo.end[0], e); P.z = lerp(launchInfo.start[1], launchInfo.end[1], e); P.psi = launchInfo.psi;
    P.vx = (launchInfo.end[0] - launchInfo.start[0]) * 6 * k * (1 - k) / 6.5; P.vz = (launchInfo.end[1] - launchInfo.start[1]) * 6 * k * (1 - k) / 6.5;
    P.act = lerp(P.act, 0, Math.min(1, dt * 3));
    if (G.launchT > 2.0 && !G.splashed) { G.splashed = true; ripples.spawn(launchInfo.q[0], launchInfo.q[1], 6, 3.4, 0.6, 0.5); audio.plop(0); audio.splash(0, 1.2); }
    if (G.launchT > 3.5 && !G.toast2) { G.toast2 = true; $('toast').textContent = ''; $('toast').classList.remove('on'); }
    if (k >= 1) { G.mode = 'play'; document.body.classList.add('play'); setTimeout(() => $('hint').classList.add('fade'), 14000); }
    info.speed = Math.hypot(P.vx, P.vz);
  } else if (G.mode === 'play') info = stepCanoe(dt, true);
  else { /* title: canoe waits on the bank */ }
  poseCanoe(dt, G.time, info.speed);
  updateCamera(dt, G.time);
  updateEnvironment(dt, G.time);
  if (G.mode === 'play' || G.mode === 'launch') drawMini();
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------ boot
function startGame() {
  if (started) return; started = true;
  audio.start(); G.mode = 'launch'; G.launchT = 0;
  $('title').classList.add('hide');
  const toast = $('toast'); toast.textContent = 'Launching'; toast.classList.add('on');
  setTimeout(() => { toast.classList.remove('on'); }, 3200);
  document.body.classList.add('play');
}
$('start').addEventListener('click', startGame);
addEventListener('keydown', (e) => { if (!started && (e.key === 'Enter') && !$('start').disabled) startGame(); });

setTimeout(() => {
  try {
    const t0 = performance.now(); build(); resetPlayer(); drawStaticMap();
    cam.pos.set(P.x, 5, P.z - 12);
    window.game = { P, G, cam, scene, camera, setHour: (h) => { G.hour = h; }, teleport: (x, z, psi) => { P.x = x; P.z = z; if (psi !== undefined) P.psi = psi; cam.heading = P.psi; }, start: startGame, launchInfo, step: (n, dt, ctl) => { const r = []; for (let i = 0; i < n; i++) r.push(stepCanoe(dt, ctl !== false)); return r[r.length - 1]; }, stats: world.stats, keys };
    console.log('Floodwood Pond built in', Math.round(performance.now() - t0), 'ms', world.stats);
    $('start').disabled = false; $('start').textContent = 'Launch canoe';
    frame();
  } catch (err) { console.error(err); $('start').textContent = 'Error — see console'; }
}, 60);
