// v0.10.0: the collapse. A third of the way to Big Island an earthquake breaks the world behind you: the land falls
// away in chunks into a void, the pond pours over the broken edge, and the edge creeps forward, driving you on.
// One straight "front" line, perpendicular to an axis pointing at the island, does it all:
//   - every built-in mesh material gets a vertex patch: anything behind the front breaks into ~12 m chunks (trees and
//     other instances fall whole), each chunk letting go a little later than the last, tumbling and dropping away;
//   - the water shader discards behind the front and foams/streams toward the lip (sky.js);
//   - a waterfall curtain hangs off the lip, spray and dust boil up along it, rubble tumbles into the dark below.
import * as THREE from 'three';
import { heightAt } from './world.js?v=0.10.0';

export const COLLAPSE = {
  uniforms: { uColO: { value: new THREE.Vector2() }, uColAxis: { value: new THREE.Vector2(0, 1) }, uColFront: { value: -1e6 }, uColOn: { value: 0 }, uQuake: { value: 0 } },
};

/** GLSL: chunk break-up shared by the vertex patch (and the water). */
export const COLLAPSE_GLSL = /* glsl */`
  uniform vec2 uColO, uColAxis; uniform float uColFront, uColOn, uQuake;
  float colH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float colWob(float l){ return 5. * sin(l * .031 + 1.3) + 3. * sin(l * .077 + .4) + 1.5 * sin(l * .19 + 2.1); }
  // distance along the axis (from the origin) and across it
  vec2 colQ(vec2 xz){ vec2 d = xz - uColO; return vec2(dot(d, uColAxis), dot(d, vec2(-uColAxis.y, uColAxis.x))); }
  // how long (in metres the front has moved since) this chunk let go; <= 0 = still standing
  float colRel(vec2 xz, out vec2 cell, out float h, out vec3 ctr){
    vec2 q = colQ(xz); float row = floor(q.x / 11.), off = colH(vec2(row, 3.1)) * 13.;
    cell = vec2(row, floor((q.y + off) / 13.)); h = colH(cell);
    vec2 cq = vec2((row + .5) * 11., (cell.y + .5) * 13. - off);
    ctr = vec3(uColO.x + uColAxis.x * cq.x - uColAxis.y * cq.y, 0., uColO.y + uColAxis.y * cq.x + uColAxis.x * cq.y);
    return uColFront + colWob(q.y) - q.x - h * 9.;
  }
  vec3 colRot(vec3 d, vec3 a, float t){ float c = cos(t), s = sin(t); return d * c + cross(a, d) * s + a * dot(a, d) * (1. - c); }
  vec3 colDisp(vec3 wp, vec3 piv, bool inst){
    vec2 cell; float h; vec3 ctr; float r = colRel(inst ? piv.xz : wp.xz, cell, h, ctr);
    if (r <= 0.) return wp;
    vec3 c = inst ? piv : vec3(ctr.x, 0., ctr.z);
    float t = r * (.8 + .5 * h);
    float drop = .1 * t * t + .35 * t;
    vec3 ax = normalize(vec3(colH(cell + 1.7) - .5, .05, colH(cell + 4.3) - .5));
    vec3 d = colRot(wp - c, ax, min(t * (.025 + .05 * h), 2.4));
    return c + d - vec3(uColAxis.x, 0., uColAxis.y) * t * .22 - vec3(0., min(drop, 3000.), 0.);
  }`;

const VPATCH = `
  if (uColOn > .5) {
    vec3 cwp = (inverse(viewMatrix) * mvPosition).xyz, cpiv = cwp; bool cinst = false;
    #ifdef USE_INSTANCING
      cpiv = (modelMatrix * instanceMatrix * vec4(0., 0., 0., 1.)).xyz; cinst = true;
    #endif
    vec3 cnw = colDisp(cwp, cpiv, cinst);
    mvPosition = viewMatrix * vec4(cnw, 1.); gl_Position = projectionMatrix * mvPosition;
  }
  #include <logdepthbuf_vertex>`;

