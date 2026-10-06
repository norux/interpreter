"""Optional real-model smoke on generated speech; this does not exercise tabCapture."""

import asyncio
import json
import subprocess
import tempfile
import time
import wave
from pathlib import Path

from server.capture.pcm import AudioFrame
from server.sessions.local import MlxEngine, Utterance, local_session


async def main():
    Path(".ralph").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="local-model-", dir=".ralph") as directory:
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
            pcm = audio.readframes(audio.getnframes())

        async def frames():
            for sequence in range((len(pcm) + 959) // 960 + 50):
                yield AudioFrame(
                    sequence,
                    sequence * 20,
                    24000,
                    pcm[sequence * 960 : (sequence + 1) * 960].ljust(960, b"\0"),
                )
                await asyncio.sleep(0)

        engine = MlxEngine()
        start = time.monotonic()
        captions = []
        try:
            async for event in local_session("generated-smoke", engine).run(frames()):
                assert event.type != "error", event.message
                if event.caption:
                    if event.caption.final:
                        captions.append(event.caption)
                    print(
                        json.dumps(
                            {
                                "realModels": True,
                                "tabCapture": "not exercised",
                                "source": event.caption.source,
                                "translation": event.caption.translation,
                                "audioStartMs": event.caption.audio_start_ms,
                                "audioEndMs": event.caption.audio_end_ms,
                                "elapsedSeconds": round(time.monotonic() - start, 3),
                            },
                            ensure_ascii=False,
                        ),
                        flush=True,
                    )
            assert len(captions) == 1
            assert any("가" <= char <= "힣" for char in captions[0].translation)
            try:
                await asyncio.get_running_loop().run_in_executor(
                    engine.executor,
                    engine.transcribe,
                    Utterance((AudioFrame(0, 0, 24000, bytes(960)),), 0, 20),
                    "mlx-community/Interpreter-missing-test-model",
                    "English",
                )
            except RuntimeError as error:
                assert "README model download" in str(error)
                print("Actual missing model guidance:", str(error), flush=True)
            else:
                raise AssertionError("Missing ASR model was not rejected")
        finally:
            engine.close()


asyncio.run(main())
