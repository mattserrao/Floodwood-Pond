// v0.11.0 (test branch): oil paint.
// Inspired by @blendi's "Oil Paint" on Patch (MIT): the near world is built from brush dabs - single touches of mixed
// colour pinned to a surface and laid along a direction (down a spruce whorl, up a trunk, along a log) - over a painted
// underlayer. Everything else gets the same painter's palette in its shader, so near and far read as one canvas.
//   - dabs: instanced quads sampled once from each model's surface; they ride the existing instance matrices (near-field
//     trees, ground detail, shoreline props), sway with the wind, fall with the collapse and receive the sun's shadow.
//     On screen a dab is clamped between a min and max size, and with distance fewer, larger dabs stand in for the rest.
//   - paintTone(): every lit surface is laid in three mixes (shade / half-tone / light) with stroke-broken edges,
//     shades cooled and lights warmed. Water and sky use the same idea in their own shaders (sky.js).
//   - the brush: eight marks generated in code, with a raking light from the upper left across the paint's thickness.
// Off with ?paint=0 or the pause menu; tiers set the dab ring (Low has no dabs, only the painted tone).
import * as THREE from 'three';
import { SWAY, TREE_LIGHT } from './world.js?v=0.12.0';
import { WIND, GUST_GLSL } from './wind.js?v=0.12.0';

const QS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
let stored = null; try { stored = localStorage.getItem('fp-paint'); } catch (e) {}

export const PAINT = {
  on: QS.has('paint') ? QS.get('paint') !== '0' : stored !== '0',
  uniforms: {
    uPaintOn: { value: 1 }, uDabR: { value: 85 }, uDabNear: { value: 18 }, uDabMinKeep: { value: 0.2 },
    uDabPx: { value: new THREE.Vector2(3, 64) }, uPaintMap: { value: null }, uMapExt: { value: new THREE.Vector4(-1700, -1400, 3400, 2800) },
    uPaper: { value: new THREE.Color(0.86, 0.82, 0.74) }, uBlank: { value: 0 },
    uPal: { value: Array.from({ length: 6 }, () => new THREE.Color()) }, uPalK: { value: 0 }, uShadeK: { value: 0 }, uRampK: { value: 0 }, uViewH: { value: 900 }, uBrush: { value: null }, uPaintT: { value: 0 },
  },
  dabs: [],          // twin InstancedMeshes: { mesh, src }
  set(on) { PAINT.on = on; PAINT.uniforms.uPaintOn.value = on ? 1 : 0; try { localStorage.setItem('fp-paint', on ? '1' : '0'); } catch (e) {} },
};
PAINT.uniforms.uPaintOn.value = PAINT.on ? 1 : 0;

