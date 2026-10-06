import type { ModelStatus } from "../contracts";
import { isPreparationModel, requiredBytes } from "./model";

// The foreground document owns this worker; a popup/service worker cannot own inference.
export function createExecutionHost(document: Document, receive: (status: ModelStatus) => void) {
  let worker: Worker | undefined;
  let requestId = 0;
  let pending: { resolve(status: ModelStatus): void; reject(error: Error): void } | undefined;
  let disposed = false;
  function stop() {
    requestId++;
    worker?.terminate(); worker = undefined;
    const operation = pending; pending = undefined;
    operation?.reject(new DOMException("Preparation stopped", "AbortError"));
  }
  function fail(message: string) {
    const operation = pending;
    pending = undefined;
    stop();
    operation?.reject(new Error(message));
  }
  function request(type: "prepare" | "status" | "evict") {
    if (disposed || !document.defaultView || !document.defaultView.isSecureContext || document.visibilityState !== "visible") {
      return Promise.reject(new Error("A visible secure document is required"));
    }
    if (type === "prepare" && !document.defaultView.navigator.userActivation.isActive) {
      return Promise.reject(new Error("Press Prepare in this document to start"));
    }
    if (pending) return Promise.reject(new Error("Stop the active model operation first"));
    if (!worker) {
      worker = new Worker(new URL("./preparation-worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data;
        if (!data || typeof data !== "object" || !("version" in data) || data.version !== 1
          || !("requestId" in data) || data.requestId !== requestId || !pending) return;
        if ("error" in data) { fail("Model worker operation failed"); return; }
        if (!("status" in data) || !validStatus(data.status) || !("done" in data) || typeof data.done !== "boolean") {
          fail("Invalid model worker response"); return;
        }
        receive(data.status);
        if (data.done) {
          const operation = pending; pending = undefined;
          if (data.status.state === "failed") operation.reject(new Error(data.status.reason));
          else operation.resolve(data.status);
        }
      };
      worker.onerror = () => fail("Model worker execution failed");
      worker.onmessageerror = () => fail("Model worker transport failed");
    }
    requestId++;
    const result = new Promise<ModelStatus>((resolve, reject) => { pending = { resolve, reject }; });
    worker.postMessage({ version: 1, requestId, type });
    return result;
  }
  const suspend = () => { if (document.visibilityState !== "visible") stop(); };
  document.addEventListener("visibilitychange", suspend);
  document.defaultView?.addEventListener("pagehide", stop);
  return {
    prepare: () => request("prepare"),
    status: () => request("status"),
    evict: () => request("evict"),
    stop,
    dispose() {
      if (disposed) return;
      disposed = true; stop();
      document.removeEventListener("visibilitychange", suspend);
      document.defaultView?.removeEventListener("pagehide", stop);
    },
  };
}

function validStatus(value: unknown): value is ModelStatus {
  if (!value || typeof value !== "object" || !("model" in value) || !value.model || typeof value.model !== "object"
    || !("id" in value.model) || typeof value.model.id !== "string"
    || !("version" in value.model) || typeof value.model.version !== "string"
    || !isPreparationModel({ id: value.model.id, version: value.model.version })
    || !("requiredBytes" in value) || value.requiredBytes !== requiredBytes
    || !("state" in value) || typeof value.state !== "string"
    || !["absent", "cached", "evicted", "downloading", "loading", "ready", "failed"].includes(value.state)) return false;
  if ("downloadedBytes" in value && value.downloadedBytes !== undefined
    && (typeof value.downloadedBytes !== "number" || !Number.isSafeInteger(value.downloadedBytes)
      || value.downloadedBytes < 0 || value.downloadedBytes > requiredBytes)) return false;
  return !("reason" in value) || value.reason === undefined
    || (typeof value.reason === "string"
      && ["cancelled", "storage-insufficient", "offline-model-unavailable", "model-load-failed", "download-required"].includes(value.reason));
}
