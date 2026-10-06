import os

from server.sessions.live import LiveTranscriber
from server.sessions.local import (
    ASR_MODEL,
    TEXT_MODEL,
    LocalSession,
    MlxEngine,
    MlxTranscriber,
    OllamaTranslator,
)
from server.sessions.settings import LANGUAGES, SessionSettings
from server.sessions.text import CloudTranslator


def text_session(
    session_id: str,
    engine: MlxEngine,
    provider: str,
    settings: SessionSettings | None = None,
) -> LocalSession:
    source = os.environ.get("INTERPRETER_SOURCE_LANGUAGE", "English")
    target = os.environ.get("INTERPRETER_TARGET_LANGUAGE", "Korean")
    asr = os.environ.get("INTERPRETER_ASR", "local")
    if settings:
        source = LANGUAGES[settings.sourceLanguage]
        target = LANGUAGES[settings.targetLanguage]
        asr = settings.asr
    if asr == "local":
        transcriber = MlxTranscriber(
            engine,
            settings.asrModel
            if settings
            else os.environ.get("INTERPRETER_ASR_MODEL", ASR_MODEL),
            source,
        )
    elif asr == "openai":
        transcriber = LiveTranscriber(
            os.environ.get("OPENAI_API_KEY", ""),
            settings.asrModel
            if settings
            else os.environ.get("INTERPRETER_ASR_MODEL", "gpt-live-transcribe"),
            settings.sourceLanguage
            if settings
            else os.environ.get("INTERPRETER_ASR_LANGUAGE", "en"),
        )
    else:
        raise RuntimeError("Unknown INTERPRETER_ASR. Use local or openai.")
    if provider == "local":
        translator = OllamaTranslator(
            settings.textModel
            if settings
            else os.environ.get("INTERPRETER_TEXT_MODEL", TEXT_MODEL),
            source,
            target,
        )
    else:
        translator = CloudTranslator(
            provider,
            os.environ.get(
                "OPENAI_API_KEY" if provider == "luna" else "ANTHROPIC_API_KEY", ""
            ),
            settings.textModel
            if settings
            else os.environ.get(
                "INTERPRETER_TEXT_MODEL", "gpt-6-luna" if provider == "luna" else ""
            ),
            source,
            target,
        )
    return LocalSession(session_id, transcriber, translator)
