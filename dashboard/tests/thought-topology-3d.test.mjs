import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { build } from "esbuild";
import * as sass from "../../quartz/node_modules/sass/sass.node.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const scripts = path.join(root, "quartz/quartz/components/scripts");
const topology = {
  garden: { id: 1, slug: "garden", title: "Physics", summary: { state: "ready", text: "Ideas in physics." } },
  folders: [
    { id: "folder:root", path: "", parentId: null, title: "Physics", depth: 0, nodeCount: 2 },
    { id: "folder:waves", path: "waves", parentId: "folder:root", title: "Waves", depth: 1, nodeCount: 2 },
  ].map((folder) => ({ ...folder, summary: { state: "ready", text: "Related physics pages." } })),
  nodes: [
    ["a", "Gauss law", "folder:root"], ["b", "Divergence theorem", "folder:root"],
    ["c", "Wave motion", "folder:waves"], ["d", "Oscillation", "folder:waves"],
  ].map(([id, title, folderId]) => ({
    id, title, folderId, slug: `garden/${id}`, relPath: `${id}.md`, kind: "markdown",
    knowledgeType: "user-note", summary: { state: "ready", text: `${title} relates $E$ and $Q$.` },
    primaryConcepts: ["physics"], supportingConcepts: [], wordCount: 20,
  })),
  edges: [["a", "b"], ["c", "d"], ["a", "c"]].map(([source, target], i) => ({
    id: `edge:${source}:${target}`, source, target, origin: "inferred", score: 0.9 - i * 0.07,
    threshold: 0.68, relationType: "related", direction: "undirected",
    explanation: { state: "ready", text: "Connected through electric flux $\\Phi_E$ and energy." },
    evidence: [],
  })),
  build: { state: "ready", retrievalMode: "semantic-vector", threshold: 0.68 },
};
const config = {
  mode: "thought-topology", drag: true, zoom: true, depth: -1, scope: "all", clickToNavigate: true,
  scale: 0.82, repelForce: 2.8, centerForce: 0.035, linkDistance: 175, fontSize: 0.82,
  opacityScale: 1, removeTags: [], showTags: true, focusOnHover: true, enableRadial: false,
};