// ------------------------------------------------------------------ the brush: 8 marks, 4 x 2 atlas
// R = paint relief lit from the upper left, G = bristle streak, A = coverage
function brushAtlas() {
  const CW = 128, CH = 64, W = CW * 4, H = CH * 2, data = new Uint8Array(W * H * 4);
  let s = 7; const R = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const hv = new Float32Array(CW * CH), cov = new Float32Array(CW * CH);
  for (let m = 0; m < 8; m++) {
    const ox = (m % 4) * CW, oy = Math.floor(m / 4) * CH;
    // each mark: a loaded stroke - blunt start, tapering dry-brush tail, bristle streaks along its length
    const tail = 0.55 + R() * 0.4, belly = 0.75 + R() * 0.25, bend = (R() - 0.5) * 0.25, nb = 7 + Math.floor(R() * 6);
    const bristle = Array.from({ length: nb }, () => [R(), 0.4 + R() * 0.6, R() * 6.28]);
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      const u = (x + 0.5) / CW, v = (y + 0.5) / CH * 2 - 1;     // u: along the stroke 0..1, v: across -1..1
      const vc = v - bend * Math.sin(u * Math.PI);
      const startR = Math.min(1, u / 0.12), endR = 1 - Math.pow(Math.max(0, (u - (1 - tail * 0.6)) / (tail * 0.6)), 1.6);
      const width = belly * Math.sqrt(Math.max(0, startR)) * Math.max(0, endR);
      let b = 0; for (const [p, w, ph] of bristle) b += w * Math.exp(-Math.pow((vc * 0.5 + 0.5 - p) * nb * 1.3, 2)) * (0.75 + 0.25 * Math.sin(u * 23 + ph));
      const edge = width - Math.abs(vc) + 0.12 * (b - 0.5) + 0.06 * Math.sin(u * 40 + vc * 9 + m);
      const dry = u > 1 - tail * 0.5 ? b * 1.3 - (u - (1 - tail * 0.5)) / (tail * 0.5) * 0.8 : 1;   // the tail breaks into bristle marks
      const c = Math.max(0, Math.min(1, edge * 9)) * Math.max(0, Math.min(1, dry * 2.2));
      cov[y * CW + x] = c;
      hv[y * CW + x] = c * (0.55 + 0.45 * b) + c * 0.35 * Math.exp(-Math.pow((u - 0.08) * 9, 2));   // paint piles up where the brush landed
    }
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      const i = y * CW + x, hx = hv[y * CW + Math.min(CW - 1, x + 1)] - hv[y * CW + Math.max(0, x - 1)], hy = hv[Math.min(CH - 1, y + 1) * CW + x] - hv[Math.max(0, y - 1) * CW + x];
      const lit = 0.5 - (hx * 0.7 + hy * 0.7) * 2.2;                   // light raking from the upper left
      const o = ((oy + y) * W + ox + x) * 4;
      data[o] = Math.max(0, Math.min(255, lit * 255)); data[o + 1] = Math.max(0, Math.min(255, hv[i] * 255)); data[o + 2] = 0; data[o + 3] = Math.round(cov[i] * 255);
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat); t.flipY = false;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}
PAINT.uniforms.uBrush.value = brushAtlas();

// ------------------------------------------------------------------ the painter's palette (shared GLSL)
export const PAINT_GLSL = /* glsl */`
  uniform float uPaintOn, uBlank; uniform vec3 uPaper; uniform sampler2D uPaintMap; uniform vec4 uMapExt;

  float pH3(vec3 p){ p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float pN2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); vec3 k = vec3(i, 7.);
    return mix(mix(pH3(k), pH3(k + vec3(1,0,0)), f.x), mix(pH3(k + vec3(0,1,0)), pH3(k + vec3(1,1,0)), f.x), f.y); }
  // stroke-shaped value noise in 2D: long along x, short across
  float pStroke(vec2 q){ float a = pN2(q * vec2(.6, 3.2)), b = pN2(q * vec2(1.3, 7.) + 9.1); return a * .7 + b * .3; }
  float pLuma(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
  // world-anchored brush texture for any surface; the scale steps with distance so strokes stay a few pixels wide
  float pField(vec3 wp, vec3 n, float dist){
    vec3 an = abs(n);
    vec2 uv = an.y > .62 ? vec2(wp.x * .8 + wp.z * .6, -wp.x * .6 + wp.z * .8) : an.x > an.z ? vec2(wp.y, wp.z) : vec2(wp.y, wp.x);
    if (an.y <= .62) uv = uv.yx * vec2(1., .5);     // walls / trunks: strokes run up and down
    float lv = log2(max(dist, 1.) / 6.), l0 = floor(lv), k = fract(lv);
    float s0 = exp2(l0), s1 = s0 * 2.;
    return mix(pStroke(uv / s0 + l0 * 3.7), pStroke(uv / s1 + l0 * 3.7 + 3.7), smoothstep(.2, .8, k));
  }
  // lay a lit colour down in three mixes - shade, half-tone, light - with stroke-broken edges (s: stroke value -.5..5)
  vec3 paintToneS(vec3 lit, float s){
    if (uPaintOn < .5) return lit;
    float L = max(pLuma(lit), 1e-5);
    float e = log2(L) * 1.6 + s * 1.15;
    float q = floor(e) + smoothstep(.38, .62, fract(e));
    vec3 c = lit * exp2((q - e + s * 1.15) / 1.6);
    float t = clamp((log2(L) + 4.) / 4.5, 0., 1.);
    c *= mix(vec3(.9, .95, 1.1), vec3(1.06, 1., .9), t);              // cool shades, warm lights
    c = mix(vec3(pLuma(c)), c, 1.08);                                  // a touch more chroma, as paint has
    return c * (1. + s * .07);
  }
  vec3 paintTone(vec3 lit, vec3 wp, vec3 n, float dist){ return uPaintOn < .5 ? lit : paintToneS(lit, pField(wp, n, dist) - .5); }`;

