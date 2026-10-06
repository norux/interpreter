import type { CaptionRevision, InterpretationEngine, LanguagePair, MediaTarget, PlaybackEvent, ReasonCode, RuntimeLimits, SessionIdentity, SessionStatus, VideoInput } from "../contracts";
import { createAudioQueue } from "./audio-queue";
import { sameIdentity } from "./identity";
import { createRevisionStore } from "./revision-store";
import { createTimeline } from "./timeline";

export function createSessionController(ports: {
  input: VideoInput;
  // Each Start gets a session-owned engine; late cleanup cannot close its successor.
  createEngine(): InterpretationEngine;
  createSessionId(): string;
  onCaption(caption: CaptionRevision): void;
  onClear(identity: SessionIdentity): void;
  onStatus(status: SessionStatus): void;
}) {
  type Run = {
    target: MediaTarget;
    languages: LanguagePair;
    engine: InterpretationEngine;
    timeline: ReturnType<typeof createTimeline>;
    store?: ReturnType<typeof createRevisionStore>;
    limits?: RuntimeLimits;
    queue?: ReturnType<typeof createAudioQueue>;
    input?: Awaited<ReturnType<VideoInput["open"]>>;
    state: SessionStatus["state"];
    retired: boolean;
    droppedMs: number;
    cleanup?: Promise<void>;
  };
  let current: Run | undefined;
  let lastStore: Run["store"];
  let controls = Promise.resolve();

  function live(run: Run, identity: SessionIdentity): boolean {
    return current === run && !run.retired && sameIdentity(run.timeline.identity, identity);
  }

  function status(run: Run, state: SessionStatus["state"], reason?: ReasonCode): void {
    run.state = state;
    ports.onStatus({ identity: run.timeline.identity, state, reason, message: reason ?? state,
      queue: { pendingAudioMs: run.queue?.pendingMs ?? 0, droppedAudioMs: run.droppedMs } });
  }

  function serialize(operation: () => Promise<void>): Promise<void> {
    const result = controls.then(operation);
    controls = result.catch(() => {});
    return result;
  }

  function retire(run: Run): void {
    run.retired = true;
    run.queue?.close();
    ports.onClear(run.timeline.identity);
  }

  async function release(run: Run): Promise<void> {
    if (run.cleanup) return run.cleanup;
    run.cleanup = (async () => {
      status(run, "stopping");
      const input = run.input;
      run.input = undefined;
      const results = await Promise.allSettled([
        Promise.resolve().then(() => run.engine.cancel(run.timeline.identity)),
        Promise.resolve().then(() => input?.close()),
      ]);
      const closed = await Promise.allSettled([Promise.resolve().then(() => run.engine.close())]);
      const failure = [...results, ...closed].find((result) => result.status === "rejected");
      if (failure?.status === "rejected") {
        status(run, "failed", "engine-failed");
        throw failure.reason;
      }
      status(run, "idle");
    })();
    return run.cleanup;
  }

  async function fail(run: Run, identity: SessionIdentity, reason: ReasonCode): Promise<void> {
    if (!live(run, identity)) return;
    status(run, "failed", reason);
    retire(run);
    current = undefined;
    await serialize(() => release(run));
  }

  async function consumeEngine(run: Run, identity: SessionIdentity, queue: ReturnType<typeof createAudioQueue>): Promise<void> {
    try {
      for await (const event of run.engine.run(queue.stream)) {
        if (!live(run, identity)) break;
        if (event.type === "status") {
          if (!sameIdentity(identity, event.status.identity)) continue;
          if (event.status.state === "failed") {
            await fail(run, identity, event.status.reason ?? "engine-failed");
            return;
          }
          ports.onStatus(event.status);
          continue;
        }
        const source = event.type === "transcript" ? event.revision : event.type === "paired-caption" ? event.caption.source : undefined;
        const translation = event.type === "translation" ? event.revision
          : event.type === "paired-caption" && event.caption.translation.state === "paired" ? event.caption.translation.revision : undefined;
        if (source && source.language !== run.languages.source) continue;
        if (translation && (translation.languages.source !== run.languages.source || translation.languages.target !== run.languages.target)) continue;
        const caption = run.store?.accept(event, source ? run.timeline.map(source.audioRange) : undefined);
        if (caption) ports.onCaption(caption);
      }
      if (live(run, identity) && run.state === "running") await fail(run, identity, "engine-failed");
    } catch {
      await fail(run, identity, "engine-failed");
    }
  }

  async function consumeInput(run: Run, identity: SessionIdentity, input: Awaited<ReturnType<VideoInput["open"]>>): Promise<void> {
    try {
      for await (const event of input.events) {
        if (!live(run, identity)) break;
        if ("type" in event) {
          await playback(event);
          if (!live(run, identity)) break;
        } else {
          const order = run.timeline.audio(event);
          if (order === "stale") continue;
          if (order === "invalid") {
            await fail(run, identity, "engine-failed");
            return;
          }
          if (order === "gap") {
            run.droppedMs += Math.max(0, event.audioRange.startMs - run.timeline.audioEndMs)
              + event.audioRange.endMs - event.audioRange.startMs + (run.queue?.pendingMs ?? 0);
            await transition(run, "audio-gap", true);
            break;
          }
          const result = run.queue?.push(event);
          if (result?.state === "overflow") {
            run.droppedMs += result.droppedMs;
            await transition(run, "overloaded", true);
            break;
          }
        }
      }
      if (live(run, identity) && run.state === "running") await stop();
    } catch {
      await fail(run, identity, "engine-failed");
    }
  }

  async function open(run: Run, identity: SessionIdentity): Promise<void> {
    try {
      status(run, "preparing");
      await run.engine.prepare(identity, run.languages);
      if (!live(run, identity)) return;
      const input = await ports.input.open(run.target, identity);
      if (!live(run, identity)) {
        await input.close();
        return;
      }
      run.input = input;
      const queue = createAudioQueue(identity, run.limits as RuntimeLimits);
      run.queue = queue;
      status(run, "running");
      void consumeEngine(run, identity, queue);
      void consumeInput(run, identity, input);
    } catch {
      await fail(run, identity, "engine-failed");
    }
  }

  async function probe(run: Run, identity: SessionIdentity): Promise<boolean> {
    status(run, "probing");
    const [media, engine] = await Promise.all([ports.input.probe(run.target), run.engine.probe(run.languages)]);
    if (!live(run, identity)) return false;
    const unavailable = media.state !== "available" ? media
      : engine.availability.state !== "available" && engine.availability.state !== "download-required" ? engine.availability : undefined;
    if (unavailable) {
      status(run, "unavailable", unavailable.reason);
      return false;
    }
    run.limits = engine.limits;
    if (!run.store) {
      run.store = createRevisionStore(identity, engine.limits.maxStoredCaptions);
      lastStore = run.store;
    }
    return true;
  }

  async function transition(run: Run, reason: ReasonCode | undefined, paused: boolean, event?: PlaybackEvent): Promise<void> {
    const oldIdentity = run.timeline.identity;
    const identity = run.timeline.advance(event?.anchor);
    run.store?.activate(identity);
    run.queue?.close();
    const input = run.input;
    run.input = undefined;
    ports.onClear(oldIdentity);
    status(run, paused ? "paused" : "preparing", reason);
    try {
      await serialize(async () => {
        const results = await Promise.allSettled([
          Promise.resolve().then(() => run.engine.cancel(oldIdentity)),
          Promise.resolve().then(() => input?.close()),
        ]);
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
      });
      if (!live(run, identity) || paused) return;
      if (await probe(run, identity)) await open(run, identity);
    } catch {
      await fail(run, identity, "engine-failed");
    }
  }

  async function start(target: MediaTarget, languages: LanguagePair): Promise<void> {
    const old = current;
    if (old) retire(old);
    const identity: SessionIdentity = { sessionId: ports.createSessionId(), targetId: target.id, epoch: 0 };
    const run: Run = { target: { ...target }, languages: { ...languages }, engine: ports.createEngine(),
      timeline: createTimeline(identity), state: "idle", retired: false, droppedMs: 0 };
    current = run;
    try {
      await serialize(async () => { if (old) await release(old); });
      if (live(run, identity) && await probe(run, identity)) await open(run, identity);
    } catch {
      await fail(run, identity, "engine-failed");
    }
  }

  function stop(): Promise<void> {
    const run = current;
    if (!run) return controls;
    retire(run);
    current = undefined;
    return serialize(() => release(run));
  }

  async function playback(event: PlaybackEvent): Promise<void> {
    const run = current;
    if (!run?.timeline.playback(event)) return;
    if (event.type === "end") await stop();
    else if (event.type === "pause") await transition(run, undefined, true, event);
    else if (event.type === "play" && run.state === "paused") await transition(run, undefined, false, event);
    else if (event.type === "seek" || event.type === "rate" || event.type === "source") await transition(run, undefined, run.state === "paused", event);
  }

  return {
    start,
    stop,
    playback,
    suspend(): Promise<void> {
      return current ? transition(current, "suspended", true) : Promise.resolve();
    },
    snapshot(): readonly CaptionRevision[] { return (current?.store ?? lastStore)?.snapshot() ?? []; },
    get identity(): SessionIdentity | undefined { return current?.timeline.identity; },
  };
}
