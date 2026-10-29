// Shared wind / gust field. The same function runs in JS (canoe drift, gust audio, falling leaves)
// and in GLSL (cat's-paws on the water, tree sway), so what you see on the water is what pushes the canoe.
import * as THREE from 'three';

const fract = (x) => x - Math.floor(x);
const h2 = (x, z) => fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453);
function n2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z); let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = h2(ix, iz), b = h2(ix + 1, iz), c = h2(ix, iz + 1), d = h2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const WIND = {
  dir: new THREE.Vector2(0.8, 0.6).normalize(), // direction the wind blows TOWARD (x, z)
  angle: Math.atan2(0.6, 0.8),
  base: 0.25,      // steady breeze 0..1
  gust: 0.6,       // gust strength 0..1
  speed: 7,        // how fast gust fronts travel across the pond (m/s)
  t: 0,
  off: new THREE.Vector2(), // integrated drift of the gust pattern (so a slowly turning wind never makes patches jump)
  uniforms: { uWindDir: { value: new THREE.Vector2(0.8, 0.6) }, uWindBase: { value: 0.25 }, uWindGust: { value: 0.6 }, uWindT: { value: 0 }, uWindOff: { value: new THREE.Vector2() } },
};

/** gust intensity at (x, z): 0 = calm, ~1 = a strong cat's-paw */
export function gustAt(x, z) {
  const d = WIND.dir, o = WIND.off;
  const px = (x - o.x) * 0.011, pz = (z - o.y) * 0.011;
  // stretch the patches along the wind so they read as moving fronts
  const u = px * d.x + pz * d.y, v = -px * d.y + pz * d.x;
  const n = 0.65 * n2(u * 0.7 + 3.1, v * 1.4 + 1.7) + 0.35 * n2(u * 1.9 + 11.3, v * 3.1 - 4.2);
  return WIND.base * 0.35 + WIND.gust * smooth(0.52, 0.8, n);
}

/** GLSL twin of gustAt(); needs the WIND uniforms. */
export const GUST_GLSL = /* glsl */`
  uniform vec2 uWindDir, uWindOff; uniform float uWindBase, uWindGust, uWindT;
  float wh2(vec2 p){ return fract(sin(p.x*127.1 + p.y*311.7) * 43758.5453); }
  float wn2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    float a=wh2(i), b=wh2(i+vec2(1.,0.)), c=wh2(i+vec2(0.,1.)), d=wh2(i+vec2(1.,1.));
    return a + (b-a)*f.x + (c-a)*f.y + (a-b-c+d)*f.x*f.y; }
  float gustAt(vec2 xz){
    vec2 p = (xz - uWindOff) * 0.011;
    float u = dot(p, uWindDir), v = dot(p, vec2(-uWindDir.y, uWindDir.x));
    float n = .65*wn2(vec2(u*.7+3.1, v*1.4+1.7)) + .35*wn2(vec2(u*1.9+11.3, v*3.1-4.2));
    return uWindBase*.35 + uWindGust*smoothstep(.52, .8, n);
  }`;

/** advance the wind: the direction wanders slowly, strength follows the weather */
export function updateWind(dt, t, weatherWind) {
  WIND.t = t;
  WIND.angle += Math.sin(t * 0.013) * 0.0009 + Math.sin(t * 0.0047 + 1.3) * 0.0006;
  WIND.dir.set(Math.cos(WIND.angle), Math.sin(WIND.angle));
  WIND.off.addScaledVector(WIND.dir, WIND.speed * dt);
  const target = weatherWind === undefined ? 0.3 : weatherWind;
  WIND.base += (target - WIND.base) * Math.min(1, dt * 0.05);
  WIND.gust = 0.25 + WIND.base * 1.2;
  const U = WIND.uniforms; U.uWindDir.value.copy(WIND.dir); U.uWindBase.value = WIND.base; U.uWindGust.value = WIND.gust; U.uWindT.value = t; U.uWindOff.value.copy(WIND.off);
}
