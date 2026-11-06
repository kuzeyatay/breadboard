import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

test("Garden workspace searches and reads other authorized Gardens", async (t) => {
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    const candidate = specifier.startsWith("@/")
      ? new URL(`../src/${specifier.slice(2)}${path.extname(specifier) ? "" : ".ts"}`, import.meta.url)
      : /^\.{1,2}\//.test(specifier) && !path.extname(specifier) && context.parentURL?.startsWith("file:")
        ? new URL(`${specifier}.ts`, context.parentURL) : null;
    if (candidate && fs.existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    return nextResolve(specifier, context);
  } });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-cross-search-"));
  process.env.BREADBOARD_DATA_DIR = root;
  process.env.QUARTZ_CONTENT_PATH = path.join(root, "content");
  process.env.BREADBOARD_EMBEDDINGS = "off";
  const { default: db } = await import("../src/lib/db.ts");
  const { executeGardenTool } = await import("../src/lib/hermes/garden-tools.ts");
  const { issueCapabilityToken } = await import("../src/lib/hermes/capability-token.ts");
  t.after(() => {
    hooks.deregister();
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const userId = Number(db.prepare("INSERT INTO users (username,email,password_hash) VALUES (?,?,?)")
    .run("reader", "reader@example.test", "unused").lastInsertRowid);
  const otherUserId = Number(db.prepare("INSERT INTO users (username,email,password_hash) VALUES (?,?,?)")
    .run("other", "other@example.test", "unused").lastInsertRowid);
  const ids = {};
  for (const [slug, owner] of [["alpha", userId], ["beta", userId], ["gamma", userId], ["private", otherUserId]]) {
    ids[slug] = Number(db.prepare("INSERT INTO clusters (user_id,name,slug) VALUES (?,?,?)")
      .run(owner, `Garden ${slug}`, slug).lastInsertRowid);
    const folder = path.join(root, "content", slug, "sources");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "guide.md"), `---\ntitle: "${slug} guide"\nknowledge_type: "source-document"\n---\n# Resonance\nResonance measurement for ${slug} uses the ${slug} apparatus.\n`);
    const garden = path.dirname(folder);
    for (const directory of ["assets", "notes", ".breadboard"]) fs.mkdirSync(path.join(garden, directory));
    for (const file of ["diagram.png", "apparatus (1).png", "guide-page-002.png"]) {
      fs.writeFileSync(path.join(garden, "assets", file), "image-bytes");
    }
    fs.appendFileSync(path.join(folder, "guide.md"), `\n![Resonance diagram](/${slug}/assets/diagram.png)\n`);
    fs.writeFileSync(path.join(garden, "notes", "apparatus.md"),
      `---\ntitle: "Resonance apparatus"\n---\n![Apparatus](<../assets/apparatus (1).png>)\n![Reused diagram](/${slug}/assets/diagram.png)\n`);
    fs.writeFileSync(path.join(garden, ".breadboard", "source-visuals.json"), JSON.stringify([
      { sourceId: "guide", sourceVisualId: "S1.P2.F1", pageNumber: 2, type: "diagram", caption: "Resonance diagram", croppedImagePath: `/${slug}/assets/diagram.png` },
      { sourceId: "guide", sourceVisualId: "S1.P2.PAGE", pageNumber: 2, type: "full_page_fallback", caption: "Resonance snapshot", pageImagePath: `/${slug}/assets/guide-page-002.png` },
    ]));
  }
  const scope = {
    userId, surface: "garden_chat", hermesSessionId: "cross-garden",
    gardenId: "alpha", activeGardenId: ids.alpha,
    allowedGardenIds: [ids.alpha, ids.beta, ids.gamma],
    allowedTools: ["garden_list", "garden_search", "garden_get_page", "garden_get_source_excerpt", "garden_list_files", "garden_get_source_figure"],
  };
  const rawToken = issueCapabilityToken(scope);
  const call = (tool, args, token = rawToken) => executeGardenTool({ rawToken: token, tool, args });

  await t.test("lists accessible Gardens and keeps local searches in the active Garden", async () => {
    const listed = await call("garden_list", {});
    assert.deepEqual(listed.data.gardens.map((garden) => garden.slug), ["alpha", "beta", "gamma"]);
    for (const args of [{ query: "resonance" }, { query: "resonance", scope: "active" }]) {
      const result = await call("garden_search", args);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.deepEqual([...new Set(result.data.chunks.map((chunk) => chunk.gardenId))], ["alpha"]);
    }
  });

  await t.test("searches another Garden by slug or id and reads the cited source", async () => {
    for (const gardenId of ["beta", ids.beta]) {
      const result = await call("garden_search", { gardenId, query: "resonance" });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.data.chunks[0].gardenId, "beta");
      const chunk = result.data.chunks.find((chunk) => chunk.relPath === "sources/guide.md");
      assert.ok(chunk, "Source documents remain discoverable alongside matching notes");
      for (const tool of ["garden_get_page", "garden_get_source_excerpt"]) {
        const read = await call(tool, { gardenId: chunk.gardenId, slug: chunk.relPath });
        assert.equal(read.ok, true, JSON.stringify(read));
        assert.match(read.data.content, /beta apparatus/);
      }
    }
  });

  await t.test("all-Garden search retains matching paths and correct navigation in every Garden", async () => {
    const privateToken = issueCapabilityToken({ ...scope, userId: otherUserId,
      gardenId: "private", activeGardenId: ids.private, allowedGardenIds: [ids.private] });
    const privateSearch = await call("garden_search", { query: "resonance" }, privateToken);
    assert.equal(privateSearch.ok, true);
    assert.equal(privateSearch.data.chunks[0].gardenId, "private");
    // Another user's matching page is already indexed and must stay excluded.
    const result = await call("garden_search", { scope: "all", query: "resonance" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual([...new Set(result.data.chunks.map((chunk) => chunk.gardenId))].sort(), ["alpha", "beta", "gamma"]);
    for (const gardenId of ["alpha", "beta", "gamma"]) {
      assert.ok(result.data.chunks.some((chunk) => chunk.gardenId === gardenId && chunk.relPath === "sources/guide.md"));
      assert.ok(result.data.chunks.some((chunk) => chunk.gardenId === gardenId && chunk.relPath.startsWith("notes/")));
    }
    assert.deepEqual(result.data.uiResources[0].data.gardens.map((garden) => garden.slug).sort(), ["alpha", "beta", "gamma"]);
    assert.doesNotMatch(JSON.stringify(result.data), /private apparatus/);
    // The shared index now contains all three Gardens; a later local search
    // must still query only the active Garden.
    const local = await call("garden_search", { query: "resonance" });
    assert.ok(local.data.chunks.every((chunk) => chunk.gardenId === "alpha"));
  });

  await t.test("outside-scope Gardens and conflicting search arguments are rejected", async () => {
    for (const gardenId of ["private", ids.private]) {
      for (const tool of ["garden_search", "garden_get_page", "garden_get_source_excerpt", "garden_list_files", "garden_get_source_figure"]) {
        const result = await call(tool, { gardenId, query: "resonance", slug: "sources/guide.md" });
        assert.equal(result.ok, false);
        assert.match(result.error, /outside.*authorized/);
      }
    }
    for (const args of [{ scope: "all", gardenId: "private" }, { scope: "unknown" }]) {
      assert.equal((await call("garden_search", { ...args, query: "resonance" })).ok, false);
      assert.equal((await call("garden_get_source_figure", { ...args, query: "resonance" })).ok, false);
    }
    assert.equal((await call("garden_get_source_figure", { scope: "all", slug: "guide" })).ok, false);
  });

  await t.test("image search uses the active Garden or a named authorized Garden", async () => {
    const local = await call("garden_get_source_figure", { query: "resonance diagram" });
    assert.equal(local.ok, true, JSON.stringify(local));
    assert.deepEqual(local.data.figures.map((figure) => figure.gardenId), ["alpha"]);
    for (const gardenId of ["beta", ids.beta]) {
      const result = await call("garden_get_source_figure", { gardenId, query: "resonance diagram" });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.data.figures.length, 1);
      const figure = result.data.figures[0];
      assert.equal(figure.gardenId, "beta");
      assert.equal(figure.relPath, "sources/guide.md");
      assert.equal(figure.markdown, "![Resonance diagram](</beta/assets/diagram.png>)");
      const page = await call("garden_get_source_figure", { gardenId: figure.gardenId, slug: figure.relPath });
      assert.equal(page.ok, true);
      assert.equal(page.data.gardenId, "beta");
      assert.equal(page.data.figures[0].sourceVisualId, figure.sourceVisualId);
    }
  });

  await t.test("image search across Gardens keeps provenance, filters PDF pages, and paginates globally", async () => {
    const args = { scope: "all", query: "resonance", limit: 2 };
    const figures = [];
    let offset = 0;
    do {
      const result = await call("garden_get_source_figure", { ...args, offset });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.data.total, 6, "Catalog images deduplicate reused Markdown embeds within each Garden");
      assert.equal(result.data.figures.length, 2);
      figures.push(...result.data.figures);
      offset = result.data.nextOffset;
    } while (offset !== null);
    assert.equal(new Set(figures.map((figure) => figure.imagePath)).size, 6);
    assert.deepEqual([...new Set(figures.map((figure) => figure.gardenId))], ["alpha", "beta", "gamma"]);
    for (const figure of figures) {
      assert.equal(figure.gardenName, `Garden ${figure.gardenId}`);
      assert.equal(figure.availability, "available");
      assert.ok(figure.markdown.includes(`/${figure.gardenId}/assets/`));
      assert.ok(["sources/guide.md", "notes/apparatus.md"].includes(figure.relPath));
    }
    const page = await call("garden_get_source_figure", { scope: "all", pageStart: 2, pageEnd: 2 });
    assert.equal(page.data.total, 3);
    assert.ok(page.data.figures.every((figure) => figure.sourceVisualId === "S1.P2.F1"));
    assert.equal((await call("garden_get_source_figure", { scope: "all", query: "snapshot" })).data.total, 3);
    assert.equal((await call("garden_get_source_figure", { scope: "all", query: "snapshot", includePageSnapshots: false })).data.total, 0);
    assert.equal((await call("garden_get_source_figure", { scope: "all", query: "snapshot", includePageSnapshots: true })).data.total, 3);
  });

  await t.test('image inspection retains the authorized Garden and exact source-page scope', async () => {
    const { default: sharp } = await import('sharp');
    await sharp({ create: { width: 16, height: 8, channels: 3, background: 'blue' } })
      .png().toFile(path.join(root, 'content/beta/assets/diagram.png'));
    const selected = { gardenId: 'beta', slug: 'sources/guide.md', imagePath: '/beta/assets/diagram.png' };
    const result = await call('garden_get_source_figure', selected);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.gardenId, 'beta');
    assert.equal(result.data.figures[0].imagePath, selected.imagePath);
    assert.match(result.data.screenshot.dataUrl, /^data:image\/jpeg;base64,/);
    for (const args of [
      { ...selected, gardenId: 'private', imagePath: '/private/assets/diagram.png' },
      { ...selected, gardenId: 'alpha' },
      { ...selected, slug: 'sources/missing.md' },
      { imagePath: selected.imagePath },
      { scope: 'all', imagePath: selected.imagePath },
    ]) assert.equal((await call('garden_get_source_figure', args)).ok, false);
  });

  await t.test("all never widens an empty, legacy, or public Quartz capability", async () => {
    const empty = issueCapabilityToken({ ...scope, allowedGardenIds: [] });
    assert.equal((await call("garden_search", { scope: "all", query: "resonance" }, empty)).ok, false);
    assert.deepEqual((await call("garden_list", {}, empty)).data.gardens, []);
    assert.equal((await call("garden_get_source_figure", { scope: "all" }, empty)).ok, false);
    for (const surface of ["garden_chat", "quartz_ai"]) {
      const single = issueCapabilityToken({ ...scope, surface, allowedGardenIds: undefined });
      const result = await call("garden_search", { scope: "all", query: "resonance" }, single);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.deepEqual([...new Set(result.data.chunks.map((chunk) => chunk.gardenId))], ["alpha"]);
      assert.deepEqual((await call("garden_list", {}, single)).data.gardens.map((garden) => garden.slug), ["alpha"]);
      assert.equal((await call("garden_get_page", { gardenId: "beta", slug: "sources/guide.md" }, single)).ok, false);
      const images = await call("garden_get_source_figure", { scope: "all" }, single);
      assert.equal(images.ok, true);
      assert.deepEqual([...new Set(images.data.figures.map((figure) => figure.gardenId))], ["alpha"]);
    }
  });
});