const patched = new WeakSet();
function patchMaterial(mat) {
  if (!mat || patched.has(mat) || mat.isShaderMaterial || mat.isRawShaderMaterial || mat.isSpriteMaterial || mat.isPointsMaterial || mat.isLineBasicMaterial) return;
  patched.add(mat);
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : null;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    if (!sh.vertexShader.includes('#include <logdepthbuf_vertex>')) return;
    Object.assign(sh.uniforms, COLLAPSE.uniforms);
    sh.vertexShader = COLLAPSE_GLSL + '\n' + sh.vertexShader.replace('#include <logdepthbuf_vertex>', VPATCH);
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '_col';
  mat.needsUpdate = true;
}
const depthMats = new Map();
/** patch every mesh in the scene (safe to call again for things added later) */
export function patchScene(scene) {
  scene.traverse((o) => {
    if (!o.isMesh || o.userData.noCollapse) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(patchMaterial);
    if (o.castShadow && !o.customDepthMaterial) {
      // shadows fall with their casters (otherwise a vanished tree would still shade the water ahead)
      const k = o.isInstancedMesh ? 'i' : 'm';
      if (!depthMats.has(k)) { const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); patchMaterial(dm); depthMats.set(k, dm); }
      o.customDepthMaterial = depthMats.get(k);
    }
  });
}

function softTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export const colWob = (l) => 5 * Math.sin(l * 0.031 + 1.3) + 3 * Math.sin(l * 0.077 + 0.4) + 1.5 * Math.sin(l * 0.19 + 2.1);

