import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverGardenSources, publicSourceUrl, sourcesFromSearchHtml, youtubeSourceUrl,
} from "../src/lib/hermes/garden-source-discovery.ts";
import { downloadGardenMedia, importGardenSource } from "../src/lib/hermes/garden-source-import.ts";
import { issueCapabilityToken } from "../src/lib/hermes/capability-token.ts";
import { executeGardenTool } from "../src/lib/hermes/garden-tools.ts";
import { allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";
import { decideCapabilityMode } from "../src/lib/hermes/capability-policy.ts";
import { gardenSourceImportNotice } from "../src/lib/hermes/garden-source-import-client.ts";
import { createHermesEventNormalizationState, normalizeHermesEvent } from "../src/lib/agent-runtime/hermes-events.ts";

test("mixed discovery fans out only to requested kinds, keeps partial successes and does not import", async () => {
  const calls = [];
  const result = await discoverGardenSources({ query: "  circuits  ", kinds: ["pdf", "video", "pdf"], limit: 2 }, async (query, kind, limit) => {
    calls.push({ query, kind, limit });
    if (kind === "video") throw new Error("provider unavailable");
    return Array.from({ length: 5 }, (_, i) => ({ kind, title: `Paper ${i}`, url: `https://example.com/${i}.pdf`, importUrl: `https://example.com/${i}.pdf`, description: "circuits" }));
  });
  assert.deepEqual(calls, [{ query: "circuits", kind: "pdf", limit: 2 }, { query: "circuits", kind: "video", limit: 2 }]);
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.reports, [{ kind: "pdf", status: "ok" }, { kind: "video", status: "error", error: "provider unavailable" }]);
});

test("default discovery includes all four kinds and rejects invalid bounds before searching", async () => {
  const kinds = [];
  await discoverGardenSources({ query: "circuits" }, async (_query, kind) => { kinds.push(kind); return []; });
  assert.deepEqual(kinds.sort(), ["audio", "link", "pdf", "video"]);
  for (const args of [{ query: "" }, { query: "q", kinds: [] }, { query: "q", kinds: ["shell"] }, { query: "q", limit: 0 }, { query: "q", limit: 100 }]) {
    await assert.rejects(discoverGardenSources(args, () => { throw new Error("must not search"); }), (error) => !/must not search/.test(error.message));
  }
});

function anchor(url, title, snippet = "") {
  return `<a class="result__a" href="${url}">${title}</a><a class="result__snippet">${snippet}</a>`;
}

test("discovery unwraps search redirects and canonicalizes individual YouTube results", () => {
  const html = anchor("//duckduckgo.com/l/?uddg=https%3A%2F%2Fyoutu.be%2FAfQxyVuLeCs", "Circuits &amp; Electronics", "An MIT lecture")
    + anchor("https://www.youtube.com/watch?v=AfQxyVuLeCs&t=20", "Circuits duplicate")
    + anchor("https://www.youtube.com/playlist?list=PL123", "Circuits playlist")
    + anchor("javascript:alert(1)", "Circuits")
    + anchor("https://www.youtube.com/watch?v=KI9aM-My63c", "Unrelated dance video");
  const result = sourcesFromSearchHtml(html, "video", 5, "circuits");
  assert.equal(result.length, 1);
  assert.equal(result[0].importUrl, "https://www.youtube.com/watch?v=AfQxyVuLeCs");
  assert.equal(youtubeSourceUrl("https://youtube.com.evil.test/watch?v=AfQxyVuLeCs"), null);
});

test("audio pages are discovered without pretending a player page is a downloadable file", () => {
  const result = sourcesFromSearchHtml(anchor("https://example.com/podcast", "Circuits podcast") + anchor("https://example.com/lecture.mp3?download=1", "Circuits audio"), "audio", 5);
  assert.equal(result[0].importUrl, null);
  assert.equal(result[1].importUrl, "https://example.com/lecture.mp3?download=1");
});

