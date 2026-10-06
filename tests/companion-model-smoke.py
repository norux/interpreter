"""Run with the bundled Python -I -B; reuse an already running local Ollama."""

import argparse
import asyncio
import json
import re
import subprocess
import sys
import time
from pathlib import Path


async def verify(app, report_path):
    resources = app.resolve() / "Contents/Resources"
    if not Path(sys.executable).resolve().is_relative_to(resources / "python"):
        raise RuntimeError("Run this check using the app's bundled Python -I -B")
    sys.path.insert(0, str(resources))
    from server.sessions.contracts import Transcript
    from server.sessions.local import ASR_MODEL, TEXT_MODEL, MlxEngine, OllamaTranslator

    subprocess.run(["codesign", "--verify", "--strict", str(app)], check=True)
    assert TEXT_MODEL == "qwen3.5:9b"
    engine = MlxEngine()
    adapter = OllamaTranslator(TEXT_MODEL, "Japanese", "Korean")
    try:
        await asyncio.get_running_loop().run_in_executor(
            engine.executor, engine.prepare, ASR_MODEL
        )
        await adapter.prepare()
        final = None
        first = None
        started = time.monotonic()
        async for translation in adapter.translate(
            Transcript(
                "packaged-ja",
                1,
                "電車は午前十二時ではなく、午後十二時に出発します。",
                True,
                0,
                1000,
            ),
            [],
        ):
            if first is None:
                first = (time.monotonic() - started) * 1000
            if translation.final:
                final = translation
        assert final and re.search(
            r"(자정|오전\s*(12|열두)\s*시).*아니.*(정오|오후\s*(12|열두)\s*시)",
            final.text,
        )
        subprocess.run(["codesign", "--verify", "--strict", str(app)], check=True)
        report = {
            "bundledPython": True,
            "realCapture": False,
            "asrPrepared": True,
            "asrModel": ASR_MODEL,
            "textModel": TEXT_MODEL,
            "japaneseTimeAnchorPassed": True,
            "firstOutputMs": round(first, 3),
            "signatureStrictBeforeAndAfter": True,
            "existingOllamaReused": True,
        }
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=2) + "\n")
    finally:
        await adapter.close()
        engine.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    asyncio.run(verify(args.app, args.report))
