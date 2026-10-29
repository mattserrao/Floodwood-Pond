import * as THREE from 'three';
import { MAP } from './mapdata.js';
import { AmbientAudio } from './audio.js';
import { clamp, lerp, sstep, rnd, pondSD, NQ, EXT, heightAt, buildTerrain, buildPaths, buildTrees, buildMountains, buildCamps, buildDock, buildIsland, ISLE, buildCreek, CREEK, creekSD, CQ, cullTiles, setLitterScale, SWAY, WORLD } from './world.js';
import { createSky, createWater, createReflection, samplePalette, sunDirection, moonDirection } from './sky.js';
import { createPost } from './post.js';
import { createCanoe, Ripples, Loons, Geese, createFireflies, createMist, createSwimmer } from './canoe.js';
import { WIND, gustAt, updateWind } from './wind.js';
import { Q } from './quality.js';
import { WX } from './weather.js';
import { createWildlife } from './wildlife.js';
import { createFloatingLeaves, createFallingLeaves, createDrips, createRain } from './details.js';
import { createStory } from './story.js';

const DAY_LEN = 540;           // real seconds per 24 in-game hours
const START_HOUR = 5.45;       // just before sunrise: pink horizon, mist on the water
const $ = (id) => document.getElementById(id);
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add('touch');

// ------------------------------------------------------------------ renderer / scene
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const dprFor = (q) => Math.min(window.devicePixelRatio || 1, q.pixelRatio, isTouch ? 1.5 : 2);
renderer.setPixelRatio(dprFor(Q.s));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.info.autoReset = false; // reset once per frame so the counts cover every pass (reflection + main + post)
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xaabbcc, 0.0007);
const camera = new THREE.PerspectiveCamera(58, 1, 0.3, 9000);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const post = createPost(renderer);
const refl = createReflection(renderer);
addEventListener('resize', () => { post.setSize(); refl.resize(); });

const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 1);
const sunLight = new THREE.DirectionalLight(0xffffff, 1), moonLight = new THREE.DirectionalLight(0x8fa8ff, 0);
scene.add(hemi, sunLight, sunLight.target, moonLight, moonLight.target);

// ------------------------------------------------------------------ build the world
let world = {}, story = null, swimmer, canoe, ripples, loons, geese, flies, mist, sky, water, camps, wild, floatLeaves, fallLeaves, drips, rain, audio = new AmbientAudio();
const launchInfo = {};
function build() {
  const { depthTex } = buildTerrain(scene);
  sky = createSky(); scene.add(sky);
  water = createWater(depthTex); scene.add(water);
  buildPaths(scene); buildMountains(scene);
  world.stats = buildTrees(scene);
  world.isle = buildIsland(scene);
  buildCreek(scene);
  camps = buildCamps(scene);
  // find the hand launch on the shore, and which way is water
  const L = MAP.launch; pondSD(L[0], L[1]); const qx = NQ.x, qz = NQ.z;
  const e = 4, gx = pondSD(qx + e, qz) - pondSD(qx - e, qz), gz = pondSD(qx, qz + e) - pondSD(qx, qz - e), gl = Math.hypot(gx, gz) || 1;
  const nx = gx / gl, nz = gz / gl;
  let far = 12; while (pondSD(qx + nx * far, qz + nz * far) < 7 && far < 40) far += 4;
  Object.assign(launchInfo, { q: [qx, qz], n: [nx, nz], start: [qx - nx * 9, qz - nz * 9], end: [qx + nx * far, qz + nz * far], psi: Math.atan2(nx, nz) });
  buildDock(scene, [qx - nx * 2.5, qz - nz * 2.5], nx, nz);
  canoe = createCanoe(); scene.add(canoe.root);
  // the canoe and paddler read as a silhouette against the water and sky (lantern still glows)
  canoe.sil = new THREE.MeshBasicMaterial({ color: 0x0b0d10, side: THREE.DoubleSide });
  canoe.body.traverse((o) => { if (o.isMesh && o !== canoe.lantern && o.material.colorWrite !== false) o.material = canoe.sil; });
  ripples = new Ripples(scene, 160); swimmer = createSwimmer(scene); loons = new Loons(scene, 3); geese = new Geese(scene); flies = createFireflies(scene); mist = createMist(scene);
  loons.onRun = (l) => { audio.wings({ x: l.x, y: 0.5, z: l.z }, 1.2); if (rnd() < 0.6 && audio.ctx) audio.loon(audio.ctx.currentTime + 0.3, { x: l.x, y: 1, z: l.z }); };
  loons.onLand = (l) => audio.splash(0, 0.9, { x: l.x, y: 0, z: l.z });
  audio.loonPos = () => { const v = loons.list.filter((l) => l.g.visible); const l = v.length ? v[Math.floor(rnd() * v.length)] : null; return l ? { x: l.x, y: 1, z: l.z } : audio.woods(150, 500, 1); };
  wild = createWildlife(scene, Q.s.wildlife);
  floatLeaves = createFloatingLeaves(scene, 300); fallLeaves = createFallingLeaves(scene, floatLeaves); drips = createDrips(scene); rain = createRain(scene, 1400);
  // things that must not show up in the mirrored treeline
  refl.hide.push(water, ripples.mesh, mist.group, rain.lines, drips.points, floatLeaves.mesh, canoe.mask, WORLD.pads);
  applyQuality();
  // v0.5: the journey of memories (disable with ?free=1 for the old free-roam game)
  if (!new URLSearchParams(location.search).has('free')) story = createStory({ scene, camera, P, G, audio, ripples, canoe, launchInfo, post, dragging: () => !!drag });
}
// ------------------------------------------------------------------ quality tiers
function applyQuality() {
  const q = Q.s;
  renderer.setPixelRatio(dprFor(q)); renderer.setSize(innerWidth, innerHeight, false);
  post.setQuality(q); refl.setScale(q.refl);
  if (water) water.material.uniforms.uReflOn.value = q.refl > 0 ? 1 : 0;
  if (floatLeaves) floatLeaves.setCount(q.leaves);
  if (rain) rain.setCount(q.rain);
  setLitterScale(q.litter);
  const el = document.getElementById('pQual'); if (el) el.textContent = 'Graphics: ' + Q.label();
}
Q.onChange(applyQuality);

// ------------------------------------------------------------------ state
const P = { x: 0, z: 0, psi: 0, vx: 0, vz: 0, w: 0, phase: 0, side: -1, act: 0, roll: 0, pitch: 0, wakeT: 0, bump: 0 };
const VERSION = '0.5.0';
const G = { fog: 0, fogLift: 0, transport: null, moonPhase: 0.15 + Math.random() * 0.7, moonUp: null, paused: false, mapOpen: false, menu: false, snap: false, mode: 'title', t: 0, hour: START_HOUR, jump: null, launchT: 0, idle: 0, time: 0 };
const cam = { heading: 0, yaw: 0, pitch: 0.28, dist: 11, pos: new THREE.Vector3(), look: new THREE.Vector3() };
const keys = new Set(); const joy = { x: 0, y: 0 };

