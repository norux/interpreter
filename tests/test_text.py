import asyncio
import json

import httpx
import pytest

from server.sessions.contracts import Transcript
from server.sessions.local import LocalSession, MlxTranscriber, OllamaTranslator
from server.sessions.selection import text_session
from server.sessions.text import CloudTranslator


def reply(provider, text="생성한 시험 번역"):
    if provider == "luna":
        return {
            "status": "completed",
            "output": [
                {"type": "message", "content": [{"type": "output_text", "text": text}]}
            ],
        }
    return {"stop_reason": "end_turn", "content": [{"type": "text", "text": text}]}


async def translator_fixture(provider, handler):
    translator = CloudTranslator(
        provider, "fixture-secret", "selected-id", "English", "Korean"
    )
    await translator.client.aclose()
    translator.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return translator


async def empty_audio():
    if False:
        yield


@pytest.mark.parametrize("provider", ["luna", "anthropic"])
def test_asr_to_text_api_same_caption_final_only_bounded_context(provider):
    async def check():
        calls = []

        def handler(request):
            calls.append(request)
            return httpx.Response(200, json=reply(provider))

        class ASR:
            async def transcribe(self, _audio):
                yield Transcript("u0", 1, "Partial speech", False, 20, 1000)
                for i in range(5):
                    yield Transcript(
                        f"u{i}", 2, f"Generated speech {i}", True, 20, 1000
                    )

            async def close(self):
                pass

        translator = await translator_fixture(provider, handler)
        events = [
            e
            async for e in LocalSession("session", ASR(), translator).run(empty_audio())
        ]
        captions = [e.caption for e in events if e.caption]
        assert len(calls) == len(captions) == 5
        assert [c.utterance_id for c in captions] == [f"u{i}" for i in range(5)]
        assert all(c.session_id == "session" and c.final for c in captions)
        assert all(c.translation == "생성한 시험 번역" for c in captions)
        assert captions[-1].source == "Generated speech 4"
        assert (captions[-1].audio_start_ms, captions[-1].audio_end_ms) == (20, 1000)
        assert translator.client.is_closed
        payloads = [json.loads(r.content) for r in calls]
        payload = payloads[-1]
        assert payload["model"] == "selected-id"
        assert payload["stream"] is False
        messages = payload["input" if provider == "luna" else "messages"]
        assert len(messages) == 7
        assert messages[0]["content"] == "Generated speech 1"
        assert messages[-1] == {"role": "user", "content": "Generated speech 4"}
        assert all(
            isinstance(m["content"], str)
            for p in payloads
            for m in p.get("input", p.get("messages"))
        )
        assert "audio" not in json.dumps(payloads)
        assert "fixture-secret" not in str(events)
        if provider == "luna":
            assert str(calls[0].url) == "https://api.openai.com/v1/responses"
            assert calls[0].headers["Authorization"] == "Bearer fixture-secret"
            assert payload["reasoning"] == {"effort": "none"}
            assert payload["store"] is False
            assert payload["max_output_tokens"] == 256
            assert "Korean" in payload["instructions"]
        else:
            assert str(calls[0].url) == "https://api.anthropic.com/v1/messages"
            assert calls[0].headers["x-api-key"] == "fixture-secret"
            assert calls[0].headers["anthropic-version"] == "2023-06-01"
            assert payload["max_tokens"] == 256
            assert "Korean" in payload["system"]

    asyncio.run(check())


