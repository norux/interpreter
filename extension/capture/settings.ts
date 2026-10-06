import type { CompanionSettings } from "../../packages/engines-companion/engine";

export type SessionSettings = CompanionSettings;

export const defaultSettings: SessionSettings = {
  provider: "local", asr: "local", sourceLanguage: "en", targetLanguage: "ko",
  asrModel: "mlx-community/Qwen3-ASR-1.7B-8bit", textModel: "qwen3.5:9b",
};
