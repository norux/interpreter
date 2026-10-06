# Interpreter

Chrome tab audio → Korean subtitles, with a local companion. This repository
contains tab capture, a Shadow DOM subtitle sink, and the local MLX ASR → Ollama
translation path. The user confirmed audible original playback during capture
and after popup closure. See `RALPH_PLAN.md` for durable progress and the
remaining implementation work. Real Chrome capture through both local models
to visible Korean subtitles passes on generated speech; ten-minute public-video
acceptance remains pending.

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
subtitles after each speech segment; model installation is below. Explicit Start
first prepares the selected local models, then acquires the tab's audio stream.
The popup displays “Preparing translation session…” during this bounded wait
(up to 60 seconds on the companion). Stop and setting changes cancel preparation
without starting recording. Native MLX loading already in progress may finish in
the shared worker; its late completion cannot restart capture. This loads model
files, but does not eliminate first-inference compilation or guarantee caption latency.

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

For actual YouTube translation and ten-minute acceptance, prepare the local models
below, start Ollama, and run:

```sh
export PATH="$PWD/.tools/uv/bin:$PATH"
npm run test:youtube-browser
# An alternate public English video can be supplied explicitly:
npm run test:youtube-browser -- 'https://www.youtube.com/watch?v=8KkKuTCFvzI'
```

This launches a fresh headed Chrome test profile and an offline local companion.
Invoke **Interpreter → Start** through the native extension toolbar, then close
the popup. Play the video at normal speed with audio enabled and site subtitles
off. After any ads finish, enter `long` in the harness terminal. It counts advancing
media time, so a stalled player or silent capture cannot pass the ten-minute check.
Use `check` to inspect capture and the current cue. While actual speech captions
are visible, enter `shot normal`, then use the player's native theatre/fullscreen
controls and enter `shot theatre` and `shot fullscreen`. Review the saved PNGs
and compare the Korean meaning with the public speech.

After at least 600 seconds, use native **Stop**, then enter `stopped`. Start again,
navigate/reload the captured page, and enter `navigation` to assert cleanup. Start
again, enter `disconnect` to stop the companion and assert error cleanup, then
`restart`, native **Start**, and `recovered` to require a new translated cue. Finish
with native **Stop**, `stopped`, `accept`, and `exit`. Exit 0 requires all these
checks; a blocked or incomplete run exits 1. `report` saves numeric observations
inside the ignored profile even when acceptance cannot finish.
If the player reports an error, `blocked` preserves its message, screenshot and
numeric snapshot with `accepted: false`. Use native Stop and `stopped` before exit.

The test-only companion measures ASR waiting audio, drop counters and MLX
allocations without saving audio or transcripts. First-frame reception establishes
the capture clock; an animation-frame observer timestamps the first visible cue.
Reported latency includes VAD, inference, transport and DOM scheduling, with
capture/receive/animation-frame timing uncertainty; it is not a compositor trace.
RSS samples cover the dedicated browser, companion and Ollama processes. GPU
allocations and RSS overlap on Apple unified memory and must not be added together.
Successful numeric evidence is written to `docs/verification/youtube/metrics.json`;
failed attempts must be recorded as limitations in the verification document.

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
200 ms pre-roll, 300 ms silence boundary, at least 200 ms speech, and a six-second
maximum segment. After four seconds, a 100 ms VAD pause can end the segment
before the hard limit to avoid cutting a word. This is a quiet audio boundary,
not a guarantee of a complete sentence. ASR resamples to 16 kHz float32 in memory.
Silence alone does not call either model. One dedicated ASR worker is shared across
sessions. Local ASR with local Ollama takes cumulative PCM snapshots after each
new half-second of voiced audio, within the existing six-second speech boundary.
These are repeated finite-array inferences, not native live PCM ingestion by MLX.
Meaningful source changes trigger provisional translations of the same utterance;
newer source cancels obsolete translation and replaces its caption with increasing
revisions. A completed provisional translation stays partial until the speech
boundary confirms it. Unchanged source can reuse that translation at the boundary.
The first translation streams immediately; later corrections keep the earlier
text visible until the replacement response completes, avoiding repeated erasure
to a one-token prefix. This completion still does not confirm provisional speech.
The latest provisional cue keeps its visible ending available after its reading
time while awaiting correction. Finalization starts the corrected cue's reading
time; a newer utterance retires a fully read provisional cue, and late corrections
cannot revive it. Stop/session replacement clears it immediately.
Only confirmed source/translation pairs enter the three-pair recent context.
Local ASR with Luna/Anthropic and OpenAI ASR with text translators retain final-only
translation requests. Waiting work in each local stage is limited to two segments
and eight seconds of audio; incoming PCM waits at most two seconds. Waiting
snapshots coalesce and cannot evict finals. Older waiting final data is
dropped with status/counts instead of accumulating unbounded delay. Stop cancels
pending work and discards late results; native MLX inference already running
finishes on its worker before another inference can start. Audio/transcripts
are never written by the companion.

