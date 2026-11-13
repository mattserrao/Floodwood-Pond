// Story sounds placed in the world through the game's 3D audio. (v0.13.0: the memories' voices, laughs, shouts,
// recorded clips and boat sounds are gone with the memories; what's left is the deer's rush through the grass.)
export class Voices {
  constructor(audio) { this.audio = audio; }
  get ctx() { return this.audio.ctx; }
  ok() { return this.ctx && !this.silent && !this.audio.muted && !this.audio.paused; }
  /** a rush of air / grass at a world position */
  whoosh(pos, dur = 1.1) {
    if (!this.ok()) return; const ctx = this.ctx, t = ctx.currentTime, d = this.audio.at(pos, { wet: 0.3, ref: 14, roll: 0.9 });
    const n = ctx.createBufferSource(); n.buffer = this.audio.pink; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(300, t); bp.frequency.linearRampToValueAtTime(1400, t + dur * 0.5); bp.frequency.linearRampToValueAtTime(500, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + dur * 0.5); g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(bp); bp.connect(g); g.connect(d); n.start(t, Math.random() * 3, dur + 0.1);
  }
  resetDuck() { this.audio.ducked = false; }
}
