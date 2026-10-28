import * as THREE from 'three';
import { EXT, sstep, clamp, lerp } from './world.js';

// ------------------------------------------------------------------ day/night palette
const K = (h, top, mid, hor, fog, hemiS, hemiG, sun, fogD, hemiI) => ({ h, top: new THREE.Color(top), mid: new THREE.Color(mid), hor: new THREE.Color(hor), fog: new THREE.Color(fog), hemiS: new THREE.Color(hemiS), hemiG: new THREE.Color(hemiG), sun: new THREE.Color(sun), fogD, hemiI });
const KEYS = [
  K(0,    0x040a1c, 0x0a1430, 0x14234a, 0x0e1a36, 0x2b3f78, 0x0b1020, 0x000000, 0.00085, 0.55),
  K(4.4,  0x07123a, 0x1a2a5c, 0x3a4380, 0x1e2a52, 0x33467f, 0x0e1424, 0x000000, 0.00095, 0.55),
  K(5.5,  0x1c3374, 0x6b5a98, 0xf29a78, 0x9c7a88, 0x8a84b8, 0x4a4a52, 0xff9d6a, 0.0012,  1.0),
  K(6.4,  0x3a6fc0, 0x9dbce0, 0xffcf9c, 0xd9b8a0, 0xa8c0e0, 0x58584a, 0xffcb94, 0.0010,  1.0),
  K(8.5,  0x3b7fd6, 0x8ec3ee, 0xd2e6f4, 0xbcd4e6, 0xa6c8f0, 0x55583a, 0xfff0d8, 0.00062, 0.95),
  K(12,   0x2d72cf, 0x7db8ee, 0xc0e0f4, 0xaecbe2, 0xa0c8f2, 0x5a5c3c, 0xfffbe8, 0.00055, 1.0),
  K(16,   0x3578cc, 0x86bbe8, 0xd8e6ee, 0xc0d2e0, 0xa0c4ee, 0x5a5636, 0xfff0cc, 0.00062, 0.95),
  K(17.6, 0x3c64b0, 0xc0a0a8, 0xffc088, 0xd2a888, 0xa8a8cc, 0x504430, 0xffb470, 0.0009,  0.8),
  K(18.3, 0x3a3f86, 0xd0708a, 0xff8650, 0xb86e6a, 0x8c7ab0, 0x3a2a30, 0xff7a3a, 0.0011,  0.7),
  K(19.1, 0x1b2456, 0x6a4a8a, 0xdc7a6c, 0x6a4a6c, 0x5a5c9c, 0x20203a, 0xff6a40, 0.0011,  0.6),
  K(20,   0x0a1130, 0x26346a, 0x484a86, 0x2a3260, 0x38487f, 0x101426, 0x000000, 0.0010,  0.55),
  K(22,   0x050b20, 0x0b1535, 0x15244c, 0x101c3a, 0x2c4080, 0x0b1020, 0x000000, 0.0009,  0.55),
  K(24,   0x040a1c, 0x0a1430, 0x14234a, 0x0e1a36, 0x2b3f78, 0x0b1020, 0x000000, 0.00085, 0.55),
];
const tmpA = new THREE.Color();
export function samplePalette(hour) {
  let i = 0; while (i < KEYS.length - 2 && hour >= KEYS[i + 1].h) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = clamp((hour - a.h) / (b.h - a.h), 0, 1), s = t * t * (3 - 2 * t);
  const mix = (n) => a[n].clone().lerp(b[n], s);
  return { top: mix('top'), mid: mix('mid'), hor: mix('hor'), fog: mix('fog'), hemiS: mix('hemiS'), hemiG: mix('hemiG'), sun: mix('sun'), fogD: lerp(a.fogD, b.fogD, s), hemiI: lerp(a.hemiI, b.hemiI, s) };
}
export function sunDirection(hour, out = new THREE.Vector3()) {
  const a = ((hour - 6.2) / 12.2) * Math.PI;           // sunrise ~6:12 -> sunset ~18:24
  return out.set(Math.cos(a), 0.85 * Math.sin(a), 0.38 * Math.sin(a)).normalize();
}
export function moonDirection(hour, out = new THREE.Vector3()) {
  const a = ((hour - 18.4) / 12.0) * Math.PI;
  return out.set(Math.cos(a), 0.8 * Math.sin(a) + 0.05, 0.3 * Math.sin(a)).normalize();
}

