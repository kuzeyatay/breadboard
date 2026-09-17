import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

const dashboard = "http://127.0.0.1:53161";
const quartz = "http://127.0.0.1:53162";
const server = "http://127.0.0.1:53163";
const bundle = await build({
  entryPoints: [path.resolve(import.meta.dirname, "../../quartz/quartz/components/scripts/penechoBoard.inline.ts")],
  bundle: true, write: false, platform: "browser", format: "iife",
});

for (const navigated of [false, true]) {
  test(`whiteboards use the assigned dashboard port ${navigated ? "after navigation within Quartz" : "when first embedded"}`, { timeout: 30_000 }, async () => {
    const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p => p && fs.existsSync(p));
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const page = await browser.newPage();
      await page.clock.install();
      const requests = [], errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname === "/api/penecho/status") {
          requests.push({ origin: url.origin, method: request.method(), body: request.method() === "OPTIONS" ? null : request.postDataJSON() });
          const headers = { "Access-Control-Allow-Origin": quartz, "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
          if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
          if (url.origin !== dashboard) return route.abort();
          return route.fulfill({ headers, json: { running: true, baseUrl: server, viewId: request.postDataJSON().viewId } });
        }
        if (url.origin === dashboard) return route.fulfill({ contentType: "text/html", body: `<iframe title="Note" src="${quartz}/${navigated ? "previous" : "note"}" style="width:100%;height:700px"></iframe>` });
        if (url.origin === quartz && url.pathname === "/previous") return route.fulfill({ contentType: "text/html", body: `<script>location.replace('/note')</script>` });
        if (url.origin === quartz) return route.fulfill({ contentType: "text/html", body: `<pre><code class="penecho-board-block" data-board-id="test-board"></code></pre><script>${bundle.outputFiles[0].text}</script><script>document.dispatchEvent(new Event('nav'))</script>` });
        if (url.origin === server) return route.fulfill({ contentType: "text/html", body: `<p>Canvas ready</p><script>parent.postMessage({type:'penecho:board-ready',boardId:'test-board'},'${quartz}')</script>` });
        return route.abort();
      });
      await page.goto(dashboard);
      const note = page.frameLocator('iframe[title="Note"]');
      await note.locator(".penecho-board--ready").waitFor({ timeout: 5000 });
      assert.equal(await note.locator("body").evaluate(() => new URL(document.referrer).origin), navigated ? quartz : dashboard);
      assert.equal(await note.locator(".penecho-board-frame").getAttribute("src"), `${server}/?board=test-board&title=Whiteboard`);
      const start = requests.find(request => request.method === "POST");
      assert.equal(start.origin, dashboard);
      const renewed = page.waitForResponse(response => response.url() === `${dashboard}/api/penecho/status` && response.request().method() === "POST");
      await page.clock.fastForward(20_000);
      await renewed;
      assert.deepEqual(requests.filter(request => request.method === "POST").map(request => request.body), [start.body, start.body]);
      // Quartz can reinitialize the unchanged page after mounting its widgets.
      await note.locator("body").evaluate(() => document.dispatchEvent(new Event("nav")));
      assert.equal(await note.locator(".penecho-board-frame").count(), 1, "rehydration preserves the mounted drawing surface");
      assert.equal(requests.some(request => request.method === "DELETE"), false);
      const released = page.waitForResponse(response => response.url() === `${dashboard}/api/penecho/status` && response.request().method() === "DELETE");
      await note.locator("body").evaluate(() => {
        document.querySelector(".penecho-board").remove();
        document.dispatchEvent(new Event("nav"));
      });
      await released;
      assert.deepEqual(requests.find(request => request.method === "DELETE"), { origin: dashboard, method: "DELETE", body: start.body });
      assert.ok(requests.every(request => request.origin === dashboard));
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
}
