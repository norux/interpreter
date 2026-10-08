import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";
import wasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import wasmModuleUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";
import { registeredCandidate, vadCandidate } from "./model";
import { createModelRepository } from "./model-repository";

const selected = registeredCandidate(vadCandidate.model, "fp32");
let session: InferenceSession | undefined;
let state: Tensor = new Tensor("float32", new Float32Array(256), [2, 1, 128]);
const context = new Float32Array(64);
let busy = false;
let ended = false;
env.wasm.numThreads = 1;
env.wasm.proxy = false;
env.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl };

globalThis.onmessage = async (event: MessageEvent<unknown>) => {
  const value = event.data;
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1
    || !("requestId" in value) || !Number.isSafeInteger(value.requestId) || !("type" in value)) return;
  const send = (message: object) => globalThis.postMessage({ version: 1, requestId: value.requestId, ...message });
  if (busy) { send({ type: "error", reason: "overloaded" }); return; }
  busy = true;
  try {
    if (value.type === "prepare" && !session) {
      const repository = createModelRepository(async cache => {
        const response = await cache.match(selected.url(selected.files[0].path));
        const bytes = await response?.arrayBuffer();
        if (!bytes || bytes.byteLength !== selected.requiredBytes) throw new Error("VAD cached size mismatch");
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
          .map(byte => byte.toString(16).padStart(2, "0")).join("");
        if (hash !== vadCandidate.files[0].sha256) throw new Error("VAD cached checksum mismatch");
        const runtimeUrl = new URL(wasmUrl, globalThis.location.href).href;
        // Packaged extension resources are local but cannot be Cache.put keys.
        const cacheable = ["http:", "https:"].includes(new URL(runtimeUrl).protocol);
        let runtime = cacheable ? await cache.match(runtimeUrl) : undefined;
        if (!runtime) {
          runtime = await fetch(runtimeUrl);
          if (!runtime.ok) throw new Error("Packaged VAD runtime unavailable");
          if (cacheable) await cache.put(runtimeUrl, runtime.clone());
        }
        env.wasm.wasmBinary = await runtime.arrayBuffer();
        const loaded = await InferenceSession.create(bytes, { executionProviders: ["wasm"] });
        if (loaded.inputNames.join() !== "input,state,sr" || loaded.outputNames.join() !== "output,stateN") {
          await loaded.release(); throw new Error("Unexpected VAD graph");
        }
        session = loaded;
        return { dispose: () => loaded.release() };
      }, vadCandidate.model, "fp32");
      for await (const status of repository.prepare(vadCandidate.model)) {
        send({ type: "status", status });
        if (status.state === "failed") { send({ type: "error", reason: status.reason }); return; }
      }
      send({ type: "ready" });
    } else if (value.type === "detect" && session && !ended && "pcm" in value && value.pcm instanceof Float32Array
      && value.pcm.buffer instanceof ArrayBuffer && value.pcm.byteOffset === 0 && value.pcm.byteLength === value.pcm.buffer.byteLength
      && value.pcm.length > 0 && value.pcm.length <= 512
      && value.pcm.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1)) {
      const input = new Float32Array(576);
      input.set(context); input.set(value.pcm, 64);
      // A short frame is EOF. Padding belongs only to VAD, never ASR audio.
      ended = value.pcm.length < 512;
      const started = performance.now();
      const output = await session.run({ input: new Tensor("float32", input, [1, 576]), state,
        sr: new Tensor("int64", new BigInt64Array([16000n]), []) });
      const inferenceMs = performance.now() - started;
      const probability = Number(output.output.data[0]);
      if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error("Invalid VAD probability");
      state = output.stateN; context.set(input.subarray(512));
      send({ type: "result", probability, inferenceMs, samples: value.pcm.length, paddingSamples: 512 - value.pcm.length });
    } else send({ type: "error", reason: "engine-failed" });
  } catch (error) {
    console.error("Browser VAD failed", error);
    send({ type: "error", reason: "engine-failed" });
  } finally { busy = false; }
};