/** chain the painted palette onto any lit built-in material (Standard / Lambert / Phong) */
const toned = new WeakSet();
export function paintMaterial(mat) {
  if (!mat || toned.has(mat) || mat.isShaderMaterial || mat.isMeshBasicMaterial || mat.isPointsMaterial || mat.isSpriteMaterial || mat.isLineBasicMaterial || mat.isMeshDepthMaterial) return mat;
  toned.add(mat);
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : null;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    if (!sh.fragmentShader.includes('#include <opaque_fragment>')) return;
    sh.uniforms.uPaintOn = PAINT.uniforms.uPaintOn; for (const k of ['uPaper', 'uBlank', 'uPaintMap', 'uMapExt']) sh.uniforms[k] = PAINT.uniforms[k];
    if (!/varying vec3 vPaintW;/.test(sh.vertexShader)) {
      sh.vertexShader = 'varying vec3 vPaintW;\n' + sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\n vPaintW = (inverse(viewMatrix) * vec4(mvPosition.xyz, 1.)).xyz;');
    }
    sh.fragmentShader = 'varying vec3 vPaintW;\n' + PAINT_GLSL + '\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `
      { vec3 pn = inverseTransformDirection(normal, viewMatrix); outgoingLight = paintTone(outgoingLight, vPaintW, pn, length(vPaintW - cameraPosition)); }
      #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '_paint';
  mat.needsUpdate = true;
  return mat;
}
/** tone every lit material in the scene (call after building, before the collapse patch) */
export function paintScene(scene) {
  scene.traverse((o) => { if (!o.isMesh || o.userData.noPaint) return; (Array.isArray(o.material) ? o.material : [o.material]).forEach(paintMaterial); });
}

// ------------------------------------------------------------------ dabs
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3(), _ca = new THREE.Color();
/**
 * Sample brush dabs over a geometry's surface (once, in the model's own space).
 * opts: density (dabs per m^2), max, size [min,max] metres, aspect (width/length), lift [min,max] metres out of the surface,
 *       dir: 'down' (droop: needles, leaves) | 'up' (trunks, stems) | Vector3 (along an axis: logs) | 'flat' (rocks: level strokes),
 *       barkDir / barkSize: used for triangles flagged as bark (aBark) in mixed tree models,
 *       color: [r,g,b] multiplied into the vertex colour (or used alone), seed.
 */
