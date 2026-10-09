import type { InterpretationEngine, ModelStatus, SessionIdentity } from "../../packages/contracts";
import { sameIdentity } from "../../packages/core/identity";
import { createAsrHost } from "../../packages/engines-browser/asr-host";
import { createDocumentTranslator } from "../../packages/engines-browser/document-translator";
import { createLocalSpeechHost } from "../../packages/engines-browser/local-speech";
import { asrCandidates, registeredCandidate, speakerCandidate, vadCandidate } from "../../packages/engines-browser/model";
import { createBrowserPipeline } from "../../packages/engines-browser/pipeline";
import { createSpeakerHost } from "../../packages/engines-browser/speaker-host";
import { createStreamingSpeechRecognizer } from "../../packages/engines-browser/streaming-speech";
import { createVadHost } from "../../packages/engines-browser/vad-host";

export function createChromeEngine(document: Document, source: "ja" | "en" | "ko" | "auto", receive: (message: string, progress?: string, fraction?: number) => void, execution: "foreground" | "offscreen" = "foreground", audioTrack?: () => MediaStreamTrack | undefined) {
  const languages = { source, target: "ko" };
  const model = registeredCandidate(asrCandidates.turboFp16.model, "fp16");
  const report = (status: ModelStatus) => receive(`${status.model.id} @ ${status.model.version}: ${status.state}; ${status.downloadedBytes ?? 0}/${status.requiredBytes} bytes${status.reason ? ` (${status.reason})` : ""}`,
    status.state === "downloading" ? `음성 인식 모델 다운로드 · ${Math.floor((status.downloadedBytes ?? 0) / status.requiredBytes * 100)}%`
      : status.state === "loading" ? "음성 인식 모델을 불러오는 중…" : undefined,
    status.state === "downloading" ? (status.downloadedBytes ?? 0) / status.requiredBytes : undefined);
  const speaker = createSpeakerHost(document, status => receive(`Speaker ${status.state}: ${status.downloadedBytes ?? 0}/${status.requiredBytes}`,
    status.state === "downloading" ? "화자 구분 모델 다운로드 중…" : status.state === "loading" ? "화자 구분 모델을 불러오는 중…" : undefined,
    status.state === "downloading" ? (status.downloadedBytes ?? 0) / status.requiredBytes : undefined));
  let speakerReady = false;
  const asr = createAsrHost(document, "turboFp16", "webgpu", report, execution);
  const vad = createVadHost(document, report, execution);
  const local = (source === "ja" || source === "en") && execution === "offscreen" && audioTrack ? createLocalSpeechHost(document, source, audioTrack, receive) : undefined;
  const usingLocal = local?.supported === true;
  const translator = createDocumentTranslator(document, languages, status => receive(`Translator ${source} → ko: ${status.state}${status.progress === undefined ? "" : ` ${Math.round(status.progress * 100)}%`}${status.reason ? ` (${status.reason})` : ""}`,
    status.state === "preparing" ? `번역 모델 준비${status.progress === undefined ? " 중…" : ` · ${Math.round(status.progress * 100)}%`}` : undefined,
    status.state === "preparing" ? status.progress : undefined), execution);
  let ready = false;
  let preparing = false;
  let disposed = false;
  let generation = 0;
  let identity: SessionIdentity | undefined;
  let pipeline: ReturnType<typeof createBrowserPipeline> | undefined;

  function stopResources() { ready = false; local?.stop(); asr.stop(); vad.stop(); translator.stop(); speaker.stop(); speakerReady = false; }
  const port: InterpretationEngine = {
    async probe(pair) {
      const native = source === "ko" ? { state: "available" as const } : await translator.probe();
      return { availability: pair.source !== source || pair.target !== "ko"
        ? { state: "unavailable", reason: "language-pair-unsupported", message: "Prepare the selected source language" }
        : native.state !== "available" && native.state !== "download-required" ? native
        : ready && !disposed ? { state: "available" }
        : { state: "permission-required", reason: "permission-required", message: "Press Prepare in the visible interpreter document" },
      pipeline: "separate-asr-translation", asrOnlyUpdates: true, languages,
      models: [...usingLocal ? [local.model] : [model.model, vadCandidate.model], speakerCandidate.model], limits: { maxChunkBytes: 8192, maxAudioQueueMs: 1000,
        maxPendingUtterances: 16, maxTranslationJobs: 1, maxStoredCaptions: 300 } };
    },
    async prepare(selected, pair) {
      if (!ready || disposed || pipeline || pair.source !== source || pair.target !== "ko") throw new Error("Press Prepare for a fresh session");
      identity = { ...selected };
      pipeline = createBrowserPipeline(identity, languages, report => usingLocal ? local.createRecognizer(selected, report)
        : createStreamingSpeechRecognizer(selected, source, asr, report, vad), translator, speakerReady ? {
          embed: pcm => speaker.embed(pcm),
          fail: error => receive(`화자 구분을 사용할 수 없습니다: ${String(error)}`),
        } : undefined);
    },
    run(audio) {
      if (!pipeline || !ready || disposed) throw new Error("Browser engine is not prepared");
      return pipeline.run(audio);
    },
    async cancel(selected) {
      if (!identity || !sameIdentity(identity, selected)) return;
      ready = false; await pipeline?.cancel(selected);
    },
    async close() {
      if (disposed) return;
      disposed = true; generation++; stopResources();
      await pipeline?.close(); local?.dispose(); speaker.dispose(); asr.dispose(); vad.dispose(); await translator.close();
      document.removeEventListener("visibilitychange", suspend);
      document.defaultView?.removeEventListener("pagehide", interrupt);
    },
  };
  function interrupt() { generation++; stopResources(); if (identity) void port.cancel(identity); }
  function suspend() { if (execution === "foreground" && document.visibilityState !== "visible" && pipeline) interrupt(); }
  document.addEventListener("visibilitychange", suspend);
  document.defaultView?.addEventListener("pagehide", interrupt);

  return {
    port,
    async prepareFromGesture() {
      if (disposed || preparing || ready || pipeline) throw new Error("Stop before preparing another session");
      const current = ++generation; preparing = true;
      try {
        // Local speech observes Chrome's popup-initiated language-pack download.
        await Promise.all([usingLocal ? local.prepare() : asr.prepare(), usingLocal ? undefined : vad.prepare(), source === "ko" ? undefined : translator.prepare(), speaker.prepare().then(() => { speakerReady = true; }).catch(error => {
          if (current === generation) receive(`화자 구분 모델 준비 실패: ${String(error)}`);
        })]);
        if (disposed || current !== generation) throw new DOMException("Preparation stopped", "AbortError");
        ready = true;
      } catch (error) { if (current === generation) stopResources(); throw error; }
      finally { if (current === generation) preparing = false; }
    },
    get ready() { return ready; },
    get models() {
      return [
        { task: source === "auto" ? "언어 감지 · 받아쓰기" : "받아쓰기", name: usingLocal ? "Chrome SODA" : "Whisper large-v3-turbo · FP16 / WebGPU" },
        ...usingLocal ? [] : [{ task: "발화 감지", name: "Silero VAD" }],
        ...source === "ko" ? [] : [{ task: "한국어 번역", name: "Chrome TranslateKit" }],
        { task: "화자 구분", name: "WeSpeaker VoxCeleb ResNet34-LM · q8" },
      ];
    },
    get running() { return !usingLocal || local.running; },
  };
}
