import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";

const dist = new URL("../extension/dist/", import.meta.url);

test("MV3 build contains its declared pages and reserved capture/sink entries", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", dist), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, "116");
  assert.equal(manifest.background.type, "module");
  for (const permission of ["tabCapture", "offscreen", "activeTab", "scripting", "nativeMessaging", "downloads"]) {
    assert.ok(manifest.permissions.includes(permission));
  }
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    "offscreen.html",
    "offscreen.js",
    "transcript.html",
    "transcript.js",
    "content.js",
    "worklet.js",
  ]) {
    assert.ok((await stat(new URL(file, dist))).isFile(), `Missing build entry: ${file}`);
  }
  for (const page of [manifest.action.default_popup, "offscreen.html", "transcript.html"]) {
    const html = await readFile(new URL(page, dist), "utf8");
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)];
    assert.ok(scripts.length > 0, `No bundled script in ${page}`);
    if (page === "offscreen.html") {
      assert.ok(scripts.some((script) => script[1] === "./offscreen.js"));
    }
    for (const script of scripts) {
      assert.ok((await stat(new URL(script[1], new URL(page, dist)))).isFile());
    }
    assert.ok(!html.includes(".ts\""), `${page} references uncompiled TypeScript`);
  }
});
