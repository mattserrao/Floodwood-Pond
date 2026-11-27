// v0.15.0: the tree engine, ported from bikefree main (js/world/toolbox/vegetation/tree-engine.js, as merged with
// trees-2d-test and zwift-parity-test). bikefree's method:
//   - every tree model in the kit (treekit.js) is photographed from 12 sides into one atlas at load;
//   - every tree on the map is then one camera-facing card (turned about its vertical axis) that picks the two
//     photos either side of the angle it's seen from and cross-blends them - no snap as you go round it. All the
//     trees are one draw call (bikefree: "trees can effectively be 2D" - from a fixed path the woods are only ever
//     seen from one side);
//   - a card magnified past its photo's texels is sampled with a cubic B-spline (no blocks) and broken up by leaf
//     clusters, so the near trees stay soft; the photos are taken with 4x MSAA on laptops and desktops;
//   - alpha to coverage where the screen is multisampled (soft silhouettes, no sorting), a plain cut at half alpha
//     where it isn't (phones: no light halo);
//   - the cards also go into the sun's shadow map, each turned to face the light and cut by its photo, so the near
//     trees throw leafy shade;
//   - the atlas kept to a memory budget (phones ~56 MB).
// Floodwood's changes: bikefree rides at one fixed time of day, so it photographs its trees already lit. Here the sun
// goes round the sky, so the photos are taken twice - colour (unlit) and the surface's facing (normals) - and each
// card is lit live by the scene's own lights, shadows and fog (a MeshStandardMaterial underneath), with the foliage's
// backlit glow. And the cards bend with the shared gust field (wind.js), as the old trees did.
import * as THREE from 'three';

const ANGLES = 12;
const CELL = { low: 128, med: 192, high: 256 };   // photo size (px) per tier; the normals are taken at half that
const isMobile = () => { const n = globalThis.navigator, ua = n?.userAgent || ''; return /iPhone|iPad|iPod|Android|Mobile/.test(ua) || (/Macintosh/.test(ua) && n.maxTouchPoints > 1); };
const isIOS = () => { const n = globalThis.navigator, ua = n?.userAgent || ''; return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && n.maxTouchPoints > 1); };

// ------------------------------------------------------------------ the photo shoot
// One shader for both photos: colour (the kit's vertex colours, the leaf texture, and bikefree's surface detail -
// foliage clumps lit at the tips, bark by kind: furrowed, plated, white birch with dark eyes, silver deadwood) or the
// surface's facing in the photo's frame (x right, y up, z toward the viewer), with the clumps' normals tilted.
const BAKE_VS = /* glsl */`
  attribute float aTree; attribute vec3 color; attribute vec4 aCard;
  varying vec3 vC; varying vec2 vUv; varying vec3 vN; varying vec3 vO; varying float vK;
  void main() {
    vC = color; vUv = uv; vO = position; vK = aTree;
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.);
    // v0.16.0 (bikefree leaf-cards.js): a leaf clump opened square to the camera about its centre (wood: aCard is 0)
    float lcC = cos(aCard.z), lcN = sin(aCard.z);
    mv.xy += mat2(lcC, lcN, -lcN, lcC) * aCard.xy;
    gl_Position = projectionMatrix * mv;
  }`;
