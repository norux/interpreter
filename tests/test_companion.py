import asyncio
import io
import json
import struct
import subprocess
import sys

from companion import runtime
from companion.runtime import ManagedServices, serve_native


def frame(message):
    data = json.dumps(message).encode()
    return struct.pack("@I", len(data)) + data


def test_stop_during_start_cancels_and_waits_for_cleanup():
    async def scenario():
        started = asyncio.Event()
        cancelled = asyncio.Event()

        class Services:
            closed = False

            async def start(self, local):
                assert local is True
                started.set()
                try:
                    await asyncio.Event().wait()
                finally:
                    cancelled.set()

            async def close(self):
                assert cancelled.is_set()
                self.closed = True

        reader = asyncio.StreamReader()
        output = io.BytesIO()
        services = Services()
        task = asyncio.create_task(serve_native(reader, output, services))
        reader.feed_data(frame({"type": "start", "localTranslation": True}))
        await started.wait()
        reader.feed_data(frame({"type": "stop"}))
        await asyncio.wait_for(task, 1)
        assert services.closed
        assert output.getvalue() == frame({"type": "stopped"})

    asyncio.run(scenario())


def test_eof_cancels_owned_start_without_resurrecting_it():
    async def scenario():
        started = asyncio.Event()

        class Services:
            closed = False

            async def start(self, local):
                started.set()
                await asyncio.Event().wait()

            async def close(self):
                self.closed = True

        reader = asyncio.StreamReader()
        output = io.BytesIO()
        services = Services()
        task = asyncio.create_task(serve_native(reader, output, services))
        reader.feed_data(frame({"type": "start"}))
        await started.wait()
        reader.feed_eof()
        await asyncio.wait_for(task, 1)
        assert services.closed
        assert not output.getvalue()

    asyncio.run(scenario())


def test_only_owned_process_group_is_terminated(tmp_path, monkeypatch):
    async def scenario():
        monkeypatch.setattr("companion.runtime.Path.home", lambda: tmp_path)
        services = ManagedServices("a" * 32)
        unrelated = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(30)"]
        )
        owned = services.launch([sys.executable, "-c", "import time; time.sleep(30)"])
        try:
            await services.close()
            assert owned.poll() is not None
            assert unrelated.poll() is None
        finally:
            unrelated.terminate()
            unrelated.wait()

    asyncio.run(scenario())


def test_register_installs_extension_and_exact_origin(tmp_path, monkeypatch):
    resources = tmp_path / "app/Contents/Resources"
    bundled = resources / "extension"
    bundled.mkdir(parents=True)
    (bundled / "manifest.json").write_text('{"manifest_version":3}')
    (resources / "companion.json").write_text(json.dumps({"extensionId": "a" * 32}))
    home = tmp_path / "user"
    monkeypatch.setattr(runtime, "ROOT", resources)
    monkeypatch.setattr(runtime.Path, "home", lambda: home)
    runtime.register_host()
    installed = home / "Library/Application Support/Interpreter/extension/manifest.json"
    assert installed.read_text() == (bundled / "manifest.json").read_text()
    for browser in ("Google/Chrome", "Google/ChromeForTesting", "Chromium"):
        path = home / "Library/Application Support" / browser / "NativeMessagingHosts"
        manifest = json.loads((path / "com.norux.interpreter.json").read_text())
        assert manifest["allowed_origins"] == [f"chrome-extension://{'a' * 32}/"]
        assert manifest["path"] == str(resources.parent / "MacOS/Interpreter Companion")
