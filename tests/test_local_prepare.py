import asyncio
import json
import threading

import httpx
import pytest

from server.sessions.local import (
    ASR_MODEL,
    TEXT_MODEL,
    LocalSession,
    MlxEngine,
    MlxTranscriber,
    OllamaTranslator,
)


def test_prepare_loads_selected_local_models_without_audio_or_translation():
    async def check():
        engine = MlxEngine()
        calls = []
        engine.prepare = lambda model: calls.append(
            (model, threading.current_thread().name)
        )
        translator = OllamaTranslator(TEXT_MODEL, "English", "Korean")
        await translator.client.aclose()

        def response(request):
            assert str(request.url) == "http://127.0.0.1:11434/api/chat"
            assert json.loads(request.content) == {
                "model": TEXT_MODEL,
                "messages": [],
                "stream": False,
                "options": {"num_ctx": 4096},
            }
            calls.append("ollama-load")
            return httpx.Response(200, json={"done": True, "done_reason": "load"})

        translator.client = httpx.AsyncClient(
            transport=httpx.MockTransport(response), base_url="http://127.0.0.1:11434"
        )
        session = LocalSession(
            "prepare", MlxTranscriber(engine, ASR_MODEL, "English"), translator
        )
        try:
            await session.prepare()
            assert calls[0][0] == ASR_MODEL
            assert calls[0][1].startswith("mlx-asr")
            assert calls[1] == "ollama-load"
            assert session.transcriber.reader is None
            assert session.transcriber.pending_audio_ms == 0
        finally:
            await session.close()
            engine.close()

    asyncio.run(check())


@pytest.mark.parametrize("failed", [False, True])
def test_transport_ready_follows_preparation_and_failure_never_accepts_audio(
    monkeypatch, failed
):
    from fastapi.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    from server.app import create_app
    from server.capture import transport

    monkeypatch.setenv("INTERPRETER_EXTENSION_ID", "a" * 32)
    origin = "chrome-extension://" + "a" * 32
    prepared = threading.Event()

    def prepare(_engine, model):
        assert model == ASR_MODEL
        prepared.set()
        if failed:
            raise RuntimeError("Local ASR model is not cached: fixture.")

    class Translator:
        async def close(self):
            pass

    monkeypatch.setattr(MlxEngine, "prepare", prepare)
    monkeypatch.setattr(
        transport, "local_session", lambda sid, engine: LocalSession(
            sid, MlxTranscriber(engine, ASR_MODEL, "English"), Translator()
        )
    )
    with TestClient(create_app(), base_url="http://127.0.0.1:8765") as client:
        for _ in range(2):
            prepared.clear()
            auth = client.post("/sessions", headers={"origin": origin}).json()
            with client.websocket_connect(
                "ws://127.0.0.1:8765/audio", headers={"origin": origin}
            ) as ws:
                ws.send_json(auth)
                reply = ws.receive_json()
                assert prepared.is_set()
                assert reply["sessionId"] == auth["sessionId"]
                if failed:
                    assert reply["type"] == "error"
                    assert "not cached" in reply["message"]
                    with pytest.raises(WebSocketDisconnect):
                        ws.receive_json()
                else:
                    assert reply["type"] == "ready"


def test_disconnect_during_preparation_releases_slot_and_serializes_replacement(
    monkeypatch,
):
    from fastapi.testclient import TestClient

    from server.app import create_app
    from server.capture import transport

    monkeypatch.setenv("INTERPRETER_EXTENSION_ID", "a" * 32)
    origin = "chrome-extension://" + "a" * 32
    entered = threading.Event()
    released = threading.Event()
    calls = []

    def prepare(_engine, _model):
        calls.append(len(calls))
        entered.set()
        if len(calls) == 1:
            released.wait(5)

    class Translator:
        async def close(self):
            pass

    monkeypatch.setattr(MlxEngine, "prepare", prepare)
    monkeypatch.setattr(
        transport, "local_session", lambda sid, engine: LocalSession(
            sid, MlxTranscriber(engine, ASR_MODEL, "English"), Translator()
        )
    )
    try:
        with TestClient(create_app(), base_url="http://127.0.0.1:8765") as client:
            auth = client.post("/sessions", headers={"origin": origin}).json()
            with client.websocket_connect(
                "ws://127.0.0.1:8765/audio", headers={"origin": origin}
            ) as ws:
                ws.send_json(auth)
                assert entered.wait(1)
            assert not released.is_set()
            response = client.post("/sessions", headers={"origin": origin})
            assert response.status_code == 200
            with client.websocket_connect(
                "ws://127.0.0.1:8765/audio", headers={"origin": origin}
            ) as ws:
                ws.send_json(response.json())
                assert calls == [0], "Replacement must not overlap native preparation"
                released.set()
                assert ws.receive_json()["type"] == "ready"
                assert calls == [0, 1]
    finally:
        released.set()


@pytest.mark.parametrize(
    "failure, expected",
    [(404, "ollama pull"), (500, "failed"), ("connect", "ollama serve"),
     ("timeout", "timed out"), ("invalid", "failed")],
)
def test_ollama_preparation_errors_are_actionable(failure, expected):
    async def check():
        translator = OllamaTranslator("missing", "English", "Korean")
        await translator.client.aclose()

        def response(request):
            if failure == "connect":
                raise httpx.ConnectError("offline", request=request)
            if failure == "timeout":
                raise httpx.ReadTimeout("slow", request=request)
            return httpx.Response(
                failure if isinstance(failure, int) else 200, json={"done": False}
            )

        translator.client = httpx.AsyncClient(
            transport=httpx.MockTransport(response), base_url="http://127.0.0.1:11434"
        )
        try:
            with pytest.raises(RuntimeError, match=expected):
                await translator.prepare()
        finally:
            await translator.close()

    asyncio.run(check())


def test_stop_during_native_preparation_does_not_wait_or_start_translator():
    async def check():
        engine = MlxEngine()
        entered = threading.Event()
        released = threading.Event()

        def prepare(_model):
            entered.set()
            released.wait(5)

        engine.prepare = prepare
        translator = OllamaTranslator(TEXT_MODEL, "English", "Korean")

        async def forbidden():
            pytest.fail("Cancelled preparation must not load the next model")

        translator.prepare = forbidden
        session = LocalSession(
            "cancel", MlxTranscriber(engine, ASR_MODEL, "English"), translator
        )
        task = asyncio.create_task(session.prepare())
        try:
            for _ in range(100):
                if entered.is_set():
                    break
                await asyncio.sleep(0.01)
            assert entered.is_set()
            await asyncio.wait_for(session.cancel(), 1)
            await asyncio.wait_for(asyncio.gather(task, return_exceptions=True), 1)
            assert not released.is_set()
            assert session.cancelled
        finally:
            released.set()
            await session.close()
            engine.close()

    asyncio.run(check())
