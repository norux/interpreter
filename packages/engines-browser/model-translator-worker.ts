import { env, pipeline } from "@huggingface/transformers";
import wasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url";
import wasmModuleUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url";
import { registeredCandidate } from "./model";
import { createModelRepository } from "./model-repository";
import { translationCandidates } from "./translation-model";

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
let resident: Awaited<ReturnType<typeof pipeline<"translation">>> | undefined;
let candidate: keyof typeof translationCandidates | undefined;
let busy = false;
globalThis.onmessage = async (event: MessageEvent<{ requestId: number; type: string; candidate?: keyof typeof translationCandidates; text?: string; language?: "en" | "ja" }>) => {
  const value = event.data;
  if (!value || !Number.isSafeInteger(value.requestId)) return;
  const send = (message: object) => globalThis.postMessage({ requestId: value.requestId, ...message });
  if (busy) { send({ type: "error", reason: "overloaded" }); return; }
  busy = true;
  try {
    if (value.type === "prepare" && (value.candidate === "nllb" || value.candidate === "m2m100") && !resident) {
      candidate = value.candidate;
      const selected = registeredCandidate(translationCandidates[candidate].model, "q8");
      const repository = createModelRepository(async cache => {
        env.customCache = {
          match(request: string) {
            const pinned = request.replace(`https://huggingface.co/${selected.model.id}/resolve/main/`, `https://huggingface.co/${selected.model.id}/resolve/${selected.model.version}/`);
            return selected.files.some(file => selected.url(file.path) === pinned) ? cache.match(pinned) : Promise.resolve(undefined);
          },
          put: () => { throw new Error("Runtime must load prepared cache only"); },
        };
        resident = await pipeline("translation", selected.model.id, { revision: selected.model.version, dtype: "q8", device: "wasm", local_files_only: true });
        return resident;
      }, selected.model, "q8");
      for await (const status of repository.prepare(selected.model)) {
        send({ type: "status", status });
        if (status.state === "failed") throw new Error(status.reason);
      }
      send({ type: "ready" });
    } else if (value.type === "translate" && resident && candidate && typeof value.text === "string" && value.text.length > 0 && value.text.length <= 16384 && (value.language === "ja" || value.language === "en")) {
      const codes = candidate === "nllb" ? { en: "eng_Latn", ja: "jpn_Jpan", ko: "kor_Hang" } : { en: "en", ja: "ja", ko: "ko" };
      const output = await resident(value.text, { src_lang: codes[value.language], tgt_lang: codes.ko, max_new_tokens: 256 });
      const text = output[0]?.translation_text;
      if (typeof text !== "string" || !text.trim() || text.length > 16384) throw new Error("Invalid translation result");
      send({ type: "result", text });
    } else throw new Error("model-load-failed");
  } catch (error) { console.error("Local translation failed", error); send({ type: "error", reason: (error as Error).message }); }
  finally { busy = false; }
};
