"""Real-model pause-boundary/meaning regression; session events, not browser paint."""

import asyncio
import hashlib
import json
import math
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

from server.capture.pcm import AudioFrame
from server.sessions.local import (
    ASR_MODEL,
    TEXT_MODEL,
    LocalSession,
    MlxEngine,
    MlxTranscriber,
    OllamaTranslator,
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


async def measure(engine, pcm, clip, repetition):
    session = LocalSession(
        f"boundary-{clip}-{repetition}",
        MlxTranscriber(engine, ASR_MODEL, "English"),
        OllamaTranslator(TEXT_MODEL, "English", "Korean"),
    )
    await session.prepare()
    origin = time.monotonic()
    queue_peak = 0
    cues = {}
    sources, translations = [], []

    async def frames():
        nonlocal queue_peak
        for sequence in range(math.ceil(len(pcm) / 960) + 50):
            await asyncio.sleep(
                max(0, origin + (sequence + 1) * 0.02 - time.monotonic())
            )
            yield AudioFrame(
                sequence, sequence * 20, 24000,
                pcm[sequence * 960 : (sequence + 1) * 960].ljust(960, b"\0"),
            )
            queue_peak = max(queue_peak, session.transcriber.pending_audio_ms)

    try:
        async for event in session.run(frames()):
            assert event.type != "error", event.message
            if not event.caption:
                continue
            caption = event.caption
            latency = (time.monotonic() - origin) * 1000 - caption.audio_end_ms
            cue = cues.setdefault(caption.utterance_id, {
                "firstEventMs": round(latency, 3),
                "audioStartMs": caption.audio_start_ms,
                "audioEndMs": caption.audio_end_ms,
                "revisions": [],
            })
            cue["revisions"].append(caption.revision)
            if caption.final:
                assert "finalEventMs" not in cue
                cue["finalEventMs"] = round(latency, 3)
                sources.append(caption.source)
                translations.append(caption.translation)
                # Generated fixture text is reviewed in terminal only, never saved.
                print(json.dumps({
                    "review": [clip, repetition], "source": caption.source,
                    "translation": caption.translation,
                }, ensure_ascii=False), flush=True)
        assert cues
        for cue in cues.values():
            assert "finalEventMs" in cue
            assert cue["revisions"] == sorted(set(cue["revisions"]))
            cue["revisions"] = len(cue["revisions"])
        source, translated = " ".join(sources).lower(), " ".join(translations)
        expected_source = [
            ["weather", "sunny", "today"],
            ["walk", "park", "after lunch"],
            ["not cancel", "trip", "rain", "before noon", "blue umbrella",
             "station", "three", "afternoon"],
        ][clip]
        checks = {
            "sourceDetails": all(term in source for term in expected_source),
            "koreanOnly": any("가" <= c <= "힣" for c in translated)
            and not any("\u3040" <= c <= "\u30ff" for c in translated),
        }
        if clip == 2:
            checks.update(
                negation="취소" in translated
                and any(t in translated for t in ("없", "않")),
                reason="비" in translated
                and any(t in translated for t in ("때문", "라서", "므로", "니")),
                beforeNoon=any(t in translated for t in ("정오", "12시"))
                and "전" in translated,
                blueUmbrella="우산" in translated
                and any(t in translated for t in ("파란", "파랑", "푸른")),
                station="역" in translated,
                afternoonThree="오후" in translated
                and any(t in translated for t in ("3시", "세 시")),
            )
        return {
            "clip": clip, "repetition": repetition, "queuePeakMs": queue_peak,
            "droppedUtterances": session.transcriber.dropped_utterances,
            "pendingAudioMsAtEnd": session.transcriber.pending_audio_ms,
            "qualityChecks": checks, "cues": list(cues.values()),
        }
    finally:
        await session.close()


async def main():
    phase = sys.argv[1]
    assert phase in ("before", "after")
    samples, digests = [], []
    Path(".ralph").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="boundary-", dir=".ralph") as directory:
        clips = []
        for index, parts in enumerate(CLIPS):
            chunks = []
            for part, sentence in enumerate(parts):
                path = Path(directory) / f"{index}-{part}"
                subprocess.run([
                    "say", "-v", "Samantha", "-r", "165",
                    "-o", f"{path}.aiff", sentence,
                ], check=True)
                subprocess.run([
                    "afconvert", "-f", "WAVE", "-d", "LEI16@24000", "-c", "1",
                    f"{path}.aiff", f"{path}.wav",
                ], check=True)
                with wave.open(f"{path}.wav") as wav:
                    chunks.append(wav.readframes(wav.getnframes()))
            pcm = bytes(11520).join(chunks)
            clips.append(pcm)
            digests.append(hashlib.sha256(pcm).hexdigest())
        engine = MlxEngine()
        try:
            started = time.monotonic()
            warmup = await measure(engine, clips[0], 0, -1)
            warmup_elapsed = round((time.monotonic() - started) * 1000, 3)
            for repetition in range(3):
                for clip, pcm in enumerate(clips):
                    samples.append(await measure(engine, pcm, clip, repetition))
        finally:
            engine.close()
    report = {
        "measurement": "paced PCM audio-end to session event; not browser paint",
        "phase": phase, "asrModel": ASR_MODEL, "textModel": TEXT_MODEL,
        "source": "English", "target": "Korean", "silenceMs": 300,
        "speech": "macOS Samantha 165 wpm; clip 2 has added 240 ms pause",
        "pcmSha256": digests, "warmup": warmup,
        "warmupIncludingPreparationMs": warmup_elapsed,
        "coldComparison": "none; cached weights, first inference excluded from warm",
        "samples": samples,
    }
    for field in ("firstEventMs", "finalEventMs"):
        values = sorted(c[field] for s in samples for c in s["cues"])
        report[field] = {
            "n": len(values), "p50Ms": values[math.ceil(len(values) * 0.5) - 1],
            "p95Ms": values[math.ceil(len(values) * 0.95) - 1],
        }
    destination = Path(f"docs/verification/latency/boundary-{phase}.json")
    destination.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({
        "phase": phase, "firstEventMs": report["firstEventMs"],
        "finalEventMs": report["finalEventMs"],
        "qualityPassedRuns": sum(all(s["qualityChecks"].values()) for s in samples),
        "runs": len(samples),
    }), flush=True)
    if phase == "after":
        before = json.loads(
            Path("docs/verification/latency/boundary-before.json").read_text()
        )
        assert report["pcmSha256"] == before["pcmSha256"]
        assert all(all(s["qualityChecks"].values()) for s in samples)
    assert all(s["queuePeakMs"] <= 8000 for s in samples)
    assert all(s["droppedUtterances"] == 0 for s in samples)
    assert all(s["pendingAudioMsAtEnd"] == 0 for s in samples)


asyncio.run(main())
