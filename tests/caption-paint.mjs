// Test-only Chromium paint tracing. DOM/rAF/server timestamps are not paint evidence.
import assert from "node:assert/strict";

const prefix = "interpreter-caption:";

export function captionPaints(events, frameId) {
  const marks = events.filter((event) => event.name.startsWith(prefix)).sort((a, b) => a.ts - b.ts);
  const paints = events.filter((event) => event.name === "Paint" && event.args?.data?.frame === frameId).sort((a, b) => a.ts - b.ts);
  return marks.map((mark, index) => {
    const data = JSON.parse(mark.name.slice(prefix.length));
    const next = marks.slice(index + 1).find((candidate) => {
      const later = JSON.parse(candidate.name.slice(prefix.length));
      return later.sessionId === data.sessionId && (later.utteranceId === data.utteranceId
        || later.type === "clear" || later.type === "start");
    })?.ts ?? Infinity;
    const paint = paints.find((event) => {
      if (event.ts < mark.ts || event.ts >= next || !data.visible) return false;
      const clip = event.args.data.clip;
      if (!Array.isArray(clip) || clip.length !== 8) return false;
      const xs = clip.filter((_, i) => i % 2 === 0);
      const ys = clip.filter((_, i) => i % 2 === 1);
      return Math.min(...xs) <= data.left && Math.max(...xs) >= data.right
        && Math.min(...ys) <= data.top && Math.max(...ys) >= data.bottom;
    });
    return { ...data, paintAtMs: paint ? data.atMs + (paint.ts - mark.ts) / 1000 : null,
      markToPaintMs: paint ? (paint.ts - mark.ts) / 1000 : null };
  });
}

export async function traceCaptionPaints(context, page, worker, tabId) {
  const cdp = await context.newCDPSession(page);
  const { frameTree } = await cdp.send("Page.getFrameTree");
  const events = [];
  cdp.on("Tracing.dataCollected", ({ value }) => {
    events.push(...value.filter((event) => event.name === "Paint" || event.name.startsWith(prefix)));
  });
  await cdp.send("Tracing.start", { categories: "devtools.timeline,blink.user_timing", transferMode: "ReportEvents" });
  await worker.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, func: () => {
    if (globalThis.captionPaintTraceInstalled) return;
    globalThis.captionPaintTraceInstalled = true;
    // Registered after the built content sink, so synchronous rendering has finished.
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (sender.id !== chrome.runtime.id || message.target !== "captions") return;
      const caption = message.caption;
      const shadow = document.querySelector("#interpreter-captions")?.shadowRoot;
      const element = [...(shadow?.querySelectorAll(".sentence") ?? [])].find((node) => node.dataset.utteranceId === caption?.utteranceId);
      const box = element?.getBoundingClientRect();
      const text = element?.textContent ?? "";
      const visible = !!box && !!text && caption?.translation.startsWith(text);
      performance.mark(`interpreter-caption:${JSON.stringify({
        sessionId: caption?.sessionId ?? message.sessionId, utteranceId: caption?.utteranceId ?? null,
        revision: caption?.revision ?? null, final: caption?.final ?? null,
        audioEndMs: caption?.audioEndMs ?? null, type: message.type,
        atMs: performance.timeOrigin + performance.now(), visible,
        left: box?.left ?? 0, right: box?.right ?? 0, top: box?.top ?? 0, bottom: box?.bottom ?? 0,
      })}`);
    });
  } }), tabId);
  return async () => {
    const finished = new Promise((ready) => cdp.once("Tracing.tracingComplete", ready));
    await cdp.send("Tracing.end");
    await finished;
    await cdp.detach();
    const rows = captionPaints(events, frameTree.frame.id);
    assert.ok(rows.some((row) => row.revision !== null), "No caption revision trace marks");
    return rows;
  };
}
