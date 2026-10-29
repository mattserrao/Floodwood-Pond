// Procedural ambience for Floodwood Pond: generative calm music + nature sounds, all synthesized with Web Audio.
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const CHORDS = [
  [50, 57, 64, 66],       // Dsus2/F#
  [47, 54, 57, 62, 66],   // Bm7
  [43, 50, 54, 59, 66],   // Gmaj7
  [45, 52, 57, 59, 64],   // A6sus
];
const PENTA = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86]; // D major pentatonic

export class AmbientAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.s = { night: 0, day: 1, dawn: 0, dusk: 0, speed: 0 };
    this.t = { note: 0, chord: 0, bird: 0, owl: 0, loon: 0 };
    this.chordIdx = 0;
    this.melIdx = 4;
  }

  // iOS: must run synchronously inside a user tap. Web Audio on iPhone is muted by the ring/silent switch
  // unless the page's audio session is "playback", so we request that and keep a silent <audio> element playing.
  unlockIOS() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    if (!this.silentEl) {
      const rate = 8000, n = rate / 2, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
      const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      const el = (this.silentEl = document.createElement('audio'));
      el.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
      el.loop = true; el.setAttribute('playsinline', ''); el.setAttribute('x-webkit-airplay', 'deny'); el.preload = 'auto';
    }
    const p = this.silentEl.play(); if (p && p.catch) p.catch(() => {});
    if (this.ctx && !this.paused) {
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination); s.start(0);
    }
  }

  start() {
    if (this.ctx) { this.unlockIOS(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.unlockIOS();
    // iOS suspends/interrupts the context (lock screen, calls, app switch): resume on the next touch or when visible again
    const resume = () => { if (this.ctx && this.ctx.state !== 'running' && !this.muted && !this.paused) this.unlockIOS(); };
    ['touchend', 'pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, resume, { passive: true }));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });
    const now = ctx.currentTime;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.master.gain.setTargetAtTime(0.9, now, 2.0);

    // Lake-sized reverb from generated impulse response
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeIR(3.6, 2.2);
    const rWet = ctx.createGain(); rWet.gain.value = 0.85;
    this.reverb.connect(rWet); rWet.connect(this.master);
    this.send = ctx.createGain(); this.send.gain.value = 1; this.send.connect(this.reverb);

    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.5;
    this.musicBus.connect(this.master);
    const mSend = ctx.createGain(); mSend.gain.value = 0.75;
    this.musicBus.connect(mSend); mSend.connect(this.send);

    this.natureBus = ctx.createGain(); this.natureBus.gain.value = 1;
    this.natureBus.connect(this.master);

    // v0.4: echoes off the surrounding hills (St. Regis and friends): a few long, darkened, panned delays
    this.echo = ctx.createGain(); this.echo.gain.value = 1;
    const eLP = ctx.createBiquadFilter(); eLP.type = 'lowpass'; eLP.frequency.value = 1500; this.echo.connect(eLP);
    [[0.62, 0.32, -0.7], [1.05, 0.22, 0.6], [1.55, 0.15, -0.2], [2.1, 0.09, 0.85]].forEach(([d, g, pan]) => {
      const dl = ctx.createDelay(3); dl.delayTime.value = d; const gg = ctx.createGain(); gg.gain.value = g; const p = this.panner(pan);
      eLP.connect(dl); dl.connect(gg); gg.connect(p); p.connect(this.master); p.connect(this.send);
    });

    this.white = this.noiseBuffer('white', 3);
    this.pink = this.noiseBuffer('pink', 6);

    this.buildBeds();
    this.timer = setInterval(() => this.tick(), 180);
    this.t.chord = now; this.t.note = now + 2; this.t.bird = now + 4; this.t.owl = now + 25; this.t.loon = now + 18;
  }

  setPaused(p) {
    this.paused = p;
    if (!this.ctx) return;
    if (p) this.ctx.suspend().catch(() => {}); else this.unlockIOS();
  }

  setMuted(m) {
    this.muted = m;
    if (!this.ctx) return;
    if (!m) this.unlockIOS();
    this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.25);
  }

  // ---------- building blocks ----------
  makeIR(sec, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < 200 ? i / 200 : 1);
    }
    return buf;
  }
  noiseBuffer(kind, sec) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    if (kind === 'white') for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    else {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
    }
    return buf;
  }
  loopSrc(buf) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; }
  osc(type, freq) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq; return o; }
  /** v0.4: a sound source at a world position {x, y, z}: 3D panning, distance roll-off and air absorption */
  at(pos, opts = {}) {
    const ctx = this.ctx, out = ctx.createGain();
    if (!pos || !this.listenerPos) { const p = this.panner(opts.pan || 0); out.connect(p); p.connect(this.natureBus); if (opts.wet !== 0) { const w = ctx.createGain(); w.gain.value = opts.wet ?? 0.6; p.connect(w); w.connect(this.send); } return out; }
    const L = this.listenerPos, d = Math.hypot(pos.x - L.x, (pos.y || 0) - L.y, pos.z - L.z);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(500, 16000 * Math.exp(-d / (opts.air || 260)));
    let p;
    if (ctx.createPanner) {
      p = ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = opts.ref || 18; p.rolloffFactor = opts.roll ?? 0.9; p.maxDistance = 5000;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y || 0; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y || 0, pos.z);
    } else p = this.panner(0);
    out.connect(lp); lp.connect(p); p.connect(this.natureBus);
    const w = ctx.createGain(); w.gain.value = (opts.wet ?? 0.6) * (0.5 + Math.min(1, d / 150)); p.connect(w); w.connect(this.send);
    if (opts.echo) { const e = ctx.createGain(); e.gain.value = opts.echo * Math.min(1.4, 0.4 + d / 200); out.connect(e); e.connect(this.echo); }
    return out;
  }
  /** call each frame with the camera */
  setListener(pos, fwd, up) {
    if (!this.ctx) return; const l = this.ctx.listener, t = this.ctx.currentTime;
    this.listenerPos = { x: pos.x, y: pos.y, z: pos.z };
    if (l.positionX) { l.positionX.setTargetAtTime(pos.x, t, 0.05); l.positionY.setTargetAtTime(pos.y, t, 0.05); l.positionZ.setTargetAtTime(pos.z, t, 0.05);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.05); l.forwardY.setTargetAtTime(fwd.y, t, 0.05); l.forwardZ.setTargetAtTime(fwd.z, t, 0.05); l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z; }
    else if (l.setPosition) { l.setPosition(pos.x, pos.y, pos.z); l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
  }
  /** a random point in the woods around the listener (for birds / owls with no visible source) */
  woods(r0 = 60, r1 = 220, y = 10) { const L = this.listenerPos || { x: 0, y: 0, z: 0 }, a = Math.random() * Math.PI * 2, r = rand(r0, r1); return { x: L.x + Math.cos(a) * r, y, z: L.z + Math.sin(a) * r }; }
  panner(p) {
    if (this.ctx.createStereoPanner) { const n = this.ctx.createStereoPanner(); n.pan.value = p; return n; }
    return this.ctx.createGain();
  }

  buildBeds() {
    const ctx = this.ctx;
    // wind in the pines
    this.windG = ctx.createGain(); this.windG.gain.value = 0.05;
    const wbp = ctx.createBiquadFilter(); wbp.type = 'bandpass'; wbp.frequency.value = 480; wbp.Q.value = 0.45;
    this.loopSrc(this.pink).connect(wbp); wbp.connect(this.windG); this.windG.connect(this.natureBus);
    const wl = this.osc('sine', 0.06), wlg = ctx.createGain(); wlg.gain.value = 0.035; wl.connect(wlg); wlg.connect(this.windG.gain); wl.start();
    const wl2 = this.osc('sine', 0.11), wl2g = ctx.createGain(); wl2g.gain.value = 120; wl2.connect(wl2g); wl2g.connect(wbp.frequency); wl2.start();

    // water lapping on the shore
    this.lapG = ctx.createGain(); this.lapG.gain.value = 0.05;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 850;
    const lsrc = this.loopSrc(this.pink); lsrc.playbackRate.value = 0.8;
    lsrc.connect(lp); lp.connect(this.lapG); this.lapG.connect(this.natureBus);
    [0.17, 0.11].forEach((f) => { const o = this.osc('sine', f), g = ctx.createGain(); g.gain.value = 0.025; o.connect(g); g.connect(this.lapG.gain); o.start(); });

    // wake hiss (scales with canoe speed)
    this.wakeG = ctx.createGain(); this.wakeG.gain.value = 0;
    const wb = ctx.createBiquadFilter(); wb.type = 'bandpass'; wb.frequency.value = 1100; wb.Q.value = 0.7;
    this.loopSrc(this.white).connect(wb); wb.connect(this.wakeG); this.wakeG.connect(this.natureBus);

    // v0.4: rain hiss on the pond (bright) + softer patter on the hull (dark)
    this.rainG = ctx.createGain(); this.rainG.gain.value = 0; this.rainG.connect(this.natureBus);
    const rh = ctx.createBiquadFilter(); rh.type = 'highpass'; rh.frequency.value = 2400; this.loopSrc(this.white).connect(rh); rh.connect(this.rainG);
    const rl = ctx.createBiquadFilter(); rl.type = 'bandpass'; rl.frequency.value = 700; rl.Q.value = 0.6; const rlg = ctx.createGain(); rlg.gain.value = 0.6;
    const rs = this.loopSrc(this.pink); rs.playbackRate.value = 1.3; rs.connect(rl); rl.connect(rlg); rlg.connect(this.rainG);
    // gusts through the pines: a separate swell driven by the gust at the canoe
    this.gustG = ctx.createGain(); this.gustG.gain.value = 0;
    this.gustBP = ctx.createBiquadFilter(); this.gustBP.type = 'bandpass'; this.gustBP.frequency.value = 650; this.gustBP.Q.value = 0.35;
    const gs = this.loopSrc(this.pink); gs.playbackRate.value = 0.9; gs.connect(this.gustBP); this.gustBP.connect(this.gustG); this.gustG.connect(this.natureBus);
    const gsw = ctx.createGain(); gsw.gain.value = 0.3; this.gustG.connect(gsw); gsw.connect(this.send);
    // the stroke: a low swirl of water past the blade while it pulls
    this.pullG = ctx.createGain(); this.pullG.gain.value = 0;
    const pf = ctx.createBiquadFilter(); pf.type = 'bandpass'; pf.frequency.value = 380; pf.Q.value = 1.4; this.pullF = pf;
    const ps = this.loopSrc(this.pink); ps.playbackRate.value = 0.7; ps.connect(pf); pf.connect(this.pullG); this.pullG.connect(this.natureBus);

    // crickets / night insects: carrier amplitude-modulated by fast pulse and slower chirp groups
    this.cricketG = ctx.createGain(); this.cricketG.gain.value = 0; this.cricketG.connect(this.natureBus);
    [[4300, 15, 2.6, -0.6], [4850, 17, 2.1, 0.5], [3900, 13, 3.1, 0.1]].forEach(([f, pulse, grp, pan]) => {
      const c = this.osc('sine', f), a = ctx.createGain(), b = ctx.createGain(), p = this.panner(pan);
      a.gain.value = 0.5; b.gain.value = 0.5;
      const l1 = this.osc('sine', pulse), l1g = ctx.createGain(); l1g.gain.value = 0.5; l1.connect(l1g); l1g.connect(a.gain);
      const l2 = this.osc('sine', grp), l2g = ctx.createGain(); l2g.gain.value = 0.5; l2.connect(l2g); l2g.connect(b.gain);
      c.connect(a); a.connect(b); b.connect(p); p.connect(this.cricketG);
      c.start(); l1.start(); l2.start();
    });
  }

  // ---------- per-frame ----------
  update(s) {
    if (!this.ctx) return;
    Object.assign(this.s, s);
    const t = this.ctx.currentTime, k = 0.8;
    this.cricketG.gain.setTargetAtTime(0.012 * Math.max(0, Math.min(1, s.night * 1.2 + s.dusk * 0.5)), t, k);
    const pad = s.paddling === undefined ? 1 : s.paddling; // silent glide: hull hiss only while paddling
    this.wakeG.gain.setTargetAtTime(pad * (0.004 + 0.03 * Math.min(1, s.speed / 3)), t, 0.4);
    this.windG.gain.setTargetAtTime(0.04 + 0.03 * s.day, t, 2);
    this.musicBus.gain.setTargetAtTime((0.5 - 0.1 * s.night) * (1 - 0.35 * (s.rain || 0)) * (this.ducked ? 0.32 : 1), t, this.ducked ? 0.6 : 3);
    this.rainG.gain.setTargetAtTime(0.06 * (s.rain || 0), t, 1.2);
    const gu = s.gust || 0; this.gustG.gain.setTargetAtTime(0.09 * Math.max(0, gu - 0.15), t, 0.9); this.gustBP.frequency.setTargetAtTime(500 + 500 * gu, t, 1.2);
    this.pullG.gain.setTargetAtTime(0.05 * (s.pull || 0), t, 0.06); this.pullF.frequency.setTargetAtTime(300 + 260 * (s.pull || 0), t, 0.1);
    // hull slaps: little wavelets clapping against the canoe, more of them when the wind is up
    if (s.play && Math.random() < 0.35 * (0.25 + 1.6 * gu)) this.slapTimer = (this.slapTimer || 0) - 1;
    if (this.slapTimer < 0) { this.slapTimer = 4 + Math.random() * 10; this.hullSlap(0.4 + gu); }
    // creak: the hull and seat flex in a turn
    const turn = Math.abs(s.turn || 0); this.creakT = (this.creakT || 0) - 1;
    if (turn > 0.35 && this.creakT < 0 && Math.random() < 0.12) { this.creakT = 300 + Math.random() * 400; this.creak(turn); }
  }

  // ---------- one-shots ----------
  splash(pan = 0, power = 1, pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (pos) { const out = this.at(pos, { wet: 0.8 }), src = ctx.createBufferSource(); src.buffer = this.white; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.7;
      f.frequency.setValueAtTime(1300, t); f.frequency.exponentialRampToValueAtTime(380, t + 0.45); const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.2 * power, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.6);
      src.connect(f); f.connect(g); g.connect(out); src.start(t, Math.random() * 2, 0.7); return; }
    const src = ctx.createBufferSource(); src.buffer = this.white;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.7;
    f.frequency.setValueAtTime(1500, t); f.frequency.exponentialRampToValueAtTime(420, t + 0.4);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16 * power, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.55);
    const p = this.panner(pan);
    src.connect(f); f.connect(g); g.connect(p); p.connect(this.natureBus); p.connect(this.send);
    src.start(t, Math.random() * 2, 0.6);
    for (let i = 0; i < 3; i++) this.ping(t + rand(0.08, 0.45), rand(1600, 3200), 0.018, pan);
  }
  ping(t, freq, vol, pan = 0) {
    const ctx = this.ctx, o = this.osc('sine', freq), g = ctx.createGain(), p = this.panner(pan);
    o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.08);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); g.connect(p); p.connect(this.natureBus); p.connect(this.send); o.start(t); o.stop(t + 0.15);
  }
  knock(vol = 0.1, pan = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this.osc('sine', 150), g = ctx.createGain(), p = this.panner(pan);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.08);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); g.connect(p); p.connect(this.natureBus); o.start(t); o.stop(t + 0.15);
  }
  plop(pan = 0, pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this.osc('sine', 700), g = ctx.createGain();
    if (pos) { o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.14); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.connect(g); g.connect(this.at(pos)); o.start(t); o.stop(t + 0.25); return; }
    const p = this.panner(pan);
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.14);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.1, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(p); p.connect(this.natureBus); p.connect(this.send); o.start(t); o.stop(t + 0.25);
    this.ping(t + 0.1, 1900, 0.02, pan);
  }
  honkFlock(pan = 0, pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime, n = 7 + Math.floor(Math.random() * 6);
    const bus = pos ? this.at(pos, { ref: 60, roll: 0.6, echo: 0.6 }) : null;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * rand(0.25, 0.55), f = rand(380, 520);
      const o = this.osc('sawtooth', f), bp = ctx.createBiquadFilter(), g = ctx.createGain(), p = this.panner(pan + rand(-0.2, 0.2));
      bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 2.2;
      o.frequency.setValueAtTime(f * 0.85, t); o.frequency.linearRampToValueAtTime(f * 1.25, t + 0.12); o.frequency.linearRampToValueAtTime(f, t + 0.3);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(rand(0.012, 0.03), t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      o.connect(bp); bp.connect(g); if (bus) g.connect(bus); else { g.connect(p); p.connect(this.natureBus); p.connect(this.send); } o.start(t); o.stop(t + 0.4);
    }
  }

  // ---------- v0.4: the paddle stroke, the hull, rain drops ----------
  /** catch: the blade's edge slicing in (quieter, deeper than the old splash) */
  strokeCatch(pan, power) {
    if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.white; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.1;
    f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(260, t + 0.22);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.1 * power, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.3);
    const p = this.panner(pan); src.connect(f); f.connect(g); g.connect(p); p.connect(this.natureBus); p.connect(this.send); src.start(t, Math.random() * 2, 0.35);
    this.ping(t + 0.03, rand(500, 700), 0.02, pan);
  }
  /** release: blade lifting out, a thin trickle of water */
  strokeRelease(pan, power) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) this.ping(t + i * rand(0.04, 0.09), rand(1800, 3400), 0.012 * power, pan);
    if (Math.random() < 0.3) this.knock(0.035, pan); // shaft brushing the gunwale on the pry
  }
  drip(pan = 0) { if (this.ctx) this.ping(this.ctx.currentTime, rand(2400, 4200), rand(0.004, 0.009), pan); }
  hullSlap(power = 1) {
    if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime, src = ctx.createBufferSource(); src.buffer = this.pink;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520; const g = ctx.createGain(), p = this.panner(rand(-0.4, 0.4));
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06 * power, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.18);
    src.connect(f); f.connect(g); g.connect(p); p.connect(this.natureBus); src.start(t, Math.random() * 4, 0.25);
    const o = this.osc('sine', rand(95, 130)), og = ctx.createGain(); og.gain.setValueAtTime(0.03 * power, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1); o.connect(og); og.connect(p); o.start(t); o.stop(t + 0.12);
  }
  creak(k = 1) {
    if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime, dur = rand(0.35, 0.7);
    const o = this.osc('sawtooth', rand(140, 190)), bp = ctx.createBiquadFilter(), g = ctx.createGain(), am = this.osc('square', rand(28, 45)), amg = ctx.createGain();
    bp.type = 'bandpass'; bp.Q.value = 6; bp.frequency.setValueAtTime(rand(700, 1000), t); bp.frequency.linearRampToValueAtTime(rand(450, 650), t + dur);
    o.frequency.linearRampToValueAtTime(o.frequency.value * 0.8, t + dur); amg.gain.value = 0.5; am.connect(amg); amg.connect(g.gain);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.012 * k, t + 0.08); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(bp); bp.connect(g); g.connect(this.natureBus); o.start(t); am.start(t); o.stop(t + dur + 0.05); am.stop(t + dur + 0.05);
  }

  // ---------- v0.4: wildlife voices, placed in the world ----------
  _tone(out, t, f0, f1, len, vol, type = 'sine', vib = 0, vibHz = 6) {
    const ctx = this.ctx, o = this.osc(type, f0), g = ctx.createGain(); o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f1, t + len);
    if (vib) { const l = this.osc('sine', vibHz), lg = ctx.createGain(); lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + len + 0.05); }
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.03, len * 0.2)); g.gain.setValueAtTime(vol, t + len * 0.6); g.gain.linearRampToValueAtTime(0, t + len);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + len + 0.05);
  }
  _noise(out, t, len, vol, freq, q = 1, type = 'bandpass', buf) {
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = buf || this.white; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.01, len * 0.2)); g.gain.exponentialRampToValueAtTime(0.0005, t + len);
    src.connect(f); f.connect(g); g.connect(out); src.start(t, Math.random() * 2, len + 0.05); return f;
  }
  quack(pos, many) {
    if (!this.ctx) return; const t0 = this.ctx.currentTime, out = this.at(pos, { echo: 0.25 }), n = many ? 6 + Math.floor(Math.random() * 6) : 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) { const t = t0 + i * rand(0.14, 0.32), f = rand(380, 520); const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 3; bp.connect(out); this._tone(bp, t, f, f * 0.75, 0.13, 0.05, 'sawtooth'); }
  }
  wings(pos, k = 1) {
    if (!this.ctx) return; const t0 = this.ctx.currentTime, out = this.at(pos, { wet: 0.4 });
    for (let i = 0; i < 10 * k + 4; i++) this._noise(out, t0 + i * rand(0.07, 0.11), 0.06, 0.05 * k, rand(600, 900), 0.8, 'bandpass', this.pink);
  }
  heron(pos) { // a hoarse, prehistoric croak
    if (!this.ctx) return; const t = this.ctx.currentTime, out = this.at(pos, { echo: 0.5 });
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 1.6; bp.connect(out);
    this._tone(bp, t, 170, 120, 0.55, 0.11, 'sawtooth', 25, 32); this._tone(bp, t + 0.7, 160, 115, 0.4, 0.07, 'sawtooth', 25, 30);
  }
  eagle(pos) { // thin, high chittering
    if (!this.ctx) return; const t0 = this.ctx.currentTime, out = this.at(pos, { ref: 60, roll: 0.5, echo: 0.4 });
    for (let i = 0; i < 6; i++) { const f = rand(2600, 3200); this._tone(out, t0 + i * 0.12, f, f * 1.12, 0.09, 0.02); }
  }
  kingfisher(pos) { // dry rattle
    if (!this.ctx) return; const t0 = this.ctx.currentTime, out = this.at(pos, { echo: 0.2 });
    for (let i = 0; i < 14; i++) this._noise(out, t0 + i * 0.045, 0.03, 0.06, rand(2800, 3600), 4);
  }
  snort(pos) { // deer alarm blow
    if (!this.ctx) return; const t = this.ctx.currentTime, out = this.at(pos, { echo: 0.6 });
    this._noise(out, t, 0.45, 0.16, 900, 0.7, 'bandpass', this.pink); this._noise(out, t + 0.75, 0.35, 0.08, 800, 0.7, 'bandpass', this.pink);
  }
  hooves(pos) { if (!this.ctx) return; const t0 = this.ctx.currentTime, out = this.at(pos, { wet: 0.4 }); for (let i = 0; i < 8; i++) this._noise(out, t0 + i * rand(0.18, 0.26), 0.05, 0.05, 260, 1.2, 'lowpass', this.pink); }
  tailSlap(pos) { // the beaver's rifle-crack slap, echoing off the hills
    if (!this.ctx) return; const t = this.ctx.currentTime, out = this.at(pos, { ref: 30, roll: 0.7, wet: 1.2, echo: 1.2 });
    this._noise(out, t, 0.35, 0.5, 1200, 0.5, 'lowpass'); this._tone(out, t, 110, 55, 0.18, 0.25);
    this.splash(0, 1.2, pos);
  }
  otter(pos) { if (!this.ctx) return; const t = this.ctx.currentTime, out = this.at(pos); this._tone(out, t, 1900, 2500, 0.08, 0.025); this._tone(out, t + 0.12, 2100, 2700, 0.07, 0.02); }
  moose(pos) { if (!this.ctx) return; const t = this.ctx.currentTime, out = this.at(pos, { echo: 0.7 }); const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.connect(out); this._tone(lp, t, 95, 70, 0.9, 0.12, 'sawtooth', 6, 8); }
  farPaddle(pos) { if (!this.ctx) return; const t = this.ctx.currentTime, out = this.at(pos, { ref: 25, roll: 1.1, air: 180 }); this._noise(out, t, 0.25, 0.08, 800, 0.8); }

  /** Soft shimmer as the creek fog swallows the canoe. */
  chime() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [74, 78, 81, 86, 90, 93, 98].forEach((m, i) => this.pluck(t + 0.1 + i * 0.32, mtof(m), 0.06));
    this.pad(t + 0.2, [62, 69, 74, 78], 9);
  }

  // ---------- scheduled generative layers ----------
  tick() {
    const ctx = this.ctx; if (!ctx) return;
    const now = ctx.currentTime, s = this.s;
    // Pad chords
    if (now + 0.5 > this.t.chord) {
      const chord = CHORDS[this.chordIdx++ % CHORDS.length];
      this.pad(this.t.chord, chord, 15);
      this.t.chord += 12.5;
    }
    // Melody
    if (now + 0.4 > this.t.note) {
      const rest = Math.random() < 0.18 + 0.25 * s.night;
      if (!rest) {
        this.melIdx = Math.max(0, Math.min(PENTA.length - 1, this.melIdx + pick([-2, -1, -1, 0, 1, 1, 2])));
        let m = PENTA[this.melIdx] - (s.night > 0.5 ? 12 : 0);
        this.pluck(this.t.note, mtof(m), rand(0.07, 0.14) * (1 - 0.3 * s.night));
        if (Math.random() < 0.18) this.pluck(this.t.note + 0.34, mtof(m + pick([2, 5, 7])), 0.05);
      }
      this.t.note += rand(1.3, 3.4) + s.night * 1.4;
    }
    // Birds (day / dawn)
    if (now > this.t.bird) {
      const lvl = Math.max(0, s.day * 0.7 + s.dawn * 1.0 - s.night);
      if (lvl > 0.12 && Math.random() < lvl) this.bird(now + 0.05);
      this.t.bird = now + rand(1.8, 6) / (0.25 + lvl);
    }
    // Loon
    if (now > this.t.loon) {
      const lvl = s.dawn * 1 + s.dusk * 1 + s.night * 0.8 + s.day * 0.2;
      if (Math.random() < lvl) this.loon(now + 0.05, this.loonPos ? this.loonPos() : null);
      this.t.loon = now + rand(22, 55);
    }
    // Owl
    if (now > this.t.owl) {
      if (s.night > 0.6 && Math.random() < 0.8) this.owl(now + 0.05, this.woods(80, 260, 12));
      this.t.owl = now + rand(18, 45);
    }
  }

  pad(t, midis, dur) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 - 250 * this.s.night; lp.Q.value = 0.3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.11, t + 4); g.gain.setValueAtTime(0.11, t + dur - 5); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    lp.connect(g); g.connect(this.musicBus);
    midis.forEach((m, i) => {
      [['triangle', 0, 0.5], ['sine', 7, 0.7], ['sine', -6, 0.5]].forEach(([type, det, vol]) => {
        const o = this.osc(type, mtof(m)); o.detune.value = det + i * 1.5;
        const og = ctx.createGain(); og.gain.value = vol / midis.length * 1.6;
        o.connect(og); og.connect(lp); o.start(t); o.stop(t + dur + 0.2);
      });
    });
  }

  pluck(t, f, vol) {
    const ctx = this.ctx, g = ctx.createGain(), hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 180;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    const p = this.panner(rand(-0.4, 0.4));
    [['sine', 1, 1], ['triangle', 2, 0.18], ['sine', 3.01, 0.06]].forEach(([type, mult, amp]) => {
      const o = this.osc(type, f * mult), og = ctx.createGain(); og.gain.value = amp;
      o.connect(og); og.connect(hp); o.start(t); o.stop(t + 3.4);
    });
    hp.connect(g); g.connect(p); p.connect(this.musicBus);
  }

  bird(t) {
    const ctx = this.ctx, type = pick(['chick', 'warb', 'flute', 'flute']);
    const out = this.at(this.listenerPos ? this.woods(30, 140, 9) : null, { wet: 0.7, ref: 25 }), vol = rand(0.015, 0.035) * (this.listenerPos ? 1.6 : 1);
    const note = (tt, f0, f1, len, v = vol, vib = 0) => {
      const o = this.osc('sine', f0), g = ctx.createGain();
      o.frequency.setValueAtTime(f0, tt); o.frequency.linearRampToValueAtTime(f1, tt + len);
      if (vib) { const l = this.osc('sine', 28), lg = ctx.createGain(); lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency); l.start(tt); l.stop(tt + len + 0.05); }
      g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(v, tt + 0.02); g.gain.setValueAtTime(v, tt + len * 0.6); g.gain.linearRampToValueAtTime(0, tt + len);
      o.connect(g); g.connect(out); o.start(tt); o.stop(tt + len + 0.06);
    };
    if (type === 'chick') { // fee-bee
      const f = rand(3300, 3700);
      note(t, f, f * 1.01, 0.32); note(t + 0.4, f * 0.86, f * 0.85, 0.42);
    } else if (type === 'warb') {
      const n = 6 + Math.floor(Math.random() * 6), f = rand(4200, 5800);
      for (let i = 0; i < n; i++) note(t + i * 0.075, f * (1 + 0.04 * Math.sin(i)), f * 1.12, 0.06, vol * 0.8);
    } else {
      const f = rand(1900, 2600), n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) { const ff = f * pick([1, 1.12, 1.26, 1.5, 0.89]); note(t + i * 0.3, ff, ff * pick([0.9, 1.1, 1.3]), 0.26, vol * 1.1, 40); }
    }
  }

  loon(t, pos) {
    const ctx = this.ctx, pan = rand(-0.8, 0.8);
    let out;
    if (pos && this.listenerPos) out = this.at(pos, { ref: 70, roll: 0.55, wet: 1.4, echo: 1.0 });
    else { out = this.panner(pan); const dry = ctx.createGain(); dry.gain.value = 0.5; out.connect(dry); dry.connect(this.natureBus);
      const wet = ctx.createGain(); wet.gain.value = 1.4; out.connect(wet); wet.connect(this.send); }
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2800; lp.connect(out);
    const g = ctx.createGain(); g.connect(lp);
    const tremolo = Math.random() < 0.4;
    const dur = tremolo ? 1.9 : 2.0;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.1, t + 0.2); g.gain.setValueAtTime(0.1, t + dur - 0.6); g.gain.linearRampToValueAtTime(0, t + dur);
    [[1, 1], [2, 0.32], [3, 0.12]].forEach(([m, a]) => {
      const o = this.osc('sine', 600 * m), og = ctx.createGain(); og.gain.value = a;
      if (tremolo) { for (let i = 0; i < 16; i++) o.frequency.setValueAtTime((i % 2 ? 980 : 720) * m, t + i * 0.1); }
      else { o.frequency.setValueAtTime(480 * m, t); o.frequency.exponentialRampToValueAtTime(900 * m, t + 0.5); o.frequency.linearRampToValueAtTime(800 * m, t + dur); }
      const l = this.osc('sine', 6), lg = ctx.createGain(); lg.gain.value = 18 * m; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.1);
      o.connect(og); og.connect(g); o.start(t); o.stop(t + dur + 0.1);
    });
  }

  owl(t, pos) {
    const ctx = this.ctx, out = this.at(this.listenerPos ? pos : null, { ref: 40, roll: 0.7, wet: 1.1, echo: 0.5, pan: rand(-0.8, 0.8) });
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(out);
    [0, 0.33, 0.8, 1.1, 1.75].forEach((dt, i) => {
      const len = i === 4 ? 0.7 : 0.2, f = 390, o = this.osc('sine', f), g = ctx.createGain(), tt = t + dt;
      o.frequency.setValueAtTime(f, tt); o.frequency.linearRampToValueAtTime(f * (i === 4 ? 0.8 : 0.92), tt + len);
      g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.05, tt + 0.03); g.gain.linearRampToValueAtTime(0, tt + len);
      o.connect(g); g.connect(lp); o.start(tt); o.stop(tt + len + 0.05);
    });
  }
}
