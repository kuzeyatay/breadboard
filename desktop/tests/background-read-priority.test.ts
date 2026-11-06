import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { installBackgroundReadPriority } from "../src/preload/preload";
import { runElectronFixture } from "./helpers/run-electron-fixture";

test("background polling cannot starve the selected document's bootstrap scripts", async () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-read-priority-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TEST_CONTEXT;
  try {
    const result = await runElectronFixture(require("electron") as string,
      [path.join(desktop, "tests/fixtures/background-read-priority.cjs"), dir], desktop, env, 30_000);
    assert.equal(result.error, undefined, `${result.error?.message}\n${result.output}`);
    assert.equal(result.status, 0, result.output);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("priority policy preserves writes, caller options, external reads and foreground requests", () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const window = { fetch: (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ input, init }); } };
  const document = { documentElement: { dataset: { desktopTabActive: "false" } } };
  runInNewContext(`(${installBackgroundReadPriority.toString()})()`, {
    window, document, location: new URL('http://127.0.0.1:4567/workspace'), Request, URL,
  });
  const controller = new AbortController();
  const read = { signal: controller.signal, credentials: 'include' as const, cache: 'no-store' as const };
  window.fetch('/api/refresh', read);
  assert.equal(calls.at(-1)?.init?.priority, 'low');
  assert.equal(calls.at(-1)?.init?.signal, controller.signal);
  assert.equal(calls.at(-1)?.init?.credentials, 'include');
  assert.equal(calls.at(-1)?.init?.cache, 'no-store');
  assert.equal('priority' in read, false, 'the caller options are not mutated');
  const write = { method: 'POST', body: 'draft', signal: controller.signal };
  window.fetch('/api/save', write);
  assert.equal(calls.at(-1)?.init, write);
  const explicit = { priority: 'high' as const };
  window.fetch('/api/refresh', explicit);
  assert.equal(calls.at(-1)?.init, explicit);
  window.fetch('https://example.com/status', read);
  assert.equal(calls.at(-1)?.init, read);
  document.documentElement.dataset.desktopTabActive = 'true';
  window.fetch('/api/refresh', read);
  assert.equal(calls.at(-1)?.init, read);
});
