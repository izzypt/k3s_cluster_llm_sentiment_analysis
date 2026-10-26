"""Speaks every beat of src/generated/narration.json with Kokoro (offline, on the CPU).

Writes public/voice/<scene>/<beat>.wav and src/generated/voice.json
({ "<scene>/<beat>": seconds }), which the narrated composition uses for timing.
Only beats whose text changed since the last run are spoken again.

    .venv/Scripts/python scripts/voice.py [--voice am_michael] [--speed 1.0] [--only scene-id ...]
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

import espeakng_loader
import soundfile as sf
from kokoro_onnx import EspeakConfig, Kokoro
from phonemizer.backend.espeak.wrapper import EspeakWrapper

ROOT = Path(__file__).resolve().parent.parent
NARRATION = ROOT / "src/generated/narration.json"
DURATIONS = ROOT / "src/generated/voice.json"
CACHE = ROOT / "public/voice/.cache.json"
OUT = ROOT / "public/voice"
MODELS = ROOT / "tts-models"

ap = argparse.ArgumentParser()
ap.add_argument("--voice", default="am_michael")
ap.add_argument("--speed", type=float, default=1.0)
ap.add_argument("--only", nargs="*", help="scene ids to (re)speak")
args = ap.parse_args()

if not NARRATION.exists():
    sys.exit("run `node scripts/narration.mjs` first")
narration = json.loads(NARRATION.read_text(encoding="utf8"))
cache = json.loads(CACHE.read_text(encoding="utf8")) if CACHE.exists() else {}
durations = json.loads(DURATIONS.read_text(encoding="utf8")) if DURATIONS.exists() else {}


def ascii_path(p: str) -> str:
    """espeak-ng can't open paths with non-ASCII characters (an accented user name): use the 8.3 short name."""
    if sys.platform != "win32" or p.isascii():
        return p
    import ctypes

    buf = ctypes.create_unicode_buffer(1024)
    ctypes.windll.kernel32.GetShortPathNameW(p, buf, len(buf))
    return buf.value or p


espeak = EspeakConfig(lib_path=ascii_path(espeakng_loader.get_library_path()), data_path=ascii_path(espeakng_loader.get_data_path()))
# phonemizer resolve()s the data path, which turns the short name back into the long one
EspeakWrapper.data_path = property(lambda self: Path(espeak.data_path))
kokoro = Kokoro(str(MODELS / "kokoro-v1.0.onnx"), str(MODELS / "voices-v1.0.bin"), espeak_config=espeak)
todo = 0
for i, (key, text) in enumerate(narration.items()):
    scene, beat = key.split("/")
    wav = OUT / scene / f"{beat}.wav"
    tag = hashlib.sha1(f"{args.voice}|{args.speed}|{text}".encode()).hexdigest()
    fresh = wav.exists() and cache.get(key) == tag and key in durations
    if fresh and not (args.only and scene in args.only):
        continue
    if args.only and scene not in args.only:
        continue
    samples, rate = kokoro.create(text, voice=args.voice, speed=args.speed, lang="en-us")
    wav.parent.mkdir(parents=True, exist_ok=True)
    sf.write(wav, samples, rate)
    durations[key] = round(len(samples) / rate, 3)
    cache[key] = tag
    todo += 1
    print(f"[{i + 1}/{len(narration)}] {key}: {durations[key]:.1f}s", flush=True)
    # save as we go, so an interrupted run keeps what it made
    CACHE.write_text(json.dumps(cache, indent=1), encoding="utf8")
    DURATIONS.write_text(json.dumps(durations, indent=1), encoding="utf8")

# drop beats that no longer exist
durations = {k: v for k, v in durations.items() if k in narration}
DURATIONS.write_text(json.dumps(durations, indent=1), encoding="utf8")
total = sum(durations.values())
print(f"{todo} beats spoken; {len(durations)}/{len(narration)} ready, {total / 60:.1f} min of speech")
