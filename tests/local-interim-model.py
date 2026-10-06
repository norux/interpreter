"""Paced real-model snapshot probe. This is not tabCapture or browser Paint evidence."""

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
    "I saw a crane lifting steel beams at the construction site.",
]


class MeasuredEngine(MlxEngine):
    def transcribe(self, utterance, model_id, language):
        start = time.monotonic()
        result = super().transcribe(utterance, model_id, language)
        self.calls.append(
            {
                "audioStartMs": utterance.start_ms,
                "audioEndMs": utterance.end_ms,
                "audioMs": len(utterance.frames) * 20,
                "inferenceMs": (time.monotonic() - start) * 1000,
            }
        )
        return result


class MeasuredTranslator(OllamaTranslator):
    async def translate(self, transcript, context):
        start = time.monotonic()
        complete = False
        try:
            async for value in super().translate(transcript, context):
                complete = value.final
                yield value
        finally:
            self.calls.append(
                {
                    "sourceRevision": transcript.revision,
                    "sourceFinal": transcript.final,
                    "responseComplete": complete,
                    "requestMs": (time.monotonic() - start) * 1000,
                }
            )


async def main():
    phase = sys.argv[1]
    assert phase in ("before", "after")
    Path(".ralph").mkdir(exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(
        prefix="interim-model-", dir=".ralph"
    ) as directory:
        clips = []
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
            wav_bytes = Path(f"{path}.wav").read_bytes()
            with wave.open(f"{path}.wav") as wav:
                pcm = wav.readframes(wav.getnframes())
            nonzero = [
                i
                for i, sample in enumerate(struct.iter_unpack("<h", pcm))
                if abs(sample[0]) >= 100
            ]
            assert nonzero
            clips.append(
                (
                    pcm,
                    hashlib.sha256(wav_bytes).hexdigest(),
                    nonzero[0] / 24,
                    nonzero[-1] / 24,
                )
            )

        async with httpx.AsyncClient(trust_env=False) as client:
            response = await client.post(
                "http://127.0.0.1:11434/api/generate",
                json={"model": TEXT_MODEL, "keep_alive": 0},
            )
            response.raise_for_status()
        engine = MeasuredEngine()
        try:
            for repetition in range(3):
                for index, (pcm, wav_hash, voice_start, voice_end) in enumerate(clips):
                    engine.calls = []
                    translator = MeasuredTranslator(TEXT_MODEL, "English", "Korean")
                    translator.calls = []
                    transcriber = MlxTranscriber(
                        engine, ASR_MODEL, "English", interim=phase == "after"
                    )
                    session = LocalSession(
                        f"{phase}-{repetition}-{index}", transcriber, translator
                    )
                    await session.prepare()
                    origin = time.monotonic()
                    pending = []
                    rss = []

                    async def frames():
                        for sequence in range(math.ceil(len(pcm) / 960) + 50):
                            await asyncio.sleep(
                                max(
                                    0, origin + (sequence + 1) * 0.02 - time.monotonic()
                                )
                            )
                            if sequence % 50 == 0:
                                pending.append(
                                    (
                                        transcriber.pending_audio_ms,
                                        session.pending_translation_ms,
                                    )
                                )
                                rss.append(
                                    int(
                                        subprocess.check_output(
                                            [
                                                "ps",
                                                "-o",
                                                "rss=",
                                                "-p",
                                                str(os.getpid()),
                                            ],
                                            text=True,
                                        ).strip()
                                    )
                                    * 1024
                                )
                            yield AudioFrame(
                                sequence,
                                sequence * 20,
                                24000,
                                pcm[sequence * 960 : (sequence + 1) * 960].ljust(
                                    960, b"\0"
                                ),
                            )

                    captions = []
                    review = []
                    previous_source = {}
                    corrections = 0
                    async for event in session.run(frames()):
                        assert event.type != "error", event.message
                        if event.caption:
                            c = event.caption
                            at = (time.monotonic() - origin) * 1000
                            if c.utterance_id in previous_source and (
                                previous_source[c.utterance_id] != c.source
                            ):
                                corrections += 1
                            previous_source[c.utterance_id] = c.source
                            captions.append(
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
                            review.append((c.source, c.translation, c.final))
                    finals = [c for c in captions if c["final"]]
                    assert finals
                    for utterance_id in {c["utteranceId"] for c in captions}:
                        revisions = [
                            c["revision"]
                            for c in captions
                            if c["utteranceId"] == utterance_id
                        ]
                        assert revisions == sorted(set(revisions))
                    print(
                        json.dumps(
                            {
                                "phase": phase,
                                "repetition": repetition,
                                "clip": index,
                                "review": review,
                            },
                            ensure_ascii=False,
                        ),
                        flush=True,
                    )
                    during = [
                        c
                        for c in captions
                        if not c["final"] and c["eventMs"] < voice_end
                    ]
                    print(
                        json.dumps(
                            {
                                "observationOnly": True,
                                "phase": phase,
                                "repetition": repetition,
                                "clip": index,
                                "voiceStartMs": voice_start,
                                "voiceEndMs": voice_end,
                                "firstEventFromVoiceStartMs": captions[0]["eventMs"]
                                - voice_start,
                                "lastFinalFromVoiceEndMs": finals[-1]["eventMs"]
                                - voice_end,
                                "sourceCorrections": corrections,
                                "duringSpeechEvents": len(during),
                                "asrCalls": len(engine.calls),
                            "translationCalls": len(translator.calls),
                            "asrTimingsMs": [c["inferenceMs"] for c in engine.calls],
                            "translationTimingsMs": [
                                c["requestMs"] for c in translator.calls
                            ],
                            "maxPendingAsrMs": max(p[0] for p in pending),
                            "maxPendingTranslationMs": max(p[1] for p in pending),
                            "sampledRssPeakBytes": max(rss),
                                "coalescedSnapshots": transcriber.coalesced_snapshots,
                                "droppedUtterances": transcriber.dropped_utterances,
                                "droppedTranslations": session.dropped_translations,
                            }
                        ),
                        flush=True,
                    )
                    final_text = " ".join(t for _, t, final in review if final)
                    assert any("가" <= char <= "힣" for char in final_text)
                    if index == 0:
                        assert "오늘" in final_text
                        assert "맑" in final_text or "화창" in final_text
                    else:
                        assert "크레인" in final_text
                        assert "철" in final_text or "강철" in final_text
                    if phase == "after" and index == 1:
                        assert during, "Long speech must produce Korean before it ends"
                        assert corrections, "Continuing source must revise the same cue"
                    assert (
                        transcriber.dropped_utterances
                        == session.dropped_translations
                        == 0
                    )
                    import mlx.core as mx

                    results.append(
                        {
                            "clip": index,
                            "repetition": repetition,
                            "firstInference": repetition == index == 0,
                            "wavSha256": wav_hash,
                            "voiceStartMs": voice_start,
                            "voiceEndMs": voice_end,
                            "captions": captions,
                            "sourceCorrections": corrections,
                            "duringSpeechEvents": len(during),
                            "asrCalls": engine.calls,
                            "translationCalls": translator.calls,
                            "firstEventFromVoiceStartMs": captions[0]["eventMs"]
                            - voice_start,
                            "lastFinalFromVoiceEndMs": finals[-1]["eventMs"]
                            - voice_end,
                            "maxPendingAsrMs": max(p[0] for p in pending),
                            "maxPendingTranslationMs": max(p[1] for p in pending),
                            "coalescedSnapshots": transcriber.coalesced_snapshots,
                            "droppedUtterances": transcriber.dropped_utterances,
                            "droppedTranslations": session.dropped_translations,
                            "sampledRssPeakBytes": max(rss),
                            "mlxActiveBytes": mx.get_active_memory(),
                            "mlxPeakBytes": mx.get_peak_memory(),
                        }
                    )
        finally:
            engine.close()
    report = {
        "phase": phase,
        "realLocalModels": True,
        "tabCapture": False,
        "browserPaint": False,
        "prepared": True,
        "asrModel": ASR_MODEL,
        "textModel": TEXT_MODEL,
        "source": "English",
        "target": "Korean",
        "snapshotVoicedMs": 1000,
        "results": results,
    }
    for index in range(len(SENTENCES)):
        samples = [r for r in results if r["clip"] == index and not r["firstInference"]]
        for field in ("firstEventFromVoiceStartMs", "lastFinalFromVoiceEndMs"):
            values = sorted(r[field] for r in samples)
            report[f"clip{index}.{field}"] = {
                "n": len(values),
                "p50Ms": values[math.ceil(len(values) * 0.5) - 1],
                "p95Ms": values[math.ceil(len(values) * 0.95) - 1],
            }
    directory = Path("docs/verification/interim")
    directory.mkdir(exist_ok=True)
    (directory / f"model-{phase}.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k != "results"}), flush=True)


asyncio.run(main())
