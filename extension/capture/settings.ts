export interface SessionSettings {
  provider: "local" | "openai-direct" | "luna" | "anthropic";
  asr: "local" | "openai";
  sourceLanguage: string;
  targetLanguage: string;
  asrModel: string;
  textModel: string;
}

export const defaultSettings: SessionSettings = {
  provider: "local", asr: "local", sourceLanguage: "en", targetLanguage: "ko",
  asrModel: "mlx-community/Qwen3-ASR-1.7B-8bit", textModel: "qwen3.5:9b",
};
