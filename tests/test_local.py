import asyncio
import struct
import threading
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest

from server.capture.pcm import AudioFrame
from server.sessions.contracts import Transcript, Translation
from server.sessions.local import (
    LocalSession,
    MlxTranscriber,
    OllamaTranslator,
    SpeechSegments,
)


def frame(sequence, voice=False):
    return AudioFrame(
        sequence,
        sequence * 20,
        24000,
        struct.pack("<480h", *([1000 if voice else 0] * 480)),
    )


async def frames(values):
    for value in values:
        yield value
        await asyncio.sleep(0)


class SpeechDetector:
    def is_speech(self, pcm, _rate):
        return any(pcm)


def test_vad_ignores_real_silence_and_bounds_continuous_speech():
    segments = SpeechSegments()
    assert all(segments.push(frame(i)) is None for i in range(1000))
    segments = SpeechSegments()
    segments.vad = SpeechDetector()
    utterances = [u for i in range(900) if (u := segments.push(frame(i, True)))]
    assert [len(u.frames) for u in utterances] == [300, 300, 300]
    assert [(u.start_ms, u.end_ms) for u in utterances] == [
        (0, 6000),
        (6000, 12000),
        (12000, 18000),
    ]


def test_silence_boundary_minimum_speech_and_frame_gap():
    segments = SpeechSegments()
    segments.vad = SpeechDetector()
    values = [frame(i, 10 <= i < 40) for i in range(65)]
    results = [u for f in values if (u := segments.push(f))]
    assert len(results) == 1
    assert results[0].start_ms == 20  # 200 ms pre-roll includes first speech frame.
    assert results[0].end_ms == 800
    segments = SpeechSegments()
    segments.vad = SpeechDetector()
    for i in range(20):
        assert segments.push(frame(i, True)) is None
    # A gap resets buffered speech, then brief noise alone does not make a cue.
    assert segments.push(frame(50, True)) is None
    assert all(segments.push(frame(i)) is None for i in range(51, 80))


def test_slow_asr_drops_old_segments_and_does_not_block_loop_or_overlap():
    async def check():
        started = threading.Event()
        release = threading.Event()
        calls = []

        class Engine:
            executor = ThreadPoolExecutor(max_workers=1)

            def transcribe(self, utterance, *_):
                calls.append(utterance.start_ms)
                started.set()
                release.wait(5)
                return "Generated test sentence"

        engine = Engine()
        transcriber = MlxTranscriber(engine, "fixture", "English")
        # Deterministic segments for queue policy; real silence is checked above.
        import server.sessions.local as local

        original = local.SpeechSegments

        class Segments(original):
            def __init__(self):
                super().__init__()
                self.vad = SpeechDetector()

        local.SpeechSegments = Segments
        results = []

        async def collect():
            async for transcript in transcriber.transcribe(
                frames([frame(i, True) for i in range(1800)])
            ):
                results.append(transcript)

        task = asyncio.create_task(collect())
        try:
            for _ in range(100):
                await asyncio.sleep(0.01)
                if started.is_set() and transcriber.dropped_utterances >= 4:
                    break
            assert started.is_set(), "Inference must run on a worker while loop ticks"
            assert transcriber.dropped_utterances == 4
            assert transcriber.pending_audio_ms <= 8000
            assert len(calls) == 1
            release.set()
            await asyncio.wait_for(task, 3)
            assert calls == [0, 30000], (
                "Keep only newest waiting speech within 8 s budget"
            )
            assert len(results) == 2
        finally:
            release.set()
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            engine.executor.shutdown()
            local.SpeechSegments = original

    asyncio.run(check())


def test_cancel_releases_full_queue_and_suppresses_late_translation():
    async def check():
        translating = asyncio.Event()
        released = asyncio.Event()

        class ASR:
            async def transcribe(self, _frames):
                yield Transcript("u1", 1, "Test speech", True, 0, 1000)

            async def cancel(self):
                pass

            async def close(self):
                pass

        class Translator:
            async def translate(self, transcript, _context):
                translating.set()
                await released.wait()
                yield Translation(transcript.utterance_id, 1, "시험 음성", True)

            async def cancel(self):
                released.set()

            async def close(self):
                pass

        session = LocalSession("cancelled", ASR(), Translator())
        events = []

        async def collect():
            async for event in session.run(frames([])):
                events.append(event)

        task = asyncio.create_task(collect())
        await translating.wait()
        await session.cancel()
        await asyncio.wait_for(task, 1)
        assert [e.type for e in events] == ["status"]

    asyncio.run(check())


