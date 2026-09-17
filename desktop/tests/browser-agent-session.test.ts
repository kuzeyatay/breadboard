import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  browserAgentBootstrapUrl,
  browserAgentReceiptPath,
  chooseBrowserAgentDebuggingPort,
  configureBrowserAgentDebugging,
  parseExcludedPortRanges,
  isBrowserAgentBootstrapUrl,
  writeBrowserAgentSessionReceipt,
} from "../src/main/browser-agent-session";

const runId = `job_${"a".repeat(64)}`;

test("browser-agent bootstrap documents are inert and run-specific", () => {
  const url = browserAgentBootstrapUrl(runId);
  assert.equal(url, `about:blank#breadboard-browser-agent=${runId}`);
  assert.equal(isBrowserAgentBootstrapUrl(url, runId), true);
  assert.equal(isBrowserAgentBootstrapUrl(url, `job_${"b".repeat(64)}`), false);
  assert.equal(isBrowserAgentBootstrapUrl("about:blank#anything"), false);
  assert.throws(() => browserAgentBootstrapUrl("not-a-runtime-job"), /run id/u);
});

test("browser-agent debugging is loopback-only and clears only its stale port file", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-browser-agent-debug-"));
  const stale = path.join(fixture, "DevToolsActivePort");
  fs.writeFileSync(stale, "9222\n/devtools/browser/stale\n");
  const switches: Array<[string, string]> = [];
  try {
    configureBrowserAgentDebugging(
      { appendSwitch: (name, value) => void switches.push([name, value ?? ""]) },
      fixture,
      49_321,
    );
    assert.equal(fs.existsSync(stale), false);
    assert.deepEqual(switches, [
      ["remote-debugging-address", "127.0.0.1"],
      ["remote-debugging-port", "49321"],
    ]);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("the debugging port never lands in a range Windows has reserved", () => {
  const netsh = [
    "",
    "Protocol tcp Port Exclusion Ranges",
    "",
    "Start Port    End Port      ",
    "----------    --------      ",
    "      8000        8000      ",
    "     50000       50059     *",
    "     59549       59648      ",
    "",
    "* - Administered port exclusions.",
  ].join("\r\n");
  const ranges = parseExcludedPortRanges(netsh);
  assert.deepEqual(ranges, [[8_000, 8_000], [50_000, 50_059], [59_549, 59_648]]);
  const picks = [59_618, 50_010, 59_700];
  assert.equal(chooseBrowserAgentDebuggingPort(ranges, () => picks.shift()!), 59_700);
  assert.equal(chooseBrowserAgentDebuggingPort([[49_152, 65_534]], () => 60_000), 65_535);
  assert.equal(chooseBrowserAgentDebuggingPort([], () => 51_234), 51_234);
});

test("the desktop publishes one bounded receipt beneath its data root", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-browser-agent-receipt-"));
  try {
    writeBrowserAgentSessionReceipt(fixture, {
      protocolVersion: 1,
      runId,
      cdpPort: 9_333,
      targetUrl: browserAgentBootstrapUrl(runId),
      createdAt: "2026-09-04T10:00:00.000Z",
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(browserAgentReceiptPath(fixture, runId), "utf8")), {
      protocolVersion: 1,
      runId,
      cdpPort: 9_333,
      targetUrl: browserAgentBootstrapUrl(runId),
      createdAt: "2026-09-04T10:00:00.000Z",
    });
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