const BAKE_FS = /* glsl */`
  uniform sampler2D uMap; uniform float uLeaf; uniform float uMode; uniform float uSize; uniform mat3 normalMatrix; uniform vec3 uCrown; uniform float uFol;
  varying vec3 vC; varying vec2 vUv; varying vec3 vN; varying vec3 vO; varying float vK;
  float tH(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float tN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(tH(i), tH(i + vec2(1., 0.)), f.x), mix(tH(i + vec2(0., 1.)), tH(i + 1.), f.x), f.y); }
  float tClump(vec3 w) { return tN(w.xz * 1.5 + w.y * .7) * .6 + tN(vec2(w.x + w.z, w.y) * 2.9) * .4; }
  void main() {
    vec3 c = vC; vec3 n = normalize(vN);
    if (uLeaf > .5) {
      vec4 t = texture2D(uMap, vUv);
      // (bikefree: the alpha scaled up with the mip level, so a far cluster keeps its fill)
      vec2 tx = vUv * uSize; float lod = max(0., .5 * log2(max(dot(dFdx(tx), dFdx(tx)), dot(dFdy(tx), dFdy(tx)))));
      if (min(1., t.a * (1. + lod * .35)) < .45) discard;
      c *= t.rgb;
    } else {
      float tA = atan(vO.z, vO.x);
      if (vK < .5) {
        // conifer foliage: clumps lit at the tips, hollows between them; the normal tilted toward each clump
        float c0 = tClump(vO); c *= (.78 + c0 * .42) * uFol;
        // (Floodwood: seen from the water, the flat tiers would show mostly their undersides - the facing is rounded
        //  toward the crown's volume, as the broadleaves' clusters are)
        vec3 sph = normalMatrix * normalize(vec3(vO.x / uCrown.z, (vO.y - uCrown.x) / uCrown.y + .35, vO.z / uCrown.z));
        n = normalize(mix(n, sph, .75));
        float cx = tClump(vO + vec3(.35, 0., 0.)), cy = tClump(vO + vec3(0., .35, 0.)), cz = tClump(vO + vec3(0., 0., .35));
        n = normalize(n - normalMatrix * vec3(cx - c0, cy - c0, cz - c0) * 2.6);
      } else if (vK < 1.5) {
        float f = tN(vec2(tA * 6., vO.y * .7)); c *= .7 + smoothstep(.3, .7, f) * .42;
        float moss = (1. - smoothstep(.4, 2., vO.y)) * smoothstep(.45, .6, tN(vec2(tA * 3., vO.y * 2.)));
        c = mix(c, vec3(.24, .3, .14), moss * .4);
      } else if (vK < 3.5) {
        float f = tN(vec2(tA * 4.5, vO.y * 1.6)), crack = 1. - smoothstep(.04, .1, abs(f - .5));
        c *= (1.04 + (tN(vec2(tA * 9., vO.y * 3.)) - .5) * .2) * (1. - crack * .5);
      } else if (vK < 4.5) {
        // paper birch: chalky white, dark eyes and peeling bands, dark at the foot
        vec2 cell = vec2(floor(tA * 1.6), floor(vO.y / .8)), lc = vec2(fract(tA * 1.6) - .5, fract(vO.y / .8) - .5);
        float eye = step(tH(cell), .45) * (1. - smoothstep(.12, .2, length(lc * vec2(1., 3.2) - vec2((tH(cell + 3.) - .5) * .4, 0.))));
        c *= 1. - eye * .78;
        c = mix(c, vec3(.12, .11, .1), (1. - smoothstep(.4, 1.3, vO.y + (tN(vec2(tA * 5., 1.)) - .5) * .5)) * .75);
      } else if (vK > 6.5 && vK < 7.5) {
        c *= .82 + tN(vec2(tA * 22., vO.y * .3)) * .3;
      }
    }
    // colour stored with a gamma (8 bits would band the dark conifers); facing as 0-1
    gl_FragColor = uMode < .5 ? vec4(pow(max(c, vec3(0.)), vec3(1. / 2.2)), 1.) : vec4(n * .5 + .5, 1.);
  }`;

/** the card: a unit quad standing on its base (x across, y up) */
function cardGeometry() {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-.5, 0, 0, .5, 0, 0, .5, 1, 0, -.5, 1, 0], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  return geo;
}

// the card's vertex code (the lit pass and the shadow pass): turned to the camera (in the shadow pass: the light),
// the two photos either side of the view picked, bent by the gust field, hidden beyond the fog's reach
const CARD_PARS = (gust) => /* glsl */`
  attribute vec4 iA; attribute vec4 iB;   // iA: x, y, z, rotation; iB: width, height, atlas row, tint
  attribute vec2 iL;                       // v0.16.0: the lean (the top's offset per metre up, x and z: out over the water)
  uniform float uRows, uVisD, uTime;
  varying vec2 vUv; varying vec2 vUv2; varying float vBlend; varying float vTint; varying vec3 vRight; varying vec3 vToCam; varying float vHf; varying float vNear;
  ${gust}`;