def test_ollama_final_only_context_text_request_and_caption_contract():
    async def check():
        requests = []

        def response(request):
            import json

            payload = json.loads(request.content)
            requests.append(payload)
            return httpx.Response(
                200,
                json={
                    "message": {"content": "생성한 테스트 번역"},
                    "done": True,
                    "done_reason": "stop",
                },
            )

        translator = OllamaTranslator("qwen3:4b-instruct", "English", "Korean")
        await translator.client.aclose()
        translator.client = httpx.AsyncClient(
            transport=httpx.MockTransport(response), base_url="http://127.0.0.1:11434"
        )

        class ASR:
            async def transcribe(self, _frames):
                yield Transcript("1", 0, "partial", False, 0, 1000)
                for i in range(5):
                    yield Transcript(str(i), 1, f"Generated test {i}", True, 0, 1000)

            async def cancel(self):
                pass

            async def close(self):
                pass

        events = [
            e async for e in LocalSession("test", ASR(), translator).run(frames([]))
        ]
        captions = [e.caption for e in events if e.type == "caption"]
        assert len(captions) == len(requests) == 5
        assert captions[-1].source == "Generated test 4"
        assert captions[-1].translation == "생성한 테스트 번역"
        assert captions[-1].session_id == "test"
        assert captions[-1].audio_end_ms == 1000
        assert captions[-1].emitted_at_ms > 0
        assert requests[0]["model"] == "qwen3:4b-instruct"
        assert requests[0]["think"] is False
        assert requests[0]["stream"] is True
        assert "Korean" in requests[0]["messages"][0]["content"]
        assert len(requests[-1]["messages"]) == 8
        assert all("audio" not in request for request in requests)

    asyncio.run(check())


@pytest.mark.parametrize(
    "failure, expected",
    [
        (404, "ollama pull"),
        (500, "failed"),
        ("connect", "ollama serve"),
        ("timeout", "timed out"),
        ("length", "truncated"),
    ],
)
def test_ollama_errors_are_actionable_and_never_fallback(failure, expected):
    async def check():
        calls = []

        def response(request):
            calls.append(str(request.url))
            if failure == "connect":
                raise httpx.ConnectError("offline", request=request)
            if failure == "timeout":
                raise httpx.ReadTimeout("slow", request=request)
            if failure == "length":
                return httpx.Response(
                    200,
                    json={
                        "message": {"content": "incomplete"},
                        "done": True,
                        "done_reason": "length",
                    },
                )
            return httpx.Response(failure)

        translator = OllamaTranslator("missing", "English", "Korean")
        await translator.client.aclose()
        translator.client = httpx.AsyncClient(
            transport=httpx.MockTransport(response), base_url="http://127.0.0.1:11434"
        )
        try:
            with pytest.raises(RuntimeError, match=expected):
                _ = [
                    t
                    async for t in translator.translate(
                        Transcript("1", 1, "Test", True, 0, 1), []
                    )
                ]
            assert calls == ["http://127.0.0.1:11434/api/chat"]
        finally:
            await translator.close()

    asyncio.run(check())


def test_missing_mlx_dependency_reports_setup_command(monkeypatch):
    import builtins

    from server.sessions.local import MlxEngine, Utterance

    original = builtins.__import__

    def missing(name, *args, **kwargs):
        if name == "mlx.core":
            raise ImportError("not installed")
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", missing)
    engine = MlxEngine()
    try:
        with pytest.raises(RuntimeError, match="uv sync --locked --extra local"):
            engine.transcribe(Utterance((frame(0),), 0, 20), "fixture", "English")
    finally:
        engine.close()


