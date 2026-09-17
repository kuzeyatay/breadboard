import assert from "node:assert/strict";
import test from "node:test";
import { artifactRenderer } from "../src/lib/hermes/artifact-renderers.ts";

const renderer = artifactRenderer("html");

test("static HTML documents and inert JSON remain publishable", async () => {
  for (const content of [
    '<main><h1>Report</h1><style>h1{color:blue}</style><p>Results</p></main>',
    '<main>Report</main><script type="application/ld+json">{"name":"Report"}</script>',
    '<main>Report</main><script type=application/json>{"value":1}</script>',
  ]) assert.deepEqual(await renderer.validate(content), { ok: true });
});

test("script-driven visualizations cannot silently publish through the static HTML renderer", async () => {
  for (const script of [
    '<script>document.querySelector("svg").appendChild(document.createElement("g"))</script>',
    '<script type="module">draw()</script>',
    '<script type="text/javascript">draw()</script>',
    '<SCRIPT SRC="main.js"></SCRIPT>',
  ]) {
    const result = await renderer.validate(`<main><svg></svg></main>${script}`);
    assert.equal(result.ok, false);
    assert.match(result.error, /static.*block JavaScript/);
    assert.match(result.error, /interactive_visualizer_create/);
  }
});

test("HTML controls with blocked event handlers are rejected before becoming ready artifacts", async () => {
  const result = await renderer.validate('<main><button onclick="draw()">Play</button></main>');
  assert.equal(result.ok, false);
  assert.match(result.error, /plain HTML artifact as a visualizer fallback/);
});
