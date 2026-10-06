import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Test-only JavaScript CDP harness has no public TypeScript API.
import { captionPaints } from "./caption-paint.mjs";

test("caption paint evidence requires the same frame, visible bounds and unsuperseded revision", () => {
  const mark = (ts: number, revision: number, visible = true) => ({
    name: `interpreter-caption:${JSON.stringify({ revision, visible, atMs: 1000 + ts / 1000,
      left: 100, right: 300, top: 500, bottom: 550 })}`, ts,
  });
  const paint = (ts: number, frame = "main", clip = [0, 0, 800, 0, 800, 600, 0, 600]) => ({
    name: "Paint", ts, args: { data: { frame, clip } },
  });
  const rows = captionPaints([
    mark(0, 1), paint(10, "other"), paint(20, "main", [0, 0, 80, 0, 80, 60, 0, 60]),
    mark(30, 2), paint(35), mark(40, 3, false), paint(45), mark(50, 4), paint(60),
  ], "main");
  assert.equal(rows[0].paintAtMs, null, "Superseded first revision cannot borrow the next revision's paint");
  assert.equal(rows[1].markToPaintMs, .005);
  assert.equal(rows[1].paintAtMs, 1000.035);
  assert.equal(rows[2].paintAtMs, null, "Hidden caption cannot count as painted");
  assert.equal(rows[3].paintAtMs, 1000.06);
});

test("coexisting sentences can share a covering paint without borrowing a newer own revision", () => {
  const mark = (ts: number, utteranceId: string, revision: number) => ({
    name: `interpreter-caption:${JSON.stringify({ sessionId: "rolling", utteranceId, revision,
      visible: true, atMs: 1000 + ts / 1000, left: 100, right: 300, top: 500, bottom: 550 })}`, ts,
  });
  const paint = (ts: number) => ({ name: "Paint", ts,
    args: { data: { frame: "main", clip: [0, 0, 800, 0, 800, 600, 0, 600] } } });
  const rows = captionPaints([mark(0, "one", 1), mark(5, "two", 1), paint(10),
    mark(20, "one", 2), mark(25, "two", 2), mark(30, "one", 3), paint(35)], "main");
  assert.equal(rows[0].paintAtMs, 1000.01);
  assert.equal(rows[1].paintAtMs, 1000.01);
  assert.equal(rows[2].paintAtMs, null);
  assert.equal(rows[3].paintAtMs, 1000.035);
  assert.equal(rows[4].paintAtMs, 1000.035);
});
