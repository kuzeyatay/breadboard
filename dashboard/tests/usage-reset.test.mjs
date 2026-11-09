import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { codexUsagePayload } from "../src/lib/chatgpt-codex-usage.ts";
import { readUsageLimits } from "../src/lib/usage-limits.ts";
import { usageLimitResetAt } from "../src/lib/usage-limit-display.ts";
import { notchResetCopy, notchUsageRows } from "../src/lib/usage-notch.ts";

const captured = "2026-11-08T12:00:00Z";
const now = Date.parse("2026-11-08T12:01:00Z");
const reset = Date.parse("2026-11-08T12:30:00Z");
const primary = { used_percent: 100, window_minutes: 300, resets_at: reset / 1000 };
const reserve = { model: "gpt-test", active: true, limit_reached: false,
  primary: { used_percent: 26, window_minutes: 10080, resets_at: reset / 1000 + 7200 } };

test("the GPT report carries absolute reset times into the notch, including the reserve", () => {
  const payload = codexUsagePayload({ captured_at: captured, primary, reserve }, new Date(now));
  assert.equal(payload.primary.resets_at, primary.resets_at);
  assert.equal(payload.reserve.primary.resets_at, reserve.primary.resets_at);
  const rows = notchUsageRows("chatgpt", payload);
  assert.equal(notchResetCopy(payload.captured_at, rows[0].limit, now), "Resets in 29 min");
  assert.equal(notchResetCopy(payload.captured_at, rows[1].limit, now), "Resets in 2h 29m");
  assert.equal(notchResetCopy(undefined, rows[0].limit, now), "Resets in 29 min");
});

test("the header fallback retains absolute GPT reset times", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-usage-reset-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "usage.json");
  fs.writeFileSync(file, JSON.stringify({ captured_at: captured, primary }));
  const payload = readUsageLimits({ CHATMOCK_USAGE_LIMITS_PATH: file }, directory, new Date(now));
  assert.equal(payload.primary.resets_at, primary.resets_at);
  assert.equal(usageLimitResetAt(payload.captured_at, payload.primary), reset);
});

test("absolute resets take precedence, stay fixed when reread, and never imply a fresh allowance", () => {
  const conflicting = { ...primary, resets_in_seconds: 7200 };
  assert.equal(usageLimitResetAt(captured, conflicting), reset);
  assert.equal(usageLimitResetAt("2026-11-08T12:10:00Z", conflicting), reset);
  assert.equal(notchResetCopy(captured, conflicting, reset + 1000), "Reset due");
  assert.equal(conflicting.used_percent, 100);
  for (const value of [undefined, null, false, 0, -1, NaN, Infinity, 1e20]) {
    const window = { resets_at: value, resets_in_seconds: 1800 };
    assert.equal(usageLimitResetAt(captured, window), reset);
    assert.equal(usageLimitResetAt(undefined, window), null);
  }
  assert.equal(usageLimitResetAt(captured, { resets_in_seconds: Infinity }), null);
  assert.equal(usageLimitResetAt(captured, { resets_in_seconds: 1e20 }), null);
  assert.equal(usageLimitResetAt("invalid", { resets_in_seconds: 1800 }), null);
});

test("the GPT reserve notice uses the same absolute reset as the notch", async () => {
  const dashboard = fileURLToPath(new URL("..", import.meta.url));
  const props = { reserve, plan: "pro", primary, capturedAt: captured, now, light: true };
  const bundle = await build({
    stdin: { contents: `import React from "react";
      import {renderToStaticMarkup} from "react-dom/server";
      import {ReserveNotice} from "@/app/components/usage-reserve-notice";
      export const markup = renderToStaticMarkup(React.createElement(ReserveNotice, ${JSON.stringify(props)}));`,
      resolveDir: dashboard, loader: "tsx" },
    bundle: true, write: false, format: "cjs", platform: "node", packages: "external",
    alias: { "@": path.join(dashboard, "src") },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  assert.match(module.exports.markup, /resets in 29m/);
  assert.match(module.exports.markup, /74% of it left/);
});