@pytest.mark.parametrize("provider", ["luna", "anthropic"])
@pytest.mark.parametrize(
    "failure, expected",
    [
        (401, "access denied"),
        (403, "access denied"),
        (404, "access denied"),
        (429, "limit reached"),
        (500, "unavailable"),
        ("timeout", "timed out"),
        ("disconnect", "unavailable"),
        ("invalid", "invalid"),
        ("empty", "empty"),
        ("incomplete", "incomplete"),
    ],
)
def test_text_errors_sanitized_no_fallback(provider, failure, expected):
    async def check():
        calls = []

        def handler(request):
            calls.append(request)
            if failure == "timeout":
                raise httpx.ReadTimeout("fixture-secret raw audio", request=request)
            if failure == "disconnect":
                raise httpx.ConnectError("fixture-secret raw audio", request=request)
            if isinstance(failure, int):
                return httpx.Response(
                    failure, json={"error": "fixture-secret raw audio"}
                )
            body = reply(provider, "" if failure == "empty" else "시험")
            if failure == "incomplete":
                body["status" if provider == "luna" else "stop_reason"] = "max_tokens"
            if failure == "invalid":
                body = {"content": None}
            return httpx.Response(200, json=body)

        translator = await translator_fixture(provider, handler)
        try:
            with pytest.raises(RuntimeError, match=expected) as error:
                _ = [
                    t
                    async for t in translator.translate(
                        Transcript("u", 1, "test", True, 0, 20), []
                    )
                ]
            assert "fixture-secret" not in str(error.value)
            assert "raw audio" not in str(error.value)
            assert len(calls) == 1
        finally:
            await translator.close()

    asyncio.run(check())


@pytest.mark.parametrize("provider", ["luna", "anthropic"])
def test_text_cancel_inflight_suppresses_late_result(provider):
    async def check():
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def handler(_request):
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.set()
                # A provider completing during cancellation still must not emit.
                return httpx.Response(200, json=reply(provider))

        translator = await translator_fixture(provider, handler)

        async def collect():
            return [
                t
                async for t in translator.translate(
                    Transcript("u", 1, "speech", True, 0, 20), []
                )
            ]

        task = asyncio.create_task(collect())
        await started.wait()
        await translator.cancel()
        assert await asyncio.wait_for(task, 1) == []
        assert cancelled.is_set()
        await translator.close()
        assert translator.request is None and translator.client.is_closed
        assert await collect() == []

    asyncio.run(check())


@pytest.mark.parametrize("provider", ["luna", "anthropic"])
@pytest.mark.parametrize("missing", ["key", "model"])
def test_text_missing_setup_no_network(provider, missing):
    async def check():
        translator = await translator_fixture(
            provider, lambda _: pytest.fail("No network")
        )
        if missing == "key":
            translator.api_key = ""
        else:
            translator.model_id = ""
        try:
            with pytest.raises(RuntimeError, match="requires|INTERPRETER_TEXT_MODEL"):
                _ = [
                    t
                    async for t in translator.translate(
                        Transcript("u", 1, "x", True, 0, 20), []
                    )
                ]
        finally:
            await translator.close()

    asyncio.run(check())


@pytest.mark.parametrize("provider", ["local", "luna", "anthropic"])
@pytest.mark.parametrize("asr", ["local", "openai"])
def test_selection_models_and_server_keys(monkeypatch, provider, asr):
    from server.sessions.live import LiveTranscriber

    async def check():
        monkeypatch.setenv("INTERPRETER_ASR", asr)
        monkeypatch.setenv("OPENAI_API_KEY", "fixture-openai")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "fixture-anthropic")
        monkeypatch.setenv("INTERPRETER_ASR_MODEL", "chosen-asr")
        monkeypatch.setenv("INTERPRETER_TEXT_MODEL", "chosen-text")
        monkeypatch.setenv("INTERPRETER_ASR_LANGUAGE", "fr")
        session = text_session("s", object(), provider)
        assert isinstance(
            session.transcriber, MlxTranscriber if asr == "local" else LiveTranscriber
        )
        assert session.transcriber.model_id == "chosen-asr"
        assert session.translator.model_id == "chosen-text"
        if asr == "openai":
            assert session.transcriber.language == "fr"
            assert session.transcriber.api_key == "fixture-openai"
        if provider != "local":
            assert session.translator.api_key == (
                "fixture-openai" if provider == "luna" else "fixture-anthropic"
            )
        else:
            assert isinstance(session.translator, OllamaTranslator)
        await session.close()

    asyncio.run(check())


