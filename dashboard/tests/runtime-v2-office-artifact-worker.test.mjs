import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  loadRuntimeV2OfficeLaunch,
  parseRuntimeV2OfficeStopRecord,
} from "../scripts/runtime-v2-office-artifact-worker.mjs";
import { officeCliEnv, resolveOfficeCli } from "../src/lib/office/officecli.ts";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerPath = path.join(dashboardRoot, "scripts", "runtime-v2-office-artifact-worker.mjs");

test("finite Office workers disable OfficeCLI auto-resident mode", () => {
  const environment = officeCliEnv({
    OFFICECLI_SKIP_UPDATE: "0",
    OFFICECLI_NO_AUTO_RESIDENT: "0",
    OFFICECLI_RESIDENT_FLUSH: "off",
  });
  assert.equal(environment.OFFICECLI_SKIP_UPDATE, "1");
  assert.equal(environment.OFFICECLI_NO_AUTO_RESIDENT, "1");
  assert.equal(environment.OFFICECLI_RESIDENT_FLUSH, "each");
});

function fixture({ operation = "export", scope } = {}) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-office-worker-test-"));
  const identity = {
    jobId: `job_office_${operation}`,
    attempt: 1,
    workerInstanceId: `worker_office_${operation}`,
  };
  const executionScope = scope ?? {
    userId: 17,
    gardenId: "garden-one",
    conversationId: "conv_office_test",
  };
  const jobRoot = path.join(dataRoot, "runtime", "jobs", identity.jobId);
  const attemptRoot = path.join(jobRoot, "attempts", "1", identity.workerInstanceId);
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  const request = operation === "command"
    ? { operation, runtimeSessionId: 41, command: "help" }
    : operation === "markdown-pdf"
      ? { operation, filename: "folder-notes.pdf", documentCount: 1 }
      : { operation, relativeFile: "report.docx", title: "Runtime report" };
  fs.writeFileSync(path.join(jobRoot, "input.json"), `${JSON.stringify(request)}\n`);
  const inputBlobs = [];
  if (operation === "export" || operation === "markdown-pdf") {
    const blobId = `blob_office_${operation.replace(/-/gu, "_")}`;
    const bytes = operation === "export"
      ? Buffer.from("PK\u0003\u0004bounded-office-fixture", "binary")
      : Buffer.from(`${JSON.stringify({
          protocolVersion: 1,
          title: "Folder notes",
          documents: [{ content: "# One\nFirst note", title: "One" }],
        })}\n`, "utf8");
    const relativePath = `runtime/jobs/${identity.jobId}/inputs/${blobId}/payload`;
    const absolutePath = path.join(dataRoot, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, bytes);
    inputBlobs.push({
      blobId,
      relativePath,
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      displayName: operation === "export" ? "report.docx" : "documents.json",
      mediaType: operation === "export"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/vnd.breadboard.markdown-pdf+json",
    });
  }
  fs.writeFileSync(
    path.join(attemptRoot, "start.json"),
    `${JSON.stringify({
      protocolVersion: 1,
      identity,
      executionScope,
      inputManifestPath: `runtime/jobs/${identity.jobId}/input.json`,
      inputBlobs,
      workspacePath: `runtime/jobs/${identity.jobId}/attempts/1/${identity.workerInstanceId}/workspace`,
      checkpointPath: `runtime/jobs/${identity.jobId}/checkpoint.json`,
      resultPath: `runtime/jobs/${identity.jobId}/result.json`,
    })}\n`,
  );
  return { dataRoot, identity, executionScope, jobRoot, attemptRoot };
}

