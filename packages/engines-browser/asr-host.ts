import type { ModelStatus, TranscriptRevision } from "../contracts";
import { type AsrJob, validAsrJob } from "./asr-protocol";
import { asrCandidates, registeredCandidate } from "./model";

// This bounded utterance executor is not yet the streaming/VAD engine adapter.
export function createAsrHost(document: Document, candidate: keyof typeof asrCandidates, device: "wasm" | "webgpu", receive: (status: ModelStatus) => void) {
  const selected = registeredCandidate(asrCandidates[candidate].model);
  let worker: Worker | undefined;
  let requestId = 0;
  let ready = false;
  let disposed = false;
  let failure: string | undefined;
  let pending: { resolve(value: { text: string; inferenceMs: number } | undefined): void; reject(error: Error): void } | undefined;
  function stop() {
    requestId++; ready = false;
    worker?.terminate(); worker = undefined;
    const operation = pending; pending = undefined;
    operation?.reject(new DOMException("ASR stopped", "AbortError"));
  }
  function fail(reason: string) {
    const operation = pending; pending = undefined;
    failure = reason; stop(); operation?.reject(new Error(reason));
  }
  function request(type: "prepare" | "recognize", job?: AsrJob) {
    if (disposed || !document.defaultView?.isSecureContext || document.visibilityState !== "visible") return Promise.reject(new Error("A visible secure document is required"));
    if (pending) return Promise.reject(new Error("overloaded"));
    if (type === "prepare" && !document.defaultView.navigator.userActivation.isActive) return Promise.reject(new Error("Press Prepare in this document to start"));
    if (type === "recognize" && (!ready || !validAsrJob(job))) return Promise.reject(new Error(failure ?? "Invalid ASR job or model not ready"));
    if (type === "prepare" && ready) return Promise.reject(new Error("Stop before preparing another model"));
    if (!worker) {
      worker = new Worker(new URL("./asr-worker.ts", import.meta.url), { type: "module" });
      const currentWorker = worker;
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (worker !== currentWorker) return;
        const data = event.data;
        if (!data || typeof data !== "object" || !("version" in data) || data.version !== 1 || !("type" in data)) { fail("Invalid ASR worker response"); return; }
        if (data.type === "gpu-lost") { fail("gpu-lost"); return; }
        if (!("requestId" in data) || data.requestId !== requestId || !pending) return;
        if (data.type === "status" && "status" in data && validStatus(data.status)) { receive(data.status); return; }
        if (data.type === "error" && "reason" in data && typeof data.reason === "string") {
          fail(data.reason); return;
        }
        const operation = pending;
        if (data.type === "ready") { ready = true; pending = undefined; operation.resolve(undefined); return; }
        if (data.type === "result" && "text" in data && typeof data.text === "string" && data.text.length <= 16384
          && "inferenceMs" in data && typeof data.inferenceMs === "number" && Number.isFinite(data.inferenceMs) && data.inferenceMs >= 0) {
          pending = undefined; operation.resolve({ text: data.text, inferenceMs: data.inferenceMs }); return;
        }
        fail("Invalid ASR worker response");
      };
      worker.onerror = () => fail("ASR worker execution failed");
      worker.onmessageerror = () => fail("ASR worker transport failed");
    }
    requestId++; failure = undefined;
    const result = new Promise<{ text: string; inferenceMs: number } | undefined>((resolve, reject) => { pending = { resolve, reject }; });
    worker.postMessage({ version: 1, requestId, type, candidate, device, job }, job ? [job.pcm.buffer as ArrayBuffer] : []);
    return result;
  }
  function validStatus(value: unknown): value is ModelStatus {
    if (!value || typeof value !== "object") return false;
    const status = value as Partial<ModelStatus>;
    return status.model?.id === selected.model.id && status.model.version === selected.model.version
      && status.requiredBytes === selected.requiredBytes && ["absent", "evicted", "cached", "downloading", "loading", "ready", "failed"].includes(status.state ?? "")
      && (status.downloadedBytes === undefined || (Number.isSafeInteger(status.downloadedBytes) && status.downloadedBytes >= 0 && status.downloadedBytes <= selected.requiredBytes))
      && (status.reason === undefined || ["cancelled", "storage-insufficient", "offline-model-unavailable", "model-load-failed", "download-required"].includes(status.reason));
  }
  const suspend = () => { if (document.visibilityState !== "visible") stop(); };
  document.addEventListener("visibilitychange", suspend);
  document.defaultView?.addEventListener("pagehide", stop);
  return {
    prepare: () => request("prepare"),
    async recognize(job: AsrJob): Promise<{ revision: TranscriptRevision; inferenceMs: number }> {
      // Snapshot host-owned metadata before transferring the PCM buffer.
      const identity = { ...job.identity }; const audioRange = { ...job.audioRange };
      const utteranceId = job.utteranceId; const language = job.language;
      const output = await request("recognize", job);
      if (!output) throw new Error("Missing ASR output");
      return { revision: { identity, audioRange, utteranceId, language, sourceRevision: 1, final: true, text: output.text }, inferenceMs: output.inferenceMs };
    },
    stop,
    dispose() {
      if (disposed) return;
      disposed = true; stop();
      document.removeEventListener("visibilitychange", suspend);
      document.defaultView?.removeEventListener("pagehide", stop);
    },
  };
}