export function sampleDabs(geo, o = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo, P = g.attributes.position, C = g.attributes.color, B = g.attributes.aBark, tri = P.count / 3;
  const base = o.color || [1, 1, 1];
  let s = (o.seed || 1) >>> 0; const R = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const areas = new Float32Array(tri); let total = 0;
  for (let i = 0; i < tri; i++) { _a.fromBufferAttribute(P, i * 3); _b.fromBufferAttribute(P, i * 3 + 1); _c.fromBufferAttribute(P, i * 3 + 2);
    const ar = _t.subVectors(_b, _a).cross(_d.subVectors(_c, _a)).length() * 0.5; total += ar; areas[i] = total; }
  const n = Math.min(o.max || 800, Math.max(8, Math.round(total * (o.density || 4))));
  const lifts = new Float32Array(n * 4), pos = new Float32Array(n * 12), cor = new Float32Array(n * 8), nrm = new Float32Array(n * 12), dir = new Float32Array(n * 12), col = new Float32Array(n * 12), inf = new Float32Array(n * 16), idx = new Uint32Array(n * 6);
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  for (let k = 0; k < n; k++) {
    const r = R() * total; let lo = 0, hi = tri - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (areas[m] < r) lo = m + 1; else hi = m; }
    const i = lo; _a.fromBufferAttribute(P, i * 3); _b.fromBufferAttribute(P, i * 3 + 1); _c.fromBufferAttribute(P, i * 3 + 2);
    let u = R(), v = R(); if (u + v > 1) { u = 1 - u; v = 1 - v; } const w = 1 - u - v;
    const px = _a.x * w + _b.x * u + _c.x * v, py = _a.y * w + _b.y * u + _c.y * v, pz = _a.z * w + _b.z * u + _c.z * v;
    _n.subVectors(_b, _a).cross(_t.subVectors(_c, _a)).normalize(); if (o.outward) { _t.set(px - o.outward.x, 0, pz - o.outward.z); if (_t.dot(_n) < 0) _n.negate(); }
    const bark = B ? (B.getX(i * 3) + B.getX(i * 3 + 1) + B.getX(i * 3 + 2)) / 3 > 0.5 : false;
    const dm = bark ? (o.barkDir || 'up') : (o.dir || 'down');
    if (dm === 'down' || dm === 'up') _d.set(0, dm === 'down' ? -1 : 1, 0); else if (dm === 'flat') _d.set(Math.cos(R() * 6.28), 0, Math.sin(R() * 6.28)); else _d.copy(dm);
    _d.addScaledVector(_n, -_d.dot(_n)); if (_d.lengthSq() < 1e-4) _d.set(1, 0, 0).addScaledVector(_n, -_n.x); _d.normalize();
    _d.applyAxisAngle(_n, (R() - 0.5) * (o.spread ?? 0.7));
    if (C) { _ca.setRGB(C.getX(i * 3) * w + C.getX(i * 3 + 1) * u + C.getX(i * 3 + 2) * v, C.getY(i * 3) * w + C.getY(i * 3 + 1) * u + C.getY(i * 3 + 2) * v, C.getZ(i * 3) * w + C.getZ(i * 3 + 1) * u + C.getZ(i * 3 + 2) * v); } else _ca.setRGB(1, 1, 1);
    // a mixed colour: each dab drifts a little in value and hue from its neighbours
    const jv = 0.76 + R() * 0.48, jh = (R() - 0.5) * 0.16;
    const cr = _ca.r * base[0] * jv * (1 + jh), cg = _ca.g * base[1] * jv, cb = _ca.b * base[2] * jv * (1 - jh);
    const sz = bark ? (o.barkSize || o.size || [0.3, 0.5]) : (o.size || [0.5, 0.9]), size = sz[0] + R() * (sz[1] - sz[0]);
    const aspect = (bark ? o.barkAspect || 0.4 : o.aspect || 0.5) * (0.8 + R() * 0.4), lift = (o.lift ? o.lift[0] + R() * (o.lift[1] - o.lift[0]) : 0.05) * (_n.y < -0.3 ? 0.15 : 1);   // undersides hug the form (seen from below they'd float)
    const brush = Math.floor(R() * 8), rank = R();
    for (let c = 0; c < 4; c++) { const q = k * 4 + c;
      pos[q * 3] = px; pos[q * 3 + 1] = py; pos[q * 3 + 2] = pz; lifts[q] = lift;
      cor[q * 2] = corners[c][0]; cor[q * 2 + 1] = corners[c][1];
      nrm[q * 3] = _n.x; nrm[q * 3 + 1] = _n.y; nrm[q * 3 + 2] = _n.z; dir[q * 3] = _d.x; dir[q * 3 + 1] = _d.y; dir[q * 3 + 2] = _d.z;
      col[q * 3] = cr; col[q * 3 + 1] = cg; col[q * 3 + 2] = cb;
      inf[q * 4] = size; inf[q * 4 + 1] = aspect; inf[q * 4 + 2] = brush; inf[q * 4 + 3] = rank; }
    idx.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('aLift', new THREE.BufferAttribute(lifts, 1)); out.setAttribute('aCorner', new THREE.BufferAttribute(cor, 2));
  out.setAttribute('aNrm', new THREE.BufferAttribute(nrm, 3)); out.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3)); out.setAttribute('aInfo', new THREE.BufferAttribute(inf, 4));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingBox(); out.boundingBox.expandByScalar(1); out.computeBoundingSphere();
  out.userData.dabs = n;
  return out;
}

