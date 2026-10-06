"""Numeric-only instrumentation for the real-browser acceptance companion."""

import json
import struct
import time
import weakref

from server.sessions.local import MlxEngine, MlxTranscriber

transcribers = weakref.WeakSet()
original_init = MlxTranscriber.__init__
original_transcribe = MlxEngine.transcribe
model_metrics = {}


def initialize(self, *args):
    original_init(self, *args)
    transcribers.add(self)


def transcribe(self, *args):
    started = time.monotonic()
    text = original_transcribe(self, *args)
    import mlx.core as mx

    model_metrics.update(
        asrMs=(time.monotonic() - started) * 1000,
        mlxActiveBytes=mx.get_active_memory(),
        mlxPeakBytes=mx.get_peak_memory(),
    )
    return text


MlxTranscriber.__init__ = initialize
MlxEngine.transcribe = transcribe

from server.app import app as companion  # noqa: E402


async def app(scope, receive, send):
    origin_ms = None

    async def measured_receive():
        nonlocal origin_ms
        message = await receive()
        packet = message.get("bytes")
        if origin_ms is None and packet and len(packet) >= 28:
            # Frame timestamps start at zero; reception includes that 20 ms frame.
            origin_ms = (
                time.time() * 1000 - struct.unpack_from("<d", packet, 12)[0] - 20
            )
        return message

    async def measured_send(message):
        if message["type"] == "websocket.send" and message.get("text"):
            reply = json.loads(message["text"])
            if reply.get("type") in ("receipt", "caption"):
                metric = {
                    "metric": reply["type"],
                    "sessionId": reply["sessionId"],
                    "atMs": time.time() * 1000,
                    "originMs": origin_ms,
                    **model_metrics,
                }
                if reply["type"] == "receipt":
                    metric.update(
                        frames=reply["frames"],
                        droppedFrames=reply.get("droppedFrames", 0),
                        droppedUtterances=reply.get("droppedUtterances", 0),
                        pendingAudioMs=max(
                            (t.pending_audio_ms for t in transcribers), default=0
                        ),
                    )
                else:
                    caption = reply["caption"]
                    metric.update(
                        utteranceId=caption["utteranceId"],
                        audioEndMs=caption["audioEndMs"],
                        emittedAtMs=caption["emittedAtMs"],
                    )
                print(json.dumps(metric), flush=True)
        await send(message)

    await companion(scope, measured_receive, measured_send)
