import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelStatus } from "../packages/contracts";
import { createModelRepository } from "../packages/engines-browser/model-repository";
import { asrCandidates, modelCacheName, modelFiles, modelUrl, preparationModel, registeredCandidate, requiredBytes } from "../packages/engines-browser/model";

// Port fault/lifecycle checks with fake cache metadata and loader. These are not
// model loading or recognition evidence; the browser preparation test is separate.
test("model repository readiness, cancellation, cache ownership and failures", async (context) => {
  const originals = ["caches", "navigator", "fetch"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const records = new Map<string, Response>();
  const removed: string[] = [];
  let cacheExists = false;
  const cache = {
    match: async (key: string) => records.get(key)?.clone(),
    put: async (key: string, response: Response) => { records.set(key, response); },
  } as unknown as Cache;
  const storage = { estimate: async () => ({ quota: requiredBytes * 2, usage: 0 }) };
  Object.defineProperty(globalThis, "caches", { configurable: true, value: {
    has: async (name: string) => { assert.equal(name, modelCacheName); return cacheExists; },
    open: async (name: string) => { assert.equal(name, modelCacheName); cacheExists = true; return cache; },
    delete: async (name: string) => { removed.push(name); records.clear(); cacheExists = false; return true; },
  } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage, onLine: false } });
  function cached() {
    cacheExists = true;
    for (const file of modelFiles) records.set(modelUrl(file.path), new Response("fixture metadata only", { headers: { "Content-Length": String(file.bytes) } }));
  }
  try {
    await context.test("cached is distinct from resident; Stop disposes a late loader and cannot yield ready", async () => {
      cached(); let disposed = 0;
      let finish: (loaded: { dispose(): Promise<void> }) => void = () => {};
      const pending = new Promise<{ dispose(): Promise<void> }>((resolve) => { finish = resolve; });
      const repository = createModelRepository(() => pending);
      assert.equal((await repository.status(preparationModel)).state, "cached");
      const preparation = repository.prepare(preparationModel)[Symbol.asyncIterator]();
      assert.equal((await preparation.next()).value?.state, "cached");
      assert.equal((await preparation.next()).value?.state, "cached");
      assert.equal((await preparation.next()).value?.state, "loading");
      const loading = preparation.next();
      await repository.cancel(preparationModel);
      finish({ dispose: async () => { disposed++; } });
      const result = await loading;
      assert.equal(result.value?.state, "failed"); assert.equal(result.value?.reason, "cancelled");
      assert.equal(disposed, 1); assert.equal((await preparation.next()).done, true);
      assert.equal((await repository.status(preparationModel)).state, "cached");
    });
    await context.test("parallel preparation/eviction rejected; idle eviction releases residency and only the owned cache", async () => {
      cached(); let disposed = 0;
      const repository = createModelRepository(async () => ({ dispose: async () => { disposed++; } }));
      const active = repository.prepare(preparationModel)[Symbol.asyncIterator]();
      await active.next();
      await assert.rejects(async () => { for await (const _status of repository.prepare(preparationModel)) {} }, /already active/);
      await assert.rejects(repository.evict(preparationModel), /Stop preparation/);
      let last: ModelStatus | undefined;
      for (;;) { const value = await active.next(); if (value.done) break; last = value.value; }
      assert.equal(last?.state, "ready");
      await repository.evict(preparationModel);
      assert.equal(disposed, 1); assert.deepEqual(removed, [modelCacheName]);
      assert.equal((await repository.status(preparationModel)).state, "evicted");
      assert.equal(cacheExists, false, "Reading evicted status must not recreate the deleted cache");
    });
    await context.test("offline first run and insufficient quota stay failed without invoking the loader", async () => {
      let loads = 0;
      const repository = createModelRepository(async () => { loads++; return { dispose: async () => {} }; });
      const offline = [];
      for await (const status of repository.prepare(preparationModel)) offline.push(status);
      assert.equal(offline.at(-1)?.reason, "offline-model-unavailable");
      storage.estimate = async () => ({ quota: requiredBytes - 1, usage: 0 });
      const insufficient = [];
      for await (const status of repository.prepare(preparationModel)) insufficient.push(status);
      assert.equal(insufficient.at(-1)?.state, "failed"); assert.equal(insufficient.at(-1)?.reason, "storage-insufficient");
      assert.equal(loads, 0);
    });
    await context.test("unregistered identity cannot download, load or evict the candidate", async () => {
      const repository = createModelRepository(async () => { throw new Error("must not load"); });
      const wrong = { ...preparationModel, version: "main" };
      await assert.rejects(repository.status(wrong), /Unregistered/);
      await assert.rejects(repository.cancel(wrong), /Unregistered/);
      await assert.rejects(repository.evict(wrong), /Unregistered/);
      await assert.rejects(async () => { for await (const _status of repository.prepare(wrong)) {} }, /Unregistered/);
    });
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("FP16 and q8 of the same revision prepare and evict independent caches", async () => {
  const originals = ["caches", "navigator"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const cachesByName = new Map<string, Map<string, Response>>();
  const selected = asrCandidates.small.model;
  const q8 = registeredCandidate(selected);
  const fp16 = registeredCandidate(selected, "fp16");
  for (const profile of [q8, fp16]) {
    const files = new Map<string, Response>();
    for (const file of profile.files) files.set(profile.url(file.path), new Response("fixture metadata only", { headers: { "Content-Length": String(file.bytes) } }));
    cachesByName.set(profile.cacheName, files);
  }
  Object.defineProperty(globalThis, "caches", { configurable: true, value: {
    has: async (name: string) => cachesByName.has(name),
    open: async (name: string) => {
      const files = cachesByName.get(name);
      assert.ok(files, "Repository must open only the selected precision cache");
      return { match: async (key: string) => files.get(key)?.clone() };
    },
    delete: async (name: string) => cachesByName.delete(name),
  } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: { estimate: async () => ({}) }, onLine: false } });
  let q8Loads = 0; let fp16Loads = 0; let fp16Disposals = 0;
  const q8Repository = createModelRepository(async () => { q8Loads++; return { dispose: async () => {} }; }, selected);
  const fp16Repository = createModelRepository(async () => { fp16Loads++; return { dispose: async () => { fp16Disposals++; } }; }, selected, "fp16");
  try {
    assert.notEqual(q8.cacheName, fp16.cacheName);
    assert.equal((await q8Repository.status(selected)).state, "cached");
    assert.equal((await fp16Repository.status(selected)).state, "cached");
    let last: ModelStatus | undefined;
    for await (const status of fp16Repository.prepare(selected)) last = status;
    assert.equal(last?.state, "ready"); assert.equal(last?.requiredBytes, 487960440);
    assert.equal(fp16Loads, 1); assert.equal(q8Loads, 0);
    assert.equal((await q8Repository.status(selected)).state, "cached");
    await fp16Repository.evict(selected);
    assert.equal(fp16Disposals, 1); assert.equal(cachesByName.has(fp16.cacheName), false);
    assert.equal((await fp16Repository.status(selected)).state, "evicted");
    assert.equal((await q8Repository.status(selected)).state, "cached");
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
