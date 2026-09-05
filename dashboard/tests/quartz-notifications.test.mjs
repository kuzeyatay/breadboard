import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const libraryGardenClient = fs.readFileSync(
  new URL("../src/app/garden/library-garden-client.tsx", import.meta.url),
  "utf8",
);
const singleGardenClient = fs.readFileSync(
  new URL("../src/app/garden/[clusterSlug]/garden-client.tsx", import.meta.url),
  "utf8",
);

function assertNotificationHost(source, label) {
  assert.match(
    source,
    /import \{ Toaster, useToast \} from ['"]@\/app\/components\/toast['"]/,
    `${label} must load the shared notification inbox`,
  );
  assert.match(
    source,
    /const \{ toasts, dismissToast \} = useToast\(\)/,
    `${label} must poll durable notifications`,
  );
  assert.match(
    source,
    /<Toaster\s+toasts=\{toasts\}\s+onDismiss=\{dismissToast\}\s*\/>/,
    `${label} must render notifications above Quartz`,
  );
}

test("the all-gardens Quartz view shows notifications", () => {
  assertNotificationHost(libraryGardenClient, "the library Garden client");
});

test("the single-garden Quartz view shows notifications", () => {
  assertNotificationHost(singleGardenClient, "the single Garden client");
});
