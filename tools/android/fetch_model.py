"""Download the Vosk small English model into the APK's assets.

    python tools/android/fetch_model.py

Vosk's StorageService unpacks assets/model-en-us on first launch and re-unpacks
only when the `uuid` file changes, so the uuid is the model's name.
"""

import io
import shutil
import urllib.request
import zipfile
from pathlib import Path

NAME = "vosk-model-small-en-us-0.15"
URL = f"https://alphacephei.com/vosk/models/{NAME}.zip"
DEST = Path(__file__).resolve().parents[2] / "android/app/src/main/assets/model-en-us"


def main() -> None:
    if (DEST / "uuid").exists() and (DEST / "uuid").read_text().strip() == NAME:
        print("model already present:", DEST)
        return
    print("downloading", URL)
    data = urllib.request.urlopen(URL, timeout=300).read()
    shutil.rmtree(DEST, ignore_errors=True)
    DEST.mkdir(parents=True)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for member in z.infolist():
            if member.is_dir():
                continue
            rel = Path(member.filename).relative_to(NAME)
            out = DEST / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(z.read(member))
    (DEST / "uuid").write_text(NAME)
    print("model ready:", DEST)


if __name__ == "__main__":
    main()
