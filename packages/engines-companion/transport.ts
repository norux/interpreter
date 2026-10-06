import type { CompanionTransport } from "./engine";

export function createCompanionTransport(sessionId: string, token: string, signal: AbortSignal): CompanionTransport {
  let connection: WebSocket | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  let rejectPreparation: ((error: Error) => void) | undefined;
  return {
    prepare(receive) {
      if (closed || connection || signal.aborted) return Promise.reject(new Error("Capture stopped during preparation."));
      const socket = new WebSocket("ws://127.0.0.1:8765/audio");
      connection = socket;
      return new Promise<void>((resolve, reject) => {
        let ready = false;
        const cleanup = () => { clearTimeout(timeout); signal.removeEventListener("abort", aborted); rejectPreparation = undefined; };
        const rejected = (error: Error) => { cleanup(); reject(error); };
        const aborted = () => rejected(new Error("Capture stopped during preparation."));
        const timeout = setTimeout(() => rejected(new Error("Companion model preparation timed out. Check the models, then Start again.")), 65000);
        rejectPreparation = rejected;
        signal.addEventListener("abort", aborted, { once: true });
        const failed = (message: string) => {
          if (closed) return;
          if (!ready) rejected(new Error(message));
          else receive({ type: "error", sessionId, message });
        };
        socket.onopen = () => { if (!closed) socket.send(JSON.stringify({ sessionId, token })); };
        socket.onerror = () => failed("Companion connection failed. Start again to reconnect.");
        socket.onclose = () => failed("Companion disconnected. Start again to reconnect.");
        socket.onmessage = (event) => {
          if (closed) return;
          let reply: { type?: unknown; sessionId?: unknown; message?: unknown };
          try {
            if (typeof event.data !== "string" || event.data.length > 1048576) throw new Error("Invalid companion message.");
            reply = JSON.parse(event.data);
            if (!reply || typeof reply !== "object") throw new Error("Invalid companion message.");
          } catch { failed("Invalid companion message. Start again to reconnect."); return; }
          if (!ready) {
            if (reply.type === "ready" && reply.sessionId === sessionId) { ready = true; cleanup(); resolve(); }
            else rejected(new Error(reply.type === "error" && reply.sessionId === sessionId && typeof reply.message === "string"
              ? reply.message : "Companion did not accept the audio session."));
          } else receive(reply);
        };
      });
    },
    send(packet) {
      const socket = connection;
      if (closed || !socket || socket.readyState !== WebSocket.OPEN) throw new Error("Companion disconnected. Start again to reconnect.");
      // Retain the existing one-second transport-buffer budget.
      if (socket.bufferedAmount + packet.byteLength > 50 * packet.byteLength) throw new Error("Companion is too slow. Capture stopped to avoid an audio backlog.");
      socket.send(packet);
    },
    async close() {
      closed = true;
      rejectPreparation?.(new Error("Capture stopped during preparation."));
      if (!closing) {
        const socket = connection;
        if (socket) { socket.onmessage = null; socket.onopen = null; socket.onerror = null; socket.onclose = null; }
        closing = socket && socket.readyState !== WebSocket.CLOSED ? new Promise<void>((resolve) => {
          const done = () => { clearTimeout(timeout); socket.onclose = null; resolve(); };
          const timeout = setTimeout(done, 1000);
          socket.onclose = done;
          socket.close(1000, "Capture stopped");
        }) : Promise.resolve();
      }
      await closing;
    },
  };
}
