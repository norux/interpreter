import assert from "node:assert/strict";
import { test } from "node:test";
import type { Caption, OutputSink } from "../extension/captions/contracts";
import { createCaptionOutput } from "../extension/captions/output";

test("outputs receive the same caption/status/clear and reject replaced or disposed sessions", () => {
  const memories = [[], []] as unknown[][];
  const sinks: OutputSink[] = memories.map((events) => ({
    caption: (caption) => events.push(caption), status: (message) => events.push(message),
    clear: () => events.push("clear"), dispose: () => events.push("dispose"),
  }));
  const output = createCaptionOutput("new", sinks);
  const caption: Caption = { sessionId: "new", utteranceId: "u1", revision: 1, source: "Generated",
    translation: "생성한 시험", final: true, audioStartMs: 0, audioEndMs: 1, emittedAtMs: 2 };
  output.event({ type: "caption", caption: { ...caption, sessionId: "old" } });
  output.event({ type: "caption", caption });
  output.event({ type: "status", sessionId: "new", message: "Listening" });
  output.event({ type: "clear", sessionId: "old" });
  output.event({ type: "clear", sessionId: "new" });
  output.dispose();
  output.dispose();
  output.event({ type: "caption", caption });
  for (const memory of memories) {
    assert.deepEqual(memory, [caption, "Listening", "clear", "dispose"]);
    assert.equal(memory[0], caption, "Fan-out must preserve the same event data");
  }
});
