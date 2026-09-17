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

test("chat usage popover probes on manual refresh while its automatic loads remain read-only", () => {
  assert.match(popoverSource, /const useProbe = probe && !googleUsageActive && !claudeUsageActive/);
  assert.match(popoverSource, /method: useProbe \? "POST" : "GET"/);
  assert.match(popoverSource, /refreshUsage\(false, true\)/);
  assert.match(popoverSource, /refreshUsage\(true\)/);
  assert.match(routeSource, /export async function POST\(request: Request\)/);
  assert.match(routeSource, /refreshChatgptUsage\(baseURL, userId\)/);
});

test("Google subscription usage is selected by model without a generation probe", () => {
  assert.match(popoverSource, /query\.set\("model", activeModel\)/);
  assert.match(routeSource, /antigravityModelId\(model\)/);
  assert.match(routeSource, /withCliproxyLease\([\s\S]*'subscription-usage-limits'[\s\S]*readGoogleUsageLimits\(model\)/);
});

test("Anthropic reads usage first and requests bounded session recovery only when needed", () => {
  assert.match(popoverSource, /const claudeUsageActive = isClaudeSubscriptionModel\(activeModel\)/);
  assert.match(popoverSource, /usageData\.provider === "anthropic"/);
  assert.match(popoverSource, /Anthropic-reported subscription usage/);
  assert.match(routeSource, /claudeSubscriptionModelId\(model\)/);
  assert.match(routeSource, /await readClaudeUsageLimits\(model\)/);
  assert.match(popoverSource, /claudeUsageActive && data\.recovery_required/);
  assert.match(routeSource, /recoverSession: async \(\) =>/);
  assert.match(routeSource, /operation: 'refresh-usage'/);
});
