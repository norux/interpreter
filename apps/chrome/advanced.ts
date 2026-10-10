import { controlChannel, eventChannel, type BackgroundSnapshot } from "./background-protocol";
import { defaultModelOptions, modelOptionsKey, readModelOptions, recognitionChoices, translationChoices, validModelOptions } from "./model-options";
import { localSpeechLanguages } from "../../packages/engines-browser/local-speech";

const recognition = document.querySelector("#recognition") as HTMLSelectElement;
const translation = document.querySelector("#translation") as HTMLSelectElement;
const status = document.querySelector("#status") as HTMLElement;
const retry = document.querySelector("#retry") as HTMLButtonElement;
const reset = document.querySelector("#reset") as HTMLButtonElement;
const stop = document.querySelector("#stop") as HTMLButtonElement;
const params = new URL(location.href).searchParams;
const tabId = Number(params.get("tabId")) || undefined;
let source: BackgroundSnapshot["source"] = "ja";
const selectedSource = params.get("source");
if (selectedSource === "ja" || selectedSource === "en" || selectedSource === "ko" || selectedSource === "auto") source = selectedSource;
let disposed = false;
let revision = 0;
for (const [select, choices] of [[recognition, recognitionChoices], [translation, translationChoices]] as const) {
  for (const choice of choices) select.add(new Option(choice.name, choice.id));
}
function describe() {
  (document.querySelector("#recognition-detail") as HTMLElement).textContent = recognitionChoices.find(choice => choice.id === recognition.value)?.detail ?? "";
  (document.querySelector("#translation-detail") as HTMLElement).textContent = translationChoices.find(choice => choice.id === translation.value)?.detail ?? "";
}
function render(snapshot: BackgroundSnapshot) {
  status.textContent = snapshot.message;
  stop.disabled = snapshot.state === "idle" || snapshot.state === "stopping";
}
const initial = readModelOptions(); recognition.value = initial.recognition; translation.value = initial.translation; describe();
async function apply() {
  const options = { recognition: recognition.value, translation: translation.value };
  if (!validModelOptions(options)) return;
  const current = ++revision;
  describe(); status.textContent = "선택한 모델을 준비하는 중…";
  retry.disabled = reset.disabled = recognition.disabled = translation.disabled = true;
  try {
    const speech = (window as Window & { SpeechRecognition?: { install?: (options: { langs: string[]; processLocally: true }) => Promise<boolean> }; webkitSpeechRecognition?: { install?: (options: { langs: string[]; processLocally: true }) => Promise<boolean> } });
    const api = speech.SpeechRecognition ?? speech.webkitSpeechRecognition;
    if (options.recognition === "chrome" && (source === "ja" || source === "en")) void api?.install?.({ langs: localSpeechLanguages(source), processLocally: true }).catch(error => { if (!disposed && current === revision) status.textContent = `Chrome 음성 팩 준비 실패: ${error.message}`; });
    const result = await chrome.runtime.sendMessage({ channel: controlChannel, command: { type: "models", tabId, source, options } });
    if (disposed || current !== revision) return;
    if (result?.error) throw new Error(result.error);
    localStorage.setItem(modelOptionsKey, JSON.stringify(options));
    if (result?.snapshot) render(result.snapshot);
  } catch (error) { if (!disposed && current === revision) status.textContent = `모델 준비 실패: ${(error as Error).message}`; }
  finally { if (current === revision) retry.disabled = reset.disabled = recognition.disabled = translation.disabled = false; }
}
recognition.onchange = translation.onchange = () => { void apply(); };
retry.onclick = () => { void apply(); };
reset.onclick = () => { recognition.value = defaultModelOptions.recognition; translation.value = defaultModelOptions.translation; void apply(); };
stop.onclick = () => { revision++; void chrome.runtime.sendMessage({ channel: controlChannel, command: { type: "stop" } }).then(result => { if (!disposed) { if (result?.error) status.textContent = result.error; else if (result?.snapshot) render(result.snapshot); retry.disabled = reset.disabled = recognition.disabled = translation.disabled = false; } }).catch(error => { if (!disposed) status.textContent = error.message; }); };
async function refresh() {
  const result = await chrome.runtime.sendMessage({ channel: controlChannel, command: { type: "snapshot" } });
  if (!disposed && result?.snapshot) render(result.snapshot);
}
function changed(message: { channel?: string }, sender: chrome.runtime.MessageSender) {
  if (sender.id === chrome.runtime.id && message.channel === eventChannel) void refresh().catch(error => { if (!disposed) status.textContent = error.message; });
}
chrome.runtime.onMessage.addListener(changed);
void refresh().catch(error => { status.textContent = error.message; });
window.addEventListener("pagehide", () => { disposed = true; chrome.runtime.onMessage.removeListener(changed); });
