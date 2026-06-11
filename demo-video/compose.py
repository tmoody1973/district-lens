#!/usr/bin/env python3
"""Composes the final demo MP4 from per-beat clips + ElevenLabs narration.

Homebrew ffmpeg here has no drawtext/libass, so all text (title card, end
card, captions) comes in as browser-rendered PNGs (cards.js) burned with the
core `overlay` filter using enable=between(t,..) windows.

Re-narration swap for Tarik: replace MP3s in narration/, re-run
`python3 compose.py` (durations are re-probed) — no re-capture needed.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

SIZE = "1920x1080"
FPS = 30
TITLE_SECONDS = 3.5
BEAT6_FOOTAGE_SECONDS = 6.0

ROOT = Path(__file__).parent
OUT = ROOT / "out"
SEGS = OUT / "segments"
SCRIPT = json.loads((ROOT / "narration/script.json").read_text())
OFFSETS = json.loads((ROOT / "clips/offsets.json").read_text())
CAPTIONS = json.loads((ROOT / "assets/captions.json").read_text())


def run(args: list[str]) -> None:
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{proc.stderr[-1200:]}")


def probe_duration(path: Path) -> float:
    out = subprocess.check_output([
        "ffprobe", "-v", "quiet", "-show_entries", "format=duration",
        "-of", "csv=p=0", str(path),
    ])
    return float(out.strip())


def png_segment(png: Path, seconds: float, out_path: Path) -> None:
    """A silent video segment from a still PNG."""
    run([
        "ffmpeg", "-y", "-loop", "1", "-t", str(seconds), "-i", str(png),
        "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo:d={seconds}",
        "-vf", f"scale={SIZE},fps={FPS}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
        str(out_path),
    ])


def caption_filter(beat_id: str, base: str = "[base]") -> tuple[str, list[str]]:
    """Build the overlay chain for a beat's caption PNGs."""
    inputs: list[str] = []
    chain = ""
    current = base
    for i, cap in enumerate(CAPTIONS[beat_id]):
        inputs += ["-i", cap["file"]]
        nxt = f"[cap{i}]"
        # caption inputs start at index 2 (0=video, 1=audio)
        chain += (
            f"{current}[{i + 2}:v]overlay=0:0:"
            f"enable='between(t,{cap['start']},{cap['end']})'{nxt};"
        )
        current = nxt
    return chain.rstrip(";"), inputs


def beat_segment(beat: dict) -> Path:
    beat_id = beat["id"]
    audio = ROOT / f"narration/{beat_id}.mp3"
    duration = probe_duration(audio)
    offset = OFFSETS.get(beat_id, 0.0)
    clip = ROOT / f"clips/{beat_id}.webm"
    seg = SEGS / f"{beat_id}.mp4"

    if beat_id == "beat6_close":
        footage = SEGS / "beat6_footage.mp4"
        run([
            "ffmpeg", "-y", "-ss", str(offset), "-i", str(clip),
            "-t", str(BEAT6_FOOTAGE_SECONDS),
            "-vf", f"scale={SIZE},fps={FPS}",
            "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(footage),
        ])
        endcard = SEGS / "beat6_card.mp4"
        png_segment(ROOT / "assets/endcard.png",
                    duration - BEAT6_FOOTAGE_SECONDS + 0.6, endcard)
        chain, cap_inputs = caption_filter(beat_id)
        run([
            "ffmpeg", "-y", "-i", str(footage), "-i", str(endcard), *cap_inputs,
            "-i", str(audio),
            "-filter_complex",
            f"[0:v][1:v]concat=n=2:v=1[base];" + chain,
            "-map", f"[cap{len(CAPTIONS[beat_id]) - 1}]",
            "-map", f"{len(cap_inputs) // 2 + 2}:a",
            "-t", str(duration),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(seg),
        ])
        return seg

    chain, cap_inputs = caption_filter(beat_id)
    run([
        "ffmpeg", "-y", "-ss", str(offset), "-i", str(clip), "-i", str(audio),
        *cap_inputs,
        "-filter_complex",
        f"[0:v]scale={SIZE},fps={FPS},"
        f"tpad=stop_mode=clone:stop_duration={duration + 2}[base];" + chain,
        "-map", f"[cap{len(CAPTIONS[beat_id]) - 1}]", "-map", "1:a",
        "-t", str(duration),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(seg),
    ])
    return seg


def main() -> None:
    SEGS.mkdir(parents=True, exist_ok=True)
    title = SEGS / "title.mp4"
    png_segment(ROOT / "assets/title.png", TITLE_SECONDS, title)

    segments = [title] + [beat_segment(b) for b in SCRIPT["beats"]]
    concat_list = SEGS / "list.txt"
    concat_list.write_text("".join(f"file '{s.resolve()}'\n" for s in segments))
    final = OUT / "districtlens-demo.mp4"
    run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
        "-movflags", "+faststart", str(final),
    ])
    print("FINAL:", final)
    print(f"duration: {probe_duration(final):.1f}s "
          f"size: {final.stat().st_size // (1024 * 1024)}MB")


if __name__ == "__main__":
    main()