export function createCollapse(scene) {
  const U = COLLAPSE.uniforms;
  const S = { on: false, front: -1e6, O: new THREE.Vector2(), A: new THREE.Vector2(0, 1), t: 0 };
  const along = (x, z) => (x - S.O.x) * S.A.x + (z - S.O.y) * S.A.y;
  const across = (x, z) => -(x - S.O.x) * S.A.y + (z - S.O.y) * S.A.x;
  const world = (s, l, out) => out.set(S.O.x + S.A.x * s - S.A.y * l, 0, S.O.y + S.A.y * s + S.A.x * l);

  // --- the void below: dark, fading to the fog far off
  const abyssMat = new THREE.ShaderMaterial({
    uniforms: { uFog: { value: new THREE.Color() }, uFogD: { value: 0.0007 } }, depthWrite: true,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 uFog; uniform float uFogD; varying vec3 vW;
      void main(){ float d = length(vW.xz - cameraPosition.xz); float f = 1. - exp(-pow(d * uFogD * .8, 2.));
        vec3 c = mix(vec3(.006, .008, .011), uFog * .3, clamp(f, 0., 1.) * .3); gl_FragColor = vec4(c, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const abyss = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000).rotateX(-Math.PI / 2), abyssMat);
  abyss.position.y = -160; abyss.visible = false; abyss.frustumCulled = false; abyss.userData.noCollapse = true; scene.add(abyss);

  // --- the waterfall: a curtain hanging off the lip, arcing outward as it falls
  const NC = 110, NR = 14, SPAN = 1100, DEPTH = 120;
  const cg = new THREE.BufferGeometry(), cpos = new Float32Array((NC + 1) * (NR + 1) * 3), cuv = new Float32Array((NC + 1) * (NR + 1) * 2), cwet = new Float32Array((NC + 1) * (NR + 1)), idx = [];
  for (let i = 0; i <= NC; i++) for (let j = 0; j <= NR; j++) { const k = i * (NR + 1) + j; cuv[k * 2] = i * (SPAN / NC); cuv[k * 2 + 1] = j / NR; }
  for (let i = 0; i < NC; i++) for (let j = 0; j < NR; j++) { const a = i * (NR + 1) + j, b = a + NR + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  cg.setIndex(idx); cg.setAttribute('position', new THREE.BufferAttribute(cpos, 3)); cg.setAttribute('uv', new THREE.BufferAttribute(cuv, 2)); cg.setAttribute('aWet', new THREE.BufferAttribute(cwet, 1));
  const curtainMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uFog: { value: new THREE.Color() }, uFogD: { value: 0.0007 }, uLight: { value: 1 } },
    vertexShader: 'attribute float aWet; varying float vWet; varying vec2 vUv; varying vec3 vW; void main(){ vWet = aWet; vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uTime, uFogD, uLight; uniform vec3 uFog; varying float vWet; varying vec2 vUv; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        if (vWet < .02) discard;
        float v = vUv.y, s = n(vec2(vUv.x * .9, v * 9. - uTime * 2.2)) * .6 + n(vec2(vUv.x * 2.7, v * 22. - uTime * 3.4)) * .4;
        vec3 c = mix(vec3(.82, .88, .9), vec3(.32, .42, .46), smoothstep(.0, .5, v)) * (.55 + .5 * s) * uLight;
        float a = vWet * (1. - smoothstep(.35, 1., v)) * (.5 + .5 * s) * (.92 - .2 * v);
        float f = 1. - exp(-pow(length(vW - cameraPosition) * uFogD, 2.)); c = mix(c, uFog, clamp(f, 0., 1.));
        gl_FragColor = vec4(c, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const curtain = new THREE.Mesh(cg, curtainMat); curtain.frustumCulled = false; curtain.visible = false; curtain.renderOrder = 2; curtain.userData.noCollapse = true; scene.add(curtain);

  // --- spray off the lip and dust off the breaking land
  const NP = 900, ppos = new Float32Array(NP * 3), pcol = new Float32Array(NP * 3), pa = new Float32Array(NP), psz = new Float32Array(NP), pv = new Float32Array(NP * 3), plife = new Float32Array(NP), pmax = new Float32Array(NP); let phead = 0;
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(ppos, 3)); pg.setAttribute('color', new THREE.BufferAttribute(pcol, 3)); pg.setAttribute('alpha', new THREE.BufferAttribute(pa, 1)); pg.setAttribute('size', new THREE.BufferAttribute(psz, 1));
  const pmat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTex: { value: softTex() }, uLight: { value: 1 } },
    vertexShader: 'attribute float alpha, size; attribute vec3 color; varying float vA; varying vec3 vC; void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = clamp(size * 300. / -mv.z, 1., 220.); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform sampler2D uTex; uniform float uLight; varying float vA; varying vec3 vC; void main(){ float t = texture2D(uTex, gl_PointCoord).a; gl_FragColor = vec4(vC * uLight, t * vA); }' });
  const pts = new THREE.Points(pg, pmat); pts.frustumCulled = false; pts.renderOrder = 5; pts.userData.noCollapse = true; scene.add(pts);
  function emit(x, y, z, wet) {
    const k = phead++ % NP; ppos[k * 3] = x; ppos[k * 3 + 1] = y; ppos[k * 3 + 2] = z;
    const up = wet ? 1.5 + Math.random() * 3 : 0.8 + Math.random() * 2.2, bk = wet ? 1.5 + Math.random() * 2 : 0.5 + Math.random();
    pv[k * 3] = -S.A.x * bk + (Math.random() - 0.5); pv[k * 3 + 1] = up; pv[k * 3 + 2] = -S.A.y * bk + (Math.random() - 0.5);
    const c = wet ? [0.86, 0.9, 0.92] : [0.42 + Math.random() * 0.08, 0.36, 0.28]; pcol.set(c, k * 3);
    psz[k] = wet ? 0.8 + Math.random() * 1.6 : 5 + Math.random() * 7; pmax[k] = plife[k] = wet ? 2.5 + Math.random() * 2 : 5 + Math.random() * 4;
  }

  // --- rubble tumbling into the dark
  const NR2 = 160, rubble = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x4a4038, flatShading: true, roughness: 1 }), NR2);
  rubble.userData.noCollapse = true; rubble.frustumCulled = false; rubble.count = NR2; scene.add(rubble);
  const R = Array.from({ length: NR2 }, () => ({ p: new THREE.Vector3(0, -9999, 0), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), s: 1 }));
  let rhead = 0; const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), SC = new THREE.Vector3(), V = new THREE.Vector3(), V2 = new THREE.Vector3();
  function drop(x, y, z) { const r = R[rhead++ % NR2]; r.p.set(x, y, z); r.v.set(-S.A.x * (0.5 + Math.random() * 2), Math.random() * 2, -S.A.y * (0.5 + Math.random() * 2)); r.w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(3); r.s = 0.4 + Math.random() * Math.random() * 3.5; }
  rubble.visible = false;

  function apply() { U.uColO.value.copy(S.O); U.uColAxis.value.copy(S.A); U.uColFront.value = S.front; U.uColOn.value = S.on ? 1 : 0; abyss.visible = curtain.visible = rubble.visible = pts.visible = S.on; }
  apply();

  return {
    S, along, across,
    start(ox, oz, ax, az, front) { S.O.set(ox, oz); S.A.set(ax, az).normalize(); S.front = front; S.on = true; S.t = 0; patchScene(scene); apply(); },
    reset() { S.on = false; S.front = -1e6; U.uQuake.value = 0; apply(); R.forEach((r) => r.p.set(0, -9999, 0)); pa.fill(0); pg.attributes.alpha.needsUpdate = true; },
    setFront(f) { S.front = f; U.uColFront.value = f; },
    /** per frame: px/pz = player, fog colour/density and scene light for the custom shaders, dt/t time */
    update(dt, t, px, pz, fogCol, fogD, light) {
      U.uColOn.value = S.on ? 1 : 0; if (!S.on) return;
      S.t += dt; U.uColFront.value = S.front;
      abyssMat.uniforms.uFog.value.copy(fogCol); abyssMat.uniforms.uFogD.value = fogD;
      curtainMat.uniforms.uFog.value.copy(fogCol); curtainMat.uniforms.uFogD.value = fogD; curtainMat.uniforms.uTime.value = t; curtainMat.uniforms.uLight.value = light; pmat.uniforms.uLight.value = light;
      // curtain columns centred on the player's line of sight, hanging from the straight water lip
      const l0 = across(px, pz) - SPAN / 2, lip = S.front - 0.5;
      for (let i = 0; i <= NC; i++) {
        const l = l0 + i * (SPAN / NC), lw = lip + colWob(l); world(lw + 1.5, l, V); const wet = heightAt(V.x, V.z) < -0.05 ? 1 : 0;
        for (let j = 0; j <= NR; j++) { const v = j / NR, dz = DEPTH * v * v, k = i * (NR + 1) + j; world(lw - 9 * Math.sqrt(dz / DEPTH) - 0.4, l, V); cpos[k * 3] = V.x; cpos[k * 3 + 1] = 0.05 - dz; cpos[k * 3 + 2] = V.z; cwet[k] = wet; }
      }
      cg.attributes.position.needsUpdate = true; cg.attributes.aWet.needsUpdate = true;
      // spray and dust: busiest right behind the player, thinning out to the sides
      const nE = Math.min(60, Math.floor(dt * 260 + Math.random()));
      for (let e = 0; e < nE; e++) {
        const l = across(px, pz) + (Math.random() - 0.5) * (Math.random() < 0.6 ? 160 : 600); world(lip + colWob(l) - Math.random() * 6, l, V); const hgt = heightAt(V.x, V.z);
        if (hgt < -0.05) emit(V.x, 0.2, V.z, true); else if (Math.random() < 0.5) { emit(V.x, Math.max(hgt, 0) + Math.random() * 2, V.z, false); if (Math.random() < 0.18) drop(V.x, Math.max(hgt, 0) - 1, V.z); }
      }
      for (let k = 0; k < NP; k++) {
        if (plife[k] <= 0) { pa[k] = 0; continue; } plife[k] -= dt; const u = 1 - plife[k] / pmax[k];
        pv[k * 3 + 1] -= dt * (pcol[k * 3] > 0.8 ? 1.6 : 0.15); ppos[k * 3] += pv[k * 3] * dt; ppos[k * 3 + 1] += pv[k * 3 + 1] * dt; ppos[k * 3 + 2] += pv[k * 3 + 2] * dt;
        psz[k] += dt * (pcol[k * 3] > 0.8 ? 0.9 : 2.5); pa[k] = Math.sin(Math.min(1, u * 4) * Math.PI / 2) * (1 - u) * (pcol[k * 3] > 0.8 ? 0.32 : 0.4);
      }
      pg.attributes.position.needsUpdate = pg.attributes.alpha.needsUpdate = pg.attributes.size.needsUpdate = true; pg.attributes.color.needsUpdate = true;
      for (let k = 0; k < NR2; k++) { const r = R[k]; if (r.p.y < -400) { M4.makeScale(0, 0, 0); rubble.setMatrixAt(k, M4); continue; }
        r.v.y -= 9.8 * dt * 0.7; r.p.addScaledVector(r.v, dt); Q.setFromAxisAngle(V2.copy(r.w).normalize(), r.w.length() * dt); r.q.premultiply(Q); M4.compose(r.p, r.q, SC.setScalar(r.s)); rubble.setMatrixAt(k, M4); }
      rubble.instanceMatrix.needsUpdate = true;
    },
  };
}