const DAB_VERT_HEAD = /* glsl */`
  attribute vec2 aCorner; attribute vec3 aNrm, aDir; attribute vec4 aInfo; attribute float aLift;
  uniform float uDabR, uDabNear, uDabMinKeep, uViewH, uTime, uSwayQ; uniform vec2 uDabPx; uniform sampler2D uPaintMap; uniform vec4 uMapExt;
  varying vec2 vBUv; varying float vBrush, vFade, vDabH;
  ${GUST_GLSL}`;
function dabProject(sway) {
  return /* glsl */`
    #ifdef USE_INSTANCING
      mat4 dIM = modelMatrix * instanceMatrix;
    #else
      mat4 dIM = modelMatrix;
    #endif
    vec3 dOrg = (dIM * vec4(0., 0., 0., 1.)).xyz;
    vec3 cW = (dIM * vec4(position, 1.)).xyz;
    ${sway ? `{ float hy = max(cW.y - dOrg.y, 0.) / ${sway[0].toFixed(1)};
      float gu = gustAt(dOrg.xz), ph = dot(dOrg.xz, vec2(.37, .61)), bend = hy * hy * ${sway[1].toFixed(2)};
      float osc = .55 * sin(uTime * 1.3 + ph) + .3 * sin(uTime * 2.9 + ph * 1.7);
      cW.xz += uWindDir * bend * (gu * 1.1 + osc * (.12 + .5 * gu)) + vec2(-uWindDir.y, uWindDir.x) * bend * .15 * sin(uTime * 2.2 + ph * 2.3) * gu;
      cW.xz += vec2(sin(uTime * 17. + ph * 3.), cos(uTime * 13. + ph * 2.)) * hy * 1.6 * uSwayQ; }` : ''}
    // big instances (tall shoreline trees) take somewhat bigger touches, not proportionally bigger ones; the lift is in metres
    float dScale = sqrt((length(dIM[0].xyz) + length(dIM[1].xyz) + length(dIM[2].xyz)) / 3.);
    vec3 nW0 = normalize(mat3(dIM) * aNrm); cW += nW0 * aLift;
    float camD = max(distance(cW, cameraPosition), .5);
    // the ring: dabs dissolve out toward its edge (the painted underlayer carries on beyond)
    vFade = 1. - smoothstep(uDabR * .72, uDabR, distance(dOrg.xz, cameraPosition.xz));
    // distance simplifies: fewer dabs, each standing in for its dropped neighbours
    float keep = clamp(uDabNear / camD, uDabMinKeep, 1.);
    float focal = projectionMatrix[1][1] * .5 * uViewH;
    float px = clamp(aInfo.x * dScale * inversesqrt(keep) * focal / camD, uDabPx.x, uDabPx.y);
    float sW = px * camD / focal;
    // v0.12.0: painted as you go - as the painting reaches a tree its touches land one by one (with a little overshoot)
    float pm = texture2D(uPaintMap, (dOrg.xz - uMapExt.xy) / uMapExt.zw).r;
    float land = clamp((pm - .2 - aInfo.w * .6) / .12, 0., 1.);
    sW *= land * (1. + .35 * sin(land * 3.1416));
    vec3 dW = normalize(mat3(dIM) * aDir);
    vec3 rgt = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), upv = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec2 d2 = vec2(dot(dW, rgt), dot(dW, upv)); float dl = length(d2); d2 = dl > 1e-3 ? d2 / dl : vec2(0., 1.);
    // a stroke seen end-on is foreshortened, but never thinner than it is wide
    // a touch is laid on the surface: seen edge-on it narrows to a sliver, and the far side of a form isn't painted at all
    vec3 nW = normalize(mat3(dIM) * aNrm); float face = dot(nW, normalize(cameraPosition - cW));
    float fk = smoothstep(-.15, .55, face);
    vec2 c = aCorner * vec2(sW * max(dl, aInfo.y), sW * aInfo.y * mix(.35, 1., fk)) * mix(.55, 1., fk);
    if (face < -.15) c = vec2(0.);
    vec3 dabW = cW + rgt * (c.x * d2.x - c.y * d2.y) + upv * (c.x * d2.y + c.y * d2.x) + normalize(cameraPosition - cW) * .06;
    if (aInfo.w > keep * vFade || land <= 0.) dabW = cW;                       // dropped (thinned with distance, thinning out to nothing at the ring's edge)
    vBUv = aCorner + .5; vBrush = aInfo.z; vDabH = aInfo.w;
    vec4 mvPosition = viewMatrix * vec4(dabW, 1.);
    gl_Position = projectionMatrix * mvPosition;`;
}

