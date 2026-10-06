import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from server.sessions import local
from server.sessions.contracts import Transcript, Translation
from tests.test_local import SpeechDetector, frame


@pytest.mark.parametrize("snapshot_frames", [25, 50])
def test_local_snapshots_arrive_during_speech_and_finalize_the_same_utterance(
    monkeypatch, snapshot_frames
):
    class Segments(local.SpeechSegments):
        def __init__(self):
            super().__init__()
            self.vad = SpeechDetector()

    monkeypatch.setattr(local, "SpeechSegments", Segments)
    monkeypatch.setattr(local.MlxTranscriber, "snapshot_frames", snapshot_frames)

    async def check():
        audio = asyncio.Queue()
        calls = []

        class Engine:
            executor = ThreadPoolExecutor(max_workers=1)

            def transcribe(self, utterance, *_):
                calls.append(utterance)
                return f"Speech through {utterance.end_ms}"

        async def frames():
            while (value := await audio.get()) is not None:
                yield value

        engine = Engine()
        transcriber = local.MlxTranscriber(engine, "fixture", "English", interim=True)
        iterator = transcriber.transcribe(frames())
        try:
            for i in range(25):
                audio.put_nowait(frame(i, True))
            first = await asyncio.wait_for(anext(iterator), 1)
            assert not first.final
            assert (first.audio_start_ms, first.audio_end_ms) == (0, 500)
            next_snapshot = asyncio.create_task(anext(iterator))
            for i in range(25, 50):
                audio.put_nowait(frame(i, True))
            if snapshot_frames == 50:
                await asyncio.sleep(0.02)
                assert not next_snapshot.done()
                assert len(calls) == 1
                for i in range(50, 75):
                    audio.put_nowait(frame(i, True))
            second = await asyncio.wait_for(next_snapshot, 1)
            assert not second.final
            assert second.utterance_id == first.utterance_id
            assert second.revision > first.revision
            second_end = 50 if snapshot_frames == 25 else 75
            third_end = 100 if snapshot_frames == 25 else 125
            assert second.audio_end_ms == second_end * 20
            for i in range(second_end, third_end):
                audio.put_nowait(frame(i, True))
            third = await asyncio.wait_for(anext(iterator), 1)
            assert not third.final
            assert third.utterance_id == first.utterance_id
            assert third.revision > second.revision
            assert third.audio_end_ms == third_end * 20
            for i in range(third_end, third_end + 15):
                audio.put_nowait(frame(i))
            final = await asyncio.wait_for(anext(iterator), 1)
            assert final.final
            assert final.utterance_id == first.utterance_id
            assert final.revision > third.revision
            assert final.audio_end_ms == third_end * 20
            assert [len(u.frames) for u in calls] == [
                25,
                second_end,
                third_end,
                third_end + 15,
            ]
            assert calls[1].frames[:25] == calls[0].frames
            assert transcriber.dropped_utterances == 0
            for i in range(third_end + 15, third_end + 40):
                audio.put_nowait(frame(i, True))
            restarted = await asyncio.wait_for(anext(iterator), 1)
            assert not restarted.final
            assert restarted.utterance_id != final.utterance_id
            assert restarted.audio_end_ms == (third_end + 40) * 20
            assert len(calls[-1].frames) == 25
            audio.put_nowait(None)
            assert [t async for t in iterator] == []
        finally:
            await iterator.aclose()
            await transcriber.close()
            engine.executor.shutdown()

    asyncio.run(check())


@pytest.mark.parametrize(
    "snapshot_frames,first_call,coalesced", [(25, 50, 9), (50, 25, 4)]
)
@pytest.mark.parametrize("final_queued", [False, True])
def test_slow_first_snapshot_is_emitted_even_when_its_final_queues(
    monkeypatch, snapshot_frames, first_call, coalesced, final_queued
):
    class Segments(local.SpeechSegments):
        def __init__(self):
            super().__init__()
            self.vad = SpeechDetector()

    monkeypatch.setattr(local, "SpeechSegments", Segments)
    monkeypatch.setattr(local.MlxTranscriber, "snapshot_frames", snapshot_frames)

    async def check():
        started = threading.Event()
        release = threading.Event()
        audio = asyncio.Queue()
        results = []
        calls = []

        class Engine:
            executor = ThreadPoolExecutor(max_workers=1)

            def transcribe(self, utterance, *_):
                calls.append(utterance)
                started.set()
                release.wait(3)
                return "Test speech"

        async def frames():
            while (value := await audio.get()) is not None:
                yield value

        engine = Engine()
        transcriber = local.MlxTranscriber(engine, "fixture", "English", interim=True)

        async def collect():
            async for value in transcriber.transcribe(frames()):
                results.append(value)

        task = asyncio.create_task(collect())
        try:
            for i in range(50):
                audio.put_nowait(frame(i, True))
            for _ in range(100):
                if started.is_set():
                    break
                await asyncio.sleep(0.01)
            assert started.is_set()
            for i in range(50, 250):
                audio.put_nowait(frame(i, True))
            if final_queued:
                for i in range(250, 265):
                    audio.put_nowait(frame(i))
            audio.put_nowait(None)
            await asyncio.sleep(0.02)
            assert len(calls) == 1
            assert transcriber.pending_audio_ms <= 8000
            release.set()
            await asyncio.wait_for(task, 1)
            last_call = 255 if final_queued else (250 if snapshot_frames == 25 else 225)
            assert [len(u.frames) for u in calls] == [first_call, last_call]
            # Preserve the first available text even when ASR is already behind.
            assert [t.final for t in results] == (
                [False, True] if final_queued else [False]
            )
            assert results[0].revision == 1
            assert results[0].audio_end_ms == first_call * 20
            if final_queued:
                assert results[-1].audio_end_ms == 5000
            assert len({t.utterance_id for t in results}) == 1
            assert transcriber.coalesced_snapshots == (
                coalesced if final_queued else coalesced - 1
            )
            assert transcriber.dropped_utterances == 0
        finally:
            release.set()
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            engine.executor.shutdown()

    asyncio.run(check())


