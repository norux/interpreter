"""Installed app entry point; native stdout is reserved for framed messages."""

import asyncio
import json
import os
import shutil
import signal
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST_NAME = "com.norux.interpreter"
ASR_MODEL = "mlx-community/Qwen3-ASR-1.7B-8bit"
TEXT_MODEL = "qwen3.5:9b"


def configuration():
    return json.loads((ROOT / "companion.json").read_text())


def register_host():
    extension = Path.home() / "Library/Application Support/Interpreter/extension"
    shutil.copytree(ROOT / "extension", extension, dirs_exist_ok=True)
    executable = ROOT.parent / "MacOS" / "Interpreter Companion"
    manifest = {
        "name": HOST_NAME,
        "description": "Interpreter local speech and translation companion",
        "path": str(executable),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{configuration()['extensionId']}/"],
    }
    for browser in ("Google/Chrome", "Google/ChromeForTesting", "Chromium"):
        directory = (
            Path.home()
            / "Library/Application Support"
            / browser
            / "NativeMessagingHosts"
        )
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{HOST_NAME}.json"
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(manifest, indent=2) + "\n")
        temporary.replace(path)


async def request_json(url, body=None, timeout=2):
    import httpx

    async with httpx.AsyncClient(trust_env=False, timeout=timeout) as client:
        response = (
            await client.get(url) if body is None else await client.post(url, json=body)
        )
        response.raise_for_status()
        return response.json()


async def available(url):
    import httpx

    try:
        await request_json(url)
        return True
    except (httpx.HTTPError, ValueError):
        return False


class ManagedServices:
    def __init__(self, extension_id):
        self.extension_id = extension_id
        self.processes = []
        logs = Path.home() / "Library/Logs/Interpreter"
        logs.mkdir(parents=True, exist_ok=True)
        self.log = (logs / "companion.log").open("ab")

    def launch(self, arguments):
        environment = os.environ.copy()
        environment.update(
            INTERPRETER_EXTENSION_ID=self.extension_id,
            HF_HUB_OFFLINE="1",
            TRANSFORMERS_OFFLINE="1",
            OLLAMA_HOST="127.0.0.1:11434",
            OLLAMA_NO_CLOUD="1",
        )
        process = subprocess.Popen(
            arguments,
            cwd=ROOT,
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=self.log,
            stderr=self.log,
            start_new_session=True,
        )
        self.processes.append(process)
        return process

    async def wait_ready(self, process, url):
        try:
            async with asyncio.timeout(12):
                while True:
                    if process.poll() is not None:
                        raise RuntimeError(
                            "Local engine could not start. Check the companion log."
                        )
                    if await available(url):
                        return
                    await asyncio.sleep(0.1)
        except TimeoutError as error:
            raise RuntimeError(
                "Local engine startup timed out. Open Interpreter Companion."
            ) from error

    async def ollama(self):
        url = "http://127.0.0.1:11434/api/tags"
        if not await available(url):
            process = self.launch([str(ROOT / "ollama/ollama"), "serve"])
            await self.wait_ready(process, url)

    async def start(self, local_translation):
        if local_translation:
            await self.ollama()
        if await available("http://127.0.0.1:8765/health"):
            raise RuntimeError(
                "A companion is already running. Stop its terminal process before "
                "using automatic startup."
            )
        process = self.launch(
            [
                sys.executable,
                "-I",
                "-B",
                str(ROOT / "runtime.py"),
                "--server",
                self.extension_id,
            ]
        )
        await self.wait_ready(process, "http://127.0.0.1:8765/health")

    async def close(self):
        # Only process groups created by this host belong to it; reused Ollama stays up.
        for process in reversed(self.processes):
            if process.poll() is not None:
                continue
            try:
                os.killpg(process.pid, signal.SIGTERM)
                await asyncio.wait_for(asyncio.to_thread(process.wait), timeout=8)
            except TimeoutError:
                os.killpg(process.pid, signal.SIGKILL)
                await asyncio.to_thread(process.wait)
            except ProcessLookupError:
                pass
        self.processes.clear()
        self.log.close()


