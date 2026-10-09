import type { CaptionRevision, MediaTarget, SessionIdentity } from "../../packages/contracts";
import { sameIdentity } from "../../packages/core/identity";
import { createPresentationPolicy } from "../../packages/core/presentation-policy";
import { createComparisonView } from "../../packages/presentation-web/comparison";

// Each surface measures its own lines; the shared policy supplies cadence,
// revision acceptance, reading order and expiry in that document's clock.
export function createVideoOverlay(document: Document, video: HTMLVideoElement | null, identity: SessionIdentity) {
  const viewWindow = document.defaultView;
  if (!viewWindow) throw new Error("Overlay requires a live video document");
  const window = viewWindow;
  const host = document.createElement("div"); host.dataset.interpreterOverlay = "";
  host.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;align-items:end;box-sizing:border-box;margin:0;border:0;padding:0;background:transparent;overflow:visible";
  const shadow = host.attachShadow({ mode: "open" });
  const container = document.createElement("div");
  container.style.width = "100%";
  const view = createComparisonView(container, video ? "video" : "capture"); view.activate(identity);
  const style = document.createElement("style");
  style.textContent = `:host::backdrop { background:transparent; pointer-events:none }
    table, p { display:none }
    .interpreter-stack { width:min(84%,760px); margin:0 auto; }
    .interpreter-live { width:100%; box-sizing:border-box; margin:0 auto; padding:6px 18px;
      color:white; text-align:center; min-height:0; font:600 clamp(16px,2vw,26px)/1.65 system-ui,sans-serif;
      word-break:keep-all; text-shadow:0 1px 3px rgba(0,0,0,.8); }
    .interpreter-live > span:not(.interpreter-measure) { padding:4px 10px; border-radius:8px; background:var(--interpreter-background,rgba(18,20,26,.78));
      -webkit-box-decoration-break:clone; box-decoration-break:clone; }
    .interpreter-live[data-speaker-id="1"] { --interpreter-background:rgba(24,48,80,.9) }
    .interpreter-live[data-speaker-id="2"] { --interpreter-background:rgba(80,38,64,.9) }
    .interpreter-live[data-speaker-id="3"] { --interpreter-background:rgba(40,68,46,.9) }
    .interpreter-live[data-speaker-id="4"] { --interpreter-background:rgba(86,58,22,.9) }
    .interpreter-live[data-speaker-id="5"] { --interpreter-background:rgba(60,40,88,.9) }
    .interpreter-live[data-speaker-id="6"] { --interpreter-background:rgba(22,68,68,.9) }
    .interpreter-live[data-speaker-id="7"] { --interpreter-background:rgba(86,40,28,.9) }
    .interpreter-live[data-speaker-id="8"] { --interpreter-background:rgba(56,62,82,.9) }
    .interpreter-measure { left:28px; right:28px; }
    .interpreter-live:has(span:not(.interpreter-measure):empty) { visibility:hidden }`;
  // Keep caption styling inside the page overlay shadow.
  container.append(style); shadow.append(container);
  const policy = createPresentationPolicy(identity, { now: () => window.performance.now(), schedule(callback, delay) {
    const id = window.setTimeout(callback, delay); return () => window.clearTimeout(id);
  } }, view.present, 180);
  const unsubscribe = view.onDisplayProgress(policy.progress);
  let disposed = false;
  function position() {
    if (disposed) return;
    const fullscreen = document.fullscreenElement;
    if (host.parentElement !== document.documentElement) document.documentElement.append(host);
    const popover = fullscreen ? "manual" : null;
    if (host.popover !== popover) host.popover = popover;
    if (!video) {
      host.style.display = "flex";
      host.style.left = "0"; host.style.top = "0"; host.style.width = "100%"; host.style.height = "100%";
      const bottom = Math.max(64, window.innerHeight * 0.14);
      host.style.paddingBottom = `${bottom}px`;
      container.style.setProperty("--interpreter-stack-height", `${Math.max(0, window.innerHeight - bottom - 16)}px`);
    } else {
      const rect = video.getBoundingClientRect();
      host.style.display = !video.isConnected || rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth || (fullscreen !== null && fullscreen !== video && !fullscreen.contains(video)) ? "none" : "flex";
      host.style.left = `${rect.left}px`; host.style.top = `${rect.top}px`; host.style.width = `${rect.width}px`; host.style.height = `${rect.height}px`;
      const bottom = Math.min(96, Math.max(64, rect.height * 0.18));
      host.style.paddingBottom = `${bottom}px`;
      container.style.setProperty("--interpreter-stack-height", `${Math.max(0, rect.height - bottom - 16)}px`);
    }
    // Fullscreen video/iframe surfaces cover ordinary page DOM regardless of
    // z-index. A manual popover paints above them without taking input focus.
    if (fullscreen && host.style.display !== "none" && !host.matches(":popover-open")) host.showPopover();
  }
  const resize = new window.ResizeObserver(position); if (video) resize.observe(video);
  window.addEventListener("scroll", position, true); window.addEventListener("resize", position);
  document.addEventListener("fullscreenchange", position); position();
  return {
    compare(caption: CaptionRevision) {
      if (disposed || !sameIdentity(identity, caption.source.identity)) return;
      position();
      policy.accept(caption.translation.state === "pending" ? { type: "transcript", revision: caption.source }
        : { type: "paired-caption", caption }, caption.videoRange);
    },
    clear() { policy.clear(); },
    dispose() {
      if (disposed) return; disposed = true;
      resize.disconnect(); unsubscribe(); policy.dispose(); view.dispose(); host.remove();
      window.removeEventListener("scroll", position, true); window.removeEventListener("resize", position);
      document.removeEventListener("fullscreenchange", position);
    },
  };
}

export interface SelectedVideoOutput {
  activate(target: MediaTarget, identity: SessionIdentity): void;
  compare(caption: CaptionRevision): void;
  clear(identity: SessionIdentity): void;
}
