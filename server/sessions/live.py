import asyncio
import base64
import json

from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus, WebSocketException

from server.sessions.contracts import Transcript
from server.sessions.local import SpeechSegments, Utterance

ENDPOINT = "wss://api.openai.com/v1/realtime?intent=transcription"


def asr_error(code):
    if code in (401, 403, "invalid_api_key", "permission_denied", "model_not_found"):
        return "OpenAI ASR access denied. Check the server key and model access."
    if code in (429, "rate_limit_exceeded", "insufficient_quota"):
        return "OpenAI ASR limit reached. Check API quota and retry later."
    return "OpenAI ASR failed. Check model access and source language settings."


class LiveTranscriber:
    def __init__(self, api_key: str, model_id: str, language: str):
        self.api_key = api_key
        self.model_id = model_id
        self.language = language
        self.socket = None
        self.reader = None
        self.task = None
        self.cancelled = False
        self.dropped_utterances = 0
        self.pending_audio_ms = 0

    async def send(self, event):
        await asyncio.wait_for(self.socket.send(json.dumps(event)), 5)

    async def receive(self):
        event = json.loads(await self.socket.recv())
        if not isinstance(event, dict):
            raise ValueError("Invalid event")
        if event.get("type") == "error":
            raise RuntimeError(asr_error(event.get("error", {}).get("code")))
        if event.get("type") == "conversation.item.input_audio_transcription.failed":
            raise RuntimeError(asr_error(event.get("error", {}).get("code")))
        return event

    async def transcribe(self, frames):
        self.task = asyncio.current_task()
        segments = SpeechSegments()
        # Keep the existing live-transcription commit boundary.
        segments.silence_frames = 25
        segments.long_pause_frames = 0
        queue: asyncio.Queue[Utterance | None] = asyncio.Queue(maxsize=2)

        async def read():
            async for frame in frames:
                utterance = segments.push(frame)
                if utterance is None:
                    continue
                duration = len(utterance.frames) * 20
                while queue.full() or self.pending_audio_ms + duration > 8000:
                    old = queue.get_nowait()
                    self.pending_audio_ms -= len(old.frames) * 20
                    self.dropped_utterances += 1
                self.pending_audio_ms += duration
                queue.put_nowait(utterance)
            await queue.put(None)

        try:
            if not self.api_key:
                raise RuntimeError("OpenAI ASR requires OPENAI_API_KEY on the server.")
            if self.model_id != "gpt-live-transcribe":
                raise RuntimeError("OpenAI ASR supports gpt-live-transcribe only.")
            self.socket = await connect(
                ENDPOINT,
                additional_headers={"Authorization": f"Bearer {self.api_key}"},
                proxy=None,
                open_timeout=10,
                close_timeout=1,
                max_queue=8,
                write_limit=32768,
            )
            async with asyncio.timeout(10):
                if (await self.receive()).get("type") != "session.created":
                    raise ValueError("Missing session")
                await self.send(
                    {
                        "type": "session.update",
                        "session": {
                            "type": "transcription",
                            "audio": {
                                "input": {
                                    "format": {"type": "audio/pcm", "rate": 24000},
                                    "transcription": {
                                        "model": self.model_id,
                                        "languages": [self.language],
                                        "delay": "low",
                                    },
                                    "turn_detection": None,
                                }
                            },
                        },
                    }
                )
                updated = await self.receive()
                if updated.get("type") != "session.updated":
                    raise ValueError("Missing session update")
                settings = updated["session"]["audio"]["input"]
                if (
                    updated["session"]["type"] != "transcription"
                    or settings["format"] != {"type": "audio/pcm", "rate": 24000}
                    or settings["transcription"]["model"] != self.model_id
                    or settings.get("turn_detection") is not None
                ):
                    raise ValueError("ASR settings rejected")
            self.reader = asyncio.create_task(read())
            while not self.cancelled and (utterance := await queue.get()) is not None:
                self.pending_audio_ms -= len(utterance.frames) * 20
                # One committed turn at a time avoids out-of-order final cues.
                # Capture continues into the bounded speech queue during translation.
                item_id = None
                text = ""
                revision = 0
                async with asyncio.timeout(30):
                    for frame in utterance.frames:
                        await self.send(
                            {
                                "type": "input_audio_buffer.append",
                                "audio": base64.b64encode(frame.pcm).decode("ascii"),
                            }
                        )
                    await self.send({"type": "input_audio_buffer.commit"})
                    while not self.cancelled:
                        event = await self.receive()
                        kind = event.get("type")
                        if kind not in (
                            "input_audio_buffer.committed",
                            "conversation.item.input_audio_transcription.delta",
                            "conversation.item.input_audio_transcription.completed",
                        ):
                            continue
                        incoming_id = event["item_id"]
                        if not isinstance(incoming_id, str) or not incoming_id:
                            raise ValueError("Missing item ID")
                        if item_id is not None and incoming_id != item_id:
                            raise ValueError("Unexpected transcription item")
                        item_id = incoming_id
                        if kind == "input_audio_buffer.committed":
                            continue
                        final = kind.endswith(".completed")
                        fragment = event["transcript" if final else "delta"]
                        if not isinstance(fragment, str):
                            raise ValueError("Invalid transcript")
                        text = fragment if final else text + fragment
                        if len(text) > 4000:
                            raise ValueError("Transcript too long")
                        revision += 1
                        if final:
                            await self.send(
                                {"type": "conversation.item.delete", "item_id": item_id}
                            )
                            while True:
                                deleted = await self.receive()
                                if deleted.get("type") == "conversation.item.deleted":
                                    if deleted["item_id"] != item_id:
                                        raise ValueError("Unexpected deleted item")
                                    break
                        if text.strip() and not self.cancelled and not final:
                            yield Transcript(
                                item_id,
                                revision,
                                text.strip(),
                                final,
                                utterance.start_ms,
                                utterance.end_ms,
                            )
                        if final:
                            break
                if text.strip() and not self.cancelled:
                    yield Transcript(
                        item_id,
                        revision,
                        text.strip(),
                        True,
                        utterance.start_ms,
                        utterance.end_ms,
                    )
            await self.reader
        except InvalidStatus as error:
            raise RuntimeError(asr_error(error.response.status_code)) from error
        except (OSError, WebSocketException, TimeoutError) as error:
            raise RuntimeError(
                "OpenAI ASR stalled or disconnected. Start again."
            ) from error
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            raise RuntimeError(
                "OpenAI ASR returned an invalid protocol event."
            ) from error
        finally:
            await self.close()
            self.task = None

    async def cancel(self):
        self.cancelled = True
        if self.task and self.task is not asyncio.current_task():
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
        if self.reader:
            self.reader.cancel()
            await asyncio.gather(self.reader, return_exceptions=True)
            self.reader = None
        self.pending_audio_ms = 0

    async def close(self):
        await self.cancel()
        if self.socket:
            await self.socket.close()
            self.socket = None
