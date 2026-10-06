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

The popup selects translation provider, speech recognizer, input/subtitle languages,
and compatible model IDs. Defaults are local MLX/Ollama with English → Korean.
Languages offered are English, Korean, Japanese, Chinese, Spanish, French, and
German; model support and account access still apply. Changing any setting stops
the current capture and clears its subtitles. Press **Start** to start a new
session with those settings. Selections persist locally across popup closure.

OpenAI direct detects the input language and fixes its model to
`gpt-realtime-translate`; OpenAI ASR fixes its model to `gpt-live-transcribe`.
Luna defaults to `gpt-6-luna`. Anthropic requires an accessible model ID before
Start. Local model compatibility and installation requirements are described
below. The popup never requests or stores API keys: export keys only in the
companion shell. No provider falls back automatically.

Popup settings take precedence over `INTERPRETER_PROVIDER`, language, and model
environment defaults for each new session. Environment selection remains available
to clients that POST `/sessions` without a settings body, including protocol/model
smokes. Stop capture before restarting the companion to change server keys.

`npm run test:settings-browser` checks built popup persistence, selected-setting
transport/validation cleanup, session replacement, literal HTML rendering, one
DOM overlay, and DOM/test-memory output fan-out. It uses generated captions and
local protocol fixtures; it does not record tab audio or call a model.

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
Keys belong exclusively to the companion; `.env` is ignored. The explicitly
selected cloud adapters read exported server keys. Never commit keys, model weights, recordings,
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

## OpenAI direct translation

This optional paid path sends the selected tab's audio to OpenAI. It requires
an API key with access to `gpt-realtime-translate`; a chat subscription does not
provide API billing. Export the key in the companion's shell, then explicitly
start the companion and select **OpenAI · direct audio translation** in the popup:

```sh
# OPENAI_API_KEY must already be exported in this shell; never put it in the extension.
INTERPRETER_EXTENSION_ID=your_32_letter_extension_id \
  npm run dev:server
```

For direct translation, the target is an API language code (`ko` by default),
rather than the language name used by local prompts. Source language is detected
by the translation model. Choose the subtitle language in the popup. Select
**Local · Ollama** to use the local models. Neither provider automatically falls
back to the other.

The companion connects to the fixed `/v1/realtime/translations` WebSocket and
continuously sends mono 24 kHz PCM16, including silence. It configures the output
language before sending audio. Append-only translated transcript fragments revise
the same subtitle cue; punctuation, 160 characters, or graceful close finalize
a local display cue. These are display boundaries, not model utterance-final
events. Timing uses the API's optional alignment metadata, with captured audio
time as a fallback; it is not word-level forced alignment. Source transcription
is not enabled and translated audio is discarded. Stop cancels input and hides
captions, sends `session.close`, and drains until `session.closed`, with a
five-second limit if the provider stalls. Keys and raw provider errors are never
sent to the extension. Access, quota, disconnect, and missing-key errors are
reported without switching providers.

`npm run verify` checks the protocol against local WebSocket fixtures without
keys or paid calls. To explicitly opt into a live paid smoke on non-sensitive
macOS-generated English speech, export `OPENAI_API_KEY` and run:

```sh
npm run test:direct-live
```

