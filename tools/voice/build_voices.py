#!/usr/bin/env python3
"""Floodwood voice builder.

Takes ONE recording of the script in tools/voice/cues.json (any format ffmpeg reads: m4a, mp3, wav...),
finds every take in it, and builds the layered ghost voices the game uses:

  1. split the recording on silences (each take is followed by ~2 s of quiet)
  2. transcribe each piece (faster-whisper) and line the pieces up with the script in order,
     so retakes, coughs and stray words are skipped automatically (the last good take wins)
  3. trim and level each take
  4. re-voice every take as six different people (WORLD vocoder: pitch and formants moved
     independently, so they sound like other people rather than sped-up tape)
  5. pack each voice into one mp3 "sprite" + a manifest the game reads (audio/voice/)
  6. write report.txt (what matched what) and preview.html (audition every cue in every voice)

usage:  python3 tools/voice/build_voices.py my_recording.m4a [--out audio/voice] [--no-asr]
needs:  ffmpeg, pip install numpy soundfile pyworld faster-whisper
"""
import argparse, json, os, re, subprocess, sys, difflib, tempfile
import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
FS = 32000           # plenty for voices heard across a pond, and keeps the sprites small
GAP = 0.35           # silence between takes inside a sprite (s)


def load(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(FS), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32).astype(np.float64)
    # gentle high-pass (removes rumble / handling noise) and DC
    from scipy.signal import butter, sosfiltfilt
    x = sosfiltfilt(butter(2, 70, 'hp', fs=FS, output='sos'), x - x.mean())
    return x / (np.abs(x).max() + 1e-9) * 0.9


