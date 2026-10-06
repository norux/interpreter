import asyncio
import base64
import json
import math
import os
import time

from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus, WebSocketException

from server.sessions.contracts import Caption, SessionEvent

ENDPOINT = "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate"


def provider_error(code):
    if code in (401, 403, "invalid_api_key", "permission_denied", "model_not_found"):
        return (
            "OpenAI translation access denied. Check the server key and model access."
        )
    if code in (429, "rate_limit_exceeded", "insufficient_quota"):
        return "OpenAI translation limit reached. Check API quota and retry later."
    return "OpenAI translation failed. Check model access and translation settings."


class DirectSession:
    def __init__(self, session_id: str, api_key: str, language: str):
        self.session_id = session_id
        self.api_key = api_key
        self.language = language
        self.socket = None
        self.task = None
        self.sender = None
        self.cancelled = False
        self.closing = False
        self.closed = asyncio.Event()
        self.send_error = ""
        self.audio_end_ms = 0.0
        self.cue_start_ms = 0.0
        self.cue_end_ms = 0.0
        self.cue_number = 1
        self.revision = 0
        self.text = ""

    async def receive(self):
        event = json.loads(await self.socket.recv())
        if not isinstance(event, dict):
            raise ValueError("Expected a translation event.")
        if event.get("type") == "error":
            error = event.get("error", {})
            raise RuntimeError(provider_error(error.get("code")))
        return event

    async def send(self, event):
        await asyncio.wait_for(self.socket.send(json.dumps(event)), timeout=5)

    async def request_close(self):
        if not self.closing:
            self.closing = True
            await self.send({"type": "session.close"})

    async def append_audio(self, frames):
        try:
            async for frame in frames:
                if self.cancelled or self.closing:
                    return
                await self.send(
                    {
                        "type": "session.input_audio_buffer.append",
                        "audio": base64.b64encode(frame.pcm).decode("ascii"),
                    }
                )
                self.audio_end_ms = frame.timestamp_ms + 20
            await self.request_close()
            await asyncio.wait_for(self.closed.wait(), timeout=5)
        except (TimeoutError, OSError, WebSocketException):
            self.send_error = "OpenAI translation stalled or disconnected. Start again."
            await self.socket.close()

    def caption(self, final):
        self.revision += 1
        return SessionEvent(
            "caption",
            self.session_id,
            Caption(
                self.session_id,
                f"direct-{self.cue_number}",
                self.revision,
                "",  # Direct audio translation doesn't require source transcription.
                self.text,
                final,
                self.cue_start_ms,
                self.cue_end_ms,
                time.time() * 1000,
            ),
        )

    def advance_cue(self):
        self.text = ""
        self.cue_number += 1
        self.revision = 0
        self.cue_start_ms = self.cue_end_ms

    async def run(self, frames):
        self.task = asyncio.current_task()
        try:
            if not self.api_key:
                raise RuntimeError(
                    "OpenAI direct requires OPENAI_API_KEY on the companion server."
                )
            self.socket = await connect(
                ENDPOINT,
                additional_headers={"Authorization": f"Bearer {self.api_key}"},
                proxy=None,
                open_timeout=10,
                close_timeout=1,
                max_queue=8,
                write_limit=32768,
            )
            created = await asyncio.wait_for(self.receive(), timeout=10)
            if created.get("type") != "session.created":
                raise ValueError("Missing translation session creation.")
            await self.send(
                {
                    "type": "session.update",
                    "session": {"audio": {"output": {"language": self.language}}},
                }
            )
            updated = await asyncio.wait_for(self.receive(), timeout=10)
            if updated.get("type") != "session.updated":
                raise ValueError("Missing translation configuration acknowledgement.")
            if updated["session"]["audio"]["output"]["language"] != self.language:
                raise ValueError("Translation output language was not accepted.")
            yield SessionEvent(
                "status", self.session_id, message="OpenAI direct translation ready."
            )
            self.sender = asyncio.create_task(self.append_audio(frames))
            while not self.cancelled:
                event = await self.receive()
                if event.get("type") == "session.closed":
                    self.closed.set()
                    if not self.closing:
                        raise RuntimeError("OpenAI translation ended. Start again.")
                    if self.text:
                        yield self.caption(True)
                    return
                if event.get("type") != "session.output_transcript.delta":
                    continue  # Translated audio is intentionally not played.
                delta = event["delta"]
                if not isinstance(delta, str):
                    raise ValueError("Invalid transcript delta.")
                elapsed = event.get("elapsed_ms")
                end = (
                    elapsed
                    if isinstance(elapsed, (int, float)) and math.isfinite(elapsed)
                    else self.audio_end_ms
                )
                self.cue_end_ms = max(self.cue_end_ms, end)
                # The API has no utterance/final event. Bound each local display cue,
                # preserving fragments exactly, even when timestamps are repeated.
                for character in delta:
                    self.text += character
                    if character in ".!?。！？\n" or len(self.text) >= 160:
                        yield self.caption(True)
                        self.advance_cue()
                if self.text:
                    yield self.caption(False)
        except InvalidStatus as error:
            if not self.cancelled:
                yield SessionEvent(
                    "error",
                    self.session_id,
                    message=provider_error(error.response.status_code),
                )
        except (ConnectionClosed, OSError, TimeoutError, WebSocketException):
            if not self.cancelled:
                yield SessionEvent(
                    "error",
                    self.session_id,
                    message=self.send_error
                    or ("OpenAI translation disconnected. Start again."),
                )
        except RuntimeError as error:
            if not self.cancelled:
                yield SessionEvent("error", self.session_id, message=str(error))
        except (ValueError, KeyError, TypeError):
            if not self.cancelled:
                yield SessionEvent(
                    "error",
                    self.session_id,
                    message="OpenAI translation returned an invalid protocol event.",
                )
        finally:
            await self.close()
            self.task = None

    async def cancel(self):
        self.cancelled = True
        if self.task and self.task is not asyncio.current_task():
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)

    async def close(self):
        await self.cancel()
        if self.sender:
            self.sender.cancel()
            await asyncio.gather(self.sender, return_exceptions=True)
            self.sender = None
        if self.socket:
            try:
                await self.request_close()
                # Stop discards drained captions but still follows the API lifecycle.
                async with asyncio.timeout(5):
                    while not self.closed.is_set():
                        event = await self.receive()
                        if event.get("type") == "session.closed":
                            self.closed.set()
            except (
                OSError,
                WebSocketException,
                TimeoutError,
                RuntimeError,
                ValueError,
                KeyError,
                TypeError,
            ):
                pass
            finally:
                await self.socket.close()
                self.socket = None


def direct_session(session_id: str) -> DirectSession:
    return DirectSession(
        session_id,
        os.environ.get("OPENAI_API_KEY", ""),
        os.environ.get("INTERPRETER_TARGET_LANGUAGE", "ko"),
    )