function resetPlayer() {
  P.x = launchInfo.start[0]; P.z = launchInfo.start[1]; P.psi = launchInfo.psi; P.vx = P.vz = P.w = 0;
  cam.heading = P.psi; cam.yaw = 0.9;
}

// ------------------------------------------------------------------ input
addEventListener('keydown', (e) => {
  if (e.repeat) return; const k = e.key.toLowerCase();
  if (k === 'escape' || k === 'p') { if (G.mapOpen) closeMap(); else if (!G.menu) setPaused(!G.paused); return; }
  if (k === 'm') { toggleMute(); return; }
  if (G.paused || G.mapOpen || G.menu) return;
  keys.add(k);
  if (k >= '1' && k <= '4') jumpTo([5.7, 12, 18.3, 22.5][+k - 1]);
  if (k === 'n' && G.mode === 'play') openMap();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden && G.mode === 'play' && !G.menu) setPaused(true); });
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY }; canvas.setPointerCapture(e.pointerId); G.idle = 0; });
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  cam.yaw -= (e.clientX - drag.x) * 0.0055; cam.pitch = clamp(cam.pitch + (e.clientY - drag.y) * 0.004, 0.04, 1.25);
  drag.x = e.clientX; drag.y = e.clientY; G.idle = 0;
});
const endDrag = (e) => {
  if (drag && drag.id === e.pointerId) { if (e.type === 'pointerup' && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 10) tapCanoe(e); drag = null; }
};
// triple-tap the canoe: someone in a life vest grabs a tow rope (tap three times again to let go)
const ray = new THREE.Raycaster(), taps = [];
function tapCanoe(e) {
  if (G.mode !== 'play' || G.paused || G.mapOpen || G.menu) return;
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = ray.intersectObject(canoe.root, true).length > 0 || (swimmer.on && ray.intersectObject(swimmer.group, true).length > 0);
  const now = performance.now();
  if (!hit) { taps.length = 0; return; }
  taps.push(now); while (taps.length && now - taps[0] > 900) taps.shift();
  if (taps.length >= 3) { taps.length = 0; const on = swimmer.toggle(canoe.root); audio.splash(0, on ? 1.2 : 0.6); if (on) ripples.spawn(swimmer.position.x, swimmer.position.z, 4, 2.6, 0.5, 0.3); }
}
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

function toggleMute() {
  audio.setMuted(!audio.muted);
  const label = audio.muted ? 'Sound off' : 'Sound on';
  $('mute').textContent = label; $('pMute').textContent = label;
}
$('mute').addEventListener('click', toggleMute);
document.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => jumpTo(+b.dataset.t)));
function jumpTo(h) { if (G.paused) { G.hour = h; G.jump = null; return; } let to = h; if (to <= G.hour) to += 24; G.jump = { from: G.hour, to, t: 0 }; }

// ------------------------------------------------------------------ pause / main menu
function setPaused(p) {
  if (G.mode === 'title') return;
  G.paused = p; keys.clear(); joy.x = joy.y = 0;
  $('pause').classList.toggle('on', p);
  audio.setPaused(p || G.menu);
}
$('pauseBtn').addEventListener('click', () => setPaused(true));
$('pResume').addEventListener('click', () => setPaused(false));
$('pMute').addEventListener('click', toggleMute);
$('pMood').addEventListener('click', () => { post.enabled = !post.enabled; $('pMood').textContent = post.enabled ? 'Mood filter on' : 'Mood filter off'; try { localStorage.setItem('fp-mood', post.enabled ? '1' : '0'); } catch (e) {} });
try { if (localStorage.getItem('fp-mood') === '0') { post.enabled = false; $('pMood').textContent = 'Mood filter off'; } } catch (e) {}
// v0.4: cinematic 30 fps (physics stays at full rate) with motion blur, optional letterbox, graphics tier
const CINE = { on: false, box: false, lastDraw: 0 };
function setCine(on) { CINE.on = on; post.motionBlur = on; $('pCine').textContent = on ? 'Cinematic 30 fps on' : 'Cinematic 30 fps off'; try { localStorage.setItem('fp-cine', on ? '1' : '0'); } catch (e) {} }
function setBox(on) { CINE.box = on; document.body.classList.toggle('box', on); $('pBox').textContent = on ? 'Letterbox on' : 'Letterbox off'; try { localStorage.setItem('fp-box', on ? '1' : '0'); } catch (e) {} }
$('pCine').addEventListener('click', () => setCine(!CINE.on));
$('pBox').addEventListener('click', () => setBox(!CINE.box));
$('pQual').addEventListener('click', () => Q.cycle());
try { const qs = new URLSearchParams(location.search); setCine(qs.has('cine') ? qs.get('cine') !== '0' : localStorage.getItem('fp-cine') === '1'); setBox(qs.has('box') ? qs.get('box') !== '0' : localStorage.getItem('fp-box') === '1'); } catch (e) {}
$('pRestart').addEventListener('click', () => {
  resetPlayer(); G.mode = 'launch'; G.launchT = 0; G.splashed = false; G.snap = true; P.act = 0;
  setPaused(false);
});
$('pMenu').addEventListener('click', () => {
  G.menu = true; $('pause').classList.remove('on'); G.paused = false; audio.setPaused(true);
  document.body.classList.remove('play'); $('title').classList.remove('hide');
});

