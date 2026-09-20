import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { build as bundleScript } from "esbuild";
import { topologyNavigationSlug } from "../../quartz/quartz/components/scripts/thoughtTopologyLayout.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("retained pages in every Garden receive current metadata on navigation", async (t) => {
  const executablePath = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium",
  ].find((candidate) => fs.existsSync(candidate));
  if (!executablePath) return t.skip("No installed Chromium/Edge executable");
  const bundled = await bundleScript({
    entryPoints: [
      path.join(root, "quartz/quartz/components/scripts/contentMeta.inline.ts"),
    ],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
  });
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(
    '<html lang="en"><body><h1 class="article-title">Old page</h1></body></html>',
  );
  await page.evaluate(() => {
    window.fetchData = Promise.resolve({
      "em1/topic/first": { wordCount: 201, readingTimeMs: 60300 },
      "em1/topic/index": { wordCount: 999, readingTimeMs: 299700 },
      "telecom/topic/first": { wordCount: 201, readingTimeMs: 60300 },
      "telecom/topic/nested/second": { wordCount: 399, readingTimeMs: 119700 },
      "telecom/topic/nested/index": { wordCount: 999, readingTimeMs: 299700 },
      "telecom/topic-extra/outside": {
        wordCount: 9000,
        readingTimeMs: 2700000,
      },
      "math/note": { content: Array(60).fill("word").join(" ") },
      "math/empty": { content: "" },
    });
  });
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  for (const [slug, expected] of [
    [
      "em1/topic/index",
      ["2 min read total", "201 words", "~11 min to handwrite total"],
    ],
    [
      "telecom/topic/index",
      ["3 min read total", "600 words", "~30 min to handwrite total"],
    ],
    [
      "telecom/topic/nested/index",
      ["2 min read total", "399 words", "~20 min to handwrite total"],
    ],
    ["math/note", ["1 min read", "60 words", "~3 min to handwrite"]],
    [
      "math/index",
      ["1 min read total", "60 words", "~3 min to handwrite total"],
    ],
  ]) {
    await page.evaluate((slug) => {
      document.body.dataset.slug = slug;
      document.querySelector(".content-meta")?.remove();
      document
        .querySelector("h1")
        .insertAdjacentHTML(
          "afterend",
          '<p class="content-meta"><time>Sep 19, 2026</time><span>1 min read</span></p>',
        );
      document.dispatchEvent(new CustomEvent("nav"));
    }, slug);
    await page.waitForFunction(
      (words) =>
        document.querySelector(".content-meta")?.textContent.includes(words),
      expected[1],
    );
    assert.deepEqual(
      await page.locator(".content-meta > span").allTextContents(),
      expected,
    );
    assert.equal(
      await page.locator(".content-meta time").innerText(),
      "Sep 19, 2026",
    );
  }
  await page.evaluate(() => {
    document.querySelector(".content-meta").remove();
    document.body.dataset.slug = "telecom/topic/index";
    document.dispatchEvent(new CustomEvent("nav"));
    document.dispatchEvent(new CustomEvent("nav"));
  });
  await page.waitForFunction(() =>
    document.querySelector(".content-meta")?.textContent.includes("600 words"),
  );
  assert.equal(await page.locator(".content-meta").count(), 1);
});

