import asyncio
import base64
import json
import struct

import httpx
import pytest
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from server.capture.pcm import AudioFrame
from server.sessions import live
from server.sessions.live import LiveTranscriber
from server.sessions.local import LocalSession, SpeechSegments
from server.sessions.text import CloudTranslator
from tests.test_text import reply


def frame(i, voice):
    return AudioFrame(
        i, i * 20, 24000, struct.pack("<480h", *([1000 if voice else 0] * 480))
    )


async def audio(turns=1):
    for i in range(turns * 65):
        yield frame(i, 10 <= i % 65 < 40)
        await asyncio.sleep(0)


class Detector:
    def is_speech(self, pcm, _rate):
        return any(pcm)


async def send(socket, event):
    await socket.send(json.dumps(event))


async def configure(socket):
    await send(socket, {"type": "session.created"})
    update = json.loads(await socket.recv())
    assert update == {
        "type": "session.update",
        "session": {
            "type": "transcription",
            "audio": {
                "input": {
                    "format": {"type": "audio/pcm", "rate": 24000},
                    "transcription": {
                        "model": "gpt-live-transcribe",
                        "languages": ["en"],
                        "delay": "low",
                    },
                    "turn_detection": None,
                }
            },
        },
    }
    await send(socket, {"type": "session.updated", "session": update["session"]})


async def turn(socket, item_id="item-1"):
    received = []
    while True:
        event = json.loads(await socket.recv())
        if event["type"] == "input_audio_buffer.commit":
            break
        assert event["type"] == "input_audio_buffer.append"
        received.append(base64.b64decode(event["audio"], validate=True))
    assert len(received) >= 10
    assert all(len(pcm) == 960 for pcm in received)
    await send(socket, {"type": "input_audio_buffer.committed", "item_id": item_id})
    return received


async def fixture(monkeypatch, handler, check, timeout=10):
    class Segments(SpeechSegments):
        def __init__(self):
            super().__init__()
            self.vad = Detector()

    monkeypatch.setattr(live, "SpeechSegments", Segments)
    async with serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]

        def local_connect(url, **kwargs):
            assert url == "wss://api.openai.com/v1/realtime?intent=transcription"
            assert kwargs["additional_headers"] == {
                "Authorization": "Bearer fixture-secret"
            }
            assert kwargs["proxy"] is None and kwargs["max_queue"] == 8
            return connect(f"ws://127.0.0.1:{port}", **kwargs)

        monkeypatch.setattr(live, "connect", local_connect)
        await asyncio.wait_for(check(), timeout)


def test_pcm_commit_partial_final_same_item_timing_and_close(monkeypatch):
    received = []
    deleted = []

    async def handler(socket):
        await configure(socket)
        for i in range(2):
            received.append(await turn(socket, f"item-{i}"))
            for kind, key, text in [
                ("delta", "delta", "Generated "),
                ("delta", "delta", "test"),
                ("completed", "transcript", "Generated test corrected"),
            ]:
                await send(
                    socket,
                    {
                        "type": f"conversation.item.input_audio_transcription.{kind}",
                        "item_id": f"item-{i}",
                        key: text,
                    },
                )
            deleted.append(json.loads(await socket.recv()))
            await send(
                socket, {"type": "conversation.item.deleted", "item_id": f"item-{i}"}
            )
        await socket.wait_closed()

    async def check():
        asr = LiveTranscriber("fixture-secret", "gpt-live-transcribe", "en")
        transcripts = [t async for t in asr.transcribe(audio(2))]
        assert [t.text for t in transcripts] == [
            "Generated",
            "Generated test",
            "Generated test corrected",
        ] * 2
        assert [t.final for t in transcripts] == [False, False, True] * 2
        assert [t.revision for t in transcripts] == [1, 2, 3] * 2
        assert [t.utterance_id for t in transcripts] == ["item-0"] * 3 + ["item-1"] * 3
        assert [(t.audio_start_ms, t.audio_end_ms) for t in transcripts[::3]] == [
            (20, 800),
            (1320, 2100),
        ]
        assert received[0] == [frame(i, 10 <= i < 40).pcm for i in range(1, 65)]
        assert deleted == [
            {"type": "conversation.item.delete", "item_id": f"item-{i}"}
            for i in range(2)
        ]
        assert asr.socket is None and asr.reader is None and asr.task is None
        await asr.close()

    asyncio.run(fixture(monkeypatch, handler, check))