@pytest.mark.parametrize("final_queued", [False, True])
def test_inflight_correction_remains_available_before_a_waiting_final(
    monkeypatch, final_queued
):
    class Segments(local.SpeechSegments):
        def __init__(self):
            super().__init__()
            self.vad = SpeechDetector()

    monkeypatch.setattr(local, "SpeechSegments", Segments)

    async def check():
        started = threading.Event()
        release = threading.Event()
        audio = asyncio.Queue()
        results = []
        calls = []

        class Engine:
            executor = ThreadPoolExecutor(max_workers=1)

            def transcribe(self, utterance, *_):
                calls.append(utterance)
                if len(calls) == 2:
                    started.set()
                    release.wait(3)
                return f"Speech through {utterance.end_ms}"

        async def frames():
            while (value := await audio.get()) is not None:
                yield value

        engine = Engine()
        transcriber = local.MlxTranscriber(engine, "fixture", "English", interim=True)
        iterator = transcriber.transcribe(frames())
        task = None
        try:
            for i in range(25):
                audio.put_nowait(frame(i, True))
            results.append(await asyncio.wait_for(anext(iterator), 1))

            async def collect():
                async for value in iterator:
                    results.append(value)

            task = asyncio.create_task(collect())
            for i in range(25, 50):
                audio.put_nowait(frame(i, True))
            for _ in range(100):
                if started.is_set():
                    break
                await asyncio.sleep(0.001)
            assert started.is_set()
            for i in range(50, 75):
                audio.put_nowait(frame(i, True))
            if final_queued:
                for i in range(75, 90):
                    audio.put_nowait(frame(i))
            audio.put_nowait(None)
            await asyncio.sleep(0.02)
            release.set()
            await asyncio.wait_for(task, 1)
            assert [t.audio_end_ms for t in results] == [500, 1000, 1500]
            assert [t.final for t in results] == (
                [False, False, True] if final_queued else [False, False, False]
            )
            assert [t.revision for t in results] == list(range(1, len(results) + 1))
            assert len({t.utterance_id for t in results}) == 1
            assert len(calls) == 3
            assert transcriber.coalesced_snapshots == (1 if final_queued else 0)
            assert transcriber.dropped_utterances == transcriber.pending_audio_ms == 0
        finally:
            release.set()
            if task:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await iterator.aclose()
            engine.executor.shutdown()

    asyncio.run(check())


