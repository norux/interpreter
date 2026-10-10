# Jamak architecture

Jamak ships one Manifest V3 desktop Chrome extension from `apps/chrome`. The former Python server, macOS companion and legacy `extension/` application are removed. iPhone Safari and a macOS desktop app are roadmap items only.

## Runtime and data flow

1. The popup defaults to manual Japanese, allows English/Japanese/Korean selection and offers an optional automatic-detection checkbox. Selecting a source language disables detection. Manual Korean uses fixed-language Whisper and skips translation. It prepares models and starts/stops capture for its original tab.
2. The service worker coordinates session state and action-granted tab access. It owns the control channel, not inference.
3. An offscreen document keeps tab capture, audible playback and inference alive after the popup closes.
4. `packages/media-web` and the audio worklet provide ordered PCM with capture-relative timing. Tab capture includes iframe and Web Audio output; it does not isolate one video or capture microphones/system audio.
5. `packages/engines-browser` normalizes input, recognizes speech, translates text to Korean and independently estimates speakers. Source and translation revisions share session, epoch and utterance identity.
6. `packages/core` reconciles revisions and schedules presentation. The page content script renders subtitles through `packages/presentation-web`; a separate window shows original/translation history.

Navigation, target loss and Stop invalidate the session and release resources. Stale worker replies or acknowledgements must not revive captions. The offscreen preparation snapshot carries the current stage’s numeric download fraction to one popup progress bar. Reopening restores it; loading or browser-owned stages without a reported fraction are indeterminate. Ready, failure and Stop hide the bar. The snapshot also carries the actual selected model list for the popup’s compact model-information table; before preparation, the table shows the expected configuration for the selected mode. Raw model IDs, pinned revision hashes and byte-count diagnostics are not rendered in the popup. Model preparation persists independently of the popup; cancellation and disposal must release workers and pending jobs.

## Caption and speaker invariants

- Never pair a translation with a different source revision or epoch.
- Preserve the previous translation while its correction is pending.
- Do not discard unread captions or replay a retired sentence when final recognition arrives in a burst.
- Keep visible reading progress separate from transcript storage. Only visible text counts toward reading time.
- Ready captions appear below earlier captions in a bounded stack. Visible rows accrue reading time concurrently and long rows advance their own measured two-line parts. Completed rows retire oldest first after 4–6 seconds per visible part and a 250 ms fade; a newer row retains its original reading deadline when older rows leave. Clipped rows wait without spending reading time, and one row’s fade never fades the whole stack.
- Speaker inference runs independently of text presentation. Stable session-local IDs select background colors; no “speaker 1” labels are rendered.
- Very short or uncertain speech can remain unassigned. Speaker numbers are anonymous clusters, not personal identity.

The page overlay stays attached to the document root. During Fullscreen API playback it uses a manual popover to enter the browser's top layer above fullscreen video, player or iframe surfaces; normal `z-index` cannot place a page overlay above that layer. Leaving fullscreen removes the popover state and restores normal positioning without recreating the view or presentation policy. Its transparent background/backdrop and `pointer-events:none` preserve playback controls and avoid focus-taking UI. Stop/disposal removes the surface, including an open fullscreen popover.

Whisper timestamps describe acoustic segments, which can contain part of a sentence or several sentences. Join unfinished pieces before publishing. At the 12-second snapshot limit, retain an incomplete trailing phrase's PCM when a complete preceding segment can be trimmed; drain at EOF, an automatic-mode speech boundary or a settled pause, with a bounded flush when no usable boundary exists. A punctuation correction inside retained audio must not repeat a committed prefix. Chrome Japanese translation splits ASCII/full-width sentence punctuation and conversational endings before a new-script word or discourse marker, preserving word-internal text such as `よく` and relative verbs such as `行った駅`.

