// v0.17.0: the pond edge's small plants as picture cards (bikefree landscape/grass-cards.js, 24-26 Nov: "soft grass" -
// soft roadside plants as alpha-cut cards drawn once into a canvas atlas at start, no download; each plant two or three
// crossed cards that sway in the wind; replaces single-triangle blades, which read as a spiky saw-tooth fringe).
//
// Two atlases, drawn at load:
//   SIDE  plants seen from the side, roots at the foot: sedge tussock, cattail, pickerelweed, bulrush, bur-reed, bluejoint
//         grass, bunchberry, lowbush blueberry - in late-October colour (the cards' own; a tint per plant)
//   TOP   things lying flat: a fragrant water lily's pad, spatterdock's, a sphagnum mat with cranberry, a moss carpet
// Each kind of card is instanced in 400 m tiles (world.js TILES: culled by distance and frustum) - every side plant in a
// tile one draw call, every flat one another. The side cards are lit as the ground under them (facing up), so they
// don't flicker light and dark as they turn; they sway with the shared gust field, the top of the card most.
import * as THREE from 'three';
import { EXT, TILES, SWAY } from './world.js?v=0.18.0';
import { WIND, GUST_GLSL } from './wind.js?v=0.18.0';

export const SIDE = { sedge: 0, cattail: 1, pickerel: 2, bulrush: 3, burreed: 4, bluejoint: 5, bunchberry: 6, lowblue: 7 };
export const TOP = { lily: 0, spatter: 1, sphagnum: 2, moss: 3 };
const SN = 8, SW = 256, SH = 512, TN = 4, TW = 256;

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const rgb = (c, k = 1, a = 1) => `rgba(${Math.round(Math.min(255, c[0] * k))},${Math.round(Math.min(255, c[1] * k))},${Math.round(Math.min(255, c[2] * k))},${a})`;
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ------------------------------------------------------------------ the side atlas
function drawSide() {
  const cv = document.createElement('canvas'); cv.width = SW * SN; cv.height = SH;
  const g = cv.getContext('2d');
  // a tapered blade from (x0, foot) curving to its tip; bend: sideways lean (px per px of height), w: half width at the foot
  const blade = (x0, len, bend, w, col, foot = SH) => {
    const tipX = x0 + bend * len, tipY = foot - len, cx = x0 + bend * len * .3, cy = foot - len * .65;
    const grd = g.createLinearGradient(0, foot, 0, tipY); grd.addColorStop(0, rgb(col[0], .72)); grd.addColorStop(.5, rgb(col[1])); grd.addColorStop(1, rgb(col[2] || col[1], 1.08));
    g.beginPath(); g.moveTo(x0 - w, foot); g.quadraticCurveTo(cx - w * .5, cy, tipX, tipY); g.quadraticCurveTo(cx + w * .5, cy, x0 + w, foot); g.closePath();
    g.fillStyle = grd; g.fill();
  };
  const stem = (x0, y0, x1, y1, w, col) => { g.strokeStyle = rgb(col); g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2 + (x1 - x0) * .1, (y0 + y1) / 2, x1, y1); g.stroke(); };
  const ell = (x, y, rx, ry, rot, fill) => { g.save(); g.translate(x, y); g.rotate(rot); g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 6.283); g.fillStyle = fill; g.fill(); g.restore(); };
  const cells = [
    // 0 sedge tussock: a dense fountain of fine arching blades, green at the base, gold and tan at the tips
    (ox, r) => {
      for (let k = 0; k < 70; k++) {
        const x = ox + SW / 2 + (r() - .5) * 60, len = SH * (.45 + r() * .45), bend = (r() - .5) * 1.1, t = r();
        const tip = t < .5 ? [205, 170, 90] : t < .8 ? [180, 140, 70] : [140, 150, 70];
        blade(x, len, bend, 3 + r() * 2.5, [[70, 85, 40], [150, 140, 70], tip]);
      }
    },
    // 1 cattail: long strap leaves (tan, a few still olive), stalks with the brown spike and its bare tip
    (ox, r) => {
      for (let k = 0; k < 16; k++) blade(ox + SW / 2 + (r() - .5) * 70, SH * (.6 + r() * .38), (r() - .5) * .35, 6 + r() * 4, r() < .7 ? [[90, 80, 50], [176, 150, 92], [200, 172, 110]] : [[60, 70, 35], [110, 118, 58], [150, 140, 72]]);
      for (let k = 0; k < 3; k++) {
        const x = ox + SW / 2 + (k - 1) * 34 + (r() - .5) * 14, top = SH * (.05 + r() * .12), spikeH = SH * .17;
        stem(x, SH, x + (r() - .5) * 10, top, 4, [120, 110, 70]);
        g.fillStyle = rgb([92, 58, 34]); g.beginPath(); g.ellipse(x, top + spikeH * .75, 11, spikeH * .5, 0, 0, 6.283); g.fill();
        g.fillStyle = rgb([118, 78, 46]); g.beginPath(); g.ellipse(x - 3, top + spikeH * .7, 4, spikeH * .42, 0, 0, 6.283); g.fill();
        stem(x, top + spikeH * .3, x, top - 18, 2.5, [130, 110, 70]);
      }
    },
    // 2 pickerelweed: heart-shaped leaves on long stalks, gone brown and olive, some fallen over
    (ox, r) => {
      for (let k = 0; k < 11; k++) {
        const x0 = ox + SW / 2 + (r() - .5) * 60, h = SH * (.35 + r() * .45), lean = (r() - .5) * .5, x1 = x0 + lean * h, y1 = SH - h;
        const c = r() < .55 ? [120, 92, 52] : r() < .8 ? [92, 96, 48] : [70, 60, 40];
        stem(x0, SH, x1, y1 + 12, 3, mixc(c, [60, 55, 35], .4));
        const w = 26 + r() * 14, ang = lean * 1.2 + (r() - .5) * .5;
        g.save(); g.translate(x1, y1); g.rotate(ang);
        g.beginPath(); g.moveTo(0, -w * 1.5); g.bezierCurveTo(w, -w * 1.1, w * .9, w * .3, 0, w * .35); g.bezierCurveTo(-w * .9, w * .3, -w, -w * 1.1, 0, -w * 1.5);
        const grd = g.createLinearGradient(-w, 0, w, 0); grd.addColorStop(0, rgb(c, .85)); grd.addColorStop(.5, rgb(c, 1.1)); grd.addColorStop(1, rgb(c, .8));
        g.fillStyle = grd; g.fill(); g.strokeStyle = rgb(c, .6); g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -w * 1.4); g.lineTo(0, w * .3); g.stroke();
        g.restore();
      }
    },
    // 3 bulrush: many thin round stems standing straight, olive going tan, little brown seed clusters near the tops
    (ox, r) => {
      for (let k = 0; k < 40; k++) {
        const x = ox + SW / 2 + (r() - .5) * 90, h = SH * (.55 + r() * .43), lean = (r() - .5) * .18, c = r() < .5 ? [150, 140, 80] : [110, 118, 62];
        blade(x, h, lean, 2.2, [mixc(c, [60, 60, 35], .5), c, mixc(c, [190, 160, 100], .5)]);
        if (r() < .35) { const tx = x + lean * h * .85, ty = SH - h * .85; for (let q = 0; q < 4; q++) ell(tx + (r() - .5) * 10, ty + (r() - .5) * 10, 4, 5, r(), rgb([110, 72, 40])); }
      }
    },
    // 4 bur-reed: floppy ribbon leaves arching over, and spiky green-brown seed balls on zigzag stalks
    (ox, r) => {
      for (let k = 0; k < 18; k++) blade(ox + SW / 2 + (r() - .5) * 60, SH * (.5 + r() * .35), (r() - .5) * 1.4, 5 + r() * 3, [[60, 70, 35], [120, 122, 60], r() < .5 ? [170, 150, 80] : [130, 130, 64]]);
      for (let k = 0; k < 2; k++) {
        let x = ox + SW / 2 + (k ? 20 : -25), y = SH;
        for (let s = 0; s < 3; s++) { const nx = x + (s % 2 ? 14 : -14), ny = y - SH * .14; stem(x, y, nx, ny, 3, [110, 110, 60]); x = nx; y = ny;
          g.fillStyle = rgb([100, 96, 50]); g.beginPath(); g.arc(x, y, 11, 0, 6.283); g.fill();
          g.strokeStyle = rgb([80, 70, 40]); g.lineWidth = 1.5; for (let q = 0; q < 10; q++) { const a = q * .628; g.beginPath(); g.moveTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9); g.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14); g.stroke(); } }
      }
    },
    // 5 bluejoint grass: fine blades past the knee, airy tan panicles
    (ox, r) => {
      for (let k = 0; k < 55; k++) blade(ox + SW / 2 + (r() - .5) * 80, SH * (.3 + r() * .4), (r() - .5) * .8, 2 + r() * 1.5, [[80, 80, 45], [170, 150, 90], [210, 186, 130]]);
      for (let k = 0; k < 14; k++) {
        const x0 = ox + SW / 2 + (r() - .5) * 70, h = SH * (.6 + r() * .36), lean = (r() - .5) * .3, x1 = x0 + lean * h, y1 = SH - h;
        stem(x0, SH, x1, y1, 1.6, [180, 160, 110]);
        for (let q = 0; q < 16; q++) { const t = r() * .3, px = x1 + (x0 - x1) * t, py = y1 + h * t; stem(px, py, px + (r() - .5) * 26, py - 8 - r() * 16, 1, [212, 190, 140]); }
      }
    },
    // 6 bunchberry: a low carpet of whorled oval leaves gone wine-red and purple, a few red berries
    (ox, r) => {
      for (let k = 0; k < 16; k++) {
        const x = ox + 30 + r() * (SW - 60), y = SH - 20 - r() * SH * .12, c = [[130, 40, 50], [150, 60, 50], [110, 50, 70], [120, 110, 50]][Math.floor(r() * 4)];
        stem(x, SH, x, y, 2, [90, 60, 40]);
        for (let q = 0; q < 6; q++) { const a = q / 6 * 6.283 + r() * .3; ell(x + Math.cos(a) * 16, y + Math.sin(a) * 5, 17, 7, a, rgb(c, .8 + r() * .4)); }
        if (r() < .3) for (let q = 0; q < 4; q++) ell(x + (r() - .5) * 8, y - 6 + (r() - .5) * 6, 4, 4, 0, rgb([200, 30, 30]));
      }
    },
    // 7 lowbush blueberry: a knee-high tangle of green twigs and small leaves in crimson and scarlet
    (ox, r) => {
      for (let k = 0; k < 22; k++) {
        const x0 = ox + SW / 2 + (r() - .5) * 120, h = SH * (.18 + r() * .22), x1 = x0 + (r() - .5) * 60, y1 = SH - h;
        stem(x0, SH, x1, y1, 2, [96, 80, 50]);
        for (let q = 0; q < 10; q++) { const t = .3 + r() * .7, px = x0 + (x1 - x0) * t + (r() - .5) * 14, py = SH - h * t; ell(px, py, 7 + r() * 3, 4, r() * 6, rgb([[176, 30, 30], [200, 50, 30], [140, 26, 36], [170, 70, 40]][Math.floor(r() * 4)], .85 + r() * .3)); }
      }
    },
  ];
  cells.forEach((fn, k) => { g.save(); g.beginPath(); g.rect(k * SW, 0, SW, SH); g.clip(); fn(k * SW, rng(9100 + k * 77)); g.restore(); });
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ the top atlas
function drawTop() {
  const cv = document.createElement('canvas'); cv.width = TW * TN; cv.height = TW;
  const g = cv.getContext('2d'), c = TW / 2;
  const cells = [
    // 0 fragrant water lily: a round pad with a slit to the middle, olive with a red-brown rim, fine veins, late-season
    //   yellowing and a torn edge on some
    (ox, r) => {
      const R = c * .9, slit = r() * 6.283;
      g.save(); g.translate(ox + c, c);
      g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, slit + .08, slit + 6.283 - .08); g.closePath();
      const grd = g.createRadialGradient(0, 0, R * .2, 0, 0, R); grd.addColorStop(0, rgb([96, 112, 46])); grd.addColorStop(.75, rgb([110, 116, 48])); grd.addColorStop(1, rgb([120, 70, 40]));
      g.fillStyle = grd; g.fill();
      g.strokeStyle = 'rgba(40,50,20,.35)'; g.lineWidth = 1.2;
      for (let k = 0; k < 22; k++) { const a = slit + .2 + k / 22 * 5.9; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * R * .95, Math.sin(a) * R * .95); g.stroke(); }
      for (let k = 0; k < 6; k++) { const a = r() * 6.283, d = R * (.4 + r() * .5); g.fillStyle = `rgba(${150 + r() * 40},${120 + r() * 30},40,.35)`; g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, 8 + r() * 16, 0, 6.283); g.fill(); }
      g.restore();
    },
    // 1 spatterdock: a bigger heart-shaped pad, deeper notch, greener, its edge wavy
    (ox, r) => {
      g.save(); g.translate(ox + c, c);
      g.beginPath();
      for (let k = 0; k <= 64; k++) { const a = .35 + k / 64 * (6.283 - .7), rr = c * .92 * (1 - .06 * Math.sin(a * 9 + r())) * (.85 + .15 * Math.abs(Math.cos(a / 2))); const x = Math.cos(a) * rr * .8, y = Math.sin(a) * rr; k ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.lineTo(c * .05, 0); g.closePath();
      const grd = g.createRadialGradient(0, 0, 5, 0, 0, c); grd.addColorStop(0, rgb([80, 104, 40])); grd.addColorStop(1, rgb([96, 106, 42]));
      g.fillStyle = grd; g.fill();
      g.strokeStyle = 'rgba(40,50,20,.3)'; g.lineWidth = 1.3;
      for (let k = 0; k < 16; k++) { const a = .5 + k / 16 * 5.3; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(Math.cos(a) * c * .3, Math.sin(a) * c * .5, Math.cos(a) * c * .72, Math.sin(a) * c * .88); g.stroke(); }
      g.restore();
    },
    // 2 sphagnum mat: an irregular cushion of moss in green, gold and red, cranberry runners and berries on it
    (ox, r) => {
      g.save(); g.translate(ox + c, c);
      g.beginPath(); for (let k = 0; k <= 40; k++) { const a = k / 40 * 6.283, rr = c * (.72 + .18 * Math.sin(a * 3 + 1) + .08 * Math.sin(a * 7)); const x = Math.cos(a) * rr, y = Math.sin(a) * rr; k ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.clip();
      g.fillStyle = rgb([120, 110, 50]); g.fillRect(-c, -c, TW, TW);
      for (let k = 0; k < 900; k++) { const x = (r() - .5) * TW, y = (r() - .5) * TW, t = r(); g.fillStyle = rgb(t < .35 ? [110, 130, 50] : t < .6 ? [170, 140, 60] : t < .8 ? [150, 70, 50] : [90, 100, 40], .8 + r() * .4); g.beginPath(); g.arc(x, y, 2 + r() * 4, 0, 6.283); g.fill(); }
      g.strokeStyle = rgb([110, 40, 30]); g.lineWidth = 1.5;
      for (let k = 0; k < 8; k++) { let x = (r() - .5) * TW * .7, y = (r() - .5) * TW * .7; g.beginPath(); g.moveTo(x, y); for (let q = 0; q < 5; q++) { x += (r() - .5) * 40; y += (r() - .5) * 40; g.lineTo(x, y); } g.stroke(); }
      for (let k = 0; k < 14; k++) { g.fillStyle = rgb([170, 20, 30]); g.beginPath(); g.arc((r() - .5) * TW * .7, (r() - .5) * TW * .7, 4, 0, 6.283); g.fill(); }
      g.restore();
    },
    // 3 moss carpet on the forest floor: soft green with lighter tips, a few club-moss stars
    (ox, r) => {
      g.save(); g.translate(ox + c, c);
      g.beginPath(); for (let k = 0; k <= 40; k++) { const a = k / 40 * 6.283, rr = c * (.7 + .2 * Math.sin(a * 4 + 2) + .07 * Math.sin(a * 9)); const x = Math.cos(a) * rr, y = Math.sin(a) * rr; k ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.clip();
      g.fillStyle = rgb([50, 74, 28]); g.fillRect(-c, -c, TW, TW);
      for (let k = 0; k < 1200; k++) { const t = r(); g.fillStyle = rgb(t < .5 ? [70, 100, 36] : t < .85 ? [90, 120, 44] : [120, 120, 50], .8 + r() * .35); g.beginPath(); g.arc((r() - .5) * TW, (r() - .5) * TW, 1.5 + r() * 3, 0, 6.283); g.fill(); }
      g.strokeStyle = rgb([40, 80, 30]); g.lineWidth = 2;
      for (let k = 0; k < 9; k++) { const x = (r() - .5) * TW * .6, y = (r() - .5) * TW * .6; for (let q = 0; q < 6; q++) { const a = q * 1.047; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10); g.stroke(); } }
      g.restore();
    },
  ];
  cells.forEach((fn, k) => fn(k * TW, rng(9300 + k * 53)));
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------ geometry and materials
/** a side plant: `n` crossed vertical cards (unit size: 1 wide, 1 tall, base at y 0), facing up for the light */
function sideGeometry(n = 3) {
  const P = [], U = [], N = [], I = [];
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI, cx = Math.cos(a) * .5, cz = Math.sin(a) * .5, b = P.length / 3;
    P.push(-cx, 0, -cz, cx, 0, cz, cx, 1, cz, -cx, 1, -cz); U.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (let q = 0; q < 4; q++) N.push(0, 1, 0);
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setIndex(I);
  return g;
}
/** a flat card (unit square, centred, on the xz plane) */
function topGeometry() { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g; }

function cardMaterial(map, cells, side, a2c) {
  const m = new THREE.MeshStandardMaterial({ map, roughness: side ? .95 : .5, metalness: 0, side: THREE.DoubleSide, alphaTest: a2c ? 0 : .5, alphaToCoverage: a2c, envMapIntensity: side ? 1 : 1.2 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, WIND.uniforms, SWAY, { uFade: { value: new THREE.Vector2(200, 260) } });
    sh.vertexShader = 'attribute float iCell;\nuniform float uTime, uSwayQ;\nuniform vec2 uFade;\n' + GUST_GLSL + '\n' + sh.vertexShader
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n  vMapUv.x = (iCell + vMapUv.x) / ${cells}.;`)
      .replace('#include <project_vertex>', `
        vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          vec3 ib = instanceMatrix[3].xyz;
          // shrink to nothing toward the far edge of their reach (no pop as a tile drops out)
          float far = 1. - smoothstep(uFade.x, uFade.y, distance(ib.xz, cameraPosition.xz));
          mvPosition.xyz *= far;
          mvPosition = instanceMatrix * mvPosition;
          ${side ? `
          // the top of the card sways with the gusts and its own flutter
          float hy = max(mvPosition.y - ib.y, 0.);
          float gu = gustAt(ib.xz), ph = dot(ib.xz, vec2(.37, .61));
          vec2 sw = uWindDir * (gu * .35 + .06) * (.7 + .3 * sin(uTime * 1.6 + ph)) + vec2(sin(uTime * 2.3 + ph * 3.1), cos(uTime * 1.9 + ph * 2.3)) * .025;
          mvPosition.xz += sw * hy * hy * .8;` : ''}
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
    // (v0.18.0: both faces lit as the ground under them - three flips a back face's normal, so the far side of every
    //  crossed card faced down into the dark ground light and came out black)
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize((viewMatrix * vec4(0., 1., 0., 0.)).xyz); nonPerturbedNormal = normal;');
    if (a2c) sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', 'diffuseColor.a = clamp((diffuseColor.a - .5) / max(fwidth(diffuseColor.a), 1e-4) + .5, 0., 1.); if (diffuseColor.a <= 0.) discard;');
  };
  m.customProgramCacheKey = () => `fw-sprites-2-${side ? 's' : 't'}-${a2c ? 1 : 0}`;
  return m;
}

/**
 * Plant cards in 400 m tiles. items: [{ x, y, z, cell, w, h, rot, tint: [r, g, b], tilt }]; side: crossed side cards or
 * flat ones. Returns the tiles' meshes (tag 'under': cullTiles keeps them within reach).
 */
export function plantCards(scene, items, { side = true, msaa = false, tag = 'under' } = {}) {
  if (!items.length) return [];
  if (!plantCards.tex) plantCards.tex = { side: drawSide(), top: drawTop() };
  const base = side ? sideGeometry(3) : topGeometry(), mat = cardMaterial(side ? plantCards.tex.side : plantCards.tex.top, side ? SN : TN, side, msaa && side);
  const buckets = new Map();
  for (const it of items) { const k = Math.floor((it.x - EXT.minX) / 400) + ',' + Math.floor((it.z - EXT.minZ) / 400); let b = buckets.get(k); if (!b) buckets.set(k, b = []); b.push(it); }
  const out = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  buckets.forEach((list) => {
    const geo = base.clone(), cell = new Float32Array(list.length);
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => {
      e.set(it.tilt || 0, it.rot, (it.tilt2 || 0)); q.setFromEuler(e);
      m4.compose(p.set(it.x, it.y, it.z), q, s.set(it.w, side ? it.h : 1, side ? it.w : it.h)); im.setMatrixAt(i, m4);
      im.setColorAt(i, c.setRGB(...(it.tint || [1, 1, 1]))); cell[i] = it.cell;
    });
    geo.setAttribute('iCell', new THREE.InstancedBufferAttribute(cell, 1));
    im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere(); im.userData.tag = tag; im.userData.full = list.length; im.userData.keep = true;
    im.name = side ? 'Understory (plant cards)' : 'Understory (flat cards)';
    if (!side) im.renderOrder = 2;   // (over the water)
    scene.add(im); TILES.push(im); out.push(im);
  });
  return out;
}