async def setup_models():
    task = asyncio.current_task()
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(signum, task.cancel)
    from huggingface_hub import snapshot_download

    print(
        "준비할 기본 모델\n"
        f"음성 인식: {ASR_MODEL}\n"
        f"번역: {TEXT_MODEL}\n"
        "실제 사용 모델은 Chrome 확장의 모델 설정에 따릅니다.\n",
        flush=True,
    )
    register_host()
    print("확장 연결을 등록했습니다. 음성 인식 모델을 확인합니다…", flush=True)
    # First try the existing user cache; network downloads require this setup action.
    try:
        snapshot_download(ASR_MODEL, local_files_only=True)
        print("음성 인식 모델: 기존 다운로드를 사용합니다.", flush=True)
    except Exception:
        print("음성 인식 모델을 다운로드합니다. 처음에는 시간이 걸립니다…", flush=True)
        snapshot_download(ASR_MODEL, token=False)
    services = ManagedServices(configuration()["extensionId"])
    try:
        await services.ollama()
        print("번역 모델을 확인합니다…", flush=True)
        tags = await request_json("http://127.0.0.1:11434/api/tags")
        if not any(model.get("name") == TEXT_MODEL for model in tags["models"]):
            import httpx

            async with httpx.AsyncClient(trust_env=False, timeout=None) as client:
                async with client.stream(
                    "POST",
                    "http://127.0.0.1:11434/api/pull",
                    json={"model": TEXT_MODEL, "stream": True},
                ) as response:
                    response.raise_for_status()
                    last = ""
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        progress = json.loads(line)
                        if progress.get("error"):
                            raise RuntimeError(progress["error"])
                        status = progress.get("status", "")
                        if progress.get("total"):
                            percent = (
                                progress.get("completed", 0) * 100 // progress["total"]
                            )
                            status += f" {percent}%"
                        if status != last:
                            print(f"번역 모델 다운로드: {status}", flush=True)
                            last = status
        else:
            print("번역 모델: 기존 다운로드를 사용합니다.", flush=True)
        print("준비 완료. Chrome 확장에서 Start를 누르세요.", flush=True)
    finally:
        await services.close()


def write_message(output, message):
    data = json.dumps(message).encode()
    output.write(struct.pack("@I", len(data)) + data)
    output.flush()


async def serve_native(reader, output, services):
    starting = None

    async def start(message):
        try:
            await services.start(message.get("localTranslation") is True)
            write_message(output, {"type": "ready"})
        except Exception as error:
            write_message(output, {"type": "error", "message": str(error)})

    try:
        while True:
            header = await reader.readexactly(4)
            size = struct.unpack("@I", header)[0]
            if not 0 < size <= 4096:
                raise ValueError("Invalid native message size")
            message = json.loads(await reader.readexactly(size))
            if not isinstance(message, dict):
                raise ValueError("Unsupported native message")
            if message.get("type") == "stop":
                if starting:
                    starting.cancel()
                    await asyncio.gather(starting, return_exceptions=True)
                    starting = None
                await services.close()
                write_message(output, {"type": "stopped"})
                return
            if message.get("type") != "start":
                raise ValueError("Unsupported native message")
            if starting is not None:
                raise ValueError("This host already owns a Start operation")
            starting = asyncio.create_task(start(message))
    except asyncio.IncompleteReadError:
        pass
    finally:
        if starting:
            starting.cancel()
            await asyncio.gather(starting, return_exceptions=True)
        await services.close()


async def native(origin):
    task = asyncio.current_task()
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(signum, task.cancel)
    extension_id = configuration()["extensionId"]
    if origin.rstrip("/") != f"chrome-extension://{extension_id}":
        raise ValueError("Extension origin is not allowed")
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    transport, _ = await asyncio.get_running_loop().connect_read_pipe(
        lambda: protocol, sys.stdin.buffer
    )
    try:
        await serve_native(reader, sys.stdout.buffer, ManagedServices(extension_id))
    finally:
        transport.close()


if __name__ == "__main__":
    try:
        if sys.argv[1] == "--register":
            register_host()
        elif sys.argv[1] == "--setup":
            asyncio.run(setup_models())
        elif sys.argv[1] == "--server":
            import uvicorn

            sys.path.insert(0, str(ROOT))
            os.environ["INTERPRETER_EXTENSION_ID"] = sys.argv[2]
            uvicorn.run(
                "server.app:app",
                host="127.0.0.1",
                port=8765,
                ws_max_size=4096,
                ws_max_queue=8,
            )
        else:
            asyncio.run(native(sys.argv[1]))
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        sys.exit(1)
