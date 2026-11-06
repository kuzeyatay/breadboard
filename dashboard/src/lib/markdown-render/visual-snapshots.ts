import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";

export const PDF_VISUAL_LANGUAGES = new Set([
  "breadboard-visual", "breadboard-generated-visual", "breadboard-detached-visual",
]);

function browserExecutable(): string {
  const candidates = [
    process.env.BREADBOARD_VISUAL_BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const executable = candidates.find(candidate => candidate && fs.existsSync(candidate));
  if (!executable) throw new Error("A Chromium browser is required to include visualizers in this PDF.");
  return executable;
}

/** Worker-owned, offline browser. No signed-in profile or live page is used. */
export class PdfVisualSnapshots {
  private browser?: Browser;
  private signal?: AbortSignal;
  constructor(signal?: AbortSignal) { this.signal = signal; }

  private abort = () => { void this.browser?.close().catch(() => {}); };

  async capture(content: string, slug: string | undefined, clusterSlug: string, title: string): Promise<Buffer[]> {
    this.signal?.throwIfAborted();
    // Only the authenticated garden may supply artifacts to the transformer.
    const normalized = slug?.replace(/\\/g, "/").replace(/\.md$/i, "");
    if (normalized && (!clusterSlug || !normalized.startsWith(`${clusterSlug}/`) ||
        normalized.split("/").some(part => !part || part === "." || part === ".."))) {
      throw new Error("The PDF note path is outside its garden.");
    }
    const relativePath = `${normalized ? normalized.slice(clusterSlug.length + 1) : "index"}.md`;
    const baseRoot = process.env.QUARTZ_CONTENT_PATH || process.cwd();
    const contentRoot = clusterSlug ? path.join(baseRoot, clusterSlug) : baseRoot;
    // Keep artifact discovery within this garden, including copied folders.
    // Quartz validates hashes/publication; the PDF worker also rejects indirect
    // paths before those artifact files can be read.
    let directory = path.dirname(path.join(contentRoot, relativePath));
    while (directory === contentRoot || directory.startsWith(contentRoot + path.sep)) {
      for (const candidate of [directory, path.join(directory, ".breadboard", "visuals")]) {
        if (fs.existsSync(candidate) && fs.realpathSync(candidate) !== path.resolve(candidate)) {
          throw new Error("A PDF visualization cannot use a symbolic link.");
        }
      }
      if (directory === contentRoot) break;
      directory = path.dirname(directory);
    }
    const [{ renderQuartzDocument }, assets] = await Promise.all([
      import("../generated/quartz-reader.mjs"),
      import("../generated/quartz-pdf-visuals.mjs"),
    ]);
    // Export requests separate frontmatter from the body. Restore its title for
    // generated visuals anchored to the page title rather than an in-body H1.
    const readerContent = /^---\r?\n/.test(content) ? content : `---\ntitle: ${JSON.stringify(title)}\n---\n\n${content}`;
    const rendered = await renderQuartzDocument({ content: readerContent, relativePath, contentRoot, allFiles: [relativePath] });
    if (!this.browser) {
      this.browser = await chromium.launch({ executablePath: browserExecutable(), headless: true });
      this.signal?.addEventListener("abort", this.abort, { once: true });
      if (this.signal?.aborted) { await this.close(); this.signal.throwIfAborted(); }
    }
    const context = await this.browser.newContext({
      viewport: { width: 960, height: 800 }, deviceScaleFactor: 2,
      colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block",
    });
    // Visualizers are self-contained. Prevent navigation, network and local-file
    // access from supplied HTML while still allowing their sandboxed srcdoc.
    await context.route("**/*", route => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    try {
      const blocks = await page.evaluate(html => {
        const parsed = new DOMParser().parseFromString(html, "text/html");
        return Array.from(parsed.querySelectorAll("code.breadboard-visual-block, code.breadboard-generated-visual-block"), code => ({
          className: code.className,
          text: code.textContent || "",
          attributes: ["data-visual-spec", "data-generated-visual-definition", "data-generated-visual-manifest", "data-generated-visual-error"]
            .flatMap(name => code.hasAttribute(name) ? [[name, code.getAttribute(name)!]] : []),
        }));
      }, rendered.html);
      const screenshots: Buffer[] = [];
      for (const block of blocks) {
        this.signal?.throwIfAborted();
        const manifest = block.attributes.find(([name]) => name === "data-generated-visual-manifest")?.[1];
        if (manifest && !JSON.parse(manifest).detached && !clusterSlug) {
          throw new Error("Open the visualization's garden before exporting it.");
        }
        if (/invalid|noninteractive/.test(block.className)) {
          throw new Error(`Cannot export a visualization: ${block.attributes.find(([name]) => name === "data-generated-visual-error")?.[1] || block.text}`);
        }
        await page.setContent(`<!doctype html><html saved-theme="light"><head><meta charset="utf-8"><style>
          :root{--light:#fff;--dark:#172321;--gray:#58645f;--lightgray:#dce3df;--secondary:#286953;--tertiary:#447969;--bodyFont:Arial,sans-serif;--headerFont:Arial,sans-serif;--codeFont:monospace}
          *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:var(--dark);font:16px/1.5 Arial,sans-serif}
          ${assets.style}
          #snapshot{width:960px;padding:16px}.breadboard-visual-card,.breadboard-generated-visual-card{margin:0!important}
          .bv-footer,.bgv-meta{display:none!important}
        </style></head><body><main id="snapshot"></main></body></html>`);
        await page.evaluate(block => {
          (window as any).addCleanup = () => {};
          const pre = document.createElement("pre"), code = document.createElement("code");
          code.className = block.className; code.textContent = block.text;
          for (const [name, value] of block.attributes) code.setAttribute(name, value);
          pre.append(code); document.getElementById("snapshot")!.append(pre);
          window.addEventListener("message", event => {
            const frame = document.querySelector("iframe");
            if (event.source !== frame?.contentWindow) return;
            const data = event.data;
            if ((data?.protocol === "breadboard:interactive-visualizer:v1" && data.type === "ready") ||
                (data?.type === "breadboard-generated-visual:event" && data.event === "ready")) {
              frame!.dataset.pdfReady = "true";
            }
          });
        }, block);
        await page.addScriptTag({ content: assets.script });
        await page.evaluate(() => document.dispatchEvent(new CustomEvent("nav")));
        if (block.className.includes("breadboard-generated-visual-block")) {
          await page.locator('iframe[data-pdf-ready="true"]').waitFor();
        } else {
          await page.locator(".breadboard-visual-card svg, .breadboard-visual-card canvas").first().waitFor();
        }
        // Wait for fonts and two painted frames inside each sandbox as well as
        // the outer card. Freeze animation controls at the rendered default.
        for (const frame of page.frames()) {
          await frame.evaluate(async () => {
            await document.fonts.ready;
            document.querySelectorAll<HTMLButtonElement>('[data-action="play-pause"][aria-pressed="true"]').forEach(button => button.click());
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          });
        }
        if (await page.locator(".breadboard-generated-visual-fallback").count()) {
          throw new Error("A visualization could not render for this PDF. Reload the note and try again.");
        }
        screenshots.push(await page.locator("#snapshot").screenshot({ animations: "disabled", timeout: 20_000 }));
      }
      return screenshots;
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    this.signal?.removeEventListener("abort", this.abort);
    await this.browser?.close();
    this.browser = undefined;
  }
}
