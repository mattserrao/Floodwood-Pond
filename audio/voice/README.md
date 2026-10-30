# Recorded voices

Built by `tools/voice/build_voices.py` from one recording of the script in `tools/voice/cues.json`:

    python3 tools/voice/build_voices.py my_recording.m4a

Output here:
- `voice_v1.mp3` … `voice_v6.mp3`: every take, re-voiced as six different people (pitch and formants shifted), packed into one sprite per voice
- `manifest.json`: where each take sits in the sprites (the game reads this)
- `report.txt`: which piece of the recording became which take
- `preview.html`: audition every cue in every voice, plus a layered crowd laugh

If this folder has no manifest, the game falls back to its synthesized voices.