Ollama streams one response per selected source snapshot or final segment. Its
accumulated translation replaces the same caption; translation tokens alone do
not add requests or context entries. Only a completed translation of confirmed
source becomes a final caption.
Stop closes the stream and rejects late output. A missing completion marker or
truncated response is an error, and the entire response has a 30-second deadline.
Snapshot timing and contextual accuracy still require the pending 7d browser
acceptance. Small audio windows can produce inaccurate provisional source/text.
Model loading and the time needed for a complete translation remain measurable.
Preparation also imports the PCM resampler before capture starts, so its first
import does not consume the initial speech window. The 500 ms snapshot interval
has model and short native Paint measurements; contextual accuracy and
sustained-load acceptance remain incomplete.

The paced model-only probe below uses generated weather and an ambiguous
construction sentence, three repetitions per phase, and identical PCM/settings.
`before` disables only snapshots; both phases prepare the current local models.
It prints generated source/translation for review and numeric observations, and
samples process memory through inference completion. All six trials run before
the meaning/timing/queue assertions are aggregated. A failed check exits nonzero
and writes only `model-{before,after}-failed.json` with `acceptancePassed: false`;
passing report names require every check to pass:

```sh
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONPATH=. \
  uv run --locked --extra local python tests/local-interim-model.py before
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONPATH=. \
  uv run --locked --extra local python tests/local-interim-model.py after
```

This probe does not exercise tabCapture, speaker playback, the subtitle DOM, or
browser Paint. Its reported event times cannot stand in for browser appearance.
Failed meaning checks remain failures and do not create passing reports. See
`docs/verification.md` for current observations and remaining acceptance work.

The pending 7d native comparison has a separate harness. Start the local Ollama
server with cloud disabled, build, then run each phase in an interactive terminal
(the harness waits for commands on stdin):

```sh
OLLAMA_NO_CLOUD=1 ollama serve
# In another terminal, from this checkout:
npm run build
node tests/local-interim-browser.mjs before
node tests/local-interim-browser.mjs after
```

For each phase, use the dedicated Chrome window's native Extensions toolbar →
Interpreter → Start, wait for listening, and close the popup. Enter `measure` in
that phase's terminal. It plays the same generated weather/construction clips,
with a separate first-inference sample and three warm repetitions. Afterwards,
use native Stop, enter `stopped`, then `exit`, including when assertions fail.
Run `before` immediately before `after`; the latter reads the numeric baseline
from ignored `.ralph/interim-browser-before.json`. Only snapshots are disabled
in `before`; both phases retain the same VAD, preparation, prompt and streaming.
The companion loads cached local dependencies with `uv run --locked --extra local`.

The harness records covering Chromium Paint, same-ID source changes, ASR and
translation calls, bounded queue/drop samples, companion RSS and MLX allocations.
Media start/end timing uses generated PCM bounds and observed media playback;
audio-position timing estimates capture origin from the first PCM reception and
includes local transport delay. Neither measures acoustic output or physical
screen presentation. Generated text is printed for review but numeric reports
contain no transcript. Any failed check produces only a `browser-*-failed.json`
report and a nonzero exit. A passing subprobe still does not establish continuous
load, all subtitle appearance checks, or the full 7d acceptance. Native window
access worked in the resumed iteration after iteration 4's failure. Actual paired
tabCapture/model/Paint runs produced failed reports: construction meaning remains
incorrect. An initial run also found provisional expiry hiding the later final;
the sink now retains the latest provisional ending for correction. See
`docs/verification.md` for the regression, measured results and remaining checks.

To repeat the older final-only model timing probe on paced, generated English PCM
with fixed language settings (it deliberately leaves snapshots disabled), start
Ollama and run:

