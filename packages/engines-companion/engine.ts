import type { AudioChunk, CaptionRevision, EngineCapabilities, InterpretationEngine, InterpretationEvent, LanguagePair, SessionIdentity } from "../contracts";
import { createCompanionCaptionBridge } from "./captions";

// Settings remain the companion's existing request body, without model defaults or migration.
export interface CompanionSettings {
  provider: "local" | "openai-direct" | "luna" | "anthropic";
  asr: "local" | "openai";
  sourceLanguage: string;
  targetLanguage: string;
  asrModel: string;
  textModel: string;
}

export interface CompanionReceipt {
  frames: number;
  samples: number;
  peak: number;
  droppedFrames: number;
  droppedUtterances: number;
}

export interface CompanionTransport {
  prepare(receive: (reply: unknown) => void): Promise<void>;
  send(packet: ArrayBuffer): void;
  close(): Promise<void>;
}

export const companionLimits = {
  maxChunkBytes: 960, maxAudioQueueMs: 1000, maxPendingUtterances: 2,
  maxTranslationJobs: 1, maxStoredCaptions: 300,
};

export function decodeCompanionPCM(packet: ArrayBuffer, identity: SessionIdentity): AudioChunk {
  if (packet.byteLength !== 988) throw new Error("Expected one PCM1 20 ms frame.");
  const view = new DataView(packet);
  const sequence = view.getUint32(8, true);
  if (view.getUint32(0, true) !== 0x314d4350 || view.getUint32(4, true) !== 24000
    || view.getFloat64(12, true) !== sequence * 20 || view.getUint32(20, true) !== 480
    || view.getUint16(24, true) !== 1 || view.getUint16(26, true) !== 1) throw new Error("Invalid PCM1 frame.");
  return { identity, scope: "tab-mix", sequence, audioRange: { startMs: sequence * 20, endMs: (sequence + 1) * 20 },
    capture: { clockId: `companion-pcm:${identity.sessionId}`, startMs: sequence * 20, endMs: (sequence + 1) * 20 },
    sampleRate: 24000, channels: 1, sampleFormat: "pcm-s16le", pcm: packet.slice(28) };
}

type CompanionEvent = Exclude<InterpretationEvent, { type: "paired-caption" }>
  | { type: "paired-caption"; caption: CaptionRevision; emittedAtMs: number };