test("3D camera preserves screen-plane dragging and scatters large scopes into a stable sphere", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "topology-geometry-"));
  try {
    const outfile = path.join(temporary, "geometry.mjs");
    await build({ entryPoints: [path.join(scripts, "thoughtTopology3DGeometry.ts")], outfile, format: "esm" });
    const { TopologyCamera3D, sphericalTopologyPositions } = await import(pathToFileURL(outfile));
    const camera = new TopologyCamera3D();
    const point = { x: 120, y: -80, z: 170 };
    for (const [dx, dy] of [[0, 0], [320, 75], [180, -140], [1500, 600]]) {
      camera.orbit(dx, dy);
      const roundTrip = camera.unproject(camera.project(point));
      for (const axis of ["x", "y", "z"]) assert.ok(Math.abs(roundTrip[axis] - point[axis]) < 1e-9);
      const delta = camera.unproject({ x: 40, y: -20, z: 0 });
      const before = camera.project(point);
      const after = camera.project({ x: point.x + delta.x, y: point.y + delta.y, z: point.z + delta.z });
      assert.ok(Math.abs(after.x - before.x - 40) < 1e-9);
      assert.ok(Math.abs(after.y - before.y + 20) < 1e-9);
      assert.ok(Math.abs(after.z - before.z) < 1e-9);
    }
    const garden = { id: "garden", kind: "garden", sectorId: null, folderId: null };
    assert.deepEqual([...sphericalTopologyPositions([])], []);
    assert.deepEqual(sphericalTopologyPositions([garden]).get("garden"), { x: 0, y: 0, z: 0 });
    // A single huge folder and an uneven mix must both fill the whole sphere.
    for (const folderCount of [1, 7]) {
      const nodes = [garden, ...Array.from({ length: 1200 }, (_, i) => ({
        id: `page:${i}`, kind: "page",
        sectorId: `folder:${i < 900 ? 0 : i % folderCount}`,
        folderId: `folder:${i < 900 ? 0 : i % folderCount}`,
        // Legacy worker coordinates must not turn the cloud into a rectangle.
        x: i * 20, y: (i % 2) * 100,
      }))];
      const positions = sphericalTopologyPositions(nodes);
      assert.deepEqual(positions, sphericalTopologyPositions([...nodes].reverse()));
      assert.deepEqual(positions.get("garden"), { x: 0, y: 0, z: 0 });
      const points = [...positions.values()];
      const radius = Math.max(...points.map((p) => Math.hypot(p.x, p.y, p.z)));
      for (const axis of ["x", "y", "z"]) {
        const centroid = points.reduce((sum, p) => sum + p[axis], 0) / points.length;
        assert.ok(Math.abs(centroid) < radius * 0.08, `${axis} stays centred on the Garden`);
      }
      for (let orbit = 0; orbit < 8; orbit++) {
        camera.yaw = orbit * Math.PI / 4;
        camera.pitch = (orbit % 3 - 1) * Math.PI / 4;
        const projected = points.map((p) => camera.project(p));
        const rim = Array.from({ length: 16 }, (_, i) => {
          const angle = i * Math.PI / 8;
          return Math.max(...projected.map((p) => p.x * Math.cos(angle) + p.y * Math.sin(angle)));
        });
        assert.ok(Math.min(...rim) / Math.max(...rim) > 0.9, "the outline stays circular throughout orbit");
      }
    }
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test("3D is the only visible viewer and preserves orbit, text, navigation, filters and XYZ pinning", { timeout: 120_000 }, async (t) => {
  const executablePath = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium",
  ].find(existsSync);
  if (!executablePath) return t.skip("No installed Chromium/Edge executable");
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "topology-3d-browser-"));
  const screenshotDirectory = process.env.TOPOLOGY_3D_QA_DIR || temporary;
  await fs.mkdir(screenshotDirectory, { recursive: true });
  const css = sass.compile(path.join(root, "quartz/quartz/components/styles/graph.scss")).css;
  for (const [name, module] of [["legacy", path.join(scripts, "thoughtTopologyRenderer.ts")], ["quartz", path.join(scripts, "thoughtTopologyViewer.ts")],
    ["profile", path.join(root, "dashboard/src/vendor/quartz-thought-topology/renderer.generated.js")]]) {
    await build({
      stdin: { contents: `import { renderThoughtTopology } from ${JSON.stringify(module)};
        const host = document.querySelector('.global-graph-container, .graph-container');
        const close = document.querySelector('.global-graph-close, .global-graph-icon');
        close.addEventListener('click', () => {
          const expanded = close.className === 'global-graph-icon';
          close.className = expanded ? 'global-graph-close' : 'global-graph-icon';
          close.setAttribute('aria-label', expanded ? 'Close Graph' : 'Expand Graph');
          host.parentElement.dataset.expanded = String(expanded);
        });
        const renderConfig = { ...${JSON.stringify(config)}, preview: new URLSearchParams(location.search).has("preview") };
        const context = { scopeCluster: 'garden', scopeFolderPath: null, configuredDepth: -1,
          onNavigate: (id, slug) => { window.opened = { id, slug } } };
        window.topologyPayload = ${JSON.stringify(topology)};
        window.remount = async () => { window.dispose?.(); window.dispose = await renderThoughtTopology(host, 'garden', renderConfig, window.topologyPayload, context); };
        await window.remount();`, resolveDir: root },
      outfile: path.join(temporary, `${name}.js`), bundle: true, format: "esm", platform: "browser",
    });
  }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const inline = url.searchParams.has("inline");
    if (url.pathname.endsWith(".js")) {
      res.setHeader("content-type", "application/javascript");
      res.end(await fs.readFile(path.join(temporary, path.basename(url.pathname))));
    } else {
      res.setHeader("content-type", "text/html");
      res.end(`<!doctype html><html saved-theme="${url.searchParams.get("theme") === "dark" ? "dark" : "light"}"><head><style>
        :root { --light: #e6f0e6; --lightgray: #c6d6ca; --dark: #0f1a16; --darkgray: #13201b; --secondary: #2563eb; --tertiary: #15803d; --bodyFont: system-ui; }
        [saved-theme="dark"] { --light: #18181a; --lightgray: #343a36; --dark: #f4f1e8; --darkgray: #e6ebe5; }
        body { margin: 0; } ${css}
        body { font-family: system-ui; }
        .graph > .graph-outer { width: 90vw; height: 360px; position: relative; }
        .graph > .graph-outer > .graph-container { width: 100%; height: 100%; }
        .graph > .graph-outer[data-expanded="true"] { position: fixed; inset: 0; width: 100vw; height: 100vh; }
        .graph-outer > .global-graph-close { position: absolute; right: 1.25rem; top: 1.25rem; z-index: 10002; }
        </style><meta charset="utf-8"></head><body><div class="graph home-knowledge-graph"><div class="${inline ? "graph-outer" : "global-graph-outer active"}">
          <div class="${inline ? "graph-container" : "global-graph-container"}"></div><div class="thought-topology-controls">
          <div class="thought-topology-heading"><h2>Thought Topology</h2><p></p><p class="thought-topology-analysis"></p></div></div>
          <div class="thought-callout" role="status" aria-hidden="true"></div>
          <button class="${inline ? "global-graph-icon" : "global-graph-close"}" aria-label="${inline ? "Expand Graph" : "Close Graph"}">×</button>
        </div></div><script type="module" src="/${["profile", "legacy"].includes(url.searchParams.get("surface")) ? url.searchParams.get("surface") : "quartz"}.js"></script></body></html>`);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const debug = () => page.evaluate(() => window.__breadboardThoughtTopologyDebug);
  const ready = async (mode, pauseSpin = true) => {
    await page.waitForFunction((mode) => {
      const state = window.__breadboardThoughtTopologyDebug;
      return state?.nodes?.a && state.viewSettled && (state.dimension ?? "2d") === mode;
    }, mode);
    // Explicitly pause the default spin for deterministic geometry assertions.
    // The startup behavior is exercised separately on both production surfaces.
    const spin = page.getByRole("button", { name: "Spin", exact: true });
    if (mode === "3d" && pauseSpin && await spin.count() && await spin.getAttribute("aria-pressed") === "true") {
      await spin.click();
      await page.waitForFunction(() => !window.__breadboardThoughtTopologyDebug.spinning);
      await page.mouse.move(20, 760);
    }
  };
  const background = () => page.locator(".global-graph-container").evaluate((el) => getComputedStyle(el).background);
  const moveTo = async (point) => page.mouse.move(point.x, point.y);
  const callout = page.locator(".thought-callout");
  // The retained 2D module is a visual baseline, never a selectable app view.
  await page.goto(`http://127.0.0.1:${server.address().port}/?topologyTest=1&surface=legacy`);
  await ready("2d");
  const baseBackground = await background();
  const originalEdges = (await debug()).edges;
  for (const surface of ["quartz", "profile"]) {
    await page.goto(`http://127.0.0.1:${server.address().port}/?topologyTest=1&surface=${surface}`);
    await ready("3d", false);
    assert.equal(await page.getByRole("button", { name: "Spin", exact: true }).getAttribute("aria-pressed"), "true", "spin starts enabled");
    const startupYaw = (await debug()).camera.yaw;
    await page.waitForFunction((yaw) => window.__breadboardThoughtTopologyDebug.camera.yaw > yaw + 0.01, startupYaw);
    const spinFrames = await page.evaluate(() => new Promise(resolve => {
      const angles = [];
      const sample = () => {
        angles.push(window.__breadboardThoughtTopologyDebug.camera.yaw);
        if (angles.length === 12) resolve(angles);
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
    assert.ok(spinFrames.every((yaw, index) => index === 0 || yaw >= spinFrames[index - 1]), "automatic spin never reverses");
    assert.ok(spinFrames.at(-1) > spinFrames[0], "automatic spin keeps moving");
    await ready("3d");
    assert.equal(await page.locator(".thought-topology-dimension").count(), 0);
    assert.equal(await page.getByRole("button", { name: /^(2D|3D)$/ }).count(), 0);
    const twoDStorage = await page.evaluate(() => localStorage.getItem("thought-topology-home-positions:v2:garden:root"));
    assert.equal(await background(), baseBackground, "background remains identical");
    const initial = await debug();
    assert.deepEqual(initial.worldNodes["garden:garden"], { x: 0, y: 0, z: 0 }, "Garden stays at the centre of rotation");
    assert.deepEqual(initial.nodes["garden:garden"], { x: 640, y: 400 }, "Garden is centred in the viewport");
    assert.ok(new Set(Object.values(initial.worldNodes).map((point) => Math.round(point.z))).size > 3);
    for (const [id, edge] of Object.entries(initial.edges)) {
      assert.equal(edge.restColor, originalEdges[id].restColor);
      assert.equal(edge.baseWidth, originalEdges[id].baseWidth);
    }
    const spin = page.getByRole("button", { name: "Spin", exact: true });
    const filters = page.getByRole("button", { name: "Filters", exact: true });
    const spinBox = await spin.boundingBox();
    const filterBox = await filters.boundingBox();
    assert.ok(spinBox.y >= filterBox.y + filterBox.height, "Spin sits below Filters");
    assert.equal(spinBox.x, filterBox.x);
    const buttonStyle = (el) => {
      const style = getComputedStyle(el);
      return [style.height, style.backgroundColor, style.borderColor, style.borderRadius, style.font];
    };
    await page.waitForFunction(() => {
      const spin = document.querySelector(".thought-topology-spin");
      const filters = document.querySelector(".thought-topology-filter-toggle:not(.thought-topology-spin)");
      return getComputedStyle(spin).borderColor === getComputedStyle(filters).borderColor;
    });
    assert.deepEqual(await spin.evaluate(buttonStyle), await filters.evaluate(buttonStyle));
    assert.equal(await spin.getAttribute("aria-pressed"), "false");
    await spin.click();
    await page.waitForFunction((yaw) => window.__breadboardThoughtTopologyDebug.camera.yaw > yaw + 0.01, initial.camera.yaw);
    assert.deepEqual((await debug()).worldNodes, initial.worldNodes, "spin rotates the camera without moving nodes");
    const spinningEdge = (await debug()).edges["edge:a:b"];
    await page.mouse.click(spinningEdge.x, spinningEdge.y);
    await page.waitForFunction(() => window.__breadboardThoughtTopologyDebug.selectedConnectionId === "edge:a:b");
    assert.equal(await spin.getAttribute("aria-pressed"), "true", "selecting a line keeps spin enabled");
    const selectedYaw = (await debug()).camera.yaw;
    await page.waitForFunction((yaw) => window.__breadboardThoughtTopologyDebug.camera.yaw > yaw + 0.01, selectedYaw);
    await spin.press("Space");
    assert.equal(await spin.getAttribute("aria-pressed"), "false");
    await page.waitForFunction(() => !window.__breadboardThoughtTopologyDebug.spinning);
    const stoppedCamera = (await debug()).camera;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual((await debug()).camera, stoppedCamera, "Spin can be stopped with the keyboard");
    await moveTo((await debug()).edges["edge:a:b"]);
    await page.waitForFunction(() => document.querySelector('.thought-callout.visible[data-kind="edge"]'));
    assert.match(await callout.getAttribute("style"), /perspective\(900px\).*rotateX\(.*rotateY\(/);
    assert.ok(await callout.locator(".katex").count() > 0, "math remains rendered inside the 3D text");
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector(".thought-callout")).opacity) > 0.99);
    await page.screenshot({ path: path.join(screenshotDirectory, `${surface}-3d.png`) });

    // Empty-space orbit changes the camera, never the XYZ layout.
    await spin.click();
    await page.mouse.move(60, 730);
    await page.mouse.down();
    await page.mouse.move(210, 690, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction((yaw) => window.__breadboardThoughtTopologyDebug.camera.yaw !== yaw, initial.camera.yaw);
    assert.equal(await spin.getAttribute("aria-pressed"), "true", "manual orbit keeps spin enabled");
    const orbitYaw = (await debug()).camera.yaw;
    const spinningScale = (await debug()).transform.k;
    await page.mouse.wheel(0, -40);
    await page.waitForFunction((k) => window.__breadboardThoughtTopologyDebug.transform.k > k, spinningScale);
    assert.equal(await spin.getAttribute("aria-pressed"), "true", "zooming keeps spin enabled");
    const enlargedScale = (await debug()).transform.k;
    await page.mouse.wheel(0, 40);
    await page.waitForFunction((k) => window.__breadboardThoughtTopologyDebug.transform.k < k, enlargedScale);
    assert.equal(await spin.getAttribute("aria-pressed"), "true", "zooming out keeps spin enabled");
    await page.setViewportSize({ width: 1270, height: 790 });
    await page.waitForFunction(() => document.querySelector("canvas").clientWidth === 1270);
    assert.equal(await spin.getAttribute("aria-pressed"), "true", "resizing keeps spin enabled");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() => document.querySelector("canvas").clientWidth === 1280);
    await page.waitForFunction((yaw) => window.__breadboardThoughtTopologyDebug.camera.yaw > yaw + 0.01, orbitYaw);
    await spin.click();
    await page.waitForFunction(() => !window.__breadboardThoughtTopologyDebug.spinning);
    const rotated = await debug();
    assert.deepEqual(rotated.worldNodes, initial.worldNodes);
    assert.notDeepEqual(rotated.nodes.a, initial.nodes.a);
    await page.keyboard.down("Shift");
    await page.mouse.move(60, 730); await page.mouse.down();
    await page.mouse.move(100, 750, { steps: 4 }); await page.mouse.up();
    await page.keyboard.up("Shift");
    await page.waitForFunction((x) => window.__breadboardThoughtTopologyDebug.transform.x !== x, rotated.transform.x);
    assert.deepEqual((await debug()).camera, rotated.camera, "Shift-drag pans without rotating");
    const panScale = (await debug()).transform.k;
    await page.mouse.wheel(0, -150);
    await page.waitForFunction((k) => window.__breadboardThoughtTopologyDebug.transform.k > k, panScale);

    // Dragging follows the cursor after orbit, then right release pins XYZ.
    const start = (await debug()).nodes.a;
    await moveTo(start); await page.mouse.down({ button: "right" });
    await page.mouse.move(start.x + 45, start.y + 25, { steps: 6 });
    await page.waitForFunction(() => window.__breadboardThoughtTopologyDebug.activeDragNodeId === "a");
    const dragged = (await debug()).nodes.a;
    assert.ok(Math.abs(dragged.x - start.x - 45) < 2);
    assert.ok(Math.abs(dragged.y - start.y - 25) < 2);
    await page.mouse.up({ button: "right" });
    await page.waitForFunction(() => window.__breadboardThoughtTopologyDebug.permanentNodeIds.includes("a"));
    assert.equal(await page.evaluate(() => localStorage.getItem("thought-topology-home-positions:v2:garden:root")), twoDStorage);
    const pinned = (await debug()).worldNodes.a;
    assert.ok(Number.isFinite(pinned.z));
    await page.evaluate(() => window.remount()); await ready("3d");
    assert.deepEqual((await debug()).worldNodes.a, pinned, "3D pins survive remount");
    await moveTo((await debug()).nodes.a);
    await page.mouse.click((await debug()).nodes.a.x, (await debug()).nodes.a.y, { button: "right" });
    await page.locator(".thought-inspector.open").waitFor();
    assert.match(await page.locator(".thought-inspector").innerText(), /Gauss law/);
    await page.getByRole("button", { name: "Close node connections", exact: true }).click();
    const nav = (await debug()).nodes.a;
    await page.mouse.click(nav.x, nav.y);
    await page.waitForFunction(() => window.opened?.id === "a");
    await spin.click();
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    const hierarchy = page.getByRole("checkbox", { name: "Show folder lines", exact: true });
    await hierarchy.uncheck();
    await page.waitForFunction(() => window.__breadboardThoughtTopologyDebug.visibleLayers.hierarchy === false);
    await hierarchy.check();
    await page.waitForFunction(() => window.__breadboardThoughtTopologyDebug.visibleLayers.hierarchy === true);
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    assert.equal(await spin.getAttribute("aria-pressed"), "true", "filters retain the spin setting");
    await spin.click();
    // Reopening keeps a single 3D canvas and a single copy of its controls.
    for (let i = 0; i < 3; i++) { await page.evaluate(() => window.remount()); await ready("3d"); }
    assert.equal(await background(), baseBackground);
    assert.equal(await page.locator(".thought-topology-dimension").count(), 0);
    assert.equal(await page.locator("canvas").count(), 1);
    assert.equal(await page.locator(".thought-topology-filter").count(), 1);
    assert.equal(await spin.count(), 1);
    assert.equal(await page.locator(".thought-inspector").count(), 1);
    await page.evaluate(() => localStorage.clear());
  }
  await page.goto(`http://127.0.0.1:${server.address().port}/?topologyTest=1&theme=dark`);
  await ready("3d");
  assert.notEqual(await background(), baseBackground);
  await page.screenshot({ path: path.join(screenshotDirectory, "dark-3d.png") });
  await page.setViewportSize({ width: 420, height: 740 });
  await page.waitForFunction(() => document.querySelector("canvas").clientWidth === 420);
  await page.screenshot({ path: path.join(screenshotDirectory, "mobile-3d.png") });
  await moveTo((await debug()).edges["edge:a:b"]);
  await page.locator('.thought-callout.visible[data-kind="edge"]').waitFor();
  const mobileText = await callout.boundingBox();
  assert.ok(mobileText.x >= 0 && mobileText.x + mobileText.width <= 420);
  await page.setViewportSize({ width: 320, height: 640 });
  assert.equal(await page.getByRole("button", { name: "Close Graph", exact: true }).isVisible(), true);

  // The profile expands its existing inline canvas instead of mounting Quartz's overlay.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`http://127.0.0.1:${server.address().port}/?topologyTest=1&surface=profile&inline=1`);
  await ready("3d");
  assert.equal(await page.locator(".thought-topology-dimension").count(), 0);
  await page.getByRole("button", { name: "Expand Graph", exact: true }).click();
  await ready("3d");
  await page.getByRole("button", { name: "Close Graph", exact: true }).click();
  assert.equal(await page.locator(".thought-topology-dimension").isVisible(), false);
  assert.equal(await page.locator("canvas").count(), 1);
  await page.getByRole("button", { name: "Expand Graph", exact: true }).click();
  await ready("3d");
  await page.evaluate(() => window.dispose());
  assert.equal(await page.locator("canvas, .thought-topology-dimension, .thought-inspector, .thought-topology-filter").count(), 0);

  await page.goto(`http://127.0.0.1:${server.address().port}/?topologyTest=1&preview=1`);
  await ready("3d");
  assert.equal(await page.locator(".thought-topology-dimension, .thought-topology-filter, .thought-inspector").count(), 0);
  assert.ok(Object.values((await debug()).worldNodes).some((point) => point.z !== 0));

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`http://127.0.0.1:${server.address().port}/?topologyTest=1`);
  await ready("3d");
  const springSpin = page.getByRole("button", { name: "Spin", exact: true });
  await springSpin.click();
  const springStart = (await debug()).nodes.b;
  const springHome = (await debug()).worldNodes.b;
  await moveTo(springStart); await page.mouse.down();
  await page.mouse.move(springStart.x + 48, springStart.y - 32, { steps: 6 });
  assert.equal(await springSpin.getAttribute("aria-pressed"), "true", "dragging a node keeps spin enabled");
  await page.mouse.up();
  await springSpin.click();
  await page.mouse.move(20, 760);
  await page.waitForFunction(() => {
    const state = window.__breadboardThoughtTopologyDebug;
    return state.simulationSettled && !state.returningNodeIds.includes("b");
  });
  const returned = (await debug()).worldNodes.b;
  for (const axis of ["x", "y", "z"]) assert.ok(Math.abs(returned[axis] - springHome[axis]) < 0.1, `temporary drag returns along ${axis}`);
  await page.evaluate(() => {
    window.oldCanvas = document.querySelector("canvas");
    window.oldCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
  });
  await page.waitForFunction(() => document.querySelector("canvas") && document.querySelector("canvas") !== window.oldCanvas);
  await ready("3d");
  assert.equal(await page.locator("canvas").count(), 1);

  // Exercise the real force layout with a large, uneven Garden as well as the
  // pure scatter above. Legacy rectangular worker positions are intentional.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(async () => {
    const payload = window.topologyPayload;
    const template = payload.nodes[0];
    payload.garden.title = "Large garden";
    payload.folders = [payload.folders[0], ...[300, 150, 80, 40, 30].map((nodeCount, i) => ({
      ...payload.folders[1], id: `folder:${i}`, path: `section-${i}`, title: `Section ${i + 1}`, nodeCount,
    }))];
    let i = 0;
    payload.nodes = payload.folders.slice(1).flatMap((folder) => Array.from({ length: folder.nodeCount }, () => {
      const index = i++;
      return { ...template, id: index === 0 ? "a" : `large:${index}`, folderId: folder.id,
        title: `Thought ${index}`, slug: `garden/thought-${index}`, x: (index % 30) * 60, y: Math.floor(index / 30) * 60 };
    }));
    payload.edges = payload.nodes.slice(1).map((node, index) => ({
      ...payload.edges[0], id: `large-edge:${index}`, source: payload.nodes[index].id, target: node.id,
    }));
    await window.remount();
  });
  await ready("3d");
  const large = await debug();
  assert.deepEqual(large.worldNodes["garden:garden"], { x: 0, y: 0, z: 0 });
  const gardenCentre = large.nodes["garden:garden"];
  assert.ok(Math.abs(gardenCentre.x - 640) < 2 && Math.abs(gardenCentre.y - 400) < 2, "Garden name is framed in the centre");
  const cloud = Object.values(large.worldNodes);
  const spans = ["x", "y", "z"].map((axis) => Math.max(...cloud.map((p) => p[axis])) - Math.min(...cloud.map((p) => p[axis])));
  await page.screenshot({ path: path.join(screenshotDirectory, "large-garden-3d.png") });
  assert.ok(Math.min(...spans) / Math.max(...spans) > 0.75, `large settled cloud stays round: ${spans}`);
  for (const point of Object.values(large.nodes)) {
    assert.ok(point.x >= 0 && point.x <= 1280 && point.y >= 0 && point.y <= 800, "auto-fit contains the large cloud");
  }
  assert.deepEqual(errors, []);
});
