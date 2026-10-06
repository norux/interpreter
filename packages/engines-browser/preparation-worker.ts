import { env, pipeline } from "@huggingface/transformers";
import wasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url";
import wasmModuleUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url";
import { modelFiles, modelUrl, preparationModel } from "./model";
import { createModelRepository } from "./model-repository";

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
const repository = createModelRepository(async (cache) => {
  // Large WASM files are not reliably retained by HTTP cache. Store the bundled
  // runtime alongside this candidate so a new worker can load it offline.
  const runtimeUrl = new URL(wasmUrl, globalThis.location.href).href;
  let runtime = await cache.match(runtimeUrl);
  if (!runtime) {
    runtime = await fetch(runtimeUrl);
    if (!runtime.ok) throw new Error("Packaged WASM runtime unavailable");
    await cache.put(runtimeUrl, runtime.clone());
  }
  if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmBinary = await runtime.arrayBuffer();
  env.customCache = {
    async match(request: string) {
      // v4 pipeline's inventory reads config at main before applying revision.
      // Resolve that lookup only to this registered, immutable candidate cache.
      const pinned = request.replace(
        `https://huggingface.co/${preparationModel.id}/resolve/main/`,
        `https://huggingface.co/${preparationModel.id}/resolve/${preparationModel.version}/`,
      );
      return modelFiles.some(file => modelUrl(file.path) === pinned) ? cache.match(pinned) : undefined;
    },
    put: () => { throw new Error("Runtime must load prepared cache only"); },
  };
  return pipeline<"automatic-speech-recognition">("automatic-speech-recognition", preparationModel.id, {
    revision: preparationModel.version, device: "wasm", dtype: "q8", local_files_only: true,
  });
});
let busy = false;
globalThis.onmessage = async (event: MessageEvent<unknown>) => {
  const command = event.data;
  if (!command || typeof command !== "object" || !("version" in command) || command.version !== 1
    || !("requestId" in command) || !Number.isSafeInteger(command.requestId)
    || !("type" in command) || typeof command.type !== "string" || !["status", "prepare", "evict"].includes(command.type)) return;
  const send = (status: Awaited<ReturnType<typeof repository.status>>, done: boolean) => {
    globalThis.postMessage({ version: 1, requestId: command.requestId, status, done });
  };
  if (busy) return;
  busy = true;
  try {
    if (command.type === "prepare") {
      let last = await repository.status(preparationModel);
      for await (const status of repository.prepare(preparationModel)) { last = status; send(status, false); }
      send(last, true);
    } else {
      if (command.type === "evict") await repository.evict(preparationModel);
      send(await repository.status(preparationModel), true);
    }
  } catch {
    globalThis.postMessage({ version: 1, requestId: command.requestId, error: "Model operation failed", done: true });
  } finally { busy = false; }
};
