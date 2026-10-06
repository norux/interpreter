import asyncio

import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.sessions.selection import text_session
from server.sessions.settings import SessionSettings

ORIGIN = "chrome-extension://" + "a" * 32
SETTINGS = {
    "provider": "local",
    "asr": "local",
    "sourceLanguage": "en",
    "targetLanguage": "ko",
    "asrModel": "mlx-community/Qwen3-ASR-0.6B-8bit",
    "textModel": "qwen3:4b-instruct",
}


@pytest.mark.parametrize("provider", ["local", "luna", "anthropic"])
@pytest.mark.parametrize("asr", ["local", "openai"])
def test_selection_uses_session_models_and_languages_with_server_only_keys(
    monkeypatch, provider, asr
):
    monkeypatch.setenv("INTERPRETER_TARGET_LANGUAGE", "Wrong environment default")
    monkeypatch.setenv("INTERPRETER_TEXT_MODEL", "wrong-model")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-fixture-secret")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-fixture-secret")
    settings = SessionSettings(
        **{
            **SETTINGS,
            "provider": provider,
            "asr": asr,
            "sourceLanguage": "ja",
            "targetLanguage": "fr",
            "textModel": "selected-model",
            "asrModel": "gpt-live-transcribe" if asr == "openai" else "selected-asr",
        }
    )
    session = text_session("selected-session", object(), provider, settings)
    assert session.transcriber.model_id == settings.asrModel
    assert session.transcriber.language == ("ja" if asr == "openai" else "Japanese")
    assert session.translator.model_id == "selected-model"
    if provider == "local":
        assert session.translator.source_language == "Japanese"
        assert session.translator.target_language == "French"
    else:
        assert session.translator.source == "Japanese"
        assert session.translator.target == "French"
        assert (
            session.translator.api_key
            == f"{'openai' if provider == 'luna' else provider}-fixture-secret"
        )
    assert "secret" not in settings.model_dump_json()
    asyncio.run(session.close())


@pytest.fixture
def connection(monkeypatch):
    monkeypatch.setenv("INTERPRETER_EXTENSION_ID", "a" * 32)
    with TestClient(create_app(), base_url="http://127.0.0.1:8765") as client:
        yield client


@pytest.mark.parametrize(
    "changes",
    [
        {"provider": "other"},
        {"asr": "other"},
        {"sourceLanguage": "zz"},
        {"targetLanguage": "zz"},
        {"textModel": ""},
        {"asrModel": "bad model"},
        {"textModel": "x" * 161},
        {"apiKey": "not-allowed"},
        {"baseUrl": "https://example.com"},
        {"asr": "openai", "asrModel": "not-live"},
        {"provider": "openai-direct", "textModel": "not-direct"},
    ],
)
def test_invalid_or_secret_settings_are_rejected(connection, changes):
    response = connection.post(
        "/sessions", headers={"origin": ORIGIN}, json={**SETTINGS, **changes}
    )
    assert response.status_code == 422
    # Invalid selections do not consume the capture slot.
    assert (
        connection.post(
            "/sessions", headers={"origin": ORIGIN}, json=SETTINGS
        ).status_code
        == 200
    )


@pytest.mark.parametrize("provider", ["local", "luna", "anthropic", "openai-direct"])
def test_authenticated_settings_bound_to_token_not_websocket_or_environment(
    connection, monkeypatch, provider
):
    from server.capture import transport

    selected = []

    class Session:
        async def run(self, frames):
            async for _ in frames:
                if False:
                    yield

        async def close(self):
            pass

    def text_factory(session_id, engine, selected_provider, settings):
        selected.append(
            (session_id, selected_provider, settings.targetLanguage, settings.textModel)
        )
        return Session()

    def direct_factory(session_id, key, language):
        assert key == "server-fixture-secret"
        selected.append(
            (session_id, "openai-direct", language, "gpt-realtime-translate")
        )
        return Session()

    monkeypatch.setattr(transport, "text_session", text_factory)
    monkeypatch.setattr(transport, "DirectSession", direct_factory)
    monkeypatch.setenv("OPENAI_API_KEY", "server-fixture-secret")
    monkeypatch.setenv("INTERPRETER_PROVIDER", "wrong-environment-provider")
    settings = {
        **SETTINGS,
        "provider": provider,
        "targetLanguage": "ja",
        "textModel": "gpt-realtime-translate"
        if provider == "openai-direct"
        else "selected-text",
    }
    for _ in range(2):
        response = connection.post(
            "/sessions", headers={"origin": ORIGIN}, json=settings
        )
        assert response.status_code == 200
        assert set(response.json()) == {"sessionId", "token"}
        assert "server-fixture-secret" not in response.text
        auth = response.json()
        with connection.websocket_connect(
            "ws://127.0.0.1:8765/audio", headers={"origin": ORIGIN}
        ) as ws:
            ws.send_json({**auth, "provider": "wrong-websocket-provider"})
            assert ws.receive_json() == {
                "type": "ready",
                "sessionId": auth["sessionId"],
            }
        assert selected[-1] == (
            auth["sessionId"],
            provider,
            "ja",
            settings["textModel"],
        )
    assert selected[0][0] != selected[1][0]
