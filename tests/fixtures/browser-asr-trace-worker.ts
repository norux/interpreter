import { WhisperTokenizer } from "@huggingface/transformers";
import "../../packages/engines-browser/asr-worker";

// Replay-only observation of the production worker's unchanged decoder input
// and output. No prompts, logits, PCM, generation options or text are modified.
let trace: object | undefined;
const decode = WhisperTokenizer.prototype._decode_asr;
WhisperTokenizer.prototype._decode_asr = function(sequences, options) {
  const inputs = sequences.map(sequence => ({
    tokens: sequence.tokens.map(Number), stride: [...sequence.stride],
    rawText: this.decode(sequence.tokens.filter(token => Number(token) < this.timestamp_begin), { skip_special_tokens: true }),
  }));
  const output = decode.call(this, sequences, options);
  trace = { timestampBegin: this.timestamp_begin, timePrecision: options?.time_precision,
    inputs, decodedText: output[0], decoded: output[1] };
  return output;
};

const send = globalThis.postMessage.bind(globalThis);
globalThis.postMessage = ((message: { type?: string }) => {
  if (message.type === "result") {
    const decodeTrace = trace; trace = undefined;
    send({ ...message, decodeTrace });
  } else {
    if (message.type === "error") trace = undefined;
    send(message);
  }
}) as typeof globalThis.postMessage;
