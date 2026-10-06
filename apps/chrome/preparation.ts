import { createExecutionHost } from "../../packages/engines-browser/execution-host";
import { preparationModel, requiredBytes } from "../../packages/engines-browser/model";

const status = document.getElementById("status") as HTMLParagraphElement;
const progress = document.getElementById("progress") as HTMLProgressElement;
const prepare = document.getElementById("prepare") as HTMLButtonElement;
const evict = document.getElementById("evict") as HTMLButtonElement;
const identity = document.getElementById("identity") as HTMLParagraphElement;
const stop = document.getElementById("stop") as HTMLButtonElement;
identity.textContent = `${preparationModel.id} @ ${preparationModel.version}; model files ${requiredBytes} bytes. Runtime storage is additional.`;
progress.max = requiredBytes;
const host = createExecutionHost(document, (value) => {
  status.textContent = `${value.state}: ${value.downloadedBytes ?? 0}/${value.requiredBytes} bytes${value.reason ? ` (${value.reason})` : ""}`;
  status.dataset.state = value.state;
  progress.value = value.downloadedBytes ?? 0;
});
let generation = 0;
function operation(run: () => Promise<unknown>) {
  const current = ++generation;
  prepare.disabled = true; evict.disabled = true;
  // Invoke synchronously in the click handler: activation cannot survive async host messaging.
  run().catch((error: Error) => {
    if (generation === current) { status.textContent = error.message; status.dataset.state = "failed"; }
  }).finally(() => {
    if (generation === current) { prepare.disabled = false; evict.disabled = false; }
  });
}
prepare.onclick = () => operation(host.prepare);
evict.onclick = () => operation(host.evict);
stop.onclick = () => {
  generation++; host.stop(); prepare.disabled = false; evict.disabled = false;
  status.textContent = "Stopped. Cached files are separate from a loaded model."; status.dataset.state = "stopped";
};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") {
    generation++; prepare.disabled = false; evict.disabled = false;
    status.textContent = "Suspended. Press Prepare again after returning."; status.dataset.state = "suspended";
  }
});
operation(host.status);