@pytest.mark.parametrize("provider", ["luna", "anthropic", "local"])
def test_live_asr_to_actual_text_adapter_final_only(monkeypatch, provider):
    calls = []

    async def handler(socket):
        await configure(socket)
        await turn(socket)
        for kind, key, text in [
            ("delta", "delta", "Part"),
            ("completed", "transcript", "Generated speech"),
        ]:
            await send(
                socket,
                {
                    "type": f"conversation.item.input_audio_transcription.{kind}",
                    "item_id": "item-1",
                    key: text,
                },
            )
        assert json.loads(await socket.recv()) == {
            "type": "conversation.item.delete",
            "item_id": "item-1",
        }
        await send(socket, {"type": "conversation.item.deleted", "item_id": "item-1"})
        await socket.wait_closed()

    async def check():
        from server.sessions.local import OllamaTranslator

        def response(request):
            calls.append(json.loads(request.content))
            body = (
                reply(provider)
                if provider != "local"
                else {"message": {"content": "생성한 시험 번역"}, "done_reason": "stop"}
            )
            return httpx.Response(200, json=body)

        translator = (
            CloudTranslator(provider, "fixture-key", "chosen-text", "English", "Korean")
            if provider != "local"
            else OllamaTranslator("chosen-text", "English", "Korean")
        )
        await translator.client.aclose()
        translator.client = httpx.AsyncClient(
            transport=httpx.MockTransport(response), base_url="http://127.0.0.1:11434"
        )
        asr = LiveTranscriber("fixture-secret", "gpt-live-transcribe", "en")
        events = [e async for e in LocalSession("s", asr, translator).run(audio())]
        captions = [e.caption for e in events if e.caption]
        assert len(calls) == len(captions) == 1
        assert captions[0].utterance_id == "item-1" and captions[0].final
        assert captions[0].source == "Generated speech"
        assert captions[0].translation == "생성한 시험 번역"
        assert "audio" not in json.dumps(calls)
        assert "Generated speech" in json.dumps(calls)

    asyncio.run(fixture(monkeypatch, handler, check))


@pytest.mark.parametrize(
    "failure, expected",
    [
        ("rate_limit_exceeded", "limit reached"),
        ("model_not_found", "access denied"),
        ("invalid_api_key", "access denied"),
        ("failed", "failed"),
        ("wrong-item", "invalid protocol"),
        ("invalid", "invalid protocol"),
        ("disconnect", "disconnected"),
    ],
)
def test_live_errors_cleanup_no_secret(monkeypatch, failure, expected):
    async def handler(socket):
        await configure(socket)
        await turn(socket)
        if failure == "disconnect":
            await socket.close()
        elif failure == "invalid":
            await socket.send("[]")
        elif failure == "wrong-item":
            await send(
                socket,
                {
                    "type": "conversation.item.input_audio_transcription.completed",
                    "item_id": "old-item",
                    "transcript": "late",
                },
            )
        else:
            await send(
                socket,
                {
                    "type": "error"
                    if failure != "failed"
                    else "conversation.item.input_audio_transcription.failed",
                    "error": {"code": failure, "message": "fixture-secret raw speech"},
                },
            )
        await socket.wait_closed()

    async def check():
        asr = LiveTranscriber("fixture-secret", "gpt-live-transcribe", "en")
        with pytest.raises(RuntimeError, match=expected) as error:
            _ = [t async for t in asr.transcribe(audio())]
        assert "fixture-secret" not in str(error.value)
        assert "raw speech" not in str(error.value)
        assert asr.socket is None and asr.reader is None

    asyncio.run(fixture(monkeypatch, handler, check))


def test_live_slow_turn_bounded_queue_cancel_and_no_late_caption(monkeypatch):
    started = asyncio.Event()
    closed = asyncio.Event()

    async def handler(socket):
        await configure(socket)
        await turn(socket)
        started.set()
        try:
            await socket.recv()
        except ConnectionClosed:
            closed.set()

    async def check():
        asr = LiveTranscriber("fixture-secret", "gpt-live-transcribe", "en")
        transcripts = []

        async def collect():
            async for transcript in asr.transcribe(audio(30)):
                transcripts.append(transcript)

        task = asyncio.create_task(collect())
        await started.wait()
        for _ in range(100):
            await asyncio.sleep(0.01)
            if asr.dropped_utterances >= 27:
                break
        assert asr.dropped_utterances == 27
        assert asr.pending_audio_ms <= 8000
        await asyncio.wait_for(asr.cancel(), 1)
        await asyncio.wait_for(closed.wait(), 1)
        assert task.cancelled() and transcripts == []
        assert asr.socket is None and asr.reader is None and asr.task is None
        assert asr.pending_audio_ms == 0
        await asr.close()

    asyncio.run(fixture(monkeypatch, handler, check))


