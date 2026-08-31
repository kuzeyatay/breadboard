import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const root = path.resolve(
  new URL("../../", import.meta.url).pathname.replace(
    /^\/(?:[A-Za-z]:)/,
    (value) => value.slice(1),
  ),
);
const quartzRoot = path.join(root, "quartz");

function edgeExecutable() {
  return [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium",
  ].find((candidate) => fs.existsSync(candidate));
}

function serve(rootDirectory, topology) {
  const wrapper = (port) => `<!doctype html><html><body style="margin:0">
    <iframe id="viewer" src="http://127.0.0.1:${port}/garden/?topologyTest=1" style="border:0;width:100vw;height:100vh"></iframe>
    <script>window.topologyRequests=[]; window.rejectTopology=false;
      addEventListener("message", (event) => {
        window.topologyRequests.push({origin:event.origin,type:event.data?.type,clusterSlug:event.data?.clusterSlug});
        const viewer = document.getElementById("viewer");
        const viewerOrigin = new URL(viewer.src).origin;
        if (event.source !== viewer.contentWindow) return;
        if (event.origin !== viewerOrigin) return;
        if (event.data?.type !== "breadboard:thought-topology-request") return;
        if (window.rejectTopology) {
          event.source.postMessage({ type: "breadboard:thought-topology-response", requestId: event.data.requestId, ok: false }, viewerOrigin);
          return;
        }
        event.source.postMessage({ type: "breadboard:thought-topology-response", requestId: event.data.requestId, ok: true, payload: { enabled: true, mode: "thought-topology", topology: ${JSON.stringify(topology).replace(/</g, "\\u003c")}, status: { state: "failed", message: "Showing the last available topology; the latest update failed." } } }, viewerOrigin);
      });
    </script></body></html>`;
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(wrapper(server.address().port));
      return;
    }
    const relative = pathname.replace(/^\/+/, "") || "index.html";
    let filePath = path.resolve(rootDirectory, relative);
    if (pathname.endsWith("/")) filePath = path.join(filePath, "index.html");
    if (!fs.existsSync(filePath) && fs.existsSync(`${filePath}.html`)) {
      filePath = `${filePath}.html`;
    }
    if (
      !filePath.startsWith(path.resolve(rootDirectory)) ||
      !fs.existsSync(filePath)
    ) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }
    const extension = path.extname(filePath);
    response.setHeader(
      "content-type",
      extension === ".html"
        ? "text/html"
        : extension === ".js"
          ? "application/javascript"
          : extension === ".css"
            ? "text/css"
            : "application/octet-stream",
    );
    response.end(fs.readFileSync(filePath));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

