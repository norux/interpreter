import assert from "node:assert/strict";

// Decoded local synthetic media, production input and independent tab-output PCM.
export async function verifyVideoAccess(browser, origin, encodedBytes) {
  const observations = [];
  for (const kind of ["cors", "denied", "allow-without-mode", "late-mode", "redirect", "silence", "muted", "blob", "mse", "protected"]) {
    const page = await browser.newPage(); page.setDefaultTimeout(10000);
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`${origin}/access?kind=${kind}`);
      await page.waitForFunction(() => globalThis.ready || globalThis.setupError);
      assert.equal(await page.evaluate(() => globalThis.setupError), undefined, `Required ${kind} fixture must load`);
      await page.getByRole("button", { name: "Play and observe output", exact: true }).click();
      await page.waitForFunction(() => globalThis.outputReady || globalThis.outputError);
      assert.equal(await page.evaluate(() => globalThis.outputError), undefined);
      const settings = await page.evaluate(() => globalThis.outputSettings);
      for (const key of ["autoGainControl", "echoCancellation", "noiseSuppression", "suppressLocalAudioPlayback"]) assert.equal(settings[key], false);
      const baseline = await page.evaluate(() => globalThis.measureOutput());
      const quiet = kind === "silence" || kind === "muted";
      if (quiet) assert.ok(baseline < 0.001, `${kind} must have quiet original output: ${baseline}`);
      else assert.ok(Math.abs(baseline / (0.15 * 0.4 / Math.sqrt(2)) - 1) < 0.12, `Real ${kind} original output: ${baseline}`);
      const before = await page.evaluate(() => globalThis.state());
      const initialTime = await page.evaluate(() => video.currentTime);
      const probe = await page.evaluate(() => globalThis.probe());
      const eligible = ["cors", "late-mode", "redirect", "silence", "muted"].includes(kind);
      if (eligible) assert.equal(probe.state, "available", JSON.stringify({ kind, probe }));
      else assert.equal(probe.reason, ["blob", "mse"].includes(kind) ? "media-route-unknown" : kind === "protected" ? "protected-media" : "media-access-denied");
      await page.getByRole("button", { name: "Start selected capture", exact: true }).click();
      const supported = ["cors", "silence", "muted"].includes(kind);
      await page.waitForFunction(() => globalThis.chunks.length >= 5 || globalThis.captureError);
      const failure = await page.evaluate(() => globalThis.captureError);
      if (supported) {
        assert.equal(failure, undefined, kind);
        const chunks = await page.evaluate(() => globalThis.chunks);
        assert.ok(chunks.length >= 5); assert.equal(chunks[0].sequence, 0);
        assert.ok(chunks.every((chunk) => chunk.bytes === 8192 && chunk.scope === "selected-video"));
        if (kind === "silence") assert.ok(chunks.every((chunk) => chunk.peak < 0.001), "Encoded genuine silence stays available with real zero PCM");
        else assert.ok(chunks.some((chunk) => chunk.peak > 0.12 && chunk.peak < 0.18), "CORS and muted media supply actual selected-tone PCM");
      } else {
        const reason = ["blob", "mse"].includes(kind) ? "media-route-unknown" : kind === "protected" ? "protected-media" : "media-access-denied";
        assert.ok(failure?.startsWith(`${reason}:`), JSON.stringify({ kind, failure }));
        assert.equal(await page.evaluate(() => globalThis.chunks.length), 0, "Rejected access must never fabricate PCM");
        assert.equal(await page.evaluate(() => globalThis.opened), undefined);
      }
      const during = await page.evaluate(() => globalThis.measureOutput());
      await page.getByRole("button", { name: "Stop selected capture", exact: true }).click();
      if (supported) await page.waitForFunction(() => globalThis.captureClosed);
      const count = await page.evaluate(() => globalThis.chunks.length);
      const after = await page.evaluate(() => globalThis.measureOutput());
      assert.equal(await page.evaluate(() => globalThis.chunks.length), count);
      for (const rms of [during, after]) {
        if (quiet) assert.ok(rms < 0.001);
        else assert.ok(Math.abs(rms / baseline - 1) < 0.12, `Original playback preserved for ${kind}: ${JSON.stringify({ baseline, rms })}`);
      }
      assert.deepEqual(await page.evaluate(() => globalThis.state()), before, "Probe/Start/Stop must preserve src, CORS, volume, mute, rate and reload count");
      assert.ok(await page.evaluate((initialTime) => video.currentTime > initialTime + 0.4, initialTime), "Playback must keep advancing after rejection or Stop");
      const chunks = await page.evaluate(() => globalThis.chunks);
      let frameEvidence;
      if (kind === "cors") {
        const navigated = page.waitForEvent("framenavigated", { predicate: (frame) => frame.url().includes("kind=frame") });
        await page.evaluate(() => {
          video.pause();
          const frame = document.createElement("iframe"); frame.src = `http://localhost:${location.port}/access?kind=frame`;
          document.body.append(frame);
        });
        const frame = await navigated;
        await frame.waitForFunction(() => globalThis.ready || globalThis.setupError);
        assert.equal(await frame.evaluate(() => globalThis.setupError), undefined);
        const target = await frame.evaluate(() => globalThis.target);
        const foreign = await page.evaluate((target) => globalThis.foreignProbe(target), target);
        assert.equal(foreign.state, "permission-required"); assert.equal(foreign.reason, "frame-permission-required");
        assert.equal(await page.evaluate(() => {
          try { return document.querySelector("iframe").contentWindow.document ? "accessible" : "missing"; }
          catch (error) { return error.name; }
        }), "SecurityError", "Native cross-origin DOM access remains blocked");
        const candidates = await page.evaluate(() => globalThis.frameCandidates());
        assert.equal(candidates.length, 1, "Parent catalog must not traverse the foreign frame");
        await frame.evaluate(() => { video.volume = 0.4; return video.play(); });
        await frame.getByRole("button", { name: "Start selected capture", exact: true }).click();
        await frame.waitForFunction(() => globalThis.chunks.length >= 5 || globalThis.captureError);
        assert.equal(await frame.evaluate(() => globalThis.captureError), undefined);
        const frameChunks = await frame.evaluate(() => globalThis.chunks);
        assert.ok(frameChunks.some((chunk) => chunk.peak > 0.12 && chunk.peak < 0.18));
        await frame.getByRole("button", { name: "Stop selected capture", exact: true }).click();
        await frame.waitForFunction(() => globalThis.captureClosed);
        const output = await page.evaluate(() => globalThis.measureOutput());
        assert.ok(Math.abs(output / baseline - 1) < 0.12, "Permitted frame's original output survives its own input Stop");
        frameEvidence = { foreign, nativeParentAccess: "SecurityError", ownAdapterChunks: frameChunks.length, afterOutputRms: output };
      }
      assert.deepEqual(errors, []);
      observations.push({ kind, probe, failure, chunks: chunks.length, peak: Math.max(0, ...chunks.map((chunk) => chunk.peak)),
        baselineOutputRms: baseline, duringOutputRms: during, afterOutputRms: after, statePreserved: true, frameEvidence, pageErrors: errors });
    } catch (error) {
      console.error(JSON.stringify({ kind, pageErrors: errors, state: await page.evaluate(() => ({ setupError: globalThis.setupError,
        outputError: globalThis.outputError, captureError: globalThis.captureError, media: globalThis.state?.(), chunks: globalThis.chunks })) }));
      throw error;
    } finally { await page.close(); }
  }
  console.log(JSON.stringify({ passed: true, scope: "V4 real media access matrix and original playback preservation", browser: browser.version(),
    encodedBytes, observations, protectedScope: "Real Clear Key MediaKeys attachment; encrypted payload/decryption is unverified and unsupported",
    iframeScope: "Explicitly owned local cross-origin frame adapter; extension permission installation is unverified",
    asrAccuracy: "unverified", physicalSpeakerAudibility: "unverified", remainingAcceptance: ["V5 speech/two-audible-video fixtures"] }));
}