const CARD_VERT = /* glsl */`
  vec3 o = iA.xyz; vec2 to = o.xz - cameraPosition.xz; float d = length(to);
  vec2 dir = to / max(d, 1e-3);
  vec3 right = vec3(-dir.y, 0., dir.x);
  vRight = right; vToCam = vec3(-dir.x, 0., -dir.y); vTint = iB.w;
  // the side it's seen from, in the tree's own frame, -> the two photos either side, and how far between
  float cr = cos(iA.w), sr = sin(iA.w);
  vec2 vl = vec2(-dir.x * cr + dir.y * sr, -dir.x * sr - dir.y * cr);
  float a = atan(vl.x, vl.y); if (a < 0.) a += 6.2831853;
  float fa = a / 6.2831853 * ${ANGLES}., f0 = mod(floor(fa), ${ANGLES}.), f1 = mod(f0 + 1., ${ANGLES}.);
  vBlend = fract(fa);
  vUv = vec2((f0 + uv.x) / ${ANGLES}., (iB.z + uv.y) / uRows);
  vUv2 = vec2((f1 + uv.x) / ${ANGLES}., (iB.z + uv.y) / uRows);
  float on = step(d, uVisD) * step(.001, iB.x);
  #ifdef NEAR_SWAP
    vNear = 1. - smoothstep(NEAR_SWAP, d);   // (inside it: the 3D model, in the complementary dither)
  #else
    vNear = 0.;
  #endif
  float hgt = position.y * iB.y * on;
  vec3 transformed = o + right * position.x * iB.x * on + vec3(0., hgt, 0.);
  transformed.xz += iL * hgt; vHf = position.y;
  #ifdef TREE_DEPTH
    // the shadow card stands at the back of its tree (seen from the sun), so a tree doesn't shade its own card -
    // the side away from the sun is already dark from its normals - and still throws its shade beyond
    transformed += normalize(vec3(dir.x, 0., dir.y)) * iB.x * .45;
  #else
    objectNormal = vToCam;
  #endif
  // Floodwood's sway (world.js swayMaterial): the top bends most, more in a gust, a little side to side
  {
    float hy = hgt / 30., gu = gustAt(o.xz), ph = dot(o.xz, vec2(.37, .61)), bend = hy * hy * 1.1;
    float osc = .55 * sin(uTime * 1.3 + ph) + .3 * sin(uTime * 2.9 + ph * 1.7);
    transformed.xz += uWindDir * bend * (gu * 1.1 + osc * (.12 + .5 * gu)) + vec2(-uWindDir.y, uWindDir.x) * bend * .15 * sin(uTime * 2.2 + ph * 2.3) * gu;
  }`;
// the photo's colour and coverage at this pixel (cubic B-spline and leaf break-up when magnified: bikefree, 24 Nov)
const CARD_SAMPLE = /* glsl */`
  uniform sampler2D uAtlas; uniform sampler2D uNorm; uniform vec2 uAtlasSize; uniform float uGain; uniform float uA2C;
  float lvH(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float lvN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(lvH(i), lvH(i + vec2(1., 0.)), f.x), mix(lvH(i + vec2(0., 1.)), lvH(i + 1.), f.x), f.y); }
  vec4 cubic(vec2 uv) {
    vec2 st = uv * uAtlasSize - .5, i = floor(st), f = st - i;
    vec2 w0 = (1. - f) * (1. - f) * (1. - f) / 6., w1 = (4. - 6. * f * f + 3. * f * f * f) / 6., w3 = f * f * f / 6., w2 = 1. - w0 - w1 - w3;
    vec2 s0 = w0 + w1, s1 = w2 + w3, o0 = i - .5 + w1 / s0, o1 = i + 1.5 + w3 / s1;
    return (texture2D(uAtlas, vec2(o0.x, o0.y) / uAtlasSize) * s0.x + texture2D(uAtlas, vec2(o1.x, o0.y) / uAtlasSize) * s1.x) * s0.y
         + (texture2D(uAtlas, vec2(o0.x, o1.y) / uAtlasSize) * s0.x + texture2D(uAtlas, vec2(o1.x, o1.y) / uAtlasSize) * s1.x) * s1.y;
  }`;

/**
 * v0.16.0: the crown grade (bikefree tree-engine.js TREE_GRADE, "Shaded below, sunlit tops", "Even, rich gold"; the
 * understory branch left out): a crown's bleached, sun-facing photo held to a rich colour (bright texels compressed,
 * the colour put back), the lower part of each tree darker and a little cooler, the tops in sun; a red crown turned a
 * little toward gold (gentler than bikefree's: the pond's red maples stay red). h: 0 at the foot, 1 at the top.
 */