def test_interim_translation_is_corrected_without_finalizing_or_reusing_old_context():
    async def check():
        incoming = asyncio.Queue()
        output = asyncio.Queue()
        calls = []

        class ASR:
            interim = True

            async def transcribe(self, _frames):
                while (value := await incoming.get()) is not None:
                    yield value

            async def cancel(self):
                incoming.put_nowait(None)

            async def close(self):
                pass

        class Translator:
            async def translate(self, transcript, context):
                calls.append((transcript, list(context)))
                text = "은행에서" if transcript.revision == 2 else transcript.text
                yield Translation(transcript.utterance_id, 1, text, False)
                yield Translation(transcript.utterance_id, 2, transcript.text, True)

            async def cancel(self):
                pass

            async def close(self):
                pass

        session = local.LocalSession("revisions", ASR(), Translator())

        async def collect():
            async for event in session.run(None):
                if event.caption:
                    await output.put(event.caption)

        task = asyncio.create_task(collect())
        try:
            incoming.put_nowait(Transcript("1", 1, "강가", False, 0, 1000))
            first = await asyncio.wait_for(output.get(), 1)
            completed = await asyncio.wait_for(output.get(), 1)
            assert not first.final and not completed.final
            incoming.put_nowait(
                Transcript("1", 2, "은행에서 돈을 인출", False, 0, 2000)
            )
            corrected = await asyncio.wait_for(output.get(), 1)
            assert corrected.utterance_id == first.utterance_id
            assert corrected.translation == "은행에서 돈을 인출"
            assert corrected.revision > first.revision
            assert not corrected.final
            # Repeated/older ASR snapshots must not launch duplicate translations.
            incoming.put_nowait(Transcript("1", 1, "뒤늦은 강가", False, 0, 1000))
            incoming.put_nowait(
                Transcript("1", 3, "은행에서  돈을 인출.", False, 0, 3000)
            )
            incoming.put_nowait(Transcript("1", 4, "은행에서 돈을 인출", True, 0, 3100))
            final = await asyncio.wait_for(output.get(), 1)
            assert final.final and final.revision > corrected.revision
            assert final.audio_end_ms == 3100
            assert len(calls) == 2
            assert all(context == [] for _, context in calls)
            incoming.put_nowait(Transcript("1", 5, "늦은 결과", False, 0, 3200))
            incoming.put_nowait(Transcript("2", 1, "다음 문장", True, 3200, 4000))
            await asyncio.wait_for(output.get(), 1)
            next_final = await asyncio.wait_for(output.get(), 1)
            assert next_final.utterance_id == "2" and next_final.final
            assert calls[-1][1] == [("은행에서 돈을 인출", "은행에서 돈을 인출")]
            incoming.put_nowait(None)
            await asyncio.wait_for(task, 1)
            assert output.empty()
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(check())


def test_new_source_cancels_obsolete_translation_even_if_it_returns_late_bytes():
    async def check():
        incoming = asyncio.Queue()
        output = asyncio.Queue()
        waiting = asyncio.Event()
        old_closed = asyncio.Event()

        class ASR:
            interim = True

            async def transcribe(self, _frames):
                while (value := await incoming.get()) is not None:
                    yield value

            async def cancel(self):
                incoming.put_nowait(None)

            async def close(self):
                pass

        class Translator:
            async def translate(self, transcript, _context):
                try:
                    if transcript.revision == 1:
                        yield Translation("1", 1, "강가", False)
                        waiting.set()
                        try:
                            await asyncio.Event().wait()
                        except asyncio.CancelledError:
                            yield Translation("1", 2, "늦은 강가", True)
                    else:
                        yield Translation("1", 1, "은행", True)
                finally:
                    if transcript.revision == 1:
                        old_closed.set()

            async def cancel(self):
                pass

            async def close(self):
                pass

        session = local.LocalSession("latest", ASR(), Translator())

        async def collect():
            async for event in session.run(None):
                if event.caption:
                    await output.put(event.caption)

        task = asyncio.create_task(collect())
        try:
            incoming.put_nowait(Transcript("1", 1, "bank", False, 0, 1000))
            first = await asyncio.wait_for(output.get(), 1)
            await asyncio.wait_for(waiting.wait(), 1)
            incoming.put_nowait(Transcript("1", 2, "bank account", True, 0, 2000))
            corrected = await asyncio.wait_for(output.get(), 1)
            assert corrected.final and corrected.translation == "은행"
            assert corrected.revision > first.revision
            assert old_closed.is_set()
            incoming.put_nowait(None)
            await asyncio.wait_for(task, 1)
            assert output.empty()
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(check())


