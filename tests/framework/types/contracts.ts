import type {
  AudioChunk, CaptionRevision, EngineCapabilities, FrameworkEnvelope, MediaTarget,
  MediaTargetId, PlaybackEvent, SessionIdentity, TranscriptRevision, TranslationRevision,
} from "../../../packages/contracts";

// An adapter issues an opaque handle while keeping its DOM lookup private.
const target: MediaTarget = { id: "fixture-video" as MediaTargetId, documentId: "document-1", frameId: "frame-1" };
const identity: SessionIdentity = { sessionId: "fixture-session", targetId: target.id, epoch: 0 };
const chunk: AudioChunk = {
  identity, scope: "selected-video", sequence: 0, audioRange: { startMs: 0, endMs: 20 },
  capture: { clockId: "page-1", startMs: 50, endMs: 70 },
  sampleRate: 24000, channels: 1, sampleFormat: "pcm-s16le", pcm: new ArrayBuffer(960),
};
const playback: PlaybackEvent = {
  identity, sequence: 1, type: "seek",
  anchor: { clockId: "page-1", monotonicMs: 70, mediaTimeMs: 10000, playbackRate: 1 },
};
const source: TranscriptRevision = {
  identity, utteranceId: "generated-1", sourceRevision: 3, text: "Generated fixture",
  final: true, audioRange: chunk.audioRange, language: "en",
};
// Source finality does not imply final translation; counters are independent.
const translation: TranslationRevision = {
  identity, utteranceId: source.utteranceId, sourceRevision: 3, translationRevision: 1,
  languages: { source: "en", target: "ko" }, text: "합성 시험", final: false,
};
const pending: CaptionRevision = { source, translation: { state: "pending" } };
const paired: CaptionRevision = { source, translation: { state: "paired", revision: translation } };
const companion: EngineCapabilities = {
  availability: { state: "unverified", reason: "model-unverified", message: "Contract fixture only" },
  pipeline: "combined-interpretation", asrOnlyUpdates: false,
  languages: translation.languages, models: [],
  limits: { maxChunkBytes: 960, maxAudioQueueMs: 1000, maxPendingUtterances: 1, maxTranslationJobs: 1, maxStoredCaptions: 300 },
};

export const envelopes: readonly FrameworkEnvelope[] = [
  { version: 1, message: { type: "audio", chunk } },
  { version: 1, message: { type: "audio", chunk: { ...chunk, scope: "tab-mix" } } },
  { version: 1, message: { type: "playback", event: playback } },
  { version: 1, message: { type: "transcript", revision: source } },
  { version: 1, message: { type: "translation", revision: translation } },
  { version: 1, message: { type: "paired-caption", caption: paired } },
  { version: 1, message: { type: "presentation", event: { type: "update", caption: pending } } },
  { version: 1, message: { type: "presentation", event: { type: "replay", caption: paired, partIndex: 0 } } },
  { version: 1, message: { type: "presentation", event: { type: "fade", identity, utteranceId: source.utteranceId, durationMs: 250 } } },
  { version: 1, message: { type: "presentation", event: { type: "remove", identity, utteranceId: source.utteranceId } } },
  { version: 1, message: { type: "presentation", event: { type: "clear", identity } } },
  { version: 1, message: { type: "status", status: { identity, state: "preparing", message: companion.availability.state } } },
  { version: 1, message: { type: "display-progress", progress: { identity, utteranceId: source.utteranceId, sourceRevision: 3, translationRevision: 1, partIndex: 0, complete: false, visible: true, characterCount: 4 } } },
];

// Negative conformance checks: tsc fails if a prohibited shape becomes accepted.
// @ts-expect-error Handles cannot be arbitrary strings from host commands.
const invalidTarget: MediaTarget = { id: "raw-video", documentId: "d", frameId: "f" };
// @ts-expect-error A DOM-free compile must not expose HTMLElement.
export type ForbiddenElement = HTMLElement;
// @ts-expect-error A DOM-free compile must not expose chrome ambient types.
export type ForbiddenChrome = chrome.tabs.Tab;
// @ts-expect-error Core contracts cannot use Node ambient types.
export type ForbiddenNode = NodeJS.Process;
// @ts-expect-error Socket transport belongs to an adapter.
export type ForbiddenSocket = WebSocket;
// @ts-expect-error GPU execution belongs to an engine adapter.
export type ForbiddenGPU = GPUDevice;
// @ts-expect-error Unsupported protocol version.
const invalidVersion: FrameworkEnvelope = { version: 2, message: { type: "audio", chunk } };
// @ts-expect-error Epoch is mandatory for all session events.
const missingEpoch: SessionIdentity = { sessionId: "s", targetId: target.id };
// @ts-expect-error Capture intervals must identify their monotonic clock.
const missingClock: AudioChunk = { ...chunk, capture: { startMs: 50, endMs: 70 } };
// @ts-expect-error Translation must identify the exact source revision.
const missingSourceRevision: TranslationRevision = { identity, utteranceId: "u", translationRevision: 1, languages: translation.languages, text: "", final: false };
// @ts-expect-error Translation revision cannot replace source revision.
const missingTranslationRevision: TranslationRevision = { identity, utteranceId: "u", sourceRevision: 1, languages: translation.languages, text: "", final: false };
// @ts-expect-error Pending captions cannot carry a stale paired translation.
const stalePair: CaptionRevision = { source, translation: { state: "pending", revision: translation } };
// @ts-expect-error Unavailability must include a stable reason and actionable message.
const missingReason: EngineCapabilities = { ...companion, availability: { state: "unavailable" } };
// @ts-expect-error Confidence is named by the supplying engine, not a universal score.
const fakeConfidence: TranscriptRevision = { ...source, confidence: 0.9 };

void [invalidTarget, invalidVersion, missingEpoch, missingClock, missingSourceRevision,
  missingTranslationRevision, stalePair, missingReason, fakeConfidence];
