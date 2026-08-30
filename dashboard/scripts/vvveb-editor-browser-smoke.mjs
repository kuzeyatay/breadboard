import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(dashboardRoot, "public");

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
  const candidate = path.resolve(publicRoot, `.${pathname}`);
  const relative = path.relative(publicRoot, candidate);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !fs.existsSync(candidate) ||
    !fs.statSync(candidate).isFile()
  ) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.setHeader("Content-Type", contentTypes.get(path.extname(candidate).toLowerCase()) || "application/octet-stream");
  fs.createReadStream(candidate).pipe(response);
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("Vvveb smoke server did not bind a TCP port.");
const origin = `http://127.0.0.1:${address.port}`;

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await chromium.launch({
  executablePath: fs.existsSync(edgePath) ? edgePath : undefined,
  headless: true,
});
try {
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(`${origin}/vvveb-editor/blank.html`);
  await page.evaluate(() => {
    window.smokeMessages = [];
    window.addEventListener("message", (event) => {
      if (event.origin !== window.location.origin || !event.data) return;
      window.smokeMessages.push(event.data);
      if (event.data.type === "breadboard:vvveb-ready") {
        event.source.postMessage({
          type: "breadboard:vvveb-load",
          artifactId: "smoke",
          filename: "smoke.html",
          html: "<!doctype html><html><head><title>Smoke</title></head><body><main><h1>Hello page</h1><button type=\"button\">Click me</button><script>window.USER_SCRIPT_RAN=true<\/script></main></body></html>",
        }, window.location.origin);
      }
    });
    const frame = document.createElement("iframe");
    frame.id = "editor-host";
    frame.src = "/vvveb-editor/index.html?artifactId=smoke";
    frame.style.width = "1200px";
    frame.style.height = "800px";
    document.body.append(frame);
  });

  try {
    await page.waitForFunction(
      () => window.smokeMessages.some((message) => message.type === "breadboard:vvveb-loaded"),
      null,
      { timeout: 15_000 },
    );
  } catch (error) {
    const messageTypes = await page.evaluate(() => window.smokeMessages.map((message) => message.type));
    throw new Error([
      error instanceof Error ? error.message : String(error),
      `messages=${JSON.stringify(messageTypes)}`,
      `frames=${JSON.stringify(page.frames().map((frame) => frame.url()))}`,
      `pageErrors=${JSON.stringify(pageErrors)}`,
      `consoleErrors=${JSON.stringify(consoleErrors)}`,
    ].join("; "));
  }
  const editor = page.frames().find((frame) => frame.url().includes("/vvveb-editor/index.html"));
  if (!editor) throw new Error("The Vvveb editor frame did not load.");
  const canvas = editor.childFrames().find((frame) => frame.url() === "about:srcdoc");
  if (!canvas) throw new Error("The Vvveb document canvas did not load.");
  if (await canvas.evaluate(() => window.USER_SCRIPT_RAN === true)) {
    throw new Error("An artifact script executed inside the visual editor canvas.");
  }

  const heading = canvas.locator("h1");
  await heading.dblclick();
  await heading.fill("Edited visually");
  await page.waitForFunction(
    () => window.smokeMessages.some((message) =>
      message.type === "breadboard:vvveb-change" && message.html.includes("Edited visually")),
    null,
    { timeout: 10_000 },
  );
  const changed = await page.evaluate(() =>
    window.smokeMessages.findLast((message) => message.type === "breadboard:vvveb-change"));
  if (changed.html.includes("contenteditable") || changed.html.includes("data-vvveb-helpers")) {
    throw new Error("Vvveb editor helper markup leaked into the autosave HTML.");
  }
  if (pageErrors.length) {
    throw new Error(`Vvveb raised browser errors: ${pageErrors.join(" | ")}`);
  }

  process.stdout.write(`${JSON.stringify({
    loaded: true,
    inlineScriptBlocked: true,
    pointAndClickEditEmitted: true,
    cleanAutosaveHtml: true,
  })}\n`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
