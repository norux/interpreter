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
