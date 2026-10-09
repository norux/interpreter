import type { Capability, LanguagePair, ReasonCode, SessionIdentity, TextTranslator } from "../contracts";
import { sameIdentity } from "../core/identity";

interface NativeTranslator {
  translate(text: string, options: { signal: AbortSignal }): Promise<string>;
  destroy(): void;
}

interface TranslatorApi {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<"available" | "downloadable" | "downloading" | "unavailable">;
  create(options: {
    sourceLanguage: string; targetLanguage: string; signal: AbortSignal;
    monitor(monitor: { addEventListener(type: "downloadprogress", receive: (event: { loaded: number }) => void): void }): void;
  }): Promise<NativeTranslator>;
}

export function createDocumentTranslator(document: Document, languages: LanguagePair,
  receive: (status: { state: "preparing" | "ready" | "stopped" | "failed"; progress?: number; reason?: ReasonCode }) => void, execution: "foreground" | "offscreen" = "foreground") {
  const pair = { ...languages };
  const translators = new Map<string, NativeTranslator>();
  const sources = pair.source === "auto" ? ["en", "ja"] : [pair.source];
  let preparing: AbortController | undefined;
  let active: { identity: SessionIdentity; controller: AbortController } | undefined;
  let disposed = false;
  let translationRevision = 0;

  function api(): TranslatorApi | undefined {
    return (document.defaultView as (Window & { Translator?: TranslatorApi }) | null)?.Translator;
  }
  function eligible(visible = true) {
    return !disposed && document.defaultView?.isSecureContext && (execution === "offscreen" || !visible || document.visibilityState === "visible");
  }
  function supported() { return (pair.source === "auto" || pair.source === "ja" || pair.source === "en") && pair.target === "ko"; }
  function stop() {
    preparing?.abort(); preparing = undefined;
    active?.controller.abort(); active = undefined;
    for (const translator of translators.values()) translator.destroy();
    translators.clear();
    receive({ state: "stopped", reason: "cancelled" });
  }
  const suspend = () => { if (execution === "foreground" && document.visibilityState !== "visible" && active) stop(); };
  document.addEventListener("visibilitychange", suspend);
  document.defaultView?.addEventListener("pagehide", stop);

  const port: TextTranslator = {
    async *translate(source, requested) {
      if (!eligible()) throw new Error("execution-context-unavailable");
      const translator = translators.get(source.language);
      if (!translator) throw new Error("model-load-failed");
      if (!supported() || !sources.includes(requested.source) || requested.target !== pair.target || source.language !== requested.source) throw new Error("language-pair-unsupported");
      if (!source.text || source.text.length > 16384 || !Number.isSafeInteger(source.sourceRevision) || source.sourceRevision <= 0) throw new Error("Invalid translation source");
      if (active) throw new Error("overloaded");
      const identity = { ...source.identity };
      const utteranceId = source.utteranceId; const sourceRevision = source.sourceRevision; const final = source.final;
      const operation = { identity, controller: new AbortController() };
      active = operation;
      try {
        // ASR can omit punctuation between Japanese polite sentence endings.
        // Keep spaces within time phrases; splitting every word loses context.
        const phrases = source.language === "ja" ? source.text.split(
          /(?<=[。！？])\s*|(?<=ませんでした|ません|ました|ます|でした|です|ましょう|ください)\s*(?=[\p{Script=Han}\p{Script=Katakana}])/u,
        ).map(phrase => phrase.trim()).filter(Boolean) : [source.text];
        const native = translator;
        let text = "";
        for (const phrase of phrases) {
          operation.controller.signal.throwIfAborted();
          const part = await native.translate(phrase, { signal: operation.controller.signal });
          operation.controller.signal.throwIfAborted();
          if (typeof part !== "string" || !part.trim() || part.length > 16384) throw new Error("Invalid translation result");
          text += `${text ? " " : ""}${part}`;
          if (text.length > 16384) throw new Error("Invalid translation result");
        }
        if (!eligible()) throw new Error("execution-context-unavailable");
        if (typeof text !== "string" || !text.trim() || text.length > 16384) throw new Error("Invalid translation result");
        yield { identity, utteranceId, sourceRevision, translationRevision: ++translationRevision,
          languages: { ...requested }, text, final };
      } finally { if (active === operation) active = undefined; }
    },
    async cancel(identity) {
      if (active && sameIdentity(active.identity, identity)) {
        active.controller.abort(); active = undefined;
      }
    },
    async close() {
      if (disposed) return;
      disposed = true; stop();
      document.removeEventListener("visibilitychange", suspend);
      document.defaultView?.removeEventListener("pagehide", stop);
    },
  };

  return {
    ...port,
    async probe(): Promise<Capability> {
      if (!eligible() || !api()) return { state: "unavailable", reason: "execution-context-unavailable", message: "Translator requires an eligible visible secure document" };
      if (!supported()) return { state: "unavailable", reason: "language-pair-unsupported", message: "Only Japanese/English to Korean is supported by this adapter" };
      try {
        const states = await Promise.all(sources.map(sourceLanguage => api()?.availability({ sourceLanguage, targetLanguage: pair.target })));
        if (!eligible()) return { state: "unavailable", reason: "execution-context-unavailable", message: "Document suspended during probe" };
        if (states.every(state => state === "available")) return { state: "available" };
        if (states.every(state => state === "available" || state === "downloadable" || state === "downloading")) return { state: "download-required", reason: "download-required", message: "Press Prepare to download or finish loading this language pair" };
        return { state: "unavailable", reason: "language-pair-unsupported", message: "Browser cannot translate this language pair" };
      } catch { return { state: "unavailable", reason: "execution-context-unavailable", message: "Translator capability probe failed" }; }
    },
    async prepare(): Promise<void> {
      const native = api();
      if (!eligible() || !native) throw new Error("execution-context-unavailable");
      if (!supported()) throw new Error("language-pair-unsupported");
      if (execution === "foreground" && !document.defaultView?.navigator.userActivation.isActive) throw new Error("Press Prepare in this document to start");
      if (preparing || translators.size) throw new Error("Stop before preparing another translator");
      const operation = new AbortController(); preparing = operation;
      receive({ state: "preparing" });
      try {
        // Call create before any await: a capability probe must not consume the
        // activation needed to begin the browser-owned language-pack download.
        await Promise.all(sources.map(async sourceLanguage => {
          const loaded = await native.create({ sourceLanguage, targetLanguage: pair.target, signal: operation.signal,
            monitor(monitor) {
              monitor.addEventListener("downloadprogress", event => {
                if (preparing === operation && !operation.signal.aborted && Number.isFinite(event.loaded) && event.loaded >= 0 && event.loaded <= 1) receive({ state: "preparing", progress: event.loaded });
              });
            },
          });
          if (operation.signal.aborted || !eligible(false)) { loaded.destroy(); throw new DOMException("Translation preparation stopped", "AbortError"); }
          translators.set(sourceLanguage, loaded);
        }));
        receive({ state: "ready" });
      } catch (error) {
        if (!operation.signal.aborted) receive({ state: "failed", reason: error instanceof DOMException && error.name === "NotSupportedError" ? "language-pair-unsupported" : "model-load-failed" });
        operation.abort();
        if (preparing === operation) {
          for (const translator of translators.values()) translator.destroy();
          translators.clear();
        }
        throw error;
      } finally { if (preparing === operation) preparing = undefined; }
    },
    stop,
  };
}
