# Interpreter

Chrome tab audio → Korean subtitles, with a local companion. This repository
contains tab capture, a Shadow DOM subtitle sink, and the local MLX ASR → Ollama
translation path. The user confirmed audible original playback during capture
and after popup closure. See `RALPH_PLAN.md` for durable progress and the
remaining implementation work. Real-model generated-speech smoke passes; the
combined Chrome capture → visible translated caption acceptance is still pending.

The planned input is one Chrome tab started by the user, not macOS system audio.
The default local path will run without API keys. Cloud paths will be explicitly
selected and billed by their API provider separately from chat subscriptions.

## Setup

Requirements: Node.js 22.12+ (Node 24 recommended), npm, uv, Chrome 116+.
Python 3.12 is selected by `.python-version`; uv can download it automatically.
MLX dependencies are optional and loaded only for local ASR.

```sh
npm ci
uv sync --locked
npm run verify
# The health endpoint works before an extension ID is configured.
npm run dev:server
```

The companion binds only to `127.0.0.1:8765`. From another terminal:

```sh
curl --fail http://127.0.0.1:8765/health
# {"status":"ok"}
npm run build
```

In `chrome://extensions`, enable Developer mode, select **Load unpacked**, and
choose this checkout's `extension/dist` directory. Copy its 32-letter extension
ID, stop the companion, and restart it with that exact ID:

```sh
INTERPRETER_EXTENSION_ID=your_32_letter_extension_id npm run dev:server
```

The server rejects other origins, non-loopback hosts, and missing/expired session
tokens. It issues single-use tokens in memory; they are not API keys and are not
stored in extension storage or URL parameters. The companion keeps no audio files
or transcripts. `.env` is not automatically loaded; export settings in the shell.

On an ordinary HTTP/HTTPS tab with audio, click the extension's toolbar icon,
then **Start**. The popup reports capture/connection status and PCM frame receipt
counts. Closing the popup is intended to leave the offscreen owner running;
**Stop**, tab closure, or navigation releases it. Real browser checks verified
these capture lifetimes and recovery after companion shutdown. The code connects
original tab audio to the audio destination to preserve playback; audible output
was confirmed by the user in the capture checks. The local path displays Korean
subtitles after each speech segment; model preparation is below.

`npm run dev` rebuilds on edits; reload the extension in Chrome after each build.
Chrome internal pages cannot be captured. If the popup says the extension has not
been invoked, use its toolbar icon on the target tab; opening `popup.html` directly
or with `chrome.action.openPopup()` does not grant `activeTab`.

