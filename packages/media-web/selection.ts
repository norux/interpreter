import type { MediaCandidate, MediaTarget } from "../contracts";
import type { createMediaCatalog } from "./catalog";

export function mountVideoSelection(
  container: HTMLElement,
  catalog: ReturnType<typeof createMediaCatalog>,
  onSelection: (target: MediaTarget | null) => void,
) {
  const document = container.ownerDocument;
  const panel = document.createElement("section");
  panel.setAttribute("aria-label", "Video selection");
  const label = document.createElement("label");
  label.textContent = "Video to interpret ";
  const select = document.createElement("select");
  label.append(select);
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.textContent = "Use selected video";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const frameNotice = document.createElement("p");
  frameNotice.textContent = "Videos in other frames require selection in their permitted frame.";
  panel.append(label, confirm, status, frameNotice);
  container.append(panel);
  let candidates: readonly MediaCandidate[] = [];
  let selected: MediaTarget | null = null;
  let initialized = false;
  let disposed = false;
  let revision = 0;

  async function refresh() {
    const request = ++revision;
    const next = await catalog.discover();
    if (disposed || request !== revision) return;
    const pending = select.value;
    candidates = next;
    if (selected && !catalog.resolve(selected)) {
      selected = null;
      status.textContent = "Selected video changed or disappeared. Choose and confirm again.";
      onSelection(null);
    }
    select.replaceChildren();
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Choose a video";
    select.append(empty);
    for (const candidate of candidates) {
      const option = document.createElement("option");
      option.value = candidate.target.id;
      option.textContent = `${candidate.label} · ${Math.round(candidate.width)}×${Math.round(candidate.height)} · ${candidate.playing ? "playing" : "paused"}${candidate.visible ? "" : " · offscreen"}`;
      select.append(option);
    }
    if (!initialized) {
      const suggested = candidates.filter((candidate) => candidate.visible).sort((a, b) =>
        Number(b.playing) - Number(a.playing) || b.width * b.height - a.width * a.height)[0];
      select.value = suggested?.target.id || "";
      status.textContent = candidates.length ? "Confirm a video before starting." : "No videos in this frame.";
      initialized = true;
    } else {
      select.value = candidates.some((candidate) => candidate.target.id === pending) ? pending : "";
    }
    confirm.disabled = !select.value;
  }

  function choose() { confirm.disabled = !select.value; }
  function confirmSelection() {
    const candidate = candidates.find((candidate) => candidate.target.id === select.value);
    if (!candidate || !catalog.resolve(candidate.target)) {
      void refresh();
      return;
    }
    selected = candidate.target;
    status.textContent = `Selected: ${candidate.label}`;
    onSelection(selected);
  }
  select.addEventListener("change", choose);
  confirm.addEventListener("click", confirmSelection);
  const unsubscribe = catalog.subscribe(() => { void refresh(); });
  const ready = refresh();
  return {
    ready,
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      revision++;
      unsubscribe();
      select.removeEventListener("change", choose);
      confirm.removeEventListener("click", confirmSelection);
      panel.remove();
      if (selected) onSelection(null);
      selected = null;
    },
  };
}
