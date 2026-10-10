import { sameIdentity } from "../../packages/core/identity";
import { createComparisonView } from "../../packages/presentation-web/comparison";
import { controlChannel, eventChannel, type BackgroundSnapshot } from "./background-protocol";

const status = document.querySelector("#connection") as HTMLElement;
const container = document.querySelector("#app") as HTMLElement;
const view = createComparisonView(container, "capture");
container.querySelector(".interpreter-live")?.remove();
const headings = container.querySelectorAll("th");
["원문", "경과 시간", "한국어"].forEach((label, index) => { headings[index].textContent = label; });
let identity: BackgroundSnapshot["identity"];
let disposed = false;
let revision = 0;
async function refresh() {
  const current = ++revision;
  const result = await chrome.runtime.sendMessage({ channel: controlChannel, command: { type: "snapshot" } });
  if (disposed || current !== revision) return;
  if (result?.error) { status.textContent = result.error; return; }
  const snapshot = result.snapshot as BackgroundSnapshot;
  status.textContent = snapshot.message;
  for (const caption of snapshot.captions) {
    if (!identity || !sameIdentity(identity, caption.source.identity)) {
      identity = caption.source.identity; view.activate(identity);
    }
    view.compare(caption);
  }
}
function changed(message: { channel?: string; type?: string; caption?: BackgroundSnapshot["captions"][number] }, sender: chrome.runtime.MessageSender) {
  if (sender.id !== chrome.runtime.id || message.channel !== eventChannel) return;
  if (message.type === "caption" && message.caption?.source.retracted) view.compare(message.caption);
  void refresh().catch(error => { status.textContent = error.message; });
}
chrome.runtime.onMessage.addListener(changed);
void refresh().catch(error => { status.textContent = error.message; });
window.addEventListener("pagehide", () => { disposed = true; chrome.runtime.onMessage.removeListener(changed); view.dispose(); });