export function createCompanionEngine(wireSessionId: string, transport: CompanionTransport,
  settings?: CompanionSettings, receipt?: (value: CompanionReceipt) => void) {
  const languages = settings ? { source: settings.sourceLanguage, target: settings.targetLanguage } : { source: "und", target: "und" };
  let identity: SessionIdentity | undefined;
  let bridge: ReturnType<typeof createCompanionCaptionBridge> | undefined;
  let active = false;
  let prepared = false;
  let running = false;
  let failure: string | undefined;
  let closing: Promise<void> | undefined;
  const events: CompanionEvent[] = [];
  let wake: (() => void) | undefined;
  let finishAudio!: () => void;
  const stopped = new Promise<undefined>((resolve) => { finishAudio = () => resolve(undefined); });

  function notify() { wake?.(); wake = undefined; }
  function fail(message: string) { if (active) { failure = message; finishAudio(); notify(); } }
  function receive(value: unknown) {
    if (!active || failure || !identity || !value || typeof value !== "object") return;
    const reply = value as { sessionId?: unknown; type?: unknown; caption?: unknown; message?: unknown } & Partial<CompanionReceipt>;
    if (reply.sessionId !== wireSessionId) return;
    if (reply.type === "caption") {
      const caption = bridge?.accept(reply.caption);
      if (caption) events.push({ type: "paired-caption", caption, emittedAtMs: (reply.caption as { emittedAtMs: number }).emittedAtMs });
    } else if ((reply.type === "status" || reply.type === "error") && typeof reply.message === "string") {
      if (reply.type === "error") { fail(reply.message); return; }
      events.push({ type: "status", status: { identity, state: "running", message: reply.message } });
    } else if (reply.type === "receipt") {
      const { frames, samples, peak, droppedFrames = 0, droppedUtterances = 0 } = reply;
      if ([frames, samples, peak, droppedFrames, droppedUtterances].every((number) => Number.isSafeInteger(number) && (number as number) >= 0)) {
        receipt?.({ frames: frames as number, samples: samples as number, peak: peak as number, droppedFrames, droppedUtterances });
      }
    }
    if (events.length > companionLimits.maxStoredCaptions) { fail("Companion output is too slow. Start again to reconnect."); return; }
    notify();
  }

  async function close() {
    active = false;
    events.length = 0;
    finishAudio();
    notify();
    closing ??= transport.close();
    await closing;
  }

  async function sendAudio(audio: AsyncIterable<AudioChunk>) {
    const iterator = audio[Symbol.asyncIterator]();
    let sequence = 0;
    try {
      while (active && !failure) {
        const next = await Promise.race([iterator.next(), stopped]);
        if (!next || next.done || !active || failure) break;
        const chunk = next.value;
        if (!identity || chunk.identity.sessionId !== identity.sessionId || chunk.identity.targetId !== identity.targetId
          || chunk.identity.epoch !== identity.epoch || chunk.sequence !== sequence || sequence > 0xffffffff
          || chunk.sampleRate !== 24000 || chunk.channels !== 1 || chunk.sampleFormat !== "pcm-s16le"
          || chunk.pcm.byteLength !== 960 || chunk.audioRange.startMs !== sequence * 20
          || chunk.audioRange.endMs !== (sequence + 1) * 20) throw new Error("Invalid companion audio identity, sequence or PCM format.");
        const packet = new ArrayBuffer(988);
        const view = new DataView(packet);
        view.setUint32(0, 0x314d4350, true); view.setUint32(4, 24000, true); view.setUint32(8, sequence, true);
        view.setFloat64(12, sequence * 20, true); view.setUint32(20, 480, true);
        view.setUint16(24, 1, true); view.setUint16(26, 1, true);
        new Uint8Array(packet, 28).set(new Uint8Array(chunk.pcm));
        transport.send(packet);
        sequence++;
      }
    } catch (error) { fail(error instanceof Error ? error.message : "Companion audio failed."); }
    finally { void iterator.return?.().catch(() => {}); }
  }

  return {
    async probe(pair): Promise<EngineCapabilities> {
      const matches = pair.source === languages.source && pair.target === languages.target;
      return { pipeline: "combined-interpretation", asrOnlyUpdates: false, languages: { ...languages }, models: [],
        // The protocol has no model version/load probe; readiness is established by prepare's ready response.
        availability: closing ? { state: "unavailable", reason: "context-destroyed", message: "Start a new authenticated companion session." }
          : matches ? { state: "available" } : { state: "unavailable", reason: "language-pair-unsupported", message: "Start a new companion session with these language settings." },
        limits: { ...companionLimits } };
    },
    async prepare(session: SessionIdentity, pair: LanguagePair) {
      if (identity || closing || pair.source !== languages.source || pair.target !== languages.target) throw new Error("Start a new companion session with these language settings.");
      identity = { ...session };
      bridge = createCompanionCaptionBridge(identity, languages, wireSessionId);
      active = true;
      await transport.prepare(receive);
      if (!active) throw new Error("Capture stopped during preparation.");
      prepared = true;
    },
    async *run(audio): AsyncGenerator<CompanionEvent> {
      if (!prepared || !active || running) throw new Error("Companion is not ready or already running.");
      running = true;
      const sending = sendAudio(audio);
      try {
        while (active) {
          if (failure) {
            yield { type: "status", status: { identity: identity as SessionIdentity, state: "failed", reason: "engine-failed", message: failure } };
            break;
          }
          const event = events.shift();
          if (event) yield event;
          else await new Promise<void>((resolve) => { wake = resolve; });
        }
      } finally { await close(); await sending; }
    },
    async cancel(session) {
      if (identity && session.sessionId === identity.sessionId && session.targetId === identity.targetId && session.epoch === identity.epoch) await close();
    },
    close,
  } satisfies InterpretationEngine;
}