def test_real_silence_does_not_commit_or_request_transcription(monkeypatch):
    async def handler(socket):
        await configure(socket)
        with pytest.raises(ConnectionClosed):
            await socket.recv()

    async def check():
        async def silence():
            for i in range(500):
                yield frame(i, False)

        asr = LiveTranscriber("fixture-secret", "gpt-live-transcribe", "en")
        assert [t async for t in asr.transcribe(silence())] == []

    asyncio.run(fixture(monkeypatch, handler, check))


@pytest.mark.parametrize("status", [401, 403, 429])
def test_live_handshake_errors(monkeypatch, status):
    from websockets.datastructures import Headers
    from websockets.http11 import Response

    async def reject(_connection, _request):
        return Response(status, "fixture denied", Headers(), b"fixture-secret")

    async def check():
        async with serve(
            lambda _: None, "127.0.0.1", 0, process_request=reject
        ) as server:
            port = server.sockets[0].getsockname()[1]
            monkeypatch.setattr(
                live,
                "connect",
                lambda _, **kwargs: connect(f"ws://127.0.0.1:{port}", **kwargs),
            )
            asr = LiveTranscriber("fixture-secret", "gpt-live-transcribe", "en")
            with pytest.raises(
                RuntimeError,
                match="limit reached" if status == 429 else "access denied",
            ) as error:
                _ = [t async for t in asr.transcribe(audio())]
            assert "fixture-secret" not in str(error.value)
            assert asr.socket is None and asr.task is None

    asyncio.run(check())


@pytest.mark.parametrize("missing", ["key", "model"])
def test_live_missing_setup_never_connects(monkeypatch, missing):
    monkeypatch.setattr(live, "connect", lambda *_a, **_k: pytest.fail("No network"))

    async def check():
        asr = LiveTranscriber(
            "" if missing == "key" else "fixture-secret",
            "unsupported" if missing == "model" else "gpt-live-transcribe",
            "en",
        )
        with pytest.raises(
            RuntimeError, match="OPENAI_API_KEY|gpt-live-transcribe only"
        ):
            _ = [t async for t in asr.transcribe(audio())]
        assert asr.socket is None and asr.task is None

    asyncio.run(check())


def test_live_stalled_turn_deadline_releases_socket_and_reader(monkeypatch):
    import time

    async def handler(socket):
        await configure(socket)
        await turn(socket)
        # Never complete the turn: this must exercise the real 30-second deadline.
        await socket.wait_closed()

    async def check():
        asr = LiveTranscriber("fixture-secret", "gpt-live-transcribe", "en")
        started = time.monotonic()
        with pytest.raises(RuntimeError, match="stalled"):
            _ = [t async for t in asr.transcribe(audio())]
        elapsed = time.monotonic() - started
        assert 30 <= elapsed < 33
        assert asr.socket is None and asr.reader is None and asr.task is None
        assert asr.pending_audio_ms == 0

    asyncio.run(fixture(monkeypatch, handler, check, timeout=35))


def test_live_delta_before_commit_ack_keeps_item_and_final(monkeypatch):
    async def handler(socket):
        await configure(socket)
        event = json.loads(await socket.recv())
        assert event["type"] == "input_audio_buffer.append"
        # gpt-live-transcribe can emit deltas while audio is still being appended.
        await send(
            socket,
            {
                "type": "conversation.item.input_audio_transcription.delta",
                "item_id": "item-1",
                "delta": "Early speech",
            },
        )
        await turn(socket)
        await send(
            socket,
            {
                "type": "conversation.item.input_audio_transcription.completed",
                "item_id": "item-1",
                "transcript": "Early speech corrected",
            },
        )
        assert json.loads(await socket.recv()) == {
            "type": "conversation.item.delete",
            "item_id": "item-1",
        }
        await send(socket, {"type": "conversation.item.deleted", "item_id": "item-1"})
        await socket.wait_closed()

    async def check():
        asr = LiveTranscriber("fixture-secret", "gpt-live-transcribe", "en")
        transcripts = [t async for t in asr.transcribe(audio())]
        assert [t.text for t in transcripts] == [
            "Early speech",
            "Early speech corrected",
        ]
        assert [t.final for t in transcripts] == [False, True]
        assert [t.utterance_id for t in transcripts] == ["item-1", "item-1"]

    asyncio.run(fixture(monkeypatch, handler, check))
