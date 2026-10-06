import type { MediaCandidate, MediaCatalog, MediaTarget, MediaTargetId } from "../contracts";

// One adapter per permitted frame. Elements and resource URLs stay in this owner.
export function createMediaCatalog(document: Document, frameId: string) {
  const view = document.defaultView;
  if (!view) throw new Error("Media catalog requires a live document");
  const window = view;
  let documentId = window.crypto.randomUUID();
  let location = window.location.href;
  let disposed = false;
  const records = new Map<HTMLVideoElement, { target: MediaTarget; source: string; stream: HTMLVideoElement["srcObject"] }>();
  const listeners = new Set<() => void>();

  function source(video: HTMLVideoElement) {
    return JSON.stringify([video.getAttribute("src"), video.currentSrc,
      Array.from(video.querySelectorAll("source"), (node) => [node.src, node.type])]);
  }

  function changed() {
    for (const listener of listeners) listener();
  }

  function invalidateDocument() {
    documentId = window.crypto.randomUUID();
    location = window.location.href;
    records.clear();
    changed();
  }

  function synchronize() {
    if (disposed) return;
    // A host can resolve within the same task as a DOM replacement, before delivery.
    const mediaChanged = applyMutations(observer.takeRecords());
    if (location !== window.location.href) invalidateDocument();
    for (const [video, record] of records) {
      if (!video.isConnected || video.ownerDocument !== document || source(video) !== record.source || video.srcObject !== record.stream) {
        records.delete(video);
      }
    }
    if (mediaChanged) changed();
  }

  function playback(event: Event) {
    if (!(event.target instanceof window.HTMLVideoElement)) return;
    if (event.type === "loadstart" || event.type === "emptied") {
      records.delete(event.target as HTMLVideoElement);
    }
    synchronize();
    changed();
  }

  function applyMutations(mutations: MutationRecord[]) {
    let mediaChanged = false;
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        if (mutation.target instanceof window.HTMLVideoElement) {
          records.delete(mutation.target);
          mediaChanged = true;
        } else if (mutation.target instanceof window.HTMLSourceElement) {
          const video = mutation.target.closest("video");
          if (video) records.delete(video);
          mediaChanged = true;
        }
      } else {
        for (const node of [...mutation.removedNodes, ...mutation.addedNodes]) {
          if (!(node instanceof window.Element)) continue;
          const videos = [...node.querySelectorAll("video")];
          if (node instanceof window.HTMLVideoElement) videos.push(node);
          // A removal and reinsertion in the same task still retires the old handle.
          if (Array.from(mutation.removedNodes).includes(node)) {
            for (const video of videos) records.delete(video);
          }
          if (node.matches("source") || node.querySelector("source")) {
            const owner = mutation.target instanceof window.Element ? mutation.target.closest("video") : null;
            if (owner) records.delete(owner);
            mediaChanged = true;
          }
          if (videos.length) mediaChanged = true;
        }
      }
    }
    return mediaChanged;
  }
  const observer = new window.MutationObserver((mutations) => {
    if (applyMutations(mutations)) {
      synchronize();
      changed();
    }
  });
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "type"] });
  const events = ["play", "pause", "ended", "loadstart", "emptied", "loadedmetadata"];
  for (const event of events) document.addEventListener(event, playback, true);
  window.addEventListener("popstate", invalidateDocument);
  window.addEventListener("hashchange", invalidateDocument);
  window.addEventListener("pagehide", dispose);
  // pushState/replaceState do not emit popstate; observe URLs without replacing site APIs.
  const navigationCheck = window.setInterval(() => {
    if (location !== window.location.href) invalidateDocument();
  }, 250);

  function resolve(target: MediaTarget): HTMLVideoElement | undefined {
    synchronize();
    if (disposed || target.documentId !== documentId || target.frameId !== frameId) return;
    for (const [video, record] of records) {
      if (record.target.id === target.id) return video;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    records.clear();
    observer.disconnect();
    window.clearInterval(navigationCheck);
    for (const event of events) document.removeEventListener(event, playback, true);
    window.removeEventListener("popstate", invalidateDocument);
    window.removeEventListener("hashchange", invalidateDocument);
    window.removeEventListener("pagehide", dispose);
    changed();
    listeners.clear();
  }

  const catalog = {
    frameId,
    async discover(): Promise<readonly MediaCandidate[]> {
      synchronize();
      if (disposed) return [];
      return Array.from(document.querySelectorAll("video"), (video, index) => {
        let record = records.get(video);
        if (!record) {
          record = { target: { id: window.crypto.randomUUID() as MediaTargetId, documentId, frameId }, source: source(video), stream: video.srcObject };
          records.set(video, record);
        }
        const rect = video.getBoundingClientRect();
        const style = window.getComputedStyle(video);
        return {
          target: record.target,
          label: video.getAttribute("aria-label") || video.title || `Video ${index + 1}`,
          visible: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
            && rect.top < window.innerHeight && rect.left < window.innerWidth
            && style.display !== "none" && style.visibility === "visible" && Number(style.opacity) > 0,
          playing: !video.paused && !video.ended,
          width: rect.width,
          height: rect.height,
        };
      });
    },
    async isCurrent(target: MediaTarget) { return resolve(target) !== undefined; },
    resolve,
    // Hosts call this for same-URL router transitions, which have no DOM navigation event.
    invalidateDocument,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose,
  } satisfies MediaCatalog & {
    frameId: string;
    resolve(target: MediaTarget): HTMLVideoElement | undefined;
    invalidateDocument(): void;
    subscribe(listener: () => void): () => void;
    dispose(): void;
  };
  return catalog;
}
