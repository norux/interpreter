import type { ModelStatus } from "../contracts";
import { vadCandidate } from "./model";

// One detector per speech session: state cannot cross an epoch or be shared by
// two recognizers. Stop terminates inference/preparation, retaining only cache.
export function createVadHost(document: Document, receive: (status: ModelStatus) => void) {
  let worker: Worker | undefined;
  let pending: { type: "prepare" | "detect"; samples?: number; resolve(value?: { probability: number; inferenceMs: number; samples: number; paddingSamples: number }): void; reject(error: Error): void } | undefined;
  let requestId = 0;
  let ready = false;
  let disposed = false;
  let ended = false;
  function stop() {
    requestId++; ready = false; ended = false;
    worker?.terminate(); worker = undefined;
    const operation = pending; pending = undefined;
    operation?.reject(new DOMException("VAD stopped", "AbortError"));
  }
  function fail(reason: string) {
    const operation = pending; pending = undefined; stop();
    operation?.reject(new Error(reason));
  }
  function request(type: "prepare" | "detect", pcm?: Float32Array) {
    if (disposed || !document.defaultView?.isSecureContext || document.visibilityState !== "visible") return Promise.reject(new Error("A visible secure document is required"));
    if (pending) return Promise.reject(new Error("overloaded"));
    if (type === "prepare" && (!document.defaultView.navigator.userActivation.isActive || ready)) return Promise.reject(new Error("Press Prepare after Stop in this document"));
    if (type === "detect" && (!ready || ended || !pcm || !(pcm.buffer instanceof ArrayBuffer)
      || pcm.length < 1 || pcm.length > 512 || !pcm.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1))) return Promise.reject(new Error("Invalid VAD frame or detector not ready"));
    if (!worker) {
      worker = new Worker(new URL("./vad-worker.ts", import.meta.url), { type: "module" });
      const current = worker;
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (worker !== current) return;
        const data = event.data;
        if (!data || typeof data !== "object" || !("version" in data) || data.version !== 1 || !("type" in data)) { fail("Invalid VAD worker response"); return; }
        if (!("requestId" in data) || data.requestId !== requestId || !pending) return;
        if (data.type === "status" && "status" in data) {
          const status = data.status as Partial<ModelStatus> | null;
          if (!status || status.model?.id !== vadCandidate.model.id || status.model.version !== vadCandidate.model.version
            || status.requiredBytes !== vadCandidate.files[0].bytes || !["absent", "evicted", "cached", "downloading", "loading", "ready", "failed"].includes(status.state ?? "")
            || (status.downloadedBytes !== undefined && (!Number.isSafeInteger(status.downloadedBytes) || status.downloadedBytes < 0 || status.downloadedBytes > status.requiredBytes))
            || (status.reason !== undefined && !["cancelled", "storage-insufficient", "offline-model-unavailable", "model-load-failed", "download-required"].includes(status.reason))) { fail("Invalid VAD status"); return; }
          receive(status as ModelStatus); return;
        }
        if (data.type === "error" && "reason" in data && typeof data.reason === "string") { fail(data.reason); return; }
        const operation = pending;
        if (data.type === "ready" && operation.type === "prepare") { ready = true; pending = undefined; operation.resolve(); return; }
        if (data.type === "result" && operation.type === "detect" && "probability" in data && typeof data.probability === "number"
          && Number.isFinite(data.probability) && data.probability >= 0 && data.probability <= 1
          && "inferenceMs" in data && typeof data.inferenceMs === "number" && Number.isFinite(data.inferenceMs) && data.inferenceMs >= 0
          && "samples" in data && typeof data.samples === "number" && data.samples === operation.samples && "paddingSamples" in data && data.paddingSamples === 512 - data.samples) {
          pending = undefined;
          operation.resolve({ probability: data.probability, inferenceMs: data.inferenceMs, samples: data.samples, paddingSamples: data.paddingSamples }); return;
        }
        fail("Invalid VAD worker response");
      };
      worker.onerror = () => fail("VAD worker execution failed");
      worker.onmessageerror = () => fail("VAD worker transport failed");
    }
    requestId++;
    const result = new Promise<{ probability: number; inferenceMs: number; samples: number; paddingSamples: number } | undefined>((resolve, reject) => { pending = { type, samples: pcm?.length, resolve, reject }; });
    // The recognizer still owns its original PCM for unfiltered ASR submission.
    const transferred = pcm?.slice();
    ended = type === "detect" && (pcm?.length ?? 512) < 512;
    worker.postMessage({ version: 1, requestId, type, pcm: transferred }, transferred ? [transferred.buffer] : []);
    return result;
  }
  const suspend = () => { if (document.visibilityState !== "visible") stop(); };
  document.addEventListener("visibilitychange", suspend);
  document.defaultView?.addEventListener("pagehide", stop);
  return {
    prepare: () => request("prepare"),
    async detect(pcm: Float32Array) {
      const result = await request("detect", pcm);
      if (!result) throw new Error("Missing VAD result");
      return { ...result, speech: result.probability >= 0.5 };
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