```sh
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONPATH=. \
  uv run --locked --extra local python tests/local-latency.py after \
  docs/verification/latency/after-events.json
```

This unloads the selected Ollama model before its first sample, prints generated
fixture results for meaning review, and saves only numeric measurements. The
`before`/`after` argument labels the currently checked-out implementation; it does
not switch implementations. These are audio-end → session-event timings, not
Chrome capture or subtitle paint measurements. See `docs/verification.md` for
the baseline, sample counts, cold/warm distinction, and remaining item 7a checks.

To compare the 500/300/260 ms silence candidates on identical generated PCM:

```sh
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONPATH=. \
  uv run --locked --extra local python tests/local-vad-latency.py
```

This prepares one shared local engine, excludes its first inference from the warm
comparison, rotates candidate order, and saves numeric session-event measurements
to `docs/verification/latency/vad-events.json`. Generated text is printed only for
meaning review; temporary generated audio is removed. The 300 ms local boundary
reduced first-event latency in the recorded sample. That run also exposed a
six-second split/translation defect, addressed by the later pause-boundary run.
These measurements do not establish browser paint latency, cold-start improvement,
or item 7a completion.

To recheck the pause-boundary fix with the same generated English clips and real
local models (Ollama must be running):

```sh
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONPATH=. \
  uv run --locked --extra local python tests/local-boundary-quality.py after
```

This checks source details, Korean output, the long clip's negation/reason/noon/
umbrella/station/meeting time, revision ordering and bounded queues. Read the
printed generated text to review meaning; keyword checks alone do not establish
translation accuracy. Temporary audio is removed and only numeric/check evidence
is saved in `docs/verification/latency/boundary-after.json`. Its PCM hashes must
match the recorded baseline. `before` and `after` label the checked-out code;
they do not switch implementations. Both reports include nine warm runs/twelve
cues and a separate first inference. The revised pooled p50 is slightly slower
for first output and slower for final output; this fix recovers missing meaning.
See `docs/verification.md` for the baseline and remaining native Chrome checks.

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

To compare actual caption revision paints on identical generated short speech:

```sh
# Keep local Ollama running. Run these headed browser sessions sequentially.
npm run test:local-browser -- before
npm run test:local-browser -- after
```

In each session use native Start, close the popup, then enter `measure`. This plays
one separate first-inference sample followed by three repetitions of each of two
short clips. Review the printed Korean finals. Use native Stop, enter `stopped`,
then `exit`. Numeric evidence goes to `docs/verification/latency/paint-before.json`
and `paint-after.json`; WAV hashes must match. The `before` mode is a test-only
controlled baseline: 500 ms silence and withheld partial delivery. Both modes use
the current prepared models, translation prompt and streaming model request; this
is not a checkout of an earlier implementation. `after` uses 300 ms and partial
delivery. The harness correlates session/utterance/revision marks after the built
sink runs with Chromium main-frame Paint events covering the cue bounds before
another caption command. Missing paints remain null and fail sample acceptance.
It measures Paint start, not display presentation or sound from the speakers.
Cached first-inference samples are separate from warm p50/p95; the run does not
establish cold-start improvement or long-media queue stability. See the recorded
limits and remaining 7a acceptance in `docs/verification.md`.

To verify a real streamed translation that spans multiple timed subtitle parts:

```sh
npm run test:local-browser -- stream
```

Use native Start, close the popup, then enter `long`. The harness plays the same
generated five-second English sentence three times at a 270 × 700 viewport.
Review the printed source, Korean final and displayed parts. It checks the blue
umbrella, warm coat, station, afternoon meeting time and trip; partial revisions;
every final character; two-line layout; and a covering Chromium Paint for each
final part. Matching copies of the current phrase are omitted from recent Ollama
context because repeated examples caused a reproducible mistranslation.
Use native Stop, enter `stopped`, then `exit`. Numeric evidence is saved in
`docs/verification/latency/stream-long.json`, with three generated-caption PNGs.
This isolated-phrase check does not establish continuous-media cue retention,
in-flight inference cancellation, speaker listening or cold-start latency.