const TREE_GRADE = /* glsl */`
  vec3 treeGrade(vec3 c, float h) {
    #ifdef NO_GRADE
      return c;
    #endif
    float l = dot(c, vec3(.3, .59, .11));
    float redness = clamp((c.r - c.g) * 2.2, 0., 1.) * clamp((c.r - c.b) * 2., 0., 1.);
    c = mix(c, vec3(1., .7, .32) * l * 1.3, .2 * redness);
    c *= mix(1., clamp(.5 / max(l, 1e-3), .58, 1.), smoothstep(.42, .66, l));
    float l2 = dot(c, vec3(.3, .59, .11));
    c = max(vec3(0.), vec3(l2) + (c - vec3(l2)) * 1.15);
    float up = smoothstep(.2, .7, h);
    return c * mix(.78, 1., up) * mix(vec3(.92, .96, 1.05), vec3(1.), up);
  }`;

export class TreeEngine {
  /** opts: renderer, kit (treekit.makeKit()), tier ('low' | 'med' | 'high'), msaa, uniforms (sway, wind, light), gust (GLSL) */
  /** v0.17.0 options: name; cell ({ low, med, high } photo sizes); near ([from, to] m: inside it a card dissolves into
   *  its 3D model - the models of `near` entries are kept); grade (false: no crown grade); visD (m: a far cap) */
  constructor({ renderer, kit, tier = 'high', msaa = false, uniforms, gust, name = 'Trees (tree engine)', cell = CELL, near = null, grade = true, visD = 1e9 }) {
    this.renderer = renderer; this.kit = kit; this.uniforms = uniforms; this.gust = gust;
    this.cellSizes = cell; this.near = near; this.grade = grade; this.visCap = visD;
    this.index = new Map(); kit.entries.forEach((e, row) => { e.row = row; this.index.set(e.key, e); });
    this._bake(tier);
    this._material();
    this.geo = cardGeometry(); this.cap = 0; this.trees = [];
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false; this.mesh.name = name; this.mesh.userData.keep = true; this.mesh.userData.tag = 'treecards';
    this.mesh.customDepthMaterial = this.depthMat;
    this.setMSAA(msaa);
  }

