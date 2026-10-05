from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal, Protocol

from server.capture.pcm import AudioFrame


@dataclass(frozen=True)
class Transcript:
    utterance_id: str
    revision: int
    text: str
    final: bool
    audio_start_ms: float
    audio_end_ms: float


@dataclass(frozen=True)
class Translation:
    utterance_id: str
    revision: int
    text: str
    final: bool


@dataclass(frozen=True)
class Caption:
    session_id: str
    utterance_id: str
    revision: int
    source: str
    translation: str
    final: bool
    audio_start_ms: float
    audio_end_ms: float
    emitted_at_ms: float


@dataclass(frozen=True)
class SessionEvent:
    type: Literal["caption", "status", "error", "clear"]
    session_id: str
    caption: Caption | None = None
    message: str = ""


class Transcriber(Protocol):
    def transcribe(
        self, frames: AsyncIterator[AudioFrame]
    ) -> AsyncIterator[Transcript]: ...

    async def cancel(self) -> None: ...

    async def close(self) -> None: ...


class TextTranslator(Protocol):
    def translate(
        self, transcript: Transcript, context: list[tuple[str, str]]
    ) -> AsyncIterator[Translation]: ...

    async def cancel(self) -> None: ...

    async def close(self) -> None: ...


class TranslationSession(Protocol):
    def run(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[SessionEvent]: ...

    async def cancel(self) -> None: ...

    async def close(self) -> None: ...