Install uv using the [official instructions](https://docs.astral.sh/uv/getting-started/installation/).
For repository-local tooling when uv is absent from PATH:

```sh
python3 -m venv .tools/uv
.tools/uv/bin/python -m pip install uv
export PATH="$PWD/.tools/uv/bin:$PATH"
uv sync --locked
```

## Commands and verification

`npm run verify` runs JS lint, Python lint, TypeScript checks, the production
extension build, JS PCM/lifecycle/build tests, and Python health/transport tests.
It needs no API keys.
`npm test` runs both test suites after an existing build; `npm run build` creates
the extension artifacts. Build tests ensure manifest entries and offscreen,
worklet, and content files are emitted; they do not demonstrate audio capture.

The optional browser smoke needs Playwright's official Chromium download, uv on
PATH, and port 8765 free. It launches its own companion and isolated ignored
profile. A generated tone runs through the real AudioWorklet and WebSocket;
this is **not** tabCapture, audible playback, or model/caption evidence.

```sh
npx playwright install chromium
npm run test:capture-browser
```

To repeat actual capture and finish the pending listening check, serve the
non-sensitive stereo fixture:

```sh
uv run --locked python -m http.server 8766 --bind 127.0.0.1 --directory tests/fixtures
# Open http://127.0.0.1:8766/audio.html in a dedicated Chrome test profile.
```

Click **Play test audio**, invoke the extension through its toolbar, then **Start**.
Verify receipt counts increase and audio remains audible, close/reopen the popup,
repeat Start/Stop, close the captured tab, and check navigation and disconnect
cleanup. Record actual observations in `docs/verification.md` before checking item 2.

Copy `.env.example` to `.env` as a settings reference.
Keys belong exclusively to the companion; `.env` is ignored. Cloud keys are not
loaded or used yet; capture reads the exported extension ID. Never commit keys, model weights, recordings,
or transcripts. See [verification evidence](docs/verification.md) for checks that
actually ran and their limitations.

## Local models

On an Apple Silicon Mac, install the optional local dependencies and download the
ASR model once to the normal Hugging Face cache. Downloads are explicit setup;
Start uses cached weights and does not call an external inference service.

```sh
uv sync --locked --extra local
uv run --locked --extra local python -c 'from huggingface_hub import snapshot_download; snapshot_download("mlx-community/Qwen3-ASR-0.6B-8bit", token=False)'
# Install Ollama using https://ollama.com/download, then start it in another terminal:
ollama serve
ollama pull qwen3:4b-instruct
# Restart the companion using your unpacked extension ID:
INTERPRETER_EXTENSION_ID=your_32_letter_extension_id \
  HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
  uv run --locked --extra local uvicorn server.app:app --host 127.0.0.1 \
  --port 8765 --ws-max-size 4096 --ws-max-queue 8
```

The defaults are `mlx-community/Qwen3-ASR-0.6B-8bit` and Ollama
`qwen3:4b-instruct` (Q4_K_M). Set exported `INTERPRETER_ASR_MODEL` and
`INTERPRETER_TEXT_MODEL` for compatible IDs. The ASR adapter expects an
MLX-converted Qwen3-ASR checkpoint with its tokenizer/feature extractor and a
`generate` result carrying `.text`; arbitrary Hugging Face models are not supported.
The text adapter expects an installed Ollama chat model that supports
`think: false` and follows subtitle translation instructions. Other IDs are
unverified. TranslateGemma is a candidate requiring its own template validation.
Use `INTERPRETER_SOURCE_LANGUAGE=English` and `INTERPRETER_TARGET_LANGUAGE=Korean`
to change language names until the settings UI is implemented. ASR must support
the chosen source language.

The worklet sends mono 24 kHz PCM16. Local VAD uses an 8 kHz decision stream,
200 ms pre-roll, 500 ms silence boundary, at least 200 ms speech, and a six-second
maximum segment. ASR resamples the segment to 16 kHz float32 in memory. Silence
alone does not call either model. One dedicated ASR worker is shared across
sessions; translation processes finalized segments with up to three recent
source/translation pairs. Waiting speech is limited to two segments and eight
seconds of audio; incoming PCM waits at most two seconds. Older waiting data is
dropped with status/counts instead of accumulating unbounded delay. Stop cancels
pending work and discards late results; native MLX inference already running
finishes on its worker before another inference can start. Audio/transcripts
are never written by the companion.

If ASR dependencies or cached weights are missing, the popup gives the setup
command. Missing text weights ask for `ollama pull`; connection failure asks for
`ollama serve`. No paid provider is called as a fallback. Ollama requests go only
to `127.0.0.1:11434`, with environment HTTP proxies disabled.

To test the two real models separately on generated speech, run
`npm run test:local-model`. It prints generated-fixture ASR/translation results
and checks missing-model guidance. This does not exercise Chrome capture or
subtitle appearance.

To repeat actual local acceptance on macOS with the models prepared, run:

```sh
npm run test:local-browser
```

This creates non-sensitive English speech with `say` in an ignored test profile,
loads the built extension into headed Chrome, and starts a loopback companion
with Hugging Face offline mode. Use the actual Extensions toolbar → Interpreter
→ Start, then close the popup. Enter `play` in the harness, followed by `accept`
while the speech plays. The harness waits for a real Korean caption and records
a screenshot; no test caption is injected. Use the native popup's Stop button,
then enter `stopped` to verify capture, offscreen, and overlay cleanup. Exit 0
requires both `accept` and `stopped` to pass. Enter `check` to inspect capture
status or `exit` to stop the browser/listeners. The generated audio is ignored
and must not be committed. The screenshots need visual and meaning review;
a Hangul assertion alone is not evidence of accurate translation.