  // ------------------------------------------------------------------ photographs
  _bake(tier) {
    const r = this.renderer, list = this.kit.entries, max = r.capabilities?.maxTextureSize || 4096, mobile = isMobile();
    // (bikefree: the atlas kept to a memory budget - a phone's or tablet's far smaller; colour + normals at half size)
    const budgetPx = (mobile ? 56e6 : 160e6) / (4 * 1.34 * 1.25), fit = Math.floor(Math.sqrt(budgetPx / (ANGLES * list.length)) / 8) * 8;
    const cell = Math.max(64, Math.min(this.cellSizes[tier] || 192, fit, Math.floor(max / list.length), Math.floor(max / ANGLES)));
    const W = cell * ANGLES, H = cell * list.length;
    const opts = (s) => ({ generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, samples: s });
    const rtC = new THREE.WebGLRenderTarget(W, H, opts(mobile ? 0 : 4)), rtN = new THREE.WebGLRenderTarget(W / 2, H / 2, opts(0));
    const mk = (leaf, mode) => new THREE.ShaderMaterial({ vertexShader: BAKE_VS, fragmentShader: BAKE_FS, side: THREE.DoubleSide,
      uniforms: { uMap: { value: this.kit.leafTexture }, uLeaf: { value: leaf }, uMode: { value: mode }, uSize: { value: this.kit.leafTexture.image?.width || 512 }, uCrown: { value: crown }, uFol: fol } });
    const crown = new THREE.Vector3(), fol = { value: 1 }, mats = [[mk(0, 0), mk(1, 0)], [mk(0, 1), mk(1, 1)]];
    // one render per tree and photo: the tree twelve times in a row, the k-th turned by -k/12 of a circle (the same as
    // walking the camera round it - bikefree took the twelve one by one; each render of a multisampled target is a
    // resolve and a mipmap pass, so this is 30 renders at load instead of 360)
    const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, 0, .1, 400);
    cam.position.set(0, 0, 200); cam.lookAt(0, 0, 0);
    const prev = { target: r.getRenderTarget(), autoClear: r.autoClear, color: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha() };
    r.autoClear = false; r.setClearColor(0x000000, 0);
    for (const rt of [rtC, rtN]) { r.setRenderTarget(rt); r.clear(); }
    for (const e of list) {
      const b = new THREE.Box3(); for (const g of [e.wood, e.leaves]) if (g) { if (!g.userData.cards) g.computeBoundingBox(); b.union(g.boundingBox); }
      const half = Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z) * 1.02, top = b.max.y * 1.01;
      e.half = half; e.top = top; crown.set(top * .55, top * .45, half * .8); fol.value = e.foliageGain ?? 1;
      // the crown (for the canopy shade): a broadleaf's from its clusters, a conifer's from where its tiers start
      const lb = e.leaves?.userData.crown;
      if (lb) e.crown = { cb: Math.max(0, lb.min.y - 1), cy: (lb.min.y + lb.max.y) / 2, ry: (lb.max.y - lb.min.y) / 2 + 1, r: Math.max(lb.max.x, -lb.min.x, lb.max.z, -lb.min.z) * .95 + 1 };
      else { const cb = top * (e.crownFrom ?? .1); e.crown = { cb, cy: (cb + top) / 2, ry: (top - cb) / 2, r: half * .6 }; }
      cam.left = -half * ANGLES; cam.right = half * ANGLES; cam.top = top; cam.bottom = 0; cam.updateProjectionMatrix();
      [[rtC, cell, 0], [rtN, cell / 2, 1]].forEach(([rt, cs, mode]) => {
        const meshes = [];
        for (let k = 0; k < ANGLES; k++) for (const [g, m] of [[e.wood, mats[mode][0]], [e.leaves, mats[mode][1]]]) {
          if (!g) continue;
          const mesh = new THREE.Mesh(g, m); mesh.rotation.y = -k / ANGLES * Math.PI * 2; mesh.position.x = (2 * k + 1 - ANGLES) * half;
          mesh.frustumCulled = false; meshes.push(mesh); scene.add(mesh);
        }
        r.setRenderTarget(rt); r.setViewport(0, e.row * cs, cs * ANGLES, cs);
        r.render(scene, cam);
        meshes.forEach((m) => scene.remove(m));
      });
    }
    r.autoClear = prev.autoClear; r.setClearColor(prev.color, prev.alpha); r.setRenderTarget(prev.target);
    const sz = new THREE.Vector2(); r.getSize(sz); r.setViewport(0, 0, sz.x, sz.y);
    mats.flat().forEach((m) => m.dispose());
    // the models are only ever photographed: their geometry goes
    for (const e of list) { e.broad = !!e.leaves; if (this.near && e.near) continue; e.wood?.dispose(); e.leaves?.dispose(); e.wood = e.leaves = null; }
    this.rtC = rtC; this.rtN = rtN; this.cell = cell; this.atlasSize = [W, H];
    this.memMB = Math.round(W * H * 4 * 1.34 * 1.25 / 1e6);
  }

  // ------------------------------------------------------------------ the cards' materials
  _material() {
    const U = this.uniforms, own = {
      uAtlas: { value: this.rtC.texture }, uNorm: { value: this.rtN.texture }, uAtlasSize: { value: new THREE.Vector2(...this.atlasSize) },
      uRows: { value: this.kit.entries.length }, uVisD: { value: 1e9 }, uGain: { value: 1 }, uA2C: { value: 0 },
    };
    this.own = own;
    const pars = CARD_PARS(this.gust);
    const vert = (sh) => {
      Object.assign(sh.uniforms, own, U.wind, { uTime: U.sway.uTime });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${pars}`).replace('#include <begin_vertex>', CARD_VERT);
    };
    // lit pass: a MeshStandardMaterial whose colour, coverage and facing come from the photos
    this.mat = new THREE.MeshStandardMaterial({ roughness: .92, metalness: 0, side: THREE.DoubleSide });
    const defs = (this.near ? `#define NEAR_SWAP ${this.near[0].toFixed(1)}, ${this.near[1].toFixed(1)}\n` : '') + (this.grade ? '' : '#define NO_GRADE\n');
    this.mat.onBeforeCompile = (sh) => {
      vert(sh); sh.vertexShader = defs + sh.vertexShader; sh.fragmentShader = defs + sh.fragmentShader;
      Object.assign(sh.uniforms, U.light);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec2 vUv; varying vec2 vUv2; varying float vBlend; varying float vTint; varying vec3 vRight; varying vec3 vToCam; varying float vHf; varying float vNear;
        uniform vec3 uSunDir, uSunCol; uniform float uSunK;
        ${TREE_GRADE}
        ${CARD_SAMPLE}`)
        .replace('#include <map_fragment>', `
          vec2 tpx = fwidth(vUv) * uAtlasSize;
          float mag = clamp(1.25 - max(tpx.x, tpx.y) * 1.25, 0., 1.);
          vec4 c0, c1;
          if (mag > 0.) { c0 = cubic(vUv); c1 = cubic(vUv2); } else { c0 = texture2D(uAtlas, vUv); c1 = texture2D(uAtlas, vUv2); }
          vec4 tc = mix(c0, c1, vBlend);
          // a near card, magnified past its photo's texels: leaf clusters break up the blocks of colour and the
          // silhouette's staircase (bikefree used its detail texture; here a value noise)
          if (mag > 0.) {
            vec2 px = vUv * uAtlasSize;
            float lf = lvN(px / 2.2), lf2 = lvN(px / .9 + 3.7);
            tc.rgb *= 1. + (lf * .6 + lf2 * .4 - .5) * .75 * mag;
            tc.a = clamp(tc.a + (lf2 - .5) * .55 * mag * smoothstep(.15, .85, tc.a) * (1. - smoothstep(.85, 1., tc.a)) * 2., 0., 1.);
          }
          if (vNear > 0. && vNear > fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))))) discard;
          float cov = clamp((tc.a - .5) / max(fwidth(tc.a), 1e-4) + .5, 0., 1.);
          if (cov <= 0. || (uA2C < .5 && tc.a < .5)) discard;
          diffuseColor = vec4(treeGrade(pow(tc.rgb / max(tc.a, .3), vec3(2.2)), vHf) * vTint * uGain, uA2C > .5 ? cov : 1.);
          vec4 tn = mix(texture2D(uNorm, vUv), texture2D(uNorm, vUv2), vBlend);
          vec3 pn = normalize(tn.rgb / max(tn.a, .3) * 2. - 1.);
          vec3 impN = normalize(vRight * pn.x + vec3(0., 1., 0.) * pn.y + vToCam * pn.z);`)
        .replace('#include <normal_fragment_begin>', `
          float faceDirection = 1.0;
          vec3 normal = normalize((viewMatrix * vec4(impN, 0.)).xyz);
          vec3 nonPerturbedNormal = normal;`)
        // the foliage glows when you look toward the sun through it (world.js foliageLight)
        .replace('#include <opaque_fragment>', `
          { vec3 vd = normalize(-vToCam); float back = pow(max(dot(vd, uSunDir), 0.), 5.);
            outgoingLight += uSunCol * diffuseColor.rgb * back * (.35 + .9 * (1. - abs(normal.z))) * .8 * uSunK; }
          #include <opaque_fragment>`);
    };
    this.mat.customProgramCacheKey = () => 'fw-tree-engine-3' + defs;
    // shadow pass: the cards turned to the light (cameraPosition is the light's there), cut by their photos
    this.depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    this.depthMat.onBeforeCompile = (sh) => {
      vert(sh); sh.vertexShader = '#define TREE_DEPTH\n' + sh.vertexShader;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec2 vUv; varying vec2 vUv2; varying float vBlend; uniform sampler2D uAtlas;`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if (mix(texture2D(uAtlas, vUv), texture2D(uAtlas, vUv2), vBlend).a < .5) discard;`);
    };
    this.depthMat.customProgramCacheKey = () => 'fw-tree-engine-depth-2';
  }

  /** alpha to coverage only where the scene is drawn multisampled (bikefree: never on iPhone / iPad, which dither it) */
  setMSAA(on) {
    const a2c = !!on && !isIOS();
    if (this.mat.alphaToCoverage !== a2c) { this.mat.alphaToCoverage = a2c; this.mat.needsUpdate = true; }
    this.own.uA2C.value = a2c ? 1 : 0;
  }
  /** cards beyond this distance (the fog's reach) are dropped in the vertex shader */
  setVis(d) { this.own.uVisD.value = Math.min(d, this.visCap); }
  /** the trees within R (m) of (x, z) whose entry keeps its model (the near 3D plants) */
  near3d(x, z, R) {
    const out = [], g0 = Math.floor((x - R) / 40), g1 = Math.floor((x + R) / 40), h0 = Math.floor((z - R) / 40), h1 = Math.floor((z + R) / 40);
    for (let i = g0; i <= g1; i++) for (let j = h0; j <= h1; j++) for (const t of this.grid.get(i + ',' + j) || []) {
      if (!t.e.wood || this.iB[t.k * 4] <= 0 || (t.x - x) ** 2 + (t.z - z) ** 2 > R * R) continue;
      out.push(t);
    }
    return out;
  }

  /** trees: [{ x, y, z, key ('sp:v'), h (height, m), w (width x its natural width), rot, tint }] */
  setTrees(trees) {
    const n = trees.length;
    if (n > this.cap) {
      this.cap = n;
      this.iA = new Float32Array(n * 4); this.iB = new Float32Array(n * 4); this.iL = new Float32Array(n * 2);
      this.geo.setAttribute('iA', new THREE.InstancedBufferAttribute(this.iA, 4)); this.geo.setAttribute('iB', new THREE.InstancedBufferAttribute(this.iB, 4));
      this.geo.setAttribute('iL', new THREE.InstancedBufferAttribute(this.iL, 2));
      delete this.geo._maxInstanceCount;   // (bikefree, 24 Nov: three caps an instanced draw at its first count - grown buffers went undrawn)
    }
    this.trees = trees;
    trees.forEach((t, k) => {
      const e = this.index.get(t.key) || this.kit.entries[0], s = t.h / e.top;
      t.e = e; t.k = k;
      this.iA.set([t.x, t.y, t.z, t.rot], k * 4); this.iB.set([e.half * 2 * s * (t.w ?? 1), t.h, e.row, t.tint ?? 1], k * 4);
      this.iL[k * 2] = t.lean ? t.lean[0] : 0; this.iL[k * 2 + 1] = t.lean ? t.lean[1] : 0;
      t.sx = s * (t.w ?? 1); t.sy = s;
    });
    this.geo.instanceCount = n;
    this.geo.attributes.iA.needsUpdate = true; this.geo.attributes.iB.needsUpdate = true; this.geo.attributes.iL.needsUpdate = true;
    // a 40 m grid of the trees, for crownsNear
    this.grid = new Map();
    for (const t of trees) { const key = Math.floor(t.x / 40) + ',' + Math.floor(t.z / 40); let c = this.grid.get(key); if (!c) this.grid.set(key, c = []); c.push(t); }
  }
  /**
   * v0.16.0: the crowns near (x, z) (within R, square), for the canopy shade (canopy.js): { x, y, z, r, cy, ry, cb } -
   * each from its model's crown, scaled; a leaning crown sits out over its lean. Hidden trees skipped.
   */
  crownsNear(x, z, R) {
    const out = [], g0 = Math.floor((x - R) / 40), g1 = Math.floor((x + R) / 40), h0 = Math.floor((z - R) / 40), h1 = Math.floor((z + R) / 40);
    for (let i = g0; i <= g1; i++) for (let j = h0; j <= h1; j++) for (const t of this.grid.get(i + ',' + j) || []) {
      if (Math.abs(t.x - x) > R || Math.abs(t.z - z) > R || this.iB[t.k * 4] <= 0) continue;
      const c = t.e.crown; if (!c) continue;
      const cy = c.cy * t.sy, lx = t.lean ? t.lean[0] * cy : 0, lz = t.lean ? t.lean[1] * cy : 0;
      out.push({ x: t.x + lx, y: t.y, z: t.z + lz, r: c.r * t.sx, cy, ry: c.ry * t.sy, cb: c.cb * t.sy, dens: t.e.sp === 'tamarack' ? .7 : .95 });
    }
    return out;
  }
  /** more trees (props placed after the forest: the camp's giant pines) */
  addTrees(more) { this.setTrees([...this.trees, ...more]); }
  /** hide the trees where fn(x, z) is true (a cleared campsite; trees marked keep stay) */
  kill(fn) {
    let any = false;
    for (const t of this.trees) if (!t.keep && fn(t.x, t.z)) { this.iB[t.k * 4] = 0; any = true; }
    if (any) this.geo.attributes.iB.needsUpdate = true;
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); this.depthMat.dispose(); this.rtC.dispose(); this.rtN.dispose(); this.kit.leafTexture.dispose(); }
}
