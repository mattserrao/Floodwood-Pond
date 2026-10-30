// Day-to-day weather. Each new day (at 3 AM) rolls a sky: clear, overcast, or a fog-bound morning that burns off.
// Showers pass through now and then, mostly on grey days. Everything is exposed as smooth 0..1 levels.
import { clamp, sstep } from './world.js?v=0.9.2';

const QS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const R = Math.random;

export const WX = {
  kind: 'clear',            // today's sky: 'clear' | 'overcast' | 'fog'
  forced: QS.get('weather'), // ?weather=clear|overcast|fog|rain for testing
  // smoothed outputs
  cloud: 0,                 // 0 clear .. 1 fully grey
  rain: 0,                  // 0..1 shower intensity
  fog: 0,                   // extra valley fog, 0..1
  wet: 0,                   // lingers after rain: extra low mist
  wind: 0.3,                // breeze level for the wind system
  // targets
  _cloud: 0, _rain: 0, _windDay: 0.3, shower: null, nextShower: 120, lastDay: -1,
  roll(first) {
    if (WX.forced) { WX.kind = WX.forced === 'rain' ? 'overcast' : WX.forced; return; }
    // first morning: keep the familiar clear sunrise most of the time
    const r = R(); WX.kind = first ? (r < 0.75 ? 'clear' : 'fog') : r < 0.5 ? 'clear' : r < 0.75 ? 'overcast' : 'fog';
    WX._windDay = WX.kind === 'overcast' ? 0.45 + R() * 0.3 : 0.15 + R() * 0.3;
  },
  /** dt in real seconds, hour = in-game hour, dayLen = real seconds per in-game day */
  update(dt, hour, dayLen) {
    const day = Math.floor((WX.clock = (WX.clock || 0) + dt) / dayLen);
    if (WX.lastDay < 0) { WX.roll(true); WX.lastDay = 0; WX._hourPrev = hour; }
    if (WX._hourPrev < 3 && hour >= 3) WX.roll(false);
    WX._hourPrev = hour;
    // showers: a few real minutes apart, far more likely under grey skies
    if (WX.forced === 'rain') { if (!WX.shower) WX.shower = { t: 0, len: 1e9, peak: 0.85 }; }
    else if (!WX.shower) {
      WX.nextShower -= dt;
      if (WX.nextShower < 0) {
        const chance = WX.kind === 'overcast' ? 0.7 : WX.kind === 'fog' ? 0.15 : 0.12;
        if (R() < chance) WX.shower = { t: 0, len: 70 + R() * 80, peak: 0.45 + R() * 0.55 };
        WX.nextShower = 120 + R() * 200;
      }
    }
    let rainT = 0;
    if (WX.shower) {
      const S = WX.shower; S.t += dt;
      rainT = S.peak * sstep(0, 14, S.t) * (1 - sstep(S.len - 18, S.len, S.t));
      if (S.t > S.len) { WX.shower = null; }
    }
    const cloudT = Math.max(WX.kind === 'overcast' ? 0.85 * (WX.clearK ?? 1) + 0.15 * (1 - (WX.clearK ?? 1)) : WX.kind === 'fog' ? 0.35 * (1 - sstep(9, 11.5, hour)) * (WX.clearK ?? 1) : 0.05, rainT > 0.01 ? 0.75 + 0.25 * rainT : 0, WX.shower ? 0.7 : 0);
    const k = Math.min(1, dt / 9);
    WX.cloud += (cloudT - WX.cloud) * k;
    WX.rain += (rainT - WX.rain) * Math.min(1, dt / 3);
    // fog mornings: socked in before dawn, burning off by mid-morning; a lighter haze returns some evenings
    const fogT = WX.kind === 'fog' ? (hour > 20 || hour < 9 ? 1 : 1 - sstep(8, 10.5, hour)) * (hour > 20 ? sstep(20, 24, hour) : 1) : 0;
    WX.fog += (fogT * (WX.clearK ?? 1) - WX.fog) * Math.min(1, dt / ((WX.clearK ?? 1) < 1 ? 2 : 6));   // v0.8.0: the story can burn the fog off (clearK)
    WX.wet = rainT > 0.05 ? Math.min(1, WX.wet + dt / 20) : Math.max(0, WX.wet - dt / 90);
    WX.wind = clamp(WX._windDay + 0.35 * WX.rain + (WX.shower ? 0.15 : 0), 0, 1);
    return WX;
  },
  label() { return WX.rain > 0.15 ? 'Rain' : WX.fog > 0.5 ? 'Fog' : WX.cloud > 0.6 ? 'Overcast' : ''; },
};
