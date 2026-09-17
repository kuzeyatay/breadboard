import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const dashboard = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

/** Render the notice through react-dom/server for one payload. */
async function renderNotice(props) {
  const entry = `
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { ReserveNotice } from "@/app/components/usage-reserve-notice";
    globalThis.__markup = renderToStaticMarkup(React.createElement(ReserveNotice, ${JSON.stringify(props)}));
  `;
  const result = await esbuild.build({
    stdin: { contents: entry, resolveDir: dashboard, loader: "tsx" },
    bundle: true, write: false, format: "cjs", platform: "node",
    alias: { "@": path.join(dashboard, "src") },
    logLevel: "silent",
  });
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, { exports: {} }, {});
  return globalThis.__markup;
}

const captured = "2026-09-14T05:37:31.359Z";
const now = Date.parse(captured) + 60_000;
const reserve = {
  model: "gpt-5.6-luna", active: true, limit_reached: false,
  primary: { used_percent: 26, window_minutes: 10080, resets_in_seconds: 256920 },
};
const primary = { used_percent: 100, window_minutes: 10080, resets_in_seconds: 441192 };

test("an active Luna reserve is announced with the plan, the reset, and the pool left", async () => {
  const markup = await renderNotice({ reserve, plan: "pro", primary, capturedAt: captured, now, light: true });
  assert.match(markup, /data-usage-reserve="active"/);
  assert.match(markup, /GPT-5\.6 Luna reserve is active/);
  assert.match(markup, /Your ChatGPT Pro limit is spent and resets in 5d 2h 32m/);
  assert.match(markup, /answers with GPT-5\.6 Luna from its reserve pool \(74% of it left\)/);
});

test("an idle reserve is a footnote and a spent one a warning", async () => {
  const idle = await renderNotice({ reserve: { ...reserve, active: false }, plan: "pro", now, light: false });
  assert.match(idle, /data-usage-reserve="idle"/);
  assert.match(idle, /switches to GPT-5\.6 Luna from a reserve pool/);
  const spent = await renderNotice({ reserve: { ...reserve, active: false, limit_reached: true }, now, light: false });
  assert.match(spent, /data-usage-reserve="spent"/);
  assert.match(spent, /reserve is spent as well/);
});

test("the chat usage popover and the new-tab notch both draw the reserve from the report", () => {
  const popover = fs.readFileSync(path.join(dashboard, "src/app/components/usage-limits-popover.tsx"), "utf8");
  assert.match(popover, /usageData\.source === "report" \? usageReserveRows\(usageData\)/);
  assert.match(popover, /<ReserveNotice[\s\S]*reserve=\{usageData\.reserve\}/);
  assert.match(popover, /data-usage-account=""/);
  assert.match(popover, /\[\.\.\.limitRows, \.\.\.reserveRows\]\.map/);
  const notch = fs.readFileSync(path.join(dashboard, "src/app/new-tab/provider-usage-notch.tsx"), "utf8");
  assert.match(notch, /notchHeadlineRow\(provider\.id, rows, reading\?\.data\)/);
  assert.match(notch, /\{reserveCopy && <p className=\{styles\.status\} data-usage-reserve="active">/);
  const route = fs.readFileSync(path.join(dashboard, "src/app/api/usage-limits/route.ts"), "utf8");
  assert.match(route, /const report = await readCodexUsageReport\(baseURL\);\s*return NextResponse\.json\(report \?\? \{ \.\.\.readUsageLimits\(\), source: 'headers' \}/);
  assert.match(route, /if \(report\) \{\s*return NextResponse\.json\(\{ \.\.\.report, refreshed: true \}/);
});
