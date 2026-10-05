import asyncio
import json
import os
import re
import secrets
import struct
import time
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect

from server.capture.pcm import FRAME_SAMPLES, decode_frame


def capture_router() -> APIRouter:
    router = APIRouter()
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
            frames = 0
            peak = 0
            while True:
                message = await asyncio.wait_for(websocket.receive(), timeout=5)
                if message["type"] == "websocket.disconnect":
                    return
                packet = message.get("bytes")
                if packet is None:
                    raise ValueError("Audio must be binary raw PCM16 frames.")
                frame = decode_frame(packet, frames)
                peak = max(
                    peak,
                    max(
                        abs(sample[0]) for sample in struct.iter_unpack("<h", frame.pcm)
                    ),
                )
                frames += 1
                if frames == 1 or frames % 50 == 0:
                    await websocket.send_json(
                        {
                            "type": "receipt",
                            "sessionId": session_id,
                            "frames": frames,
                            "samples": frames * FRAME_SAMPLES,
                            "peak": peak,
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

    return router
