import "./popup.css";
import type { CaptureStatus } from "./capture/contracts";

const status = document.querySelector<HTMLParagraphElement>("#status");
const metrics = document.querySelector<HTMLParagraphElement>("#metrics");
const start = document.querySelector<HTMLButtonElement>("#start");
const stop = document.querySelector<HTMLButtonElement>("#stop");
if (!status || !metrics || !start || !stop) throw new Error("Popup controls are missing.");

const render = (capture: CaptureStatus) => {
  status.textContent = capture.message;
  status.dataset.state = capture.state;
  start.disabled = capture.state === "starting";
  stop.disabled = capture.state === "idle";
  metrics.textContent = capture.frames === undefined ? "" : `${capture.frames} PCM frames received`;
};

const command = async (type: "start" | "stop" | "status") => {
  start.disabled = true;
  stop.disabled = true;
  try {
    render(await chrome.runtime.sendMessage({ target: "worker", type }));
  } catch {
    render({ state: "error", message: "Extension connection failed. Reload the extension and try again." });
  }
};

start.addEventListener("click", () => void command("start"));
stop.addEventListener("click", () => void command("stop"));
chrome.runtime.onMessage.addListener((message) => {
  if (message.target === "worker" && message.type === "capture-status") render(message.status);
});
void command("status");