@pytest.mark.parametrize("response_complete", [False, True])
def test_missing_asr_final_does_not_stall_the_next_finalized_utterance(
    response_complete,
):
    async def check():
        incoming = asyncio.Queue()
        output = asyncio.Queue()
        waiting = asyncio.Event()
        old_closed = asyncio.Event()
        calls = []

        class ASR:
            interim = True

            async def transcribe(self, _frames):
                while (value := await incoming.get()) is not None:
                    yield value

            async def close(self):
                pass

        class Translator:
            async def translate(self, transcript, context):
                calls.append((transcript.utterance_id, list(context)))
                if transcript.utterance_id == "1":
                    try:
                        yield Translation("1", 1, "임시 문장", response_complete)
                        waiting.set()
                        try:
                            await asyncio.Event().wait()
                        except asyncio.CancelledError:
                            yield Translation("1", 2, "뒤늦은 문장", True)
                    finally:
                        old_closed.set()
                else:
                    yield Translation(transcript.utterance_id, 1, "확정 문장", True)

            async def close(self):
                pass

        session = local.LocalSession("missing-final", ASR(), Translator())

        async def collect():
            async for event in session.run(None):
                if event.caption:
                    output.put_nowait(event.caption)
                assert event.type != "error"

        task = asyncio.create_task(collect())
        try:
            incoming.put_nowait(Transcript("1", 1, "Unfinished", False, 0, 1000))
            first = await asyncio.wait_for(output.get(), 1)
            assert not first.final
            if not response_complete:
                await asyncio.wait_for(waiting.wait(), 1)
            # MLX can return an empty final, which emits no Transcript for cue 1.
            incoming.put_nowait(Transcript("2", 1, "Next", False, 1500, 2500))
            if not response_complete:
                for _ in range(100):
                    if session.pending_translation_ms == 1000:
                        break
                    await asyncio.sleep(0.001)
                assert session.pending_translation_ms == 1000
                assert calls == [("1", [])] and not old_closed.is_set()
            incoming.put_nowait(Transcript("2", 2, "Next sentence", True, 1500, 3000))
            final = await asyncio.wait_for(output.get(), 1)
            while not final.final:
                assert final.utterance_id == "2"
                final = await asyncio.wait_for(output.get(), 1)
            assert final.utterance_id == "2" and final.final
            assert final.translation == "확정 문장"
            assert old_closed.is_set()
            assert calls[-1] == ("2", [])
            # Neither late ASR nor cancellation-resistant translation may revive 1.
            incoming.put_nowait(Transcript("1", 2, "Late unfinished", False, 0, 1000))
            incoming.put_nowait(None)
            await asyncio.wait_for(task, 1)
            assert output.empty()
            assert session.dropped_translations == session.pending_translation_ms == 0
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(check())


def test_slow_translation_bounds_finals_and_snapshots_cannot_evict_them():
    async def check():
        incoming = asyncio.Queue()
        started = asyncio.Event()
        release = asyncio.Event()
        calls = []
        events = []

        class ASR:
            interim = True

            async def transcribe(self, _frames):
                while (value := await incoming.get()) is not None:
                    yield value

            async def close(self):
                pass

        class Translator:
            async def translate(self, transcript, _context):
                calls.append(transcript.utterance_id)
                if transcript.utterance_id == "1":
                    started.set()
                    await release.wait()
                yield Translation(transcript.utterance_id, 1, "번역", True)

            async def close(self):
                pass

        session = local.LocalSession("pressure", ASR(), Translator())

        async def collect():
            async for event in session.run(None):
                events.append(event)

        task = asyncio.create_task(collect())
        try:
            incoming.put_nowait(Transcript("1", 1, "First", True, 0, 6000))
            await asyncio.wait_for(started.wait(), 1)
            for i in range(2, 7):
                incoming.put_nowait(
                    Transcript(str(i), 1, "Final", True, i * 6000, (i + 1) * 6000)
                )
            incoming.put_nowait(Transcript("7", 1, "Partial", False, 48000, 54000))
            incoming.put_nowait(Transcript("7", 2, "Last", True, 48000, 50000))
            incoming.put_nowait(None)
            for _ in range(100):
                if session.pending_translation_ms == 8000:
                    break
                await asyncio.sleep(0.001)
            assert session.pending_translation_ms == 8000
            assert session.dropped_translations == 4
            assert calls == ["1"]
            release.set()
            await asyncio.wait_for(task, 1)
            assert calls == ["1", "6", "7"]
            assert [e.caption.utterance_id for e in events if e.caption] == calls
            assert all(e.caption.final for e in events if e.caption)
            assert any("4 translation" in e.message for e in events)
            assert session.pending_translation_ms == 0
        finally:
            release.set()
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(check())


@pytest.mark.parametrize("stop", ["cancel", "close"])
def test_stop_interim_translation_drains_tasks_and_suppresses_late_completion(stop):
    async def check():
        waiting = asyncio.Event()
        closed = asyncio.Event()
        values = []

        class ASR:
            interim = True

            async def transcribe(self, _frames):
                yield Transcript("1", 1, "Unfinished", False, 0, 1000)
                await asyncio.Event().wait()

            async def cancel(self):
                pass

            async def close(self):
                pass

        class Translator:
            async def translate(self, _transcript, _context):
                try:
                    yield Translation("1", 1, "임시", False)
                    waiting.set()
                    try:
                        await asyncio.Event().wait()
                    except asyncio.CancelledError:
                        yield Translation("1", 2, "뒤늦은 완료", True)
                finally:
                    closed.set()

            async def cancel(self):
                pass

            async def close(self):
                pass

        session = local.LocalSession("stop", ASR(), Translator())

        async def collect():
            async for event in session.run(None):
                if event.caption:
                    values.append(event.caption)

        task = asyncio.create_task(collect())
        try:
            await asyncio.wait_for(waiting.wait(), 1)
            await asyncio.wait_for(getattr(session, stop)(), 1)
            assert task.done() and closed.is_set()
            assert len(values) == 1 and not values[0].final
            assert session.pending_translation_ms == 0
            assert session.revision_task is None
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(check())
