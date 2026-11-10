import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  compareVersions,
  DATA_ROOT_VERSION_FILE,
  newerDataRootVersion,
  readDataRootVersion,
  recordDataRootVersion,
} from "../src/main/data-root-version";

test("versions compare numerically and ignore pre-release suffixes", () => {
  assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("0.2.0", "0.10.0"), -1);
  assert.equal(compareVersions("1.0.0", "0.9.9"), 1);
  assert.equal(compareVersions("v1.0.0-beta.1", "1.0.0"), 0);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
});

test("a data root opened by a newer Breadboard is refused and its marker kept", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-data-root-"));
  try {
    assert.equal(readDataRootVersion(dataRoot), null);
    assert.equal(newerDataRootVersion(dataRoot, "0.1.0"), null);

    recordDataRootVersion(dataRoot, "0.1.0");
    assert.equal(readDataRootVersion(dataRoot)?.version, "0.1.0");
    assert.equal(newerDataRootVersion(dataRoot, "0.1.0"), null);
    assert.equal(newerDataRootVersion(dataRoot, "0.2.0"), null);

    recordDataRootVersion(dataRoot, "0.2.0");
    assert.equal(newerDataRootVersion(dataRoot, "0.1.0"), "0.2.0");
    recordDataRootVersion(dataRoot, "0.1.0");
    assert.equal(readDataRootVersion(dataRoot)?.version, "0.2.0", "an older app never lowers the marker");

    fs.writeFileSync(path.join(dataRoot, DATA_ROOT_VERSION_FILE), "{not json");
    assert.equal(readDataRootVersion(dataRoot), null, "a damaged marker never blocks startup");
    assert.equal(newerDataRootVersion(dataRoot, "0.1.0"), null);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
