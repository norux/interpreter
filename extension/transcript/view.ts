import "./view.css";
import { createLegacyPresentation, displayCaption } from "../captions/presentation";
import type { CaptureStatus } from "../capture/contracts";
import type { TranscriptMessage } from "./contracts";

const body = document.querySelector("#sentences") as HTMLTableSectionElement;
const empty = document.querySelector("#empty") as HTMLParagraphElement;
const status = document.querySelector("#status") as HTMLParagraphElement;
const retention = document.querySelector("#retention") as HTMLSpanElement;
let sessionId: string | undefined;
let policy: ReturnType<typeof createLegacyPresentation> | undefined;
const entries = new Map<string, {
  row: HTMLTableRowElement;
  source: HTMLTableCellElement; translation: HTMLTableCellElement;
  start: HTMLSpanElement; end: HTMLSpanElement; phase: HTMLSpanElement;
}>();

function time(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.${String(Math.floor(milliseconds % 1000)).padStart(3, "0")}`;
}

function render(caption: ReturnType<typeof displayCaption>) {
  if (caption.sessionId !== sessionId) return;
  let entry = entries.get(caption.utteranceId);
  if (!entry) {
    const row = document.createElement("tr");
    row.dataset.utteranceId = caption.utteranceId;
    const source = document.createElement("td");
    const center = document.createElement("td");
    const translation = document.createElement("td");
    source.className = "source"; center.className = "time"; translation.className = "translation";
    const start = document.createElement("span");
    const end = document.createElement("span");
    const phase = document.createElement("span");
    phase.className = "phase";
    center.append(start, end, phase);
    row.append(source, center, translation);
    entry = { row, source, translation, start, end, phase };
    entries.set(caption.utteranceId, entry);
    body.append(row);
  }
  const follow = window.scrollY + innerHeight >= document.documentElement.scrollHeight - 100;
  entry.source.textContent = caption.source || "원문 제공 안 됨";
  entry.translation.textContent = caption.translation;
  entry.start.textContent = time(caption.audioStartMs);
  entry.end.textContent = `— ${time(caption.audioEndMs)}`;
  entry.phase.textContent = caption.final ? "확정" : "교정 중";
  entry.row.dataset.final = String(caption.final);
  empty.hidden = true;
  if (follow) window.scrollTo({ top: document.documentElement.scrollHeight });
}

function renderStatus(capture: CaptureStatus) {
  status.dataset.state = capture.state;
  status.textContent = { idle: "중지됨", starting: "준비 중", capturing: "듣고 있어요", error: "연결 오류" }[capture.state];
  status.title = capture.message;
}

function receive(message: TranscriptMessage) {
  if (message.type === "status") { renderStatus(message.status); return; }
  if (message.type === "snapshot") {
    policy?.dispose();
    sessionId = message.sessionId;
    entries.clear();
    body.replaceChildren();
    empty.hidden = false;
    policy = sessionId === undefined ? undefined : createLegacyPresentation(sessionId, (event) => {
      if (event.type === "insert" || event.type === "update" || event.type === "replay") render(displayCaption(event.caption));
      else if (event.type === "remove") {
        entries.get(event.utteranceId)?.row.remove();
        entries.delete(event.utteranceId);
      }
    });
    for (const caption of message.captions) policy?.caption(caption);
  } else {
    if (message.caption.sessionId !== sessionId) return;
    if (message.removedId) {
      policy?.retire(message.removedId);
    }
    policy?.caption(message.caption);
  }
  retention.textContent = message.dropped
    ? `최근 300개 발화 · 이전 ${message.dropped}개는 화면에서 제외되었습니다.`
    : "최근 300개 발화 · 새 녹음을 시작하면 초기화됩니다.";
}

chrome.runtime.onMessage.addListener((message: TranscriptMessage, sender) => {
  if (sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("service-worker.js") && message.target === "transcript") receive(message);
});
void chrome.runtime.sendMessage({ target: "worker", type: "transcript-snapshot" }).then((snapshot: TranscriptMessage & { status: CaptureStatus }) => {
  receive(snapshot);
  renderStatus(snapshot.status);
}, () => { status.textContent = "확장을 새로고침한 뒤 창을 다시 여세요."; });
window.addEventListener("pagehide", () => { policy?.dispose(); });