def frames_db(x, hop=0.01, win=0.03):
    h, w = int(hop * FS), int(win * FS)
    n = max(1, (len(x) - w) // h)
    idx = np.arange(w)[None, :] + h * np.arange(n)[:, None]
    rms = np.sqrt((x[idx] ** 2).mean(1) + 1e-12)
    return 20 * np.log10(rms), h


def segment(x, min_gap=0.7, min_len=0.12, thr=None, expect=None):
    """split on silences longer than min_gap; returns [(start, end)] in samples.
    Rooms differ (fridge hum, breaths between takes), so unless a threshold is given, try a range and keep the
    one whose piece count is closest to the number of takes expected."""
    db, h = frames_db(x)
    if thr is None:
        floor, peak = np.percentile(db, 15), np.percentile(db, 99.5)
        cands = [t for t in np.arange(floor + 6, peak - 12, 1.5)] or [max(floor + 10, peak - 42)]
        best = None
        for t in cands:
            n = len(split(db, h, len(x), t, min_gap, min_len))
            score = abs(n - (expect or n)) + (0.02 * (t - cands[0]))      # closest count; ties -> lower threshold (keeps tails)
            if best is None or score < best[0]: best = (score, t)
        thr = best[1]
    return split(db, h, len(x), thr, min_gap, min_len), thr


def split(db, h, nx, thr, min_gap, min_len):
    on = db > thr
    segs, i, n = [], 0, len(on)
    while i < n:
        if not on[i]: i += 1; continue
        j = i
        while j < n:
            if on[j]: j += 1; continue
            k = j
            while k < n and not on[k]: k += 1
            if (k - j) * 0.01 >= min_gap or k >= n: break
            j = k
        if (j - i) * 0.01 >= min_len: segs.append((max(0, i * h - int(0.08 * FS)), min(nx, j * h + int(0.35 * FS))))
        i = j + 1
    return segs


def trim(y, thr_rel=-38):
    db, h = frames_db(y, 0.005, 0.015)
    if not len(db): return y
    keep = np.where(db > db.max() + thr_rel)[0]
    if not len(keep): return y
    a, b = max(0, keep[0] * h - int(0.02 * FS)), min(len(y), keep[-1] * h + int(0.12 * FS))
    y = y[a:b].copy()
    fi, fo = int(0.006 * FS), int(0.05 * FS)
    y[:fi] *= np.linspace(0, 1, fi); y[-fo:] *= np.linspace(1, 0, fo)
    # level: loud parts to about the same perceived level, peak capped
    act = y[np.abs(y) > 0.02] if np.any(np.abs(y) > 0.02) else y
    y = y * min(0.18 / (np.sqrt((act ** 2).mean()) + 1e-9), 0.95 / (np.abs(y).max() + 1e-9))
    return y


# ---------------------------------------------------------------- matching
LAUGHY = re.compile(r'\b(ha+|heh|hah|he+h|haha\w*|hehe\w*|ah+ha\w*|hm+|laugh\w*|chuckl\w*|snort)\b|[\[\(*]', re.I)
ALT = {  # what the second takes might sound like
    'shout_go': ['go'], 'shout_yeah': ['yeah'], 'shout_dude': ['dude', 'duuude'], 'shout_oh': ['oh', 'ohhh', 'oh no'],
    'shout_no': ['no', 'nooo'], 'shout_wait': ['wait wait wait'], 'shout_come': ['come on', 'cmon cmon', 'come on come on'],
    'shout_woo': ['woo', 'whoo', 'woohoo'], 'shout_hey': ['hey'],
}
norm = lambda s: re.sub(r'[^a-z ]', '', s.lower().replace("'", '')).strip()


MARKER = re.compile(r'\b(again|redo|retake|sorry|scratch that|one more|hold on|let me)\b', re.I)


def similarity(cue, text):
    t = norm(text)
    if MARKER.search(text): return -0.6                 # "again" / "sorry, let me redo that": never a take
    if cue['kind'] != 'laugh' and len(t.split()) > len(norm(cue['say']).split()) + 3: return -0.2   # chatter
    if cue['kind'] == 'laugh':
        if not t or LAUGHY.search(text): return 0.85
        return 0.25 if len(t.split()) <= 2 else 0.05
    best = 0
    for ref in [cue['say']] + ALT.get(cue['id'], []):
        r = norm(ref)
        best = max(best, difflib.SequenceMatcher(None, r.replace(' ', ''), t.replace(' ', '')).ratio())
    if not t: best = 0.15            # whisper missed a short shout: weak, order decides
    return best


def align(takes, segtexts):
    """monotonic alignment of segments to takes. Each segment is either a take (a later segment matched to the
    same take is a retake and replaces it) or junk. Maximises total similarity minus skip penalties."""
    n, m = len(takes), len(segtexts)
    S = np.array([[similarity(tk['cue'], tx) for tx in segtexts] for tk in takes])
    NEG = -1e9
    # dp[j][i]: best score after the first j segments with the last assigned take = i (-1 = none yet, stored at index 0)
    dp = np.full((m + 1, n + 1), NEG); dp[0][0] = 0; back = {}
    for j in range(m):
        for i in range(n + 1):
            if dp[j][i] == NEG: continue
            # junk
            v = dp[j][i] - 0.12
            if v > dp[j + 1][i]: dp[j + 1][i] = v; back[(j + 1, i)] = (i, None)
            # retake of take i (replaces it)
            if i > 0:
                v = dp[j][i] + S[i - 1][j] - 0.05
                if v > dp[j + 1][i]: dp[j + 1][i] = v; back[(j + 1, i)] = (i, i - 1)
            # next takes (skipping some costs)
            for k in range(i + 1, min(n, i + 4) + 1):
                v = dp[j][i] + S[k - 1][j] - 0.45 * (k - i - 1)
                if v > dp[j + 1][k]: dp[j + 1][k] = v; back[(j + 1, k)] = (i, k - 1)
    end = int(np.argmax([dp[m][i] - 0.45 * (n - i) for i in range(n + 1)]))
    assign, j, i = {}, m, end
    while j > 0:
        pi, tk = back[(j, i)]
        if tk is not None and tk not in assign: assign[tk] = j - 1      # walking backwards: first seen = last take
        i, j = pi, j - 1
    return assign, S


# ---------------------------------------------------------------- re-voicing
def revoice(y, pitch, formant):
    if abs(pitch - 1) < 1e-3 and abs(formant - 1) < 1e-3: return y.copy()
    import pyworld as pw
    f0, sp, ap = pw.wav2world(y, FS, frame_period=5.0)
    f0 = f0 * pitch
    bins = np.arange(sp.shape[1]); src = np.clip(bins / formant, 0, sp.shape[1] - 1)
    sp2 = np.stack([np.interp(src, bins, row) for row in sp])
    z = pw.synthesize(f0, sp2, ap, FS, frame_period=5.0)
    z = z[:len(y)] if len(z) >= len(y) else np.pad(z, (0, len(y) - len(z)))
    return z * (np.sqrt((y ** 2).mean()) / (np.sqrt((z ** 2).mean()) + 1e-9))


def to_mp3(x, path, kbps=48):
    with tempfile.NamedTemporaryFile(suffix='.wav') as tf:
        sf.write(tf.name, np.clip(x, -1, 1).astype(np.float32), FS)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tf.name, '-ac', '1', '-b:a', f'{kbps}k', path], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('recording'); ap.add_argument('--out', default=os.path.join(HERE, '..', '..', 'audio', 'voice'))
    ap.add_argument('--cues', default=os.path.join(HERE, 'cues.json')); ap.add_argument('--no-asr', action='store_true')
    ap.add_argument('--gap', type=float, default=0.7, help='silence (s) that separates takes')
    ap.add_argument('--thr', type=float, default=None, help='silence threshold in dB (default: automatic)')
    a = ap.parse_args()
    C = json.load(open(a.cues)); os.makedirs(a.out, exist_ok=True)
    takes = [{'cue': c, 'n': k + 1, 'key': f"{c['id']}#{k + 1}"} for c in C['cues'] for k in range(c['takes'])]

    x = load(a.recording)
    segs, thr = segment(x, a.gap, thr=a.thr, expect=len(takes) + 1)
    print(f'{len(x) / FS:.1f}s recording, {len(segs)} pieces found for {len(takes)} takes (threshold {thr:.0f} dB)')
    texts = [''] * len(segs)
    if not a.no_asr:
        from faster_whisper import WhisperModel
        model = WhisperModel('base.en', device='cpu', compute_type='int8')
        for i, (s, e) in enumerate(segs):
            seg, _ = model.transcribe(resample16(x[s:e]), language='en', beam_size=5, vad_filter=False, condition_on_previous_text=False, initial_prompt=PROMPT)
            texts[i] = ' '.join(t.text.strip() for t in seg)
    assign, S = align(takes, texts)

    # report
    rep = [f'recording: {a.recording}', f'pieces: {len(segs)}  takes: {len(takes)}', '']
    used = {j: k for k, j in assign.items()}
    for j, (s, e) in enumerate(segs):
        k = used.get(j); rep.append(f'{s / FS:7.2f}s  {(e - s) / FS:4.1f}s  {texts[j]!r:40.40}  ->  {takes[k]["key"] if k is not None else "(skipped)"}')
    missing = [t['key'] for i, t in enumerate(takes) if i not in assign]
    rep += ['', 'missing takes: ' + (', '.join(missing) if missing else 'none')]

    # trim, lay out, re-voice, pack
    clips, layout, t = {}, {}, GAP
    for i, tk in enumerate(takes):
        if i not in assign: continue
        s, e = segs[assign[i]]; y = trim(x[s:e])
        clips[i] = y; layout.setdefault(tk['cue']['id'], []).append({'take': tk['n'], 'start': round(t, 4), 'dur': round(len(y) / FS, 4)}); t += len(y) / FS + GAP
    total = int((t + GAP) * FS)
    files = []
    for v in C['voices']:
        buf = np.zeros(total)
        for i, y in clips.items():
            st = next(c['start'] for c in layout[takes[i]['cue']['id']] if c['take'] == takes[i]['n'])
            z = revoice(y, v['pitch'], v['formant']); a0 = int(st * FS); buf[a0:a0 + len(z)] += z
        fn = f"voice_{v['id']}.mp3"; to_mp3(buf, os.path.join(a.out, fn)); files.append(fn)
        print('  built', fn)
    man = {'version': 1, 'fs': FS, 'voices': [{'id': v['id'], 'pitch': v['pitch'], 'file': f} for v, f in zip(C['voices'], files)],
           'cues': {k: {'kind': next(c['kind'] for c in C['cues'] if c['id'] == k), 'takes': v} for k, v in layout.items()}}
    json.dump(man, open(os.path.join(a.out, 'manifest.json'), 'w'), indent=1)
    open(os.path.join(a.out, 'report.txt'), 'w').write('\n'.join(rep) + '\n')
    write_preview(a.out, man, C)
    print('\n'.join(rep[-1:])); print('wrote', a.out)


