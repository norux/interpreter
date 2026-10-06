import asyncio
import json
import os
import re
import secrets
import struct
import time
from contextlib import asynccontextmanager
from uuid import uuid4

from anyio import CancelScope
from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect

from server.capture.pcm import FRAME_SAMPLES, decode_frame
from server.sessions.direct import direct_session
from server.sessions.local import MlxEngine, local_session


def capture_router() -> APIRouter:
    engine = MlxEngine()

    @asynccontextmanager
    async def lifespan(app):
        yield
        await asyncio.to_thread(engine.close)

    router = APIRouter(lifespan=lifespan)
    extension_id = os.environ.get("INTERPRETER_EXTENSION_ID", "")
    if extension_id and not re.fullmatch(r"[a-p]{32}", extension_id):
        raise ValueError(
            "INTERPRETER_EXTENSION_ID must be Chrome's 32-letter extension ID."
        )
    origin = f"chrome-extension://{extension_id}" if extension_id else None
    pending: tuple[str, str, float] | None = None
    active = False

    def authorized(headers) -> bool:
        return (
            origin is not None
            and headers.get("origin") == origin
            and headers.get("host") == "127.0.0.1:8765"
        )

    @router.post("/sessions")
    async def create_session(request: Request) -> dict[str, str]:
        nonlocal pending
        if not authorized(request.headers):
            raise HTTPException(
                403, "Companion requires the configured extension origin."
            )
        if active:
            raise HTTPException(409, "Another capture session is active.")
        session_id, token = str(uuid4()), secrets.token_urlsafe(32)
        pending = (session_id, token, time.monotonic() + 10)
        return {"sessionId": session_id, "token": token}

    @router.websocket("/audio")
    async def receive_audio(websocket: WebSocket) -> None:
        nonlocal pending, active
        if not authorized(websocket.headers):
            await websocket.close(code=1008)
            return
        await websocket.accept()
        owns_session = False
        session_id = ""
        model_task = None
        session = None
        incoming = asyncio.Queue(maxsize=100)
        send_lock = asyncio.Lock()

        async def send(message):
            async with send_lock:
                await websocket.send_json(message)

        async def audio_frames():
            while True:
                yield await incoming.get()

        async def captions():
            try:
                async for event in session.run(audio_frames()):
                    if event.caption:
                        caption = event.caption
                        await send(
                            {
                                "type": "caption",
                                "sessionId": session_id,
                                "caption": {
                                    "sessionId": caption.session_id,
                                    "utteranceId": caption.utterance_id,
                                    "revision": caption.revision,
                                    "source": caption.source,
                                    "translation": caption.translation,
                                    "final": caption.final,
                                    "audioStartMs": caption.audio_start_ms,
                                    "audioEndMs": caption.audio_end_ms,
                                    "emittedAtMs": caption.emitted_at_ms,
                                },
                            }
                        )
                    else:
                        await send(
                            {
                                "type": event.type,
                                "sessionId": session_id,
                                "message": event.message,
                            }
                        )
                    if event.type == "error":
                        await websocket.close(
                            code=1011, reason="Translation unavailable"
                        )
                        return
            except (WebSocketDisconnect, RuntimeError):
                return

        try:
            auth = await asyncio.wait_for(websocket.receive_json(), timeout=5)
            if (
                not isinstance(auth, dict)
                or not pending
                or active
                or time.monotonic() > pending[2]
                or auth.get("sessionId") != pending[0]
                or not isinstance(auth.get("token"), str)
                or not secrets.compare_digest(auth["token"], pending[1])
            ):
                await websocket.close(
                    code=1008, reason="Invalid or expired session token"
                )
                return
            session_id = pending[0]
            pending = None
            active = owns_session = True
            await websocket.send_json({"type": "ready", "sessionId": session_id})
            provider = os.environ.get("INTERPRETER_PROVIDER", "local")
            if provider == "openai-direct":
                session = direct_session(session_id)
            elif provider == "local":
                session = local_session(session_id, engine)
            else:
                await send(
                    {
                        "type": "error",
                        "sessionId": session_id,
                        "message": (
                            "Unknown INTERPRETER_PROVIDER. Use local or openai-direct."
                        ),
                    }
                )
                await websocket.close(code=1008, reason="Unknown translation provider")
                return
            model_task = asyncio.create_task(captions())
            frames = 0
            dropped_frames = 0
            peak = 0
            while True:
                message = await asyncio.wait_for(websocket.receive(), timeout=5)
                if message["type"] == "websocket.disconnect":
                    return
                packet = message.get("bytes")
                if packet is None:
                    raise ValueError("Audio must be binary raw PCM16 frames.")
                frame = decode_frame(packet, frames)
                if incoming.full():
                    incoming.get_nowait()
                    dropped_frames += 1
                incoming.put_nowait(frame)
                peak = max(
                    peak,
                    max(
                        abs(sample[0]) for sample in struct.iter_unpack("<h", frame.pcm)
                    ),
                )
                frames += 1
                if frames == 1 or frames % 50 == 0:
                    dropped_utterances = getattr(
                        getattr(session, "transcriber", None), "dropped_utterances", 0
                    )
                    await send(
                        {
                            "type": "receipt",
                            "sessionId": session_id,
                            "frames": frames,
                            "samples": frames * FRAME_SAMPLES,
                            "peak": peak,
                            **(
                                {"droppedUtterances": dropped_utterances}
                                if dropped_utterances
                                else {}
                            ),
                            **(
                                {"droppedFrames": dropped_frames}
                                if dropped_frames
                                else {}
                            ),
                        }
                    )
        except (ValueError, KeyError, json.JSONDecodeError) as error:
            await websocket.send_json(
                {
                    "type": "error",
                    "sessionId": session_id,
                    "message": str(error),
                }
            )
            await websocket.close(code=1003, reason="Invalid audio protocol")
        except TimeoutError:
            await websocket.close(code=1008, reason="Audio session timed out")
        except WebSocketDisconnect:
            pass
        finally:
            if owns_session:
                active = False
            # ASGI disconnect cancellation must not interrupt provider drain/close.
            with CancelScope(shield=True):
                if model_task:
                    model_task.cancel()
                    await asyncio.gather(model_task, return_exceptions=True)
                if session:
                    await session.close()

    return router
