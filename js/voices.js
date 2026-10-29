// Ghostly voices for the memory scenes. Procedural formant "voices" (laughs, shouts, whoops) spatialised through
// the game's 3D audio, plus optional recorded clips: drop files into audio/memories/<name>.mp3 (e.g. beef.mp3,
// laugh1.mp3) and they are used in place of the synthesis. Spoken lines fall back to the browser's speech voice.
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// formant tables [frequency, bandwidth, gain]
const V = {
  a: [[780, 90, 1], [1180, 100, 0.55], [2850, 140, 0.22]],
  e: [[430, 70, 1], [1950, 110, 0.42], [2600, 140, 0.25]],
  i: [[300, 55, 1], [2250, 100, 0.36], [2950, 140, 0.28]],
  o: [[480, 70, 1], [820, 80, 0.62], [2800, 120, 0.14]],
  u: [[340, 55, 1], [720, 70, 0.32], [2500, 170, 0.1]],
};

export class Voices {
  constructor(audio) { this.audio = audio; this.clips = {}; this.loading = {}; }
  get ctx() { return this.audio.ctx; }
  ok() { return this.ctx && !this.audio.muted && !this.audio.paused; }

  /** a sound source at a world position, extra-wet so it sounds like a memory across the water */
  out(pos, vol = 1) {
    const g = this.audio.at(pos, { wet: 0.95, ref: 22, roll: 0.75, air: 320, echo: 0.35 });
    const v = this.ctx.createGain(); v.gain.value = vol; v.connect(g); return v;
  }

