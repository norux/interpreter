import { backgroundChannel, controlChannel, eventChannel, type BackgroundCommand, type BackgroundSnapshot } from "./background-protocol";
import { createRemoteVideoOutput, tabOverlayChannelName } from "./overlay-channel";

let creating: Promise<void> | undefined;
let output: ReturnType<typeof createRemoteVideoOutput> | undefined;
let outputSession: string | undefined;
let generation = 0;
let starting = false;
let selectedTabId: number | undefined;
const offscreenUrl = chrome.runtime.getURL("offscreen.html");

async function ensureRuntime() {
  if (creating) return creating;
  creating = (async () => {
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [offscreenUrl] });
    if (!contexts.length) await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.WORKERS],
      justification: "Keep tab audio capture, model downloads and local interpretation running independently of popup and reference windows." });
  })().finally(() => { creating = undefined; });
  return creating;
}
async function send(command: BackgroundCommand): Promise<BackgroundSnapshot> {
  const result = await chrome.runtime.sendMessage({ channel: backgroundChannel, command });
  if (result?.error) throw new Error(result.error);
  if (!result?.snapshot) throw new Error("백그라운드 실행에 연결할 수 없습니다.");
  return result.snapshot;
}
async function connectOutput(snapshot: BackgroundSnapshot) {
  if (!snapshot.tabId || !snapshot.target || !snapshot.identity || outputSession === snapshot.identity.sessionId) return;
  const current = generation;
  output?.dispose(); output = undefined; outputSession = snapshot.identity.sessionId;
  try {
    await chrome.scripting.executeScript({ target: { tabId: snapshot.tabId, frameIds: [0] }, files: ["tab-content.js"] });
    if (current !== generation) return;
    output = createRemoteVideoOutput(chrome.tabs.connect(snapshot.tabId, { name: tabOverlayChannelName, frameId: 0 }), () => { if (current === generation) { output = undefined; outputSession = undefined; } });
    output.activate(snapshot.target, snapshot.identity);
    const last = snapshot.captions.at(-1);
    if (last) output.compare(last);
  } catch { if (current === generation) outputSession = undefined; }
}
async function control(command: { type: string; tabId?: number; source?: "ja" | "en" }) {
  if (command.type === "prepare" && command.tabId && command.source) {
    await ensureRuntime();
    const previous = selectedTabId; const current = generation;
    selectedTabId = command.tabId;
    try { return await send({ type: "prepare", tabId: command.tabId, source: command.source }); }
    catch (error) {
      if (current === generation && selectedTabId === command.tabId) selectedTabId = previous;
      throw error;
    }
  }
  if (command.type === "stop") {
    generation++; selectedTabId = undefined; output?.dispose(); output = undefined; outputSession = undefined;
    return send({ type: "stop" });
  }
  await ensureRuntime();
  if (command.type === "reference") {
    const url = chrome.runtime.getURL("tab-host.html");
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB], documentUrls: [url] });
    if (contexts[0]) await chrome.windows.update(contexts[0].windowId, { focused: true });
    else await chrome.windows.create({ url, type: "popup", width: 900, height: 720 });
    return send({ type: "snapshot" });
  }
  if (command.type === "snapshot") {
    const snapshot = await send({ type: "snapshot" });
    void connectOutput(snapshot);
    return snapshot;
  }
  if (command.type === "start" && command.tabId) {
    if (starting) throw new Error("탭에 연결 중입니다.");
    starting = true; const current = generation;
    try {
      const snapshot = await send({ type: "snapshot" });
      if (snapshot.state !== "ready" || snapshot.tabId !== command.tabId) throw new Error("이 탭의 모델을 먼저 준비하세요.");
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: command.tabId });
      if (current !== generation) return send({ type: "snapshot" });
      return await send({ type: "start", tabId: command.tabId, streamId });
    } finally { starting = false; }
  }
  throw new Error("알 수 없는 요청입니다.");
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.channel === controlChannel && [chrome.runtime.getURL("popup.html"), chrome.runtime.getURL("tab-host.html")].includes(sender.url ?? "")) {
    void control(message.command).then(snapshot => respond({ snapshot }), error => respond({ error: error.message }));
    return true;
  }
  if (message?.channel !== eventChannel || sender.url !== offscreenUrl) return;
  if (message.type === "clear") {
    generation++; output?.clear(message.identity); output?.dispose(); output = undefined; outputSession = undefined;
  }
  else if (message.type === "caption" && output) output.compare(message.caption);
  else if (message.type === "activate" || message.type === "caption") {
    void send({ type: "snapshot" }).then(connectOutput).catch(() => {});
  }
});
async function invalidate(tabId: number) {
  if (tabId === selectedTabId) { await control({ type: "stop" }); return; }
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [offscreenUrl] });
  if (!contexts.length) return;
  const snapshot = await send({ type: "snapshot" });
  if (snapshot.tabId === tabId) await control({ type: "stop" });
}
chrome.tabs.onRemoved.addListener(tabId => { void invalidate(tabId).catch(() => {}); });
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.status === "loading") void invalidate(tabId).catch(() => {}); });
