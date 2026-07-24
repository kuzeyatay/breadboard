// Real-browser isolation + process-ownership integration test.
//
// Exercises the SAME @agent-infra/browser LocalBrowser the AgentTarsRuntimeClient
// uses, proving (with a real Chromium/Edge, no model required):
//  - launch into a DEDICATED isolated profile dir (never the user's profile),
//  - a real PNG screenshot,
//  - a real form submission is possible through the browser,
//  - close() terminates the owned OS process (cleanup).
//
// Skips cleanly when no browser is discoverable or deps aren't installed, so CI
// without a browser still passes. The model-driven agentic flow (LLM navigation +
// approval pause) additionally requires a configured UI-TARS model endpoint and
// is covered by the documented real E2E command, not here.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { startTestSite } from "../support/static-server.ts";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tryLoadBrowser(): Promise<any | null> {
  try {
    const mod = await import("@agent-infra/browser");
    // Published @agent-infra/browser@0.2.2 exposes `Browser` (factory-created).
    return mod.Browser ?? null;
  } catch {
    return null;
  }
}

test("real isolated browser: launch, screenshot, submit, cleanup", async (t) => {
  const Browser = await tryLoadBrowser();
  if (!Browser) {
    t.skip("@agent-infra/browser not installed");
    return;
  }

  const profileDir = path.join(os.tmpdir(), `uitars-e2e-${crypto.randomUUID()}`);
  const site = await startTestSite();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any = null;
  let pid: number | undefined;

  try {
    // Isolated: dedicated userDataDir, never the user's profile.
    browser = await Promise.race([
      Browser.create({ launchOrConnect: { headless: true, userDataDir: profileDir } }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("launch_timeout")), 45_000)),
    ]);
  } catch (err) {
    await site.stop();
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
    t.skip(`no launchable browser: ${(err as Error).message}`);
    return;
  }

  try {
    const pup = browser.pptrBrowser;
    pid = pup.process?.()?.pid;
    assert.ok(typeof pid === "number" && isAlive(pid), "browser process should be alive");

    // Isolated profile directory was created and populated — NOT the user's.
    assert.ok(fs.existsSync(profileDir), "dedicated profile dir should exist");
    assert.ok(fs.readdirSync(profileDir).length > 0, "profile dir should be populated");

    const page = await pup.newPage();
    await page.goto(`${site.url}/index.html`, { waitUntil: "domcontentloaded" });
    const title = await page.title();
    assert.match(title, /UI-TARS Test Site/);

    const shot = (await page.screenshot()) as Buffer | Uint8Array;
    const shotBuf = Buffer.from(shot);
    assert.ok(shotBuf.length > 0, "a real screenshot was captured");
    assert.ok(shotBuf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "PNG");

    // A real submission is possible through the real browser.
    await page.goto(`${site.url}/form.html`, { waitUntil: "domcontentloaded" });
    await page.type("#name", "Ada");
    await page.type("#email", "ada@example.com");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
      page.click("#submit-button"),
    ]);
    assert.equal(site.submitCount(), 1, "exactly one submission occurred");
  } finally {
    await browser.close().catch(() => {});
    await site.stop();
  }

  // Give the OS a moment, then assert the owned process is gone (cleanup).
  await new Promise((r) => setTimeout(r, 1500));
  if (typeof pid === "number") {
    assert.ok(!isAlive(pid), "browser process should be terminated after close()");
  }
  fs.rmSync(profileDir, { recursive: true, force: true });
});
