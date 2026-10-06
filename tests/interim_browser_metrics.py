"""Test-only snapshot comparison; transport/caption text is never logged here."""

import asyncio
import json
import os
import struct
import time
import weakref

from server.sessions.local import (
    LocalSession,
    MlxEngine,
    MlxTranscriber,
    OllamaTranslator,
)

phase = os.environ["INTERPRETER_INTERIM_PHASE"]
assert phase in ("before", "after")
trial = os.environ.get("INTERPRETER_INTERIM_TRIAL")
assert trial in (None, "interval500", "interval1000", "first500", "first300")
assert trial is None or phase == "after"
sessions = weakref.WeakSet()
current_session = None
original_init = MlxTranscriber.__init__
original_prepare = LocalSession.prepare
original_transcribe = MlxEngine.transcribe
original_translate = OllamaTranslator.translate
original_close = LocalSession.close


def emit(metric, session_id, **values):
    print(
        json.dumps(
            {
                "metric": metric,
                "sessionId": session_id,
                "atMs": time.time() * 1000,
                **values,
            }
        ),
        flush=True,
    )


def initialize(self, *args, **kwargs):
    # The control disables only snapshots; VAD, streaming and models stay identical.
    if phase == "before":
        kwargs["interim"] = False
    original_init(self, *args, **kwargs)
    if trial in ("interval500", "interval1000"):
        self.snapshot_frames = 25 if trial == "interval500" else 50
    if trial == "first500":
        self.first_snapshot_frames = 25
    if trial == "first300":
        self.first_snapshot_frames = 15


def set_session(session):
    global current_session
    current_session = session.session_id
    sessions.add(session)


async def prepare(self):
    set_session(self)
    started = time.monotonic()
    await original_prepare(self)
    emit(
        "prepare",
        self.session_id,
        prepareMs=(time.monotonic() - started) * 1000,
        snapshotMs=self.transcriber.snapshot_frames * 20,
        firstSnapshotMs=self.transcriber.first_snapshot_frames * 20,
        snapshotsEnabled=self.transcriber.interim,
        asrModel=self.transcriber.model_id,
        textModel=self.translator.model_id,
        source=self.transcriber.language,
        target=self.translator.target_language,
        translationOptions={
            "temperature": 0,
            "num_ctx": 4096,
            "num_predict": 256,
            "think": False,
        },
    )


def transcribe(self, utterance, *args):
    session_id = current_session
    started_at_ms = time.time() * 1000
    started = time.monotonic()
    emit("asrStart", session_id, startedAtMs=started_at_ms)
    text = original_transcribe(self, utterance, *args)
    import mlx.core as mx

    emit(
        "asr",
        session_id,
        startedAtMs=started_at_ms,
        audioStartMs=utterance.start_ms,
        audioEndMs=utterance.end_ms,
        audioMs=len(utterance.frames) * 20,
        inferenceMs=(time.monotonic() - started) * 1000,
        mlxActiveBytes=mx.get_active_memory(),
        mlxPeakBytes=mx.get_peak_memory(),
    )
    return text


async def translate(self, transcript, context):
    session_id = current_session
    started_at_ms = time.time() * 1000
    first_output_at_ms = None
    started = time.monotonic()
    complete = False
    emit(
        "translationStart",
        session_id,
        startedAtMs=started_at_ms,
        utteranceId=transcript.utterance_id,
        sourceRevision=transcript.revision,
        sourceFinal=transcript.final,
    )
    stream = original_translate(self, transcript, context)
    try:
        async for value in stream:
            if first_output_at_ms is None:
                first_output_at_ms = time.time() * 1000
            complete = value.final
            yield value
    finally:
        await stream.aclose()
        emit(
            "translation",
            session_id,
            startedAtMs=started_at_ms,
            firstOutputAtMs=first_output_at_ms,
            utteranceId=transcript.utterance_id,
            sourceRevision=transcript.revision,
            sourceFinal=transcript.final,
            responseComplete=complete,
            requestMs=(time.monotonic() - started) * 1000,
        )


async def close(self):
    await original_close(self)
    emit(
        "closed",
        self.session_id,
        cancelled=self.cancelled,
        pendingAudioMs=self.transcriber.pending_audio_ms,
        pendingTranslationMs=self.pending_translation_ms,
        readerActive=self.transcriber.reader is not None,
        inferenceAwaited=self.transcriber.inference is not None,
        translationActive=self.revision_task is not None,
    )


MlxTranscriber.__init__ = initialize
LocalSession.prepare = prepare
MlxEngine.transcribe = transcribe
OllamaTranslator.translate = translate
LocalSession.close = close

from server.app import app as companion  # noqa: E402


async def app(scope, receive, send):
    origin_ms = None

    async def measured_receive():
        nonlocal origin_ms
        message = await receive()
        packet = message.get("bytes")
        if origin_ms is None and packet and len(packet) >= 28:
            origin_ms = (
                time.time() * 1000 - struct.unpack_from("<d", packet, 12)[0] - 20
            )
        return message

    async def measured_send(message):
        if message["type"] == "websocket.send" and message.get("text"):
            reply = json.loads(message["text"])
            session_id = reply.get("sessionId")
            if reply["type"] == "caption":
                caption = reply["caption"]
                emit(
                    "caption",
                    session_id,
                    originMs=origin_ms,
                    **{
                        key: caption[key]
                        for key in (
                            "utteranceId",
                            "revision",
                            "final",
                            "audioStartMs",
                            "audioEndMs",
                        )
                    },
                )
            elif reply["type"] == "receipt":
                session = next(
                    (s for s in sessions if s.session_id == session_id), None
                )
                assert session is not None
                emit(
                    "receipt",
                    session_id,
                    frames=reply["frames"],
                    peak=reply.get("peak", 0),
                    droppedFrames=reply.get("droppedFrames", 0),
                    droppedUtterances=reply.get("droppedUtterances", 0),
                    droppedTranslations=session.dropped_translations,
                    pendingAudioMs=session.transcriber.pending_audio_ms,
                    pendingTranslationMs=session.pending_translation_ms,
                    coalescedSnapshots=session.transcriber.coalesced_snapshots,
                )
        await send(message)

    if scope["type"] != "websocket":
        await companion(scope, measured_receive, measured_send)
        return

    async def sample():
        while True:
            process = await asyncio.create_subprocess_exec(
                "ps",
                "-o",
                "rss=",
                "-p",
                str(os.getpid()),
                stdout=asyncio.subprocess.PIPE,
            )
            try:
                output, _ = await process.communicate()
            finally:
                await process.wait()
            assert process.returncode == 0
            session = next(
                (s for s in sessions if s.session_id == current_session), None
            )
            if session:
                emit(
                    "sample",
                    session.session_id,
                    processRssBytes=int(output.strip()) * 1024,
                    pendingAudioMs=session.transcriber.pending_audio_ms,
                    pendingTranslationMs=session.pending_translation_ms,
                    droppedUtterances=session.transcriber.dropped_utterances,
                    droppedTranslations=session.dropped_translations,
                    coalescedSnapshots=session.transcriber.coalesced_snapshots,
                )
            await asyncio.sleep(0.1)

    sampler = asyncio.create_task(sample())
    try:
        await companion(scope, measured_receive, measured_send)
    finally:
        sampler.cancel()
        try:
            await sampler
        except asyncio.CancelledError:
            pass