def test_cancel_asr_with_full_queue_does_not_wait_for_native_inference(monkeypatch):
    from server.sessions import local

    async def check():
        started = threading.Event()
        release = threading.Event()

        class Engine:
            executor = ThreadPoolExecutor(max_workers=1)

            def transcribe(self, *_):
                started.set()
                release.wait(5)
                return "Late fixture"

        class Segments(local.SpeechSegments):
            def __init__(self):
                super().__init__()
                self.vad = SpeechDetector()

        monkeypatch.setattr(local, "SpeechSegments", Segments)
        engine = Engine()
        transcriber = MlxTranscriber(engine, "fixture", "English")

        async def collect():
            return [
                t
                async for t in transcriber.transcribe(
                    frames([frame(i, True) for i in range(1800)])
                )
            ]

        task = asyncio.create_task(collect())
        try:
            for _ in range(100):
                await asyncio.sleep(0.01)
                if started.is_set() and transcriber.dropped_utterances >= 4:
                    break
            assert transcriber.dropped_utterances == 4
            task.cancel()
            await asyncio.wait_for(asyncio.gather(task, return_exceptions=True), 1)
            assert transcriber.reader is None
            assert transcriber.pending_audio_ms == 0
            assert not release.is_set(), (
                "Stop must not wait for native model completion"
            )
        finally:
            release.set()
            engine.executor.shutdown()

    asyncio.run(check())


def test_transport_delivers_normalized_model_caption_and_error(monkeypatch):
    from fastapi.testclient import TestClient

    from server.app import create_app
    from server.capture import transport
    from server.capture.pcm import HEADER
    from server.sessions.contracts import SessionEvent

    monkeypatch.setenv("INTERPRETER_EXTENSION_ID", "a" * 32)
    origin = "chrome-extension://" + "a" * 32

    class ASR:
        async def transcribe(self, audio):
            sample = await anext(audio)
            assert sample.pcm == struct.pack("<480h", *([1000] * 480))
            yield Transcript("u1", 1, "Generated fixture speech", True, 0, 20)

        async def close(self):
            pass

    class Translator:
        async def translate(self, transcript, context):
            assert transcript.text == "Generated fixture speech"
            assert context == []
            yield Translation("u1", 1, "생성한 테스트 음성", True)

        async def close(self):
            pass

    monkeypatch.setattr(
        transport,
        "local_session",
        lambda sid, _: LocalSession(sid, ASR(), Translator()),
    )
    with TestClient(create_app(), base_url="http://127.0.0.1:8765") as client:
        auth = client.post("/sessions", headers={"origin": origin}).json()
        with client.websocket_connect(
            "ws://127.0.0.1:8765/audio", headers={"origin": origin}
        ) as ws:
            ws.send_json(auth)
            assert ws.receive_json()["type"] == "ready"
            ws.send_bytes(
                HEADER.pack(b"PCM1", 24000, 0, 0, 480, 1, 1) + frame(0, True).pcm
            )
            replies = [ws.receive_json() for _ in range(3)]
            caption = next(r["caption"] for r in replies if r["type"] == "caption")
            assert caption["sessionId"] == auth["sessionId"]
            assert caption["utteranceId"] == "u1"
            assert caption["source"] == "Generated fixture speech"
            assert caption["translation"] == "생성한 테스트 음성"
            assert caption["final"] is True
            assert caption["audioStartMs"] == 0
            assert caption["audioEndMs"] == 20

    class Unavailable:
        async def run(self, audio):
            await anext(audio)
            yield SessionEvent("error", auth["sessionId"], message="Run ollama serve")

        async def close(self):
            pass

    monkeypatch.setattr(transport, "local_session", lambda *_: Unavailable())
    with TestClient(create_app(), base_url="http://127.0.0.1:8765") as client:
        auth = client.post("/sessions", headers={"origin": origin}).json()
        with client.websocket_connect(
            "ws://127.0.0.1:8765/audio", headers={"origin": origin}
        ) as ws:
            ws.send_json(auth)
            ws.receive_json()
            ws.send_bytes(
                HEADER.pack(b"PCM1", 24000, 0, 0, 480, 1, 1) + frame(0, True).pcm
            )
            replies = [ws.receive_json(), ws.receive_json()]
            assert (
                next(r for r in replies if r["type"] == "error")["message"]
                == "Run ollama serve"
            )
            from starlette.websockets import WebSocketDisconnect

            with pytest.raises(WebSocketDisconnect) as failure:
                ws.receive_json()
            assert failure.value.code == 1011