@pytest.mark.parametrize("provider", ["luna", "anthropic"])
@pytest.mark.parametrize("status", [200, 429, 403])
def test_companion_selected_local_asr_to_cloud_caption_and_error(
    monkeypatch, provider, status
):
    import struct

    from fastapi.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    from server.app import create_app
    from server.capture.pcm import HEADER
    from server.sessions import local

    monkeypatch.setenv("INTERPRETER_EXTENSION_ID", "a" * 32)
    monkeypatch.setenv("INTERPRETER_PROVIDER", provider)
    monkeypatch.setenv("INTERPRETER_ASR", "local")
    monkeypatch.setenv("INTERPRETER_TEXT_MODEL", "selected-text-model")
    monkeypatch.setenv("OPENAI_API_KEY", "fixture-secret")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fixture-secret")
    origin = "chrome-extension://" + "a" * 32
    calls = []

    class Segments(local.SpeechSegments):
        def __init__(self):
            super().__init__()
            self.vad = type(
                "Detector", (), {"is_speech": lambda _, pcm, rate: any(pcm)}
            )()

    def transcribe(_engine, utterance, _model, _language):
        assert utterance.end_ms == 800
        return "Generated ASR speech"

    async def post(_client, url, **kwargs):
        calls.append((url, kwargs))
        request = httpx.Request("POST", url)
        return httpx.Response(
            status,
            request=request,
            json=reply(provider)
            if status == 200
            else {"error": "fixture-secret raw speech"},
        )

    monkeypatch.setattr(local, "SpeechSegments", Segments)
    monkeypatch.setattr(local.MlxEngine, "prepare", lambda *_: None)
    monkeypatch.setattr(local.MlxEngine, "transcribe", transcribe)
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    with TestClient(create_app(), base_url="http://127.0.0.1:8765") as client:
        auth = client.post("/sessions", headers={"origin": origin}).json()
        with client.websocket_connect(
            "ws://127.0.0.1:8765/audio", headers={"origin": origin}
        ) as ws:
            ws.send_json(auth)
            assert ws.receive_json()["type"] == "ready"
            for i in range(65):
                pcm = struct.pack("<480h", *([1000 if 10 <= i < 40 else 0] * 480))
                ws.send_bytes(HEADER.pack(b"PCM1", 24000, i, i * 20, 480, 1, 1) + pcm)
            while (event := ws.receive_json())["type"] not in ("caption", "error"):
                pass
            assert "fixture-secret" not in json.dumps(event)
            if status == 200:
                caption = event["caption"]
                assert caption["sessionId"] == auth["sessionId"]
                assert caption["utteranceId"] == "1"
                assert caption["source"] == "Generated ASR speech"
                assert caption["translation"] == "생성한 시험 번역"
                assert caption["final"] is True
                assert caption["audioEndMs"] == 800
            else:
                expected = "limit reached" if status == 429 else "access denied"
                assert expected in event["message"]
                with pytest.raises(WebSocketDisconnect):
                    ws.receive_json()
        assert client.post("/sessions", headers={"origin": origin}).status_code == 200
    assert len(calls) == 1
    assert calls[0][1]["json"]["model"] == "selected-text-model"
    assert "audio" not in json.dumps(calls[0][1]["json"])
    assert "Generated ASR speech" in json.dumps(calls[0][1]["json"])


def test_selection_defaults_and_unknown_asr(monkeypatch):
    async def check():
        monkeypatch.delenv("INTERPRETER_TEXT_MODEL", raising=False)
        monkeypatch.delenv("INTERPRETER_ASR_MODEL", raising=False)
        monkeypatch.setenv("INTERPRETER_ASR", "openai")
        session = text_session("s", object(), "luna")
        assert session.transcriber.model_id == "gpt-live-transcribe"
        assert session.translator.model_id == "gpt-6-luna"
        await session.close()
        monkeypatch.setenv("INTERPRETER_ASR", "invalid")
        with pytest.raises(RuntimeError, match="Use local or openai"):
            text_session("s", object(), "luna")

    asyncio.run(check())
