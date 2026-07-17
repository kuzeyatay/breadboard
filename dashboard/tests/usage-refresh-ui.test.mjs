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
  assert.match(popoverSource, /method: probe \? "POST" : "GET"/);
  assert.match(popoverSource, /refreshUsage\(false, true\)/);
  assert.match(popoverSource, /refreshUsage\(true\)/);
  assert.match(routeSource, /export async function POST\(request: Request\)/);
  assert.match(routeSource, /buildUsageRefreshRequest\(\)/);
});