It fails if the key, model access, or Korean caption output is unavailable;
review meaning yourself. This command does not exercise Chrome tab capture or
subtitle appearance. Live cloud verification has not run in this iteration
because the process has no exported key. Protocol references:
[translation guide](https://developers.openai.com/api/docs/guides/realtime-translation),
[translation events](https://developers.openai.com/api/reference/resources/realtime/translation-server-events).

## Luna / Anthropic text translation and ASR selection

**OpenAI · Luna text translation** uses Responses with `gpt-6-luna` by default;
**Anthropic · text translation** uses Messages and requires a model ID accessible
to your account in the popup. Each translates finalized ASR text with at most three
recent translation pairs. Audio never enters either text API. Partial ASR results
revise the same internal transcript; only final text creates a translation request.
The caption keeps its ASR utterance ID and captured audio interval. Empty, refused,
truncated, access-denied, and rate-limited responses become status errors rather
than subtitles. Requests have a 30-second limit and Stop cancels pending work.

The [Luna model card](https://developers.openai.com/api/docs/models/gpt-6-luna)
confirms `reasoning.effort=none`, used here to avoid extra reasoning latency.
Responses requests use `store=false` and a 256-token output limit. See the
[Responses guide](https://developers.openai.com/api/docs/guides/text) and
[Anthropic Messages reference](https://platform.claude.com/docs/en/api/messages/create).
No claim is made about your account's model access or live translation quality.
These optional API paths require separate provider API billing.

With local ASR prepared, export the appropriate server key, then run one of the
commands below. Select the corresponding provider, **Local · MLX** recognizer,
and model IDs in the popup. The environment model/provider values also serve
clients without a settings body:

```sh
# OPENAI_API_KEY must already be exported. Local ASR keeps audio on this Mac.
INTERPRETER_EXTENSION_ID=your_32_letter_extension_id \
  INTERPRETER_PROVIDER=luna INTERPRETER_ASR=local \
  INTERPRETER_ASR_MODEL=mlx-community/Qwen3-ASR-0.6B-8bit \
  INTERPRETER_TEXT_MODEL=gpt-6-luna \
  HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
  uv run --locked --extra local uvicorn server.app:app --host 127.0.0.1 \
  --port 8765 --ws-max-size 4096 --ws-max-queue 8

# ANTHROPIC_API_KEY and a non-secret ANTHROPIC_MODEL_ID must already be exported.
INTERPRETER_EXTENSION_ID=your_32_letter_extension_id \
  INTERPRETER_PROVIDER=anthropic INTERPRETER_ASR=local \
  INTERPRETER_ASR_MODEL=mlx-community/Qwen3-ASR-0.6B-8bit \
  INTERPRETER_TEXT_MODEL="$ANTHROPIC_MODEL_ID" \
  HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
  uv run --locked --extra local uvicorn server.app:app --host 127.0.0.1 \
  --port 8765 --ws-max-size 4096 --ws-max-queue 8
```

All three text translators (`local`, `luna`, `anthropic`) can instead use paid
OpenAI ASR. This sends captured speech to OpenAI, needs `OPENAI_API_KEY`, and
requires no MLX dependencies. Select **OpenAI · live transcription** and the
input language in the popup. For clients without settings, use `INTERPRETER_ASR=openai`,
`INTERPRETER_ASR_MODEL=gpt-live-transcribe`, and `INTERPRETER_ASR_LANGUAGE=en`
(or a supported source-language code). Prompt languages remain names such as
`INTERPRETER_SOURCE_LANGUAGE=English` and `INTERPRETER_TARGET_LANGUAGE=Korean`.
For example, OpenAI ASR plus Luna:

```sh
INTERPRETER_EXTENSION_ID=your_32_letter_extension_id \
  INTERPRETER_PROVIDER=luna INTERPRETER_ASR=openai \
  INTERPRETER_ASR_MODEL=gpt-live-transcribe INTERPRETER_ASR_LANGUAGE=en \
  INTERPRETER_TEXT_MODEL=gpt-6-luna npm run dev:server
```

The [OpenAI transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription)
requires client VAD and explicit commits for this model. The companion buffers
short speech using the existing VAD boundaries (500 ms silence / six-second
maximum), sends its raw 24 kHz PCM to a transcription WebSocket, and commits
one turn at a time. This is phrase-buffered transcription, not continuous
word-by-word display. Partial/final events reconcile by item ID, including deltas
before commit acknowledgment. Completed items are deleted with acknowledgment;
captured times provide approximate cue timing. Silence makes no commit. Waiting
speech stays within two segments/eight seconds, with old data dropped and counted.
Stalled turns terminate after 30 seconds; Stop closes the ASR socket directly.
The direct translation path continues to use its separate close protocol.

Stop capture before changing exported settings and restarting the companion.
Defaults apply only when a variable is unset: if you exported the local model IDs
from `.env.example`, explicitly change them for cloud paths. There is no automatic
provider fallback. Popup settings override these environment defaults for the
extension; they do not change server keys.

Keyless `npm run verify` covers local WebSocket/HTTP fixtures and companion
integration. Live Luna, Anthropic, and OpenAI ASR have **not** been verified here:
neither provider key was exported. To check live behavior, explicitly select one
of these configurations with authorized server keys, Start on non-sensitive tab
speech, and inspect caption meaning/errors. Fixture success is not evidence of
live model access, latency, quality, or browser appearance.
