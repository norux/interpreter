import type { ModelStatus } from "../contracts";
import { registeredCandidate, speakerCandidate } from "./model";

export function createSpeakerHost(document: Document, receive: (status: ModelStatus) => void) {
  let worker: Worker | undefined;
  let pending: { resolve(value?: Float32Array): void; reject(error: Error): void } | undefined;
  let requestId = 0;
  let ready = false;
  function stop() {
    requestId++; ready = false;
    worker?.terminate(); worker = undefined;
    const operation = pending; pending = undefined;
    operation?.reject(new DOMException("Speaker detection stopped", "AbortError"));
  }
  function fail(reason: string) {
    const operation = pending; pending = undefined; stop(); operation?.reject(new Error(reason));
  }
  function request(type: "prepare" | "embed", pcm?: Float32Array) {
    if (pending || type === "embed" && !ready) return Promise.reject(new Error("Speaker detector not ready or busy"));
    if (!worker) {
      worker = new Worker(new URL("./speaker-worker.ts", import.meta.url), { type: "module" });
      const current = worker;
      worker.onmessage = ({ data }) => {
        if (worker !== current || data?.version !== 1 || data.requestId !== requestId || !pending) return;
        if (data.type === "status") {
          if (data.status?.model?.id !== speakerCandidate.model.id || data.status.model.version !== speakerCandidate.model.version
            || data.status.requiredBytes !== registeredCandidate(speakerCandidate.model).requiredBytes) { fail("Invalid speaker model status"); return; }
          receive(data.status); return;
        }
        if (data.type === "error") { fail(String(data.reason)); return; }
        if (data.type === "ready" && type === "prepare") { ready = true; const operation = pending; pending = undefined; operation.resolve(); return; }
        if (data.type === "result" && data.embedding instanceof Float32Array && data.embedding.length === 256 && data.embedding.every(Number.isFinite)) {
          const operation = pending; pending = undefined; operation.resolve(data.embedding); return;
        }
        fail("Invalid speaker model response");
      };
      worker.onerror = () => fail("Speaker worker failed");
      worker.onmessageerror = () => fail("Speaker worker transport failed");
    }
    requestId++;
    const result = new Promise<Float32Array | undefined>((resolve, reject) => { pending = { resolve, reject }; });
    const copy = pcm?.slice();
    worker.postMessage({ version: 1, requestId, type, pcm: copy }, copy ? [copy.buffer] : []);
    return result;
  }
  document.defaultView?.addEventListener("pagehide", stop);
  return {
    prepare: () => request("prepare"),
    async embed(pcm: Float32Array) {
      const embedding = await request("embed", pcm);
      if (!embedding) throw new Error("Missing speaker embedding");
      return embedding;
    },
    stop,
    dispose() { stop(); document.defaultView?.removeEventListener("pagehide", stop); },
  };
}
