/**
 * Electron's webContents.printToPDF for the Office editors: their print
 * layouts are self-contained HTML (a file or a data: URL), rendered here in an
 * offline headless browser with scripts off, as the apps' own print windows run.
 */
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { previewBrowserExecutable } from "./presentation-pdf.ts";

interface PrintOptions {
  landscape?: boolean;
  printBackground?: boolean;
  pageSize?: string | { width: number; height: number };
  margins?: { top?: number; bottom?: number; left?: number; right?: number; marginType?: string };
  preferCSSPageSize?: boolean;
  scale?: number;
}

const inches = (value: number | undefined) => `${value ?? 0.4}in`;

export async function printHtmlToPdf(url: string, options: PrintOptions = {}): Promise<Uint8Array> {
  const executablePath = previewBrowserExecutable();
  if (!executablePath) throw new Error("A Chromium browser is required to export PDFs.");
  let html: string | null = null, folder: string | null = null;
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    const meta = url.slice(5, comma), body = url.slice(comma + 1);
    html = meta.endsWith(";base64") ? Buffer.from(body, "base64").toString("utf8") : decodeURIComponent(body);
  } else if (url.startsWith("file:")) {
    const file = fileURLToPath(url);
    html = fs.readFileSync(file, "utf8");
    folder = path.dirname(file);
  } else throw new Error("Only the editor's own print layout can be exported.");

  const browser = await chromium.launch({ executablePath, headless: true, timeout: 30_000 });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block" });
    // Offline: inline data and the print file's own folder (local images beside it) only.
    await context.route("**/*", route => {
      const target = route.request().url();
      if (target.startsWith("data:") || target === "about:blank") return route.continue();
      if (folder && target.startsWith("file:")) {
        const file = fileURLToPath(target);
        if (file === folder || file.startsWith(folder + path.sep)) return route.continue();
      }
      return route.abort();
    });
    const page = await context.newPage();
    if (folder) await page.goto(url, { waitUntil: "load", timeout: 60_000 });
    else await page.setContent(html, { waitUntil: "load", timeout: 60_000 });
    const size = options.pageSize;
    const margin = options.margins ?? {};
    const pdf = await page.pdf({
      printBackground: options.printBackground ?? false,
      landscape: options.landscape ?? false,
      preferCSSPageSize: options.preferCSSPageSize ?? false,
      scale: options.scale,
      ...(typeof size === "object" ? { width: `${size.width}in`, height: `${size.height}in` } : { format: size || "A4" }),
      margin: margin.marginType === "none" ? { top: "0", bottom: "0", left: "0", right: "0" }
        : { top: inches(margin.top), bottom: inches(margin.bottom), left: inches(margin.left), right: inches(margin.right) },
    });
    return new Uint8Array(pdf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}
