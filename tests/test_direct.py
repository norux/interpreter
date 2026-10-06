import asyncio
import base64
import json
import struct
import time

import pytest
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve
from websockets.datastructures import Headers
from websockets.exceptions import ConnectionClosed
from websockets.http11 import Response

from server.capture.pcm import AudioFrame
from server.sessions import direct
from server.sessions.direct import DirectSession


async def audio(count):
    for i in range(count):
        yield AudioFrame(i, i * 20, 24000, struct.pack("<480h", *([i] * 480)))
        await asyncio.sleep(0)


async def send(socket, event):
    await socket.send(json.dumps(event))


async def configure(socket):
    await send(socket, {"type": "session.created"})
    update = json.loads(await socket.recv())
    assert update == {
        "type": "session.update",
        "session": {"audio": {"output": {"language": "ko"}}},
    }
    await send(socket, {"type": "session.updated", "session": update["session"]})


async def fixture(monkeypatch, handler, check):
    async with serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]

        def local_connect(url, **kwargs):
            assert url == (
                "wss://api.openai.com/v1/realtime/translations"
                "?model=gpt-realtime-translate"
            )
            assert kwargs["additional_headers"] == {
                "Authorization": "Bearer fixture-secret"
            }
            assert kwargs["proxy"] is None
            assert kwargs["max_queue"] == 8
            return connect(f"ws://127.0.0.1:{port}", **kwargs)

        monkeypatch.setattr(direct, "connect", local_connect)
        await asyncio.wait_for(check(), 15)


def test_continuous_pcm_deltas_same_cue_and_graceful_flush(monkeypatch):
    received = []
    flushed = asyncio.Event()

    async def handler(socket):
        assert socket.request.headers["Authorization"] == "Bearer fixture-secret"
        await configure(socket)
        for i in range(4):
            event = json.loads(await socket.recv())
            assert event["type"] == "session.input_audio_buffer.append"
            received.append(base64.b64decode(event["audio"], validate=True))
        for delta in ("좋", "은 날", "씨입니다."):
            await send(
                socket,
                {
                    "type": "session.output_transcript.delta",
                    "delta": delta,
                    # Equal timing must not discard distinct fragments.
                    "elapsed_ms": 200,
                },
            )
        await send(socket, {"type": "session.output_audio.delta", "delta": "ignored"})
        assert json.loads(await socket.recv()) == {"type": "session.close"}
        # A socket closed immediately after the request loses this last caption.
        await asyncio.sleep(0.02)
        await send(
            socket,
            {
                "type": "session.output_transcript.delta",
                "delta": " 산책합시다",
                "elapsed_ms": 400,
            },
        )
        await send(socket, {"type": "session.closed"})
        flushed.set()
        await socket.wait_closed()

    async def check():
        session = DirectSession("fixture-session", "fixture-secret", "ko")
        events = [e async for e in session.run(audio(4))]
        captions = [e.caption for e in events if e.caption]
        assert events[0].type == "status"
        assert [e.type for e in events] == ["status"] + ["caption"] * 5
        assert [c.translation for c in captions] == [
            "좋",
            "좋은 날",
            "좋은 날씨입니다.",
            " 산책합시다",
            " 산책합시다",
        ]
        assert [c.utterance_id for c in captions] == [
            "direct-1",
            "direct-1",
            "direct-1",
            "direct-2",
            "direct-2",
        ]
        assert [c.revision for c in captions] == [1, 2, 3, 1, 2]
        assert [c.final for c in captions] == [False, False, True, False, True]
        assert all(
            c.session_id == "fixture-session" and c.source == "" for c in captions
        )
        assert [(c.audio_start_ms, c.audio_end_ms) for c in captions] == [
            (0, 200),
            (0, 200),
            (0, 200),
            (200, 400),
            (200, 400),
        ]
        assert all(c.emitted_at_ms > 0 for c in captions)
        assert received == [struct.pack("<480h", *([i] * 480)) for i in range(4)]
        assert flushed.is_set()
        assert session.socket is session.sender is session.task is None
        await session.close()  # Cleanup is idempotent.

    asyncio.run(fixture(monkeypatch, handler, check))


@pytest.mark.parametrize(
    "status, expected",
    [
        (401, "access denied"),
        (403, "access denied"),
        (429, "limit reached"),
    ],
)
def test_handshake_denial_is_an_error_without_provider_body(
    monkeypatch, status, expected
):
    async def check():
        async def unused(socket):
            raise AssertionError("A rejected handshake cannot create a session")

        def reject(*_):
            return Response(status, "Denied", Headers(), b"private provider body")

        async with serve(unused, "127.0.0.1", 0, process_request=reject) as server:
            port = server.sockets[0].getsockname()[1]
            monkeypatch.setattr(
                direct,
                "connect",
                lambda *_args, **kw: connect(f"ws://127.0.0.1:{port}", **kw),
            )
            events = [
                e
                async for e in DirectSession("test", "fixture-secret", "ko").run(
                    audio(1)
                )
            ]
        assert len(events) == 1 and events[0].type == "error"
        assert expected in events[0].message
        assert "private provider body" not in repr(events)

    asyncio.run(check())


