import type { CaptionRevision, MediaTarget, SessionIdentity, VideoInput } from "../../packages/contracts";
import { createPresentationPolicy } from "../../packages/core/presentation-policy";
import { createSessionController } from "../../packages/core/session-controller";
import { asrCandidates } from "../../packages/engines-browser/model";
import { createComparisonView } from "../../packages/presentation-web/comparison";
import { createChromeEngine } from "./engine";
import type { SelectedVideoOutput } from "./overlay";

// The platform host supplies the selected-page input. This module owns no tab,
// native bridge, site permission or persistent transcript storage.
export function createChromeComposition(container: HTMLElement, input: VideoInput, cancelInput?: () => void | Promise<void>, pageOutput?: SelectedVideoOutput, scope: "selected-video" | "tab-mix" = "selected-video") {
  const document = container.ownerDocument;
  const window = document.defaultView;
  if (!window) throw new Error("Chrome composition requires a live document");
  const controls = document.createElement("section"); controls.setAttribute("aria-label", "Interpretation controls");
  controls.className = "interpretation-controls";
  const prepare = document.createElement("button"); prepare.type = "button"; prepare.textContent = "모델 준비";
  const start = document.createElement("button"); start.type = "button"; start.textContent = "번역 시작"; start.disabled = true;
  const stop = document.createElement("button"); stop.type = "button"; stop.textContent = "중지"; stop.disabled = true;
  const preparation = document.createElement("p"); preparation.setAttribute("role", "status");
  preparation.className = "preparation-status";
  const model = asrCandidates.turboFp16;
  const modelInfo = document.createElement("p");
  modelInfo.textContent = `${model.model.id} @ ${model.model.version}; FP16 / WebGPU; model files ${model.files.reduce((bytes, file) => bytes + file.bytes, 0)} bytes. Runtime and speech-detector storage are additional.`;
  const details = document.createElement("details");
  const summary = document.createElement("summary"); summary.textContent = "모델 정보";
  const diagnostics = document.createElement("p");
  details.append(summary, modelInfo, diagnostics);
  controls.append(prepare, start, stop, preparation, details); container.append(controls);
  const output = createComparisonView(container, scope === "tab-mix" ? "capture" : "video");
  const history = document.createElement("details"); history.className = "history"; history.hidden = true;
  const historySummary = document.createElement("summary"); historySummary.textContent = "원문 · 번역 기록";
  const table = container.querySelector(".interpreter-comparison");
  if (table) { table.before(history); history.append(historySummary, table); }
  let selection: { target: MediaTarget; language: "ja" | "en" } | undefined;
  let engine: ReturnType<typeof createChromeEngine> | undefined;
  let policy: ReturnType<typeof createPresentationPolicy> | undefined;
  let generation = 0;
  let disposed = false;
  let interpreting = false;
  let stopping: Promise<void> | undefined;
  const clock = { now: () => window.performance.now(), schedule(callback: () => void, delay: number) {
    const id = window.setTimeout(callback, delay); return () => window.clearTimeout(id);
  } };
  function activate(identity: SessionIdentity) {
    if (policy) policy.activate(identity);
    else policy = createPresentationPolicy(identity, clock, output.present);
    output.activate(identity);
    if (selection) pageOutput?.activate(selection.target, identity);
  }
  const controller = createSessionController({ input, createSessionId: () => window.crypto.randomUUID(),
    createEngine() { if (!engine?.ready) throw new Error("Prepare the selected language first"); return engine.port; },
    onCaption(caption: CaptionRevision) {
      if (history.hidden) { history.hidden = false; history.open = true; }
      output.compare(caption); pageOutput?.compare(caption);
      policy?.accept(caption.translation.state === "pending" ? { type: "transcript", revision: caption.source }
        : { type: "paired-caption", caption }, caption.videoRange);
    },
    onClear(identity) { pageOutput?.clear(identity); output.present({ type: "clear", identity }); policy?.clear(); },
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
    interpreting = false;
    if (scope === "tab-mix") selection = undefined;
    generation++; start.disabled = true; prepare.disabled = true; stop.disabled = true;
    const cancelled = cancelInput?.();
    const owned = engine; engine = undefined;
    // Controller invalidation happens before asynchronous resource cleanup.
    const stopped = controller.stop(); policy?.clear();
    stopping = Promise.allSettled([stopped, cancelled, owned?.port.close()]).then(results => {
      const failure = results.find(result => result.status === "rejected");
      if (failure?.status === "rejected") preparation.textContent = `Cleanup failed: ${String(failure.reason)}`;
      else preparation.textContent = "중지됨 · 다시 준비하면 번역을 시작할 수 있습니다.";
    }).finally(() => { stopping = undefined; if (!disposed) prepare.disabled = !selection; });
    return stopping;
  }
  prepare.disabled = true;
  prepare.onclick = () => {
    if (!selection || engine || stopping || disposed) return;
    const current = ++generation;
    stop.disabled = false;
    preparation.textContent = "번역 모델 준비 중… 처음에는 약 1.6GB를 다운로드합니다.";
    engine = createChromeEngine(document, selection.language, (message, progress) => {
      if (current !== generation) return;
      diagnostics.textContent = message;
      if (progress) preparation.textContent = progress;
    });
    const owned = engine; prepare.disabled = true;
    owned.prepareFromGesture().then(() => {
      if (current !== generation || disposed) return;
      preparation.textContent = "준비 완료 · 번역을 시작할 수 있습니다."; start.disabled = false;
    }).catch(error => {
      if (current !== generation || disposed) return;
      preparation.textContent = `Preparation failed: ${error.message}. Press Stop before retrying.`;
    });
  };
  start.onclick = () => {
    if (!selection || !engine?.ready || start.disabled || stopping || disposed) return;
    interpreting = true;
    start.disabled = true; prepare.disabled = true;
    void controller.start(selection.target, { source: selection.language, target: "ko" });
  };
  stop.onclick = () => { void stopSession(); };
  function suspend() { if (document.visibilityState !== "visible" && interpreting) void stopSession(); }
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
      stop.disabled = scope !== "tab-mix" || !selection;
      preparation.textContent = selection ? `${language === "ja" ? "일본어" : "영어"} → 한국어 · 문장 단위로 번역합니다.` : (scope === "tab-mix" ? "탭에 연결한 뒤 모델을 준비할 수 있습니다." : "번역할 영상을 선택하세요.");
    },
    async dispose() {
      if (disposed) return; disposed = true;
      await stopSession(); unsubscribe(); policy?.dispose(); output.dispose(); controls.remove();
      document.removeEventListener("visibilitychange", suspend); window.removeEventListener("pagehide", pagehide);
    },
  };
}
