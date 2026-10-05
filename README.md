# Interpreter

Chrome tab audio → Korean subtitles, with a local companion. This repository
currently contains the project scaffold and a health endpoint. Capture, model
adapters, and captions are still pending in `RALPH_PLAN.md`.

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
npm run dev:server
```

The companion binds only to `127.0.0.1:8765`. From another terminal:

```sh
curl --fail http://127.0.0.1:8765/health
# {"status":"ok"}
npm run build
```

In `chrome://extensions`, enable Developer mode, select **Load unpacked**, and
choose this checkout's `extension/dist` directory. The popup shows scaffold
status; it does not start recording. `npm run dev` rebuilds on edits; reload the
extension in Chrome after each build. No browser installation/capture success
has been verified yet.

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
extension build, JS build tests, and Python health tests. It needs no API keys.
`npm test` runs both test suites after an existing build; `npm run build` creates
the extension artifacts. Build tests ensure manifest entries and offscreen,
worklet, and content files are emitted; they do not demonstrate audio capture.

Copy `.env.example` to `.env` only when configuring the future cloud adapters.
Keys belong exclusively to the companion; `.env` is ignored. The scaffold does
not load or use these variables yet. Never commit keys, model weights, recordings,
or transcripts. See [verification evidence](docs/verification.md) for checks that
actually ran and their limitations.
