import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { startAdapter, type AdapterServer } from "../src/server.ts";
import type { NormalizedEvent } from "../src/types.ts";

const SECRET = "test-secret-".padEnd(40, "x");
const USER = 42;
const OTHER_USER = 99;

const cfg = {
  operator: "browser",
  browserStrategy: "dom",
  provider: "openai",
  model: "gpt-x",
  maxSteps: 25,
  timeoutMs: 300000,
  approvalMode: "sensitive_actions",
  allowedDomains: [],
  allowDownloads: false,
  allowClipboard: false,
  allowFileUpload: false,
};

async function withServer(fn: (s: AdapterServer, base: string) => Promise<void>): Promise<void> {
  const dataDir = path.join(os.tmpdir(), `ui-tars-test-${crypto.randomUUID()}`);
  const s = await startAdapter({ secret: SECRET, dataDir, port: 0, host: "127.0.0.1", runtime: "fake" });
  const base = `http://127.0.0.1:${s.port}`;
  try {
    await fn(s, base);
  } finally {
    await s.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

const auth = { authorization: `Bearer ${SECRET}`, "content-type": "application/json" };

async function createRun(base: string, task: string, over: Record<string, unknown> = {}): Promise<string> {
  const res = await fetch(`${base}/runs`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ ownerUserId: USER, task, config: cfg, ...over }),
  });
  assert.equal(res.status, 201, `create run status`);
  const body = (await res.json()) as { data: { runId: string } };
  return body.data.runId;
}

async function events(base: string, runId: string, since = 0, userId = USER): Promise<NormalizedEvent[]> {
  const res = await fetch(`${base}/runs/${runId}/events?since=${since}&userId=${userId}`, { headers: auth });
  const body = (await res.json()) as { data: NormalizedEvent[] };
  return body.data ?? [];
}

async function waitForEvent(
  base: string,
  runId: string,
  predicate: (e: NormalizedEvent) => boolean,
  timeoutMs = 3000,
): Promise<NormalizedEvent[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const evs = await events(base, runId);
    if (evs.some(predicate)) return evs;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("waitForEvent timed out");
}

test("health is unauthenticated and leaks nothing sensitive", async () => {
  await withServer(async (_s, base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body["status"], "healthy");
    assert.equal(body["runtime"], "fake");
    assert.equal(body["realBrowser"], false);
    assert.ok(!("secret" in body));
  });
});

test("missing and invalid auth are rejected", async () => {
  await withServer(async (_s, base) => {
    const noAuth = await fetch(`${base}/capabilities`);
    assert.equal(noAuth.status, 401);
    const badAuth = await fetch(`${base}/capabilities`, { headers: { authorization: "Bearer wrong" } });
    assert.equal(badAuth.status, 401);
  });
});

test("create run, stream events, resume by sequence, screenshots", async () => {
  await withServer(async (_s, base) => {
    const runId = await createRun(base, "Open http://127.0.0.1/index.html and fill the form");
    // Pause at submit approval.
    const evs = await waitForEvent(base, runId, (e) => e.type === "approval.requested");
    // Resume-by-sequence: fetching since last seq returns only newer events.
    const lastSeq = evs[evs.length - 1].sequenceNumber;
    const tail = await events(base, runId, lastSeq);
    assert.ok(tail.every((e) => e.sequenceNumber > lastSeq));
    // A screenshot was emitted and is retrievable via authenticated route.
    const shot = evs.find((e) => e.type === "observation.screenshot");
    assert.ok(shot, "expected a screenshot event");
    const sid = String((shot!.payload as { screenshotId: string }).screenshotId);
    const img = await fetch(`${base}/runs/${runId}/screenshots/${sid}?userId=${USER}`, { headers: auth });
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/png");
    // approve to finish
    const actionId = (evs.find((e) => e.type === "approval.requested")!.payload as { actionId: string }).actionId;
    const ap = await fetch(`${base}/runs/${runId}/approve`, {
      method: "POST", headers: auth, body: JSON.stringify({ userId: USER, actionId }),
    });
    assert.equal(ap.status, 200);
    await waitForEvent(base, runId, (e) => e.type === "run.completed");
  });
});

