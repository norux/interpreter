import type { ModelIdentity } from "../contracts";

// Preparation candidate only. B2 must compare real Japanese/English recognition.
export const preparationModel: ModelIdentity = {
  id: "onnx-community/whisper-tiny",
  version: "ff4177021cc41f7db950912b73ea4fdf7d01d8e7",
};
export const modelFiles = [
  { path: "config.json", bytes: 2243 },
  { path: "generation_config.json", bytes: 3772 },
  { path: "tokenizer.json", bytes: 2480466 },
  { path: "tokenizer_config.json", bytes: 282683 },
  { path: "preprocessor_config.json", bytes: 339 },
  { path: "onnx/encoder_model_quantized.onnx", bytes: 10124990,
    sha256: "2af4a414ca47aa30f61246017e5fe82b0a8d229281d1255ba666a2a7f6b84d19" },
  { path: "onnx/decoder_model_merged_quantized.onnx", bytes: 30719241,
    sha256: "25e807a962b6349356d0ea5d0dfe530b7e5bf0e2a484aeca0359d03143faddd3" },
] as const;
export const requiredBytes = modelFiles.reduce((sum, file) => sum + file.bytes, 0);
export const modelCacheName = `interpreter-asr-${preparationModel.version}-q8`;
export function modelUrl(path: string) {
  return `https://huggingface.co/${preparationModel.id}/resolve/${preparationModel.version}/${path}`;
}
export function isPreparationModel(model: ModelIdentity) {
  return model.id === preparationModel.id && model.version === preparationModel.version;
}

export const asrCandidates = {
  tiny: { model: preparationModel, files: modelFiles },
  base: {
    model: { id: "onnx-community/whisper-base", version: "1846881b6b3a3024392c1eea3ad983695bc23925" },
    files: [
      { path: "config.json", bytes: 2243 },
      { path: "generation_config.json", bytes: 3832 },
      { path: "tokenizer.json", bytes: 2480466 },
      { path: "tokenizer_config.json", bytes: 282682 },
      { path: "preprocessor_config.json", bytes: 339 },
      { path: "onnx/encoder_model_quantized.onnx", bytes: 23201314,
        sha256: "5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46" },
      { path: "onnx/decoder_model_merged_quantized.onnx", bytes: 53693315,
        sha256: "fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b" },
    ],
  },
  small: {
    model: { id: "onnx-community/whisper-small", version: "36050c46d777d46dc4b5f43f6d90574fc38f8732" },
    files: [
      { path: "config.json", bytes: 2227 },
      { path: "generation_config.json", bytes: 3893 },
      { path: "tokenizer.json", bytes: 2480466 },
      { path: "tokenizer_config.json", bytes: 282683 },
      { path: "preprocessor_config.json", bytes: 339 },
      { path: "onnx/encoder_model_quantized.onnx", bytes: 92326160,
        sha256: "a43a83f3c5361cd591cfa7c36f14b43cf7cb22f47a415cc14a8d557be800fa92" },
      { path: "onnx/decoder_model_merged_quantized.onnx", bytes: 156750845,
        sha256: "ec07c3cbb64172c39791e26ee870a65ac22b458c36722bfe2776b3dbf741e0c9" },
    ],
  },
} as const;

export function registeredCandidate(model: ModelIdentity) {
  const candidate = Object.values(asrCandidates).find(value => value.model.id === model.id && value.model.version === model.version);
  if (!candidate) throw new Error("Unregistered model/version");
  return {
    ...candidate,
    requiredBytes: candidate.files.reduce((sum, file) => sum + file.bytes, 0),
    cacheName: `interpreter-asr-${candidate.model.version}-q8`,
    url: (path: string) => `https://huggingface.co/${candidate.model.id}/resolve/${candidate.model.version}/${path}`,
  };
}
