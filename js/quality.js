// Graphics quality tiers. "Auto" measures the frame time for a few seconds after launch and steps down if needed;
// the pause menu can force Low / Medium / High. Everything that costs GPU time reads its budget from here.
const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

export const TIERS = {
  low:  { name: 'Low',    pixelRatio: 1,   msaa: 0, mistScale: 0.5, refl: 0,    blur: false, wildlife: 0.5,  leaves: 110, litter: 0.35, rain: 500 },
  med:  { name: 'Medium', pixelRatio: 1.5, msaa: 2, mistScale: 0.5, refl: 0.35, blur: true,  wildlife: 0.8,  leaves: 200, litter: 0.7,  rain: 900 },
  high: { name: 'High',   pixelRatio: 2,   msaa: 4, mistScale: 0.5, refl: 0.5,  blur: true,  wildlife: 1,    leaves: 300, litter: 1,    rain: 1400 },
};
const ORDER = ['low', 'med', 'high'];
const QS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();

export const Q = {
  mode: 'auto',              // 'auto' | 'low' | 'med' | 'high'
  tier: isTouch ? 'med' : 'high',
  get s() { return TIERS[Q.tier]; },
  listeners: [],
  onChange(fn) { Q.listeners.push(fn); },
  apply() { Q.listeners.forEach((fn) => fn(Q.s, Q.tier)); },
  label() { return Q.mode === 'auto' ? `Auto (${TIERS[Q.tier].name})` : TIERS[Q.tier].name; },
  /** cycle Auto -> Low -> Medium -> High -> Auto */
  cycle() {
    const seq = ['auto', 'low', 'med', 'high'], next = seq[(seq.indexOf(Q.mode) + 1) % seq.length];
    Q.mode = next; if (next !== 'auto') Q.tier = next; else { Q.tier = isTouch ? 'med' : 'high'; Q.calib = null; Q.calibDone = false; Q.drops = 0; }
    try { localStorage.setItem('fp-quality', next); } catch (e) {}
    Q.apply();
  },
  // ---- auto calibration: median frame interval over ~3.5 s of uncapped rendering
  calib: null, calibDone: false, drops: 0,
  /** call once per rendered frame with the real interval in ms; returns true while calibrating (renderer should not cap fps) */
  sample(ms) {
    if (Q.mode !== 'auto' || Q.calibDone) return false;
    if (!Q.calib) Q.calib = { n: 0, list: [], skip: 30 };
    const c = Q.calib;
    if (c.skip > 0) { c.skip--; return true; } // let shaders compile and the launch settle
    c.list.push(ms);
    if (c.list.length >= 150) {
      c.list.sort((a, b) => a - b); const med = c.list[c.list.length >> 1];
      const i = ORDER.indexOf(Q.tier);
      if (med > 23 && i > 0 && Q.drops < 2) { Q.tier = ORDER[i - 1]; Q.drops++; Q.calib = null; Q.apply(); return true; }
      Q.calibDone = true; Q.median = med;
    }
    return !Q.calibDone;
  },
};
try { const m = QS.get('quality') || localStorage.getItem('fp-quality'); if (m && (m === 'auto' || TIERS[m])) { Q.mode = m; if (m !== 'auto') Q.tier = m; } } catch (e) {}
