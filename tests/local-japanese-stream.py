"""Paced generated Japanese through the real VAD/interim ASR path, without Chrome."""

import argparse
import asyncio
import hashlib
import json
import subprocess
import tempfile
import time
import wave
from pathlib import Path

from server.capture.pcm import AudioFrame
from server.sessions.local import ASR_MODEL, MlxEngine, MlxTranscriber

SPEECH = (
    "旅行は中止しません。雨は正午前にやみます。"
    "青い傘を持って午後三時に駅で会いましょう。資料は明日送る予定です。"
)


async def verify(model, report_path):
    with tempfile.TemporaryDirectory(prefix="interpreter-ja-stream-") as temporary:
        path = Path(temporary)
        subprocess.run(
            [
                "say",
                "-v",
                "Kyoko",
                "-r",
                "165",
                "-o",
                str(path / "speech.aiff"),
                SPEECH,
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
        engine = MlxEngine()
        transcriber = MlxTranscriber(engine, model, "Japanese", interim=True)
        finals, samples = [], []
        queue_peak = 0
        try:
            await transcriber.prepare()
            started = time.monotonic()

            async def frames():
                nonlocal queue_peak
                for sequence in range((len(pcm) + 959) // 960 + 50):
                    await asyncio.sleep(
                        max(0, started + (sequence + 1) * 0.02 - time.monotonic())
                    )
                    yield AudioFrame(
                        sequence,
                        sequence * 20,
                        24000,
                        pcm[sequence * 960 : (sequence + 1) * 960].ljust(960, b"\0"),
                    )
                    queue_peak = max(queue_peak, transcriber.pending_audio_ms)

            async for transcript in transcriber.transcribe(frames()):
                samples.append(
                    {
                        "utteranceId": transcript.utterance_id,
                        "revision": transcript.revision,
                        "final": transcript.final,
                        "audioStartMs": transcript.audio_start_ms,
                        "audioEndMs": transcript.audio_end_ms,
                        "eventMs": round((time.monotonic() - started) * 1000, 3),
                        "characters": len(transcript.text),
                    }
                )
                if transcript.final:
                    finals.append(transcript.text)
                    print(
                        json.dumps(
                            {"finalSource": transcript.text}, ensure_ascii=False
                        ),
                        flush=True,
                    )
            normalized = "".join(finals).replace(" ", "")
            checks = {
                "doNotCancel": "中止しません" in normalized,
                "beforeNoon": "正午前" in normalized,
                "blueUmbrella": "青い傘" in normalized,
                "afternoonThree": "午後三時" in normalized or "午後3時" in normalized,
                "station": "駅で" in normalized,
                "sendTomorrow": "明日送る予定" in normalized,
            }
            report = {
                "generatedSpeech": True,
                "voice": "Kyoko",
                "realCapture": False,
                "sourceLanguage": "ja",
                "asrModel": model,
                "interim": True,
                "pcmSha256": hashlib.sha256(pcm).hexdigest(),
                "audioMs": round(len(pcm) / 48),
                "samples": samples,
                "meaningAnchorChecks": checks,
                "queuePeakMs": queue_peak,
                "droppedUtterances": transcriber.dropped_utterances,
                "pendingAudioMsAtEnd": transcriber.pending_audio_ms,
                "coalescedSnapshots": transcriber.coalesced_snapshots,
            }
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(json.dumps(report, indent=2) + "\n")
            assert samples and all(checks.values()), "Japanese meaning anchors failed"
            assert transcriber.dropped_utterances == 0, "Speech segments were dropped"
            assert transcriber.pending_audio_ms == 0
            assert queue_peak <= 8000
        finally:
            await transcriber.close()
            engine.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--asr-model", default=ASR_MODEL)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    asyncio.run(verify(args.asr_model, args.report))