// ------------------------------------------------------------------ minimap + big map
const MM = { x0: -1450, x1: 1250, z0: -880, z1: 1080 };
function drawMap(cv, big) {
  const c = cv.getContext('2d'), W = cv.width, H = cv.height;
  const X = (x) => ((x - MM.x0) / (MM.x1 - MM.x0)) * W, Z = (z) => ((z - MM.z0) / (MM.z1 - MM.z0)) * H, k = W / 380;
  const line = (pts) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(X(p[0]), Z(p[1])) : c.moveTo(X(p[0]), Z(p[1])))); };
  c.fillStyle = '#2b3b2a'; c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(214,190,140,.7)'; c.lineWidth = 2 * k; MAP.roads.forEach((r) => { line(r.pts); c.stroke(); });
  c.strokeStyle = 'rgba(214,190,140,.35)'; c.lineWidth = 1 * k; MAP.trails.forEach((r) => { line(r.pts); c.stroke(); });
  c.fillStyle = '#3d6e86'; MAP.others.forEach((o) => { line(o.ring); c.closePath(); c.fill(); });
  c.strokeStyle = '#4f8fb0'; c.lineCap = c.lineJoin = 'round';
  for (let i = 0; i < CREEK.pts.length - 1; i++) { const a = CREEK.pts[i], b = CREEK.pts[i + 1]; c.lineWidth = Math.max(2 * a[2] * (W / (MM.x1 - MM.x0)), 2 * k); c.beginPath(); c.moveTo(X(a[0]), Z(a[1])); c.lineTo(X(b[0]), Z(b[1])); c.stroke(); }
  c.beginPath(); MAP.pond.forEach((r) => { r.forEach((p, i) => (i ? c.lineTo(X(p[0]), Z(p[1])) : c.moveTo(X(p[0]), Z(p[1])))); c.closePath(); });
  c.fillStyle = '#4f8fb0'; c.fill('evenodd');
  if (big) { c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1.2 * k; c.stroke(); }
  c.fillStyle = '#e8873a'; const cs = 3 * k; MAP.camps.forEach((p) => c.fillRect(X(p[0]) - cs / 2, Z(p[1]) - cs / 2, cs, cs));
  c.fillStyle = '#fff'; c.font = `${Math.round(16 * Math.min(k, 1.6))}px Georgia`; c.fillText('N ↑', 8 * k, 20 * k);
  if (big) {
    c.font = `italic ${Math.round(13 * Math.min(k, 1.5))}px Georgia`; c.fillStyle = 'rgba(255,248,230,.9)'; c.textAlign = 'center';
    const isl = MAP.pond.slice(1).sort((a, b) => b.length - a.length)[0];
    if (isl) { const cx = isl.reduce((s, p) => s + p[0], 0) / isl.length, cz = isl.reduce((s, p) => s + p[1], 0) / isl.length; c.fillText('Big Island', X(cx), Z(cz) - 12 * k); }
    c.fillText('Hand launch', X(launchInfo.q[0]), Z(launchInfo.q[1]) - 8 * k);
    c.fillText('Floodwood Pond', X(250), Z(120));
    c.textAlign = 'left';
  }
  return { X, Z };
}
function drawCanoeMarker(cv, X, Z, scale) {
  const c = cv.getContext('2d'); c.save(); c.translate(X(P.x), Z(P.z)); c.rotate(-P.psi + Math.PI); c.scale(scale, scale);
  c.fillStyle = '#ffe9a8'; c.strokeStyle = '#1b2a2a'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(0, -10); c.lineTo(6, 8); c.lineTo(0, 4); c.lineTo(-6, 8); c.closePath(); c.fill(); c.stroke(); c.restore();
}
const mini = $('miniC'), staticMap = document.createElement('canvas'); staticMap.width = mini.width; staticMap.height = mini.height;
let miniXZ = null;
function drawStaticMap() { miniXZ = drawMap(staticMap, false); }
function drawMini() { mini.getContext('2d').drawImage(staticMap, 0, 0); drawCanoeMarker(mini, miniXZ.X, miniXZ.Z, 1); }

