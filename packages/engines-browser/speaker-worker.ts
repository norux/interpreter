import { env as transformersEnv, WeSpeakerFeatureExtractor } from "@huggingface/transformers";
import { env, InferenceSession, Tensor } from "onnxruntime-web/webgpu";
import wasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url";
import wasmModuleUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url";
import { registeredCandidate, speakerCandidate } from "./model";
import { createModelRepository } from "./model-repository";

const selected = registeredCandidate(speakerCandidate.model);
let session: InferenceSession | undefined;
let extractor: WeSpeakerFeatureExtractor | undefined;
let busy = false;
// Feature extraction uses Transformers tensor ops; both use this packaged runtime.
transformersEnv.useWasmCache = false;
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
        const bytes = await (await cache.match(selected.url("onnx/model_quantized.onnx")))?.arrayBuffer();
        if (!bytes || bytes.byteLength !== speakerCandidate.files[1].bytes) throw new Error("Speaker model size mismatch");
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
        if (hash !== speakerCandidate.files[1].sha256) throw new Error("Speaker model checksum mismatch");
        const config = await (await cache.match(selected.url("preprocessor_config.json")))?.json();
        if (config?.sampling_rate !== 16000 || config.num_mel_bins !== 80) throw new Error("Unexpected speaker features");
        extractor = new WeSpeakerFeatureExtractor(config);
        const runtime = await fetch(wasmUrl);
        if (!runtime.ok) throw new Error("Packaged speaker runtime unavailable");
        env.wasm.wasmBinary = await runtime.arrayBuffer();
        session = await InferenceSession.create(bytes, { executionProviders: ["wasm"] });
        return { dispose: async () => { await session?.release(); session = undefined; } };
      }, speakerCandidate.model);
      for await (const status of repository.prepare(speakerCandidate.model)) {
        send({ type: "status", status });
        if (status.state === "failed") { send({ type: "error", reason: status.reason }); return; }
      }
      send({ type: "ready" });
    } else if (value.type === "embed" && session && extractor && "pcm" in value && value.pcm instanceof Float32Array
      && value.pcm.length >= 8000 && value.pcm.length <= 48000
      && value.pcm.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1)) {
      const start = performance.now();
      const features = await extractor(value.pcm);
      const output = await session.run({ [session.inputNames[0]]: new Tensor("float32", features.input_features.data as Float32Array, features.input_features.dims) });
      const embedding = Float32Array.from(output[session.outputNames[0]].data as Float32Array);
      if (embedding.length !== 256 || !embedding.every(Number.isFinite)) throw new Error("Invalid speaker embedding");
      send({ type: "result", embedding, inferenceMs: performance.now() - start });
    } else send({ type: "error", reason: "engine-failed" });
  } catch (error) {
    console.error("Speaker inference failed", error);
    send({ type: "error", reason: error instanceof Error ? error.message : String(error) });
  } finally { busy = false; }
};
