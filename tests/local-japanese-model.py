"""Generated Kyoko speech through real MLX ASR and optional local translation.

Exit nonzero for transcript mismatches; reports still include every sample.
"""

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
from server.sessions.contracts import Transcript
from server.sessions.local import ASR_MODEL, MlxEngine, OllamaTranslator, Utterance

CLIPS = [
    "旅行は中止しません。",
    "駅で午後三時に会いましょう。",
    "電車は正午に出発します。",
    "資料は明日送る予定です。",
]


async def verify(text_model, report_path):
    engine = MlxEngine()
    adapter = OllamaTranslator(text_model, "Japanese", "Korean") if text_model else None
    report = {
        "generatedSpeech": True,
        "voice": "Kyoko",
        "sourceLanguage": "ja",
        "asrModel": ASR_MODEL,
        "textModel": text_model,
        "realCapture": False,
        "samples": [],
    }
    try:
        await asyncio.get_running_loop().run_in_executor(
            engine.executor, engine.prepare, ASR_MODEL
        )
        if adapter:
            await adapter.prepare()
        with tempfile.TemporaryDirectory(prefix="interpreter-japanese-") as temporary:
            path = Path(temporary)
            for index, sentence in enumerate(CLIPS):
                subprocess.run(
                    [
                        "say",
                        "-v",
                        "Kyoko",
                        "-r",
                        "165",
                        "-o",
                        str(path / "speech.aiff"),
                        sentence,
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
                with wave.open(str(path / "speech.wav")) as wav:
                    pcm = wav.readframes(wav.getnframes())
                frames = tuple(
                    AudioFrame(
                        i, i * 20, 24000, pcm[i * 960 : (i + 1) * 960].ljust(960, b"\0")
                    )
                    for i in range((len(pcm) + 959) // 960)
                )
                started = time.monotonic()
                recognized = await asyncio.get_running_loop().run_in_executor(
                    engine.executor,
                    engine.transcribe,
                    Utterance(frames, 0, len(frames) * 20),
                    ASR_MODEL,
                    "Japanese",
                )
                asr_ms = (time.monotonic() - started) * 1000
                if not any("\u3040" <= char <= "\u9fff" for char in recognized):
                    raise AssertionError(
                        "Japanese speech produced no Japanese transcript"
                    )
                final = None
                if adapter:
                    async for translation in adapter.translate(
                        Transcript(
                            str(index), 1, recognized, True, 0, len(frames) * 20
                        ),
                        [],
                    ):
                        if translation.final:
                            final = translation
                    if final is None or not any("가" <= c <= "힣" for c in final.text):
                        raise AssertionError("Missing final Korean translation")
                print(
                    json.dumps(
                        {
                            "fixture": index,
                            "expectedSource": sentence,
                            "recognized": recognized,
                            "translation": final.text if final else None,
                        },
                        ensure_ascii=False,
                    ),
                    flush=True,
                )
                report["samples"].append(
                    {
                        "fixture": index,
                        "pcmSha256": hashlib.sha256(pcm).hexdigest(),
                        "audioMs": len(frames) * 20,
                        "asrMs": round(asr_ms, 3),
                        "sourceCharacters": len(recognized),
                        "exactSourceMatch": recognized.rstrip("。.").replace(" ", "")
                        == sentence.rstrip("。.").replace(" ", ""),
                        "translationCharacters": len(final.text) if final else None,
                        "final": final.final if final else None,
                    }
                )
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        if not all(sample["exactSourceMatch"] for sample in report["samples"]):
            raise AssertionError(
                "Japanese ASR transcript mismatches; see numeric report"
            )
    finally:
        if adapter:
            await adapter.close()
        engine.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--text-model")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    asyncio.run(verify(args.text_model, args.report))