PROMPT = 'Ha ha ha. Heh heh. Hey! Woooo! Go go go! Yeah! Dude! Oh! No! Wait! Come on! Ah, beef beef beef beef! Heads up! Whoa!'


def resample16(y):
    from scipy.signal import resample_poly
    return resample_poly(y, 1, 2).astype(np.float32)   # 32 kHz -> 16 kHz for whisper


def write_preview(out, man, C):
    def cell(cid, vi):
        return '<td>' + ''.join(f'<button data-v={vi} data-s={tk["start"]} data-d={tk["dur"]}>{tk["take"]}</button>' for tk in man['cues'].get(cid, {}).get('takes', [])) + '</td>'
    rows = ''.join(f"<tr><th>{c['id']}<br><small>{c['say']}</small></th>" + ''.join(cell(c['id'], vi) for vi in range(len(man['voices']))) + '</tr>' for c in C['cues'])
    head = ''.join(f"<th>{v['id']}<br><small>x{v['pitch']}</small></th>" for v in man['voices'])
    html = f"""<!doctype html><meta charset=utf-8><title>Floodwood voices</title>
<style>body{{font:14px system-ui;background:#111;color:#ddd;padding:12px}}table{{border-collapse:collapse}}td,th{{border:1px solid #333;padding:4px 6px;text-align:left}}button{{margin:1px;background:#2a3a33;color:#eee;border:0;padding:4px 8px;border-radius:4px}}small{{color:#888}}</style>
<h3>Floodwood voices: tap to audition</h3>
<p><label><input type=checkbox id=mem checked> as a memory (quiet, far, echoing, like in the game)</label> &nbsp; <button id=crowd>play a crowd laugh (5 voices layered)</button></p>
<table><tr><th>cue</th>{head}</tr>{rows}</table>
<script>
const M={json.dumps(man)};let ctx,bufs=[];
async function init(){{if(ctx)return;ctx=new AudioContext();bufs=await Promise.all(M.voices.map(v=>fetch(v.file).then(r=>r.arrayBuffer()).then(b=>ctx.decodeAudioData(b))));}}
let hazeIn=null;const memOn=()=>document.getElementById('mem').checked;
function haze(){{if(hazeIn)return hazeIn;hazeIn=ctx.createGain();const out=ctx.createGain();out.gain.value=0.5;out.connect(ctx.destination);
 const cv=ctx.createConvolver(),n=ctx.sampleRate*3.5,ir=ctx.createBuffer(2,n,ctx.sampleRate);for(let c=0;c<2;c++){{const d=ir.getChannelData(c);for(let i=0;i<n;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/n,3);}}cv.buffer=ir;const rv=ctx.createGain();rv.gain.value=0.9;out.connect(cv);cv.connect(rv);rv.connect(ctx.destination);
 const pre=ctx.createDelay(1);pre.delayTime.value=0.09;hazeIn.connect(pre);
 const T=[[0.43,-0.7,0.13],[0.67,0.7,0.09]].map(([dt,pan,r])=>{{const d=ctx.createDelay(2);d.delayTime.value=dt;const l=ctx.createOscillator(),lg=ctx.createGain();l.frequency.value=r;lg.gain.value=0.007;l.connect(lg);lg.connect(d.delayTime);l.start();
 const k=ctx.createBiquadFilter();k.type='lowpass';k.frequency.value=1700;const fb=ctx.createGain();fb.gain.value=0.52;const pn=ctx.createStereoPanner();pn.pan.value=pan;pre.connect(d);d.connect(k);k.connect(fb);k.connect(pn);pn.connect(out);return {{d,fb}};}});
 T[0].fb.connect(T[1].d);T[1].fb.connect(T[0].d);hazeIn.cv=cv;return hazeIn;}}
function play(v,s,d,when=0,pan=0){{const src=ctx.createBufferSource();src.buffer=bufs[v];const p=ctx.createStereoPanner();p.pan.value=pan;src.connect(p);
 if(!memOn()){{p.connect(ctx.destination);src.start(ctx.currentTime+when,s,d);return;}}
 const H=haze(),g=ctx.createGain(),t=ctx.currentTime+when;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.38,t+0.12);const hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=340;const lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=2400;
 p.connect(g);g.connect(hp);hp.connect(lp);lp.connect(ctx.destination);const wet=ctx.createGain();wet.gain.value=1.0;lp.connect(H.cv);const snd=ctx.createGain();snd.gain.value=1.3;lp.connect(snd);snd.connect(H);
 if(src.detune){{const w=ctx.createOscillator(),wg=ctx.createGain();w.frequency.value=0.45;wg.gain.value=14;w.connect(wg);wg.connect(src.detune);w.start(t);w.stop(t+d+1);}}src.start(t,s,d);}}
document.querySelectorAll('td button').forEach(b=>b.onclick=async()=>{{await init();play(+b.dataset.v,+b.dataset.s,+b.dataset.d);}});
crowd.onclick=async()=>{{await init();const L=[...(M.cues.laugh_big||{{takes:[]}}).takes,...(M.cues.laugh||{{takes:[]}}).takes];if(!L.length)return;
for(let i=0;i<5;i++){{const t=L[Math.floor(Math.random()*L.length)];play(i%M.voices.length,t.start,t.dur,i*0.18+Math.random()*0.2,Math.random()*1.6-0.8);}}}};
</script>"""
    open(os.path.join(out, 'preview.html'), 'w').write(html)


if __name__ == '__main__':
    main()
