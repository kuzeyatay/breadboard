// The self-test runner must not be able to silently skip a unit test file.
//
// It previously named four files by hand while its own docstring promised the
// whole glob, so three files carrying capability binding and execution identity
// were never run by `npm run qa:selftest`. The report said 68 tests; the glob
// ran 125. A partial suite that reads as a full one is worse than no suite,
// because a green result then means less than the person reading it believes.
//
// This is the regression for that: adding a `*.test.mjs` file to the directory
// must change what the runner executes, with no list to remember to update.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { discoverHarnessUnitTests } from "./run-selftest.mjs";

const harnessDir = path.dirname(fileURLToPath(import.meta.url));

test("the runner executes every harness unit test file on disk", () => {
  const onDisk = fs
    .readdirSync(harnessDir)
    .filter((name) => name.endsWith(".test.mjs"))
    .sort();
  const discovered = discoverHarnessUnitTests().map((file) => path.basename(file)).sort();

  assert.deepEqual(
    discovered,
    onDisk,
    "the runner and the directory disagree; a unit test file would be silently skipped",
  );
  // This file is itself one of them, so the set can never be empty by accident.
  assert.ok(discovered.includes("selftest-coverage.test.mjs"));
});

test("a newly added test file is picked up without editing the runner", () => {
  // A temporary directory rather than the real one: the point is that discovery
  // is a function of the directory, and proving it by writing into the live
  // harness would leave a stray file behind if this test failed midway.
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "selftest-discovery-"));
  try {
    fs.writeFileSync(path.join(sandbox, "alpha.test.mjs"), "");
    assert.deepEqual(
      discoverHarnessUnitTests(sandbox).map((file) => path.basename(file)),
      ["alpha.test.mjs"],
    );

    fs.writeFileSync(path.join(sandbox, "beta.test.mjs"), "");
    assert.deepEqual(
      discoverHarnessUnitTests(sandbox).map((file) => path.basename(file)),
      ["alpha.test.mjs", "beta.test.mjs"],
      "a file added after the first call must appear without any list being updated",
    );

    // Non-test files must not be swept in.
    fs.writeFileSync(path.join(sandbox, "helper.mjs"), "");
    fs.writeFileSync(path.join(sandbox, "notes.md"), "");
    assert.deepEqual(
      discoverHarnessUnitTests(sandbox).map((file) => path.basename(file)),
      ["alpha.test.mjs", "beta.test.mjs"],
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
