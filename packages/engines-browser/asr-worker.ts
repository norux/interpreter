import { env, LogitsProcessor, LogitsProcessorList, type Tensor } from "@huggingface/transformers";
import { loadAsrPipeline } from "./asr-loader";
import { validAsrJob } from "./asr-protocol";
import { asrCandidates } from "./model";
import { createModelRepository } from "./model-repository";

let resident: Awaited<ReturnType<typeof loadAsrPipeline>> | undefined;
let timestamped = false;
let busy = false;
let lost = false;

// Transformers.js 4.3.0 omits Whisper's monotonic timestamp constraint. Apply
// it before the SDK's timestamp probability/pairing rules, without banning text
// repetitions that may really occur in the audio.
class MonotonicTimestamps extends LogitsProcessor {
  constructor(private readonly timestampBegin: number, private readonly lastTimestamp: number) { super(); }
  _call(inputIds: bigint[][], logits: Tensor) {
    for (const [row, ids] of inputIds.entries()) {
      const offset = row * logits.dims[1];
      // Whisper pads short input to 30 seconds. Only the final 20ms tick
      // covering actual PCM is available; padding cannot supply later speech.
      (logits.data as Float32Array).fill(-Infinity, offset + this.lastTimestamp + 1, offset + logits.dims[1]);
      const timestamps = ids.filter(id => Number(id) >= this.timestampBegin);
      const last = timestamps.at(-1);
      if (last === undefined) continue;
      const followsEnd = Number(ids.at(-1)) >= this.timestampBegin && Number(ids.at(-2)) < this.timestampBegin;
      const firstAllowed = Number(last) + (followsEnd ? 0 : 1);
      (logits.data as Float32Array).fill(-Infinity, offset + this.timestampBegin, offset + firstAllowed);
    }
    return logits;
  }
}

globalThis.onmessage = async (event: MessageEvent<unknown>) => {
  const value = event.data;
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1
    || !("requestId" in value) || !Number.isSafeInteger(value.requestId)
    || !("type" in value)) return;
  const send = (message: object) => globalThis.postMessage({ version: 1, requestId: value.requestId, ...message });
  if (busy) { send({ type: "error", reason: "overloaded" }); return; }
  if (lost) { send({ type: "error", reason: "gpu-lost" }); return; }
  busy = true;
  try {
    if (value.type === "prepare" && "candidate" in value && (value.candidate === "tiny" || value.candidate === "base" || value.candidate === "small" || value.candidate === "smallFp16" || value.candidate === "turboFp16")
      && "device" in value && (value.device === "wasm" || value.device === "webgpu") && !resident) {
      const { model, dtype } = asrCandidates[value.candidate];
      timestamped = dtype === "fp16";
      const device = value.device;
      if (dtype === "fp16" && device !== "webgpu") { send({ type: "error", reason: "engine-failed" }); return; }
      const repository = createModelRepository(async (cache) => {
        resident = await loadAsrPipeline(cache, model, device, dtype);
        return resident;
      }, model, dtype);
      for await (const status of repository.prepare(model)) {
        send({ type: "status", status });
        if (status.state === "failed") { send({ type: "error", reason: status.reason }); return; }
      }
      if (device === "webgpu" && env.backends.onnx.webgpu) {
        const gpu = await env.backends.onnx.webgpu.device as unknown as { lost: Promise<unknown> };
        void gpu.lost.then(() => {
          lost = true;
          globalThis.postMessage({ version: 1, type: "gpu-lost" });
        });
      }
      send({ type: "ready" });
    } else if (value.type === "recognize" && "job" in value && validAsrJob(value.job) && resident) {
      const started = performance.now();
      let processors: LogitsProcessorList | undefined;
      if (timestamped) {
        const config = resident.model.generation_config as { no_timestamps_token_id?: number } | null;
        if (!Number.isSafeInteger(config?.no_timestamps_token_id)) throw new Error("Missing Whisper timestamp token");
        processors = new LogitsProcessorList();
        const timestampBegin = Number(config?.no_timestamps_token_id) + 1;
        processors.push(new MonotonicTimestamps(timestampBegin, timestampBegin + Math.ceil(value.job.pcm.length / 320)));
      }
      const output = await resident(value.job.pcm, {
        language: value.job.language === "ja" ? "japanese" : "english",
        // Timestamp-guided decoding preserves repeated speech in the evaluated
        // FP16 profile. Keep the q8 comparison baselines and token bound intact.
        task: "transcribe", max_new_tokens: 256, return_timestamps: timestamped,
        logits_processor: processors,
      });
      if (Array.isArray(output)) throw new Error("Unexpected batched ASR result");
      if (!lost) send({ type: "result", text: output.text, inferenceMs: performance.now() - started });
    } else send({ type: "error", reason: "engine-failed" });
  } catch (error) {
    console.error("Browser ASR failed", error);
    send({ type: "error", reason: lost ? "gpu-lost" : "engine-failed" });
  } finally { busy = false; }
};
