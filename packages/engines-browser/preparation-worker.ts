import { loadAsrPipeline } from "./asr-loader";
import { preparationModel } from "./model";
import { createModelRepository } from "./model-repository";

const repository = createModelRepository(loadAsrPipeline);
let busy = false;
globalThis.onmessage = async (event: MessageEvent<unknown>) => {
  const command = event.data;
  if (!command || typeof command !== "object" || !("version" in command) || command.version !== 1
    || !("requestId" in command) || !Number.isSafeInteger(command.requestId)
    || !("type" in command) || typeof command.type !== "string" || !["status", "prepare", "evict"].includes(command.type)) return;
  const send = (status: Awaited<ReturnType<typeof repository.status>>, done: boolean) => {
    globalThis.postMessage({ version: 1, requestId: command.requestId, status, done });
  };
  if (busy) return;
  busy = true;
  try {
    if (command.type === "prepare") {
      let last = await repository.status(preparationModel);
      for await (const status of repository.prepare(preparationModel)) { last = status; send(status, false); }
      send(last, true);
    } else {
      if (command.type === "evict") await repository.evict(preparationModel);
      send(await repository.status(preparationModel), true);
    }
  } catch {
    globalThis.postMessage({ version: 1, requestId: command.requestId, error: "Model operation failed", done: true });
  } finally { busy = false; }
};
