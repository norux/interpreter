import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// Both sources are real, simultaneously playing encoded speech videos. The tab
// mix is an independent playback oracle only; it never supplies production PCM.
export async function verifyVideoSpeech(browser, origin) {
  const manifest = JSON.parse(await readFile("tests/fixtures/video-speech/manifest.json", "utf8"));
  for (const clip of manifest.clips) {
    const bytes = await readFile(`tests/fixtures/video-speech/${clip.language}.webm`);
    assert.equal(bytes.length, clip.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), clip.sha256);
  }
  const observations = [];
  for (const owned of [false, true]) {
    const page = await browser.newPage(); page.setDefaultTimeout(10000);
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`${origin}/speech?owned=${owned}`);
      await page.waitForFunction(() => globalThis.ready);
      const candidates = await page.evaluate(() => globalThis.candidates());
      assert.equal(candidates.length, 2); assert.ok(candidates.every((candidate) => candidate.visible));
      assert.equal(await page.evaluate(() => globalThis.confirmations.length), 0);
      const references = await page.evaluate(() => globalThis.referenceInfo);
      for (const reference of references) { assert.equal(reference.rate, 48000); assert.ok(reference.duration > 23); }
      const referenceTags = await page.evaluate(() => globalThis.referenceTags);
      for (let index = 0; index < 2; index++) {
        assert.ok(Math.abs(referenceTags[index][index] / 0.06 - 1) < 0.12);
        assert.ok(referenceTags[index][1 - index] < 0.003);
      }
      await page.getByRole("button", { name: "Play both and observe output", exact: true }).click();
      await page.waitForFunction(() => globalThis.outputReady || globalThis.outputError);
      assert.equal(await page.evaluate(() => globalThis.outputError), undefined);
      const settings = await page.evaluate(() => globalThis.outputSettings);
      for (const key of ["autoGainControl", "echoCancellation", "noiseSuppression", "suppressLocalAudioPlayback"]) assert.equal(settings[key], false);
      const state = await page.evaluate(() => globalThis.state());
      assert.deepEqual(state.map((video) => [video.paused, video.volume, video.muted, video.rate]), [[false, 0.4, false, 1], [false, 0.25, false, 1]]);
      const initialTimes = await page.evaluate(() => globalThis.times());
      const baseline = await page.evaluate(() => globalThis.measureOutput());
      const checkOutput = async () => {
        const tags = await page.evaluate(() => globalThis.measureOutput());
        for (let index = 0; index < 2; index++) {
          assert.ok(Math.abs(tags[index] / (0.06 * state[index].volume) - 1) < 0.12, `Both original videos must remain audible at user volume: ${JSON.stringify({ owned, baseline, tags })}`);
          assert.ok(Math.abs(tags[index] / baseline[index] - 1) < 0.12, "Capture/Stop must preserve each original output level");
        }
        assert.deepEqual(await page.evaluate(() => globalThis.state()), state, "Both playback/source/user states must survive capture");
        return tags;
      };
      for (let index = 0; index < 2; index++) assert.ok(Math.abs(baseline[index] / (0.06 * state[index].volume) - 1) < 0.12, JSON.stringify(baseline));
      const rounds = [];
      // Repeat Start on Japanese, then explicitly switch to English while both play.
      for (const [round, selectedIndex] of [0, 0, 1].entries()) {
        const target = candidates[selectedIndex].target;
        await page.locator("select").selectOption(target.id);
        await page.getByRole("button", { name: "Use selected video", exact: true }).click();
        await page.getByRole("button", { name: "Start selected capture", exact: true }).click();
        await page.waitForFunction(() => globalThis.chunks.length >= 50 || globalThis.captureError);
        assert.equal(await page.evaluate(() => globalThis.captureError), undefined);
        const during = await checkOutput();
        await page.getByRole("button", { name: "Stop selected capture", exact: true }).click();
        await page.waitForFunction(() => globalThis.captureClosed);
        const count = await page.evaluate(() => globalThis.chunks.length);
        const after = await checkOutput();
        assert.equal(await page.evaluate(() => globalThis.chunks.length), count, "No PCM after Stop");
        const summary = await page.evaluate(() => globalThis.captureSummary());
        assert.equal(summary.selectedLanguage, manifest.clips[selectedIndex].language);
        assert.deepEqual(summary.identity, { sessionId: `speech-${round + 1}`, targetId: target.id, epoch: 0 });
        assert.equal(summary.scope, "selected-video"); assert.equal(summary.sampleRate, 48000);
        assert.equal(summary.channels, 1); assert.equal(summary.format, "pcm-f32le");
        assert.ok(summary.chunks >= 50); assert.ok(summary.byteLengths.every((length) => length === 8192));
        assert.deepEqual(summary.sequence, Array.from({ length: summary.chunks }, (_, index) => index));
        assert.equal(summary.clocksMatch, true); assert.ok(summary.maxMappingErrorMs < 150, JSON.stringify(summary));
        assert.ok(summary.maxDurationErrorMs < 0.001);
        assert.ok(summary.speechRms > 0.008, `Captured content must include speech energy, not just its tag: ${JSON.stringify(summary)}`);
        assert.ok(summary.matches[selectedIndex].correlation > 0.85, `Actual PCM must match selected decoded speech: ${JSON.stringify(summary)}`);
        assert.ok(summary.matches[1 - selectedIndex].correlation < 0.35, `Unselected speech must not match: ${JSON.stringify(summary)}`);
        assert.ok(Math.abs(summary.tagAmplitudes[selectedIndex] / 0.06 - 1) < 0.12, `Selected source's actual tag: ${JSON.stringify(summary)}`);
        assert.ok(summary.tagAmplitudes[1 - selectedIndex] < 0.003, `Other audible video's tag must be absent: ${JSON.stringify(summary)}`);
        assert.deepEqual(await page.evaluate(() => globalThis.confirmations), [0, 0, 1].slice(0, round + 1).map((index) => candidates[index].target));
        rounds.push({ ...summary, duringOutputTags: during, afterOutputTags: after });
      }
      const times = await page.evaluate(() => globalThis.times());
      assert.ok(times.every((time, index) => time > initialTimes[index] + 6), "Both original videos must advance through repeat Start and selected-target switch");
      assert.deepEqual(errors, []);
      observations.push({ siteOwnedGraphs: owned, referenceTags, outputSettings: settings, baselineOutputTags: baseline, rounds, playbackAdvanceSeconds: times.map((time, index) => time - initialTimes[index]), pageErrors: errors });
    } catch (error) {
      console.error(JSON.stringify({ scope: "V5", siteOwnedGraphs: owned, pageErrors: errors,
        state: await page.evaluate(() => ({ outputError: globalThis.outputError, captureError: globalThis.captureError, chunks: globalThis.chunks?.length, media: globalThis.state?.() })) }));
      throw error;
    } finally { await page.close(); }
  }
  console.log(JSON.stringify({ passed: true, scope: "V5 Japanese/English speech, two-audible-video selection isolation, time mapping and original output",
    browser: browser.version(), fixtures: manifest.clips, observations, speechCorrelationThreshold: 0.85, wrongSpeechCorrelationLimit: 0.35,
    absentTagAmplitudeLimit: 0.003, mappingToleranceMs: 150, outputTolerance: 0.12,
    asrAccuracy: "unverified; no recognizer or translator used", physicalSpeakerAudibility: "unverified", safariAndIPhone: "unverified" }));
}
