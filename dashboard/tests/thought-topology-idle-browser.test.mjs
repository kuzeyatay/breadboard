import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

const renderer = path.resolve(import.meta.dirname, "../../quartz/quartz/components/scripts/thoughtTopology3DRenderer.ts");

test("3D topology rests, wakes for interactions, and suspends offscreen without losing its layout", { timeout: 60_000 }, async t => {
  const bundle = await build({
    entryPoints: [renderer], bundle: true, write: false, platform: "browser", format: "iife", globalName: "topologyRenderer",
    plugins: [{ name: "observe-topology", setup(builder) {
      builder.onLoad({ filter: /[/\\]thoughtTopology3DRenderer\.ts$/ }, () => {
        const source = fs.readFileSync(renderer, "utf8");
        const anchor = "onCleanup(() => simulation.stop())";
        assert.equal(source.split(anchor).length, 2);
        return { loader: "ts", contents: source.replace(anchor, `${anchor}
          window.testTopology = { app, simulation, draws: 0, ticks: 0 };
          simulation.on("tick.test", () => window.testTopology.ticks++);
          const originalRender = app.renderer.render.bind(app.renderer);
          app.renderer.render = (...args) => { window.testTopology.draws++; return originalRender(...args); };
        `) };
      });
    } }],
  });
  const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const summary = { state: "ready", text: "Related ideas." };
  const topology = {
    garden: { id: 1, slug: "demo", title: "Demo", summary },
    folders: [{ id: "root", path: "", parentId: null, title: "Demo", depth: 0, nodeCount: 200, summary }],
    nodes: Array.from({ length: 200 }, (_, i) => ({
      id: `note-${i}`, slug: `demo/note-${i}`, relPath: `note-${i}.md`, folderId: "root", title: `Note ${i}`,
      kind: "markdown", knowledgeType: "user-note", summary, primaryConcepts: [], supportingConcepts: [],
    })),
    edges: Array.from({ length: 600 }, (_, i) => ({
      id: `edge-${i}`, source: `note-${i % 200}`, target: `note-${(i + 1 + Math.floor(i / 200)) % 200}`,
      score: 0.9, explanation: summary,
    })),
    build: { state: "ready", threshold: 0.68 },
  };
  const config = { mode: "thought-topology", drag: true, zoom: true, depth: -1, scope: "all", clickToNavigate: false,
    scale: 1, repelForce: 1.25, centerForce: 0.08, linkDistance: 120, fontSize: 0.72, opacityScale: 1,
    showTags: true, removeTags: [], focusOnHover: true, enableRadial: false };
  await page.route("http://localhost:53163/**", route => route.fulfill({ contentType: "text/html", body: `<!doctype html>
    <style>body{margin:0}.global-graph-container{width:900px;height:600px}</style>
    <div class="graph"><div class="global-graph-outer"><div class="global-graph-container"></div></div></div>` }));
  await page.goto("http://localhost:53163/?topologyTest=1");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(async ({ topology, config }) => {
    window.disposeTopology = await topologyRenderer.renderThoughtTopology3D(
      document.querySelector(".global-graph-container"), "demo", config, topology,
      { scopeCluster: "demo", scopeFolderPath: null, configuredDepth: -1 },
    );
  }, { topology, config });
  await page.waitForFunction(() => testTopology.draws > 0);
  // Isolate idle rendering from the entrance animation, without waiting for
  // hundreds of physics ticks. Use the real end handler to finish framing.
  await page.evaluate(() => {
    testTopology.simulation.stop().alpha(0);
    testTopology.simulation.on("end")();
  });
  const spin = page.getByRole("button", { name: "Spin", exact: true });
  // Also exposes the old unconditional render loop when run before the fix.
  const startsSpinning = await spin.getAttribute("aria-pressed");
  if (startsSpinning === "true") await spin.click();
  const rest = async () => {
    await page.waitForTimeout(650);
    const draws = await page.evaluate(() => testTopology.draws);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => testTopology.draws), draws, "a settled map must stop drawing");
    return draws;
  };
  let draws = await rest();
  assert.equal(startsSpinning, "false", "opening a map must not opt into perpetual animation");
  await page.mouse.move(450, 300);
  await page.mouse.wheel(0, -100);
  await page.waitForFunction(previous => testTopology.draws > previous, draws);
  draws = await rest();
  await spin.click();
  await page.waitForFunction(previous => testTopology.draws > previous + 3, draws);
  await spin.click();
  draws = await rest();
  // Offscreen maps must stop both graphics and physics, then resume from the
  // same positions when they return. Spin remains an explicit saved choice.
  await spin.click();
  await page.evaluate(() => {
    testTopology.simulation.alpha(0.5).restart();
    document.querySelector(".global-graph-container").style.marginTop = "1500px";
  });
  await page.waitForTimeout(200);
  const paused = await page.evaluate(() => ({ draws: testTopology.draws, alpha: testTopology.simulation.alpha() }));
  await page.waitForTimeout(250);
  assert.deepEqual(await page.evaluate(() => ({ draws: testTopology.draws, alpha: testTopology.simulation.alpha() })), paused);
  await page.evaluate(() => { document.querySelector(".global-graph-container").style.marginTop = "0"; });
  await page.waitForFunction(paused => testTopology.draws > paused.draws && testTopology.simulation.alpha() < paused.alpha, paused);
  // Browser visibility is independent of intersection (e.g. an inactive
  // desktop tab). Exercise the actual visibilitychange listener as well.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hidden = await page.evaluate(() => ({ draws: testTopology.draws, alpha: testTopology.simulation.alpha() }));
  await page.waitForTimeout(250);
  assert.deepEqual(await page.evaluate(() => ({ draws: testTopology.draws, alpha: testTopology.simulation.alpha() })), hidden);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(previous => testTopology.draws > previous, hidden.draws);
  await page.evaluate(() => { disposeTopology(); window.finalDraws = testTopology.draws; });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => testTopology.draws), await page.evaluate(() => finalDraws));
  assert.equal(await page.locator("canvas").count(), 0);
  // A larger scope must yield during scene construction and open at its
  // stable spherical homes, rather than starting hundreds of collision ticks.
  const largeCount = 4200;
  topology.nodes = Array.from({ length: largeCount }, (_, i) => ({
    ...topology.nodes[i % 200], id: `large-${i}`, slug: `demo/large-${i}`, relPath: `large-${i}.md`, title: `Large note ${i}`,
  }));
  topology.edges = Array.from({ length: largeCount * 7 }, (_, i) => ({
    ...topology.edges[i % 600], id: `large-edge-${i}`, source: `large-${i % largeCount}`, target: `large-${(i + 1 + Math.floor(i / largeCount)) % largeCount}`,
  }));
  const startup = await page.evaluate(async ({ topology, config }) => {
    const longTasks = [];
    const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
    observer.observe({ type: "longtask" });
    let responsiveBatches = 0;
    const pulse = setInterval(() => {
      if (document.querySelector("canvas")) responsiveBatches++;
    }, 0);
    const started = performance.now();
    window.disposeTopology = await topologyRenderer.renderThoughtTopology3D(
      document.querySelector(".global-graph-container"), "demo", config, topology,
      { scopeCluster: "demo", scopeFolderPath: null, configuredDepth: -1 },
    );
    clearInterval(pulse);
    const elapsed = performance.now() - started;
    await new Promise(resolve => setTimeout(resolve, 0));
    observer.disconnect();
    return { responsiveBatches, elapsed, longestTask: Math.max(0, ...longTasks) };
  }, { topology, config });
  assert.ok(startup.responsiveBatches >= 2, "large scene construction gives input/painting multiple turns");
  await page.waitForFunction(() => window.__breadboardThoughtTopologyDebug?.sceneReady && testTopology.draws > 0);
  await rest();
  assert.equal(await page.evaluate(() => testTopology.ticks), 0, "large maps avoid the expensive entrance simulation");
  assert.equal(await page.evaluate(() => Object.keys(window.__breadboardThoughtTopologyDebug.nodes).filter(id => id.startsWith("large-")).length), largeCount, "the large map retains every page");
  t.diagnostic(`${largeCount}-page startup: ${Math.round(startup.elapsed)}ms across ${startup.responsiveBatches} responsive batches; longest observed startup task ${Math.round(startup.longestTask)}ms`);
  await page.evaluate(() => disposeTopology());
  assert.deepEqual(errors, []);
});
