import test from "node:test";
import assert from "node:assert/strict";
import {
  classify,
  hostAllowed,
  hostOf,
  ApprovalRegistry,
  ApprovalError,
} from "../src/approval-policy.ts";

const cfg = { approvalMode: "sensitive_actions" as const, allowedDomains: ["example.com"] };

test("hostAllowed: empty allowlist = unrestricted", () => {
  assert.equal(hostAllowed("anything.com", []), true);
});

test("hostAllowed: apex + subdomain match, others blocked", () => {
  assert.equal(hostAllowed("example.com", ["example.com"]), true);
  assert.equal(hostAllowed("www.example.com", ["example.com"]), true);
  assert.equal(hostAllowed("evil.com", ["example.com"]), false);
  assert.equal(hostAllowed("notexample.com", ["example.com"]), false);
});

test("hostOf parses and rejects garbage", () => {
  assert.equal(hostOf("https://a.example.com/x"), "a.example.com");
  assert.equal(hostOf("not a url"), null);
});

test("form submission always sensitive (high)", () => {
  const c = classify({ toolName: "browser_click", action: "submit", target: "b", submitIntent: true }, cfg);
  assert.equal(c.sensitive, true);
  assert.equal(c.risk, "high");
});

test("navigation off allowlist is sensitive", () => {
  const c = classify(
    { toolName: "browser_navigate", action: "navigate", target: "u", targetUrl: "https://evil.com" },
    cfg,
  );
  assert.equal(c.sensitive, true);
});

test("navigation within allowlist not sensitive", () => {
  const c = classify(
    { toolName: "browser_navigate", action: "navigate", target: "u", targetUrl: "https://www.example.com/a" },
    cfg,
  );
  assert.equal(c.sensitive, false);
});

test("plain click not sensitive in sensitive_actions mode", () => {
  const c = classify({ toolName: "browser_click", action: "click", target: "a" }, cfg);
  assert.equal(c.sensitive, false);
});

test("actual desktop control always requires high-risk approval", () => {
  const c = classify(
    { toolName: "desktop_session", action: "desktop_control", target: "Actual desktop" },
    { approvalMode: "sensitive_actions", allowedDomains: [] },
  );
  assert.equal(c.sensitive, true);
  assert.equal(c.risk, "high");
  assert.match(c.explanation, /actual desktop/i);
});

test("every_action mode makes everything sensitive", () => {
  const c = classify(
    { toolName: "browser_click", action: "click", target: "a" },
    { approvalMode: "every_action", allowedDomains: [] },
  );
  assert.equal(c.sensitive, true);
});

test("eval / upload / download / clipboard sensitive", () => {
  assert.equal(classify({ toolName: "browser_evaluate", action: "click", target: "js", isEval: true }, cfg).sensitive, true);
  assert.equal(classify({ toolName: "x", action: "upload", target: "f", isUpload: true }, cfg).sensitive, true);
  assert.equal(classify({ toolName: "x", action: "download", target: "f", isDownload: true }, cfg).sensitive, true);
  assert.equal(classify({ toolName: "x", action: "click", target: "c", readsClipboard: true }, cfg).sensitive, true);
});

// -------------------- registry --------------------

function fixedClock(startMs: number) {
  let t = startMs;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test("approval is single-use; replay rejected", () => {
  const reg = new ApprovalRegistry();
  const req = reg.create({ runId: "r1", action: "submit", target: "b", explanation: "e", risk: "high" });
  assert.equal(reg.decide(req.actionId, "approved", { runId: "r1" }), "approved");
  assert.throws(() => reg.decide(req.actionId, "approved", { runId: "r1" }), (e) => e instanceof ApprovalError && e.code === "already_decided");
});

test("expired approval cannot be approved", () => {
  const clock = fixedClock(1000);
  const reg = new ApprovalRegistry(clock.now);
  const req = reg.create({ runId: "r1", action: "submit", target: "b", explanation: "e", risk: "high", ttlMs: 100 });
  clock.advance(200);
  assert.throws(() => reg.decide(req.actionId, "approved", { runId: "r1" }), (e) => e instanceof ApprovalError && e.code === "expired");
});

test("run mismatch rejected (no cross-run approval)", () => {
  const reg = new ApprovalRegistry();
  const req = reg.create({ runId: "r1", action: "submit", target: "b", explanation: "e", risk: "high" });
  assert.throws(() => reg.decide(req.actionId, "approved", { runId: "OTHER" }), (e) => e instanceof ApprovalError && e.code === "run_mismatch");
});

test("unknown action id rejected", () => {
  const reg = new ApprovalRegistry();
  assert.throws(() => reg.decide("nope", "approved"), (e) => e instanceof ApprovalError && e.code === "not_found");
});

test("rejection resolves the paused gate with 'rejected'", async () => {
  const reg = new ApprovalRegistry();
  let resolved: string | undefined;
  const req = reg.create({
    runId: "r1", action: "submit", target: "b", explanation: "e", risk: "high",
    resolve: (d) => { resolved = d; },
  });
  reg.decide(req.actionId, "rejected", { runId: "r1" });
  assert.equal(resolved, "rejected");
});

test("invalidateRun rejects all pending (abort case)", () => {
  const reg = new ApprovalRegistry();
  let resolved: string | undefined;
  const req = reg.create({
    runId: "r1", action: "submit", target: "b", explanation: "e", risk: "high",
    resolve: (d) => { resolved = d; },
  });
  reg.invalidateRun("r1");
  assert.equal(resolved, "rejected");
  assert.throws(() => reg.decide(req.actionId, "approved", { runId: "r1" }), (e) => e instanceof ApprovalError && e.code === "already_decided");
});
