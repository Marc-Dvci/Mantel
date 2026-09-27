"""Speak every labelled question and recognise it with the model the TV ships.

For each row of fixtures/questions/{dev,holdout,holdout2}.jsonl, four synthetic
voices (US and UK, female and male) say the sentence, the audio is resampled to
16 kHz mono and recognised by the Vosk small English model from
android/app/src/main/assets/model-en-us. The transcripts are written to
fixtures/questions/spoken-<set>.jsonl, and `pnpm eval` scores the matcher on
what the recogniser heard rather than on what was typed.

    .media-venv/Scripts/pip install kokoro soundfile vosk
    python tools/android/fetch_model.py
    .media-venv/Scripts/python tools/eval/spoken.py

Synthetic speech is cleaner than a person speaking across a living room, so
this measures the recogniser-to-matcher path, not the acoustics of a room.
"""

from __future__ import annotations

import json
from math import gcd
from pathlib import Path

import numpy as np
from kokoro import KPipeline
from scipy.signal import resample_poly
from vosk import KaldiRecognizer, Model, SetLogLevel

ROOT = Path(__file__).resolve().parents[2]
QUESTIONS = ROOT / "fixtures/questions"
MODEL = ROOT / "android/app/src/main/assets/model-en-us"
VOICES = [("a", "af_heart"), ("b", "bf_emma"), ("a", "am_michael"), ("b", "bm_george")]
SETS = ["dev", "holdout", "holdout2"]


def to16k(audio: np.ndarray) -> bytes:
    g = gcd(24000, 16000)
    pcm = resample_poly(audio, 16000 // g, 24000 // g)
    pcm = np.clip(pcm, -1, 1)
    return (pcm * 32767).astype(np.int16).tobytes()


def main() -> None:
    SetLogLevel(-1)
    model = Model(str(MODEL))
    pipes = {lang: KPipeline(lang_code=lang) for lang in {"a", "b"}}
    for name in SETS:
        rows = [json.loads(l) for l in (QUESTIONS / f"{name}.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
        out = []
        for row in rows:
            for lang, voice in VOICES:
                chunks = [np.asarray(a, dtype=np.float32) for _, _, a in pipes[lang](row["text"], voice=voice, speed=0.9)]
                audio = np.concatenate([np.zeros(4800, np.float32), *chunks, np.zeros(4800, np.float32)])
                rec = KaldiRecognizer(model, 16000)
                rec.AcceptWaveform(to16k(audio))
                heard = json.loads(rec.FinalResult()).get("text", "")
                out.append({"text": row["text"], "expect": row["expect"], "voice": voice, "heard": heard})
        (QUESTIONS / f"spoken-{name}.jsonl").write_text("".join(json.dumps(r) + "\n" for r in out), encoding="utf-8")
        exact = sum(r["heard"] == r["text"].lower().replace("?", "").replace("'", "") for r in out)
        print(f"{name}: {len(out)} utterances, {exact} transcribed word for word")


if __name__ == "__main__":
    main()
