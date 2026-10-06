"""Compare local VAD candidates on identical generated PCM, not browser paint."""

import asyncio
import json
import math
import subprocess
import tempfile
import time
import wave
from pathlib import Path
from unittest.mock import patch

from server.capture.pcm import AudioFrame
from server.sessions.local import (
    ASR_MODEL,
    TEXT_MODEL,
    LocalSession,
    MlxEngine,
    MlxTranscriber,
    OllamaTranslator,
    SpeechSegments,
)

CLIPS = [
    ["The weather is sunny today."],
    ["We will walk to the park after lunch."],
    [
        "We should not cancel the trip",
        "because the rain will stop before noon. Bring a blue umbrella, "
        "and meet at the station at three in the afternoon.",
    ],
]


class MeasuredEngine(MlxEngine):
    def transcribe(self, utterance, *args):
        started = time.monotonic()
        result = super().transcribe(utterance, *args)
        self.timings[utterance.end_ms] = {
            "vadAndSchedulingMs": round(
                (started - self.origin) * 1000 - utterance.end_ms, 3
            ),
            "asrMs": round((time.monotonic() - started) * 1000, 3),
        }
        return result


async def measure(engine, pcm, silence_ms, clip, repetition):
    session = LocalSession(
        f"vad-{silence_ms}-{clip}-{repetition}",
        MlxTranscriber(engine, ASR_MODEL, "English"),
        OllamaTranslator(TEXT_MODEL, "English", "Korean"),
    )
    await session.prepare()
    engine.timings = {}
    engine.origin = time.monotonic()
    queue_peak = 0
    cues = {}

    async def frames():
        nonlocal queue_peak
        for sequence in range(math.ceil(len(pcm) / 960) + 50):
            await asyncio.sleep(
                max(0, engine.origin + (sequence + 1) * 0.02 - time.monotonic())
            )
            yield AudioFrame(
                sequence,
                sequence * 20,
                24000,
                pcm[sequence * 960 : (sequence + 1) * 960].ljust(960, b"\0"),
            )
            queue_peak = max(queue_peak, session.transcriber.pending_audio_ms)

    try:
        with patch.object(SpeechSegments, "silence_frames", silence_ms // 20):
            async for event in session.run(frames()):
                assert event.type != "error", event.message
                if not event.caption:
                    continue
                caption = event.caption
                latency = (time.monotonic() - engine.origin) * 1000
                latency -= caption.audio_end_ms
                cue = cues.setdefault(
                    caption.utterance_id,
                    {
                        "firstEventMs": round(latency, 3),
                        "audioStartMs": caption.audio_start_ms,
                        "audioEndMs": caption.audio_end_ms,
                        "revisions": [],
                    },
                )
                cue["revisions"].append(caption.revision)
                if caption.final:
                    assert "finalEventMs" not in cue
                    cue["finalEventMs"] = round(latency, 3)
                    cue.update(engine.timings[caption.audio_end_ms])
                    for event_name in ("first", "final"):
                        cue[f"translationTo{event_name.title()}Ms"] = round(
                            cue[f"{event_name}EventMs"]
                            - cue["vadAndSchedulingMs"] - cue["asrMs"], 3
                        )
                    assert any("가" <= c <= "힣" for c in caption.translation)
                    # Generated fixture text is for terminal review only, never saved.
                    print(json.dumps({
                        "review": [silence_ms, clip, repetition],
                        "source": caption.source,
                        "translation": caption.translation,
                    }, ensure_ascii=False), flush=True)
        assert cues, "Generated speech produced no final cue"
        for cue in cues.values():
            assert "finalEventMs" in cue
            assert cue["revisions"] == sorted(set(cue["revisions"]))
            cue["revisions"] = len(cue["revisions"])
        return {
            "silenceMs": silence_ms,
            "clip": clip,
            "repetition": repetition,
            "queuePeakMs": queue_peak,
            "droppedUtterances": session.transcriber.dropped_utterances,
            "pendingAudioMsAtEnd": session.transcriber.pending_audio_ms,
            "cues": list(cues.values()),
        }
    finally:
        await session.close()


async def main():
    Path(".ralph").mkdir(exist_ok=True)
    samples = []
    with tempfile.TemporaryDirectory(prefix="vad-", dir=".ralph") as directory:
        clips = []
        for index, parts in enumerate(CLIPS):
            pcm = []
            for part, sentence in enumerate(parts):
                path = Path(directory) / f"{index}-{part}"
                subprocess.run([
                    "say", "-v", "Samantha", "-r", "165",
                    "-o", f"{path}.aiff", sentence,
                ], check=True)
                subprocess.run([
                    "afconvert", "-f", "WAVE", "-d", "LEI16@24000",
                    "-c", "1", f"{path}.aiff", f"{path}.wav",
                ], check=True)
                with wave.open(f"{path}.wav") as wav:
                    pcm.append(wav.readframes(wav.getnframes()))
            # A deliberate 240 ms pause tests splitting a dependent clause.
            clips.append(bytes(11520).join(pcm))
        engine = MeasuredEngine()
        try:
            started = time.monotonic()
            warmup = await measure(engine, clips[0], 500, 0, -1)
            warmup_elapsed = round((time.monotonic() - started) * 1000, 3)
            # Rotate candidate order to reduce systematic cache/order bias.
            candidates = [500, 300, 260]
            for repetition in range(3):
                order = candidates[repetition:] + candidates[:repetition]
                for clip, pcm in enumerate(clips):
                    for silence_ms in order:
                        sample = await measure(
                            engine, pcm, silence_ms, clip, repetition
                        )
                        samples.append(sample)
                        print(json.dumps(sample), flush=True)
        finally:
            engine.close()

    def percentiles(candidate, field):
        values = sorted(
            cue[field] for sample in samples
            if sample["silenceMs"] == candidate for cue in sample["cues"]
        )
        return {
            "n": len(values),
            "p50Ms": values[math.ceil(len(values) * 0.5) - 1],
            "p95Ms": values[math.ceil(len(values) * 0.95) - 1],
        }

    report = {
        "measurement": "paced PCM audio-end to session event; not browser paint",
        "speech": "macOS Samantha 165 wpm; clip 2 has added 240 ms pause",
        "asrModel": ASR_MODEL,
        "textModel": TEXT_MODEL,
        "source": "English",
        "target": "Korean",
        "warmup": warmup,
        "warmupIncludingPreparationMs": warmup_elapsed,
        "coldComparison": "none; one shared prepared engine, caches not cleared",
        "warm": {
            str(candidate): {
                field: percentiles(candidate, field)
                for field in ("firstEventMs", "finalEventMs", "vadAndSchedulingMs")
            } for candidate in candidates
        },
        "samples": samples,
    }
    destination = Path("docs/verification/latency/vad-events.json")
    destination.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"summary": report["warm"]}), flush=True)


asyncio.run(main())
