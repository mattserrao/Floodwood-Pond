import * as THREE from 'three';

// Single-pass post-processing for a moody, solemn look. Each effect has its own strength uniform (0 = off).
//   grade     – desaturate, cool lifted shadows, faded warm highlights (split-tone)
//   vignette  – heavy, soft edge darkening
//   grain     – animated film grain + gentle halation (red-orange glow around bright areas)
//   mist      – depth-based ground mist hugging the water, drifting in banks
//   paint     – Kuwahara painterly filter (soft brush-stroke stillness)
//   rays      – god rays streaming from the sun / moon through the treeline
//   blur      – camera motion blur (180-degree shutter) for the cinematic 30 fps mode
// The ground mist is ray-marched at half resolution in its own pass and upsampled with depth awareness.
export function createPost(renderer) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  rt.depthTexture = new THREE.DepthTexture(size.x, size.y); rt.depthTexture.type = THREE.UnsignedIntType;
  let mistScale = 0.5;
  const mistRT = new THREE.WebGLRenderTarget(Math.max(2, Math.round(size.x * mistScale)), Math.max(2, Math.round(size.y * mistScale)), { type: THREE.HalfFloatType, depthBuffer: false });
  const U = {
    tColor: { value: rt.texture }, tDepth: { value: rt.depthTexture }, uRes: { value: size.clone() }, uTime: { value: 0 },
    uNear: { value: 0.3 }, uFar: { value: 9000 }, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
    uGrade: { value: 1 }, uVignette: { value: 0.8 }, uGrain: { value: 0 }, uMist: { value: 1 }, uPaint: { value: 0 }, uRays: { value: 0 },
    tMist: { value: mistRT.texture }, uMistRes: { value: new THREE.Vector2(mistRT.width, mistRT.height) },
    uBlur: { value: 0 }, uPrevVP: { value: new THREE.Matrix4() }, uDim: { value: 0 },
    uFxaa: { value: 0 },
    uBehind: { value: 0 }, uAway: { value: new THREE.Vector2(0, 1) }, uPlayer: { value: new THREE.Vector3() },
    tShelter: { value: null }, uExt: { value: new THREE.Vector4(-1700, -1400, 3400, 2800) }, uBay: { value: 1 }, uLift: { value: 0 }, uHaze: { value: new THREE.Color(0.6, 0.66, 0.74) }, uHazeK: { value: 0.9 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 0.8, 0.6) }, uWake: { value: new THREE.Vector2(0, 1) }, uSpeed: { value: 0 },
    uMistCol: { value: new THREE.Color(0.6, 0.65, 0.7) }, uLightPos: { value: new THREE.Vector2(0.5, 0.5) }, uLightCol: { value: new THREE.Color(1, 0.8, 0.6) }, uLightVis: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tColor, tDepth, tMist; uniform vec2 uRes, uLightPos, uMistRes; uniform float uTime, uNear, uFar, uGrade, uVignette, uGrain, uMist, uPaint, uRays, uLightVis, uBlur, uDim;
      uniform mat4 uProjInv, uCamWorld, uPrevVP; uniform vec3 uCamPos, uMistCol, uLightCol, uHaze, uSunCol; uniform float uFxaa; varying vec2 vUv;
      // FXAA (Lottes 3.11 'console' style, compact): smooths geometric edges when MSAA is off (Low tier / phones)
      vec3 fxaa(vec2 uv){
        vec2 px = 1. / uRes; vec3 L = vec3(.299, .587, .114);
        vec3 rgbM = texture2D(tColor, uv).rgb;
        float lNW = dot(texture2D(tColor, uv + vec2(-1., -1.) * px).rgb, L), lNE = dot(texture2D(tColor, uv + vec2(1., -1.) * px).rgb, L);
        float lSW = dot(texture2D(tColor, uv + vec2(-1., 1.) * px).rgb, L), lSE = dot(texture2D(tColor, uv + vec2(1., 1.) * px).rgb, L), lM = dot(rgbM, L);
        float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
        if (lMax - lMin < max(.0312, lMax * .125)) return rgbM;                        // no edge: skip the expensive part
        vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
        float red = max((lNW + lNE + lSW + lSE) * .03125, 1. / 128.), rcp = 1. / (min(abs(dir.x), abs(dir.y)) + red);
        dir = clamp(dir * rcp, vec2(-8.), vec2(8.)) * px;
        vec3 A = .5 * (texture2D(tColor, uv + dir * (1. / 3. - .5)).rgb + texture2D(tColor, uv + dir * (2. / 3. - .5)).rgb);
        vec3 B = A * .5 + .25 * (texture2D(tColor, uv - dir * .5).rgb + texture2D(tColor, uv + dir * .5).rgb);
        float lB = dot(B, L); return (lB < lMin || lB > lMax) ? A : B;
      }
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h2(i),h2(i+vec2(1,0)),f.x), mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*n2(p); p*=2.03; a*=.5; } return s; }
      float luma(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }
      vec3 worldAt(vec2 uv, float d){ vec4 ndc = vec4(uv*2.-1., d*2.-1., 1.); vec4 v = uProjInv*ndc; v/=v.w; return (uCamWorld*v).xyz; }

      vec3 kuwahara(vec2 uv){
        vec2 px = 1./uRes; const int R = 3; vec3 m[4]; vec3 s[4];
        for(int k=0;k<4;k++){ m[k]=vec3(0.); s[k]=vec3(0.); }
        for(int j=-R;j<=0;j++) for(int i=-R;i<=0;i++){
          vec3 c0=texture2D(tColor, uv+vec2(i,j)*px).rgb, c1=texture2D(tColor, uv+vec2(-i,j)*px).rgb, c2=texture2D(tColor, uv+vec2(i,-j)*px).rgb, c3=texture2D(tColor, uv+vec2(-i,-j)*px).rgb;
          m[0]+=c0; s[0]+=c0*c0; m[1]+=c1; s[1]+=c1*c1; m[2]+=c2; s[2]+=c2*c2; m[3]+=c3; s[3]+=c3*c3;
        }
        float n = float((R+1)*(R+1)); float best=1e9; vec3 outc=vec3(0.);
        for(int k=0;k<4;k++){ vec3 mu=m[k]/n; vec3 v=abs(s[k]/n-mu*mu); float sig=v.r+v.g+v.b; if(sig<best){ best=sig; outc=mu; } }
        return outc;
      }

      void main(){
        vec2 uv = vUv;
        float d = texture2D(tDepth, uv).r; bool sky = d > 0.99999;
        vec3 wp = sky ? uCamPos + normalize(worldAt(uv, 0.9999) - uCamPos) * 2500. : worldAt(uv, d);
        float dist = length(wp - uCamPos);
        vec3 col = uFxaa > .5 ? fxaa(uv) : texture2D(tColor, uv).rgb;
        // ---- motion blur: reproject with last frame's camera, smear along the screen velocity (canoe stays crisp)
        if (uBlur > 0.) {
          vec4 pc = uPrevVP * vec4(wp, 1.);
          vec2 vel = pc.w > .1 ? (uv - (pc.xy / pc.w * .5 + .5)) * uBlur : vec2(0.);
          float vl = length(vel); if (!(vl < 1.)) { vel = vec2(0.); vl = 0.; } if (vl > .035) vel *= .035 / vl;
          float keep = smoothstep(7., 22., dist);
          if (vl * keep > .0015) {
            vec3 acc = col; float wsum = 1.;
            for (int i = 1; i <= 6; i++) {
              vec2 su = uv + vel * keep * (float(i) / 6. - .5);
              float sd = texture2D(tDepth, su).r; vec3 sw = worldAt(su, sd);
              float w = sd > 0.99999 || length(sw - uCamPos) > 18. ? 1. : 0.; // never smear the canoe onto the background
              acc += texture2D(tColor, su).rgb * w; wsum += w;
            }
            col = acc / wsum;
          }
        }
        if (uPaint > 0.) col = mix(col, kuwahara(uv), uPaint);
        // ---- ground mist (computed at half resolution, depth-aware upsample)
        if (uMist > 0.) {
          vec2 hp = 1. / uMistRes; float fs = 0., ws = 0.;
          float hs = 0., ss = 0.;
          for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
            vec2 o = (vec2(float(i), float(j)) - .5) * hp;
            vec4 m = texture2D(tMist, uv + o);
            float w = 1. / (.02 + abs(m.g - dist / 2000.) * 60.);
            fs += m.r * w; hs += m.b * w; ss += m.a * w; ws += w;
          }
          // aerial haze first (far), then the mist layers on top; haze warms toward the sun
          vec3 hazeCol = mix(uHaze, uSunCol * .9 + uHaze * .3, ss / ws * .6);
          col = mix(col, hazeCol, clamp(hs / ws, 0., .9));
          col = mix(col, uMistCol, clamp(fs / ws, 0., .97));
        }
        // ---- god rays: radial blur of the bright sky toward the light
        if (uRays > 0. && uLightVis > 0.) {
          vec2 delta = (uv - uLightPos) / 48.; vec2 p = uv; float decay = 1., acc = 0.;
          for (int i = 0; i < 48; i++) {
            p -= delta; float dd = texture2D(tDepth, p).r; vec3 c = texture2D(tColor, p).rgb;
            acc += (dd > 0.99999 ? smoothstep(.35, 1.2, luma(c)) : 0.) * decay; decay *= .955;
          }
          col += uLightCol * acc / 48. * 3.2 * uRays * uLightVis;
        }
        // ---- halation + grain
        if (uGrain > 0.) {
          vec2 px = 3. / uRes; vec3 glow = vec3(0.);
          for (int i = 0; i < 8; i++) { float a = float(i) * .785398; glow += max(texture2D(tColor, uv + vec2(cos(a), sin(a)) * px * 2.5).rgb - .7, 0.); }
          col += glow / 8. * vec3(1., .45, .25) * .9 * uGrain;
        }
        // ---- solemn grade: desaturate, cool lifted blacks, faded warm highlights
        if (uGrade > 0.) {
          col *= 1. - .22 * uDim;
          float l = luma(col);
          vec3 g = mix(col, vec3(l), .38 + .22 * uDim);
          g = mix(g * vec3(.92, .98, 1.08), g, smoothstep(.0, .6, l));        // cool shadows
          g += vec3(.012, .018, .03);                                           // lifted, bluish blacks
          g = mix(g, g * vec3(1.05, 1.0, .9), smoothstep(.45, 1.2, l) * .6);   // faded warm highlights
          g = (g - .18) * .92 + .18;                                            // soften contrast
          col = mix(col, g, uGrade);
        }
        if (uVignette > 0.) {
          vec2 q = uv - .5; q.x *= uRes.x / uRes.y;
          float v = smoothstep(.95, .25, length(q));
          col *= mix(1., mix(.32, 1., v), uVignette);
        }
        if (uGrain > 0.) {
          float gr = h2(uv * uRes + fract(uTime * 37.) * 101.) - .5;
          col += gr * .045 * uGrain * (.4 + .6 * (1. - smoothstep(0., .8, luma(col))));
        }
        col = max(col, 0.); if (!(col.r + col.g + col.b < 1e6)) col = texture2D(tColor, uv).rgb; // never let a NaN punch a hole in the frame
        gl_FragColor = vec4(col, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mistMat = new THREE.ShaderMaterial({ uniforms: U, depthTest: false, depthWrite: false, vertexShader: mat.vertexShader,
    fragmentShader: `
      uniform sampler2D tColor, tDepth, tMist; uniform vec2 uRes, uLightPos, uMistRes; uniform float uTime, uNear, uFar, uGrade, uVignette, uGrain, uMist, uPaint, uRays, uLightVis, uBlur, uDim;
      uniform mat4 uProjInv, uCamWorld, uPrevVP; uniform vec3 uCamPos, uMistCol, uLightCol, uPlayer, uHaze, uSunDir, uSunCol; uniform vec2 uAway, uWake; uniform vec4 uExt; uniform sampler2D tShelter; uniform float uBehind, uBay, uLift, uHazeK, uSpeed; varying vec2 vUv;
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h2(i),h2(i+vec2(1,0)),f.x), mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*n2(p); p*=2.03; a*=.5; } return s; }
      float luma(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }
      vec3 worldAt(vec2 uv, float d){ vec4 ndc = vec4(uv*2.-1., d*2.-1., 1.); vec4 v = uProjInv*ndc; v/=v.w; return (uCamWorld*v).xyz; }

      vec3 kuwahara(vec2 uv){
        vec2 px = 1./uRes; const int R = 3; vec3 m[4]; vec3 s[4];
        for(int k=0;k<4;k++){ m[k]=vec3(0.); s[k]=vec3(0.); }
        for(int j=-R;j<=0;j++) for(int i=-R;i<=0;i++){
          vec3 c0=texture2D(tColor, uv+vec2(i,j)*px).rgb, c1=texture2D(tColor, uv+vec2(-i,j)*px).rgb, c2=texture2D(tColor, uv+vec2(i,-j)*px).rgb, c3=texture2D(tColor, uv+vec2(-i,-j)*px).rgb;
          m[0]+=c0; s[0]+=c0*c0; m[1]+=c1; s[1]+=c1*c1; m[2]+=c2; s[2]+=c2*c2; m[3]+=c3; s[3]+=c3*c3;
        }
        float n = float((R+1)*(R+1)); float best=1e9; vec3 outc=vec3(0.);
        for(int k=0;k<4;k++){ vec3 mu=m[k]/n; vec3 v=abs(s[k]/n-mu*mu); float sig=v.r+v.g+v.b; if(sig<best){ best=sig; outc=mu; } }
        return outc;
      }

      void main(){
        // ---- ground mist: thick at the water, thinning with height, drifting in banks
          float d = texture2D(tDepth, vUv).r; bool sky = d > 0.99999; vec2 uv = vUv;
          vec3 wp = sky ? uCamPos + normalize(worldAt(uv, 0.9999) - uCamPos) * 2500. : worldAt(uv, d);
          float dist = length(wp - uCamPos);
          vec3 dir = (wp - uCamPos) / max(dist, 1e-3);
          // integrate density along the ray: exp(-height/H), cheap analytic-ish with 6 samples
          float acc = 0., wisp = 0.;
          for (int i = 0; i < 6; i++) {
            float t = (float(i) + .5) / 6.; vec3 p = uCamPos + dir * dist * t;
            float banks = .55 + .9 * fbm(p.xz * .006 + vec2(uTime * .012, uTime * .007));
            // v0.6 middle layer: fog pools where the water is sheltered (bays, lee of islands) and lifts off with the sun
            float sh = texture2D(tShelter, (p.xz - uExt.xy) / uExt.zw).r;
            float pool = mix(1., .3 + 2.6 * sh, uBay) * (1. - uLift * (1. - sh * .85));
            acc += exp(-max(p.y, 0.) / 11.) * banks * pool;
            // near layer: low wisps skimming the water, parted by the canoe's wake
            vec2 rel = p.xz - uPlayer.xz; float along = dot(rel, uWake), side = abs(dot(rel, vec2(-uWake.y, uWake.x)));
            float wake = 1. - smoothstep(1.2, 4.5 + uSpeed * 2.5, side) * step(0., -along) * smoothstep(-40., -2., along) * .9;
            float w = fbm(p.xz * .09 + vec2(uTime * .06, uTime * .035)); w = smoothstep(.52, .78, w);
            wisp += w * exp(-max(p.y, 0.) / 1.4) * smoothstep(60., 10., length(rel)) * wake;
          }
          float density = acc / 6. * min(dist, 1600.) * .0042;
          float f = (1. - exp(-density * uMist)) * smoothstep(8., 70., dist); // keep the canoe crisp
          f = max(f, wisp / 6. * uMist * .9 * smoothstep(3., 12., dist));
          // far layer: aerial perspective - everything fades toward the sky at the horizon with distance and low height
          float haze = 1. - exp(-dist * uHazeK * 5.5e-4); haze *= mix(1., .3, smoothstep(0., 400., wp.y));
          float sunward = pow(max(dot(dir, uSunDir), 0.), 8.);
          // v0.5: the mist that follows you - a swirling wall over everything behind the canoe
          if (uBehind > 0.) {
            vec2 v = wp.xz - uPlayer.xz; float lv = length(v);
            vec2 vd = sky ? normalize(dir.xz + vec2(1e-4)) : v / max(lv, 1e-3);
            float behind = smoothstep(-0.15, 0.7, dot(vd, uAway));
            float nearK = sky ? 1. : smoothstep(12., 75., lv);
            vec2 sp = (sky ? uPlayer.xz + vd * 260. : wp.xz) * .018;
            vec2 q = vec2(fbm(sp + vec2(uTime * .05, -uTime * .03)), fbm(sp + vec2(-uTime * .04, uTime * .06) + 3.7));
            float sw = fbm(sp * 1.4 + q * 2.4 + vec2(uTime * .045));
            float hgt = sky ? smoothstep(.55, .0, dir.y) : exp(-max(wp.y, 0.) / 45.);
            f = max(f, clamp(behind * nearK * hgt * (.4 + .8 * sw) * uBehind * 1.15, 0., .97));
          }
          gl_FragColor = vec4(f, dist / 2000., haze * (sky ? 0. : 1.), sunward);
      }` });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  const pScene = new THREE.Scene(); pScene.add(quad);
  const pCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const v3 = new THREE.Vector3();
  const api = {
    uniforms: U,
    enabled: true,
    get active() { if (!api.enabled) return false;
      return U.uGrade.value + U.uVignette.value + U.uGrain.value + U.uMist.value + U.uPaint.value + U.uRays.value > 0; },
    setSize() {
      const s = renderer.getDrawingBufferSize(new THREE.Vector2()); rt.setSize(s.x, s.y); U.uRes.value.copy(s);
      mistRT.setSize(Math.max(2, Math.round(s.x * mistScale)), Math.max(2, Math.round(s.y * mistScale))); U.uMistRes.value.set(mistRT.width, mistRT.height);
    },
    /** apply a quality tier: MSAA samples and mist resolution */
    setQuality(q) {
      if (rt.samples !== q.msaa) { rt.samples = q.msaa; rt.dispose(); }
      U.uFxaa.value = q.msaa > 0 ? 0 : 1;   // FXAA only when MSAA is off
      mistScale = q.mistScale; api.setSize(); api.blurAllowed = q.blur;
    },
    blurAllowed: true, motionBlur: false, prevVP: new THREE.Matrix4(), hasPrev: false,
    /** lightDir: world direction to the sun or moon; lightCol: its colour; mistCol: current fog/mist tint */
    render(scene, camera, t, lightDir, lightCol, mistCol) {
      U.uTime.value = t; U.uNear.value = camera.near; U.uFar.value = camera.far;
      U.uProjInv.value.copy(camera.projectionMatrixInverse); U.uCamWorld.value.copy(camera.matrixWorld); U.uCamPos.value.copy(camera.position);
      if (mistCol) U.uMistCol.value.copy(mistCol);
      if (lightDir) {
        v3.copy(camera.position).addScaledVector(lightDir, 1000).project(camera);
        const facing = lightDir.dot(camera.getWorldDirection(new THREE.Vector3()));
        U.uLightPos.value.set(v3.x * 0.5 + 0.5, v3.y * 0.5 + 0.5);
        U.uLightVis.value = facing > 0 ? (1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(v3.x), Math.abs(v3.y)), 0.9, 1.6)) * THREE.MathUtils.smoothstep(lightDir.y, -0.04, 0.05) : 0;
        if (lightCol) U.uLightCol.value.copy(lightCol);
      }
      renderer.setRenderTarget(rt); renderer.render(scene, camera);
      if (U.uMist.value > 0) { quad.material = mistMat; renderer.setRenderTarget(mistRT); renderer.render(pScene, pCam); quad.material = mat; }
      U.uBlur.value = api.motionBlur && api.blurAllowed && api.hasPrev ? 0.5 : 0; U.uPrevVP.value.copy(api.prevVP);
      renderer.setRenderTarget(null); renderer.render(pScene, pCam);
      api.prevVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); api.hasPrev = true;
    },
  };
  return api;
}
