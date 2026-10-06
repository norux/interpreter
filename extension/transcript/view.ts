import "./view.css";
import type { Caption } from "../captions/contracts";
import type { CaptureStatus } from "../capture/contracts";
import type { TranscriptMessage } from "./contracts";

const body = document.querySelector("#sentences") as HTMLTableSectionElement;
const empty = document.querySelector("#empty") as HTMLParagraphElement;
const status = document.querySelector("#status") as HTMLParagraphElement;
const retention = document.querySelector("#retention") as HTMLSpanElement;
let sessionId: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const entries = new Map<string, {
  caption: Caption; pending?: Caption; updatedAt: number; row: HTMLTableRowElement;
  source: HTMLTableCellElement; translation: HTMLTableCellElement;
  start: HTMLSpanElement; end: HTMLSpanElement; phase: HTMLSpanElement;
}>();

function time(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.${String(Math.floor(milliseconds % 1000)).padStart(3, "0")}`;
}

function schedule() {
  clearTimeout(timer);
  timer = undefined;
  const pending = [...entries.values()].filter((entry) => entry.pending);
  if (!pending.length) return;
  timer = setTimeout(() => {
    timer = undefined;
    const now = performance.now();
    for (const entry of entries.values()) {
      if (entry.pending && now - entry.updatedAt >= 1000) {
        const caption = entry.pending;
        entry.pending = undefined;
        render(caption);
      }
    }
    schedule();
  }, Math.max(1, Math.min(...pending.map((entry) => entry.updatedAt + 1000 - performance.now()))));
}

function render(caption: Caption) {
  if (caption.sessionId !== sessionId) return;
  let entry = entries.get(caption.utteranceId);
  const now = performance.now();
  if (entry) {
    const latest = entry.pending ?? entry.caption;
    if (caption.revision <= latest.revision || (latest.final && !caption.final)) return;
    if (!caption.final && now - entry.updatedAt < 1000) {
      entry.pending = caption;
      schedule();
      return;
    }
  } else {
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
    entry = { caption, updatedAt: now, row, source, translation, start, end, phase };
    entries.set(caption.utteranceId, entry);
    body.append(row);
  }
  const follow = window.scrollY + innerHeight >= document.documentElement.scrollHeight - 100;
  entry.caption = caption;
  entry.pending = undefined;
  entry.updatedAt = now;
  entry.source.textContent = caption.source || "원문 제공 안 됨";
  entry.translation.textContent = caption.translation;
  entry.start.textContent = time(caption.audioStartMs);
  entry.end.textContent = `— ${time(caption.audioEndMs)}`;
  entry.phase.textContent = caption.final ? "확정" : "교정 중";
  entry.row.dataset.final = String(caption.final);
  empty.hidden = true;
  if (follow) window.scrollTo({ top: document.documentElement.scrollHeight });
  schedule();
}

function renderStatus(capture: CaptureStatus) {
  status.dataset.state = capture.state;
  status.textContent = { idle: "중지됨", starting: "준비 중", capturing: "듣고 있어요", error: "연결 오류" }[capture.state];
  status.title = capture.message;
}

function receive(message: TranscriptMessage) {
  if (message.type === "status") { renderStatus(message.status); return; }
  if (message.type === "snapshot") {
    clearTimeout(timer);
    timer = undefined;
    sessionId = message.sessionId;
    entries.clear();
    body.replaceChildren();
    empty.hidden = false;
    for (const caption of message.captions) render(caption);
  } else {
    if (message.caption.sessionId !== sessionId) return;
    if (message.removedId) {
      entries.get(message.removedId)?.row.remove();
      entries.delete(message.removedId);
    }
    render(message.caption);
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
window.addEventListener("pagehide", () => { clearTimeout(timer); });
