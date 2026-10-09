"""Generate a non-looping two-speaker fixture using installed macOS voices."""
import json
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

root = Path(__file__).resolve().parent
japanese = "--japanese" in sys.argv
if japanese:
    root = root / "ja"
turns = json.loads((root / "script.json").read_text())
frames = []
timeline = []
rate = 24000
samples = 0
with tempfile.TemporaryDirectory() as scratch:
    for index, turn in enumerate(turns):
        path = Path(scratch) / f"{index}.wav"
        voice = ("Kyoko" if turn["speaker"] == "A" else "com.apple.eloquence.ja-JP.Reed") if japanese else ("Samantha" if turn["speaker"] == "A" else "Daniel")
        subprocess.run(["/usr/bin/say", "-v", voice, "-r", "180", "--file-format=WAVE",
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
with wave.open(str(root / "conversation.wav"), "wb") as audio:
    audio.setparams((1, 2, rate, 0, "NONE", "not compressed"))
    audio.writeframes(b"".join(frames))
assert 50 <= samples / rate <= (90 if japanese else 75), samples / rate
(root / "manifest.json").write_text(json.dumps({"provenance": f"Local macOS say, {'Kyoko and Reed (Japanese)' if japanese else 'Samantha and Daniel'}; synthetic speech, no user recording",
                                               "durationSeconds": samples / rate, "turns": timeline}, indent=2) + "\n")
print(f"Generated {samples / rate:.2f}s, {len(turns)} distinct conversational turns")

def timestamp(seconds):
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3600000)
    minutes, milliseconds = divmod(milliseconds, 60000)
    seconds, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02}:{minutes:02}:{seconds:02}.{milliseconds:03}"

(root / "conversation.vtt").write_text("WEBVTT\n\n" + "\n\n".join(
    f"{timestamp(turn['startSeconds'])} --> {timestamp(turn['endSeconds'])}\n{turn['text']}"
    for turn in timeline) + "\n")