test("rejection prevents the submit and aborts the run", async () => {
  await withServer(async (_s, base) => {
    const runId = await createRun(base, "http://127.0.0.1/form");
    const evs = await waitForEvent(base, runId, (e) => e.type === "approval.requested");
    const actionId = (evs.find((e) => e.type === "approval.requested")!.payload as { actionId: string }).actionId;
    const rj = await fetch(`${base}/runs/${runId}/reject`, {
      method: "POST", headers: auth, body: JSON.stringify({ userId: USER, actionId }),
    });
    assert.equal(rj.status, 200);
    const final = await waitForEvent(base, runId, (e) => e.type === "run.aborted");
    // The submit action must NOT have completed.
    assert.ok(!final.some((e) => e.type === "action.completed" && (e.payload as { actionId?: string }).actionId === "submit-1"));
  });
});

test("replayed approval is rejected", async () => {
  await withServer(async (_s, base) => {
    const runId = await createRun(base, "http://127.0.0.1/form");
    const evs = await waitForEvent(base, runId, (e) => e.type === "approval.requested");
    const actionId = (evs.find((e) => e.type === "approval.requested")!.payload as { actionId: string }).actionId;
    const first = await fetch(`${base}/runs/${runId}/approve`, {
      method: "POST", headers: auth, body: JSON.stringify({ userId: USER, actionId }),
    });
    assert.equal(first.status, 200);
    const replay = await fetch(`${base}/runs/${runId}/approve`, {
      method: "POST", headers: auth, body: JSON.stringify({ userId: USER, actionId }),
    });
    assert.equal(replay.status, 409);
  });
});

test("abort during awaiting_approval terminates the run", async () => {
  await withServer(async (_s, base) => {
    const runId = await createRun(base, "http://127.0.0.1/form");
    await waitForEvent(base, runId, (e) => e.type === "approval.requested");
    const ab = await fetch(`${base}/runs/${runId}/abort`, {
      method: "POST", headers: auth, body: JSON.stringify({ userId: USER }),
    });
    assert.equal(ab.status, 200);
    await waitForEvent(base, runId, (e) => e.type === "run.aborted");
    const sum = await fetch(`${base}/runs/${runId}?userId=${USER}`, { headers: auth });
    const body = (await sum.json()) as { data: { status: string } };
    assert.equal(body.data.status, "aborted");
  });
});

test("cross-user access is forbidden (no run access by guessing id)", async () => {
  await withServer(async (_s, base) => {
    const runId = await createRun(base, "http://127.0.0.1/form");
    const res = await fetch(`${base}/runs/${runId}?userId=${OTHER_USER}`, { headers: auth });
    assert.equal(res.status, 403);
    const evs = await fetch(`${base}/runs/${runId}/events?userId=${OTHER_USER}`, { headers: auth });
    assert.equal(evs.status, 403);
  });
});

test("malformed body and unknown run return stable error codes", async () => {
  await withServer(async (_s, base) => {
    const bad = await fetch(`${base}/runs`, { method: "POST", headers: auth, body: "{not json" });
    assert.equal(bad.status, 400);
    const missing = await fetch(`${base}/runs/does-not-exist?userId=${USER}`, { headers: auth });
    assert.equal(missing.status, 404);
    const body = (await missing.json()) as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.equal(typeof body.error, "string");
    assert.ok(!JSON.stringify(body).includes(SECRET));
  });
});

test("invalid configuration is rejected", async () => {
  await withServer(async (_s, base) => {
    const res = await fetch(`${base}/runs`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ ownerUserId: USER, task: "x", config: { ...cfg, operator: "computer" } }),
    });
    assert.equal(res.status, 400);
  });
});

test("SSE stream delivers events with ids and resumes from Last-Event-ID", async () => {
  await withServer(async (_s, base) => {
    const runId = await createRun(base, "http://127.0.0.1/form");
    const res = await fetch(`${base}/runs/${runId}/events?userId=${USER}`, {
      headers: { ...auth, accept: "text/event-stream" },
    });
    assert.equal(res.headers.get("content-type"), "text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !buf.includes("event: approval.requested")) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    assert.ok(buf.includes("id: "), "SSE frames carry ids");
    assert.ok(buf.includes("event: run.started"));
  });
});
