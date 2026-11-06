import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { activeLearnGardens } from "../src/main/learn-quit-guard";

test("a garden counts as running while its Learn worker lives or heartbeats", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-learn-quit-"));
  try {
    const content = path.join(root, "quartz", "content");
    fs.mkdirSync(content, { recursive: true });
    const now = Date.parse("2026-09-27T10:00:00Z");
    const write = (garden: string, lock: object) =>
      fs.writeFileSync(path.join(content, `.${garden}.learn-build.lock.json`), JSON.stringify(lock));
    write("live-pid", { heartbeatAt: "2026-09-27T09:00:00Z", processId: process.pid });
    write("fresh", { heartbeatAt: "2026-09-27T09:55:00Z" });
    write("stale", { heartbeatAt: "2026-09-27T09:00:00Z", processId: 2 ** 30 });
    fs.writeFileSync(path.join(content, ".torn.learn-build.lock.json"), "{");
    assert.deepEqual(activeLearnGardens(root, now).sort(), ["fresh", "live-pid"]);
    assert.deepEqual(activeLearnGardens(path.join(root, "missing"), now), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
