import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runElectronFixture } from "./helpers/run-electron-fixture";

test("people you follow are highlighted in their own colors, named on hover, and notes show on hover", async () => {
  const desktop = path.resolve(__dirname, "../..");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bb-followed-highlights-"));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    const result = await runElectronFixture(require("electron") as string, [path.join(desktop, "tests/fixtures/browser-followed-highlights.cjs"), directory], desktop, env, 45000);
    assert.equal(result.error, undefined, `${result.error?.message}\n${result.output}`);
    assert.equal(result.status, 0, result.output);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    fs.rmSync(directory, {recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