def test_close_timeout_is_bounded_and_reports_failure(monkeypatch):
    async def handler(socket):
        await configure(socket)
        assert (
            json.loads(await socket.recv())["type"]
            == "session.input_audio_buffer.append"
        )
        assert json.loads(await socket.recv()) == {"type": "session.close"}
        await socket.wait_closed()  # Deliberately withhold session.closed.

    async def check():
        session = DirectSession("test", "fixture-secret", "ko")
        start = time.monotonic()
        events = [e async for e in session.run(audio(1))]
        assert 5 <= time.monotonic() - start < 8
        assert [e.type for e in events] == ["status", "error"]
        assert "stalled" in events[-1].message
        assert session.socket is session.sender is None

    asyncio.run(fixture(monkeypatch, handler, check))


@pytest.mark.parametrize("failure", [False, True])
def test_companion_routes_selected_direct_pcm_and_captions_without_local_models(
    monkeypatch,
    failure,
):
    from fastapi.testclient import TestClient

    from server.app import create_app
    from server.capture import transport
    from server.capture.pcm import HEADER

    monkeypatch.setenv("INTERPRETER_EXTENSION_ID", "a" * 32)
    monkeypatch.setenv("INTERPRETER_PROVIDER", "openai-direct")
    monkeypatch.setenv("OPENAI_API_KEY", "fixture-secret")
    monkeypatch.setenv("INTERPRETER_TARGET_LANGUAGE", "ko")

    def no_local(*_):
        raise AssertionError("Explicit direct selection cannot invoke local models")

    monkeypatch.setattr(transport, "local_session", no_local)
    drained = asyncio.Event()

    async def handler(socket):
        await configure(socket)
        frame = json.loads(await socket.recv())
        assert frame["type"] == "session.input_audio_buffer.append"
        assert base64.b64decode(frame["audio"]) == bytes(960)
        await send(
            socket,
            (
                {"type": "error", "error": {"code": "model_not_found"}}
                if failure
                else {
                    "type": "session.output_transcript.delta",
                    "delta": "생성한 번역입니다.",
                    "elapsed_ms": 200,
                }
            ),
        )
        assert json.loads(await socket.recv()) == {"type": "session.close"}
        await send(socket, {"type": "session.closed"})
        drained.set()

    def companion():
        origin = "chrome-extension://" + "a" * 32
        with TestClient(create_app(), base_url="http://127.0.0.1:8765") as client:
            auth = client.post("/sessions", headers={"origin": origin}).json()
            with client.websocket_connect(
                "ws://127.0.0.1:8765/audio", headers={"origin": origin}
            ) as socket:
                socket.send_json(auth)
                assert socket.receive_json()["type"] == "ready"
                socket.send_bytes(
                    HEADER.pack(b"PCM1", 24000, 0, 0, 480, 1, 1) + bytes(960)
                )
                replies = []
                while True:
                    reply = socket.receive_json()
                    replies.append(reply)
                    if reply["type"] == "error":
                        assert failure and "access denied" in reply["message"]
                        from starlette.websockets import WebSocketDisconnect

                        with pytest.raises(WebSocketDisconnect) as error:
                            socket.receive_json()
                        assert error.value.code == 1011
                        break
                    if reply["type"] == "caption":
                        assert not failure
                        assert reply["caption"]["sessionId"] == auth["sessionId"]
                        assert reply["caption"]["translation"] == "생성한 번역입니다."
                        assert reply["caption"]["final"] is True
                        break
                assert "fixture-secret" not in repr(replies + [auth])

    async def check():
        await asyncio.to_thread(companion)
        await drained.wait()

    asyncio.run(fixture(monkeypatch, handler, check))


@pytest.mark.parametrize(
    "provider, key, expected",
    [
        ("openai-direct", "", "OPENAI_API_KEY"),
        ("unsupported", "fixture-secret", "Unknown INTERPRETER_PROVIDER"),
    ],
)
def test_companion_rejects_missing_key_or_unknown_selection(
    monkeypatch, provider, key, expected
):
    from fastapi.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    from server.app import create_app

    monkeypatch.setenv("INTERPRETER_EXTENSION_ID", "a" * 32)
    monkeypatch.setenv("INTERPRETER_PROVIDER", provider)
    monkeypatch.setenv("OPENAI_API_KEY", key)
    origin = "chrome-extension://" + "a" * 32
    with TestClient(create_app(), base_url="http://127.0.0.1:8765") as client:
        auth = client.post("/sessions", headers={"origin": origin}).json()
        with client.websocket_connect(
            "ws://127.0.0.1:8765/audio", headers={"origin": origin}
        ) as socket:
            socket.send_json(auth)
            event = socket.receive_json()
            if provider == "openai-direct":
                assert event["type"] == "ready"
                event = socket.receive_json()
            assert event["type"] == "error" and expected in event["message"]
            assert "fixture-secret" not in repr(event)
            with pytest.raises(WebSocketDisconnect):
                socket.receive_json()
        assert client.post("/sessions", headers={"origin": origin}).status_code == 200


