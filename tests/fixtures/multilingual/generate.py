"""Reproduce a three-language meeting with installed macOS voices; no recordings."""
import hashlib
import json
import subprocess
import tempfile
import wave
from pathlib import Path

root = Path(__file__).resolve().parent
turns = json.loads((root / "script.json").read_text())
rate = 16000
frames = []
samples = 0
timeline = []
with tempfile.TemporaryDirectory() as scratch:
    for index, turn in enumerate(turns):
        path = Path(scratch) / f"{index}.wav"
        subprocess.run(["/usr/bin/say", "-v", turn["voice"], "-r", "180", "--file-format=WAVE",
                        f"--data-format=LEI16@{rate}", "-o", str(path), turn["text"]], check=True)
        with wave.open(str(path)) as audio:
            assert audio.getnchannels() == 1 and audio.getsampwidth() == 2
            data = audio.readframes(audio.getnframes())
        start = samples / rate
        frames.append(data)
        samples += len(data) // 2
        timeline.append({**turn, "startSeconds": start, "endSeconds": samples / rate})
        frames.append(bytes(int(rate * 0.35) * 2))
        samples += int(rate * 0.35)
path = root / "meeting.wav"
with wave.open(str(path), "wb") as audio:
    audio.setparams((1, 2, rate, 0, "NONE", "not compressed"))
    audio.writeframes(b"".join(frames))
(root / "manifest.json").write_text(json.dumps({
    "provenance": "Local macOS say, Samantha/Kyoko/Yuna; synthetic speech, no user recordings",
    "durationSeconds": samples / rate, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    "turns": timeline,
}, ensure_ascii=False, indent=2) + "\n")
print(f"Generated {samples / rate:.2f}s, {len(turns)} alternating language turns")