/** a dab material: Lambert lighting (sun, sky, moon, shadows, fog) on a painted brush mark */
export function dabMaterial(opts = {}) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, alphaToCoverage: true });
  const sway = opts.sway || null, back = opts.back ?? 0.6;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, PAINT.uniforms, WIND.uniforms, SWAY, TREE_LIGHT);
    sh.vertexShader = DAB_VERT_HEAD + '\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = aNrm;')
      .replace('#include <project_vertex>', dabProject(sway))
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = inverse(viewMatrix) * mvPosition;')
      ;
    sh.fragmentShader = 'uniform sampler2D uBrush; uniform vec3 uSunDir, uSunCol; uniform float uSunK; varying vec2 vBUv; varying float vBrush, vFade, vDabH;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `
        vec2 bc = vec2(mod(vBrush, 4.), floor(vBrush / 4.));
        vec4 br = texture2D(uBrush, (bc + clamp(vBUv, .01, .99)) / vec2(4., 2.));
        if (br.a < .06) discard;
        diffuseColor.a = smoothstep(.06, .5, br.a);
        diffuseColor.rgb *= .62 + .8 * br.r;                         // impasto: ridges catch the light, furrows hold shadow
        ${QS.has('dabdebug') ? 'diffuseColor.rgb = vec3(1.,0.,0.);' : ''}`)
      .replace('#include <opaque_fragment>', `
        { vec3 vd = normalize(vViewPosition); float bk = pow(max(dot(-normalize((vec4(vd, 0.) * viewMatrix).xyz), uSunDir), 0.), 5.);
          float fres = 1. - abs(dot(normal, vd));                       // only edges glow when the sun is behind the tree
          outgoingLight += uSunCol * diffuseColor.rgb * bk * (.15 + .85 * fres * fres) * ${back.toFixed(2)} * .5 * uSunK; }
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'dab' + (sway ? sway.join('_') : '') + back;
  paintMaterial(m);
  return m;
}

/** draw dabs on every instance of `src` (shares its matrices, colours and count) */
export function attachDabs(scene, src, dabGeo, mat) {
  const t = new THREE.InstancedMesh(dabGeo, mat, src.instanceMatrix.count);
  t.instanceMatrix = src.instanceMatrix; if (src.instanceColor) t.instanceColor = src.instanceColor;
  t.count = src.count; t.frustumCulled = false; t.castShadow = false; t.receiveShadow = true; t.renderOrder = 0;
  t.userData.noPaint = true; t.userData.tag = 'dab';
  scene.add(t); PAINT.dabs.push({ mesh: t, src });
  return t;
}