Whisper normally re-decodes after roughly one second of new PCM and publishes the uncommitted text as a provisional transcript. Subsequent snapshots revise that caption with the same utterance ID and increasing source revisions, including language corrections in automatic mode. Consecutive matching results confirm completed sentences; EOF, a completed automatic speech boundary, settled pauses and the existing bounded-window policy can also finalize text. The confirmed leading sentence finalizes the current caption, and its unfinished successor becomes the next provisional caption. PCM trimming retains that successor's caption identity. Unchanged drafts produce no extra revisions; queued replacements of the same caption coalesce without dropping final sentences. Existing translation queues reject obsolete source revisions, preserve the previous displayed translation during correction and bypass translation for Korean. This is application-level streaming around the existing Whisper model, with no new model, worker or inference-frequency change; accumulation and model execution still determine initial latency.

## Models

With Chrome defaults, manual English and Japanese share Chrome's on-device streaming path. Interim results publish after a 180 ms coalescing gate; native finals bypass it. The existing revision pipeline shows drafts before translation and preserves paired translations while corrections are pending. WebGPU availability does not override a supported native speech API. Unsupported native speech uses the Whisper fallback.

| Task | Runtime/model | Conditions |
| --- | --- | --- |
| Recognition | Chrome SODA, local SpeechRecognition | Preferred for manual English/Japanese; required local API and language packs |
| Recognition | Whisper large-v3-turbo FP16 through Transformers.js/ONNX | Default automatic/Korean modes and native fallback; WebGPU required; ~1.6 GB speech model |
| Recognition choices | Whisper Tiny/Base/Small q8; Small FP16; Large v3 Turbo FP16 | Advanced overrides native recognition. q8 uses WASM/CPU; FP16 uses WebGPU. All choices support manual and automatic languages and use Silero VAD. |
| Voice activity for fallback | Silero VAD | Bundled ONNX runtime; pinned artifact |
| Translation | Chrome TranslateKit | Default local Translator API and English/Japanese → Korean packs |
| Translation choices | NLLB-200 Distilled 600M q8 (~912 MB); M2M100 418M q8 (~640 MB) | Local WASM worker; one resident multilingual model, English/Japanese → Korean |
| Speaker embeddings | WeSpeaker VoxCeleb ResNet34-LM q8 | Local WASM worker; ~6.7 MB first download |

The pinned artifact inventory, sizes and hashes lives in `packages/engines-browser/model.ts` and `translation-model.ts`. The separate Advanced window offers registered choices through independent selectors. Each change stops/disposes the old session, forwards the original source/tab plus selected options to offscreen preparation, and downloads missing artifacts immediately. It can be opened from the popup or Chrome extension options; without an original tab it prepares models only, and the action popup binds a tab on subsequent preparation. No selection starts capture.

Settings use extension-origin localStorage (`jamak-model-options-v1`), shared by the visible extension pages without adding storage permission. Prepared snapshots carry immutable recognition/translation options. Popup readiness checks the corresponding model caches and native packs, and start remains disabled when settings do not match the prepared configuration. Closing Advanced preserves preparation; reopening only observes status. Changing again or Stop terminates model workers and their pending downloads, retaining completed cached files. Chrome owns its native pack downloads and may continue them independently after application preparation stops. Native defaults still use Turbo for automatic/Korean or unsupported SODA; explicit selections never silently fall back. Korean speech bypasses translation for every selection.

Advanced saves a new selection before requesting preparation, retaining it even when preparation fails. The popup ignores old model metadata/readiness when options differ; missing snapshot options identify Chrome defaults only. Advanced independently probes Chrome speech/translation pack availability or all registered cache responses and exact Content-Length values for each selected model. Partial, truncated or evicted cache files are not complete; labels are derived again on background events and reopening, without initiating downloads. Korean labels translation as unused. Saved files and loaded-model readiness remain distinct, and the current stage's progress is determinate only when the background reports a fraction.

