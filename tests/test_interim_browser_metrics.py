import asyncio
import json
import runpy
import sys
from types import ModuleType

import pytest

from server.sessions import local
from server.sessions.contracts import Transcript, Translation
from tests.test_local import frame


@pytest.mark.parametrize(
    "phase,interim,trial,snapshot_frames,first_snapshot_frames",
    [
        ("before", False, None, 25, 25),
        ("after", True, None, 25, 25),
        ("after", True, "interval500", 25, 25),
        ("after", True, "interval1000", 50, 25),
        ("after", True, "first500", 25, 25),
        ("after", True, "first300", 25, 15),
    ],
)
def test_native_interim_baseline_changes_only_snapshots_and_metrics_exclude_text(
    monkeypatch, capsys, phase, interim, trial, snapshot_frames, first_snapshot_frames
):
    monkeypatch.setenv("INTERPRETER_INTERIM_PHASE", phase)
    if trial:
        monkeypatch.setenv("INTERPRETER_INTERIM_TRIAL", trial)
    else:
        monkeypatch.delenv("INTERPRETER_INTERIM_TRIAL", raising=False)
    silence, pause = (
        local.SpeechSegments.silence_frames,
        local.SpeechSegments.long_pause_frames,
    )
    monkeypatch.setattr(local.MlxEngine, "transcribe", lambda *_: "Private source")

    async def prepare(_self):
        pass

    monkeypatch.setattr(local.LocalSession, "prepare", prepare)

    closed = []

    async def translate(_self, transcript, _context):
        try:
            yield Translation(transcript.utterance_id, 1, "Private translation", True)
            await asyncio.Event().wait()
        finally:
            closed.append(transcript.revision)

    monkeypatch.setattr(local.OllamaTranslator, "translate", translate)
    # Register every wrapped attribute with monkeypatch for restoration afterwards.
    for cls, name in (
        (local.MlxTranscriber, "__init__"),
        (local.LocalSession, "prepare"),
    ):
        monkeypatch.setattr(cls, name, getattr(cls, name))
    mx = ModuleType("mlx.core")
    mx.get_active_memory = lambda: 123
    mx.get_peak_memory = lambda: 456
    mlx = ModuleType("mlx")
    mlx.core = mx
    monkeypatch.setitem(sys.modules, "mlx", mlx)
    monkeypatch.setitem(sys.modules, "mlx.core", mx)

    async def check():
        engine = local.MlxEngine()
        transcriber = local.MlxTranscriber(engine, "fixture", "English", interim=True)
        translator = local.OllamaTranslator("fixture", "English", "Korean")
        session = local.LocalSession("measured", transcriber, translator)
        assert transcriber.interim is interim
        assert transcriber.snapshot_frames == snapshot_frames
        assert transcriber.first_snapshot_frames == first_snapshot_frames
        assert (
            local.SpeechSegments.silence_frames,
            local.SpeechSegments.long_pause_frames,
        ) == (silence, pause)
        try:
            await session.prepare()
            utterance = local.Utterance((frame(0, True),), 0, 20)
            assert (
                engine.transcribe(utterance, "fixture", "English") == "Private source"
            )
            stream = translator.translate(
                Transcript("1", 2, "Private source", False, 0, 20), []
            )
            value = await anext(stream)
            assert value.text == "Private translation"
            await stream.aclose()
            assert closed == [2], (
                "Instrumentation must close the wrapped provider stream"
            )
            packets = iter(
                [
                    {"type": "websocket.receive", "bytes": b"not-pcm"},
                    {"type": "websocket.disconnect"},
                ]
            )
            sent = []

            async def receive():
                return next(packets)

            async def send(message):
                sent.append(message)

            await module["app"]({"type": "websocket"}, receive, send)
            assert len(sent) == 2
            assert (
                json.loads(sent[0]["text"])["caption"]["translation"]
                == "Private translation"
            )
        finally:
            await session.close()
            engine.close()

    async def companion(_scope, receive, send):
        await receive()
        await send(
            {
                "type": "websocket.send",
                "text": json.dumps(
                    {
                        "type": "caption",
                        "sessionId": "measured",
                        "caption": {
                            "utteranceId": "1",
                            "revision": 1,
                            "final": False,
                            "source": "Private source",
                            "translation": "Private translation",
                            "audioStartMs": 0,
                            "audioEndMs": 20,
                        },
                    }
                ),
            }
        )
        await send(
            {
                "type": "websocket.send",
                "text": json.dumps(
                    {
                        "type": "receipt",
                        "sessionId": "measured",
                        "frames": 50,
                        "droppedFrames": 0,
                        "droppedUtterances": 0,
                    }
                ),
            }
        )

    from server import app as server_app

    monkeypatch.setattr(server_app, "app", companion)
    module = runpy.run_path("tests/interim_browser_metrics.py")
    asyncio.run(check())
    metrics = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert {m["metric"] for m in metrics} >= {
        "asr",
        "translation",
        "caption",
        "receipt",
    }
    assert all(m["sessionId"] == "measured" for m in metrics)
    assert "Private" not in json.dumps(metrics)
    preparation = next(m for m in metrics if m["metric"] == "prepare")
    assert preparation["firstSnapshotMs"] == first_snapshot_frames * 20
    assert preparation["snapshotMs"] == snapshot_frames * 20
    assert preparation["snapshotsEnabled"] is interim
    assert (
        preparation["asrModel"], preparation["textModel"],
        preparation["source"], preparation["target"],
    ) == ("fixture", "fixture", "English", "Korean")
    assert preparation["translationOptions"] == {
        "temperature": 0, "num_ctx": 4096, "num_predict": 256, "think": False,
    }
    asr = next(m for m in metrics if m["metric"] == "asr")
    assert asr["startedAtMs"] <= asr["atMs"]
    assert (asr["audioMs"], asr["mlxActiveBytes"], asr["mlxPeakBytes"]) == (
        20,
        123,
        456,
    )
    translation = next(m for m in metrics if m["metric"] == "translation")
    assert (
        translation["startedAtMs"]
        <= translation["firstOutputAtMs"]
        <= translation["atMs"]
    )
    assert translation["sourceRevision"] == 2 and translation["responseComplete"]
    assert not translation["sourceFinal"]
    receipt = next(m for m in metrics if m["metric"] == "receipt")
    assert receipt["pendingAudioMs"] == receipt["pendingTranslationMs"] == 0
    assert receipt["droppedTranslations"] == receipt["coalescedSnapshots"] == 0
