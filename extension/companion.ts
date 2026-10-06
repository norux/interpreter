const hostName = "com.norux.interpreter";

export function createCompanionConnection(disconnected: (message: string) => void) {
  let port: chrome.runtime.Port | undefined;
  let starting: AbortController | undefined;
  let stopping = Promise.resolve();

  function cancelStart() { starting?.abort(); }

  function stop() {
    cancelStart();
    starting = undefined;
    const previous = port;
    port = undefined;
    if (!previous) return stopping;
    stopping = new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(timeout); previous.disconnect(); resolve(); };
      const timeout = setTimeout(finish, 12000);
      previous.onMessage.addListener((message) => { if (message.type === "stopped") finish(); });
      previous.onDisconnect.addListener(() => { clearTimeout(timeout); resolve(); });
      try { previous.postMessage({ type: "stop" }); }
      catch { finish(); }
    });
    return stopping;
  }

  async function start(localTranslation: boolean) {
    await stop();
    const controller = new AbortController();
    starting = controller;
    // Keep the existing terminal-driven workflow available for development.
    try {
      const response = await fetch("http://127.0.0.1:8765/health", {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1000)]),
      });
      if (response.ok) { starting = undefined; return; }
    } catch {
      if (controller.signal.aborted) throw new Error("Companion startup cancelled.");
    }
    if (controller.signal.aborted) throw new Error("Companion startup cancelled.");
    await new Promise<void>((resolve, reject) => {
      const connection = chrome.runtime.connectNative(hostName);
      port = connection;
      let ready = false;
      const timeout = setTimeout(() => reject(new Error("Companion startup timed out. Open Interpreter Companion and check model preparation.")), 30000);
      const aborted = () => { clearTimeout(timeout); reject(new Error("Companion startup cancelled.")); };
      controller.signal.addEventListener("abort", aborted, { once: true });
      const finish = () => { clearTimeout(timeout); controller.signal.removeEventListener("abort", aborted); };
      connection.onMessage.addListener((message) => {
        if (connection !== port) return;
        if (message.type === "ready") {
          ready = true;
          starting = undefined;
          finish();
          resolve();
        } else if (message.type === "error") {
          finish();
          reject(new Error(message.message));
        }
      });
      connection.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError?.message;
        if (connection !== port) return;
        port = undefined;
        finish();
        if (ready) disconnected("Interpreter Companion closed. Start again to reconnect.");
        else reject(Object.assign(new Error(error?.includes("not found")
          ? "Install Interpreter Companion, open it once and prepare the models."
          : error ?? "Interpreter Companion could not start. Open the app and try again."), { installRequired: error?.includes("not found") ?? false }));
      });
      connection.postMessage({ type: "start", localTranslation });
    });
  }

  return { start, stop, cancelStart };
}
