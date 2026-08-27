import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(relativePath) {
  return fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");
}

test("Learn status polling is single-flight and aborts obsolete requests", () => {
  const clients = [
    read("src/app/gardens/[clusterSlug]/workspace-client.tsx"),
    read("src/app/garden/garden-assistant.tsx"),
  ];

  for (const client of clients) {
    assert.match(client, /const learnStatusRequestRef = useRef</u);
    assert.match(client, /existing\?\.clusterSlug ===/u);
    assert.match(client, /!existing\.controller\.signal\.aborted/u);
    assert.match(client, /return existing\.promise/u);
    assert.match(client, /signal: controller\.signal/u);
    assert.match(client, /learnStatusRequestRef\.current = null/u);
    assert.match(client, /request\.controller\.abort\(\)/u);
  }
});

test("Learn read-only Runtime projection has a fixed short deadline", () => {
  const supervisor = read("src/lib/supervisor-control.ts");
  const projection = read("src/lib/learn-operation-runtime-v2.ts");

  assert.match(supervisor, /const STATUS_CONTROL_TIMEOUT_MS = 5_000;/u);
  assert.match(supervisor, /timeoutMs = CONTROL_TIMEOUT_MS/u);
  assert.match(
    supervisor,
    /setTimeout\(\(\) => controller\.abort\(\), timeoutMs\)/u,
  );
  for (const helper of [
    "inspectRuntimeJobForStatus",
    "replayRuntimeJobEventsForStatus",
  ]) {
    const start = supervisor.indexOf(`export async function ${helper}`);
    assert.notEqual(start, -1, `${helper} is missing`);
    assert.match(
      supervisor.slice(start, start + 2_000),
      /STATUS_CONTROL_TIMEOUT_MS/u,
    );
    assert.match(projection, new RegExp(`\\b${helper}\\b`, "u"));
  }
  assert.match(
    projection,
    /inspectReceiptJob\([\s\S]{0,240}?receipt,[\s\S]{0,80}?true,[\s\S]{0,40}?\)/u,
  );
});
