import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  emptyIngestTokenUsage,
  recordIngestTokenUsageEvent,
  sumIngestTokenUsage,
} from "../src/lib/ingest-token-usage.ts";

test("document ingestion accumulates OCR and map-generation usage across calls", () => {
  let usage = emptyIngestTokenUsage();
  usage = recordIngestTokenUsageEvent(usage, { type: "started" });
  usage = recordIngestTokenUsageEvent(usage, {
    type: "completed",
    usage: {
      inputTokens: 10_000,
      outputTokens: 2_000,
      totalTokens: 12_000,
      cachedInputTokens: 500,
      reasoningTokens: 300,
    },
  });
  usage = recordIngestTokenUsageEvent(usage, { type: "started" });
  usage = recordIngestTokenUsageEvent(usage, { type: "completed", usage: null });

  assert.deepEqual(usage, {
    inputTokens: 10_000,
    outputTokens: 2_000,
    totalTokens: 12_000,
    cachedInputTokens: 500,
    reasoningTokens: 300,
    estimated: false,
    startedCalls: 2,
    completedCalls: 2,
    reportedCalls: 1,
    unreportedCalls: 1,
    inFlightCalls: 0,
  });
  assert.equal(sumIngestTokenUsage([usage, usage]).totalTokens, 24_000);
  assert.equal(
    sumIngestTokenUsage([
      { ...usage, model: "gpt-5.6-sol" },
      { ...usage, model: "gpt-5.6-sol" },
    ]).model,
    "gpt-5.6-sol",
  );
});

test("ingestion streams actual usage and both document-upload interfaces render it", () => {
  const route = fs.readFileSync(
    new URL("../src/app/api/ingest/route.ts", import.meta.url),
    "utf8",
  );
  const worker = fs.readFileSync(
    new URL("../scripts/runtime-v2-document-ingestion-worker.mjs", import.meta.url),
    "utf8",
  );
  const compatibility = fs.readFileSync(
    new URL("../src/lib/runtime-v2/ingest-compatibility.ts", import.meta.url),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    new URL("../src/app/dashboard/dashboard-client.tsx", import.meta.url),
    "utf8",
  );
  const workspace = fs.readFileSync(
    new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url),
    "utf8",
  );
  const panel = fs.readFileSync(
    new URL("../src/app/components/document-ingestion-token-usage.tsx", import.meta.url),
    "utf8",
  );

  assert.match(route, /jobType: "document-ingestion"/);
  assert.doesNotMatch(route, /attachIngestTokenUsageTracking/);
  assert.match(worker, /attachIngestTokenUsageTracking/);
  assert.match(worker, /progress\.usage\(\{ \.\.\.tokenUsage, model: request\.model \}\)/);
  assert.match(compatibility, /send\(\{ type: "usage", tokenUsage \}\)/);
  assert.match(compatibility, /send\(\{ type: "result", \.\.\.result \}\)/);
  assert.match(compatibility, /terminalErrorEvent\([\s\S]*?tokenUsage/);
  assert.match(dashboard, /<DocumentIngestionTokenUsage/);
  assert.match(workspace, /<DocumentIngestionTokenUsage/);
  assert.match(dashboard, /usage=\{ingestionTokenUsage\}[\s\S]*?pending=\{isUploading\}/);
  assert.match(
    workspace,
    /usage=\{ingestionTokenUsage\}[\s\S]*?pending=\{modalIsUploading\}/,
  );
  assert.ok(
    dashboard.indexOf("<DocumentIngestionTokenUsage", dashboard.indexOf("uploadFiles.map")) <
      dashboard.indexOf("hasHandwritingCompatibleFile", dashboard.indexOf("uploadFiles.map")),
    "dashboard usage summary should sit between the file area and ingestion options",
  );
  assert.ok(
    workspace.indexOf(
      "<DocumentIngestionTokenUsage",
      workspace.indexOf("modalUploadFiles.map"),
    ) <
      workspace.indexOf(
        "{/* Handwriting checkbox */}",
        workspace.indexOf("modalUploadFiles.map"),
      ),
    "workspace usage summary should sit between the file area and ingestion options",
  );
  assert.match(panel, /Input[\s\S]*?Output[\s\S]*?Reasoning[\s\S]*?Total/);
  assert.match(panel, /Waiting for usage/);
  assert.match(panel, /Document ingestion token usage for/);
  assert.match(panel, /<ModelCallIndicator model=\{usage\.model\}/);
});

test("the ingestion warning appears only for explicit ChatMock vision errors", () => {
  const route = fs.readFileSync(
    new URL("../src/app/api/ingest/route.ts", import.meta.url),
    "utf8",
  );
  const worker = fs.readFileSync(
    new URL("../src/lib/runtime-v2/ingest-executor.ts", import.meta.url),
    "utf8",
  );
  const compatibility = fs.readFileSync(
    new URL("../src/lib/runtime-v2/ingest-compatibility.ts", import.meta.url),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    new URL("../src/app/dashboard/dashboard-client.tsx", import.meta.url),
    "utf8",
  );
  const workspace = fs.readFileSync(
    new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url),
    "utf8",
  );
  const notice = fs.readFileSync(
    new URL(
      "../src/app/components/document-ingestion-vision-error.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(route, /jobType: "document-ingestion"/);
  assert.match(worker, /visionError: visionError \|\| undefined/);
  assert.match(worker, /new ChatmockVisionError/);
  assert.match(compatibility, /visionError: failure\.visionError/);
  assert.doesNotMatch(dashboard, /hasPdfFile && <DocumentIngestion/);
  assert.doesNotMatch(workspace, /hasPdfFile && <DocumentIngestion/);
  assert.match(dashboard, /<DocumentIngestionVisionError errors=\{ingestionVisionErrors\}/);
  assert.match(workspace, /<DocumentIngestionVisionError errors=\{ingestionVisionErrors\}/);
  assert.match(notice, /if \(errors\.length === 0\) return null/);
  assert.match(notice, /ChatMock vision could not fully read this upload/);
});
