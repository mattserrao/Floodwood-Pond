// v0.16.0: bikefree's lighting (fidelity steps 4 and 6, the Zwift-look grade and canopy shade, 24-26 Nov), ported:
//   SkyEnvironment  the sky dome rendered into a prefiltered environment map (PMREM) and set as scene.environment, so
//                   every standard material takes its ambient light (and its faint sheen) from the sky it stands
//                   under - blue from above, warm from the sun's side - over the ground's colour below; the hemisphere
//                   light cut back to a fill (bikefree: environment = hemi x .75, hemi x .3). Floodwood's sky moves, so
//                   the map is rebuilt as the light changes (a little at a time: a few times a minute at most).
//   installGrade    the key/fill grade, in the tone mapping itself (CustomToneMapping: ACES first), so every path
//                   gets it - the post pass, the plain canvas, the reflection's tone-mapped pieces. Floodwood: half
//                   way between v0.15's natural grade and bikefree's warm, saturated one (user, 27 Nov: "In between").
//   CanopyShade     dappled sun under the trees (bikefree atmosphere/canopy-shade.js): the crowns drawn into a small
//                   map of a plane above the ground, each where its shade falls along the sun's ray; a lit surface
//                   follows its own ray to the plane and reads it - inside a crown's shade, sun flecks. patchCanopy()
//                   adds it to the sun's light in every standard material. With a shadow map (Medium, High) the near
//                   trees' cards already throw real shade, so the canopy takes over beyond it (the far shores); on Low
//                   it is the trees' only shade.
import * as THREE from 'three';

// ------------------------------------------------------------------ sky as environment light
export class SkyEnvironment {
  constructor(renderer) {
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene = new THREE.Scene();
    // the lower half: the ground's colour (bounce light from below), not the sky's haze
    this.groundMat = new THREE.MeshBasicMaterial({ color: 0x3a3f34, side: THREE.DoubleSide, toneMapped: false });
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(20000, 32).rotateX(-Math.PI / 2), this.groundMat);
    this.ground.position.y = -2;
    this.rt = null; this.texture = null; this.at = -1e9; this.key = null;
  }
  /** Rebuild from the sky dome's current look over the ground's colour (call after the sky's uniforms are set). */
  update(sky, groundColor) {
    const m = new THREE.Mesh(sky.geometry, sky.material); m.frustumCulled = false;
    if (groundColor) this.groundMat.color.copy(groundColor);
    this.scene.clear(); this.scene.add(m, this.ground);
    const fog = this.renderer.getRenderTarget();
    const rt = this.pmrem.fromScene(this.scene, 0, 1, 13000);
    this.renderer.setRenderTarget(fog);
    this.rt?.dispose(); this.rt = rt; this.texture = rt.texture;
    return this.texture;
  }
  /** Rebuild when due: `sig` is a few numbers that say how the light looks; at most every `minGap` seconds. */
  maybeUpdate(sky, groundColor, sig, now, minGap = 2) {
    if (this.texture && now - this.at < minGap) return false;
    if (this.texture && this.key && sig.every((v, i) => Math.abs(v - this.key[i]) < 0.015)) return false;
    this.update(sky, groundColor); this.at = now; this.key = sig.slice();
    return true;
  }
  dispose() { this.rt?.dispose(); this.pmrem.dispose(); this.scene.clear(); this.ground.geometry.dispose(); this.groundMat.dispose(); }
}