const big = $('bigC');
let bigXZ = null;
function openMap() {
  if (G.mode !== 'play' || G.paused || G.menu) return;
  const aspect = (MM.x1 - MM.x0) / (MM.z1 - MM.z0);
  let w = Math.min(innerWidth * 0.94, 1000), h = w / aspect;
  if (h > innerHeight * 0.78) { h = innerHeight * 0.78; w = h * aspect; }
  const dpr = Math.min(devicePixelRatio || 1, 2);
  big.style.width = w + 'px'; big.style.height = h + 'px'; big.width = Math.round(w * dpr); big.height = Math.round(h * dpr);
  bigXZ = drawMap(big, true); drawCanoeMarker(big, bigXZ.X, bigXZ.Z, big.width / 380 * 0.9);
  G.mapOpen = true; keys.clear(); joy.x = joy.y = 0; $('bigmap').classList.add('on');
}
function closeMap() { G.mapOpen = false; $('bigmap').classList.remove('on'); }
$('mini').addEventListener('click', (e) => { e.stopPropagation(); openMap(); });
$('mapClose').addEventListener('click', (e) => { e.stopPropagation(); closeMap(); });
$('bigmap').addEventListener('click', (e) => { if (e.target.id === 'bigmap') closeMap(); });
big.addEventListener('click', (e) => {
  const r = big.getBoundingClientRect();
  const x = MM.x0 + ((e.clientX - r.left) / r.width) * (MM.x1 - MM.x0), z = MM.z0 + ((e.clientY - r.top) / r.height) * (MM.z1 - MM.z0);
  travelTo(x, z); closeMap();
});
/** Move the canoe to the nearest open water at (x, z), facing away from the closest shore. */
function travelTo(x, z) {
  let sd = pondSD(x, z), tx = x, tz = z;
  const grad = (px, pz) => { const e = 3, gx = pondSD(px + e, pz) - pondSD(px - e, pz), gz = pondSD(px, pz + e) - pondSD(px, pz - e), l = Math.hypot(gx, gz) || 1; return [gx / l, gz / l]; };
  if (sd < 10) {
    pondSD(x, z); const qx = NQ.x, qz = NQ.z; const [nx, nz] = grad(qx, qz);
    let d = 10; while (pondSD(qx + nx * d, qz + nz * d) < 9 && d < 40) d += 3;
    tx = qx + nx * d; tz = qz + nz * d; sd = pondSD(tx, tz);
  }
  P.x = tx; P.z = tz; P.vx = P.vz = P.w = 0; P.act = 0;
  if (sd < 40) { const [nx, nz] = grad(tx, tz); P.psi = Math.atan2(nx, nz); }
  cam.heading = P.psi; cam.yaw = 0; G.snap = true;
  ripples.spawn(tx, tz, 5, 3, 0.5, 0.4); audio.splash(0, 0.6);
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
    // auto paddle: after a quiet spell, gently follow the shoreline around the pond
    const manual = Math.abs(throttle) > 0.05 || Math.abs(steer) > 0.05 || keys.size > 0;
    if (manual || G.transport) { G.quiet = 0; if (AUTO.on) setAuto(false); }
    else { G.quiet = (G.quiet || 0) + dt; if (!AUTO.on && G.quiet > AUTO_DELAY) setAuto(true); }
    if (AUTO.on) { const a = autoPilot(); throttle = a.throttle; steer = a.steer; }
  }
  const hard = controllable && (keys.has('shift') || keys.has(' ')) ? 1.6 : 1;
  const fx = Math.sin(P.psi), fz = Math.cos(P.psi), lx = fz, lz = -fx;
  let vf = P.vx * fx + P.vz * fz, vl = P.vx * lx + P.vz * lz;
  const wants = Math.abs(throttle) > 0.05 || Math.abs(steer) > 0.1;
  P.act = lerp(P.act, wants ? 1 : 0, Math.min(1, dt * 4));
  let thrust = 0;
  if (wants) {
    const prev = P.phase; P.phase += dt / (1.45 / Math.sqrt(hard));
    if (P.phase >= 1) P.phase -= 1; // always the same side (J-stroke keeps the line straight)
    if (prev < 0.04 && P.phase >= 0.04) catchStroke(Math.abs(throttle) > 0.05 ? 1 : 0.6);
    if (prev < 0.5 && P.phase >= 0.5) releaseStroke(hard);
    const u = P.phase;
    if (u < 0.5) thrust = Math.sin((u / 0.5) * Math.PI) * 1.55 * hard * (AUTO.on ? 0.6 : 1) * (Math.abs(throttle) > 0.05 ? Math.sign(throttle) * (throttle > 0 ? 1 : 0.45) : 0.18);
  } else if (P.act > 0.02) { P.phase = (P.phase + dt / 1.6) % 1; } // finish the motion while the paddle settles
  // gliding (no paddle in the water) keeps most of its momentum; paddling adds stroke drag
  const lin = lerp(0.035, 0.16, P.act), quad = lerp(0.012, 0.045, P.act);
  // wind: a gust pushes the canoe downwind (mostly sideways - a canoe has little grip in the water) and weathervanes the stern
  const gu = gustAt(P.x, P.z), wpush = (WIND.base * 0.03 + gu * 0.09) * (NQ.creek ? 0.2 : 1);
  const wf = WIND.dir.x * fx + WIND.dir.y * fz, wl = WIND.dir.x * lx + WIND.dir.y * lz;
  vf += (thrust - lin * vf - quad * vf * Math.abs(vf) + wf * wpush * 0.4) * dt;
  vl += wl * wpush * dt; vl *= Math.exp(-(1.2 + 1.6 * P.act) * dt);
  P.w += Math.sin(Math.atan2(WIND.dir.x, WIND.dir.y) - P.psi) * wpush * 0.18 * dt * (1 - P.act * 0.7);
  P.gust = gu;
  const wT = steer * 0.7 * (0.55 + Math.min(Math.abs(vf), 2.2) / 2.2 * 0.5);
  P.w += (wT - P.w) * Math.min(1, dt * 1.8);
  P.psi += P.w * dt; P.turnAmt = steer;
  P.vx = fx * vf + lx * vl; P.vz = fz * vf + lz * vl;
  P.x += P.vx * dt; P.z += P.vz * dt;
  // keep the canoe on the water
  if (controllable) {
    const sd = pondSD(P.x, P.z);
    const nearBeach = Math.hypot(P.x - ISLE.beach[0], P.z - ISLE.beach[1]) < 35, margin = NQ.creek ? 1.7 : nearBeach ? 1.4 : 4.5;
    if (sd < margin) {
      let dx = P.x - NQ.x, dz = P.z - NQ.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; if (sd < 0) { dx = -dx; dz = -dz; }
      const push = margin - sd; P.x += dx * push; P.z += dz * push;
      const vn = P.vx * dx + P.vz * dz;
      if (vn < 0) { if (vn < -0.9 && P.bump <= 0) { audio.knock(); P.bump = 0.6; } P.vx -= dx * vn * 1.15; P.vz -= dz * vn * 1.15; }
    }
  }
  // creek boulders
  if (controllable) for (const r of CREEK.rocks) {
    const dx = P.x - r.x, dz = P.z - r.z, d = Math.hypot(dx, dz), min = r.r + 1.1;
    if (d < min && d > 1e-4) {
      const nx = dx / d, nz = dz / d; P.x = r.x + nx * min; P.z = r.z + nz * min;
      const vn = P.vx * nx + P.vz * nz; if (vn < 0) { if (vn < -0.6 && P.bump <= 0) { audio.knock(); P.bump = 0.6; } P.vx -= nx * vn * 1.2; P.vz -= nz * vn * 1.2; }
    }
  }
  P.bump -= dt;
  const speed = Math.hypot(P.vx, P.vz);
  // wake ripples
  P.wakeT -= dt;
  if (speed > 0.5 && P.wakeT < 0) { P.wakeT = 0.45; ripples.spawn(P.x - fx * 2.5, P.z - fz * 2.5, 2.2 + speed, 2.6, 0.22, 0.5); }
  P.pull = thrust > 0 ? clamp(thrust / 1.6, 0, 1) : 0;
  return { speed, throttle, steer, thrust };
}
// ------------------------------------------------------------------ auto paddle
const AUTO_DELAY = 8;
const AUTO = { on: false, path: [], idx: 0, dir: 1 };
function buildAutoPath() {
  const ring = MAP.pond[0], pts = [];
  const grad = (x, z) => { const e = 3, gx = pondSD(x + e, z) - pondSD(x - e, z), gz = pondSD(x, z + e) - pondSD(x, z - e), l = Math.hypot(gx, gz) || 1; return [gx / l, gz / l]; };
  // resample the shoreline every ~18 m, then push each point out into open water (~32 m from any shore)
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 18));
    for (let j = 0; j < n; j++) {
      let x = lerp(a[0], b[0], j / n), z = lerp(a[1], b[1], j / n), best = null, bsd = -1e9;
      for (let k = 0; k < 40; k++) {
        const sd = pondSD(x, z); if (sd > bsd) { bsd = sd; best = [x, z]; } if (sd >= 32) break;
        const [gx, gz] = grad(x, z); x += gx * 3; z += gz * 3;
      }
      if (bsd > 8) pts.push(best);
    }
  }
  let path = pts;
  for (let it = 0; it < 3; it++) { const o = []; for (let i = 0; i < path.length; i++) { const p = path[(i - 1 + path.length) % path.length], c = path[i], n = path[(i + 1) % path.length]; o.push([(p[0] + 2 * c[0] + n[0]) / 4, (p[1] + 2 * c[1] + n[1]) / 4]); } path = o; }
  AUTO.path = path.filter((p) => pondSD(p[0], p[1]) > 10);
}
function setAuto(on) {
  AUTO.on = on; $('auto').classList.toggle('on', on);
  if (!on) return;
  if (!AUTO.path.length && !story) buildAutoPath();
  if (story) return;
  let bi = 0, bd = 1e18; AUTO.path.forEach((p, i) => { const d = (p[0] - P.x) ** 2 + (p[1] - P.z) ** 2; if (d < bd) { bd = d; bi = i; } });
  const N = AUTO.path.length, a = AUTO.path[bi], b = AUTO.path[(bi + 1) % N];
  AUTO.dir = Math.sin(P.psi) * (b[0] - a[0]) + Math.cos(P.psi) * (b[1] - a[1]) >= 0 ? 1 : -1; // keep going the way we face
  AUTO.idx = bi;
}
function autoPilot() {
  const N = Math.max(1, AUTO.path.length);
  // advance the waypoint once we're close to it, aim a few points ahead for smooth curves
  for (let k = 0; k < 4 && !story; k++) { const p = AUTO.path[AUTO.idx]; if (Math.hypot(p[0] - P.x, p[1] - P.z) < 26) AUTO.idx = (AUTO.idx + AUTO.dir + N) % N; else break; }
  const st = story && story.autoTarget(); const t = st || AUTO.path[AUTO.idx];
  let want = Math.atan2(t[0] - P.x, t[1] - P.z);
  // steer around islands/points: pick the clear heading closest to the target direction
  const clear = (a, len) => { for (let d = 4; d <= len; d += 4) if (pondSD(P.x + Math.sin(a) * d, P.z + Math.cos(a) * d) < 5) return false; return true; };
  const look = Math.min(30, Math.hypot(t[0] - P.x, t[1] - P.z));
  if (!clear(want, look)) {
    for (let k = 1; k <= 8; k++) {
      const off = k * 0.2;
      if (clear(want + off * AUTO.dir * -1, 24)) { want += -off * AUTO.dir; break; }
      if (clear(want + off * AUTO.dir, 24)) { want += off * AUTO.dir; break; }
    }
  }
  // unstick: if barely moving for a while, skip ahead
  AUTO.slow = Math.hypot(P.vx, P.vz) < 0.25 ? (AUTO.slow || 0) + 1 / 60 : 0;
  if (AUTO.slow > 4 && !story) { AUTO.idx = (AUTO.idx + AUTO.dir * 3 + N) % N; AUTO.slow = 0; }
  const diff = ((want - P.psi + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return { throttle: Math.abs(diff) > 1.4 ? 0.25 : 1, steer: clamp(diff * 1.6, -0.8, 0.8) };
}

const bladeW = new THREE.Vector3();
function catchStroke(power) {
  canoe.blade.getWorldPosition(bladeW);
  ripples.spawn(bladeW.x, bladeW.z, 2.2, 2.2, 0.45, 0.15); ripples.spawn(bladeW.x, bladeW.z, 1.2, 1.2, 0.5, 0.1);
  audio.strokeCatch(clamp(-P.side * 0.45, -1, 1), power);
}
function releaseStroke(power) {
  canoe.blade.getWorldPosition(bladeW);
  ripples.spawn(bladeW.x, bladeW.z, 1.4, 1.5, 0.35, 0.1);
  audio.strokeRelease(clamp(-P.side * 0.45, -1, 1), Math.min(1.2, power));
  drips.emit(bladeW, 5, P.vx, P.vz);
}
/** water runs off the blade through the recovery, and keeps dripping for a while once you stop */
function updateDrips(dt) {
  if (G.mode !== 'play' && G.mode !== 'launch') return;
  canoe.blade.getWorldPosition(bladeW);
  const recovering = P.act > 0.3 && P.phase > 0.5 && P.phase < 0.92;
  P.wetBlade = recovering ? 1 : Math.max(0, (P.wetBlade || 0) - dt / 14);
  const rate = recovering ? 14 : P.wetBlade * 1.6;
  if (bladeW.y > 0.08 && rnd() < dt * rate) drips.emit(bladeW, 1);
  drips.update(dt, ripples, () => audio.drip(clamp(-P.side * 0.4, -1, 1)));
}

function poseCanoe(dt, t, speed) {
  const c = canoe;
  const bob = Math.sin(t * 1.25) * 0.012 + Math.sin(t * 2.1 + 1) * 0.006;
  P.roll = lerp(P.roll, clamp(-P.w * 0.18, -0.12, 0.12) + Math.sin(t * 0.9) * 0.006, Math.min(1, dt * 3));
  P.pitch = lerp(P.pitch, Math.sin(t * 1.1 + 2) * 0.008 + (G.mode === 'launch' ? -0.03 : 0), Math.min(1, dt * 3));
  const groundY = Math.max(heightAt(P.x, P.z), 0);
  c.root.position.set(P.x, 0.1 + bob + (groundY > 0.05 ? groundY : 0), P.z);
  c.root.rotation.set(P.pitch, P.psi, P.roll, 'YXZ');
  c.mask.position.y = 0.1 - c.root.position.y; // above ripples (y 0.06) and the water plane, below the inner floor
  // lantern swings like a pendulum, pushed by surges, turns and the bob of the hull
  const vfNow = P.vx * Math.sin(P.psi) + P.vz * Math.cos(P.psi), accel = (vfNow - (P.vfPrev ?? vfNow)) / Math.max(dt, 1e-3); P.vfPrev = vfNow;
  P.lx = P.lx || 0; P.lz = P.lz || 0; P.lvx = P.lvx || 0; P.lvz = P.lvz || 0;
  if (dt > 0) {
    P.lvx += (-14 * P.lx - 1.6 * P.lvx + clamp(accel, -3, 3) * 1.4 + Math.sin(t * 1.1) * 0.25) * dt; P.lx += P.lvx * dt;
    P.lvz += (-14 * P.lz - 1.6 * P.lvz - P.w * 5 + Math.sin(t * 0.8 + 1) * 0.2) * dt; P.lz += P.lvz * dt;
  }
  c.hang.rotation.set(clamp(P.lx, -0.6, 0.6) - P.pitch, 0, clamp(P.lz, -0.6, 0.6) - P.roll);
  // paddle pose
  const u = P.phase, s = P.side, a = P.act;
  // one continuous, eased cycle: pull back with the blade in the water, then lift and feather forward
  const ph = u * Math.PI * 2, lift = Math.pow(Math.max(0, -Math.sin(ph)), 1.6);
  const pitch = -0.05 - 0.65 * Math.cos(ph), roll = 0.3 + 0.55 * lift;
  const ae = a * a * (3 - 2 * a);
  c.paddle.position.set(lerp(0, s * 0.42, ae), lerp(0.32, 0.95, ae) + 0.08 * lift * ae, lerp(-0.1, -0.45, ae));
  c.paddle.rotation.set(pitch * ae, 0.25 * lift * s * ae, lerp(Math.PI / 2, s * roll, ae));
  c.armL.position.set(0.27, 0.58, 0.14); c.armR.position.set(-0.27, 0.58, 0.14);
  c.armL.rotation.set(-0.8 - pitch * 0.4 * a, 0, -0.15 * a * (s > 0 ? 1.8 : 0.5));
  c.armR.rotation.set(-0.8 - pitch * 0.4 * a, 0, 0.15 * a * (s < 0 ? 1.8 : 0.5));
  c.person.rotation.x = 0.1 * pitch * a; c.person.rotation.z = -s * 0.04 * a;
}

// ------------------------------------------------------------------ camera
function updateCamera(dt, t) {
  if (G.debugCam) { camera.position.set(...G.debugCam.pos); camera.lookAt(...G.debugCam.look); return; }
  if (G.mode === 'intro' && story) { if (story.introCamera(dt)) { story.endIntro(); cam.pos.copy(camera.position); cam.heading = P.psi; G.mode = 'launch'; G.launchT = 0; document.body.classList.add('play'); } return; }
  let targetYaw = cam.yaw;
  if (G.mode === 'title') {
    cam.heading = launchInfo.psi; cam.yaw = 0.9 + Math.sin(t * 0.07) * 0.5; cam.pitch = 0.2; cam.dist = 15 + Math.sin(t * 0.05) * 2; targetYaw = cam.yaw;
  } else if (G.mode === 'launch') {
    const k = clamp(G.launchT / 8, 0, 1); cam.yaw = lerp(0.9, 0, sstep(0, 1, k)); cam.pitch = lerp(0.2, 0.3, k); cam.dist = lerp(15, 11, k);
  } else {
    G.idle += dt; if (G.idle > 5 && !drag) { cam.yaw *= Math.exp(-dt * 0.45); cam.pitch = lerp(cam.pitch, 0.3, Math.min(1, dt * 0.3)); }
    cam.heading += (((P.psi - cam.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 1.6);
  }
  const a = cam.heading + cam.yaw + (story && G.mode !== 'title' ? story.glanceYaw : 0), cp = Math.cos(cam.pitch);
  tmpV.set(P.x - Math.sin(a) * cp * cam.dist, 0.9 + Math.sin(cam.pitch) * cam.dist, P.z - Math.cos(a) * cp * cam.dist);
  tmpV.y = Math.max(tmpV.y, Math.max(heightAt(tmpV.x, tmpV.z), 0) + 1.4);
  cam.pos.lerp(tmpV, G.mode === 'title' || G.snap ? 1 : Math.min(1, dt * 6)); G.snap = false;
  camera.position.copy(cam.pos);
  const lb = story ? Math.abs(story.glanceYaw) / Math.PI : 0; // while glancing back, look past the canoe into the mist
  cam.look.set(P.x + Math.sin(P.psi) * 3 * (1 - 2.2 * lb), 1.0 + 1.5 * lb, P.z + Math.cos(P.psi) * 3 * (1 - 2.2 * lb));
  camera.lookAt(cam.look);
}

// ------------------------------------------------------------------ day / night
const sunV = new THREE.Vector3(), moonV = new THREE.Vector3(), tintC = new THREE.Color(), greyA = new THREE.Color(), greyB = new THREE.Color();
let lastHud = 0;
function updateEnvironment(dt, t) {
  if (G.jump) {
    G.jump.t += dt / 2.6; const k = clamp(G.jump.t, 0, 1), e = k * k * (3 - 2 * k);
    G.hour = (lerp(G.jump.from, G.jump.to, e)) % 24; if (k >= 1) G.jump = null;
  } else if (G.mode !== 'title') G.hour = (G.hour + (dt * 24) / DAY_LEN) % 24;
  const h = G.hour, pal = samplePalette(h);
  WX.update(G.mode !== 'title' ? dt : 0, h, DAY_LEN);
  updateWind(dt, t, WX.wind); SWAY.uTime.value = t;
  const cover = WX.cloud;
  sunDirection(h, sunV); moonDirection(h, moonV);
  const sunI = sstep(-0.03, 0.2, sunV.y) * (1 - 0.8 * cover), moonVis = sstep(-0.01, 0.06, moonV.y) * (1 - sstep(0.0, 0.3, sunV.y));
  const night = 1 - sstep(-0.18, 0.04, sunV.y), glow = sstep(-0.16, 0.06, sunV.y);
  const stars = clamp((-sunV.y - 0.04) / 0.25, 0, 1) * (1 - 0.95 * cover);
  const twilight = sstep(-0.3, -0.04, sunV.y) * (1 - sstep(0.0, 0.2, sunV.y));
  const day = sstep(0.04, 0.35, sunV.y);
  // a new moon phase each moonrise
  const up = moonV.y > -0.02; if (G.moonUp === false && up) G.moonPhase = 0.08 + Math.random() * 0.84; G.moonUp = up;
  const moonFrac = 0.5 - 0.5 * Math.cos(G.moonPhase * Math.PI * 2);
  // grey days: flatten and desaturate the palette toward a soft, even light
  if (cover > 0.01) {
    const lvl = 0.25 + 0.75 * sstep(-0.2, 0.3, sunV.y);
    ['top', 'mid', 'hor', 'fog', 'hemiS'].forEach((k) => { const L = (pal[k].r + pal[k].g + pal[k].b) / 3; pal[k].lerp(greyA.setRGB(L * 0.92, L * 0.96, L * 1.02), cover * 0.7).lerp(greyB.setRGB(0.42, 0.45, 0.48).multiplyScalar(lvl), cover * 0.35); });
    pal.hemiI *= 1 + 0.25 * cover;
  }
  // lights
  sunLight.color.copy(pal.sun); sunLight.intensity = 3.2 * sunI; sunLight.position.set(P.x + sunV.x * 300, sunV.y * 300 + 20, P.z + sunV.z * 300); sunLight.target.position.set(P.x, 0, P.z);
  moonLight.intensity = 0.8 * moonVis * (0.2 + 0.8 * moonFrac); moonLight.position.set(P.x + moonV.x * 300, moonV.y * 300 + 20, P.z + moonV.z * 300); moonLight.target.position.set(P.x, 0, P.z);
  hemi.color.copy(pal.hemiS); hemi.groundColor.copy(pal.hemiG); hemi.intensity = pal.hemiI * 1.15;
  const fogA = clamp(G.fog, 0, 1);
  // v0.4: haze follows the day - thick at dawn and at night, clearest at midday - plus fog mornings and rain
  const dawnHaze = sstep(4.3, 5.6, h) * (1 - sstep(7.4, 10, h)), nightHaze = night * (1 - dawnHaze);
  pal.fogD *= (1 + 1.1 * dawnHaze + 0.7 * nightHaze) * (1 - 0.12 * day);
  if (story) pal.fogD *= story.fogMul;
  pal.fogD += WX.fog * 0.0028 + cover * 0.00035 + WX.rain * 0.0011;
  if (WX.fog > 0.01 || WX.rain > 0.01) pal.fog.lerp(greyA.setRGB(0.62, 0.65, 0.68).multiplyScalar(0.25 + 0.75 * sstep(-0.2, 0.3, sunV.y)), clamp(WX.fog * 0.7 + WX.rain * 0.5, 0, 0.85));
  const fogTint = pal.fog.clone().lerp(tintC.setRGB(0.86, 0.88, 0.9), 0.25 + 0.45 * day).multiplyScalar(0.35 + 0.65 * Math.max(day, 0.25));
  const fogCol = pal.fog.clone().lerp(fogTint, fogA), fogD = lerp(pal.fogD, 0.05, Math.pow(fogA, 1.4));
  scene.fog.color.copy(fogCol); scene.fog.density = fogD; scene.background = null;
  $('veil').style.background = '#' + fogTint.clone().convertLinearToSRGB().getHexString();
  // sky
  const su = sky.material.uniforms; su.uTop.value.copy(pal.top); su.uMid.value.copy(pal.mid); su.uHor.value.copy(pal.hor);
  su.uSun.value.copy(sunV); su.uMoon.value.copy(moonV); su.uSunCol.value.copy(pal.sun.clone().multiplyScalar(0.9));
  su.uSunI.value = sstep(-0.012, 0.03, sunV.y) * (1 - cover); su.uGlow.value = glow * (1 - 0.75 * cover); su.uCover.value = cover; su.uMoonI.value = moonVis * (1 - 0.9 * cover); su.uStars.value = stars; su.uTime.value = t; su.uPhase.value = G.moonPhase; su.uFogCol.value.copy(fogCol); su.uFogMix.value = fogA * 0.92;
  su.uCloudLit.value.copy(pal.hor).lerp(tintC.set(0xffffff), 0.45 * day).multiplyScalar(0.8 + 0.5 * day); su.uCloudShade.value.copy(pal.mid).multiplyScalar(0.55);
  sky.position.copy(camera.position);
  // water
  const wu = water.material.uniforms; wu.uTime.value = t; wu.uSun.value.copy(sunV); wu.uMoon.value.copy(moonV); wu.uSunCol.value.copy(pal.sun);
  wu.uSunI.value = sstep(-0.02, 0.1, sunV.y); wu.uMoonI.value = moonVis * (0.15 + 0.85 * moonFrac); wu.uSkyTop.value.copy(pal.top).lerp(pal.mid, 0.3); wu.uSkyHor.value.copy(pal.hor);
  wu.uFog.value.copy(fogCol); wu.uFogD.value = fogD; wu.uRain.value = WX.rain; wu.uCover.value = cover;
  wu.uTreeCol.value.setRGB(0.04, 0.08, 0.05).multiplyScalar(0.3 + 0.7 * clamp(0.1 + 0.9 * sstep(-0.1, 0.4, sunV.y), 0, 1)).lerp(fogCol, clamp(1 - Math.exp(-Math.pow(450 * fogD, 2)), 0, 1));
  wu.tRefl.value = refl.rt.texture; wu.uReflRes.value.set(refl.rt.width, refl.rt.height); wu.uTexMat.value = refl.texMat; // same object: refl.render() updates it just before the main pass
  post.uniforms.uMist.value = 1 + WX.fog * 0.8 + WX.wet * 0.6; post.uniforms.uDim.value = cover * 0.6 + WX.rain * 0.4;
  // the fog decides how far you can see; whole forest tiles past that are skipped
  G.visDist = Math.min(9000, 2.4 / Math.max(fogD, 1e-5));
  cullTiles(camera.position, G.visDist, Math.min(G.visDist, 320), 900); wu.uLight.value = clamp(0.1 + 0.9 * sstep(-0.1, 0.4, sunV.y) + 0.14 * moonVis, 0, 1);
  // lanterns
  const lamp = 1 - sstep(-0.06, 0.14, sunV.y), flick = 0.85 + 0.15 * Math.sin(t * 9) * Math.sin(t * 5.3);
  canoe.light.intensity = 2.2 * lamp;
  canoe.sil.color.copy(pal.fog).multiplyScalar(0.02 + 0.015 * day).lerp(tintC.setRGB(0.004, 0.005, 0.008), 0.5); canoe.halo.material.opacity = 0.85 * lamp; canoe.lantern.material.color.setRGB(1, 0.6 + 0.2 * (1 - lamp), 0.35 + 0.3 * (1 - lamp));
  canoe.lantern.getWorldPosition(tmpV); wu.uLantern.value.copy(tmpV); wu.uLanternI.value = lamp;
  camps.glows.forEach((g) => { g.s.material.opacity = lamp * (g.big ? 0.8 : 0.45) * (0.82 + 0.18 * Math.sin(t * 7 + g.ph) * Math.sin(t * 3.1 + g.ph)); });
  // wildlife & atmosphere
  const bothTw = twilight;
  flies.update(P, t, clamp((night * 0.9 + bothTw * 0.6) * (h > 17 || h < 5 ? 1 : 0.2), 0, 0.95));
  const mistLevel = sstep(4.6, 5.6, h) * (1 - sstep(7.2, 9.6, h)) * 1.0 + 0.12 * twilight + WX.fog * 0.6 + WX.wet * 0.5;
  mist.update(dt, clamp(mistLevel + fogA, 0, 1), tintC.copy(pal.fog).lerp(greyB.setRGB(1, 1, 1), 0.35), camera.position.y);
  ripples.update(dt, tintC.copy(pal.hor).lerp(new THREE.Color(1, 1, 1), 0.35 * day + 0.1));
  loons.update(dt, t, P, ripples, (x, z) => audio.plop(clamp((x - P.x) / 200, -1, 1)));
  geese.update(dt, t, P, () => audio.honkFlock(0, { x: geese.start.x, y: geese.start.y, z: geese.start.z }), day + (h > 5 && h < 8 ? 1 : 0) > 0.5);
  if (G.mode !== 'title') wild.update(dt, t, { P, hour: h, day, night, audio, ripples, rain: WX.rain > 0.2, clock: WX.clock || 0, dayLen: DAY_LEN, forceMoose: G.forceMoose });
  floatLeaves.update(dt, t, P, Math.hypot(P.vx, P.vz)); fallLeaves.update(dt, t, P);
  rain.update(dt, camera.position, WX.rain, greyA.copy(fogCol).lerp(greyB.setRGB(1, 1, 1), 0.4));
  if (WX.rain > 0.05 && rnd() < dt * 40 * WX.rain) { const a = rnd() * 6.28, r = 3 + rnd() * 30, x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r; if (pondSD(x, z) > 0.5) ripples.spawn(x, z, 0.5 + rnd() * 0.4, 1, 0.25, 0.05); }
  // fish rising
  if (G.mode === 'play' && rnd() < dt * 0.18) { const a = rnd() * 6.28, r = 12 + rnd() * 70, x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r; if (pondSD(x, z) > 6) { ripples.spawn(x, z, 3.2, 3, 0.55, 0.2); ripples.spawn(x, z, 1.6, 1.6, 0.4, 0.1); audio.plop(clamp((x - P.x) / 80, -1, 1)); } }
  // audio state + HUD
  const dawn = sstep(4.6, 5.8, h) * (1 - sstep(7.5, 9.5, h)), dusk = sstep(16.5, 18, h) * (1 - sstep(19.8, 21, h));
  camera.getWorldDirection(tmpV); audio.setListener(camera.position, tmpV, camera.up);
  audio.update({ night, day, dawn, dusk, speed: Math.hypot(P.vx, P.vz), paddling: P.act, rain: WX.rain, gust: P.gust || 0, pull: (P.pull || 0) * P.act, turn: P.turnAmt || 0, play: G.mode === 'play' });
  if (t - lastHud > 0.25) {
    lastHud = t; const hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ap = hh >= 12 ? 'PM' : 'AM', h12 = hh % 12 || 12;
    $('time').textContent = `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
    const wl = WX.label(); $('phase').textContent = (wl ? wl + ' · ' : '') + (h < 4.5 || h >= 20.5 ? 'Night' : h < 5.4 ? 'Before dawn' : h < 7 ? 'Sunrise' : h < 11 ? 'Morning' : h < 15 ? 'Midday' : h < 17.4 ? 'Afternoon' : h < 18.5 ? 'Golden hour' : h < 19.4 ? 'Sunset' : 'Dusk');
  }
}

// ------------------------------------------------------------------ the creek: fog rolls in, then you wake up by the island
function updateCreek(dt) {
  let approach = 0;
  if (creekSD(P.x, P.z) > -6) approach = sstep(CREEK.L * 0.35, CREEK.L * 0.82, CQ.s);
  G.fogLift = Math.max(0, G.fogLift - dt / 8);
  const veil = $('veil');
  if (!G.transport && approach > 0.97) { G.transport = { t: 0, moved: false }; audio.chime(); }
  if (G.transport) {
    const T = G.transport; T.t += dt; P.vx *= 0.97; P.vz *= 0.97;
    if (T.t > 1.9 && !T.moved) {
      T.moved = true; const b = ISLE.beach;
      P.x = b[0] + ISLE.bdx * 7; P.z = b[1] + ISLE.bdz * 7; P.psi = Math.atan2(-ISLE.bdx, -ISLE.bdz); P.vx = P.vz = P.w = 0;
      cam.heading = P.psi; cam.yaw = 0.35; G.snap = true; G.fogLift = 1;
    }
    veil.style.opacity = T.t < 2.4 ? sstep(0, 1.7, T.t) : 1 - sstep(2.4, 6, T.t);
    if (T.t > 6) { G.transport = null; veil.style.opacity = 0; }
    G.fog = 1;
  } else {
    G.fog = Math.max(approach, G.fogLift);
    veil.style.opacity = (approach * 0.4).toFixed(3);
  }
}

function updateCreekFog(dt) {
  const approach = creekSD(P.x, P.z) > -6 ? sstep(CREEK.L * 0.3, CREEK.L * 0.9, CQ.s) : 0;
  G.fog = G.mode === 'ending' ? 1 : approach;
  if (G.mode !== 'ending') $('veil').style.opacity = (approach * 0.5).toFixed(3);
}

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock(); let started = false;
let lastFrameMs = 0;
function frame(now) {
  requestAnimationFrame(frame);
  now = now || performance.now(); lastFrameMs = now;
  const raw = Math.min(clock.getDelta(), 0.05), dt = G.paused || G.mapOpen || G.menu ? 0 : raw; G.time += dt;
  let info = { speed: 0 };
  if (G.mode === 'launch') {
    G.launchT += dt; const k = clamp(G.launchT / 6.5, 0, 1), e = k * k * (3 - 2 * k);
    P.x = lerp(launchInfo.start[0], launchInfo.end[0], e); P.z = lerp(launchInfo.start[1], launchInfo.end[1], e); P.psi = launchInfo.psi;
    P.vx = (launchInfo.end[0] - launchInfo.start[0]) * 6 * k * (1 - k) / 6.5; P.vz = (launchInfo.end[1] - launchInfo.start[1]) * 6 * k * (1 - k) / 6.5;
    P.act = lerp(P.act, 0, Math.min(1, dt * 3));
    if (G.launchT > 2.0 && !G.splashed) { G.splashed = true; ripples.spawn(launchInfo.q[0], launchInfo.q[1], 6, 3.4, 0.6, 0.5); audio.plop(0); audio.splash(0, 1.2); }
    if (k >= 1) { G.mode = 'play'; document.body.classList.add('play'); setTimeout(() => $('hint').classList.add('fade'), 14000); }
    info.speed = Math.hypot(P.vx, P.vz);
  } else if (G.mode === 'play') { info = stepCanoe(dt, !G.transport); if (story) { story.update(dt, G.time); updateCreekFog(dt); } else updateCreek(dt); }
  else if (G.mode === 'ending') { info = stepCanoe(dt, false); P.vx *= Math.exp(-0.3 * dt); P.vz *= Math.exp(-0.3 * dt); updateCreekFog(dt); }
  else { /* title: canoe waits on the bank */ }
  poseCanoe(dt, G.time, info.speed);
  swimmer.update(dt, G.time, canoe.root, ripples);
  updateCamera(dt, G.time);
  updateEnvironment(dt, G.time);
  updateDrips(dt);
  if (G.mode === 'play' || G.mode === 'launch') drawMini();
  if (story && G.mode !== 'play' && G.mode !== 'ending') story.update(0, G.time);
  // cinematic mode: simulate every frame, but only render ~30 times a second (even on 60/120 Hz screens)
  const sinceDraw = CINE.lastDraw ? now - CINE.lastDraw : 1000;
  const calibrating = (G.mode === 'play' || G.mode === 'launch') && !G.paused && !document.hidden && Q.sample(Math.min(sinceDraw, 250));
  if (CINE.on && !calibrating && sinceDraw < 1000 / 30 - 4) return;
  CINE.lastDraw = now; renderer.info.reset();
  camera.updateMatrixWorld();
  if (Q.s.refl > 0) {
    // the mirror is low-res and mostly shows the shoreline: skip litter and far reeds, pull the far cull in
    cullTiles(camera.position, Math.min(G.visDist || 3000, 1700), 0, 260);
    refl.render(scene, camera, sky);
    cullTiles(camera.position, G.visDist || 3000, Math.min(G.visDist || 3000, 320), 900);
  }
  if (post.active) {
    const useSun = sunV.y > -0.05, L = useSun ? sunV : moonV;
    post.render(scene, camera, G.time, L, useSun ? sunLight.color : tintC.setRGB(0.6, 0.7, 1.0), scene.fog.color);
  } else renderer.render(scene, camera);
}

// ------------------------------------------------------------------ boot
// Title screen is pure scenery + version number. The first tap / click / key launches the canoe.
let ready = false, pendingStart = false;
function startGame() {
  audio.start();                          // must happen inside the user gesture (iOS)
  if (!ready) { pendingStart = true; return; }
  if (started) {
    if (G.menu) { G.menu = false; $('title').classList.add('hide'); document.body.classList.add('play'); audio.setPaused(false); }
    return;
  }
  started = true;
  $('title').classList.add('hide');
  if (story) { G.mode = 'intro'; story.startIntro(); return; }
  G.mode = 'launch'; G.launchT = 0;
  document.body.classList.add('play');
}
const onTitleGesture = (e) => { if (!$('title').classList.contains('hide')) { e.preventDefault(); startGame(); } };
$('title').addEventListener('click', onTitleGesture);
$('endcard').addEventListener('click', () => location.reload());
$('title').addEventListener('touchend', onTitleGesture, { passive: false });
addEventListener('keydown', (e) => { if ((!started || G.menu) && !['escape', 'm', 'p'].includes(e.key.toLowerCase())) onTitleGesture(e); });

setTimeout(() => {
  try {
    const t0 = performance.now(); build(); resetPlayer(); drawStaticMap();
    cam.pos.set(P.x, 5, P.z - 12);
    document.querySelectorAll('.ver').forEach((el) => (el.textContent = 'v' + VERSION));
    window.game = { leaves: () => floatLeaves, audio, simulate: (n, dt = 0.05) => { for (let i = 0; i < n; i++) { G.time += dt; if (G.mode === 'play') { stepCanoe(dt, false); if (story) story.update(dt, G.time); } poseCanoe(dt, G.time, Math.hypot(P.vx, P.vz)); updateCamera(dt, G.time); updateEnvironment(dt, G.time); updateDrips(dt); } }, Q, WX, WIND, CINE, setCine, setBox, wild: () => wild, renderer, refl, setWeather: (k) => { WX.forced = k; WX.roll(false); WX.cloud = k === 'overcast' || k === 'rain' ? 0.9 : WX.cloud; WX.fog = k === 'fog' ? 1 : 0; if (k !== 'rain') WX.shower = null; }, P, G, cam, scene, camera, setHour: (h) => { G.hour = h; }, teleport: (x, z, psi) => { P.x = x; P.z = z; if (psi !== undefined) P.psi = psi; cam.heading = P.psi; }, start: startGame, launchInfo, step: (n, dt, ctl) => { const r = []; for (let i = 0; i < n; i++) r.push(stepCanoe(dt, ctl !== false)); return r[r.length - 1]; }, stats: world.stats, isle: () => world.isle, story: () => story, CREEK, heightAt, keys, travelTo, openMap, setPaused, AUTO, setAuto, swimmer: () => swimmer, post, canoe: () => canoe };
    console.log('Floodwood Pond built in', Math.round(performance.now() - t0), 'ms', world.stats);
    ready = true; frame();
    if (pendingStart) startGame();
  } catch (err) { console.error(err); }
}, 60);
