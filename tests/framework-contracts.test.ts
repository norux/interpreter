import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, sep } from "node:path";
import { test } from "node:test";

test("framework contract/core dependencies stay within platform-neutral packages", () => {
  const files = execFileSync(resolve("node_modules/.bin/tsc"),
    ["-p", "tsconfig.framework.json", "--listFilesOnly"], { encoding: "utf8" }).trim().split("\n");
  const roots = ["packages/contracts", "packages/core", "tests/framework/types"].map((path) => `${resolve(path)}${sep}`);
  assert.ok(files.includes(resolve("packages/contracts/index.ts")));
  assert.ok(files.includes(resolve("tests/framework/types/contracts.ts")));
  for (const module of ["audio-queue", "identity", "revision-store", "session-controller", "timeline"]) {
    assert.ok(files.includes(resolve(`packages/core/${module}.ts`)), `Core module was not checked: ${module}`);
  }
  const libraries = ["node_modules/typescript/lib",
    `node_modules/@typescript/typescript-${process.platform}-${process.arch}/lib`].map((path) => `${resolve(path)}${sep}`);
  for (const file of files) {
    if (libraries.some((library) => file.startsWith(library))) {
      assert.doesNotMatch(file, /lib\.(dom|webworker|scripthost)/, `Browser library: ${file}`);
    } else {
      assert.ok(roots.some((root) => file.startsWith(root)), `Forbidden dependency: ${file}`);
    }
  }
});