/** per frame: follow the sources (count, visibility), drop whole sets that are outside the dab ring */
const _s = new THREE.Sphere(), _v2 = new THREE.Vector2();
export function updatePaint(camera, renderer, t) {
  const U = PAINT.uniforms; U.uPaintT.value = t;
  U.uViewH.value = renderer.getDrawingBufferSize(_v2).y;
  const on = PAINT.on && U.uDabR.value > 1, cp = camera.position;
  for (const d of PAINT.dabs) {
    const s = d.src; d.mesh.count = s.userData.dabCount !== undefined ? Math.min(s.count, s.userData.dabCount) : s.count;
    let vis = on && s.visible && s.count > 0;
    if (vis && s.boundingSphere && s.frustumCulled !== false) { _s.copy(s.boundingSphere).applyMatrix4(s.matrixWorld); vis = Math.hypot(_s.center.x - cp.x, _s.center.z - cp.z) - _s.radius < U.uDabR.value; }
    d.mesh.visible = vis;
  }
}
export function setPaintQuality(q) {
  const U = PAINT.uniforms; U.uDabR.value = q.dabR ?? 0; U.uDabNear.value = q.dabNear ?? 18; U.uDabMinKeep.value = q.dabKeep ?? 0.2;
}


// ------------------------------------------------------------------ v0.12.0: the painting spreads from wherever you are
// A coarse map over the whole world (13 m a texel) holds how far the painting has got. Around the canoe it rises,
// fastest close in, so a front travels outward and trees take their strokes as it passes. It never goes back down:
// places you've been stay painted, places you haven't are still the underdrawing.
const MAP_N = 256, mapData = new Uint8Array(MAP_N * MAP_N), mapF = new Float32Array(MAP_N * MAP_N);
const mapTex = new THREE.DataTexture(mapData, MAP_N, MAP_N, THREE.RedFormat, THREE.UnsignedByteType);
mapTex.magFilter = mapTex.minFilter = THREE.LinearFilter; mapTex.wrapS = mapTex.wrapT = THREE.ClampToEdgeWrapping; mapTex.needsUpdate = true;
PAINT.uniforms.uPaintMap.value = mapTex;
const MAP = { R: 95, acc: 0, dirty: false };
export function fillPaintMap(v = 1) { mapF.fill(v); mapData.fill(Math.round(v * 255)); mapTex.needsUpdate = true; }
if (QS.get('painted') === '1' || !PAINT.on) fillPaintMap(1);
export function paintAround(x, z, dt, rateK = 1) {
  const e = PAINT.uniforms.uMapExt.value, cx = (x - e.x) / e.z * MAP_N, cz = (z - e.y) / e.w * MAP_N, tr = MAP.R / e.z * MAP_N;
  const x0 = Math.max(0, Math.floor(cx - tr)), x1 = Math.min(MAP_N - 1, Math.ceil(cx + tr)), z0 = Math.max(0, Math.floor(cz - tr)), z1 = Math.min(MAP_N - 1, Math.ceil(cz + tr));
  for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
    const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cz) / tr; if (d >= 1) continue;
    const k = j * MAP_N + i; if (mapF[k] >= 1) continue;
    mapF[k] = Math.min(1, mapF[k] + dt * rateK * 0.42 * Math.pow(1 - d, 1.6));
    const b = Math.round(mapF[k] * 255); if (b !== mapData[k]) { mapData[k] = b; MAP.dirty = true; }
  }
  MAP.acc += dt; if (MAP.dirty && MAP.acc > 0.15) { MAP.acc = 0; MAP.dirty = false; mapTex.needsUpdate = true; }
}
/** per frame: the canvas colour follows the light (bright paper by day, dim by night) */
const _pc = new THREE.Color();
export function setPaper(hemi, fogCol) {
  const L = Math.min(1.05, (0.2126 * hemi.color.r + 0.7152 * hemi.color.g + 0.0722 * hemi.color.b) * hemi.intensity * 0.62 + 0.03);
  const b = PAINT.uniforms.uBlank.value;   // at the end the canvas comes up to full daylight whatever the hour
  _pc.setRGB(0.86, 0.82, 0.74).lerp(fogCol, 0.25 * (1 - b)).multiplyScalar(L + (1 - L) * Math.min(1, b * 1.4));
  PAINT.uniforms.uPaper.value.copy(_pc);
}

