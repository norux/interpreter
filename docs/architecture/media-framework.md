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

## Models

| Task | Runtime/model | Conditions |
| --- | --- | --- |
| Recognition | Chrome SODA, local SpeechRecognition | Preferred when the required local API and language packs are available |
| Automatic recognition / fallback | Whisper large-v3-turbo FP16 through Transformers.js/ONNX | WebGPU-capable device; larger first download; automatic mode shares acoustic encoding between language detection and transcription |
| Voice activity for fallback | Silero VAD | Bundled ONNX runtime; pinned artifact |
| Translation | Chrome TranslateKit | Local Translator API and English/Japanese → Korean packs |
| Speaker embeddings | WeSpeaker VoxCeleb ResNet34-LM q8 | Local WASM worker; ~6.7 MB first download |

The complete pinned artifact inventory, sizes and hashes lives in `packages/engines-browser/model.ts`. Preparation/testing candidates are not all user-selectable product modes. Model downloads use the manifest's allowed Hugging Face endpoints; inference does not send audio or embeddings to a server. Chrome manages its own language packs. Availability is device/browser dependent; first downloads need internet.

WeSpeaker weights are CC-BY-4.0; see [attribution](../verification/captions/conversation-speakers.md). The upstream [Whisper weights](https://huggingface.co/openai/whisper-large-v3-turbo) and [Silero VAD](https://github.com/snakers4/silero-vad) are MIT-licensed. Model licenses remain separate from the application license. Consult each registered upstream model card before redistributing weights.

## Automatic language routing

`auto` belongs to session settings; transcript and translation revisions carry the actual utterance language. Automatic mode uses the existing multilingual Whisper weights, not a text decision model or additional language-ID download. The pinned Transformers.js 4.3.0 implementation defaults to English when language is omitted, so the ASR worker explicitly decodes the first language token, calculates probabilities across the model's language tokens, and chooses between `en`, `ja` and `ko`. It then transcribes using the same encoder output. Its pinned SDK adapter admits `encoder_outputs` into the model's forward parameters; verify real model execution when upgrading the SDK.

Recent confident language is a session-local tie breaker only when acoustic scores differ by less than 0.05. Clear new evidence can switch immediately. These raw model probabilities are not calibrated accuracy guarantees. Growing snapshots retain initial PCM; low-confidence snapshots shorter than two seconds wait for more evidence, while a completed speech boundary is decoded with the available audio. A 240 ms VAD pause queues an automatic-mode boundary even during active inference. Jobs drain each boundary before analyzing the next turn. Silence never triggers noise-only recognition; queues and PCM remain bounded. A switch within uninterrupted or overlapping speech may still share one language for that window.

Preparation loads both English/Japanese → Korean native translators. The bounded translation queue selects a pair from each source revision and preserves exact revision identity. Korean revisions are paired with their own text without a native translation call. Speaker analysis remains asynchronous and independent; no per-speaker language lock or persistent voice/language cache is added. Ready models/pairs are reused within a prepared session and released on Stop; downloaded artifacts stay cached for subsequent preparations.

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