test(
  "real browser topology interactions preserve selection, navigation, drag, and anchored callouts",
  { timeout: 180_000 },
  async (t) => {
    const executablePath = edgeExecutable();
    if (!executablePath) return t.skip("No installed Chromium/Edge executable");
    const temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "breadboard-topology-browser-"),
    );
    const content = path.join(temporary, "content");
    const output = path.join(temporary, "public");
    fs.mkdirSync(path.join(content, "garden"), { recursive: true });
    fs.writeFileSync(
      path.join(content, "garden", "_index.md"),
      "---\ntitle: Browser Garden\nknowledge_type: garden-overview\n---\n\n# Browser Garden\n",
    );
    fs.writeFileSync(
      path.join(content, "garden", "note-a.md"),
      "---\ntitle: Gauss law\n---\n\n# Gauss law\n\nElectric flux.\n",
    );
    fs.writeFileSync(
      path.join(content, "garden", "note-b.md"),
      "---\ntitle: Divergence theorem\n---\n\n# Divergence theorem\n\nSurface flux and divergence.\n",
    );
    const folderPath = "module-v-waves-and-oscilations";
    fs.mkdirSync(path.join(content, "garden", folderPath), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(content, "garden", folderPath, "_index.md"),
      "---\ntitle: Module V Waves And Oscilations\n---\n\n# Module V Waves And Oscilations\n",
    );
    fs.writeFileSync(
      path.join(content, "garden", folderPath, "wave-a.md"),
      "---\ntitle: Wave motion\n---\n\n# Wave motion\n\nTravelling waves.\n",
    );
    fs.writeFileSync(
      path.join(content, "garden", folderPath, "wave-b.md"),
      "---\ntitle: Oscillation\n---\n\n# Oscillation\n\nHarmonic oscillation.\n",
    );
    const build = spawnSync(
      process.execPath,
      [
        "quartz/bootstrap-cli.mjs",
        "build",
        "-d",
        content,
        "-o",
        output,
        "--concurrency",
        "1",
      ],
      {
        cwd: quartzRoot,
        encoding: "utf8",
        timeout: 120_000,
        windowsHide: true,
      },
    );
    assert.equal(build.status, 0, build.stderr || build.stdout);
    const topology = {
      schemaVersion: 1,
      scoringVersion: "thought-topology-affinity-v1",
      sourceRevision: "browser-fixture",
      garden: {
        id: 1,
        slug: "garden",
        title: "Browser Garden",
        summary: { state: "ready", text: "A browser test Garden." },
      },
      folders: [
        {
          id: "folder:$root",
          path: "",
          parentId: null,
          title: "Garden root",
          depth: 0,
          nodeCount: 2,
          summary: { state: "ready", text: "Two electromagnetics pages." },
          x: -130,
          y: 100,
        },
        {
          id: "folder:waves",
          path: folderPath,
          parentId: "folder:$root",
          title: "Module V Waves And Oscilations",
          depth: 1,
          nodeCount: 2,
          summary: { state: "ready", text: "Two pages about waves." },
          pageSlug: `garden/${folderPath}`,
        },
      ],
      nodes: [
        {
          id: "page:note-a",
          slug: "garden/note-a",
          relPath: "note-a.md",
          folderId: "folder:$root",
          title: "Gauss law",
          kind: "markdown",
          knowledgeType: "user-note",
          contentHash: "a",
          summary: {
            state: "ready",
            text: "Gauss law relates electric flux $\\Phi_E$ to enclosed charge $Q/\\varepsilon_0$.",
          },
          primaryConcepts: ["electric-flux"],
          supportingConcepts: ["divergence"],
          claimIds: [],
          wordCount: 8,
          x: -80,
          y: 0,
        },
        {
          id: "page:note-b",
          slug: "garden/note-b",
          relPath: "note-b.md",
          folderId: "folder:$root",
          title: "Divergence theorem",
          kind: "markdown",
          knowledgeType: "user-note",
          contentHash: "b",
          summary: {
            state: "ready",
            text: "The divergence theorem connects volume divergence and surface flux.",
          },
          primaryConcepts: ["divergence"],
          supportingConcepts: ["electric-flux"],
          claimIds: [],
          wordCount: 9,
          x: 90,
          y: 0,
        },
        {
          id: "page:wave-a",
          slug: `garden/${folderPath}/wave-a`,
          relPath: `${folderPath}/wave-a.md`,
          folderId: "folder:waves",
          title: "Wave motion",
          kind: "markdown",
          knowledgeType: "user-note",
          contentHash: "wave-a",
          summary: { state: "ready", text: "Wave motion carries energy." },
          primaryConcepts: ["waves"],
          supportingConcepts: ["oscillation"],
          claimIds: [],
          wordCount: 8,
        },
        {
          id: "page:wave-b",
          slug: `garden/${folderPath}/wave-b`,
          relPath: `${folderPath}/wave-b.md`,
          folderId: "folder:waves",
          title: "Oscillation",
          kind: "markdown",
          knowledgeType: "user-note",
          contentHash: "wave-b",
          summary: {
            state: "ready",
            text: "Oscillation repeats around equilibrium.",
          },
          primaryConcepts: ["oscillation"],
          supportingConcepts: ["waves"],
          claimIds: [],
          wordCount: 8,
        },
      ],
      edges: [
        {
          id: "edge:gauss-divergence",
          source: "page:note-a",
          target: "page:note-b",
          origin: "inferred",
          score: 0.88,
          previousScore: 0.84,
          threshold: 0.68,
          components: { embedding: 0.94, concept: 0.75, lexical: 0.62 },
          relationType: "applies-to",
          direction: "source-to-target",
          explanation: {
            state: "ready",
            text: "The divergence theorem supplies the volume-to-surface transformation used by Gauss law, where $\\nabla \\cdot \\mathbf{E}=\\rho/\\varepsilon_0$.",
          },
          evidence: [{ kind: "concept", label: "electric-flux" }],
          pairHash: "pair",
          visual: { width: 3.2, opacity: 0.72, distance: 120, strength: 0.3 },
        },
        {
          id: "edge:waves",
          source: "page:wave-a",
          target: "page:wave-b",
          origin: "inferred",
          score: 0.9,
          threshold: 0.68,
          relationType: "related",
          direction: "undirected",
          explanation: {
            state: "ready",
            text: "The wave repeats periodically.",
          },
          evidence: [],
          visual: { width: 3.5, opacity: 0.74, distance: 120, strength: 0.34 },
        },
        {
          id: "edge:cross-folder",
          source: "page:note-a",
          target: "page:wave-a",
          origin: "inferred",
          score: 0.8,
          threshold: 0.68,
          relationType: "related",
          direction: "undirected",
          explanation: { state: "ready", text: "A cross-folder fixture edge." },
          evidence: [],
        },
      ],
      build: {
        state: "ready",
        generatedAt: "2026-01-01T00:00:00.000Z",
        embeddingModel: "local/bge-small-en-v1.5",
        embeddingDimension: 3,
        summaryModel: "default",
        nodePromptVersion: "v1",
        edgePromptVersion: "v1",
        retrievalMode: "semantic-vector",
        threshold: 0.68,
      },
    };
    const server = await serve(output, topology);
    const address = server.address();
    const browser = await chromium.launch({ executablePath, headless: true });
    t.after(async () => {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(temporary, { recursive: true, force: true });
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
    const browserErrors = [];
    page.on("pageerror", (error) =>
      browserErrors.push(`pageerror: ${error.message}`),
    );
    page.on("console", (message) => {
      if (message.type() === "error")
        browserErrors.push(`console: ${message.text()}`);
    });
    await page.goto(`http://localhost:${address.port}/`);
    const frame = page
      .frames()
      .find((candidate) => candidate !== page.mainFrame());
    assert.ok(frame);
    try {
      await frame.waitForFunction(
        () => window.__breadboardThoughtTopologyDebug?.nodes?.["page:note-a"],
        null,
        { timeout: 12_000 },
      );
    } catch {
      assert.fail(
        `Topology did not render at ${frame.url()}: cfg=${await frame.locator(".graph-container").getAttribute("data-cfg")} active=${await frame.locator(".graph-container").getAttribute("data-active-mode")} requests=${JSON.stringify(await page.evaluate(() => window.topologyRequests))} errors=${browserErrors.join(" | ")} body=${(await frame.locator("body").innerText()).slice(0, 500)}`,
      );
    }
    await frame
      .getByRole("status")
      .filter({ hasText: "latest update failed" })
      .waitFor();
    assert.equal(
      await frame.locator(".graph-outer .global-graph-search").count(),
      0,
      "Thought Topology does not render page search",
    );
    const canvas = frame.locator(
      ".graph.home-knowledge-graph > .graph-outer canvas",
    );
    const box = await canvas.boundingBox();
    assert.ok(box);
    // Force motion and programmatic focus can move the map; positions are only
    // meaningful once the view has settled.
    const point = async (kind, id) => {
      await frame.waitForFunction(
        () => window.__breadboardThoughtTopologyDebug?.viewSettled !== false,
      );
      return frame.evaluate(
        ({ kind, id }) => window.__breadboardThoughtTopologyDebug[kind][id],
        { kind, id },
      );
    };
    const hierarchy = await frame.evaluate(
      () => window.__breadboardThoughtTopologyDebug.hierarchyEdges,
    );
    assert.deepEqual(
      Object.values(hierarchy)
        .map((item) => [item.source, item.target])
        .sort(),
      [
        ["folder:$root", "page:note-a"],
        ["folder:$root", "page:note-b"],
        ["folder:waves", "page:wave-a"],
        ["folder:waves", "page:wave-b"],
        ["garden:garden", "folder:$root"],
        ["garden:garden", "folder:waves"],
      ].sort(),
    );
    const straightEdge = await point("edges", "edge:gauss-divergence");
    const firstEndpoint = await point("nodes", "page:note-a");
    const secondEndpoint = await point("nodes", "page:note-b");
    assert.ok(
      Math.abs(straightEdge.x - (firstEndpoint.x + secondEndpoint.x) / 2) < 1,
    );
    assert.ok(
      Math.abs(straightEdge.y - (firstEndpoint.y + secondEndpoint.y) / 2) < 1,
    );
    const renderedAffinityWidths = Object.values(
      await frame.evaluate(() => window.__breadboardThoughtTopologyDebug.edges),
    ).map((item) => item.baseWidth);
    assert.ok(
      Math.max(...renderedAffinityWidths) -
        Math.min(...renderedAffinityWidths) >
        1.5,
      "stored topology affinities should render with clearly different thicknesses",
    );
    const clickPoint = async (location) => {
      await page.mouse.move(box.x + location.x, box.y + location.y);
      await page.mouse.down();
      await page.mouse.up();
    };
    const resetViewer = async () => {
      await page.evaluate(() => {
        const iframe = document.getElementById("viewer");
        const url = new URL(iframe.src);
        url.pathname = "/garden/";
        url.search = `?topologyTest=1&reset=${Date.now()}`;
        iframe.src = url.toString();
      });
      await frame.waitForFunction(
        () => window.__breadboardThoughtTopologyDebug?.nodes?.["page:note-a"],
      );
    };

    const initialUrl = frame.url();
    const noteAPoint = await point("nodes", "page:note-a");
    await page.mouse.move(box.x + noteAPoint.x, box.y + noteAPoint.y);
    await frame.locator(".graph-outer .thought-callout.visible").waitFor();
    assert.match(
      await frame.locator(".graph-outer .thought-callout").innerText(),
      /Gauss law relates electric flux/,
    );
    assert.equal(
      await frame.locator(".graph-outer .thought-callout .katex").count(),
      2,
      "inline formulas in floating node text should render with KaTeX",
    );
    assert.equal(
      await frame.locator(".graph-outer .thought-callout-kicker").count(),
      0,
      "floating text should not have category headlines",
    );
    const hoverCalloutBox = await frame
      .locator(".graph-outer .thought-callout")
      .boundingBox();
    assert.ok(hoverCalloutBox);
    assert.ok(
      Math.hypot(
        hoverCalloutBox.x - (box.x + noteAPoint.x),
        hoverCalloutBox.y - (box.y + noteAPoint.y),
      ) < 420,
      "hover text should stay anchored near its node",
    );
    await clickPoint(noteAPoint);
    assert.equal(frame.url(), initialUrl, "first click must not navigate");
    await clickPoint(noteAPoint);
    await frame.waitForFunction(
      () => window.__breadboardThoughtTopologyDebug?.selectedNodeId === null,
    );
    assert.equal(
      frame.url(),
      initialUrl,
      "second click should release the node instead of navigating",
    );
    await page.mouse.move(1, 1);
    await frame
      .locator(".graph-outer .thought-callout")
      .waitFor({ state: "hidden" });

    await page.mouse.move(box.x + noteAPoint.x, box.y + noteAPoint.y);
    await page.mouse.click(box.x + noteAPoint.x, box.y + noteAPoint.y, {
      button: "right",
    });
    await page.waitForTimeout(70);
    assert.equal(frame.url(), initialUrl, "one right click must not navigate");
    await page.mouse.click(box.x + noteAPoint.x, box.y + noteAPoint.y, {
      button: "right",
    });
    await frame.waitForURL(/\/garden\/note-a(?:\.html)?(?:\?|$)/);

    await resetViewer();
    assert.equal(
      await frame
        .locator(".graph.home-knowledge-graph")
        .getAttribute("data-active-mode"),
      "thought-topology",
    );
    assert.equal(
      await frame
        .locator(".graph.home-knowledge-graph > h3")
        .evaluate((node) => getComputedStyle(node).display),
      "none",
    );
    const dragStart = await point("nodes", "page:note-a");
    const dragUrl = frame.url();
    await page.mouse.move(box.x + dragStart.x, box.y + dragStart.y);
    await page.mouse.down();
    await page.mouse.move(box.x + dragStart.x + 28, box.y + dragStart.y + 12, {
      steps: 4,
    });
    const displaced = await point("nodes", "page:note-a");
    assert.ok(
      Math.hypot(displaced.x - dragStart.x, displaced.y - dragStart.y) > 10,
      "the node follows the pointer while held",
    );
    assert.equal(
      await frame.evaluate(
        () => window.__breadboardThoughtTopologyDebug?.labels?.["page:note-a"],
      ),
      "Gauss law",
      "a temporarily dragged node keeps its name attached",
    );
    await page.mouse.up();
    assert.equal(frame.url(), dragUrl, "drag must not navigate");
    await page.mouse.move(box.x + 8, box.y + box.height - 8);
    await frame.waitForFunction(
      () =>
        window.__breadboardThoughtTopologyDebug?.returningNodeIds?.includes(
          "page:note-a",
        ) &&
        window.__breadboardThoughtTopologyDebug?.labels?.["page:note-a"] ===
          "Gauss law",
    );
    await frame.waitForFunction(
      ({ id, x, y }) => {
        const node = window.__breadboardThoughtTopologyDebug?.nodes?.[id];
        return node && Math.hypot(node.x - x, node.y - y) < 1;
      },
      { id: "page:note-a", x: dragStart.x, y: dragStart.y },
    );

    const rightDragStart = await point("nodes", "page:note-a");
    await page.mouse.move(box.x + rightDragStart.x, box.y + rightDragStart.y);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(
      box.x + rightDragStart.x + 34,
      box.y + rightDragStart.y + 16,
      { steps: 4 },
    );
    const rightDisplaced = await point("nodes", "page:note-a");
    assert.equal(
      await frame.evaluate(
        () => window.__breadboardThoughtTopologyDebug?.labels?.["page:note-a"],
      ),
      "Gauss law",
      "a permanently dragged node keeps its name attached while moving",
    );
    await page.mouse.up({ button: "right" });
    await page.mouse.move(box.x + 8, box.y + box.height - 8);
    await page.waitForTimeout(650);
    const rightSettled = await point("nodes", "page:note-a");
    assert.ok(
      Math.hypot(
        rightSettled.x - rightDisplaced.x,
        rightSettled.y - rightDisplaced.y,
      ) < 1,
      "right-dragged nodes stay where released",
    );
    assert.deepEqual(
      await frame.evaluate(() => ({
        permanent:
          window.__breadboardThoughtTopologyDebug?.permanentNodeIds?.includes(
            "page:note-a",
          ),
        label: window.__breadboardThoughtTopologyDebug?.labels?.["page:note-a"],
      })),
      { permanent: true, label: "Gauss law" },
      "right-dragged nodes keep both their new home and their name",
    );
    const persistedWorld = await point("worldNodes", "page:note-a");
    await resetViewer();
    const reloadedWorld = await point("worldNodes", "page:note-a");
    assert.ok(
      Math.hypot(
        reloadedWorld.x - persistedWorld.x,
        reloadedWorld.y - persistedWorld.y,
      ) < 0.1,
      "right-dragged positions survive refresh",
    );
    assert.equal(
      await frame.evaluate(
        () => window.__breadboardThoughtTopologyDebug?.labels?.["page:note-a"],
      ),
      "Gauss law",
      "a saved node name remains visible after refresh",
    );

    // Navigate from inside Quartz so document.referrer is the previous Quartz
    // page, not the dashboard. The bridge must still answer, and this folder
    // view must not leak root/sibling nodes or cross-folder affinities.
    await frame.evaluate((folder) => {
      window.location.href = `/garden/${folder}/?topologyTest=1`;
    }, folderPath);
    await frame.waitForFunction(
      () => window.__breadboardThoughtTopologyDebug?.nodes?.["page:wave-a"],
    );
    assert.equal(
      await frame.evaluate(() =>
        Boolean(window.__breadboardThoughtTopologyDebug.nodes["page:note-a"]),
      ),
      false,
    );
    assert.deepEqual(
      Object.keys(
        await frame.evaluate(
          () => window.__breadboardThoughtTopologyDebug.edges,
        ),
      ),
      ["edge:waves"],
    );
    assert.match(
      await frame
        .locator(".graph > .thought-topology-meta .thought-topology-heading")
        .innerText(),
      /Connections inside Module V Waves and Oscilations/,
    );
    assert.equal(
      await frame
        .locator(".graph > .thought-topology-meta")
        .evaluate((node) =>
          node.nextElementSibling?.classList.contains("graph-outer"),
        ),
      true,
      "Thought Topology metadata sits immediately above the bordered canvas",
    );
    assert.equal(
      await frame.locator(".graph-outer .thought-topology-heading").count(),
      0,
      "inline heading is not overlaid inside the canvas",
    );

    // Individual markdown pages use Thought Topology too, scoped to the
    // containing folder instead of falling back to the legacy Knowledge Map.
    await frame.evaluate((folder) => {
      window.location.href = `/garden/${folder}/wave-a.html?topologyTest=1`;
    }, folderPath);
    try {
      await frame.waitForFunction(
        () =>
          document.querySelector(".right.sidebar .graph")?.dataset
            .activeMode === "thought-topology" &&
          window.__breadboardThoughtTopologyDebug?.nodes?.["page:wave-a"],
      );
    } catch {
      assert.fail(
        `Markdown topology did not render at ${frame.url()}: graph=${await frame.locator(".graph").count()} modes=${JSON.stringify(await frame.locator(".graph").evaluateAll((nodes) => nodes.map((node) => node.dataset.activeMode)))} requests=${JSON.stringify(await page.evaluate(() => window.topologyRequests))} errors=${browserErrors.join(" | ")} body=${(await frame.locator("body").innerText()).slice(0, 500)}`,
      );
    }
    assert.equal(
      await frame
        .locator(
          ".right.sidebar .graph > .thought-topology-meta .thought-topology-heading h3",
        )
        .innerText(),
      "Thought Topology",
    );
    assert.equal(
      await frame.evaluate(() =>
        Boolean(window.__breadboardThoughtTopologyDebug.nodes["page:note-a"]),
      ),
      false,
    );
    assert.deepEqual(
      Object.keys(
        await frame.evaluate(
          () => window.__breadboardThoughtTopologyDebug.edges,
        ),
      ),
      ["edge:waves"],
    );
    await resetViewer();

    const hierarchyEdgeId = "hierarchy:folder:$root:page:note-a";
    await clickPoint(await point("hierarchyEdges", hierarchyEdgeId));
    await frame.waitForFunction(
      (edgeId) =>
        window.__breadboardThoughtTopologyDebug?.selectedConnectionId ===
        edgeId,
      hierarchyEdgeId,
    );
    const selectedHierarchyEdge = await point(
      "hierarchyEdges",
      hierarchyEdgeId,
    );
    assert.ok(
      selectedHierarchyEdge.renderedWidth > selectedHierarchyEdge.baseWidth,
    );
    assert.match(
      await frame.locator(".graph-outer .thought-callout").innerText(),
      /Gauss law is organized under Garden root/i,
    );
    assert.doesNotMatch(
      await frame.locator(".graph-outer .thought-callout").innerText(),
      /Garden structure|Inferred connection/i,
    );

    const edge = await point("edges", "edge:gauss-divergence");
    await page.mouse.move(box.x + edge.x, box.y + edge.y);
    await frame.waitForFunction(() =>
      document
        .querySelector(".graph-outer .thought-callout")
        ?.textContent?.includes("volume-to-surface transformation"),
    );
    await clickPoint(edge);
    await frame.waitForFunction(
      () =>
        window.__breadboardThoughtTopologyDebug?.selectedConnectionId ===
        "edge:gauss-divergence",
    );
    const selectedEdge = await point("edges", "edge:gauss-divergence");
    assert.ok(selectedEdge.renderedWidth > selectedEdge.baseWidth);
    assert.ok(
      (await frame.locator(".graph-outer .thought-callout .katex").count()) > 0,
      "inline formulas in floating line text should render with KaTeX",
    );
    assert.doesNotMatch(
      await frame.locator(".graph-outer .thought-callout").innerText(),
      /Garden structure|Inferred connection/i,
    );
    await page.mouse.move(box.x + 8, box.y + box.height - 8);
    assert.match(
      await frame.locator(".graph-outer .thought-callout").innerText(),
      /volume-to-surface transformation/,
    );

    await resetViewer();
    await frame.locator(".global-graph-icon").click();
    // The redesigned surface keeps its quiet heading and floating text, without
    // exposing the legacy page-search control.
    await frame
      .locator(".global-graph-outer .thought-topology-heading h3")
      .filter({ hasText: "Thought Topology" })
      .waitFor();
    assert.equal(
      await frame.locator(".global-graph-outer .thought-inspector").count(),
      0,
    );
    assert.equal(
      await frame.locator(".global-graph-outer .thought-callout").count(),
      1,
    );
    assert.equal(
      await frame.locator(".global-graph-outer .global-graph-close").count(),
      1,
    );
    assert.equal(
      await frame
        .locator(".global-graph-outer.active .global-graph-search")
        .isVisible(),
      false,
    );
    const overlayBox = await frame
      .locator(".global-graph-outer canvas")
      .boundingBox();
    const gardenPoint = await point("nodes", "garden:garden");
    assert.ok(overlayBox && gardenPoint);
    await page.mouse.move(
      overlayBox.x + gardenPoint.x,
      overlayBox.y + gardenPoint.y,
    );
    await page.mouse.down();
    await page.mouse.up();
    await frame
      .locator(".global-graph-outer .thought-callout.visible")
      .waitFor();
    const gardenText = await frame
      .locator(".global-graph-outer .thought-callout")
      .innerText();
    assert.match(gardenText, /Browser Garden is organized into/);
    assert.match(gardenText, /4 pages/);
    assert.doesNotMatch(gardenText, /0 semantic connections/);

    // A topology transport failure must remain a topology surface. It may show
    // an error, but it must never instantiate or reveal the legacy map.
    await page.evaluate(() => {
      window.rejectTopology = true;
      const iframe = document.getElementById("viewer");
      const url = new URL(iframe.src);
      url.pathname = "/garden/";
      url.search = `?topologyTest=1&failed=${Date.now()}`;
      iframe.src = url.toString();
    });
    await frame.waitForFunction(
      () =>
        document.querySelector(".graph.home-knowledge-graph")?.dataset
          .activeMode === "topology-unavailable",
    );
    assert.equal(
      await frame
        .locator(".graph.home-knowledge-graph > h3")
        .evaluate((node) => getComputedStyle(node).display),
      "none",
    );
    assert.equal(
      await frame
        .locator(".graph.home-knowledge-graph > .graph-outer canvas")
        .count(),
      0,
    );
    assert.match(
      await frame
        .locator(".graph > .thought-topology-meta .thought-topology-status")
        .innerText(),
      /could not be loaded/i,
    );
  },
);
