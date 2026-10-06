import asyncio
import json

import httpx
import pytest

from server.sessions.contracts import Transcript
from server.sessions.local import OllamaTranslator

TRANSCRIPT = Transcript("u1", 1, "Generated speech", True, 100, 900)


def record(text="", done=False, **extra):
    return (
        json.dumps({"message": {"content": text}, "done": done, **extra}) + "\n"
    ).encode()


class Stream(httpx.AsyncByteStream):
    def __init__(self, chunks, gate=None):
        self.chunks = chunks
        self.gate = gate
        self.closed = False

    async def __aiter__(self):
        for index, chunk in enumerate(self.chunks):
            if index == 1 and self.gate:
                await self.gate.wait()
            yield chunk

    async def aclose(self):
        self.closed = True


async def translator_for(stream, requests):
    def reply(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, stream=stream)

    translator = OllamaTranslator("qwen3:4b-instruct", "English", "Korean")
    await translator.client.aclose()
    translator.client = httpx.AsyncClient(
        transport=httpx.MockTransport(reply), base_url="http://127.0.0.1:11434"
    )
    return translator


def test_first_partial_arrives_before_response_completes_and_one_request_updates_cue():
    async def check():
        gate = asyncio.Event()
        requests = []
        stream = Stream(
            [record("오늘"), record("은 맑습니다."), record(done=True)], gate
        )
        translator = await translator_for(stream, requests)
        iterator = translator.translate(TRANSCRIPT, [])
        try:
            first = await asyncio.wait_for(anext(iterator), 1)
            assert not gate.is_set()
            assert (first.utterance_id, first.revision, first.text, first.final) == (
                "u1",
                1,
                "오늘",
                False,
            )
            gate.set()
            rest = [t async for t in iterator]
            assert [(t.revision, t.text, t.final) for t in rest] == [
                (2, "오늘은 맑습니다.", False),
                (3, "오늘은 맑습니다.", True),
            ]
            assert len(requests) == 1
            assert requests[0]["stream"] is True
            assert stream.closed
        finally:
            await iterator.aclose()
            await translator.close()

    asyncio.run(check())


def test_stop_cancels_pending_stream_closes_connection_and_rejects_new_work():
    async def check():
        gate = asyncio.Event()
        requests = []
        stream = Stream([record("공원"), record("에 갑니다.", True)], gate)
        translator = await translator_for(stream, requests)
        partial = asyncio.Event()
        values = []

        async def collect():
            async for value in translator.translate(TRANSCRIPT, []):
                values.append(value)
                partial.set()

        task = asyncio.create_task(collect())
        try:
            await asyncio.wait_for(partial.wait(), 1)
            await asyncio.wait_for(translator.cancel(), 1)
            gate.set()
            await asyncio.gather(task, return_exceptions=True)
            assert len(values) == 1 and not values[0].final
            assert stream.closed
            assert [t async for t in translator.translate(TRANSCRIPT, [])] == []
            assert len(requests) == 1
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await translator.close()

    asyncio.run(check())


@pytest.mark.parametrize(
    "chunks",
    [
        [record("미완료")],
        [record("미완료", True, done_reason="length")],
        [record(done=True)],
        [b'{"error":"model failed"}\n'],
        [b"not json\n"],
        [b'{"message":{"content":42},"done":false}\n'],
        [b'{"message":{"content":"text"}}\n'],
    ],
)
def test_incomplete_or_malformed_stream_never_becomes_final(chunks):
    async def check():
        stream = Stream(chunks)
        translator = await translator_for(stream, [])
        values = []
        try:
            with pytest.raises(RuntimeError):
                async for value in translator.translate(TRANSCRIPT, []):
                    values.append(value)
            assert not any(t.final for t in values)
            assert stream.closed
        finally:
            await translator.close()

    asyncio.run(check())


def test_fragmented_utf8_blank_lines_and_terminal_content_preserve_long_translation():
    async def check():
        text = "긴 번역의 모든 글자를 보존합니다. " * 30
        payload = (
            b"\n" + record(text[:20]) + record(text[20:], True, done_reason="stop")
        )
        # Split network bytes through multibyte characters and JSON line boundaries.
        stream = Stream([payload[i : i + 7] for i in range(0, len(payload), 7)])
        translator = await translator_for(stream, [])
        try:
            values = [t async for t in translator.translate(TRANSCRIPT, [])]
            assert values[-1].text == text.strip()
            assert values[-1].final
            assert [t.revision for t in values] == [1, 2]
            assert stream.closed
        finally:
            await translator.close()

    asyncio.run(check())


def test_cancel_rejects_late_provider_bytes_even_if_transport_swallows_cancellation():
    async def check():
        waiting = asyncio.Event()

        class LateStream(Stream):
            async def __aiter__(self):
                yield record("공원")
                waiting.set()
                try:
                    await asyncio.Event().wait()
                except asyncio.CancelledError:
                    yield record("에 갑니다.", True)

        stream = LateStream([])
        translator = await translator_for(stream, [])
        values = []

        async def collect():
            async for value in translator.translate(TRANSCRIPT, []):
                values.append(value)

        task = asyncio.create_task(collect())
        try:
            await asyncio.wait_for(waiting.wait(), 1)
            await asyncio.wait_for(translator.cancel(), 1)
            await task
            assert len(values) == 1 and not values[0].final
            assert stream.closed
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await translator.close()

    asyncio.run(check())


def test_partial_captions_do_not_enter_context_or_trigger_extra_translation_requests():
    from server.sessions.local import LocalSession

    async def check():
        requests = []

        def reply(request):
            requests.append(json.loads(request.content))
            return httpx.Response(
                200,
                stream=Stream(
                    [record("오늘"), record("은 맑아요."), record(done=True)]
                ),
            )

        translator = OllamaTranslator("fixture", "English", "Korean")
        await translator.client.aclose()
        translator.client = httpx.AsyncClient(
            transport=httpx.MockTransport(reply), base_url="http://127.0.0.1:11434"
        )

        class ASR:
            async def transcribe(self, _frames):
                yield Transcript("1", 0, "Unfinished", False, 100, 900)
                yield Transcript("1", 1, "Weather", True, 100, 900)
                yield Transcript("2", 1, "Park", True, 1000, 1900)

            async def close(self):
                pass

        captions = [
            e.caption
            async for e in LocalSession("new", ASR(), translator).run(None)
            if e.caption
        ]
        assert len(requests) == 2
        assert [c.utterance_id for c in captions] == ["1"] * 3 + ["2"] * 3
        assert [c.revision for c in captions] == [1, 2, 3, 1, 2, 3]
        assert [c.final for c in captions] == [False, False, True] * 2
        assert all(c.session_id == "new" for c in captions)
        assert requests[1]["messages"][1:3] == [
            {"role": "user", "content": "Weather"},
            {"role": "assistant", "content": "오늘은 맑아요."},
        ]

    asyncio.run(check())


def test_trickling_stream_has_a_whole_request_deadline():
    async def check():
        class Trickle(Stream):
            async def __aiter__(self):
                for _ in range(400):
                    await asyncio.sleep(0.1)
                    yield record("가")
                yield record(done=True)

        stream = Trickle([])
        translator = await translator_for(stream, [])
        values = []
        try:
            with pytest.raises(RuntimeError, match="timed out"):
                async with asyncio.timeout(33):
                    async for value in translator.translate(TRANSCRIPT, []):
                        values.append(value)
            assert values and not any(value.final for value in values)
            assert stream.closed
        finally:
            await translator.close()

    asyncio.run(check())
