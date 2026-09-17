import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import path from "node:path";
import { mkdir } from "node:fs/promises";

const root = path.resolve(import.meta.dirname, "..");

async function eventually(check) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("Usage UI did not settle");
}

test("new tabs refresh every provider, poll read-only, and recover from Claude cooldowns", { timeout: 60_000 }, async () => {
  const bundle = await build({
    absWorkingDir: root,
    stdin: {
      contents: `import {StrictMode} from 'react'; import {createRoot} from 'react-dom/client';
        import Notch from './src/app/new-tab/provider-usage-notch';
        createRoot(document.getElementById('root')).render(<StrictMode><Notch /></StrictMode>);`,
      resolveDir: root, loader: "tsx",
    },
    bundle: true, write: false, outfile: "usage-fixture.js", platform: "browser", format: "iife", jsx: "automatic",
  });
  const requests = [];
  const initialTime = Date.now();
  let now = initialTime;
  let throttled = false;
  let chatgptFailure = false;
  let claudeUsed = 24;
  let claudeExpired = false;
  let claudeSignedOut = false;
  let claudeRetryAt;
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (payload, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (url.pathname === "/api/models") return send({ data: ["gpt-test", "cliproxy/claude-test"].map((id) => ({ id })) });
    if (url.pathname === "/api/cliproxy/status") return send({ models: ["gemini-test", "gemini-other", "claude-test"] });
    if (url.pathname === "/api/usage-limits") {
      const model = url.searchParams.get("model");
      requests.push({ model, method: req.method });
      const captured_at = new Date(initialTime).toISOString();
      if (model.includes("claude") && claudeSignedOut) return send({
        provider: "anthropic", available: false, auth_required: true, error: "Claude Code is not signed in.",
      });
      if (model.includes("claude") && claudeExpired) {
        if (req.method === "POST") claudeExpired = false;
        else return send({ provider: "anthropic", available: false, recovery_required: true, error: "Claude’s session needs a refresh." });
      }
      if (model.includes("claude")) return send({
        provider: "anthropic", available: true, captured_at,
        limits: [{ key: "five_hour", label: "Current session", limit: { used_percent: claudeUsed, resets_in_seconds: 3600 } }],
        ...(throttled ? { stale: true, refresh_error: "Claude is temporarily limiting usage checks.", retry_at: claudeRetryAt } : {}),
      });
      if (model.includes("gemini")) return send({ provider: "google", available: true, captured_at, accounts: [{ account: "test", limit: { used_percent: 30, resets_in_seconds: 3600 } }] });
      if (chatgptFailure) return send({ available: false, refresh_error: "Usage is temporarily unavailable." }, 502);
      return send({ available: true, captured_at, primary: { used_percent: 18, window_minutes: 300, resets_in_seconds: 3600 } });
    }
    const output = bundle.outputFiles.find((file) => url.pathname === `/${path.basename(file.path)}`);
    if (output) {
      res.setHeader("content-type", url.pathname.endsWith(".css") ? "text/css" : "text/javascript");
      return res.end(output.contents);
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end('<!doctype html><html data-theme="light"><head><meta charset="utf-8"><link rel="stylesheet" href="/usage-fixture.css"></head><body style="margin:0;background:#e5f0e7"><div id="root"></div><script src="/usage-fixture.js"></script></body></html>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: "msedge" });
    const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
    const errors = [];
    context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
    const url = `http://127.0.0.1:${server.address().port}`;
    const page = await context.newPage();
    await page.clock.install({ time: initialTime });
    await page.goto(url);
    const ring = (provider) => page.locator(`[data-provider="${provider}"]`);
    const label = (provider, value) => eventually(async () => (await ring(provider).getAttribute("aria-label"))?.includes(value));
    await label("chatgpt", "82% remaining");
    await label("anthropic", "76% remaining");
    await label("google", "70% remaining");
    assert.equal(requests.filter((r) => r.method === "POST").length, 1, "StrictMode mounts refresh ChatGPT once");
    assert.ok(requests.filter((r) => r.model.includes("cliproxy")).every((r) => r.method === "GET"));

    const second = await context.newPage();
    await second.goto(url);
    await eventually(async () => (await second.locator('[data-provider="chatgpt"]').getAttribute("aria-label"))?.includes("82% remaining"));
    assert.equal(requests.filter((r) => r.method === "POST").length, 2, "a new tab starts its own fresh limit check");
    await second.close();
    await page.bringToFront();

    const beforePoll = requests.length;
    now += 60_000;
    await page.clock.fastForward(60_000);
    await eventually(() => requests.length >= beforePoll + 3);
    assert.equal(requests.filter((r) => r.method === "POST").length, 2, "background polling never generates more probes");

    // Focus reads current reports but does not turn into another generation probe.
    const beforeFocus = requests.length;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await eventually(() => requests.length >= beforeFocus + 3);
    assert.equal(requests.filter((r) => r.method === "POST").length, 2);

    await ring("anthropic").click();
    const card = page.getByRole("dialog", { name: "Claude usage details" });
    const refresh = card.getByRole("button", { name: "Refresh Claude usage" });
    await refresh.waitFor();
    await eventually(async () => await refresh.isEnabled());
    throttled = true;
    claudeRetryAt = new Date(now + 120_000).toISOString();
    await refresh.click();
    await label("anthropic", "76% remaining, last known reading");
    assert.match(await card.innerText(), /Retrying automatically after/);
    assert.equal(await refresh.isDisabled(), true);
    const beforeCooldown = requests.filter((r) => r.model.includes("claude")).length;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    now += 60_000;
    await page.clock.fastForward(60_000);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    assert.ok(requests.filter((r) => r.model.includes("claude")).length > beforeCooldown, "local reads still notice renewed credentials during an upstream cooldown");
    assert.equal(requests.filter((r) => r.model.includes("claude") && r.method === "POST").length, 0, "a real throttle never generates a probe");

    throttled = false;
    claudeUsed = 31;
    now += 60_000;
    await page.clock.fastForward(60_000);
    await label("anthropic", "69% remaining");
    assert.equal((await ring("anthropic").getAttribute("aria-label")).includes("last known"), false);
    assert.equal(await refresh.isEnabled(), true);
    assert.ok(!(await card.innerText()).includes("Retrying automatically"));

    claudeExpired = true;
    await refresh.click();
    await eventually(() => requests.some((r) => r.model.includes("claude") && r.method === "POST"));
    await label("anthropic", "69% remaining");
    assert.ok(!(await card.innerText()).includes("needs a refresh"));
    assert.equal(requests.filter((r) => r.model.includes("claude") && r.method === "POST").length, 1);

    claudeSignedOut = true;
    await refresh.click();
    await label("anthropic", "not reported");
    assert.ok((await card.innerText()).includes("not signed in"), "revoked credentials clear the old ring reading");
    claudeSignedOut = false;

    await page.keyboard.press("Escape");
    await ring("chatgpt").click();
    const chatRefresh = page.getByRole("dialog", { name: "ChatGPT usage details" }).getByRole("button", { name: "Refresh ChatGPT usage" });
    chatgptFailure = true;
    await chatRefresh.click();
    await label("chatgpt", "82% remaining, last known reading");
    assert.equal(requests.filter((r) => !r.model.includes("claude") && r.method === "POST").length, 3, "manual ChatGPT refresh still probes");

    // Capture with a real animation clock after the timer assertions above.
    throttled = true;
    const previewContext = await browser.newContext({ viewport: { width: 900, height: 700 } });
    const preview = await previewContext.newPage();
    preview.on("pageerror", (error) => errors.push(error.message));
    await preview.goto(url);
    await preview.locator('[data-provider="anthropic"]').click();
    const previewCard = preview.getByRole("dialog", { name: "Claude usage details" });
    await eventually(async () => (await previewCard.innerText()).includes("Retrying automatically after"));
    await eventually(async () => Number(await previewCard.evaluate((node) => getComputedStyle(node).opacity)) === 1);
    const output = path.join(root, ".tmp-usage-refresh-qa");
    await mkdir(output, { recursive: true });
    await preview.screenshot({ path: path.join(output, "claude-retry.png") });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
