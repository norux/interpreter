import struct

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from server.app import create_app
from server.capture.pcm import HEADER, decode_frame

ORIGIN = "chrome-extension://" + "a" * 32


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("INTERPRETER_EXTENSION_ID", "a" * 32)
    with TestClient(create_app(), base_url="http://127.0.0.1:8765") as connection:
        yield connection


def packet(sequence=0, **changes):
    fields = dict(
        magic=b"PCM1",
        rate=24000,
        sequence=sequence,
        timestamp=sequence * 20,
        count=480,
        version=1,
        channels=1,
    )
    fields.update(changes)
    return HEADER.pack(*fields.values()) + struct.pack("<480h", *([8192] * 480))


def credentials(client):
    response = client.post("/sessions", headers={"origin": ORIGIN})
    assert response.status_code == 200
    return response.json()


def test_origin_host_and_unconfigured_server_are_rejected(client, monkeypatch):
    for origin in ("https://example.com", "null", "chrome-extension://" + "b" * 32, ""):
        assert client.post("/sessions", headers={"origin": origin}).status_code == 403
        with pytest.raises(WebSocketDisconnect) as failure:
            with client.websocket_connect(
                "ws://127.0.0.1:8765/audio", headers={"origin": origin}
            ):
                pass
        assert failure.value.code == 1008
    assert (
        client.post(
            "/sessions", headers={"origin": ORIGIN, "host": "evil.test"}
        ).status_code
        == 403
    )
    monkeypatch.delenv("INTERPRETER_EXTENSION_ID")
    with TestClient(create_app(), base_url="http://127.0.0.1:8765") as unconfigured:
        assert (
            unconfigured.post("/sessions", headers={"origin": ORIGIN}).status_code
            == 403
        )


def test_real_transport_receives_binary_pcm_and_can_stop_and_restart(client):
    for _ in range(3):
        auth = credentials(client)
        with client.websocket_connect(
            "ws://127.0.0.1:8765/audio", headers={"origin": ORIGIN}
        ) as ws:
            ws.send_json(auth)
            assert ws.receive_json() == {
                "type": "ready",
                "sessionId": auth["sessionId"],
            }
            assert (
                client.post("/sessions", headers={"origin": ORIGIN}).status_code == 409
            )
            ws.send_bytes(packet())
            receipt = ws.receive_json()
            assert receipt == {
                "type": "receipt",
                "sessionId": auth["sessionId"],
                "frames": 1,
                "samples": 480,
                "peak": 8192,
            }
            for sequence in range(1, 50):
                ws.send_bytes(packet(sequence))
            assert ws.receive_json()["samples"] == 24000


def test_tokens_are_required_single_use_and_expire(client, monkeypatch):
    auth = credentials(client)
    with client.websocket_connect(
        "ws://127.0.0.1:8765/audio", headers={"origin": ORIGIN}
    ) as ws:
        ws.send_json({**auth, "token": "wrong"})
        with pytest.raises(WebSocketDisconnect) as failure:
            ws.receive_json()
        assert failure.value.code == 1008
    with client.websocket_connect(
        "ws://127.0.0.1:8765/audio", headers={"origin": ORIGIN}
    ) as ws:
        ws.send_json(auth)
        assert ws.receive_json()["type"] == "ready"
    with client.websocket_connect(
        "ws://127.0.0.1:8765/audio", headers={"origin": ORIGIN}
    ) as ws:
        ws.send_json(auth)
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()
    auth = credentials(client)
    from server.capture import transport

    original = transport.time.monotonic
    monkeypatch.setattr(transport.time, "monotonic", lambda: original() + 11)
    with client.websocket_connect(
        "ws://127.0.0.1:8765/audio", headers={"origin": ORIGIN}
    ) as ws:
        ws.send_json(auth)
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()


@pytest.mark.parametrize(
    "bad",
    [
        b"RIFF",
        packet()[:-1],
        packet() + b"\x00",
        packet(magic=b"RIFF"),
        packet(rate=48000),
        packet(channels=2),
        packet(version=2),
        packet(count=479),
        packet(sequence=1),
        packet(timestamp=float("nan")),
        packet(timestamp=20),
    ],
    ids=[
        "truncated",
        "unaligned",
        "oversized",
        "wav",
        "rate",
        "stereo",
        "version",
        "count",
        "sequence",
        "nan",
        "timestamp",
    ],
)
def test_invalid_pcm_closes_session_without_retaining_audio(client, bad):
    with pytest.raises(ValueError):
        decode_frame(bad, 0)
    auth = credentials(client)
    with client.websocket_connect(
        "ws://127.0.0.1:8765/audio", headers={"origin": ORIGIN}
    ) as ws:
        ws.send_json(auth)
        ws.receive_json()
        ws.send_bytes(bad)
        error = ws.receive_json()
        assert error["type"] == "error"
        assert error["sessionId"] == auth["sessionId"]
        with pytest.raises(WebSocketDisconnect) as failure:
            ws.receive_json()
        assert failure.value.code == 1003
    assert credentials(client)


def test_text_audio_is_rejected(client):
    auth = credentials(client)
    with client.websocket_connect(
        "ws://127.0.0.1:8765/audio", headers={"origin": ORIGIN}
    ) as ws:
        ws.send_json(auth)
        ws.receive_json()
        ws.send_text("not raw PCM")
        assert ws.receive_json()["type"] == "error"
        with pytest.raises(WebSocketDisconnect) as failure:
            ws.receive_json()
        assert failure.value.code == 1003
