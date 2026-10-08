import type { CaptionRevision, MediaTarget, SessionIdentity, VideoInput } from "../../packages/contracts";
import { createPresentationPolicy } from "../../packages/core/presentation-policy";
import { createSessionController } from "../../packages/core/session-controller";
import { asrCandidates } from "../../packages/engines-browser/model";
import { createComparisonView } from "../../packages/presentation-web/comparison";
import { createChromeEngine } from "./engine";

// The platform host supplies the selected-page input. This module owns no tab,
// native bridge, site permission or persistent transcript storage.
export function createChromeComposition(container: HTMLElement, input: VideoInput, cancelInput?: () => void) {
  const document = container.ownerDocument;
  const window = document.defaultView;
  if (!window) throw new Error("Chrome composition requires a live document");
  const controls = document.createElement("section"); controls.setAttribute("aria-label", "Interpretation controls");
  const prepare = document.createElement("button"); prepare.type = "button"; prepare.textContent = "Prepare selected language";
  const start = document.createElement("button"); start.type = "button"; start.textContent = "Start interpretation"; start.disabled = true;
  const stop = document.createElement("button"); stop.type = "button"; stop.textContent = "Stop interpretation";
  const preparation = document.createElement("p"); preparation.setAttribute("role", "status");
  const model = asrCandidates.smallFp16;
  const modelInfo = document.createElement("p");
  modelInfo.textContent = `${model.model.id} @ ${model.model.version}; FP16 / WebGPU; model files ${model.files.reduce((bytes, file) => bytes + file.bytes, 0)} bytes. Runtime and speech-detector storage are additional.`;
  controls.append(prepare, start, stop, modelInfo, preparation); container.append(controls);
  const output = createComparisonView(container);
  let selection: { target: MediaTarget; language: "ja" | "en" } | undefined;
  let engine: ReturnType<typeof createChromeEngine> | undefined;
  let policy: ReturnType<typeof createPresentationPolicy> | undefined;
  let generation = 0;
  let disposed = false;
  let stopping: Promise<void> | undefined;
  const clock = { now: () => window.performance.now(), schedule(callback: () => void, delay: number) {
    const id = window.setTimeout(callback, delay); return () => window.clearTimeout(id);
  } };
  function activate(identity: SessionIdentity) {
    if (policy) policy.activate(identity);
    else policy = createPresentationPolicy(identity, clock, output.present);
    output.activate(identity);
  }
  const controller = createSessionController({ input, createSessionId: () => window.crypto.randomUUID(),
    createEngine() { if (!engine?.ready) throw new Error("Prepare the selected language first"); return engine.port; },
    onCaption(caption: CaptionRevision) {
      output.compare(caption);
      policy?.accept(caption.translation.state === "pending" ? { type: "transcript", revision: caption.source }
        : { type: "paired-caption", caption }, caption.videoRange);
    },
    onClear(identity) { output.present({ type: "clear", identity }); policy?.clear(); },
    onStatus(status) {
      if (controller.identity && status.state === "probing") activate(controller.identity);
      output.status(status);
      if (status.state === "paused" || status.state === "unavailable" || status.state === "failed" || status.state === "idle") {
        start.disabled = true; prepare.disabled = !!engine || !selection;
        preparation.textContent = "Press Stop, then Prepare to start a fresh session after an interruption.";
      }
    },
  });
  const unsubscribe = output.onDisplayProgress(progress => policy?.progress(progress));

  function stopSession(): Promise<void> {
    if (stopping) return stopping;
    generation++; start.disabled = true; prepare.disabled = true;
    cancelInput?.();
    const owned = engine; engine = undefined;
    // Controller invalidation happens before asynchronous resource cleanup.
    const stopped = controller.stop(); policy?.clear();
    stopping = Promise.allSettled([stopped, owned?.port.close()]).then(results => {
      const failure = results.find(result => result.status === "rejected");
      if (failure?.status === "rejected") preparation.textContent = `Cleanup failed: ${String(failure.reason)}`;
      else preparation.textContent = "Stopped. Model cache and comparison history are retained.";
    }).finally(() => { stopping = undefined; if (!disposed) prepare.disabled = !selection; });
    return stopping;
  }
  prepare.disabled = true;
  prepare.onclick = () => {
    if (!selection || engine || stopping || disposed) return;
    const current = ++generation;
    engine = createChromeEngine(document, selection.language, message => { if (current === generation) preparation.textContent = message; });
    const owned = engine; prepare.disabled = true;
    owned.prepareFromGesture().then(() => {
      if (current !== generation || disposed) return;
      preparation.textContent = "Ready: small FP16 / WebGPU and selected native translator. Play the selected video, then Start."; start.disabled = false;
    }).catch(error => {
      if (current !== generation || disposed) return;
      preparation.textContent = `Preparation failed: ${error.message}. Press Stop before retrying.`;
    });
  };
  start.onclick = () => {
    if (!selection || !engine?.ready || start.disabled || stopping || disposed) return;
    start.disabled = true; prepare.disabled = true;
    void controller.start(selection.target, { source: selection.language, target: "ko" });
  };
  stop.onclick = () => { void stopSession(); };
  function suspend() { if (document.visibilityState !== "visible") void stopSession(); }
  function pagehide() { void stopSession(); }
  document.addEventListener("visibilitychange", suspend); window.addEventListener("pagehide", pagehide);

  return {
    async select(target: MediaTarget | null, language: "ja" | "en") {
      const changed = !selection || !target || target.id !== selection.target.id || language !== selection.language;
      if (!changed) return;
      selection = undefined; await stopSession();
      if (disposed) return;
      selection = target ? { target: { ...target }, language } : undefined;
      prepare.disabled = !selection || !!engine;
      preparation.textContent = selection ? `Selected ${language} → Korean. Prepare before Start.` : "Confirm one video before preparing.";
    },
    async dispose() {
      if (disposed) return; disposed = true;
      await stopSession(); unsubscribe(); policy?.dispose(); output.dispose(); controls.remove();
      document.removeEventListener("visibilitychange", suspend); window.removeEventListener("pagehide", pagehide);
    },
  };
}
