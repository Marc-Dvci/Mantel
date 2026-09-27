"""Generate the demo household's sample recordings.

In a real household these are recorded by family members in the family app.
For the demo they are synthesised with Kokoro-82M (Apache-2.0), one voice per
family member, from the exact words the demo household carries, so a recording
always says what its caption and answer say.

    .media-venv/Scripts/pip install kokoro soundfile
    .media-venv/Scripts/python tools/media/generate_voices.py

Needs ffmpeg on PATH for the MP3 encode.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro import KPipeline

OUT = Path(__file__).resolve().parents[2] / "fixtures" / "media"
RATE = 24_000

SARAH = "af_heart"
TOM = "am_michael"

# The words match packages/core/src/demo.ts exactly.
LINES: dict[str, tuple[str, str, float]] = {
    "audio-robert-sarah": (SARAH, "Robert loved this house. Shall we look at your photos from Lake Tahoe?", 0.92),
    "audio-story-tahoe-sarah": (
        SARAH,
        "You wouldn't get out of the water all afternoon, and Robert fell asleep on the dock.",
        0.92,
    ),
    "audio-msg-morning-sarah": (SARAH, "Good morning, Mum. It's a lovely day. I'll see you at four o'clock.", 0.95),
    "audio-msg-evening-tom": (TOM, "Hi Grandma, it's Tom. I'm coming to see you tomorrow at eleven. Sleep well.", 0.95),
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    pipeline = KPipeline(lang_code="a")
    for name, (voice, text, speed) in LINES.items():
        chunks = [audio for _, _, audio in pipeline(text, voice=voice, speed=speed)]
        pad = np.zeros(int(RATE * 0.35), dtype=np.float32)
        wave = np.concatenate([pad, *[np.asarray(c, dtype=np.float32) for c in chunks], pad])
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / f"{name}.wav"
            sf.write(wav, wave, RATE)
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-codec:a", "libmp3lame", "-b:a", "96k", str(OUT / f"{name}.mp3")],
                check=True,
            )
        print("wrote", name, f"{len(wave) / RATE:.1f}s")


if __name__ == "__main__":
    main()
