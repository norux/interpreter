"""Numeric-only instrumentation for the real-browser acceptance companion."""

import json
import os
import struct
import time
import weakref

from server.sessions.local import (
    LocalSession,
    MlxEngine,
    MlxTranscriber,
    SpeechSegments,
)

# Controlled display baseline only, never a product setting or historical build.
baseline = os.environ.get("INTERPRETER_PAINT_BASELINE") == "1"
if baseline:
    SpeechSegments.silence_frames = 25

transcribers = weakref.WeakSet()
original_init = MlxTranscriber.__init__
original_transcribe = MlxEngine.transcribe
model_metrics = {}
lifecycle = os.environ.get("INTERPRETER_LIFECYCLE_METRICS") == "1"
lazy_start = os.environ.get("INTERPRETER_LAZY_START_BASELINE") == "1"
current_session = None


def lifecycle_metric(name, session_id):
    if lifecycle:
        print(
            json.dumps({
                "metric": name, "sessionId": session_id,
                "atMs": time.time() * 1000,
            }),
            flush=True,
        )


original_prepare = LocalSession.prepare


async def prepare(self):
    global current_session
    current_session = self.session_id
    lifecycle_metric("prepare.start", self.session_id)
    if not lazy_start:
        await original_prepare(self)
    lifecycle_metric("prepare.end", self.session_id)


if lifecycle:
    LocalSession.prepare = prepare


def initialize(self, *args, **kwargs):
    original_init(self, *args, **kwargs)
    transcribers.add(self)


def transcribe(self, *args):
    session_id = current_session
    lifecycle_metric("asr.start", session_id)
    started = time.monotonic()
    try:
        text = original_transcribe(self, *args)
    finally:
        lifecycle_metric("asr.end", session_id)
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
    session_id = None

    async def measured_receive():
        nonlocal origin_ms, session_id
        message = await receive()
        if lifecycle and scope["type"] == "websocket" and message.get("text"):
            session_id = json.loads(message["text"]).get("sessionId")
        if message["type"] == "websocket.disconnect":
            lifecycle_metric("disconnect", session_id)
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
            if reply.get("type") == "ready":
                lifecycle_metric("ready", reply["sessionId"])
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
                        revision=caption["revision"],
                        final=caption["final"],
                        audioEndMs=caption["audioEndMs"],
                        emittedAtMs=caption["emittedAtMs"],
                    )
                print(json.dumps(metric), flush=True)
                if baseline and reply["type"] == "caption" and not caption["final"]:
                    return
        await send(message)

    try:
        await companion(scope, measured_receive, measured_send)
    finally:
        if scope["type"] == "websocket":
            lifecycle_metric("session.end", session_id)
