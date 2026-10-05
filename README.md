# Interpreter

Chrome tab audio → Korean subtitles, with a local companion. This repository
contains tab capture/PCM transport code and a health endpoint. Real tab capture
and lifecycle checks passed; the user confirmed audible original playback during
capture and after popup closure. Model adapters and captions remain unimplemented.
See `RALPH_PLAN.md` for durable progress and the remaining implementation work.

The planned input is one Chrome tab started by the user, not macOS system audio.
The default local path will run without API keys. Cloud paths will be explicitly
selected and billed by their API provider separately from chat subscriptions.

## Setup

Requirements: Node.js 22.12+ (Node 24 recommended), npm, uv, Chrome 116+.
Python 3.12 is selected by `.python-version`; uv can download it automatically.
MLX/model dependencies are not installed by this scaffold.

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
still needs a listening confirmation. No captions appear at this stage.

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

Copy `.env.example` to `.env` only when configuring the future cloud adapters.
Keys belong exclusively to the companion; `.env` is ignored. Cloud keys are not
loaded or used yet; capture reads the exported extension ID. Never commit keys, model weights, recordings,
or transcripts. See [verification evidence](docs/verification.md) for checks that
actually ran and their limitations.