  /** one voiced syllable: sawtooth glottal source + aspiration through a formant bank */
  syl(dest, t, f0, vowel, dur, vol, o = {}) {
    const ctx = this.ctx, F = V[vowel] || V.a, glide = o.glide || 0, h = o.h ?? 0.5;
    const src = ctx.createOscillator(); src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0, t); src.frequency.linearRampToValueAtTime(f0 * (1 + glide), t + dur * 0.7); src.frequency.linearRampToValueAtTime(f0 * (1 + glide * 0.6), t + dur);
    const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = rand(5, 7); vg.gain.value = f0 * 0.025; vib.connect(vg); vg.connect(src.frequency);
    const env = ctx.createGain(); env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(vol, t + Math.min(0.03, dur * 0.2)); env.gain.setValueAtTime(vol * 0.85, t + dur * 0.7); env.gain.linearRampToValueAtTime(0, t + dur);
    const nz = ctx.createBufferSource(); nz.buffer = this.audio.white; const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(vol * h, t + 0.01); ng.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(0.12, dur));
    const mix = ctx.createGain(); mix.gain.value = 1;
    F.forEach(([f, bw, a]) => {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * (o.formant || 1); bp.Q.value = f / bw;
      const g = ctx.createGain(); g.gain.value = a * 3.2; src.connect(bp); bp.connect(g); g.connect(mix);
    });
    mix.connect(env); env.connect(dest);
    // breathy aspiration ("h") on its own short envelope
    const nbp = ctx.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = (F[1][0] + F[0][0]) * 0.8; nbp.Q.value = 0.8; nz.connect(nbp); nbp.connect(ng); ng.connect(dest);
    src.start(t); src.stop(t + dur + 0.05); vib.start(t); vib.stop(t + dur + 0.05); nz.start(t, Math.random() * 2, dur + 0.05);
  }

  /** "ha-ha-ha" - pitch falls through the burst */
  laugh(pos, o = {}) {
    if (!this.ok()) return; if (this.tryClip(pick(['laugh1', 'laugh2', 'laugh3']), pos, o.vol)) return;
    const t0 = this.ctx.currentTime + (o.delay || 0), d = this.out(pos, o.vol ?? 1);
    const n = o.n || Math.floor(rand(5, 10)); let f = o.f0 || rand(150, 230), t = t0; const vow = pick(['a', 'a', 'e', 'o']);
    for (let i = 0; i < n; i++) { const len = rand(0.09, 0.14); this.syl(d, t, f, vow, len, 0.22 * (1 - i / (n + 3)), { h: 0.9, glide: -0.05 }); t += len + rand(0.05, 0.09); f *= rand(0.95, 0.99); }
    if (Math.random() < 0.5) this.syl(d, t + 0.05, f * 1.3, 'a', 0.35, 0.12, { h: 1.2, glide: -0.25 }); // trailing wheeze
  }

  /** excited shouts: "hey!", "woo!", "go go go!", "yeahhh", "dude!", "ohhh!" */
  shout(pos, word, o = {}) {
    if (!this.ok()) return; if (this.tryClip('shout_' + (word || 'any'), pos, o.vol)) return;
    const t = this.ctx.currentTime + (o.delay || 0), d = this.out(pos, o.vol ?? 1), f = o.f0 || rand(170, 260);
    const W = {
      hey: [['e', 0.32, 0.3]], woo: [['u', 0.6, 0.45]], go: [['o', 0.14, 0.05], ['o', 0.14, 0.05], ['o', 0.24, 0.12]],
      yeah: [['i', 0.12, 0.1], ['e', 0.16, 0.05], ['a', 0.38, -0.25]], dude: [['u', 0.42, -0.15]], oh: [['o', 0.55, -0.35]],
      no: [['o', 0.45, 0.2]], wait: [['e', 0.3, 0.1], ['i', 0.12, 0]], come: [['a', 0.26, 0.05]],
    };
    const seq = W[word] || W[pick(Object.keys(W))]; let tt = t;
    seq.forEach(([v, len, glide]) => { this.syl(d, tt, f * rand(0.97, 1.05), v, len, 0.26, { h: 0.6, glide }); tt += len + 0.06; });
  }

  /** a crowd of young men: overlapping shouts and laughter for `sec` seconds around a moving source */
  rowdy(posFn, sec, density = 1, vol = 1) {
    if (!this.ok()) return;
    const n = Math.round(sec * 1.4 * density);
    for (let i = 0; i < n; i++) {
      const delay = rand(0, sec);
      setTimeout(() => { const p = posFn(); if (!p) return; if (Math.random() < 0.45) this.laugh(p, { vol: vol * rand(0.6, 1) }); else this.shout(p, pick(['hey', 'woo', 'go', 'yeah', 'dude', 'oh', 'no', 'come', 'wait']), { vol: vol * rand(0.7, 1.1) }); }, delay * 1000);
    }
  }

  /** spoken line: recorded clip if present, else the browser's speech voice (not spatialised) */
  say(name, text, pos, o = {}) {
    if (!this.ok()) return;
    if (this.tryClip(name, pos, o.vol)) return;
    if (!window.speechSynthesis) { this.shout(pos, 'hey'); return; }
    const u = new SpeechSynthesisUtterance(text);
    const vs = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
    const male = vs.find((v) => /male|daniel|alex|fred|david|guy|tom|aaron|arthur|rishi/i.test(v.name) && !/female/i.test(v.name));
    if (male || vs[0]) u.voice = male || vs[0];
    u.rate = o.rate ?? 1.25; u.pitch = o.pitch ?? 0.85; u.volume = o.volume ?? 0.75;
    speechSynthesis.speak(u);
  }

  /** play audio/memories/<name>.mp3 if it exists (fetched once, then cached) */
  tryClip(name, pos, vol = 1) {
    const c = this.clips[name];
    if (c) { const s = this.ctx.createBufferSource(); s.buffer = c; s.playbackRate.value = rand(0.95, 1.05); s.connect(this.out(pos, vol)); s.start(); return true; }
    if (c === undefined && !this.loading[name]) {
      this.loading[name] = true; this.clips[name] = null;
      fetch(`audio/memories/${name}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject())).then((b) => this.ctx.decodeAudioData(b)).then((buf) => { this.clips[name] = buf; }).catch(() => {});
    }
    return false;
  }

  // ---------- intro foley ----------
  unzip() {
    if (!this.ok()) return; const ctx = this.ctx, t0 = ctx.currentTime + 0.3, out = ctx.createGain(); out.gain.value = 0.55; out.connect(this.audio.natureBus);
    let t = t0; for (let i = 0; i < 46; i++) {
      const s = ctx.createBufferSource(); s.buffer = this.audio.white; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rand(2600, 4800); bp.Q.value = 3;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(rand(0.25, 0.5), t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
      s.connect(bp); bp.connect(g); g.connect(out); s.start(t, Math.random() * 2, 0.03); t += i < 10 ? 0.045 - i * 0.002 : 0.022 + Math.random() * 0.006;
    }
    // nylon rustle under it
    const r = ctx.createBufferSource(); r.buffer = this.audio.pink; const lp = ctx.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 1400; lp.Q.value = 0.6;
    const rg = ctx.createGain(); rg.gain.setValueAtTime(0, t0); rg.gain.linearRampToValueAtTime(0.18, t0 + 0.3); rg.gain.linearRampToValueAtTime(0.08, t); rg.gain.linearRampToValueAtTime(0.25, t + 0.4); rg.gain.linearRampToValueAtTime(0, t + 1.4);
    r.connect(lp); lp.connect(rg); rg.connect(out); r.start(t0, 0, 3);
  }
  step(pan = 0, k = 1) {
    if (!this.ok()) return; const ctx = this.ctx, t = ctx.currentTime;
    const p = this.audio.panner(pan); p.connect(this.audio.natureBus);
    [[700, 0.5, 0.16], [2600, 1.2, 0.07]].forEach(([f, q, v]) => {
      const s = ctx.createBufferSource(); s.buffer = this.audio.white; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * rand(0.8, 1.2); bp.Q.value = q;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * k, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + rand(0.12, 0.2));
      s.connect(bp); bp.connect(g); g.connect(p); s.start(t, Math.random() * 2, 0.25);
    });
  }
}
