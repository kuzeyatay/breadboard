import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildReaderRequestUrl,
  contentHashForMarkdown,
  convertUrlToMarkdown,
  normalizeSourceUrl,
} from "../src/lib/url-to-markdown.ts";
import { findExistingUrlSource } from "../src/lib/url-source-store.ts";

describe("URL to Markdown provider", () => {
  test("validates and normalizes HTTP URLs", () => {
    assert.equal(normalizeSourceUrl("example.com/a#section"), "https://example.com/a");
    assert.equal(normalizeSourceUrl("http://example.com/a"), "http://example.com/a");
    assert.throws(() => normalizeSourceUrl("ftp://example.com/file"), /Only HTTP and HTTPS/);
    assert.throws(() => normalizeSourceUrl("not a url"), /valid link URL/);
  });

  test("constructs Jina Reader request URLs without duplicated slashes", () => {
    assert.equal(
      buildReaderRequestUrl("http://localhost:8080/", "https://example.com/article"),
      "http://localhost:8080/https://example.com/article",
    );
    assert.equal(
      buildReaderRequestUrl("https://r.jina.ai", "https://example.com/article"),
      "https://r.jina.ai/https://example.com/article",
    );
  });

  test("generates deterministic content hashes from URL and Markdown", () => {
    const first = contentHashForMarkdown("https://example.com/a", "# Title\n\nBody");
    const second = contentHashForMarkdown("https://example.com/a#ignored", "# Title\n\nBody\n");
    const third = contentHashForMarkdown("https://example.com/a", "# Title\n\nChanged");
    assert.equal(first, second);
    assert.notEqual(first, third);
  });

  test("converts Markdown with mocked local Reader response", async () => {
    const seen = {};
    const result = await convertUrlToMarkdown({
      url: "https://example.com/article",
      env: {
        READER_BASE_URL: "http://localhost:8080",
        READER_PROVIDER: "jina-reader-local",
      },
      now: () => new Date("2026-07-03T12:00:00.000Z"),
      fetchImpl: async (url, init) => {
        seen.url = String(url);
        seen.respondWith = init?.headers?.["X-Respond-With"];
        return new Response(
          "---\ntitle: \"Example Article\"\nurl: \"https://example.com/canonical\"\n---\n\n# Example Article\n\nFaithful body.",
          { headers: { "content-type": "text/markdown" } },
        );
      },
    });
    assert.equal(seen.url, "http://localhost:8080/https://example.com/article");
    assert.equal(seen.respondWith, "frontmatter");
    assert.equal(result.provider, "jina-reader-local");
    assert.equal(result.title, "Example Article");
    assert.equal(result.canonicalUrl, "https://example.com/canonical");
    assert.equal(result.markdown, "# Example Article\n\nFaithful body.");
    assert.equal(result.fetchedAt, "2026-07-03T12:00:00.000Z");
    assert.equal(result.contentHash.length, 64);
  });

  test("reports a clear error when local Reader is unreachable", async () => {
    await assert.rejects(
      () =>
        convertUrlToMarkdown({
          url: "https://example.com/article",
          env: { READER_BASE_URL: "http://localhost:8080" },
          fetchImpl: async () => {
            throw new TypeError("ECONNREFUSED");
          },
        }),
      /Could not reach local Jina Reader at READER_BASE_URL/,
    );
  });

  test("requires READER_BASE_URL for local Reader", async () => {
    await assert.rejects(
      () =>
        convertUrlToMarkdown({
          url: "https://example.com/article",
          env: {},
          fetchImpl: async () => new Response("# Should not be called"),
        }),
      /READER_BASE_URL/,
    );
  });

  test("uses remote fallback only when enabled", async () => {
    const calls = [];
    const result = await convertUrlToMarkdown({
      url: "https://example.com/article",
      env: {
        READER_BASE_URL: "http://localhost:8080",
        READER_ALLOW_REMOTE_FALLBACK: "true",
        READER_REMOTE_BASE_URL: "https://r.jina.ai",
      },
      fetchImpl: async (url) => {
        calls.push(String(url));
        if (calls.length === 1) throw new TypeError("ECONNREFUSED");
        return new Response("# Remote\n\nBody");
      },
    });
    assert.deepEqual(calls, [
      "http://localhost:8080/https://example.com/article",
      "https://r.jina.ai/https://example.com/article",
    ]);
    assert.equal(result.provider, "jina-reader-remote");
  });
});

describe("URL source duplicate lookup", () => {
  test("finds an existing URL source by content hash", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-url-source-"));
    const garden = path.join(root, "garden");
    const sources = path.join(garden, "sources");
    fs.mkdirSync(sources, { recursive: true });
    fs.writeFileSync(
      path.join(sources, "example.md"),
      [
        "---",
        'title: "Example"',
        'knowledge_type: "source-document"',
        'source_type: "url"',
        'original_url: "https://example.com/article"',
        'content_hash: "abc123"',
        "---",
        "",
        "# Example",
      ].join("\n"),
      "utf8",
    );

    assert.deepEqual(
      findExistingUrlSource({
        contentPath: root,
        clusterSlug: "garden",
        contentHash: "abc123",
        originalUrl: "https://example.com/article",
      }),
      {
        sourceSlug: "example",
        sourceRelPath: "sources/example.md",
        title: "Example",
        contentHash: "abc123",
        originalUrl: "https://example.com/article",
      },
    );
  });
});