Successful Advanced preparation emits one `models-ready` event from offscreen after its generation is still current. The service worker accepts only the owned offscreen sender and creates a local desktop notification through `chrome.notifications` (declared `notifications` permission), independent of the visible windows. Stop, failed/stale preparations and ordinary popup cache preparation do not emit this event. Notification rejection does not change readiness. OS/Chrome notification settings can prevent visible delivery; notification content contains no transcript. [Chrome notification API](https://developer.chrome.com/docs/extensions/reference/api/notifications).

The bounded translation worker receives only transcript text, executes the pinned ONNX q8 model from prepared Cache Storage, and returns exact source/session revision pairing. NLLB uses Flores language codes; M2M100 uses ISO codes. Both share the existing serial translation/revision queue and terminate on cancellation. Model comparisons need real inference checks; successful downloads or mocked selectors are insufficient. Model downloads use the manifest's allowed Hugging Face endpoints; inference does not send audio or embeddings to a server. Chrome manages its own language packs. Availability is device/browser dependent; first downloads need internet.

WeSpeaker weights are CC-BY-4.0; see [attribution](../verification/captions/conversation-speakers.md). The upstream [Whisper weights](https://huggingface.co/openai/whisper-large-v3-turbo) and [Silero VAD](https://github.com/snakers4/silero-vad) are MIT-licensed. [NLLB](https://huggingface.co/facebook/nllb-200-distilled-600M) weights are CC-BY-NC-4.0, intended for research/noncommercial use, and labeled accordingly in Advanced. [M2M100](https://huggingface.co/facebook/m2m100_418M) weights are MIT. The pinned [NLLB ONNX](https://huggingface.co/Xenova/nllb-200-distilled-600M) and [M2M100 ONNX](https://huggingface.co/Xenova/m2m100_418M) conversions retain upstream attribution. Model licenses remain separate from the application license. Consult each registered upstream model card before redistributing weights.

## Automatic language routing

`auto` belongs to session settings; transcript and translation revisions carry the actual utterance language. Automatic mode uses the selected multilingual Whisper weights, not a text decision model or additional language-ID download. The pinned Transformers.js 4.3.0 implementation defaults to English when language is omitted, so the ASR worker explicitly decodes the first language token, calculates probabilities across the model's language tokens, and chooses between `en`, `ja` and `ko`. It then transcribes using the same encoder output. Its pinned SDK adapter admits `encoder_outputs` into the model's forward parameters; verify real model execution when upgrading the SDK.

Recent confident language is a session-local tie breaker only when acoustic scores differ by less than 0.05. Clear new evidence can switch immediately. These raw model probabilities are not calibrated accuracy guarantees. Growing snapshots retain initial PCM; low-confidence snapshots shorter than two seconds wait for more evidence, while a completed speech boundary is decoded with the available audio. A 240 ms VAD pause queues an automatic-mode boundary even during active inference. Jobs drain each boundary before analyzing the next turn. Silence never triggers noise-only recognition; queues and PCM remain bounded. A switch within uninterrupted or overlapping speech may still share one language for that window.

With Chrome translation selected, preparation loads both English/Japanese → Korean native translators; an explicit translation choice loads one multilingual resident worker instead. The bounded translation queue selects a pair from each source revision and preserves exact revision identity. Korean revisions are paired with their own text without a native translation call. Speaker analysis remains asynchronous and independent; no per-speaker language lock or persistent voice/language cache is added. Ready models/pairs are reused within a prepared session and released on Stop; downloaded artifacts stay cached for subsequent preparations.

See [automatic-language verification](../verification/asr/automatic-language.md) for the synthetic three-language meeting and measured limitations.

## Repository map

| Path | Responsibility |
| --- | --- |
| `apps/chrome` | Popup, background service worker, offscreen host, capture adapter and overlay transport |
| `packages/contracts` | Typed media, session, revision and presentation messages |
| `packages/core` | Platform-independent session/revision/presentation policies |
| `packages/engines-browser` | Browser model preparation, workers, ASR, VAD, translation and speaker tracking |
| `packages/media-web` | Web media acquisition, PCM worklet and selected-video adapter |
| `packages/presentation-web` | Caption display and history views |
| `tests` | Unit, fixture and real browser/model verification |

The selected-video adapter and its tests remain internal groundwork, not a shipping Safari implementation. Retain internal `interpreter` cache keys and protocol selectors where compatibility matters. Public names and GitHub links use Jamak.
