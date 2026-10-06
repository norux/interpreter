"""Continuous paced local-model evidence; no tabCapture, playback or browser Paint."""

import asyncio
import hashlib
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

from server.capture.pcm import AudioFrame
from server.sessions.contracts import Transcript
from server.sessions.local import (
    ASR_MODEL,
    TEXT_MODEL,
    LocalSession,
    MlxEngine,
    MlxTranscriber,
    OllamaTranslator,
)

CLIPS = [
    "The weather is sunny today.",
    "I saw a crane lifting steel beams at the construction site.",
    "We should not cancel the trip because the rain will stop before noon. "
    "Bring a blue umbrella, and meet at the station at three in the afternoon.",
]


class MeasuredEngine(MlxEngine):
    def transcribe(self, utterance, *args):
        started = time.monotonic()
        text = super().transcribe(utterance, *args)
        import mlx.core as mx

        self.calls.append(
            {
                "audioStartMs": utterance.start_ms,
                "audioEndMs": utterance.end_ms,
                "audioMs": len(utterance.frames) * 20,
                "inferenceMs": (time.monotonic() - started) * 1000,
                "mlxActiveBytes": mx.get_active_memory(),
                "mlxPeakBytes": mx.get_peak_memory(),
            }
        )
        return text


class MeasuredTranslator(OllamaTranslator):
    async def translate(self, transcript, context):
        started = time.monotonic()
        complete = False
        stream = super().translate(transcript, context)
        try:
            async for value in stream:
                complete = value.final
                yield value
        finally:
            await stream.aclose()
            self.calls.append(
                {
                    "utteranceId": transcript.utterance_id,
                    "sourceRevision": transcript.revision,
                    "sourceFinal": transcript.final,
                    "responseComplete": complete,
                    "requestMs": (time.monotonic() - started) * 1000,
                }
            )


def percentiles(values):
    values = sorted(values)
    return {
        "n": len(values),
        "p50Ms": values[math.ceil(len(values) * 0.5) - 1] if values else None,
        "p95Ms": values[math.ceil(len(values) * 0.95) - 1] if values else None,
    }


