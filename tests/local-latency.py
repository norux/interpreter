"""Real paced generated PCM/model timing; deliberately not browser paint timing."""

import asyncio
import json
import math
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

import httpx

from server.capture.pcm import AudioFrame
from server.sessions.local import (
    ASR_MODEL,
    TEXT_MODEL,
    LocalSession,
    MlxEngine,
    MlxTranscriber,
    OllamaTranslator,
)

SENTENCES = [
    "The weather is sunny today.",
    "We will walk to the park after lunch.",
]


class MeasuredEngine(MlxEngine):
    def transcribe(self, utterance, model_id, language):
        self.started = time.monotonic()
        self.boundary_ms = self.started - self.origin - utterance.end_ms / 1000
        text = super().transcribe(utterance, model_id, language)
        self.asr_ms = (time.monotonic() - self.started) * 1000
        return text


async def main():
    label, destination = sys.argv[1:]
    assert label in ("before", "after")
    assert Path(destination).parent == Path("docs/verification/latency")
    Path(".ralph").mkdir(exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix="latency-", dir=".ralph") as directory:
        audio = []
        for index, sentence in enumerate(SENTENCES):
            path = Path(directory) / str(index)
            subprocess.run(
                ["say", "-v", "Samantha", "-r", "165", "-o", f"{path}.aiff", sentence],
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
                    f"{path}.aiff",
                    f"{path}.wav",
                ],
                check=True,
            )
            with wave.open(f"{path}.wav") as wav:
                audio.append(wav.readframes(wav.getnframes()))

        # Unload only the selected local test model, so the first call includes load.
        async with httpx.AsyncClient(trust_env=False) as client:
            response = await client.post(
                "http://127.0.0.1:11434/api/generate",
                json={"model": "qwen3:4b-instruct", "keep_alive": 0},
            )
            response.raise_for_status()
        engine = MeasuredEngine()
        try:
            for repetition in range(4):
                for index, pcm in enumerate(audio):
                    session = LocalSession(
                        f"{label}-{repetition}-{index}",
                        MlxTranscriber(engine, ASR_MODEL, "English"),
                        OllamaTranslator(TEXT_MODEL, "English", "Korean"),
                    )
                    engine.origin = time.monotonic()

                    async def frames():
                        for sequence in range(math.ceil(len(pcm) / 960) + 50):
                            await asyncio.sleep(
                                max(
                                    0,
                                    engine.origin
                                    + (sequence + 1) * 0.02
                                    - time.monotonic(),
                                )
                            )
                            yield AudioFrame(
                                sequence,
                                sequence * 20,
                                24000,
                                pcm[sequence * 960 : (sequence + 1) * 960].ljust(
                                    960, b"\0"
                                ),
                            )

                    first = None
                    final = None
                    revisions = []
                    async for event in session.run(frames()):
                        assert event.type != "error", event.message
                        if event.caption:
                            now = time.monotonic()
                            caption = event.caption
                            latency = (
                                now - engine.origin
                            ) * 1000 - caption.audio_end_ms
                            first = latency if first is None else first
                            revisions.append(caption.revision)
                            if caption.final:
                                assert final is None, "Expected one finalized utterance"
                                final = latency
                                assert any(
                                    "가" <= c <= "힣" for c in caption.translation
                                )
                                print(
                                    json.dumps(
                                        {
                                            "review": index,
                                            "source": caption.source,
                                            "translation": caption.translation,
                                        },
                                        ensure_ascii=False,
                                    ),
                                    flush=True,
                                )
                    assert final is not None
                    assert revisions == sorted(set(revisions))
                    results.append(
                        {
                            "temperature": "cold"
                            if repetition == index == 0
                            else "warm",
                            "sentence": index,
                            "firstEventMs": round(first, 3),
                            "finalEventMs": round(final, 3),
                            "vadAndSchedulingMs": round(engine.boundary_ms * 1000, 3),
                            "asrMs": round(engine.asr_ms, 3),
                            "translationToFirstMs": round(
                                first - engine.boundary_ms * 1000 - engine.asr_ms, 3
                            ),
                            "revisions": len(revisions),
                            "droppedUtterances": session.transcriber.dropped_utterances,
                            "pendingAudioMsAtEnd": session.transcriber.pending_audio_ms,
                        }
                    )
                    print(json.dumps(results[-1]), flush=True)
        finally:
            engine.close()

    def percentiles(field, temperature):
        values = sorted(r[field] for r in results if r["temperature"] == temperature)
        return {
            "n": len(values),
            "p50Ms": values[math.ceil(len(values) * 0.5) - 1],
            "p95Ms": values[math.ceil(len(values) * 0.95) - 1],
        }

    report = {
        "label": label,
        "asrModel": ASR_MODEL,
        "textModel": "qwen3:4b-instruct",
        "source": "English",
        "target": "Korean",
        "speech": "macOS Samantha 165 wpm",
        "measurement": "paced PCM audio-end to session event; browser not exercised",
        "cold": {
            field: percentiles(field, "cold")
            for field in ("firstEventMs", "finalEventMs")
        },
        "warm": {
            field: percentiles(field, "warm")
            for field in ("firstEventMs", "finalEventMs")
        },
        "samples": results,
    }
    Path(destination).parent.mkdir(parents=True, exist_ok=True)
    Path(destination).write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"summary": report["warm"]}), flush=True)


asyncio.run(main())