// ------------------------------------------------------------------ v0.12.0: the painter's day
// Each time of day is painted with six paints: [shadow, four mid colours, light]. Every colour on screen is pulled to the
// nearest paint (keeping its value). Golden hour goes wild (Fauvist): violet shadows, orange water, green-gold sky.
// k = how hard colours are pulled to the palette, sh = how far shadows/lights lean to the shadow and light paints.
const PALETTES = [
  { h: 0,    k: 0.45, sh: 0.45, c: ['#0b0f24', '#1c2a4a', '#2f4a5c', '#3d3f66', '#5a6f8a', '#c9d6e8'] },   // night: two blues and a moon-white
  { h: 5.4,  k: 0.45, sh: 0.45, c: ['#14183a', '#2a3360', '#4b4a7a', '#5d6e8e', '#8a7fa0', '#d8c9d9'] },
  { h: 6.4,  k: 0.55, sh: 0.5,  r: 0.3,  c: ['#2e2a52', '#5d5a86', '#9c7f9e', '#7f95a8', '#e2a6a0', '#ffe2c8'] },   // dawn: blues and pinks
  { h: 8.2,  k: 0.45, sh: 0.35, c: ['#2b3a4a', '#4c6b62', '#7d9a7a', '#8fb0c4', '#d8c39a', '#fff2d8'] },   // morning
  { h: 12.5, k: 0.4,  sh: 0.3,  c: ['#24342c', '#3f5e3a', '#7a8f45', '#b59a52', '#7fa6c2', '#fbf4dc'] },   // noon: greens and ochres
  { h: 15.6, k: 0.45, sh: 0.35, c: ['#2a2f3a', '#4a6040', '#9a8a3e', '#c47a3a', '#6f93b0', '#fff0cc'] },   // afternoon
  { h: 17.3, k: 0.8,  sh: 0.6,  r: 0.75,  c: ['#4a2470', '#2f8a6a', '#e8602a', '#f0a030', '#b8d040', '#fff0a0'] },   // golden hour, gone wild
  { h: 18.4, k: 0.75, sh: 0.6,  r: 0.6,  c: ['#2a1650', '#7a2d6a', '#e04a3a', '#f08a4a', '#3a8a9a', '#ffd0a0'] },   // sunset
  { h: 19.3, k: 0.6,  sh: 0.6,  r: 0.3,  c: ['#151538', '#2d2f6a', '#5a3d7a', '#3d6a8a', '#c86a6a', '#f0c0a0'] },   // dusk
  { h: 20.6, k: 0.45, sh: 0.45, c: ['#0b0f24', '#1c2a4a', '#2f4a5c', '#3d3f66', '#5a6f8a', '#c9d6e8'] },
  { h: 24,   k: 0.45, sh: 0.45, c: ['#0b0f24', '#1c2a4a', '#2f4a5c', '#3d3f66', '#5a6f8a', '#c9d6e8'] },
].map((p) => ({ ...p, col: p.c.map((x) => new THREE.Color(x)) }));
const _ca2 = new THREE.Color();
export function setPalette(hour) {
  const U = PAINT.uniforms, h = ((hour % 24) + 24) % 24;
  let i = 0; while (i < PALETTES.length - 2 && PALETTES[i + 1].h <= h) i++;
  const a = PALETTES[i], b = PALETTES[i + 1], t = Math.min(1, Math.max(0, (h - a.h) / (b.h - a.h))), e = t * t * (3 - 2 * t);
  for (let k = 0; k < 6; k++) U.uPal.value[k].copy(a.col[k]).lerp(_ca2.copy(b.col[k]), e);
  U.uPalK.value = a.k + (b.k - a.k) * e; U.uShadeK.value = a.sh + (b.sh - a.sh) * e; U.uRampK.value = (a.r ?? 0.12) + ((b.r ?? 0.12) - (a.r ?? 0.12)) * e;
}
