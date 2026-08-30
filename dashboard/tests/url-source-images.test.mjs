import test from "node:test";
import assert from "node:assert/strict";
import {
  captureUrlSourceImages,
  extractEmbeddedImageReferences,
} from "../src/lib/url-source-images.ts";

const PNG = Buffer.concat([
  Buffer.from("89504e470d0a1a0a", "hex"),
  Buffer.from("durable-figure-snapshot"),
]);

test("finds Markdown and HTML embedded images without treating links as figures", () => {
  const references = extractEmbeddedImageReferences(
    [
      "![Chart](./figures/chart_(final).png)",
      '<img alt="Flow diagram" src="/images/flow.svg">',
      "![Reference plot][plot]",
      "[plot]: https://cdn.example.com/plot.webp",
      '<picture><source srcset="/plot-small.webp 1x, /plot-vast.webp 2x"><img src=/fallback.png></picture>',
      "[ordinary link](https://example.com/not-a-figure.png)",
    ].join("\n"),
  );

  assert.deepEqual(references, [
    { alt: "Chart", rawUrl: "./figures/chart_(final).png" },
    { alt: "Flow diagram", rawUrl: "/images/flow.svg" },
    { alt: "Reference plot", rawUrl: "https://cdn.example.com/plot.webp" },
    { alt: "", rawUrl: "/plot-small.webp" },
    { alt: "", rawUrl: "/plot-vast.webp" },
    { alt: "", rawUrl: "/fallback.png" },
  ]);
});

test("snapshots embedded figures and rewrites their Markdown to garden-local assets", async () => {
  const requested = [];
  const checkedHosts = [];
  const markdown = [
    "Before the chart.",
    "![Latency chart](./images/latency.png)",
    "![The same chart](./images/latency.png)",
    '<img alt="Architecture" src="https://cdn.example.net/architecture.svg">',
    "[Keep this link](https://example.com/article)",
  ].join("\n\n");

  const result = await captureUrlSourceImages({
    markdown,
    pageUrl: "https://example.com/articles/source",
    contentHash: "a".repeat(64),
    clusterSlug: "my-garden",
    assertPublicHostImpl: async (hostname) => {
      checkedHosts.push(hostname);
    },
    fetchImpl: async (url) => {
      requested.push(url.toString());
      if (url.hostname === "cdn.example.net") {
        return new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><rect width="10" height="10" /></svg>',
          { headers: { "content-type": "image/svg+xml" } },
        );
      }
      return new Response(PNG, { headers: { "content-type": "image/png" } });
    },
  });

  assert.equal(result.images.length, 2);
  assert.equal(result.referencedImageCount, 3);
  assert.equal(result.warningCount, 0);
  assert.equal(requested.length, 2, "the same remote image is downloaded once");
  assert.deepEqual(checkedHosts.sort(), ["cdn.example.net", "example.com"]);
  assert.equal(
    result.markdown.match(/\/my-garden\/assets\/url-sources\//g)?.length,
    3,
  );
  assert.match(result.markdown, /\[Keep this link\]\(https:\/\/example\.com\/article\)/);
  assert.ok(result.images.every((image) => image.relativePath.startsWith("assets/url-sources/")));
  const svg = result.images.find((image) => image.contentType === "image/svg+xml");
  assert.ok(svg);
  assert.doesNotMatch(svg.bytes.toString("utf8"), /script|onload/i);
});

test("checks every redirect host before saving an embedded image", async () => {
  const checkedHosts = [];
  const result = await captureUrlSourceImages({
    markdown: "![Plot](https://images.example.com/plot)",
    pageUrl: "https://example.com/report",
    contentHash: "b".repeat(64),
    clusterSlug: "garden",
    assertPublicHostImpl: async (hostname) => {
      checkedHosts.push(hostname);
    },
    fetchImpl: async (url) =>
      url.hostname === "images.example.com"
        ? new Response(null, {
            status: 302,
            headers: { location: "https://cdn.example.com/plot.png" },
          })
        : new Response(PNG, { headers: { "content-type": "image/png" } }),
  });

  assert.deepEqual(checkedHosts, ["images.example.com", "cdn.example.com"]);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].finalUrl, "https://cdn.example.com/plot.png");
});

test("leaves an unavailable or non-image reference intact", async () => {
  const remote = "https://example.com/not-really-an-image";
  const markdown = `![Missing figure](${remote})`;
  const result = await captureUrlSourceImages({
    markdown,
    pageUrl: "https://example.com/report",
    contentHash: "c".repeat(64),
    clusterSlug: "garden",
    assertPublicHostImpl: async () => undefined,
    fetchImpl: async () =>
      new Response("<html>not an image</html>", {
        headers: { "content-type": "text/html" },
      }),
  });

  assert.equal(result.markdown, markdown);
  assert.equal(result.images.length, 0);
  assert.equal(result.warningCount, 1);
});