function installCommandDatabase(current) {
  const databaseDirectory = path.join(current.dataRoot, "database");
  fs.mkdirSync(databaseDirectory, { recursive: true });
  const workspace = path.join(current.dataRoot, "office-session-workspace");
  fs.mkdirSync(workspace);
  const database = new DatabaseSync(path.join(databaseDirectory, "brain.db"));
  try {
    database.exec(`
      CREATE TABLE conversations (id INTEGER PRIMARY KEY, public_id TEXT NOT NULL);
      CREATE TABLE hermes_runtime_sessions (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        conversation_id INTEGER NOT NULL,
        garden_id TEXT,
        active_directory TEXT NOT NULL,
        surface TEXT NOT NULL
      );
    `);
    database.prepare("INSERT INTO conversations (id, public_id) VALUES (?, ?)")
      .run(9, current.executionScope.conversationId);
    database.prepare(`
      INSERT INTO hermes_runtime_sessions
        (id, user_id, conversation_id, garden_id, active_directory, surface)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      41,
      current.executionScope.userId,
      9,
      current.executionScope.gardenId,
      workspace,
      "garden_chat",
    );
  } finally {
    database.close();
  }
}

async function runWorker(current, { stopAfterEventType = null } = {}) {
  const child = spawn(process.execPath, [workerPath, "start.json"], {
    cwd: current.attemptRoot,
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  if (stopAfterEventType === null) child.stdin.end();
  let stdout = "";
  let pendingEvents = "";
  let stopSent = false;
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    pendingEvents += chunk;
    for (;;) {
      const newline = pendingEvents.indexOf("\n");
      if (newline < 0) break;
      const line = pendingEvents.slice(0, newline);
      pendingEvents = pendingEvents.slice(newline + 1);
      if (!stopSent && line) {
        const event = JSON.parse(line);
        if (event.type === stopAfterEventType) {
          stopSent = true;
          child.stdin.end('{"type":"stop","force":false}\n');
        }
      }
    }
  });
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-64 * 1024); });
  const exit = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("The fresh Office worker did not exit."));
    }, 20_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
  return { exit, stdout, stderr };
}

test("Office worker binds exact conversation authority and staged input count", () => {
  const command = fixture({ operation: "command" });
  const exportJob = fixture({ operation: "export" });
  const forged = fixture({
    operation: "export",
    scope: { userId: 0, gardenId: "garden-one", conversationId: "conv_office_test" },
  });
  const conversationlessExport = fixture({
    operation: "export",
    scope: { userId: 17, gardenId: null, conversationId: null },
  });
  const userGlobalPageRender = fixture({
    operation: "export",
    scope: { userId: 17, gardenId: null, conversationId: null },
  });
  const gardenMarkdownPdf = fixture({
    operation: "markdown-pdf",
    scope: { userId: 17, gardenId: "garden-one", conversationId: null },
  });
  try {
    const commandLaunch = loadRuntimeV2OfficeLaunch(["start.json"], command.attemptRoot);
    const exportLaunch = loadRuntimeV2OfficeLaunch(["start.json"], exportJob.attemptRoot);
    assert.equal(commandLaunch.inputBlob, null);
    assert.equal(exportLaunch.inputBlob.displayName, "report.docx");
    assert.deepEqual(exportLaunch.executionScope, exportJob.executionScope);
    assert.throws(
      () => loadRuntimeV2OfficeLaunch(["start.json"], forged.attemptRoot),
      /authenticated conversation scope/u,
    );
    assert.throws(
      () => loadRuntimeV2OfficeLaunch(["start.json"], conversationlessExport.attemptRoot),
      /requires exact conversation authority/u,
    );
    fs.writeFileSync(
      path.join(userGlobalPageRender.jobRoot, "input.json"),
      `${JSON.stringify({ operation: "page-images", format: "docx", maximumPages: 301, width: 1200 })}\n`,
    );
    assert.throws(
      () => loadRuntimeV2OfficeLaunch(["start.json"], userGlobalPageRender.attemptRoot),
      /page-image request is invalid/u,
    );
    fs.writeFileSync(
      path.join(userGlobalPageRender.jobRoot, "input.json"),
      `${JSON.stringify({ operation: "page-images", format: "docx", maximumPages: 300, width: 1200 })}\n`,
    );
    const pageLaunch = loadRuntimeV2OfficeLaunch(["start.json"], userGlobalPageRender.attemptRoot);
    assert.deepEqual(pageLaunch.executionScope, { userId: 17, gardenId: null, conversationId: null });
    assert.equal(pageLaunch.request.maximumPages, 300);
    const markdownPdfLaunch = loadRuntimeV2OfficeLaunch(["start.json"], gardenMarkdownPdf.attemptRoot);
    assert.deepEqual(markdownPdfLaunch.executionScope, {
      userId: 17,
      gardenId: "garden-one",
      conversationId: null,
    });
    assert.equal(markdownPdfLaunch.request.documentCount, 1);
    assert.equal(markdownPdfLaunch.inputBlob.displayName, "documents.json");

    const startPath = path.join(command.attemptRoot, "start.json");
    const start = JSON.parse(fs.readFileSync(startPath, "utf8"));
    start.inputBlobs = exportLaunch.inputBlob ? [exportLaunch.inputBlob] : [];
    fs.writeFileSync(startPath, `${JSON.stringify(start)}\n`);
    assert.throws(
      () => loadRuntimeV2OfficeLaunch(["start.json"], command.attemptRoot),
      /wrong number of staged inputs/u,
    );
  } finally {
    for (const current of [
      command,
      exportJob,
      forged,
      conversationlessExport,
      userGlobalPageRender,
      gardenMarkdownPdf,
    ]) {
      fs.rmSync(current.dataRoot, { recursive: true, force: true });
    }
  }
});

test("Office worker stop input is exact and bounded", () => {
  assert.deepEqual(parseRuntimeV2OfficeStopRecord('{"type":"stop","force":false}\n'), {
    type: "stop",
    force: false,
  });
  for (const invalid of [
    '{"type":"stop","force":true}\n',
    '{"type":"stop","force":false,"jobId":"forged"}\n',
    '{"type":"stop","force":false}',
    "{}\n",
  ]) {
    assert.throws(() => parseRuntimeV2OfficeStopRecord(invalid), /stop record/u);
  }
});

test("a supervisor stop cancels the fresh worker without retaining export staging", async () => {
  const current = fixture({ operation: "export" });
  try {
    const run = await runWorker(current, { stopAfterEventType: "ready" });
    assert.deepEqual(run.exit, { code: 0, signal: null }, run.stderr);
    const events = run.stdout.trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
    assert.ok(events.some((event) => event.type === "cancellation-acknowledged"));
    assert.equal(events.some((event) => event.type === "complete"), false);
    assert.equal(fs.existsSync(path.join(current.jobRoot, "result.json")), false);
    assert.equal(fs.existsSync(path.join(current.attemptRoot, "workspace", "office-stage")), false);
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
  }
});

test("a fresh export worker stages file references, writes one result, and exits", async () => {
  const current = fixture({ operation: "export" });
  try {
    const run = await runWorker(current);
    assert.deepEqual(run.exit, { code: 0, signal: null }, run.stderr);
    const events = run.stdout.trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
    assert.equal(events[0]?.type, "ready");
    assert.equal(events.at(-1)?.type, "complete");
    assert.ok(events.some((event) => event.type === "artifact" && event.kind === "document"));
    assert.ok(events.every((event, index) => event.sequence === index + 1));
    const result = JSON.parse(fs.readFileSync(path.join(current.jobRoot, "result.json"), "utf8"));
    assert.deepEqual(result.identity, current.identity);
    assert.equal(result.completionSequence, events.at(-1).sequence);
    assert.equal(result.result.operation, "export");
    assert.match(result.result.outputRelativePath, /\/workspace\/office-stage\/report\.docx$/u);
    assert.equal(
      fs.readFileSync(path.join(
        current.dataRoot,
        ...result.result.outputRelativePath.split("/"),
      ), "binary"),
      "PK\u0003\u0004bounded-office-fixture",
    );
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
  }
});

test("a fresh Markdown PDF worker renders a sealed folder bundle and exits", async () => {
  const current = fixture({
    operation: "markdown-pdf",
    scope: { userId: 17, gardenId: null, conversationId: null },
  });
  try {
    const run = await runWorker(current);
    assert.deepEqual(run.exit, { code: 0, signal: null }, run.stderr);
    const events = run.stdout.trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
    assert.equal(events[0]?.type, "ready");
    assert.equal(events.at(-1)?.type, "complete");
    assert.ok(events.every((event, index) => event.sequence === index + 1));
    const result = JSON.parse(fs.readFileSync(path.join(current.jobRoot, "result.json"), "utf8"));
    assert.deepEqual(result.identity, current.identity);
    assert.equal(result.result.operation, "markdown-pdf");
    assert.equal(result.result.mimeType, "application/pdf");
    assert.match(result.result.outputRelativePath, /\/workspace\/office-stage\/folder-notes\.pdf$/u);
    const bytes = fs.readFileSync(path.join(
      current.dataRoot,
      ...result.result.outputRelativePath.split("/"),
    ));
    assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
  }
});

test("an export failure after atomic promotion removes the transient stage", async () => {
  const current = fixture({ operation: "export" });
  fs.writeFileSync(path.join(current.jobRoot, "result.json"), "occupied\n");
  try {
    const run = await runWorker(current);
    assert.deepEqual(run.exit, { code: 1, signal: null }, run.stderr);
    const events = run.stdout.trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
    assert.ok(events.some((event) => event.type === "artifact"));
    assert.equal(events.at(-1)?.type, "failed");
    assert.deepEqual(fs.readdirSync(path.join(current.attemptRoot, "workspace")), []);
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
  }
});

test("a fresh command worker verifies the database scope, runs once, and exits", {
  skip: resolveOfficeCli() === null && "OfficeCLI is not provisioned",
}, async () => {
  const current = fixture({ operation: "command" });
  installCommandDatabase(current);
  try {
    const run = await runWorker(current);
    assert.deepEqual(run.exit, { code: 0, signal: null }, run.stderr);
    const events = run.stdout.trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
    assert.equal(events[0]?.type, "ready");
    assert.equal(events.at(-1)?.type, "complete");
    const result = JSON.parse(fs.readFileSync(path.join(current.jobRoot, "result.json"), "utf8"));
    assert.equal(result.result.operation, "command");
    assert.equal(result.result.command, "help");
    assert.equal(result.result.exitCode, 0, result.result.output);
    assert.match(result.result.output, /officecli/i);
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
  }
});