const context = { userId: 1, clusterId: 2, clusterSlug: "circuits", contentPath: "unused" };
test("all four imports route through their existing ingestion services with the authorized Garden", async () => {
  const calls = [];
  const deps = {
    assertHost: async (host) => calls.push(["host", host]),
    link: async (...args) => { calls.push(["link", ...args]); return { status: "completed" }; },
    pdf: async (...args) => { calls.push(["pdf", ...args]); return { status: "queued", jobId: "pdf-job" }; },
    media: async (...args) => { calls.push(["media", ...args]); return { processing: true, job: { id: "media-job" } }; },
  };
  for (const kind of ["link", "pdf", "audio", "video"]) {
    const result = await importGardenSource(context, { kind, url: "https://example.com/source", title: "Circuit source", gardenId: "other" }, deps);
    assert.ok(result);
  }
  assert.deepEqual(calls.filter((call) => call[0] !== "host").map((call) => [call[0], call[1], call[3]]), [
    ["link", context, "Circuit source"], ["pdf", context, "Circuit source"],
    ["media", context, "audio"], ["media", context, "video"],
  ]);
});

test("invalid or private source targets fail before any ingestion", async () => {
  for (const value of ["file:///C:/secret", "http://user:password@example.com/a", "https://example.com:8443/file", "not a URL"]) {
    assert.throws(() => publicSourceUrl(value));
  }
  await assert.rejects(importGardenSource(context, { kind: "audio", url: "http://127.0.0.1/recording.mp3" }), /public internet/);
});

test("direct media downloader refuses redirects to private hosts and oversized bodies", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret.mp3" } }); };
    await assert.rejects(downloadGardenMedia("https://8.8.8.8/audio.mp3", "audio", 32), /public internet/);
    assert.equal(calls, 1);
    globalThis.fetch = async () => new Response(new Uint8Array(64), { headers: { "content-type": "audio/mpeg" } });
    await assert.rejects(downloadGardenMedia("https://8.8.8.8/audio.mp3", "audio", 32), /upload limit/);
    globalThis.fetch = async () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } });
    await assert.rejects(downloadGardenMedia("https://8.8.8.8/audio.mp3", "audio", 32), /not a downloadable/);
    globalThis.fetch = async () => new Response("ID3audio", { headers: { "content-type": "audio/mpeg" } });
    const downloaded = await downloadGardenMedia("https://8.8.8.8/audio", "audio", 32);
    assert.equal(downloaded.extension, "mp3");
    assert.equal(downloaded.buffer.toString(), "ID3audio");
  } finally { globalThis.fetch = originalFetch; }
});

test("source tools are ordinary Garden knowledge capabilities and absent from public Quartz", async () => {
  for (const tool of ["garden_discover_sources", "garden_import_source"]) {
    assert.ok(allowedToolsForSurface("garden_chat").includes(tool));
    assert.ok(!allowedToolsForSurface("quartz_ai").includes(tool));
    const rawToken = issueCapabilityToken({ userId: 1, surface: "garden_chat", hermesSessionId: "source-test", gardenId: "circuits", allowedTools: [tool] });
    const result = await executeGardenTool({ rawToken, tool, args: { gardenId: "other", query: "circuits", kind: "pdf", url: "https://example.com/a.pdf" } });
    assert.equal(result.ok, false);
    assert.match(result.error, /not permitted/);
  }
  const decision = decideCapabilityMode({ surface: "garden_chat", userId: 1, requestedOutcome: "Find and upload PDFs about circuits" });
  assert.equal(decision.mode, "knowledge");
  assert.ok(decision.allowedTools.includes("garden_discover_sources"));
  assert.ok(decision.allowedTools.includes("garden_import_source"));
});

test("queued imports survive real Hermes tool-event normalization for workspace progress tracking", () => {
  const sourceImport = { gardenId: "circuits", kind: "pdf", title: "Circuit source", jobId: "job-123", processing: true };
  const [event] = normalizeHermesEvent({
    type: "tool.complete", session_id: "source-session",
    payload: { name: "garden_import_source", tool_id: "source-call", result: JSON.stringify({ status: "queued", sourceImport }) },
  }, "source-session", "public-session", createHermesEventNormalizationState());
  assert.equal(event.type, "tool.completed");
  assert.deepEqual(gardenSourceImportNotice(event.payload.details), sourceImport);
  assert.equal(gardenSourceImportNotice({ ok: false, sourceImport }), null);
  assert.equal(gardenSourceImportNotice({ result: "not JSON" }), null);
});
