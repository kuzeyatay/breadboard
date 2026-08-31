import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertPinnedCleanCheckout,
  SOURCE_COMMIT_RECEIPT_NAME,
  writeSourceCommitReceipt,
} from "./pinned-source-checkout.mjs";

function git(root, ...args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test("pinned source check accepts only the exact independent clean checkout", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-source-pin-"));
  try {
    git(fixtureRoot, "init", "--quiet");
    git(fixtureRoot, "config", "user.email", "runtime-v2-test@breadboard.invalid");
    git(fixtureRoot, "config", "user.name", "Runtime V2 Test");
    fs.writeFileSync(path.join(fixtureRoot, "tracked.txt"), "reviewed\n", "utf8");
    git(fixtureRoot, "add", "tracked.txt");
    git(fixtureRoot, "commit", "--quiet", "-m", "fixture");
    const commit = git(fixtureRoot, "rev-parse", "HEAD");

    assert.equal(
      assertPinnedCleanCheckout({ label: "Fixture", sourceRoot: fixtureRoot, expectedCommit: commit }),
      commit,
    );

    fs.writeFileSync(path.join(fixtureRoot, "untracked.txt"), "not reviewed\n", "utf8");
    assert.throws(
      () => assertPinnedCleanCheckout({ label: "Fixture", sourceRoot: fixtureRoot, expectedCommit: commit }),
      /no staged, modified, deleted, or untracked files/u,
    );
    fs.rmSync(path.join(fixtureRoot, "untracked.txt"));

    fs.writeFileSync(path.join(fixtureRoot, "tracked.txt"), "changed\n", "utf8");
    assert.throws(
      () => assertPinnedCleanCheckout({ label: "Fixture", sourceRoot: fixtureRoot, expectedCommit: commit }),
      /no staged, modified, deleted, or untracked files/u,
    );
    git(fixtureRoot, "restore", "tracked.txt");

    assert.throws(
      () =>
        assertPinnedCleanCheckout({
          label: "Fixture",
          sourceRoot: fixtureRoot,
          expectedCommit: "0".repeat(40),
        }),
      /checkout must be pinned/u,
    );

    const nested = path.join(fixtureRoot, "nested");
    fs.mkdirSync(nested);
    assert.throws(
      () => assertPinnedCleanCheckout({ label: "Nested", sourceRoot: nested, expectedCommit: commit }),
      /independent Git checkout/u,
    );

    const receiptRoot = path.join(fixtureRoot, "receipt");
    fs.mkdirSync(receiptRoot);
    writeSourceCommitReceipt(receiptRoot, commit);
    assert.equal(
      fs.readFileSync(path.join(receiptRoot, SOURCE_COMMIT_RECEIPT_NAME), "utf8"),
      `${commit}\n`,
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("pinned source check accepts an explicitly receipted vendored snapshot", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-vendored-pin-"));
  try {
    git(fixtureRoot, "init", "--quiet");
    git(fixtureRoot, "config", "user.email", "runtime-v2-test@breadboard.invalid");
    git(fixtureRoot, "config", "user.name", "Runtime V2 Test");
    fs.writeFileSync(path.join(fixtureRoot, "root.txt"), "outer\n", "utf8");
    git(fixtureRoot, "add", "root.txt");
    git(fixtureRoot, "commit", "--quiet", "-m", "outer fixture");
    const upstreamCommit = git(fixtureRoot, "rev-parse", "HEAD");

    const vendoredRoot = path.join(fixtureRoot, "vendored-source");
    fs.mkdirSync(vendoredRoot);
    fs.writeFileSync(path.join(vendoredRoot, "tracked.txt"), "reviewed\n", "utf8");
    writeSourceCommitReceipt(vendoredRoot, upstreamCommit);
    git(fixtureRoot, "add", "vendored-source");

    assert.equal(
      assertPinnedCleanCheckout({
        label: "Vendored fixture",
        sourceRoot: vendoredRoot,
        expectedCommit: upstreamCommit,
        allowVendoredSnapshot: true,
      }),
      upstreamCommit,
    );
    assert.throws(
      () =>
        assertPinnedCleanCheckout({
          label: "Vendored fixture",
          sourceRoot: vendoredRoot,
          expectedCommit: upstreamCommit,
        }),
      /independent Git checkout/u,
    );

    fs.writeFileSync(path.join(vendoredRoot, "untracked.txt"), "not reviewed\n", "utf8");
    assert.throws(
      () =>
        assertPinnedCleanCheckout({
          label: "Vendored fixture",
          sourceRoot: vendoredRoot,
          expectedCommit: upstreamCommit,
          allowVendoredSnapshot: true,
        }),
      /must be tracked and match the outer Git index/u,
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("the app stager and package verifier bind every reviewed local source", () => {
  const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
  const prepare = fs.readFileSync(
    path.join(scriptsRoot, "prepare-app-resources.mjs"),
    "utf8",
  );
  const verify = fs.readFileSync(
    path.join(scriptsRoot, "verify-package.mjs"),
    "utf8",
  );
  const helper = fs.readFileSync(
    path.join(scriptsRoot, "pinned-source-checkout.mjs"),
    "utf8",
  );
  const reviewed = {
    penecho: "5d14d54b5a8d06dab4cb6a865f2547556e5ff842",
    googleImages: "e9c515eda45807d80d9ccc993be781d0ee13d47b",
    tradingAgents: "271e8c88a9874cae3f4ba8059b78301c13fa9e18",
    agentReach: "241b02870892525e009bceaa7823d3f7b6c6f617",
    watermarks: "ff5db594f189373b80afde42449b5ad952270c95",
  };

  for (const [key, commit] of Object.entries(reviewed)) {
    assert.match(prepare, new RegExp(`${key}: "${commit}"`, "u"));
    assert.match(verify, new RegExp(`${key}: "${commit}"`, "u"));
    assert.match(
      prepare,
      new RegExp(`expectedCommit: REVIEWED_LOCAL_SOURCE_COMMITS\\.${key}`, "u"),
    );
    assert.match(verify, new RegExp(`PINNED_LOCAL_SOURCE_COMMITS\\.${key}`, "u"));
  }

  assert.match(helper, /--untracked-files=all/u);
  assert.match(helper, /--ignore-submodules=none/u);
  assert.match(prepare, /writeSourceCommitReceipt/u);
  assert.match(verify, /requireSourceCommitReceipt/u);
  assert.match(prepare, /BREADBOARD_UPSTREAM_COMMIT/u);
  assert.match(verify, /28eca2d91fd485213045b86896db671937432a48/u);
});
