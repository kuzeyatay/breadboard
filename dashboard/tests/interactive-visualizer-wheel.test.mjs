import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";
import { withInteractiveVisualizerWheelZoom } from "../src/lib/hermes/interactive-visualizer-wheel.ts";
import { generatedVisualDashboardBaseUrl } from "../../quartz/quartz/components/scripts/generatedVisualHost.ts";
import { nativeVisualizerBrowserDocument } from "../src/lib/learn-native-visualizer-browser.ts";

test("garden visualizer actions resolve this launch’s dashboard from its embedding origin", () => {
  assert.equal(
    generatedVisualDashboardBaseUrl('http://127.0.0.1:55571/garden/lesson', 'http://127.0.0.1:55571/garden', 'http://127.0.0.1:55553'),
    'http://127.0.0.1:55553',
  );
  assert.equal(
    generatedVisualDashboardBaseUrl('http://127.0.0.1:55571/garden/lesson', 'http://127.0.0.1:55553', 'https://unrelated.example'),
    'http://127.0.0.1:55553',
  );
  assert.equal(
    generatedVisualDashboardBaseUrl(
      "http://127.0.0.1:55571/garden/lesson",
      "http://127.0.0.1:55553/garden/a",
    ),
    "http://127.0.0.1:55553",
  );
  assert.equal(
    generatedVisualDashboardBaseUrl(
      "http://localhost:8081/a",
      "https://unrelated.example/a",
    ),
    "http://localhost:3000",
  );
  assert.equal(
    generatedVisualDashboardBaseUrl("https://garden.example.org/a", ""),
    "https://example.org",
  );
});

