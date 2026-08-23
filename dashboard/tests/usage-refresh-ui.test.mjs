import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const popoverSource = fs.readFileSync(
  new URL("../src/app/components/usage-limits-popover.tsx", import.meta.url),
  "utf8",
);
const routeSource = fs.readFileSync(
  new URL("../src/app/api/usage-limits/route.ts", import.meta.url),
  "utf8",
);

test("manual usage refresh probes ChatMock while automatic loads remain read-only", () => {
  assert.match(popoverSource, /const useProbe = probe && !googleUsageActive && !claudeUsageActive/);
  assert.match(popoverSource, /method: useProbe \? "POST" : "GET"/);
  assert.match(popoverSource, /refreshUsage\(false, true\)/);
  assert.match(popoverSource, /refreshUsage\(true\)/);
  assert.match(routeSource, /export async function POST\(request: Request\)/);
  assert.match(routeSource, /buildUsageRefreshRequest\(\)/);
});

test("Google subscription usage is selected by model without a generation probe", () => {
  assert.match(popoverSource, /query\.set\("model", activeModel\)/);
  assert.match(routeSource, /antigravityModelId\(model\)/);
  assert.match(routeSource, /await readGoogleUsageLimits\(model\)/);
});

test("Anthropic subscription usage is embedded without a generation probe", () => {
  assert.match(popoverSource, /const claudeUsageActive = isClaudeSubscriptionModel\(activeModel\)/);
  assert.match(popoverSource, /usageData\.provider === "anthropic"/);
  assert.match(popoverSource, /Anthropic-reported subscription usage/);
  assert.match(routeSource, /claudeSubscriptionModelId\(model\)/);
  assert.match(routeSource, /await readClaudeUsageLimits\(model\)/);
});
