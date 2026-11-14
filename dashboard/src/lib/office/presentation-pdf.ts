// Disposable ingestion worker only: preserve slides as selectable PDF pages.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { resolveBrowserExecutable } from "../agent-browser/browser-profile.ts";
import { runOfficeCli } from "./officecli.ts";
import { createDisposableScratch, releaseDisposableScratch } from "../storage/scratch.ts";

function previewBrowserExecutable(): string | null {
  const explicit = process.env.BREADBOARD_VISUAL_BROWSER_PATH?.trim() ||
    process.env.AGENT_BROWSER_EXECUTABLE_PATH?.trim();
  if (explicit) return explicit;
  if (fs.existsSync(chromium.executablePath())) return chromium.executablePath();
  // OfficeCLI provisions Chrome for its own previews. Reuse that headless
  // browser before system Edge, which can disallow automation via policy.
  const cache = path.join(process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), ".cache", "puppeteer"), "chrome");
  if (fs.existsSync(cache)) {
    const builds = fs.readdirSync(cache).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const build of builds) {
      for (const relative of ["chrome-win64/chrome.exe", "chrome-linux64/chrome", "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"]) {
        const candidate = path.join(cache, build, relative);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return resolveBrowserExecutable();
}

export async function renderPresentationPdf(
  bytes: Buffer,
  signal?: AbortSignal,
): Promise<Buffer> {
  signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000);
  signal?.throwIfAborted();
  const directory = createDisposableScratch("presentation-render");
  // Native tools disagree on Windows TEMP/TMP precedence. Both OfficeCLI and
  // Chromium must use this render's writable scratch directory.
  const renderEnv = { ...process.env, TEMP: directory, TMP: directory, TMPDIR: directory };
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const abort = () => { void browser?.close().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const input = path.join(directory, "presentation.pptx");
    const output = path.join(directory, "presentation.html");
    fs.writeFileSync(input, bytes, { flag: "wx", mode: 0o600 });
    const result = await runOfficeCli(["view", input, "html", "--out", output], {
      cwd: directory, signal, timeoutMs: 120_000,
      env: renderEnv,
    });
    signal?.throwIfAborted();
    if (result.code !== 0 || !fs.existsSync(output)) {
      throw new Error("The PowerPoint slide preview could not be rendered.", {
        cause: new Error(
          `OfficeCLI exited with code ${result.code}${result.timedOut ? " (timed out)" : ""}: ` +
          (result.stderr || result.stdout).trim().slice(0, 4_000),
        ),
      });
    }
    const html = fs.readFileSync(output, "utf8");
    signal?.throwIfAborted();
    const executablePath = previewBrowserExecutable();
    if (!executablePath) throw new Error("A Chromium browser is required to preview PowerPoint slides.");
    browser = await chromium.launch({ executablePath, headless: true, timeout: 30_000, env: renderEnv });
    signal?.throwIfAborted();
    // Uploaded decks cannot run scripts or fetch external/local resources. This
    // uses a fresh, offline context, never the user's signed-in browser profile.
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block" });
    await context.route("**/*", route => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await page.setContent(html, { waitUntil: "load" });
    const size = await page.evaluate(() => {
      const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide, .pptx-slide"));
      const first = slides[0];
      if (!first) throw new Error("The presentation contains no slides.");
      const width = first.offsetWidth;
      const height = first.offsetHeight;
      if (!width || !height) throw new Error("The presentation has invalid slide dimensions.");
      // Drop preview navigation and speaker-note chrome. Each slide is exactly
      // one page, including blank slides, with its native aspect ratio intact.
      document.body.replaceChildren(...slides);
      const style = document.createElement("style");
      style.textContent = `@page{size:${width}px ${height}px;margin:0}
        html,body{margin:0!important;padding:0!important;background:white!important;display:block!important}
        .slide,.pptx-slide{position:relative!important;display:block!important;flex:none!important;
          width:${width}px!important;height:${height}px!important;margin:0!important;padding:0!important;
          transform:none!important;box-shadow:none!important;overflow:hidden!important;
          break-inside:avoid;break-after:page;print-color-adjust:exact}
        .slide:last-child,.pptx-slide:last-child{break-after:auto}`;
      document.head.append(style);
      return { width, height };
    });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, image => image.decode().catch(() => {})));
    });
    signal?.throwIfAborted();
    const pdf = await page.pdf({
      width: `${size.width}px`, height: `${size.height}px`,
      preferCSSPageSize: true, printBackground: true,
    });
    signal?.throwIfAborted();
    return pdf;
  } finally {
    signal?.removeEventListener("abort", abort);
    await browser?.close().catch(() => {});
    releaseDisposableScratch(directory);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
