import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";

const desktopRoot = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(
  path.join(desktopRoot, "src", "main", "app-lifecycle.ts"),
  "utf8",
);

test("a failed Runtime root is retried before service-snapshot validation", () => {
  assert.match(source, /export const RUNTIME_ROOT_RETRY_ID = "desktop-runtime";/);
  assert.match(
    source,
    /serviceId === RUNTIME_ROOT_RETRY_ID[\s\S]{0,220}return this\.retryRuntimeRoot\(\);[\s\S]{0,220}const snapshot = runtime\?\.snapshot\(\);/,
  );
  assert.match(
    source,
    /failure: \{\s*serviceId: RUNTIME_ROOT_RETRY_ID,\s*displayName: "Breadboard Runtime"/,
  );
});

test("Runtime root retry replaces the single-use process only after exit", () => {
  assert.match(source, /if \(this\.runtimeRestartInFlight\) return this\.runtimeRestartInFlight;/);
  assert.match(
    source,
    /const stopped = await previousRuntime\.stop\(\);[\s\S]{0,420}if \(!stopped\.exited\)[\s\S]{0,900}this\.runtime = this\.createRuntimeProcess\(\);[\s\S]{0,120}await this\.startRuntime\(\);/,
  );
  assert.match(
    source,
    /this\.allowedOrigins\.origins\.delete\(new URL\(this\.runtimeDashboardUrl\)\.origin\);/,
  );
});
