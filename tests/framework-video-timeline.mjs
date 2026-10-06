import assert from "node:assert/strict";

// Real encoded media and input/core composition; generated engine events are not ASR.
export async function verifyVideoTimeline(browser, origin) {
  const observations = [];
  for (const owned of [false, true]) {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`${origin}/timeline?owned=${owned}`);
      await page.waitForFunction(() => globalThis.ready);
      await page.getByRole("button", { name: "Play and observe output" }).click();
      await page.waitForFunction(() => globalThis.outputReady || globalThis.outputError);
      assert.equal(await page.evaluate(() => globalThis.outputError), undefined);
      const settings = await page.evaluate(() => globalThis.outputSettings);
      for (const key of ["autoGainControl", "echoCancellation", "noiseSuppression", "suppressLocalAudioPlayback"]) assert.equal(settings[key], false);
      const baseline = await page.evaluate(() => globalThis.measureOutput());
      assert.ok(Math.abs(baseline / (0.15 * 0.4 / Math.sqrt(2)) - 1) < 0.12);
      const waitEpoch = async (epoch, sessionId = "timeline-1") => {
        await page.waitForFunction(({ epoch, sessionId }) => globalThis.data.consumed.filter((chunk) => chunk.identity.epoch === epoch && chunk.identity.sessionId === sessionId).length >= 5
          || globalThis.error || globalThis.data.statuses.some((status) => status.state === "failed"), { epoch, sessionId });
        assert.equal(await page.evaluate(() => globalThis.error), undefined);
        const state = await page.evaluate(() => globalThis.data.statuses.at(-1));
        assert.equal(state.state, "running", JSON.stringify(state));
        assert.equal(state.identity.epoch, epoch); assert.equal(state.identity.sessionId, sessionId);
      };
      const identity = () => page.evaluate(() => globalThis.controller.identity);
      const emit = async (id, label) => {
        await page.evaluate(({ id, label }) => globalThis.emitResult(id, label), { id, label });
      };
      const outputLevels = [];
      const checkOutput = async () => {
        const rms = await page.evaluate(() => globalThis.measureOutput());
        assert.ok(Math.abs(rms / baseline - 1) < 0.12, `Original output through transition: ${JSON.stringify({ owned, baseline, rms })}`);
        assert.deepEqual(await page.evaluate(() => [video.paused, video.volume, video.muted]), [false, 0.4, false]);
        outputLevels.push(rms);
      };
      await page.getByRole("button", { name: "Start timeline session", exact: true }).click();
      await waitEpoch(0);
      const initial = await identity();
      await emit(initial, "initial");
      await page.waitForFunction(() => globalThis.data.captions.length === 1);
      assert.ok((await page.evaluate(() => globalThis.data.captions[0].videoRange)).startMs > 0, "Caption maps to video position, not session elapsed time");
      await checkOutput();

      await page.evaluate(() => { video.currentTime = 3; });
      await waitEpoch(1);
      await emit(initial, "late-seek");
      await checkOutput();
      const sought = await identity();
      await emit(sought, "seek");
      await page.waitForFunction(() => globalThis.data.captions.length === 2);
      assert.ok((await page.evaluate(() => globalThis.data.captions.at(-1).videoRange)).startMs >= 2900);

      await page.evaluate(() => { video.playbackRate = 1.25; });
      await waitEpoch(2);
      await emit(sought, "late-rate");
      await checkOutput();
      const rated = await identity();
      await emit(rated, "rate");
      await page.waitForFunction(() => globalThis.data.captions.length === 3);

      await page.evaluate(() => video.pause());
      await page.waitForFunction(() => globalThis.data.statuses.at(-1)?.state === "paused");
      assert.equal((await identity()).epoch, 3);
      const pausedChunks = await page.evaluate(() => globalThis.data.chunks.length);
      await emit(rated, "late-pause");
      const pausedOutput = await page.evaluate(() => globalThis.measureOutput());
      assert.ok(pausedOutput < 0.001, `Pause must stop real output: ${pausedOutput}`);
      assert.equal(await page.evaluate(() => globalThis.data.chunks.length), pausedChunks, "No PCM after pause");
      assert.equal(await page.evaluate(() => globalThis.controller.snapshot().length), 3, "Pause retains comparison history");
      await page.getByRole("button", { name: "Resume timeline session", exact: true }).click();
      await waitEpoch(4);
      await checkOutput();
      const resumed = await identity();
      await emit(resumed, "resume");
      await page.waitForFunction(() => globalThis.data.captions.length === 4);

      await page.evaluate(() => { video.src = "/replacement.webm"; });
      await page.waitForFunction(() => globalThis.data.statuses.at(-1)?.state === "unavailable");
      assert.equal((await identity()).epoch, 5);
      assert.equal(await page.evaluate(() => globalThis.data.statuses.at(-1).reason), "target-invalidated");
      await emit(resumed, "late-source");
      await page.evaluate(() => video.play());
      await checkOutput();
      assert.equal(await page.evaluate(() => globalThis.data.chunks.some((chunk) => chunk.identity.epoch === 5)), false, "Source replacement cannot automatically adopt the new video");
      await page.getByRole("button", { name: "Start timeline session", exact: true }).click();
      await waitEpoch(0, "timeline-2");
      assert.notEqual((await identity()).targetId, initial.targetId);
      await checkOutput();
      await page.evaluate(() => globalThis.controller.stop());
      const stoppedChunks = await page.evaluate(() => globalThis.data.chunks.length);
      await checkOutput();
      assert.equal(await page.evaluate(() => globalThis.data.chunks.length), stoppedChunks);

      const result = await page.evaluate(() => ({ anchors: globalThis.data.anchors, chunks: globalThis.data.chunks,
        cancels: globalThis.data.cancels, clears: globalThis.data.clears,
        captions: globalThis.data.captions.map((caption) => ({ identity: caption.source.identity, audioRange: caption.source.audioRange, videoRange: caption.videoRange })),
        captionIds: globalThis.data.captions.map((caption) => caption.source.utteranceId) }));
      assert.deepEqual(result.captionIds, ["initial", "seek", "rate", "resume"], "Late old-epoch results must never appear");
      assert.deepEqual(result.anchors.filter((event) => event.type !== "play").map((event) => event.type), ["seek", "rate", "pause", "source"]);
      const starts = result.anchors.filter((event) => event.type === "play");
      assert.equal(starts.length, 5); assert.equal(new Set(starts.map((event) => event.anchor.clockId)).size, 5);
      for (const start of starts) {
        const chunks = result.chunks.filter((chunk) => chunk.identity.sessionId === start.identity.sessionId && chunk.identity.epoch === start.identity.epoch);
        assert.ok(chunks.length >= 5); assert.equal(chunks[0].sequence, 0); assert.equal(chunks[0].audioRange.startMs, 0);
        for (const chunk of chunks) {
          assert.equal(chunk.capture.clockId, start.anchor.clockId);
          assert.ok(chunk.mapped, "Every real chunk has a same-clock video mapping");
          assert.ok(Math.abs((chunk.mapped.endMs - chunk.mapped.startMs) - (chunk.audioRange.endMs - chunk.audioRange.startMs) * chunk.rate) < 0.001);
          assert.ok(Math.abs(chunk.mapped.endMs - chunk.observedMediaMs) < 150, `Mapping error <150ms: ${JSON.stringify(chunk)}`);
        }
        assert.ok(chunks.some((chunk) => chunk.peak > 0.12 && chunk.peak < 0.18), "Each reopened epoch contains actual decoded audio");
      }
      for (const epoch of [0, 1, 2, 4]) {
        const cancel = result.cancels.find((entry) => entry.cancelled.sessionId === "timeline-1" && entry.cancelled.epoch === epoch);
        assert.ok(cancel); assert.equal(cancel.current.epoch, epoch + 1, "Epoch advances before engine cancel");
        assert.ok(result.clears.some((entry) => entry.sessionId === "timeline-1" && entry.epoch === epoch));
      }
      for (const caption of result.captions) {
        const chunk = result.chunks.find((chunk) => chunk.identity.sessionId === caption.identity.sessionId && chunk.identity.epoch === caption.identity.epoch
          && chunk.audioRange.startMs === caption.audioRange.startMs);
        assert.deepEqual(caption.videoRange, chunk.mapped, "Actual controller maps the engine's real input range using playback anchors");
      }
      assert.deepEqual(errors, []);
      observations.push({ siteOwnedGraph: owned, realChunks: result.chunks.length,
        maxMappingErrorMs: Math.max(...result.chunks.map((chunk) => Math.abs(chunk.mapped.endMs - chunk.observedMediaMs))),
        epochs: starts.map((event) => ({ identity: event.identity, anchor: event.anchor })),
        captionIds: result.captionIds, baselineOutputRms: baseline, transitionOutputRms: outputLevels, pausedOutputRms: pausedOutput, pageErrors: errors });
    } catch (error) {
      console.error(JSON.stringify({ siteOwnedGraph: owned, pageErrors: errors,
        state: await page.evaluate(() => ({ error: globalThis.error, statuses: globalThis.data?.statuses,
          media: { currentTime: video.currentTime, duration: video.duration, seekable: Array.from({ length: video.seekable.length }, (_, i) => [video.seekable.start(i), video.seekable.end(i)]) },
          anchors: globalThis.data?.anchors, chunks: globalThis.data?.chunks.length, captions: globalThis.data?.captions.length })) }));
      throw error;
    } finally { await page.close(); }
  }
  console.log(JSON.stringify({ passed: true, scope: "V3 real video/PCM time mapping and input-driven core epoch cancellation",
    browser: browser.version(), mappingToleranceMs: 150, observations, inference: "generated delayed test-engine events; no ASR or translation", physicalSpeakerAudibility: "unverified" }));
}
