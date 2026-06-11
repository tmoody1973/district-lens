#!/usr/bin/env python3
"""Composes the final demo MP4 from per-beat clips + ElevenLabs narration.

Audio lesson learned (v3): the first composer gave every segment its own AAC
track (stereo silence cards, mono narration beats) and concatenated them —
the mid-stream channel-layout flips plus seven sets of AAC priming gaps
produced audible background stutter. Now segments are VIDEO-ONLY; the audio
is assembled as ONE continuous track (everything aformat-normalized to
stereo/44.1k, each piece padded/trimmed to its segment's exact video
duration) and encoded once, then muxed at the end.

Text (cards/captions) is browser-rendered PNG burned via core `overlay`
(this ffmpeg build has no drawtext/libass).

Re-narration swap: replace MP3s in narration/, run
`node cards.js && python3 compose.py`.
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


def png_video(png: Path, seconds: float, out_path: Path) -> None:
    run([
        "ffmpeg", "-y", "-loop", "1", "-t", str(seconds), "-i", str(png),
        "-vf", f"scale={SIZE},fps={FPS}", "-an",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out_path),
    ])


def caption_chain(beat_id: str, first_input: int) -> tuple[str, list[str]]:
    """Overlay chain for a beat's caption PNGs starting at input index."""
    inputs: list[str] = []
    chain = ""
    current = "[base]"
    for i, cap in enumerate(CAPTIONS[beat_id]):
        inputs += ["-i", cap["file"]]
        nxt = f"[cap{i}]"
        chain += (
            f"{current}[{first_input + i}:v]overlay=0:0:"
            f"enable='between(t,{cap['start']},{cap['end']})'{nxt};"
        )
        current = nxt
    return chain.rstrip(";"), inputs


def beat_video(beat: dict) -> Path:
    """Video-only segment: trimmed, freeze-padded to narration length, captioned."""
    beat_id = beat["id"]
    duration = probe_duration(ROOT / f"narration/{beat_id}.mp3")
    offset = OFFSETS.get(beat_id, 0.0)
    clip = ROOT / f"clips/{beat_id}.webm"
    seg = SEGS / f"{beat_id}.mp4"

    if beat_id == "beat6_close":
        footage = SEGS / "beat6_footage.mp4"
        run([
            "ffmpeg", "-y", "-ss", str(offset), "-i", str(clip),
            "-t", str(BEAT6_FOOTAGE_SECONDS),
            "-vf", f"scale={SIZE},fps={FPS}", "-an",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(footage),
        ])
        endcard = SEGS / "beat6_card.mp4"
        png_video(ROOT / "assets/endcard.png",
                  duration - BEAT6_FOOTAGE_SECONDS + 0.6, endcard)
        run([
            "ffmpeg", "-y", "-i", str(footage), "-i", str(endcard),
            "-filter_complex", "[0:v][1:v]concat=n=2:v=1[out]",
            "-map", "[out]", "-t", str(duration),
            "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(seg),
        ])
        return seg

    run([
        "ffmpeg", "-y", "-ss", str(offset), "-i", str(clip),
        "-vf", f"scale={SIZE},fps={FPS},"
        f"tpad=stop_mode=clone:stop_duration={duration + 2}",
        "-t", str(duration),
        "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(seg),
    ])
    return seg


def build_audio(video_durations: list[tuple[str, float]]) -> Path:
    """ONE continuous stereo/44.1k track: silence under cards, narration under
    beats, every piece trimmed/padded to its segment's exact video length."""
    audio = SEGS / "narration_full.m4a"
    inputs: list[str] = []
    filters: list[str] = []
    labels: list[str] = []
    input_no = 0
    for i, (name, vdur) in enumerate(video_durations):
        if name in ("title", "intro"):
            filters.append(f"anullsrc=r=44100:cl=stereo,atrim=0:{vdur:.3f}[a{i}]")
        else:
            inputs += ["-i", str(ROOT / f"narration/{name}.mp3")]
            filters.append(
                f"[{input_no}:a]aformat=sample_rates=44100:channel_layouts=stereo,"
                f"apad,atrim=0:{vdur:.3f}[a{i}]"
            )
            input_no += 1
        labels.append(f"[a{i}]")
    graph = ";".join(filters) + ";" + "".join(labels) + \
        f"concat=n={len(labels)}:v=0:a=1[out]"
    run([
        "ffmpeg", "-y", *inputs, "-filter_complex", graph,
        "-map", "[out]", "-c:a", "aac", "-b:a", "160k", str(audio),
    ])
    return audio


def main() -> None:
    SEGS.mkdir(parents=True, exist_ok=True)
    intro = SEGS / "intro.mp4"
    run([
        "ffmpeg", "-y", "-i", str(ROOT / "clips/intro.webm"),
        "-vf", f"scale={SIZE},fps={FPS}", "-an",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", str(intro),
    ])

    segments: list[tuple[str, Path]] = [("intro", intro)]
    for beat in SCRIPT["beats"]:
        segments.append((beat["id"], beat_video(beat)))

    # Concat video-only segments (identical encode params → stream copy).
    concat_list = SEGS / "list.txt"
    concat_list.write_text("".join(f"file '{p.resolve()}'\n" for _, p in segments))
    video_only = SEGS / "video_full.mp4"
    run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list),
        "-c", "copy", str(video_only),
    ])

    durations = [(name, probe_duration(path)) for name, path in segments]
    audio = build_audio(durations)

    final = OUT / "districtlens-demo.mp4"
    run([
        "ffmpeg", "-y", "-i", str(video_only), "-i", str(audio),
        "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "copy",
        "-movflags", "+faststart", str(final),
    ])
    print("FINAL:", final)
    print(f"duration: {probe_duration(final):.1f}s "
          f"size: {final.stat().st_size // (1024 * 1024)}MB")


if __name__ == "__main__":
    main()