// ------------------------------------------------------------------ the grade (bikefree effects/grade.js)
const ORIG = THREE.ShaderChunk.tonemapping_pars_fragment;
const DEFAULT = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
const f = (v) => Number(v).toFixed(4);
/** bikefree: saturation 1.15, contrast .16, warm .4, lift .015, sun x1.12, sky x.9. Floodwood: half way. */
export const GRADE = { saturation: 1.075, contrast: 0.08, warm: 0.2, lift: 0.0075, sun: 1.06, sky: 0.95 };
export function installGrade(renderer, o = GRADE) {
  if (!ORIG.includes(DEFAULT)) return false;
  THREE.ShaderChunk.tonemapping_pars_fragment = ORIG.replace(DEFAULT, /* glsl */`vec3 CustomToneMapping( vec3 color ) {
    vec3 c = ACESFilmicToneMapping( color );
    float l = dot( c, vec3( .2126, .7152, .0722 ) );
    c = max( vec3( 0. ), mix( vec3( l ), c, ${f(o.saturation)} ) );
    vec3 g = pow( c, vec3( 1. / 2.2 ) );
    g = mix( g, g * g * ( 3. - 2. * g ), ${f(o.contrast)} );
    g = g * ( 1. - ${f(o.lift)} ) + ${f(o.lift)};
    g *= 1. + ${f(o.warm)} * vec3( .035, .008, -.045 ) * smoothstep( .15, .9, l + .2 );
    return clamp( pow( max( g, vec3( 0. ) ), vec3( 2.2 ) ), 0., 1. );
  }`);
  renderer.toneMapping = THREE.CustomToneMapping;
  return true;
}

// ------------------------------------------------------------------ canopy shade (bikefree atmosphere/canopy-shade.js)
const N = 256;               // texels a side
const CELL = 1.25;           // m a texel (bikefree 0.625 over 160 m; the pond's shores are seen from farther off)
const SIZE = N * CELL;       // 320 m
const MOVE = 24;             // m the camera moves before the map is redrawn

