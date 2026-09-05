import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const manifest = JSON.parse(
  fs.readFileSync(
    new URL("../runtime-v2/manifests/workers.json", import.meta.url),
    "utf8",
  ),
);

const worker = (kind) => manifest.workers.find((entry) => entry.kind === kind);

test("large document ingestion has bounded textbook-scale limits", () => {
  const ingestion = worker("document-ingestion-node");
  assert.ok(ingestion, "document ingestion worker is registered");
  assert.ok(
    ingestion.softCommitLimitMb >= 8192,
    "VLM plus AnyDoc ingestion must retain at least an 8 GiB soft limit",
  );
  assert.ok(
    ingestion.hardCommitLimitMb >= 10240,
    "VLM plus AnyDoc ingestion must retain at least a 10 GiB hard limit",
  );
  assert.ok(
    ingestion.maximumRuntimeMs >= 43_200_000,
    "multi-thousand-page VLM ingestion must retain a 12 hour deadline",
  );
});

test("publishing a large generated garden retains its raised memory limits", () => {
  const publisher = worker("quartz-publish-node");
  assert.ok(publisher, "Quartz publisher worker is registered");
  assert.ok(publisher.softCommitLimitMb >= 8192);
  assert.ok(publisher.hardCommitLimitMb >= 10240);
});
