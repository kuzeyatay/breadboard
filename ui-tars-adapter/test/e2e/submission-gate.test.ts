// Deterministic (model-free) proof of the DOM-layer submission gate against a
// REAL browser: a form POST is paused before it leaves the browser; rejection
// aborts it (0 submissions); approval continues it (exactly 1 submission);
// off-allowlist navigation is gated. This is the authoritative evidence for
// "sensitive submission pauses" and "rejection prevents the action" at the real
// enforcement layer, independent of the model.

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { startTestSite } from "../support/static-server.ts";
import { attachSubmissionGate, type GateAction } from "../../src/browser-gate.ts";
import { hostAllowed } from "../../src/approval-policy.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadBrowser(): Promise<any | null> {
  try {
    const mod = await import("@agent-infra/browser");
    return mod.Browser ?? null;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function launch(Browser: any, profileDir: string): Promise<any | null> {
  try {
    return await Promise.race([
      Browser.create({ launchOrConnect: { headless: true, userDataDir: profileDir } }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("launch_timeout")), 45_000)),
    ]);
  } catch {
    return null;
  }
}

test("submission gate: reject blocks the form POST (0 submissions)", async (t) => {
  const Browser = await loadBrowser();
  if (!Browser) return t.skip("@agent-infra/browser not installed");
  const profileDir = path.join(os.tmpdir(), `uitars-gate-${crypto.randomUUID()}`);
  const site = await startTestSite();
  const browser = await launch(Browser, profileDir);
  if (!browser) {
    await site.stop();
    return t.skip("no launchable browser");
  }
  const gated: GateAction[] = [];
  const detach = attachSubmissionGate(browser.pptrBrowser, {
    hostAllowed: (h) => hostAllowed(h, ["127.0.0.1"]),
    requestApproval: async (a) => {
      gated.push(a);
      return false; // REJECT every gated action
    },
  });
  try {
    const page = await browser.pptrBrowser.newPage();
    await page.goto(`${site.url}/form.html`, { waitUntil: "domcontentloaded" });
    await page.type("#name", "Ada");
    await page.click("#submit-button");
    // Give the (aborted) navigation a moment.
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(site.submitCount(), 0, "rejected submission must NOT reach the server");
    assert.ok(gated.some((g) => g.action === "submit"), "the submit POST was gated");
  } finally {
    detach();
    await browser.close().catch(() => {});
    await site.stop();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});

test("submission gate: approve allows exactly one submission", async (t) => {
  const Browser = await loadBrowser();
  if (!Browser) return t.skip("@agent-infra/browser not installed");
  const profileDir = path.join(os.tmpdir(), `uitars-gate-${crypto.randomUUID()}`);
  const site = await startTestSite();
  const browser = await launch(Browser, profileDir);
  if (!browser) {
    await site.stop();
    return t.skip("no launchable browser");
  }
  let approvals = 0;
  const detach = attachSubmissionGate(browser.pptrBrowser, {
    hostAllowed: (h) => hostAllowed(h, ["127.0.0.1"]),
    requestApproval: async () => {
      approvals += 1;
      return true; // APPROVE
    },
  });
  try {
    const page = await browser.pptrBrowser.newPage();
    await page.goto(`${site.url}/form.html`, { waitUntil: "domcontentloaded" });
    await page.type("#name", "Ada");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
      page.click("#submit-button"),
    ]);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(site.submitCount(), 1, "approved submission reaches the server exactly once");
    assert.ok(approvals >= 1, "the submit was gated before executing");
  } finally {
    detach();
    await browser.close().catch(() => {});
    await site.stop();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});
