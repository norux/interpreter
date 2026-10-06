"""Explicit paid smoke on generated speech; never part of verify or tabCapture."""

import asyncio
import json
import os
import subprocess
import tempfile
import wave
from pathlib import Path

from server.capture.pcm import AudioFrame
from server.sessions.direct import DirectSession


async def main():
    key = os.environ.get("OPENAI_API_KEY", "")
    if not key:
        raise SystemExit("Live smoke unavailable: OPENAI_API_KEY is not exported.")
    Path(".ralph").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="direct-live-", dir=".ralph") as directory:
        path = Path(directory)
        subprocess.run(
            [
                "say",
                "-v",
                "Samantha",
                "-r",
                "165",
                "-o",
                str(path / "speech.aiff"),
                "The weather is sunny today. We will walk to the park after lunch.",
            ],
            check=True,
        )
        subprocess.run(
            [
                "afconvert",
                "-f",
                "WAVE",
                "-d",
                "LEI16@24000",
                "-c",
                "1",
                str(path / "speech.aiff"),
                str(path / "speech.wav"),
            ],
            check=True,
        )
        with wave.open(str(path / "speech.wav")) as audio:
            assert (
                audio.getframerate(),
                audio.getnchannels(),
                audio.getsampwidth(),
            ) == (
                24000,
                1,
                2,
            )
            pcm = audio.readframes(audio.getnframes())

        async def frames():
            for sequence in range((len(pcm) + 959) // 960 + 50):
                yield AudioFrame(
                    sequence,
                    sequence * 20,
                    24000,
                    pcm[sequence * 960 : (sequence + 1) * 960].ljust(960, b"\0"),
                )
                await asyncio.sleep(0.02)

        session = DirectSession("generated-direct-smoke", key, "ko")
        captions = []
        try:
            async with asyncio.timeout(60):
                async for event in session.run(frames()):
                    if event.type == "error":
                        raise SystemExit(f"Live smoke failed: {event.message}")
                    if event.caption and event.caption.final:
                        captions.append(event.caption.translation)
        finally:
            await session.close()
        assert captions, "No final translated captions received"
        assert any("가" <= c <= "힣" for text in captions for c in text)
        print(
            json.dumps(
                {
                    "liveOpenAI": True,
                    "tabCapture": "not exercised",
                    "translation": "".join(captions),
                    "meaningReview": "required; Hangul alone does not verify accuracy",
                },
                ensure_ascii=False,
            )
        )


asyncio.run(main())
