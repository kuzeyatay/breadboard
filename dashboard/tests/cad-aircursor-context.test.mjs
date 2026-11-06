import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import esbuild from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(fileURLToPath(import.meta.url), "../..");

for (const implementation of ["viewer", "desktop", "both"]) {
test(`${implementation}: CAD navigation follows the canvas and releases on edits, overlays, blur and cleanup`, { timeout: 45000 }, async () => {
  const bundle = await esbuild.build({
    stdin: {
      resolveDir: root, loader: "ts",
      contents: `import { installCadNavigationContext } from "./src/app/components/cad/aircursor-context";
        import { installCadNavigationHint } from "../desktop/src/preload/preload";
        window.ready = true;
        const cleanups = [];
        if (${implementation !== "viewer"}) cleanups.push(installCadNavigationHint());
        if (${implementation !== "desktop"}) cleanups.push(installCadNavigationContext(document.querySelector("canvas"), () => window.ready));
        window.disposeCad = () => cleanups.forEach(cleanup => cleanup());`,
    },
    bundle: true, write: false, platform: "browser", format: "iife", logLevel: "silent", external: ["electron"],
  });
  const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent(`<title>My design</title>
      <section aria-label="CAD viewer"><canvas style="position:absolute;left:100px;top:100px;width:400px;height:300px"></canvas></section>
      <input aria-label="Parameter" style="position:absolute;left:550px;top:100px" />
      <button style="position:absolute;left:550px;top:200px">Toolbar</button>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const hinted = async () => page.waitForFunction(() => document.title === "Breadboard CAD | My design");
    const plain = async (title = "My design") => page.waitForFunction(value => document.title === value, title);
    await page.locator("canvas").hover();
    await hinted();
    await page.getByRole("button").hover();
    await plain();

    await page.locator("canvas").hover();
    await hinted();
    if (implementation === "viewer") {
      await page.evaluate(() => { window.ready = false; });
      await plain();
      await page.evaluate(() => { window.ready = true; });
      await hinted();
    }

    await page.getByRole("textbox").focus();
    await plain();
    await page.locator("canvas").hover();
    await page.waitForTimeout(150);
    assert.equal(await page.title(), "My design", "hover must not take over parameter editing");
    await page.locator("canvas").click();
    await hinted();

    // Pointer capture keeps pointermove targeting the canvas even over a dialog.
    // Hit-testing must clear the hint without waiting for a pointerleave event.
    await page.evaluate(() => {
      const dialog = document.createElement("div");
      dialog.id = "overlay";
      dialog.style.cssText = "position:fixed;inset:0;background:white;z-index:20";
      document.body.append(dialog);
    });
    await plain();
    await page.locator("#overlay").evaluate(element => element.remove());
    await hinted();

    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await plain();
    await page.locator("canvas").hover();
    await hinted();
    await page.evaluate(() => {
      document.title = "Another chat";
      window.disposeCad();
    });
    await plain("Another chat");
    await page.locator("canvas").hover();
    await page.waitForTimeout(150);
    assert.equal(await page.title(), "Another chat", "cleanup must remove listeners and preserve a newer title");

    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.locator("canvas").hover();
    await page.waitForFunction(() => document.title === "Breadboard CAD | Another chat");
    await page.locator("canvas").evaluate(element => element.remove());
    await plain("Another chat");
    await page.evaluate(() => window.disposeCad());
  } finally {
    await browser.close();
  }
});
}
