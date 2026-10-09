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
  host.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;align-items:end;box-sizing:border-box";
  const shadow = host.attachShadow({ mode: "open" });
  const container = document.createElement("div");
  container.style.width = "100%";
  const view = createComparisonView(container, video ? "video" : "capture"); view.activate(identity);
  const style = document.createElement("style");
  style.textContent = `table, p { display:none }
    .interpreter-live { width:min(84%,760px); box-sizing:border-box; margin:0 auto; padding:6px 18px;
      color:white; text-align:center; min-height:0; font:600 clamp(16px,2vw,26px)/1.65 system-ui,sans-serif;
      word-break:keep-all; text-shadow:0 1px 3px rgba(0,0,0,.8); }
    .interpreter-live > span:first-child { padding:4px 10px; border-radius:8px; background:rgba(18,20,26,.78);
      -webkit-box-decoration-break:clone; box-decoration-break:clone; }
    .interpreter-measure { left:28px; right:28px; }
    .interpreter-live:has(span:first-child:empty) { visibility:hidden }`;
  // Override only this shadow's appearance; companion settings are not read or written.
  container.append(style); shadow.append(container);
  const policy = createPresentationPolicy(identity, { now: () => window.performance.now(), schedule(callback, delay) {
    const id = window.setTimeout(callback, delay); return () => window.clearTimeout(id);
  } }, view.present);
  const unsubscribe = view.onDisplayProgress(policy.progress);
  let disposed = false;
  function position() {
    if (disposed) return;
    const fullscreen = document.fullscreenElement;
    if (!video) {
      const parent = fullscreen && !(fullscreen instanceof window.HTMLMediaElement) ? fullscreen : document.documentElement;
      if (host.parentElement !== parent) parent.append(host);
      host.style.display = fullscreen instanceof window.HTMLMediaElement ? "none" : "flex";
      host.style.left = "0"; host.style.top = "0"; host.style.width = "100%"; host.style.height = "100%";
      host.style.paddingBottom = `${Math.max(64, window.innerHeight * 0.14)}px`;
      return;
    }
    const parent = fullscreen && fullscreen !== video && fullscreen.contains(video) ? fullscreen : document.documentElement;
    if (host.parentElement !== parent) parent.append(host);
    const rect = video.getBoundingClientRect();
    // A video's native fullscreen surface cannot contain injected DOM. Keep the
    // comparison host available instead of claiming this overlay is visible.
    host.style.display = !video.isConnected || rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth || (fullscreen !== null && (fullscreen === video || !fullscreen.contains(video))) ? "none" : "flex";
    host.style.left = `${rect.left}px`; host.style.top = `${rect.top}px`; host.style.width = `${rect.width}px`; host.style.height = `${rect.height}px`;
    host.style.paddingBottom = `${Math.min(96, Math.max(64, rect.height * 0.18))}px`;
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
