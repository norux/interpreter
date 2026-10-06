from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

LANGUAGES = {
    "en": "English",
    "ko": "Korean",
    "ja": "Japanese",
    "zh": "Chinese",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
}


class SessionSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    provider: Literal["local", "openai-direct", "luna", "anthropic"]
    asr: Literal["local", "openai"]
    sourceLanguage: Literal["en", "ko", "ja", "zh", "es", "fr", "de"]
    targetLanguage: Literal["en", "ko", "ja", "zh", "es", "fr", "de"]
    asrModel: str = Field(min_length=1, max_length=160, pattern=r"^[\w./:-]+$")
    textModel: str = Field(max_length=160, pattern=r"^[\w./:-]*$")

    @model_validator(mode="after")
    def compatible(self):
        if self.provider == "openai-direct":
            if self.textModel != "gpt-realtime-translate":
                raise ValueError("Direct translation requires gpt-realtime-translate.")
        else:
            if not self.textModel:
                raise ValueError("Select a text model available to your provider.")
            if self.asr == "openai" and self.asrModel != "gpt-live-transcribe":
                raise ValueError("OpenAI ASR requires gpt-live-transcribe.")
        return self