The subtitle sink stacks recent sentences in a four-line area (fewer lines on
very short viewports), above the controls. Each sentence uses at most two lines
at a time. Long sentences advance through their remaining characters; the front
sentence/part expires first after 2.5–6 seconds of reading time, based on length.
New sentences appear below earlier text as space permits. Corrections update
only their sentence and reading deadline. Resize/fullscreen retains the consumed
character offset; recent expired sentence IDs and older audio/revisions are
discarded. The sink keeps at most 128 retired IDs to handle direct-translation
cues that share an audio timestamp; older audio is rejected by a timestamp
watermark. These guards accompany the existing bounded, ordered session transport.

Hidden output waits at most four captions and twelve seconds of source audio,
separately from the inference queue. Overload skips the oldest waiting sentence
and shows a cumulative count/reason in a small status notice, also logging a
count without transcript text. These are retention bounds, not a twelve-second
maximum display delay or a guarantee against loss under overload. Stop clears
sentences, waiting work, the status notice and timers.

```sh
npm run test:captions-overlap-browser
npm run test:local-browser -- overlap
```

The first command uses generated captions to verify coexistence, complete final
characters and reading time, front expiry, in-place corrections, both output
limits, late revisions, resize/fullscreen, controls, clear and session replacement.
It writes numeric evidence to `docs/verification/captions/rolling-fixture.json`
and `rolling-{normal,narrow,fullscreen}.png`. These are DOM fixtures.

For the second command, start Ollama, use native toolbar Start, close the popup,
then enter `overlap`. It plays generated long speech followed by sunny weather
in narrow, normal and wrapper-fullscreen scenes. It requires both Korean
meanings, simultaneous sentences, complete final characters, reading time,
front expiry and a covering Chromium Paint for each final part. The narrow
scene also requires the next caption before the earlier unread part. Use native
Stop, `stopped`, `exit`. Only a passing run writes
`docs/verification/captions/rolling-local.json`; real screenshots are named
`rolling-local-{narrow,normal,fullscreen}.png`. The earlier
`docs/verification/latency/stream-overlap.json` preserves the prior single-cue
implementation's acceptance, not the new rolling display. Neither short test
establishes 600-second stability or a new physical speaker-listening result.

To measure native Start, model preparation and the first actual subtitle:

```sh
# Keep local Ollama running; run the two headed phases sequentially.
npm run test:local-browser -- startup-before
npm run test:local-browser -- startup-after
```

Enter `startup` **before** using native toolbar Start; observe Preparing or
Capturing, then close the popup.
Generated weather speech plays automatically once capture is ready. Review the
printed actual Korean final, use native Stop, and enter `stopped`. Repeat this
sequence three times, then enter `startup-report` and `exit`. The test observes a
trusted native Start click using a passive listener appended only to an ignored
copy of the built popup script. It sends no capture commands or fake captions.
The before phase skips only test-local model preparation; the after phase uses
the product preparation. Both keep the same current VAD, prompt and streaming
requests. Each phase starts a new companion and unloads only the selected Ollama
test model. Cached weights and OS/MLX caches stay intact, so this is a controlled
lazy-loading comparison, not a historical build or cold-cache benchmark.
Numeric reports separate the first inference from two warm restarts and
record click-to-capture, preparation, ASR, audio-end-to-first/final covering Paint,
and click-to-first/final Paint. Missing clicks/Paints, incorrect weather meaning
or incomplete cleanup fail the test. Small-sample percentiles and Paint start
are not physical display presentation or speaker-listening evidence.

To verify Stop during actual local ASR and a provider change during translation:

```sh
npm run test:local-browser -- lifecycle
```

Use native toolbar Start and close the popup. Enter `interrupt`; the harness plays
generated weather speech and clicks Stop in a real popup document as actual MLX
inference begins. Use native toolbar Start again, close the popup, and enter
`recover`, then `replace`. The latter changes to Luna after a real translation
partial, verifies cleanup, and restores Local before any new capture. It does not
start a cloud session. Use native Start a third time, close the popup, enter
`recover`, then `lifecycle-report`. Finally use native Stop, `stopped`, and `exit`.
The report requires native ASR completion after the first disconnect, no cancelled
session captions after cleanup/restart, and painted Korean finals from both new
sessions. Numeric evidence goes to `docs/verification/latency/lifecycle.json`.
Preparation-to-ready timings exclude the native click and offscreen creation;
cached models, speaker listening and continuous long-cue retention remain separate
checks. No caption or audio is substituted by this harness.

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
