// v0.17.0: the understory - under the trees, at the water's edge and in the shallows (user, 27 Nov: "missing fronds, all
// of the small detail that make it feel filled in"; chose bikefree's hybrid: sprite cards for the grasses, sedges and
// reeds, ferns and shrubs grown and photographed like the trees and 3D up close; all four groups; dense near, cards to
// ~250 m). Late October on an Adirondack pond:
//   in the shallows   cattail, bulrush, pickerelweed gone brown, bur-reed, sedge tussocks (picture cards); leatherleaf and
//                     sweet gale thickets standing in the water (grown); fragrant water lily and spatterdock pads,
//                     sphagnum mats with cranberry at the edge (flat cards)
//   at the waterline  sedge, bluejoint grass, highbush blueberry (scarlet), winterberry with its berries, royal and
//                     cinnamon ferns
//   under the trees   bracken, hay-scented and cinnamon ferns, bunchberry and lowbush blueberry, moss carpets, balsam fir,
//                     spruce and red maple seedlings
// The grown plants are a second tree engine (treeengine.js): every model photographed from 12 sides, one card each at
// any distance - and inside NEAR m of the camera the card dissolves (a screen dither) into the model it was
// photographed from (bikefree near-trunks.js NearPlants). Marshy stretches get the reeds and pads, rocky ones a fringe.
// Everything is placed once, from a seeded sequence of its own (the world's other random draws are untouched).
import * as THREE from 'three';
import { MAP } from './mapdata.js?v=0.17.0';
import { clamp, lerp, fbm, pondSD, heightAt, fullHeight, inPatch, inIsleBox, inCreekBox, beachFactor, CAMP, SWAY, TREE_LIGHT } from './world.js?v=0.17.0';
import { WIND, GUST_GLSL } from './wind.js?v=0.17.0';
import { makeUnderstoryKit } from './treekit.js?v=0.17.0';
import { TreeEngine } from './treeengine.js?v=0.17.0';
import { plantCards, SIDE, TOP } from './sprites.js?v=0.17.0';

const NEAR = [12, 15];   // m: the grown plants' card dissolves into the 3D model inside this
const DENSITY = { low: 0.45, med: 0.75, high: 1 };
const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function grad(x, z) { const e = 2, gx = pondSD(x + e, z) - pondSD(x - e, z), gz = pondSD(x, z + e) - pondSD(x, z - e), l = Math.hypot(gx, gz) || 1; return [gx / l, gz / l]; }
const landY = (x, z) => (inPatch(x, z) ? fullHeight(x, z) : heightAt(x, z));
const pickW = (r, table) => { let t = r() * table.reduce((s, e) => s + e[1], 0); for (const [v, w] of table) { t -= w; if (t <= 0) return v; } return table[0][0]; };