const blank = new THREE.DataTexture(new Uint8Array([0, 128, 0, 255]), 1, 1, THREE.RGBAFormat); blank.needsUpdate = true;
/** Shared uniforms (every patched material reads these). */
export const CANOPY = {
  fwCanopyTex: { value: blank },
  fwCanopyBox: { value: new THREE.Vector4(0, 0, 1 / SIZE, 0) },   // x0, z0, 1/size, planeY
  fwCanopyK: { value: new THREE.Vector4(0, 0, 0, 0) },            // sunX/sunY, sunZ/sunY, strength (0: off), time
  fwCanopyR: { value: new THREE.Vector4(0, 0, 130, 158) },        // m from the camera: fade in from x to y (the shadow map's reach), out from z to w
};
const CANOPY_GLSL = /* glsl */`
#ifndef FW_CANOPY
#define FW_CANOPY
uniform sampler2D fwCanopyTex; uniform vec4 fwCanopyBox; uniform vec4 fwCanopyK; uniform vec4 fwCanopyR;
float fwcH(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float fwcN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(fwcH(i), fwcH(i + vec2(1., 0.)), f.x), mix(fwcH(i + vec2(0., 1.)), fwcH(i + 1.), f.x), f.y); }
float fwCanopy(vec3 w) {
  if (fwCanopyK.z <= 0.) return 1.;
  vec2 p = w.xz + fwCanopyK.xy * (fwCanopyBox.w - w.y);   // along the ray toward the sun, up (or down) to the plane
  vec2 uv = (p - fwCanopyBox.xy) * fwCanopyBox.z;
  if (uv.x <= 0. || uv.y <= 0. || uv.x >= 1. || uv.y >= 1.) return 1.;
  vec4 c = texture2D(fwCanopyTex, uv);
  float bottom = fwCanopyBox.w + (c.g * 255. - 128.) * .25;
  float dens = c.r * (1. - smoothstep(bottom - 1., bottom + 1.5, w.y));   // (under the crowns only)
  float dc = length(w.xz - cameraPosition.xz);
  dens *= smoothstep(fwCanopyR.x, fwCanopyR.y, dc) * (1. - smoothstep(fwCanopyR.z, fwCanopyR.w, dc));
  if (dens <= .001) return 1.;
  // sun flecks: more where the crown is thin, fewer under the thick of it, swaying a little with the wind; each fleck an
  // image of the sun through a gap, its edge blurred by the drop from the leaves (soft under a high crown)
  float t = fwCanopyK.w;
  vec2 q = p * 1.15 + vec2(sin(t * .9 + p.y * .07), cos(t * .7 + p.x * .06)) * .22;
  float n = fwcN(q) * .55 + fwcN(q * 2.6 + 17.) * .3 + fwcN(q * .23 + 5.) * .15;
  float th = mix(.4, .58, c.r);
  float drop = max(0., bottom - w.y), pen = clamp(.06 + drop * .016 + dc * .0012, .06, .3);
  float holes = smoothstep(th - pen * .35, th + pen, n);
  return 1. - dens * (1. - holes) * .93 * min(1., fwCanopyK.z);
}
#endif
`;
/** Add the canopy shade to a lit material (chains its own onBeforeCompile; idempotent). */
export function patchCanopy(m) {
  if (!m || m.userData.canopy || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return;
  m.userData.canopy = true;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : null;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    Object.assign(sh.uniforms, CANOPY);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <lights_pars_begin>', `#include <lights_pars_begin>\n${CANOPY_GLSL}`)
      .replace('#include <lights_fragment_begin>', `
        float fwCan = fwCanopy(transpose(mat3(viewMatrix)) * (-vViewPosition) + cameraPosition);
        #include <lights_fragment_begin>`);
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|fwcanopy1';
  m.needsUpdate = true;
}
// the directional lights' colour (inside the light loop) scaled by it, in the shared chunk - only where a patched
// material has pulled the canopy in (FW_CANOPY); every other material compiles as before
const LFB = THREE.ShaderChunk.lights_fragment_begin.replace(/getDirectionalLightInfo\( directionalLight, directLight \);/g, 'getDirectionalLightInfo( directionalLight, directLight );\n\t\t#ifdef FW_CANOPY\n\t\tdirectLight.color *= fwCan;\n\t\t#endif');
THREE.ShaderChunk.lights_fragment_begin = LFB;

export class CanopyShade {
  constructor({ strength = 1, planeLift = 9 } = {}) {
    this.strength = strength; this.planeLift = planeLift;
    this.data = new Uint8Array(N * N * 4); this.back = null;
    this.tex = new THREE.DataTexture(this.data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter; this.tex.minFilter = THREE.LinearFilter; this.tex.generateMipmaps = false;
    this.tex.flipY = false; this.tex.needsUpdate = true;
    this._at = null; this._sun = null; this.dirty = true; this._job = null;
    this.stats = { trees: 0, ms: 0 };
    CANOPY.fwCanopyTex.value = this.tex;
  }
  /** near: m round the camera left to the shadow map (0: none); off: no sun (night) */
  setReach(near) { const R = CANOPY.fwCanopyR.value; R.x = near ? near - 15 : 0; R.y = near ? near : 0; }
  /**
   * Per frame. Redraws after the camera has moved MOVE m or the sun has swung (a slice at a time, budgetMs a frame) and
   * swaps the new map in, with its box, when complete. strength: 0-1 (0: off - night, grey days).
   */
  update(camera, sunDir, trees, groundY, time, strength, budgetMs = 2) {
    const K = CANOPY.fwCanopyK.value;
    K.w = time; K.z = strength * this.strength;
    if (K.z <= 0) return false;
    const sy = Math.max(.12, sunDir.y), kx = sunDir.x / sy, kz = sunDir.z / sy;
    const c = camera.position;
    const swung = !this._sun || Math.hypot(kx - this._sun[0], kz - this._sun[1]) > .08;
    if (!this._job && (this.dirty || swung || !this._at || Math.hypot(c.x - this._at.x, c.z - this._at.z) >= MOVE)) {
      this.dirty = false; this._at = { x: c.x, z: c.z }; this._sun = [kx, kz];
      this._job = this._draw(c, kx, kz, groundY, trees);
    }
    if (!this._job) return false;
    const t0 = performance.now(), end = t0 + (budgetMs <= 0 ? 1e9 : budgetMs);
    let r;
    do r = this._job.next(end); while (!r.done && performance.now() < end);
    this.stats.ms += performance.now() - t0;
    if (!r.done) return false;
    this._job = null;
    const D = this.data; this.data = this.back; this.back = D;
    this.tex.image.data = this.data; this.tex.needsUpdate = true;
    K.x = r.value.kx; K.y = r.value.kz;
    CANOPY.fwCanopyBox.value.set(r.value.x0, r.value.z0, 1 / SIZE, r.value.planeY);
    return true;
  }
  /** Draw now, whole (a snapshot or a jump). */
  flush(camera, sunDir, trees, groundY, time, strength) { this.dirty = true; this._job = null; this.update(camera, sunDir, trees, groundY, time, strength, 0); }

  *_draw(c, kx, kz, groundY, trees) {
    this.stats = { trees: 0, ms: 0 };
    const planeY = groundY + this.planeLift;
    const cx = Math.round((c.x + kx * this.planeLift) / CELL) * CELL, cz = Math.round((c.z + kz * this.planeLift) / CELL) * CELL;
    const x0 = cx - SIZE / 2, z0 = cz - SIZE / 2;
    const D = this.back ||= new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) { D[i * 4] = 0; D[i * 4 + 1] = 255; D[i * 4 + 2] = 0; D[i * 4 + 3] = 255; }
    // the sun's azimuth in the plane (the ellipses' long axis), and how far a crown's depth stretches its shade
    const hl = Math.hypot(kx, kz) || 1, ax = kx / hl, az = kz / hl, stretch = Math.hypot(kx, kz);
    // every crown whose shade can reach the window (the pond's trees run to ~50 m: their shade thrown back along the ray)
    const list = trees(cx - kx * 20, cz - kz * 20, SIZE * .6 + 50 * stretch);
    let end = yield;
    let n = 0;
    for (let q = 0; q < list.length; q++) {
      if ((q & 15) === 0 && performance.now() > end) end = yield;
      const t = list[q], ccY = t.y + t.cy;
      const px = t.x + kx * (planeY - ccY), pz = t.z + kz * (planeY - ccY);
      const a = Math.max(.6, t.r * .92), b = Math.hypot(a, t.ry * stretch);   // across, along the sun
      if (px + b < x0 || px - b > x0 + SIZE || pz + b < z0 || pz - b > z0 + SIZE) continue;
      n++;
      const bot = Math.max(0, Math.min(255, Math.round(128 + (t.y + t.cb - planeY) * 4)));
      const dens = t.dens ?? .95;
      const i0 = Math.max(0, Math.floor((px - b - x0) / CELL)), i1 = Math.min(N - 1, Math.ceil((px + b - x0) / CELL));
      const j0 = Math.max(0, Math.floor((pz - b - z0) / CELL)), j1 = Math.min(N - 1, Math.ceil((pz + b - z0) / CELL));
      const ib2 = 1 / (b * b), ia2 = 1 / (a * a);
      for (let j = j0; j <= j1; j++) {
        const z = z0 + (j + .5) * CELL - pz;
        for (let i = i0; i <= i1; i++) {
          const x = x0 + (i + .5) * CELL - px;
          const u = x * ax + z * az, v = -x * az + z * ax;
          const e = u * u * ib2 + v * v * ia2;
          if (e >= 1) continue;
          const k = Math.min(1, (1 - e) * 2.6) * dens;   // soft edged: a crown's edge lets more light through
          const o = (j * N + i) * 4, cur = D[o] / 255;
          D[o] = Math.round(255 * (1 - (1 - cur) * (1 - k * .72)));
          if (bot < D[o + 1]) D[o + 1] = bot;
        }
      }
    }
    this.stats.trees = n;
    return { x0, z0, planeY, kx, kz };
  }
}
