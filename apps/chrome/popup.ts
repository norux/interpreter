import { controlChannel, eventChannel, type BackgroundSnapshot } from "./background-protocol";

const language = document.querySelector("#language") as HTMLSelectElement;
const prepare = document.querySelector("#prepare") as HTMLButtonElement;
const start = document.querySelector("#start") as HTMLButtonElement;
const stop = document.querySelector("#stop") as HTMLButtonElement;
const status = document.querySelector("#status") as HTMLElement;
const diagnostic = document.querySelector("#diagnostic") as HTMLElement;
let tabId: number | undefined;
let disposed = false;
let revision = 0;
let snapshot: BackgroundSnapshot | undefined;
function render(value: BackgroundSnapshot) {
  snapshot = value;
  const busy = ["preparing", "ready", "starting", "running", "stopping", "failed"].includes(value.state);
  if (busy) language.value = value.source;
  language.disabled = busy;
  prepare.disabled = busy || tabId === undefined;
  start.disabled = value.state !== "ready";
  stop.disabled = value.state === "idle" || value.state === "stopping";
  status.textContent = value.message;
  diagnostic.textContent = value.diagnostic ?? "";
}
async function request(type: string) {
  const current = ++revision;
  const result = await chrome.runtime.sendMessage({ channel: controlChannel,
    command: { type, tabId: type === "start" ? snapshot?.tabId : tabId, source: language.value } });
  if (disposed || current !== revision) return;
  if (result?.error) { status.textContent = result.error; return; }
  if (result?.snapshot) render(result.snapshot);
}
function action(type: string) {
  void request(type).catch(error => { if (!disposed) status.textContent = error.message; });
}
prepare.onclick = () => { prepare.disabled = true; action("prepare"); };
start.onclick = () => { start.disabled = true; action("start"); };
stop.onclick = () => { stop.disabled = true; action("stop"); };
(document.querySelector("#reference") as HTMLButtonElement).onclick = () => action("reference");
function changed(message: { channel?: string }, sender: chrome.runtime.MessageSender) {
  if (sender.id === chrome.runtime.id && message.channel === eventChannel) action("snapshot");
}
chrome.runtime.onMessage.addListener(changed);
void chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
  const tab = tabs[0];
  if (tab?.id !== undefined && !tab.url?.startsWith("chrome-extension:")) tabId = tab.id;
  action("snapshot");
}).catch(error => { status.textContent = error.message; });
window.addEventListener("pagehide", () => { disposed = true; chrome.runtime.onMessage.removeListener(changed); });
