import "./popup.css";
import type { CaptureStatus } from "./capture/contracts";
import { defaultSettings, type SessionSettings } from "./capture/settings";

const status = document.querySelector<HTMLParagraphElement>("#status");
const metrics = document.querySelector<HTMLParagraphElement>("#metrics");
const start = document.querySelector<HTMLButtonElement>("#start");
const stop = document.querySelector<HTMLButtonElement>("#stop");
const form = document.querySelector<HTMLFormElement>("#settings");
const install = document.querySelector<HTMLButtonElement>("#install-companion");
if (!status || !metrics || !start || !stop || !form || !install) throw new Error("Popup controls are missing.");
const provider = form.elements.namedItem("provider") as HTMLSelectElement;
const asr = form.elements.namedItem("asr") as HTMLSelectElement;
const asrModel = form.elements.namedItem("asrModel") as HTMLInputElement;
const textModel = form.elements.namedItem("textModel") as HTMLInputElement;
let pending = Promise.resolve();

const render = (capture: CaptureStatus) => {
  status.textContent = capture.message;
  status.dataset.state = capture.state;
  start.disabled = capture.state === "starting";
  stop.disabled = capture.state === "idle";
  install.hidden = !capture.installRequired;
  metrics.textContent = capture.frames === undefined ? "" : `${capture.frames} PCM frames received`;
};

function selected(): SessionSettings {
  return Object.fromEntries(new FormData(form as HTMLFormElement)) as unknown as SessionSettings;
}

function visibility() {
  const direct = provider.value === "openai-direct";
  for (const name of ["asr", "asrModel", "sourceLanguage"]) {
    const control = form?.elements.namedItem(name) as HTMLInputElement;
    if (control.parentElement) control.parentElement.hidden = direct;
  }
  asrModel.readOnly = asr.value === "openai";
  textModel.readOnly = direct;
  textModel.required = true;
}

async function send(message: object) {
  try {
    render(await chrome.runtime.sendMessage({ target: "worker", ...message }));
  } catch {
    render({ state: "error", message: "Extension connection failed. Reload the extension and try again." });
  }
}

form.addEventListener("change", (event) => {
  if (event.target === asr) asrModel.value = asr.value === "openai" ? "gpt-live-transcribe" : defaultSettings.asrModel;
  if (event.target === provider) {
    textModel.value = ({ local: defaultSettings.textModel, "openai-direct": "gpt-realtime-translate", luna: "gpt-6-luna", anthropic: "" })[provider.value as SessionSettings["provider"]];
  }
  visibility();
  const settings = selected();
  start.disabled = true;
  pending = send({ type: "configure", settings });
});
start.addEventListener("click", () => {
  if (!form.reportValidity()) return;
  start.disabled = true;
  const settings = selected();
  pending = pending.then(async () => {
    await send({ type: "configure", settings });
    await send({ type: "start" });
  });
});
stop.addEventListener("click", () => { pending = send({ type: "stop" }); });
install.addEventListener("click", () => { void send({ type: "install-companion" }); });
chrome.runtime.onMessage.addListener((message) => {
  if (message.target === "worker" && message.type === "capture-status") render(message.status);
});
start.disabled = true;
void (async () => {
  const settings: SessionSettings = await chrome.runtime.sendMessage({ target: "worker", type: "settings" });
  for (const [name, value] of Object.entries(settings)) {
    const control = form.elements.namedItem(name) as HTMLInputElement;
    control.value = value;
  }
  visibility();
  await send({ type: "status" });
})();
