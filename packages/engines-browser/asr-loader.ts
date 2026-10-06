import { env, pipeline } from "@huggingface/transformers";
import wasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url";
import wasmModuleUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url";
import gpuWasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url";
import gpuModuleUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url";
import type { ModelIdentity } from "../contracts";
import { preparationModel, registeredCandidate } from "./model";
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = false;
env.useFSCache = false;
env.useCustomCache = true;
env.useWasmCache = false;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl };
}
export async function loadAsrPipeline(cache: Cache, model: ModelIdentity = preparationModel, device: "wasm" | "webgpu" = "wasm", dtype: "q8" | "fp16" = "q8") {
  const { files: modelFiles, url: modelUrl } = registeredCandidate(model, dtype);
  if (dtype === "fp16" && device !== "webgpu") throw new Error("FP16 candidate requires WebGPU");
  // Large WASM files are not reliably retained by HTTP cache. Store the bundled
  // runtime alongside this candidate so a new worker can load it offline.
  // The locked ORT WebGPU backend calls webgpuInit from asyncify. The jsep
  // factory used by the WASM candidate exposes a different initialization API.
  const runtimeUrl = new URL(device === "webgpu" ? gpuWasmUrl : wasmUrl, globalThis.location.href).href;
  let runtime = await cache.match(runtimeUrl);
  if (!runtime) {
    runtime = await fetch(runtimeUrl);
    if (!runtime.ok) throw new Error("Packaged WASM runtime unavailable");
    await cache.put(runtimeUrl, runtime.clone());
  }
  if (env.backends.onnx.wasm) {
    env.backends.onnx.wasm.wasmPaths = {
      wasm: device === "webgpu" ? gpuWasmUrl : wasmUrl,
      mjs: device === "webgpu" ? gpuModuleUrl : wasmModuleUrl,
    };
    env.backends.onnx.wasm.wasmBinary = await runtime.arrayBuffer();
  }
  env.customCache = {
    async match(request: string) {
      // v4 pipeline's inventory reads config at main before applying revision.
      // Resolve that lookup only to this registered, immutable candidate cache.
      const pinned = request.replace(
        `https://huggingface.co/${model.id}/resolve/main/`,
        `https://huggingface.co/${model.id}/resolve/${model.version}/`,
      );
      return modelFiles.some(file => modelUrl(file.path) === pinned) ? cache.match(pinned) : undefined;
    },
    put: () => { throw new Error("Runtime must load prepared cache only"); },
  };
  return pipeline<"automatic-speech-recognition">("automatic-speech-recognition", model.id, {
    revision: model.version, device, dtype, local_files_only: true,
  });
}
