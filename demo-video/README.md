# Demo video pipeline

`out/districtlens-demo.mp4` — 2:41, 1920x1080, voiced cut for the Devpost
submission. Fully regenerable.

## Re-record narration in your own voice (recommended)

1. Read each beat from `narration/script.json` (six beats; keep roughly the
   same lengths — the visuals freeze-pad if you run long, trim if you run
   very short).
2. Save your takes over `narration/beat1_problem.mp3` … `beat6_close.mp3`
   (any sample rate; mp3/m4a both fine if you keep the .mp3 names).
3. `node cards.js && python3 compose.py` — durations are re-probed from your
   audio; captions and segment lengths re-time automatically. ~2 min render.

## Re-capture visuals (only if the app changes)

`node capture.js` re-records all six beats from prod (~5 min), then re-run
the two commands above.

## Current cut (v5)

Motion-graphics intro (intro.html, recorded by intro.js), no burned captions,
narration on ElevenLabs **eleven_v3** (expressive; reads slow, so compose
expects MP3s pre-compressed ~12% with `atempo=1.12` — the regen script does
this). Total must stay under 3:00.

## Pieces

- `capture.js` — Playwright, one recorded context per beat, injected cursor
- `intro.html` + `intro.js` — animated opener, recorded headless
- `narration/script.json` — the words; `cards.js` derives captions from it
- `cards.js` — browser-renders title/end cards + caption strips (homebrew
  ffmpeg has no drawtext/libass, so text comes in as PNG overlays)
- `compose.py` — trims pre-roll per `clips/offsets.json`, freeze-pads tails,
  burns captions via overlay enable-windows, muxes narration, concats
