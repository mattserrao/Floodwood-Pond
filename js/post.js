import * as THREE from 'three';

// Single-pass post-processing for a moody, solemn look. Each effect has its own strength uniform (0 = off).
//   grade     – desaturate, cool lifted shadows, faded warm highlights (split-tone)
//   vignette  – heavy, soft edge darkening
//   grain     – animated film grain + gentle halation (red-orange glow around bright areas)
//   mist      – depth-based ground mist hugging the water, drifting in banks
//   paint     – Kuwahara painterly filter (soft brush-stroke stillness)
//   rays      – god rays streaming from the sun / moon through the treeline
export function createPost(renderer) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  rt.depthTexture = new THREE.DepthTexture(size.x, size.y); rt.depthTexture.type = THREE.UnsignedIntType;
  const U = {
    tColor: { value: rt.texture }, tDepth: { value: rt.depthTexture }, uRes: { value: size.clone() }, uTime: { value: 0 },
    uNear: { value: 0.3 }, uFar: { value: 9000 }, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
    uGrade: { value: 1 }, uVignette: { value: 0.8 }, uGrain: { value: 0 }, uMist: { value: 1 }, uPaint: { value: 0 }, uRays: { value: 0 },
    uMistCol: { value: new THREE.Color(0.6, 0.65, 0.7) }, uLightPos: { value: new THREE.Vector2(0.5, 0.5) }, uLightCol: { value: new THREE.Color(1, 0.8, 0.6) }, uLightVis: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tColor, tDepth; uniform vec2 uRes, uLightPos; uniform float uTime, uNear, uFar, uGrade, uVignette, uGrain, uMist, uPaint, uRays, uLightVis;
      uniform mat4 uProjInv, uCamWorld; uniform vec3 uCamPos, uMistCol, uLightCol; varying vec2 vUv;
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
        vec3 col = texture2D(tColor, uv).rgb;
        if (uPaint > 0.) col = mix(col, kuwahara(uv), uPaint);

        float d = texture2D(tDepth, uv).r; bool sky = d > 0.99999;
        // ---- ground mist: thick at the water, thinning with height, drifting in banks
        if (uMist > 0.) {
          vec3 wp = sky ? uCamPos + normalize(worldAt(uv, 0.9999) - uCamPos) * 2500. : worldAt(uv, d);
          float dist = length(wp - uCamPos);
          vec3 dir = (wp - uCamPos) / max(dist, 1e-3);
          // integrate density along the ray: exp(-height/H), cheap analytic-ish with 6 samples
          float acc = 0.;
          for (int i = 0; i < 6; i++) {
            float t = (float(i) + .5) / 6.; vec3 p = uCamPos + dir * dist * t;
            float banks = .55 + .9 * fbm(p.xz * .006 + vec2(uTime * .012, uTime * .007));
            acc += exp(-max(p.y, 0.) / 11.) * banks;
          }
          float density = acc / 6. * min(dist, 1600.) * .0042;
          float f = (1. - exp(-density * uMist)) * smoothstep(8., 70., dist); // keep the canoe crisp
          col = mix(col, uMistCol, clamp(f, 0., .92));
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
          float l = luma(col);
          vec3 g = mix(col, vec3(l), .38);
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
        gl_FragColor = vec4(max(col, 0.), 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  const pScene = new THREE.Scene(); pScene.add(quad);
  const pCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const v3 = new THREE.Vector3();
  const api = {
    uniforms: U,
    enabled: true,
    get active() { if (!api.enabled) return false;
      return U.uGrade.value + U.uVignette.value + U.uGrain.value + U.uMist.value + U.uPaint.value + U.uRays.value > 0; },
    setSize() { const s = renderer.getDrawingBufferSize(new THREE.Vector2()); rt.setSize(s.x, s.y); U.uRes.value.copy(s); },
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
      renderer.setRenderTarget(null); renderer.render(pScene, pCam);
    },
  };
  return api;
}