// ------------------------------------------------------------------ the near 3D plants
class NearPlants {
  constructor(scene, engine) {
    this.engine = engine; this.meshes = new Map(); this.at = null; this.t = -1;
    const dither = /* glsl */`
      varying float vNp;
      float npD() { return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715)))); }`;
    const patch = (m, leaf) => {
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, WIND.uniforms, SWAY);
        sh.vertexShader = `varying float vNp; uniform float uTime, uSwayQ;\n${leaf ? 'attribute vec4 aCard;' : ''}\n${GUST_GLSL}\n` + sh.vertexShader
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            {
              vec3 ib = instanceMatrix[3].xyz;
              vNp = 1. - smoothstep(${NEAR[0].toFixed(1)}, ${NEAR[1].toFixed(1)}, distance(ib.xz, cameraPosition.xz));
              // a little sway, the tops most (fronds and twigs in the gusts)
              float gu = gustAt(ib.xz), ph = dot(ib.xz, vec2(.37, .61)), hy = max(position.y, 0.);
              transformed.xz += (uWindDir * (gu * .12 + .02) * (.7 + .3 * sin(uTime * 1.7 + ph)) + vec2(sin(uTime * 2.6 + ph * 3.), cos(uTime * 2.1 + ph)) * .02) * hy * hy;
            }`)
          .replace('#include <project_vertex>', leaf ? `#include <project_vertex>
            {   // (bikefree leaf-cards.js: the clump opened square to the camera, scaled with the plant)
              float lcS = length(instanceMatrix[0].xyz), lcC = cos(aCard.z), lcN = sin(aCard.z);
              mvPosition.xy += mat2(lcC, lcN, -lcN, lcC) * aCard.xy * lcS;
              gl_Position = projectionMatrix * mvPosition;
            }` : '#include <project_vertex>');
        sh.fragmentShader = dither + "\n" + sh.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  if (vNp <= npD()) discard;   // (the complement of the card\'s dither)');
      };
      m.customProgramCacheKey = () => `fw-nearplant-${leaf ? 'l' : 'w'}`;
      return m;
    };
    this.woodMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, side: THREE.DoubleSide }), false);
    this.leafMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, side: THREE.DoubleSide, map: engine.kit.leafTexture, alphaTest: .45 }), true);
    for (const e of engine.kit.entries) {
      if (!e.wood) continue;
      const parts = [];
      for (const [g, m] of [[e.wood, this.woodMat], [e.leaves, this.leafMat]]) {
        if (!g) continue;
        // (the conifer seedlings' needles lifted as their photos were: treekit foliageGain)
        if (e.foliageGain && g.attributes.aTree) { const c = g.attributes.color, a = g.attributes.aTree; for (let i = 0; i < c.count; i++) if (a.getX(i) < .5) c.setXYZ(i, c.getX(i) * e.foliageGain, c.getY(i) * e.foliageGain, c.getZ(i) * e.foliageGain); }
        const im = new THREE.InstancedMesh(g, m, 160); im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
        im.name = `Understory near ${e.key}`; im.userData.keep = true; scene.add(im); parts.push(im);
      }
      this.meshes.set(e, parts);
    }
  }
  update(cam, now) {
    if (this.at && now - this.t < .25 && Math.hypot(cam.x - this.at.x, cam.z - this.at.z) < 1) return;
    this.t = now; this.at = { x: cam.x, z: cam.z };
    const list = this.engine.near3d(cam.x, cam.z, NEAR[1] + 1), counts = new Map(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    for (const t of list) {
      const parts = this.meshes.get(t.e); if (!parts) continue;
      const n = counts.get(t.e) || 0; if (n >= 160) continue; counts.set(t.e, n + 1);
      m4.compose(p.set(t.x, t.y, t.z), q.setFromAxisAngle(Y, t.rot), s.set(t.sx, t.sy, t.sx));
      for (const im of parts) { im.setMatrixAt(n, m4); }
    }
    for (const [e, parts] of this.meshes) { const n = counts.get(e) || 0; for (const im of parts) { im.count = n; im.instanceMatrix.needsUpdate = true; } }
  }
}

// ------------------------------------------------------------------ placement
/** points along the pond's shores every `step` m, with the normal pointing out into the water */
function shorePoints(step, r) {
  const pts = [];
  MAP.pond.forEach((ring) => {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / step));
      for (let j = 0; j < n; j++) { const t = (j + r()) / n, x = lerp(a[0], b[0], t), z = lerp(a[1], b[1], t); const [nx, nz] = grad(x, z); pts.push({ x, z, nx, nz }); }
    }
  });
  return pts;
}

export function buildUnderstory(scene, { renderer, tier = 'high', msaa = false, trees = null } = {}) {
  const t0 = performance.now(), r = rng(170017), dens = DENSITY[tier] ?? 1;
  const L0 = MAP.launch;   // (the put-in kept open)
  const skip = (x, z) => (inIsleBox(x, z) && beachFactor(x, z) > 0.2) || inCreekBox(x, z) || Math.hypot(x - CAMP.tent[0], z - CAMP.tent[1]) < (CAMP.R || 20) + 4 || Math.hypot(x - L0[0], z - L0[1]) < 16;
  // the grown plants' engine (its own atlas, smaller photos: they're small on screen)
  const kit = makeUnderstoryKit();
  const eng = new TreeEngine({ renderer, kit, tier, msaa, uniforms: { sway: SWAY, wind: WIND.uniforms, light: TREE_LIGHT }, gust: GUST_GLSL,
    name: 'Understory (grown plants)', cell: { low: 96, med: 128, high: 160 }, near: NEAR, grade: false, visD: 260 });
  const plants = [], side = [], flat = [];
  const plant = (key, x, y, z, sc) => { const e = eng.index.get(key); if (!e) return; plants.push({ x, y, z, key, h: e.top * sc, w: .9 + r() * .25, rot: r() * 6.283, tint: .85 + r() * .3 }); };
  const card = (cell, x, y, z, w, h, tint = 1) => side.push({ x, y, z, cell, w, h, rot: r() * 3.1416, tint: [tint, tint, tint * (.95 + r() * .1)], tilt: (r() - .5) * .12, tilt2: (r() - .5) * .12 });
  const pad = (cell, x, y, z, s, tint) => flat.push({ x, y, z, cell, w: s, h: s, rot: r() * 6.283, tint });
  const jit = () => .85 + r() * .3;

  // (Floodwood's woods are drawn larger than life - the shore's trees run to 30-50 m - so the plants are too, ~1.5x)
  const K = 1.5;
  const emergent = (kind, x, z, s) => {
    if (kind === 'cattail') card(SIDE.cattail, x, -0.2, z, 1.2 * s * K, 2.3 * s * K);
    else if (kind === 'bulrush') card(SIDE.bulrush, x, -0.2, z, 1.0 * s * K, 2.0 * s * K);
    else if (kind === 'pickerel') card(SIDE.pickerel, x, -0.12, z, 1.15 * s * K, 1.05 * s * K);
    else if (kind === 'burreed') card(SIDE.burreed, x, -0.12, z, 1.2 * s * K, 1.15 * s * K);
    else card(SIDE.sedge, x, -0.1, z, 1.1 * s * K, 0.95 * s * K);
  };
  // a clump: n of a kind round (x, z) within rad, each kept only where ok(x, z, sd) - plants grow in drifts, not singly
  const clump = (n, x0, z0, rad, ok, fn) => { for (let k = 0; k < n; k++) { const a = r() * 6.283, d = rad * Math.sqrt(r()), x = x0 + Math.cos(a) * d, z = z0 + Math.sin(a) * d, sd = pondSD(x, z); if (ok(sd, x, z)) fn(x, z, sd, k); } };
  const inShallows = (lo, hi) => (sd) => sd > lo && sd < hi;
  const onLand = (sd, x, z) => sd < -0.3 && landY(x, z) > 0.05;

  for (const p of shorePoints(2.5, r)) {
    if (skip(p.x, p.z)) continue;
    // marsh: the stretches the old reed beds and shrub islands kept to (shore.js), and a patchiness of their own
    const marsh = clamp((0.52 - fbm(p.x * 0.012 + 7, p.z * 0.012 - 2)) / 0.3, 0, 1), patch = fbm(p.x * 0.05 - 3, p.z * 0.05 + 9);
    const tx = -p.nz, tz = p.nx;   // along the shore
    const at = (d, spread) => { const o = (r() - .5) * spread; return [p.x + p.nx * d + tx * o, p.z + p.nz * d + tz * o]; };
    // --- in the shallows: beds of emergents (wide and tall in the marsh, a fringe of sedge elsewhere)
    const nBeds = (0.35 + 1.6 * marsh * (0.5 + patch)) * dens;
    for (let q = 0; q < Math.floor(nBeds + r()); q++) {
      const kind = marsh > .3 ? pickW(r, [['cattail', 3], ['bulrush', 2.5], ['pickerel', 2.2], ['burreed', 1.2], ['sedge', 2]]) : pickW(r, [['sedge', 5], ['bulrush', 2], ['pickerel', 1]]);
      const [cx, cz] = at(0.3 + Math.pow(r(), 1.3) * (1.5 + 8 * marsh), 3);
      clump(4 + Math.floor(r() * (6 + 8 * marsh)), cx, cz, 1.2 + r() * 2.2, inShallows(0.1, 11), (x, z) => emergent(r() < .85 ? kind : 'sedge', x, z, jit()));
    }
    if (marsh > .2 && r() < (0.15 + 0.6 * marsh) * dens) {   // leatherleaf / sweet gale thickets standing in the water
      const [cx, cz] = at(0.5 + r() * 4, 3), sp = r() < .6 ? 'leatherleaf' : 'sweetgale';
      clump(2 + Math.floor(r() * 4), cx, cz, 1.6, inShallows(0.2, 6), (x, z) => plant(`${sp}:${sp === 'leatherleaf' && r() < .5 ? 1 : 0}`, x, -0.25, z, (0.9 + r() * 0.6) * 1.3));
    }
    // --- floating: lily and spatterdock pads in patches off the marshy shores and coves; sphagnum mats at the edge
    const padP = fbm(p.x * 0.03, p.z * 0.03);
    if (padP > 0.44 && r() < (0.3 + marsh) * dens) {
      const [cx, cz] = at(3 + r() * 12, 6), n = 4 + Math.floor(r() * 12 * (padP - 0.38) * 3);
      clump(n, cx, cz, 4 + r() * 4, inShallows(1.2, 24), (x, z) => {
        const sp = r() < .72, g = .8 + r() * .35, rust = r() < .25 ? [1.15, .85, .7] : [1, 1, 1];
        pad(sp ? TOP.lily : TOP.spatter, x, 0.035 + r() * .004, z, (sp ? 0.9 + r() * 0.6 : 1.2 + r() * 0.6) * 1.2, [g * rust[0], g * rust[1], g * rust[2]]);
      });
    }
    if (marsh > .3 && r() < marsh * .8 * dens) { const [x, z] = at(-0.5 + r() * 2.2, 3), sd = pondSD(x, z); if (sd > -1 && sd < 2) pad(TOP.sphagnum, x, Math.max(landY(x, z), 0) + 0.03, z, 2.5 + r() * 3, [jit(), jit(), jit()]); }
    // --- the waterline: a fringe of sedge and grass the whole way round, shrubs and ferns in it
    { const [cx, cz] = at(-0.4 - r() * 1.6, 3); clump(Math.round((3 + 3 * r()) * dens), cx, cz, 1.8, (sd, x, z) => sd < 0.6 && sd > -3 && landY(x, z) > -0.3, (x, z) => { const y = Math.max(landY(x, z), -0.1); if (r() < .6) card(SIDE.sedge, x, y - .05, z, 1.1 * jit() * K, 0.9 * jit() * K); else card(SIDE.bluejoint, x, y - .05, z, 1.2 * jit() * K, 1.2 * jit() * K); }); }
    if (r() < (0.45 + 0.3 * marsh) * dens) {
      // (the scarlet of the blueberries a highlight, not a hedge: ferns, winterberry's yellow, sweet gale's olive and
      //  leatherleaf's bronze make most of the edge)
      const kind = pickW(r, [['blueberry', 1], ['winterberry', .8], ['sweetgale', .8], ['royal', 2], ['cinnamon', 1.6], ['leatherleaf', .4 + marsh * 1.5]]), [cx, cz] = at(-0.8 - r() * 3.5, 3);
      const fernish = kind === 'royal' || kind === 'cinnamon';
      clump(fernish ? 3 + Math.floor(r() * 5) : 1 + Math.floor(r() * 2), cx, cz, fernish ? 2.2 : 2.6, onLand, (x, z) => plant(`${kind}:${(kind === 'blueberry' || fernish || kind === 'leatherleaf') && r() < .5 ? 1 : 0}`, x, landY(x, z) - .05, z, (fernish ? 1.35 : 1) * (.85 + r() * .4)));
    }
    // --- under the trees: drifts of fern, carpets of bunchberry and lowbush blueberry, moss, seedlings - densest near
    //     the water, thinning inland to ~40 m
    const nF = (2.0 + 0.6 * patch) * dens;
    for (let q = 0; q < Math.floor(nF + r()); q++) {
      const L = 3 + Math.pow(r(), 1.5) * 38, [cx, cz] = at(-L, 4);
      const kind = pickW(r, [['bracken', 2.4], ['hayscented', 1.8], ['cinnamon', .9], ['bunchberry', 1.4], ['lowblue', 1.6], ['moss', 1.4], ['seedling', .9], ['blueberry', .3]]);
      if (kind === 'bunchberry') clump(5 + Math.floor(r() * 7), cx, cz, 2, onLand, (x, z) => card(SIDE.bunchberry, x, landY(x, z) - .03, z, 1.0 * jit() * K, 0.32 * jit() * K));
      else if (kind === 'lowblue') clump(4 + Math.floor(r() * 6), cx, cz, 2.4, onLand, (x, z) => card(SIDE.lowblue, x, landY(x, z) - .03, z, 1.1 * jit() * K, 0.55 * jit() * K));
      else if (kind === 'moss') clump(2 + Math.floor(r() * 3), cx, cz, 2.5, onLand, (x, z) => pad(TOP.moss, x, landY(x, z) + .025, z, 1.8 + r() * 2.4, [jit(), jit(), jit()]));
      else if (kind === 'seedling') clump(1 + Math.floor(r() * 3), cx, cz, 3, onLand, (x, z) => plant(pickW(r, [['firling:0', 3], ['sprucling:0', 2], ['maplet:0', 1.5]]), x, landY(x, z) - .05, z, (.45 + r() * .7) * 1.3));
      else if (kind === 'blueberry') clump(1 + Math.floor(r() * 2), cx, cz, 2, onLand, (x, z) => plant('blueberry:0', x, landY(x, z) - .05, z, (.7 + r() * .4) * 1.3));
      else clump(4 + Math.floor(r() * 6), cx, cz, 2.6, onLand, (x, z) => plant(`${kind}:${r() < .5 ? 0 : 1}`, x, landY(x, z) - .05, z, (.85 + r() * .55) * 1.4));
    }
  }
  // the grown plants: cards (and 3D up close)
  eng.setTrees(plants); scene.add(eng.mesh);
  eng.mesh.castShadow = true; eng.mesh.receiveShadow = false;   // (as the trees': they shade the ground, not each other)
  const near = isTouch && tier === 'low' ? null : new NearPlants(scene, eng);
  const sideMeshes = plantCards(scene, side, { side: true, msaa }), flatMeshes = plantCards(scene, flat, { side: false });
  for (const im of flatMeshes) { im.receiveShadow = true; }
  for (const im of sideMeshes) { im.receiveShadow = true; }
  const stats = { plants: plants.length, cards: side.length, flat: flat.length, atlasMB: eng.memMB, cell: eng.cell, ms: Math.round(performance.now() - t0) };
  return {
    engine: eng, stats,
    setVis(d) { eng.setVis(d); },
    setMSAA(on) { eng.setMSAA(on); },
    update(camera, now) { if (near) near.update(camera.position, now); },
  };
}
