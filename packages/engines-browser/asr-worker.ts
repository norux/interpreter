import { env, LogitsProcessor, LogitsProcessorList, type Tensor, type WhisperTokenizer } from "@huggingface/transformers";
import { loadAsrPipeline } from "./asr-loader";
import { validAsrJob } from "./asr-protocol";
import { asrCandidates } from "./model";
import { createModelRepository } from "./model-repository";

let resident: Awaited<ReturnType<typeof loadAsrPipeline>> | undefined;
let timestamped = false;
let busy = false;
let lost = false;
let recentLanguage: "en" | "ja" | "ko" | undefined;

class LanguageLogits extends LogitsProcessor {
  probabilities: Record<"en" | "ja" | "ko", number> | undefined;
  constructor(private readonly tokens: Record<string, number>) { super(); }
  _call(_inputIds: bigint[][], logits: Tensor) {
    const values = logits.data as Float32Array;
    const ids = Object.values(this.tokens);
    const maximum = Math.max(...ids.map(id => values[id]));
    const total = ids.reduce((sum, id) => sum + Math.exp(values[id] - maximum), 0);
    this.probabilities = { en: Math.exp(values[this.tokens["<|en|>"]] - maximum) / total,
      ja: Math.exp(values[this.tokens["<|ja|>"]] - maximum) / total,
      ko: Math.exp(values[this.tokens["<|ko|>"]] - maximum) / total };
    const retained = ids.map(id => values[id]);
    values.fill(-Infinity);
    ids.forEach((id, index) => { values[id] = retained[index]; });
    return logits;
  }
}

async function recognizeAutomatic(pcm: Float32Array, withTimestamps: boolean, processors?: LogitsProcessorList) {
  if (!resident) throw new Error("Missing ASR model");
  const started = performance.now();
  const model = resident.model;
  const config = model.generation_config as unknown as { decoder_start_token_id: number; lang_to_id: Record<string, number> };
  const features = (await resident.processor(pcm)).input_features as Tensor;
  // Pinned Transformers.js 4.3.0 has no Whisper language detection and omits
  // encoder_outputs from forward_params. Admit it so both decodes share one
  // acoustic encoder pass, rather than encoding the same PCM twice.
  if (!model.forward_params.includes("encoder_outputs")) model.forward_params.push("encoder_outputs");
  const encoded = await model._prepare_encoder_decoder_kwargs_for_generation({ inputs_tensor: features,
    model_inputs: { input_features: features }, model_input_name: "input_features", generation_config: {} });
  const encoder = encoded.encoder_outputs as Tensor;
  try {
    const languageLogits = new LanguageLogits(config.lang_to_id);
    const languageProcessors = new LogitsProcessorList(); languageProcessors.push(languageLogits);
    const token = await model.generate({ inputs: features, encoder_outputs: encoder,
      decoder_input_ids: [config.decoder_start_token_id], max_new_tokens: 1,
      return_timestamps: false, suppress_tokens: [], begin_suppress_tokens: [], logits_processor: languageProcessors }) as Tensor;
    token.dispose();
    if (!languageLogits.probabilities) throw new Error("Missing language probabilities");
    const probabilities = languageLogits.probabilities;
    let language: "en" | "ja" | "ko" = "en";
    for (const candidate of ["ja", "ko"] as const) if (probabilities[candidate] > probabilities[language]) language = candidate;
    // History only breaks close ties; clear acoustic evidence always wins.
    if (recentLanguage && probabilities[recentLanguage] >= 0.25 && probabilities[language] - probabilities[recentLanguage] < 0.05) language = recentLanguage;
    const confidence = probabilities[language];
    if (confidence >= 0.7) recentLanguage = language;
    const languageDetectionMs = performance.now() - started;
    const tokens = await model.generate({ inputs: features, encoder_outputs: encoder, language,
      task: "transcribe", max_new_tokens: 256, return_timestamps: withTimestamps, logits_processor: processors }) as Tensor;
    try {
      const [text, optional] = (resident.tokenizer as WhisperTokenizer)._decode_asr([
        { tokens: tokens.tolist()[0] as bigint[], stride: [pcm.length / 16000, 0, 0] },
      ], { return_timestamps: withTimestamps, time_precision: 0.02, force_full_sequences: false });
      if (typeof text !== "string" || typeof optional !== "object") throw new Error("Invalid automatic ASR result");
      return { text, chunks: optional.chunks, languageDetectionMs, language, confidence };
    } finally { tokens.dispose(); }
  } finally { encoder.dispose(); features.dispose(); }
}

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
    if (value.type === "prepare" && "candidate" in value && (value.candidate === "tiny" || value.candidate === "base" || value.candidate === "small" || value.candidate === "smallTimestamped" || value.candidate === "smallFp16" || value.candidate === "turboFp16")
      && "device" in value && (value.device === "wasm" || value.device === "webgpu") && !resident) {
      const { model, dtype } = asrCandidates[value.candidate];
      timestamped = value.candidate === "smallTimestamped";
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
      const withTimestamps = timestamped || value.job.timestamps === true;
      if (withTimestamps) {
        const config = resident.model.generation_config as { no_timestamps_token_id?: number } | null;
        if (!Number.isSafeInteger(config?.no_timestamps_token_id)) throw new Error("Missing Whisper timestamp token");
        processors = new LogitsProcessorList();
        const timestampBegin = Number(config?.no_timestamps_token_id) + 1;
        processors.push(new MonotonicTimestamps(timestampBegin, timestampBegin + Math.ceil(value.job.pcm.length / 320)));
      }
      const automatic = value.job.language === "auto";
      const output = automatic ? await recognizeAutomatic(value.job.pcm, withTimestamps, processors) : await resident(value.job.pcm, {
        language: value.job.language,
        // Incremental callers need segment times to retire confirmed audio;
        // utterance-only callers retain their original job-range timing.
        task: "transcribe", max_new_tokens: 256, return_timestamps: withTimestamps,
        logits_processor: processors,
      });
      if (Array.isArray(output)) throw new Error("Unexpected batched ASR result");
      const durationMs = value.job.pcm.length / 16;
      const segments = value.job.timestamps ? output.chunks?.map(chunk => ({ text: chunk.text,
        startMs: Math.min(durationMs, (chunk.timestamp[0] ?? 0) * 1000),
        endMs: Math.min(durationMs, chunk.timestamp[1] == null ? durationMs : chunk.timestamp[1] * 1000),
      })) : undefined;
      if (!lost) send({ type: "result", text: output.text, segments, inferenceMs: performance.now() - started,
        ...(automatic && "language" in output ? { language: output.language, languageConfidence: output.confidence, languageDetectionMs: output.languageDetectionMs } : {}) });
    } else send({ type: "error", reason: "engine-failed" });
  } catch (error) {
    console.error("Browser ASR failed", error);
    send({ type: "error", reason: lost ? "gpu-lost" : "engine-failed" });
  } finally { busy = false; }
};