// ------------------------------------------------------------------ sky dome
export function createSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
      uSun: { value: new THREE.Vector3(0, 1, 0) }, uMoon: { value: new THREE.Vector3(0, -1, 0) }, uSunCol: { value: new THREE.Color() },
      uSunI: { value: 0 }, uGlow: { value: 1 }, uMoonI: { value: 0 }, uStars: { value: 0 }, uTime: { value: 0 },
      uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }`,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uTop,uMid,uHor,uSun,uMoon,uSunCol,uCloudLit,uCloudShade; uniform float uSunI,uGlow,uMoonI,uStars,uTime;
      float h3(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float h2(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h2(i),h2(i+vec2(1,0)),f.x), mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*n2(p); p*=2.03; a*=.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y,0.,1.);
        vec3 col = mix(uHor, uMid, smoothstep(0.0,0.28,h));
        col = mix(col, uTop, smoothstep(0.18,0.85,h));
        if (d.y < 0.) col = mix(uHor, uHor*0.55, clamp(-d.y*5.,0.,1.));
        float sd = max(dot(d,uSun),0.);
        col += uSunCol * (pow(sd,6.)*0.28*uGlow + pow(sd,48.)*0.55*uGlow + smoothstep(0.99935,0.9997,sd)*3.0*uSunI);
        float md = max(dot(d,uMoon),0.);
        col += vec3(.88,.93,1.) * smoothstep(0.99955,0.9998,md) * uMoonI * 1.4 + vec3(.35,.45,.8) * pow(md,60.) * 0.22 * uMoonI;
        if (uStars > 0.001 && d.y > -0.05) {
          vec3 sp = d*260.; vec3 id = floor(sp); vec3 fr = fract(sp)-.5; float r = h3(id);
          float star = step(.983,r) * smoothstep(.34,.0,length(fr));
          float tw = .65 + .35*sin(uTime*2.3 + r*60.);
          col += vec3(.92,.96,1.) * star * tw * uStars * smoothstep(0.,.12,d.y) * 1.6;
          float band = exp(-pow(dot(d, normalize(vec3(.35,.75,.55)))*3.2, 2.));
          col += vec3(.10,.12,.22) * band * (0.4+fbm(d.xz*9.)) * uStars * smoothstep(0.,.2,d.y);
        }
        if (d.y > 0.) {
          vec2 uv = d.xz/(d.y+0.18)*0.75 + vec2(uTime*0.006, uTime*0.002);
          float c = fbm(uv*1.4);
          float cov = smoothstep(.50,.60,c);
          float lit = floor(fbm(uv*1.4+vec2(1.7,.3)+vec2(-d.x,d.z)*.2)*4.)/3.;
          vec3 cc = mix(uCloudShade, uCloudLit, clamp(lit*.8+.25,0.,1.));
          cc += uSunCol * pow(sd,3.)*0.25;
          col = mix(col, cc, cov * smoothstep(0.,.16,d.y) * .92);
        }
        gl_FragColor = vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(6000, 48, 24), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  return mesh;
}

// ------------------------------------------------------------------ water
export function createWater(depthTex) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uTime: { value: 0 }, uSun: { value: new THREE.Vector3() }, uMoon: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() },
      uSunI: { value: 1 }, uMoonI: { value: 0 }, uSkyTop: { value: new THREE.Color() }, uSkyHor: { value: new THREE.Color() },
      uDeep: { value: new THREE.Color(0x061d26) }, uShallow: { value: new THREE.Color(0x2a2410) }, uFog: { value: new THREE.Color() }, uFogD: { value: 0.0007 },
      uLight: { value: 1 }, uDepth: { value: depthTex }, uExt: { value: new THREE.Vector4(EXT.minX, EXT.minZ, EXT.W, EXT.D) },
      uLantern: { value: new THREE.Vector3() }, uLanternI: { value: 0 },
    },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      uniform float uTime,uSunI,uMoonI,uFogD,uLight,uLanternI; uniform vec3 uSun,uMoon,uSunCol,uSkyTop,uSkyHor,uDeep,uShallow,uFog,uLantern;
      uniform sampler2D uDepth; uniform vec4 uExt; varying vec3 vW;
      vec2 wv(vec2 p, vec2 dir, float k, float a, float sp){ return normalize(dir)*k*a*cos(dot(normalize(dir),p)*k + uTime*sp); }
      void main(){
        vec2 p = vW.xz;
        vec2 g = wv(p,vec2(1.,.3),.55,.018,1.1) + wv(p,vec2(-.4,1.),.8,.012,1.4) + wv(p,vec2(.7,-.8),1.3,.008,1.9) + wv(p,vec2(-1.,-.2),2.3,.005,2.6) + wv(p,vec2(.2,1.),3.7,.003,3.3);
        vec3 n = normalize(vec3(-g.x, 1., -g.y));
        vec3 V = normalize(cameraPosition - vW); float dist = length(cameraPosition - vW);
        float fr = 0.03 + 0.97*pow(1.-max(dot(n,V),0.), 5.);
        vec3 R = reflect(-V,n); float ry = clamp(R.y,0.,1.);
        vec3 refl = mix(uSkyHor, uSkyTop, pow(ry,.55));
        vec2 uv = (p - uExt.xy)/uExt.zw;
        float depth = texture2D(uDepth, uv).r*8.0;
        vec3 body = mix(uShallow, uDeep, 1.-exp(-depth*.55)) * uLight;
        vec3 col = mix(body, refl, clamp(fr*1.15,0.,1.));
        float sp = pow(max(dot(R,uSun),0.),400.)*3.2 + pow(max(dot(R,uSun),0.),40.)*.22;
        col += uSunCol * sp * uSunI;
        float mp = pow(max(dot(R,uMoon),0.),500.)*2.0 + pow(max(dot(R,uMoon),0.),60.)*.12;
        col += vec3(.7,.8,1.) * mp * uMoonI;
        float ld = length(p - uLantern.xz);
        col += vec3(1.,.62,.28) * uLanternI * (exp(-ld*ld/55.)*.5 + exp(-ld*ld/600.)*.12);
        float edge = smoothstep(.45,.0,depth);
        col = mix(col, vec3(.8,.78,.7)*uLight, edge*.18);
        float alpha = mix(.62, 1., smoothstep(.0,.9,depth)); alpha = max(alpha, fr);
        float f = 1.-exp(-pow(dist*uFogD,2.));
        col = mix(col, uFog, clamp(f,0.,1.));
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const g = new THREE.PlaneGeometry(EXT.W, EXT.D); g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat); m.position.set(EXT.minX + EXT.W / 2, 0, EXT.minZ + EXT.D / 2); m.renderOrder = 1; m.frustumCulled = false;
  return m;
}