async def main():
    phase = sys.argv[1]
    assert phase in ("before", "after")
    trial_name = sys.argv[2] if len(sys.argv) > 2 else None
    assert trial_name in (None, "interval500", "interval1000")
    assert trial_name is None or phase == "after"
    Path(".ralph").mkdir(exist_ok=True)
    clips = []
    with tempfile.TemporaryDirectory(prefix="continuous-", dir=".ralph") as directory:
        for index, sentence in enumerate(CLIPS):
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
                assert (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) == (
                    24000,
                    1,
                    2,
                )
                clips.append(wav.readframes(wav.getnframes()))

    pcm = b""
    trials = []
    repetitions = 10
    for repetition in range(repetitions):
        for index, clip in enumerate(clips):
            voiced = [
                i
                for i, (sample,) in enumerate(struct.iter_unpack("<h", clip))
                if abs(sample) >= 100
            ]
            assert voiced
            offset = len(pcm) / 48
            trials.append(
                {
                    "clip": index,
                    "repetition": repetition,
                    "voiceStartMs": offset + voiced[0] / 24,
                    "voiceEndMs": offset + voiced[-1] / 24,
                    "captions": [],
                    "sourceCorrections": 0,
                }
            )
            # Fixed short pause, never wait for inference or subtitle expiry.
            pcm += clip + bytes(19200)
    pcm += bytes(96000)
    engine = MeasuredEngine()
    engine.calls = []
    translator = MeasuredTranslator(TEXT_MODEL, "English", "Korean")
    translator.calls = []
    transcriber = MlxTranscriber(engine, ASR_MODEL, "English", interim=phase == "after")
    if trial_name:
        transcriber.snapshot_frames = 25 if trial_name == "interval500" else 50
    session = LocalSession(f"continuous-{phase}", transcriber, translator)
    samples, frame_lags, errors = [], [], []
    sources = [[] for _ in trials]
    translations = [[] for _ in trials]
    previous = {}
    sampler = None
    try:
        started = time.monotonic()
        await session.prepare()
        # Identical warmup in both phases; cached weights, not a cold-cache claim.
        from server.sessions.local import Utterance

        warmup = Utterance(
            tuple(
                AudioFrame(
                    i,
                    i * 20,
                    24000,
                    clips[0][i * 960 : (i + 1) * 960].ljust(960, b"\0"),
                )
                for i in range(math.ceil(len(clips[0]) / 960))
            ),
            0,
            len(clips[0]) / 48,
        )
        text = await asyncio.get_running_loop().run_in_executor(
            engine.executor, engine.transcribe, warmup, ASR_MODEL, "English"
        )
        async for _ in translator.translate(
            Transcript("warmup", 1, text, True, 0, warmup.end_ms), []
        ):
            pass
        preparation_ms = (time.monotonic() - started) * 1000
        engine.calls.clear()
        translator.calls.clear()
        origin = time.monotonic()

        async def sample():
            while True:
                process = await asyncio.create_subprocess_exec(
                    "ps",
                    "-o",
                    "rss=",
                    "-p",
                    str(os.getpid()),
                    stdout=asyncio.subprocess.PIPE,
                )
                try:
                    output, _ = await process.communicate()
                finally:
                    await process.wait()
                assert process.returncode == 0
                samples.append(
                    {
                        "eventMs": (time.monotonic() - origin) * 1000,
                        "pendingAsrMs": transcriber.pending_audio_ms,
                        "pendingTranslationMs": session.pending_translation_ms,
                        "processRssBytes": int(output.strip()) * 1024,
                    }
                )
                await asyncio.sleep(0.1)

        sampler = asyncio.create_task(sample())

        async def frames():
            for sequence in range(math.ceil(len(pcm) / 960)):
                await asyncio.sleep(
                    max(0, origin + (sequence + 1) * 0.02 - time.monotonic())
                )
                frame_lags.append(
                    (time.monotonic() - origin - (sequence + 1) * 0.02) * 1000
                )
                yield AudioFrame(
                    sequence,
                    sequence * 20,
                    24000,
                    pcm[sequence * 960 : (sequence + 1) * 960].ljust(960, b"\0"),
                )

        async for event in session.run(frames()):
            if event.type == "error":
                print(event.message, flush=True)
                errors.append(event.type)
            if not event.caption:
                continue
            c = event.caption
            at = (time.monotonic() - origin) * 1000
            # End-of-voiced-audio assigns bounded VAD segments to their input clip.
            matching = [
                i
                for i, t in enumerate(trials)
                if t["voiceStartMs"] - 200 <= c.audio_end_ms <= t["voiceEndMs"] + 200
            ]
            assert len(matching) == 1, "Caption cannot be assigned to a fixture clip"
            index = matching[0]
            trial = trials[index]
            if c.utterance_id in previous and previous[c.utterance_id] != c.source:
                trial["sourceCorrections"] += 1
            previous[c.utterance_id] = c.source
            trial["captions"].append(
                {
                    "utteranceId": c.utterance_id,
                    "revision": c.revision,
                    "final": c.final,
                    "eventMs": at,
                    "audioStartMs": c.audio_start_ms,
                    "audioEndMs": c.audio_end_ms,
                    "audioPositionToEventMs": at - c.audio_end_ms,
                }
            )
            if c.final:
                sources[index].append(c.source)
                translations[index].append(c.translation)
                print(
                    json.dumps(
                        {
                            "review": [trial["repetition"], trial["clip"]],
                            "source": c.source,
                            "translation": c.translation,
                        },
                        ensure_ascii=False,
                    ),
                    flush=True,
                )
        elapsed_ms = (time.monotonic() - origin) * 1000
    finally:
        if sampler:
            sampler.cancel()
            try:
                await sampler
            except asyncio.CancelledError:
                pass
        await session.close()
        engine.close()

    for index, trial in enumerate(trials):
        source = " ".join(sources[index]).lower()
        translated = " ".join(translations[index])
        captions = trial["captions"]
        ids = {c["utteranceId"] for c in captions}
        checks = {
            "korean": any("가" <= c <= "힣" for c in translated),
            "allDisplayedCuesFinalize": bool(ids)
            and all(
                sum(c["final"] for c in captions if c["utteranceId"] == id_) == 1
                for id_ in ids
            ),
            "monotonicRevisions": all(
                (r := [c["revision"] for c in captions if c["utteranceId"] == id_])
                == sorted(set(r))
                for id_ in ids
            ),
        }
        if trial["clip"] == 0:
            checks.update(
                sourceDetails=all(t in source for t in ("sunny", "today")),
                todayMeaning="오늘" in translated,
                sunnyMeaning=any(t in translated for t in ("맑", "화창")),
            )
        elif trial["clip"] == 1:
            checks.update(
                sourceDetails=all(t in source for t in ("crane", "steel")),
                craneMeaning="크레인" in translated,
                steelMeaning=any(t in translated for t in ("철", "강철")),
            )
        else:
            checks.update(
                sourceDetails=all(
                    t in source
                    for t in (
                        "not cancel",
                        "before noon",
                        "blue umbrella",
                        "station",
                        "three",
                        "afternoon",
                    )
                ),
                negation="취소" in translated
                and (
                    any(t in translated for t in ("않", "없"))
                    or "취소하지 말" in translated
                ),
                beforeNoon=any(t in translated for t in ("정오", "12시"))
                and "전" in translated,
                blueUmbrella="우산" in translated
                and any(t in translated for t in ("파란", "파랑", "푸른")),
                station="역" in translated,
                afternoonThree="오후" in translated
                and any(t in translated for t in ("3시", "세 시")),
            )
        during = [
            c
            for c in captions
            if not c["final"]
            and trial["voiceStartMs"] < c["eventMs"] < trial["voiceEndMs"]
        ]
        trial["duringSpeechEvents"] = len(during)
        if phase == "after" and trial["clip"] != 0:
            checks.update(
                duringSpeech=bool(during),
                sourceCorrection=trial["sourceCorrections"] > 0,
            )
        trial["checks"] = checks
        trial["firstEventFromVoiceStartMs"] = (
            captions[0]["eventMs"] - trial["voiceStartMs"] if captions else None
        )
        finals = [c for c in captions if c["final"]]
        trial["lastFinalFromVoiceEndMs"] = (
            finals[-1]["eventMs"] - trial["voiceEndMs"] if finals else None
        )

    report = {
        "measurement": "continuous paced PCM to session event; not browser Paint",
        "phase": phase,
        "asrModel": ASR_MODEL,
        "textModel": TEXT_MODEL,
        "source": "English",
        "target": "Korean",
        "snapshotMs": transcriber.snapshot_frames * 20,
        "firstSnapshotMs": transcriber.first_snapshot_frames * 20,
        "snapshotsEnabled": phase == "after",
        "silenceMs": 300,
        "addedPauseMs": 400,
        "repetitions": repetitions,
        "speech": "macOS Samantha 165 wpm; no inference/expiry waits between clips",
        "coldWarm": "cached weights; identical ASR/text warmup excluded in both phases",
        "pcmSha256": hashlib.sha256(pcm).hexdigest(),
        "inputMs": len(pcm) / 48,
        "elapsedMs": elapsed_ms,
        "preparationAndWarmupMs": preparation_ms,
        "trials": trials,
        "asrCalls": engine.calls,
        "asrWorkerBusyMs": sum(c["inferenceMs"] for c in engine.calls),
        "mlxPeakIncludesWarmup": True,
        "translationCalls": translator.calls,
        "queueAndRssSamples": samples,
        "frameLagMs": percentiles(frame_lags),
        "maxFrameLagMs": max(frame_lags),
        "droppedUtterances": transcriber.dropped_utterances,
        "droppedTranslations": session.dropped_translations,
        "coalescedSnapshots": transcriber.coalesced_snapshots,
        "firstEventFromVoiceStartMs": percentiles(
            t["firstEventFromVoiceStartMs"]
            for t in trials
            if t["firstEventFromVoiceStartMs"] is not None
        ),
        "lastFinalFromVoiceEndMs": percentiles(
            t["lastFinalFromVoiceEndMs"]
            for t in trials
            if t["lastFinalFromVoiceEndMs"] is not None
        ),
        "checks": {
            "noSessionErrors": not errors,
            "noAsrDrops": transcriber.dropped_utterances == 0,
            "noTranslationDrops": session.dropped_translations == 0,
            "queuesBounded": bool(samples)
            and all(
                max(s["pendingAsrMs"], s["pendingTranslationMs"]) <= 8000
                for s in samples
            ),
            "queuesDrained": transcriber.pending_audio_ms
            == session.pending_translation_ms
            == 0,
            "pacedInput": len(frame_lags) == math.ceil(len(pcm) / 960)
            and max(frame_lags) < 100,
            "fixtureChecks": all(all(t["checks"].values()) for t in trials),
        },
    }
    if phase == "after":
        before = json.loads(Path(".ralph/interim-continuous-before.json").read_text())
        report["checks"]["identicalPcm"] = report["pcmSha256"] == before["pcmSha256"]
        report["checks"]["firstEventImproves"] = all(
            report["firstEventFromVoiceStartMs"][p] is not None
            and report["firstEventFromVoiceStartMs"][p]
            < before["firstEventFromVoiceStartMs"][p]
            for p in ("p50Ms", "p95Ms")
        )
    report["acceptancePassed"] = all(report["checks"].values())
    suffix = "" if report["acceptancePassed"] else "-failed"
    Path("docs/verification/interim").mkdir(parents=True, exist_ok=True)
    name = f"continuous-{phase}" + (f"-{trial_name}" if trial_name else "")
    Path(f"docs/verification/interim/{name}{suffix}.json").write_text(
        json.dumps(report, indent=2) + "\n"
    )
    if phase == "before":
        Path(".ralph/interim-continuous-before.json").write_text(json.dumps(report))
    print(
        json.dumps(
            {
                "phase": phase,
                "checks": report["checks"],
                "firstEventFromVoiceStartMs": report["firstEventFromVoiceStartMs"],
                "lastFinalFromVoiceEndMs": report["lastFinalFromVoiceEndMs"],
            }
        ),
        flush=True,
    )
    assert report["acceptancePassed"], (
        "Continuous model checks failed; numeric evidence preserved"
    )


asyncio.run(main())
