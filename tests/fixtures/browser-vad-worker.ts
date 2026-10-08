import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";
import wasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import wasmModuleUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";

// Evaluation candidate only; not connected to production segmentation or ASR.
const model = {
  id: "onnx-community/silero-vad", version: "e71cae966052b992a7eca6b17738916ce0eca4ec",
  bytes: 2243022, sha256: "a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808",
};
const modelUrl = `https://huggingface.co/${model.id}/resolve/${model.version}/onnx/model.onnx`;
let session: InferenceSession | undefined;
let busy = false;
env.wasm.numThreads = 1;
env.wasm.proxy = false;
env.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl };

globalThis.onmessage = async (event: MessageEvent<unknown>) => {
  const value = event.data;
  if (!value || typeof value !== "object" || !("type" in value)) return;
  if (busy) { globalThis.postMessage({ type: "error", message: "overloaded" }); return; }
  busy = true;
  try {
    if (value.type === "prepare" && !session) {
      const started = performance.now();
      const cache = await caches.open(`interpreter-vad-evaluation-${model.version}`);
      const cached = await cache.match(modelUrl);
      const response = cached ?? await fetch(modelUrl, { credentials: "omit" });
      if (!response.ok) throw new Error(`VAD download HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== model.bytes) throw new Error("VAD model size mismatch");
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map(byte => byte.toString(16).padStart(2, "0")).join("");
      if (hash !== model.sha256) throw new Error("VAD model checksum mismatch");
      if (!cached) await cache.put(modelUrl, new Response(bytes));
      const runtimeUrl = new URL(wasmUrl, globalThis.location.href).href;
      let runtime = await cache.match(runtimeUrl);
      if (!runtime) {
        runtime = await fetch(runtimeUrl);
        if (!runtime.ok) throw new Error("Packaged VAD runtime unavailable");
        await cache.put(runtimeUrl, runtime.clone());
      }
      env.wasm.wasmBinary = await runtime.arrayBuffer();
      session = await InferenceSession.create(bytes, { executionProviders: ["wasm"] });
      globalThis.postMessage({ type: "ready", model, cached: Boolean(cached), preparationMs: performance.now() - started,
        inputNames: session.inputNames, outputNames: session.outputNames });
    } else if (value.type === "evaluate" && session && "pcm" in value && value.pcm instanceof Float32Array
      && value.pcm.length > 0 && value.pcm.length <= 16000 * 30
      && value.pcm.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1)) {
      const pcm = value.pcm;
      const inputSha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", pcm.buffer as ArrayBuffer))]
        .map(byte => byte.toString(16).padStart(2, "0")).join("");
      // Upstream 16 kHz wrapper: 512 new samples + 64 context, recurrent state
      // reset for each independent input. Only the last VAD frame is zero-padded.
      let state: Tensor = new Tensor("float32", new Float32Array(256), [2, 1, 128]);
      const context = new Float32Array(64);
      const frames = [];
      const started = performance.now();
      for (let offset = 0; offset < pcm.length; offset += 512) {
        const samples = Math.min(512, pcm.length - offset);
        await new Promise(done => setTimeout(done, Math.max(0, started + (offset + samples) / 16 - performance.now())));
        const input = new Float32Array(576);
        input.set(context); input.set(pcm.subarray(offset, offset + samples), 64);
        const atMs = performance.now() - started;
        const inferenceStart = performance.now();
        const output = await session.run({ input: new Tensor("float32", input, [1, 576]), state,
          sr: new Tensor("int64", new BigInt64Array([16000n]), []) });
        const inferenceMs = performance.now() - inferenceStart;
        const probability = Number(output.output.data[0]);
        if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error("Invalid VAD probability");
        state = output.stateN;
        context.set(input.subarray(512));
        frames.push({ startSample: offset, samples, probability, inferenceMs, atMs });
      }
      globalThis.postMessage({ type: "result", inputSamples: pcm.length, inputSha256, paddingSamples: (512 - pcm.length % 512) % 512,
        durationMs: performance.now() - started, frames });
    } else throw new Error("Invalid VAD evaluation request");
  } catch (error) {
    globalThis.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally { busy = false; }
};
