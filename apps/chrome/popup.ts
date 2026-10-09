import { controlChannel, eventChannel, type BackgroundSnapshot } from "./background-protocol";
import { asrCandidates, registeredCandidate, vadCandidate } from "../../packages/engines-browser/model";
import { localSpeechLanguages } from "../../packages/engines-browser/local-speech";

const language = document.querySelector("#language") as HTMLSelectElement;
const prepare = document.querySelector("#prepare") as HTMLButtonElement;
const start = document.querySelector("#start") as HTMLButtonElement;
const stop = document.querySelector("#stop") as HTMLButtonElement;
const status = document.querySelector("#status") as HTMLElement;
const diagnostic = document.querySelector("#diagnostic") as HTMLElement;
const modelDetails = document.querySelector("#model-details") as HTMLElement;
const modelSetup = document.querySelector("#model-setup") as HTMLElement;
const translationControls = document.querySelector("#translation-controls") as HTMLElement;
const modelDescription = document.querySelector("#model-description") as HTMLElement;
let tabId: number | undefined;
let disposed = false;
let revision = 0;
let snapshot: BackgroundSnapshot | undefined;
let checking = false;
type SpeechApi = { available?: (options: { langs: string[]; processLocally: true }) => Promise<string>; install?: (options: { langs: string[]; processLocally: true }) => Promise<boolean>; new(): { processLocally?: boolean } };
const view = window as Window & { SpeechRecognition?: SpeechApi; webkitSpeechRecognition?: SpeechApi; Translator?: { availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string> } };
const speech = view.SpeechRecognition ?? view.webkitSpeechRecognition;
const localSpeechSupported = !!speech?.available && !!speech.install && "processLocally" in new speech();
function render(value: BackgroundSnapshot) {
  snapshot = value;
  const busy = ["preparing", "starting", "running", "stopping", "failed"].includes(value.state);
  if (busy || value.state === "ready") language.value = value.source;
  language.disabled = busy || checking;
  const setup = value.state === "idle" || value.state === "preparing";
  modelSetup.hidden = !setup;
  translationControls.hidden = setup;
  modelDescription.textContent = localSpeechSupported
    ? `음성 인식: Chrome SODA · ${language.value === "ja" ? "일본어" : "영어"}\nChrome 시작용 영어·한국어 팩 포함\n번역: Chrome TranslateKit · 한국어\n창을 닫아도 다운로드가 계속 진행됩니다.`
    : "음성 인식: Whisper large-v3-turbo · FP16 + Silero VAD\n번역: Chrome TranslateKit · 한국어\n최초 한 번 다운로드하며, 창을 닫아도 계속 진행됩니다.";
  prepare.hidden = !setup;
  prepare.textContent = checking ? "모델 확인 중…" : value.state === "preparing" ? "다운로드 · 준비 중…" : "모델 다운로드";
  prepare.disabled = busy || checking || tabId === undefined;
  start.disabled = value.state !== "ready" || value.tabId !== tabId || checking;
  stop.disabled = value.state === "idle" || value.state === "stopping";
  status.textContent = value.message;
  diagnostic.textContent = value.diagnostic ?? "";
  modelDetails.hidden = !value.diagnostic;
}
async function request(type: string) {
  const current = ++revision;
  const result = await chrome.runtime.sendMessage({ channel: controlChannel,
    command: { type, tabId: type === "start" ? snapshot?.tabId : tabId, source: language.value } });
  if (disposed || current !== revision) return result?.snapshot as BackgroundSnapshot | undefined;
  if (result?.error) { status.textContent = result.error; return; }
  if (result?.snapshot) render(result.snapshot);
  return result?.snapshot as BackgroundSnapshot | undefined;
}
function action(type: string) {
  void request(type).catch(error => { if (!disposed) status.textContent = error.message; });
}
async function ensureReady() {
  if (disposed || checking || tabId === undefined || !snapshot || !["idle", "ready"].includes(snapshot.state)) return;
  checking = true; render(snapshot);
  try {
    if (snapshot.state === "ready") {
      if (snapshot.tabId === tabId && snapshot.source === language.value) return;
      const stopped = await request("stop");
      if (disposed) return;
      if (stopped) render(stopped);
    }
    status.textContent = "저장된 모델 확인 중…";
    const translation = await view.Translator?.availability({ sourceLanguage: language.value, targetLanguage: "ko" });
    let cached = translation === "available";
    if (cached && localSpeechSupported) {
      cached = await speech?.available?.({ langs: localSpeechLanguages(language.value as "ja" | "en"), processLocally: true }) === "available";
    } else if (cached) {
      for (const selected of [registeredCandidate(asrCandidates.turboFp16.model, "fp16"), registeredCandidate(vadCandidate.model, "fp32")]) {
        if (!await caches.has(selected.cacheName)) { cached = false; break; }
        const cache = await caches.open(selected.cacheName);
        for (const file of selected.files) {
          const response = await cache.match(selected.url(file.path));
          if (!response?.ok || Number(response.headers.get("Content-Length")) !== file.bytes) { cached = false; break; }
        }
        if (!cached) break;
      }
    }
    if (disposed) return;
    if (cached) await request("prepare");
    else if (snapshot.state === "idle") snapshot.message = "처음 사용할 언어의 모델을 준비하세요.";
  } catch (error) {
    if (!disposed && snapshot.state === "idle") snapshot.message = `모델 확인 실패: ${(error as Error).message}`;
  } finally {
    checking = false;
    if (!disposed && snapshot) render(snapshot);
  }
}
prepare.onclick = () => {
  prepare.disabled = true;
  // The browser keeps downloading even after this action popup disappears.
  if (localSpeechSupported) void speech?.install?.({ langs: localSpeechLanguages(language.value as "ja" | "en"), processLocally: true }).catch(error => {
    if (!disposed) status.textContent = `음성 인식 모델 준비 실패: ${error.message}`;
  });
  action("prepare");
};
start.onclick = () => { start.disabled = true; action("start"); };
stop.onclick = () => {
  stop.disabled = true;
  void request("stop").then(async stopped => {
    if (disposed) return;
    if (stopped) render(stopped);
    await ensureReady();
  }).catch(error => { if (!disposed) status.textContent = error.message; });
};
language.onchange = () => {
  void (snapshot?.state === "ready" ? request("stop") : Promise.resolve()).then(async stopped => {
    if (disposed) return;
    if (stopped) render(stopped);
    await ensureReady();
  }).catch(error => { if (!disposed) status.textContent = error.message; });
};
(document.querySelector("#reference") as HTMLButtonElement).onclick = () => action("reference");
function changed(message: { channel?: string }, sender: chrome.runtime.MessageSender) {
  if (sender.id === chrome.runtime.id && message.channel === eventChannel) action("snapshot");
}
chrome.runtime.onMessage.addListener(changed);
void chrome.tabs.query({ active: true, currentWindow: true }).then(async tabs => {
  const tab = tabs[0];
  if (tab?.id !== undefined && !tab.url?.startsWith("chrome-extension:")) tabId = tab.id;
  const initial = await request("snapshot");
  if (disposed) return;
  if (initial) { language.value = initial.source; render(initial); }
  await ensureReady();
}).catch(error => { status.textContent = error.message; });
window.addEventListener("pagehide", () => { disposed = true; chrome.runtime.onMessage.removeListener(changed); });
