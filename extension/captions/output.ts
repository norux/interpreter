import type { OutputSink, SessionEvent } from "./contracts";

export function createCaptionOutput(sessionId: string, sinks: OutputSink[]) {
  let disposed = false;
  return {
    event(event: SessionEvent) {
      if (disposed || (event.type === "caption" ? event.caption.sessionId : event.sessionId) !== sessionId) return;
      for (const sink of sinks) {
        if (event.type === "caption") sink.caption(event.caption);
        else if (event.type === "clear") sink.clear();
        else sink.status(event.message);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const sink of sinks) sink.dispose();
    },
  };
}