def test_long_unpunctuated_stream_has_bounded_lossless_cues(monkeypatch):
    text = "긴생성문장 " * 100

    async def handler(socket):
        await configure(socket)
        assert (
            json.loads(await socket.recv())["type"]
            == "session.input_audio_buffer.append"
        )
        assert json.loads(await socket.recv()) == {"type": "session.close"}
        for chunk in (text[:117], text[117:333], text[333:]):
            await send(
                socket,
                {
                    "type": "session.output_transcript.delta",
                    "delta": chunk,
                },
            )
        await send(socket, {"type": "session.closed"})

    async def check():
        events = [
            e async for e in DirectSession("test", "fixture-secret", "ko").run(audio(1))
        ]
        captions = [e.caption for e in events if e.caption]
        assert all(len(c.translation) <= 160 for c in captions)
        assert all(c.audio_end_ms == 20 for c in captions)
        assert "".join(c.translation for c in captions if c.final) == text
        assert len({c.utterance_id for c in captions}) == 4

    asyncio.run(fixture(monkeypatch, handler, check))


def test_stop_drains_protocol_discards_late_results_and_stops_pcm(monkeypatch):
    draining = asyncio.Event()
    sent_closed = asyncio.Event()
    events = []

    async def handler(socket):
        await configure(socket)
        event = json.loads(await socket.recv())
        assert event["type"] == "session.input_audio_buffer.append"
        draining.set()
        assert json.loads(await socket.recv()) == {"type": "session.close"}
        await send(
            socket,
            {
                "type": "session.output_transcript.delta",
                "delta": "늦은 결과",
            },
        )
        await asyncio.sleep(0.02)
        await send(socket, {"type": "session.closed"})
        sent_closed.set()
        await socket.wait_closed()

    async def check():
        session = DirectSession("stop", "fixture-secret", "ko")
        paused = asyncio.Event()

        async def stream():
            async for frame in audio(1):
                yield frame
            await paused.wait()
            raise AssertionError("Stop must cancel the audio iterator")

        async def collect():
            async for event in session.run(stream()):
                events.append(event)

        task = asyncio.create_task(collect())
        await draining.wait()
        await session.close()
        await asyncio.gather(task, return_exceptions=True)
        assert sent_closed.is_set()
        assert [e.type for e in events] == ["status"]
        assert session.socket is session.sender is session.task is None

    asyncio.run(fixture(monkeypatch, handler, check))


@pytest.mark.parametrize(
    "code, message",
    [
        ("model_not_found", "access denied"),
        ("rate_limit_exceeded", "limit reached"),
        ("invalid_event", "failed"),
    ],
)
def test_provider_errors_are_sanitized_and_do_not_become_captions(
    monkeypatch, code, message
):
    async def handler(socket):
        await send(socket, {"type": "session.created"})
        await socket.recv()
        await send(
            socket,
            {
                "type": "error",
                "error": {
                    "code": code,
                    "message": "fixture-secret and private provider body",
                },
            },
        )
        assert json.loads(await socket.recv()) == {"type": "session.close"}
        await send(socket, {"type": "session.closed"})

    async def check():
        events = [
            e async for e in DirectSession("test", "fixture-secret", "ko").run(audio(1))
        ]
        assert len(events) == 1 and events[0].type == "error"
        assert message in events[0].message
        assert "fixture-secret" not in repr(events)
        assert "private provider body" not in repr(events)

    asyncio.run(fixture(monkeypatch, handler, check))


def test_missing_key_never_connects_or_falls_back(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Missing key must not call any inference service")

    monkeypatch.setattr(direct, "connect", forbidden)

    async def check():
        events = [e async for e in DirectSession("test", "", "ko").run(audio(1))]
        assert len(events) == 1 and events[0].type == "error"
        assert "OPENAI_API_KEY" in events[0].message

    asyncio.run(check())


@pytest.mark.parametrize(
    "event",
    [
        {"type": "session.output_transcript.delta", "delta": 42},
        "bad json",
        {"type": "session.closed"},
        "disconnect",
    ],
)
def test_malformed_or_disconnected_session_is_visible_failure(monkeypatch, event):
    async def handler(socket):
        await configure(socket)
        if event == "disconnect":
            await socket.close()
            return
        if event == "bad json":
            await socket.send("{")
        else:
            await send(socket, event)
        try:
            while json.loads(await socket.recv())["type"] != "session.close":
                pass
            await send(socket, {"type": "session.closed"})
        except ConnectionClosed:
            pass

    async def check():
        session = DirectSession("test", "fixture-secret", "ko")

        async def waiting():
            async for frame in audio(1):
                yield frame
            await asyncio.Event().wait()

        events = [e async for e in session.run(waiting())]
        assert [e.type for e in events] == ["status", "error"]
        assert session.socket is session.sender is None

    asyncio.run(fixture(monkeypatch, handler, check))