test("wheel zoom updates the scene through existing controls in an opaque stored-artifact iframe", async (t) => {
  const executable =
    process.env.GENERATED_VISUAL_BROWSER_EXECUTABLE ||
    (process.platform === "win32"
      ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
      : chromium.executablePath());
  if (!fs.existsSync(executable))
    return t.skip("A Chromium browser is required");
  const browser = await chromium.launch({
    executablePath: executable,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    const original = `<html><body><main id="app"><canvas width="400" height="200"></canvas><label>Zoom<input id="camera_zoom" type="range" min="50" max="150" step="1" value="100"></label><label>Mass<input id="mass" type="number" value="1"></label><button data-action="reset">Reset</button></main><script>
    const slider=document.querySelector('#camera_zoom'),canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
    function draw(){ctx.clearRect(0,0,400,200);ctx.fillRect(10,10,Number(slider.value),40)}slider.addEventListener('input',draw);document.querySelector('button').onclick=()=>{slider.value='100';draw()};draw();
    globalThis.__BREADBOARD_VISUALIZER__={addCleanup(fn){globalThis.disposeWheel=fn}};
    </script></body></html>`;
    const html = withInteractiveVisualizerWheelZoom(original);
    assert.equal(withInteractiveVisualizerWheelZoom(html), html);
    assert.equal(
      withInteractiveVisualizerWheelZoom(
        original.replace(
          "</body>",
          "<script data-breadboard-wheel-zoom>oldRuntime()</script></body>",
        ),
      ),
      html,
    );
    await page.setContent(
      '<iframe sandbox="allow-scripts" style="width:500px;height:400px"></iframe>',
    );
    await page
      .locator("iframe")
      .evaluate((n, source) => (n.srcdoc = source), html);
    const frame = await (
      await page.locator("iframe").elementHandle()
    ).contentFrame();
    await frame.locator("#camera_zoom").waitFor();
    const value = () => frame.locator("#camera_zoom").inputValue();
    const drawing = () =>
      frame.locator("canvas").evaluate((n) => n.toDataURL());
    const wheel = (options = {}, selector = "canvas") =>
      frame.locator(selector).evaluate((node, options) => {
        const event = new WheelEvent("wheel", {
          deltaY: -100,
          bubbles: true,
          cancelable: true,
          ...options,
        });
        node.dispatchEvent(event);
        return event.defaultPrevented;
      }, options);
    const first = await drawing();
    assert.equal(await wheel(), true);
    assert.equal(await value(), "106");
    assert.notEqual(await drawing(), first);
    await wheel({ deltaY: 100 });
    assert.equal(await value(), "100");
    await wheel({ deltaY: -100, ctrlKey: true });
    assert.equal(await value(), "100");
    assert.equal(await wheel({}, "#mass"), false);
    assert.equal(await value(), "100");
    for (let i = 0; i < 8; i++) await wheel({ deltaY: -240 });
    assert.equal(await value(), "150");
    await frame.locator('[data-action="reset"]').click();
    assert.equal(await drawing(), first);
    // Real mouse input over the scene takes the same path as the controls.
    await frame.locator("canvas").hover();
    await page.mouse.wheel(0, -100);
    await frame.waitForFunction(
      () => document.querySelector("#camera_zoom").value === "106",
    );
    await frame.locator("#camera_zoom").evaluate((n) => {
      n.min = "0.8";
      n.max = "1.1";
      n.step = "0.02";
      n.value = "1";
    });
    await wheel();
    assert.equal(await value(), "1.02");
    await frame.locator("#camera_zoom").evaluate((n) => {
      n.dataset.zoomDirection = "inverse";
      n.value = "1";
    });
    await wheel();
    assert.equal(await value(), "0.98");
    await frame.locator("#camera_zoom").evaluate((n) => {
      delete n.dataset.zoomDirection;
      n.min = "50";
      n.max = "150";
      n.step = "1";
      n.value = "106";
    });
    await frame.locator("canvas").evaluate((n) =>
      n.addEventListener("wheel", (event) => {
        document.querySelector("#camera_zoom").value = "120";
        event.preventDefault();
      }),
    );
    await wheel();
    assert.equal(await value(), "120");
    await frame.evaluate(() => globalThis.disposeWheel());
    assert.equal(await wheel({}, "#camera_zoom"), false);
    // Stored packages using zoom buttons work without a range control.
    const buttons = withInteractiveVisualizerWheelZoom(
      '<main id="app"><canvas></canvas><button data-action="zoom-in" aria-label="Zoom in">+</button><button data-action="zoom-out" aria-label="Zoom out">−</button><output>0</output></main><script>document.querySelectorAll("button").forEach((n,i)=>n.onclick=()=>document.querySelector("output").textContent=String(Number(document.querySelector("output").textContent)+(i?-1:1)))</script>',
    );
    await page
      .locator("iframe")
      .evaluate((n, source) => (n.srcdoc = source), buttons);
    await frame.locator("output").waitFor();
    await wheel();
    assert.equal(await frame.locator("output").textContent(), "1");
    await wheel({ deltaY: 100 });
    assert.equal(await frame.locator("output").textContent(), "0");
    await frame
      .locator("button")
      .evaluateAll((nodes) => nodes.forEach((n) => n.remove()));
    assert.equal(await wheel(), false);
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bb-visual-utf8-"));
    try {
      const file = path.join(temporary, "preview.html");
      const equation = "∇ × H = J + ∂D/∂t; τ = 1 µs";
      fs.writeFileSync(
        file,
        nativeVisualizerBrowserDocument(
          `<main id="app">${equation}</main>`,
          375,
          850,
          "light",
        ),
        "utf8",
      );
      await page.goto(pathToFileURL(file).href);
      const preview = await (
        await page.locator("iframe").elementHandle()
      ).contentFrame();
      assert.equal(await preview.locator("#app").textContent(), equation);
      assert.equal(await preview.evaluate(() => innerWidth), 375);
    } finally {
      assert.ok(
        path
          .resolve(temporary)
          .startsWith(path.resolve(os.tmpdir()) + path.sep),
      );
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  } finally {
    await browser.close();
  }
});