test(
  "folder pages render recursive totals and only their own topology in both graph sizes",
  { timeout: 120_000 },
  async (t) => {
    const executablePath = [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "/usr/bin/chromium",
    ].find((candidate) => fs.existsSync(candidate));
    if (!executablePath) return t.skip("No installed Chromium/Edge executable");

    const temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "quartz-folder-view-"),
    );
    const content = path.join(temporary, "content");
    const output = path.join(temporary, "public");
    t.after(() => {
      assert.equal(
        path.dirname(path.resolve(temporary)),
        path.resolve(os.tmpdir()),
      );
      fs.rmSync(temporary, { recursive: true, force: true });
    });
    const selected = "learning/1. Sharing One Physical Channel";
    const nested = `${selected}/More & examples`;
    const sibling = `${selected} Extra`;
    const title = "1. Sharing One Physical Channel";
    const writeNote = (relative, title, words) => {
      const target = path.join(content, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(
        target,
        `---\ntitle: ${title}\n---\n\n${Array(words).fill("word").join(" ")}\n`,
      );
    };
    writeNote("index.md", "Home", 1);
    writeNote("garden/_index.md", "Garden", 500);
    writeNote(`garden/${selected}/_index.md`, title, 700);
    writeNote(`garden/${selected}/1.1 First note.md`, "First note", 201);
    writeNote(`garden/${nested}/second.md`, "Second note", 399);
    writeNote(`garden/${sibling}/outside.md`, "Sibling note", 1000);
    writeNote("garden/root.md", "Root note", 1000);
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
        cwd: path.join(root, "quartz"),
        encoding: "utf8",
        timeout: 90_000,
        windowsHide: true,
      },
    );
    assert.equal(build.status, 0, build.stderr || build.stdout);

    const folder = (id, folderPath, parentId, depth) => ({
      id,
      path: folderPath,
      parentId,
      depth,
      title: folderPath.split("/").at(-1) || "Garden",
      nodeCount: 0,
      summary: { state: "ready", text: "Folder of notes." },
    });
    const node = (id, folderId, relative, title) => ({
      id,
      folderId,
      slug: `garden/${relative}`,
      relPath: `${relative}.md`,
      title,
      kind: "markdown",
      knowledgeType: "note",
      wordCount: 201,
      summary: { state: "ready", text: `${title} explains the topic.` },
      primaryConcepts: [],
      supportingConcepts: [],
    });
    const edge = (id, target) => ({
      id,
      source: "page:first",
      target,
      origin: "authored",
      score: 0.95,
      threshold: 0.68,
      relationType: "related",
      direction: "undirected",
      explanation: { state: "ready", text: "Related notes." },
    });
    const topology = {
      garden: {
        id: 1,
        slug: "garden",
        title: "Garden",
        summary: { state: "ready", text: "A garden of notes." },
      },
      folders: [
        folder("root", "", null, 0),
        folder("learning", "learning", "root", 1),
        folder("selected", selected, "learning", 2),
        folder("nested", nested, "selected", 3),
        folder("sibling", sibling, "learning", 2),
      ],
      nodes: [
        node(
          "page:first",
          "selected",
          `${selected}/1.1 First note`,
          "First note",
        ),
        node("page:second", "nested", `${nested}/second`, "Second note"),
        node("page:outside", "sibling", `${sibling}/outside`, "Sibling note"),
        node("page:root", "root", "root", "Root note"),
      ],
      edges: [
        edge("edge:inside", "page:second"),
        edge("edge:outside", "page:outside"),
        edge("edge:root", "page:root"),
      ],
      build: {
        state: "ready",
        threshold: 0.68,
        retrievalMode: "concept-lexical",
      },
    };
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname === "/api/topology") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({ enabled: true, mode: "thought-topology", topology }),
        );
        return;
      }
      let target = path.resolve(
        output,
        decodeURIComponent(pathname).replace(/^\/+/, ""),
      );
      if (!target.startsWith(`${path.resolve(output)}${path.sep}`)) {
        response.writeHead(404).end();
        return;
      }
      if (fs.existsSync(target) && fs.statSync(target).isDirectory())
        target = path.join(target, "index.html");
      if (!fs.existsSync(target) && fs.existsSync(`${target}.html`))
        target += ".html";
      if (!fs.existsSync(target)) {
        response.writeHead(404).end();
        return;
      }
      const extension = path.extname(target);
      response.setHeader(
        "content-type",
        {
          ".html": "text/html",
          ".js": "application/javascript",
          ".css": "text/css",
        }[extension] || "application/octet-stream",
      );
      const data = fs.readFileSync(target);
      response.end(
        extension === ".html"
          ? data
              .toString()
              .replace(
                "<head>",
                '<head><script>window.__breadboardThoughtTopologyBootstrap={mode:"thought-topology",url:"/api/topology"}</script>',
              )
          : data,
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const browser = await chromium.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      `http://127.0.0.1:${server.address().port}/garden/${topologyNavigationSlug(selected)}/?topologyTest=1`,
    );
    await page.waitForFunction(
      () => window.__breadboardThoughtTopologyDebug?.nodes?.["page:second"],
    );
    assert.deepEqual(
      await page.locator(".content-meta > span").allTextContents(),
      ["3 min read total", "600 words", "~30 min to handwrite total"],
    );
    const checkScope = async () => {
      const graph = await page.evaluate(() => ({
        nodes: Object.keys(window.__breadboardThoughtTopologyDebug.nodes),
        edges: Object.keys(window.__breadboardThoughtTopologyDebug.edges),
      }));
      assert.ok(
        graph.nodes.includes("page:first") &&
          graph.nodes.includes("page:second"),
      );
      assert.ok(
        !graph.nodes.includes("page:outside") &&
          !graph.nodes.includes("page:root"),
      );
      assert.deepEqual(graph.edges, ["edge:inside"]);
    };
    await checkScope();
    assert.match(
      await page
        .locator(".graph > .thought-topology-meta .thought-topology-heading")
        .innerText(),
      /Connections inside 1. Sharing One Physical Channel/,
    );
    await page.screenshot({
      path: path.join(root, "dashboard/.tmp-quartz-folder-view.png"),
    });
    await page.locator(".global-graph-icon").click();
    await page.waitForFunction(
      () =>
        document.querySelector(".global-graph-container")?.dataset
          .activeMode === "thought-topology",
    );
    await checkScope();
    assert.deepEqual(errors, []);
  },
);
