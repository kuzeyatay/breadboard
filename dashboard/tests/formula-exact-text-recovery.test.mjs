import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCanonicalSourceAnchors } from "../src/lib/final-garden-state.ts";

const roots = [];
test.after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

const BS = String.fromCharCode(92);

function makeGarden(sourceBody, ledger) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-exacttext-"));
  roots.push(root);
  const dir = path.join(root, "g");
  fs.mkdirSync(path.join(dir, ".breadboard"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
  fs.writeFileSync(path.join(dir, "sources", "src.md"), sourceBody);
  fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), JSON.stringify(ledger, null, 2));
  return dir;
}

test("recovers exact formula text from $$ display math with an equation number", () => {
  // A converted PDF renders numbered equations as $$ … \qquad \text{(N)} … $$,
  // not fenced code blocks — the exact test2 (2303.10780v2) format.
  const body = [
    "# Page 4",
    "",
    "The membrane dynamics are given by",
    "",
    "$$",
    `${BS}dot{V}(t) = -${BS}lambda V(t) + Fc(t) + ${BS}Omega s(t)`,
    `${BS}qquad ${BS}text{(3)}`,
    "$$",
    "",
    "where V(t) represents the voltage of each neuron.",
    "",
  ].join("\n");
  const ledger = [{
    sourceVisualId: "S1.P4.E1",
    sourceId: "src",
    pageNumber: 4,
    type: "equation",
    caption: "Voltage dynamics equation for each neuron",
  }];
  const anchors = buildCanonicalSourceAnchors(makeGarden(body, ledger));
  const anchor = anchors["S1.P4.E1"];
  assert.ok(anchor, "anchor should exist");
  assert.match(anchor.exactText ?? "", /dot\{V\}\(t\)/);
  assert.equal(/text\{\(3\)\}|qquad/.test(anchor.exactText ?? ""), false, "equation number marker must be stripped");
});

test("still recovers exact text from fenced code blocks (backward compatible)", () => {
  const body = [
    "# Page 6",
    "",
    "```text",
    "Latency = tdecision - t0   (1)",
    "```",
    "",
  ].join("\n");
  const ledger = [{ sourceVisualId: "S1.P6.E1", sourceId: "src", pageNumber: 6, type: "equation", caption: "Latency as decision time minus onset" }];
  const anchors = buildCanonicalSourceAnchors(makeGarden(body, ledger));
  assert.match(anchors["S1.P6.E1"].exactText ?? "", /Latency = tdecision - t0/);
});

test("disambiguates multiple equations on a page by caption-to-context overlap", () => {
  const body = [
    "# Page 4",
    "",
    "$$",
    `E(y) = ${BS}frac{${BS}lambda}{2}y^T y + b^T y`,
    `${BS}qquad ${BS}text{(4)}`,
    "$$",
    "",
    "is the quadratic optimization objective minimized over the constrained output.",
    "",
    "$$",
    `I = C_m ${BS}frac{dV_m}{dt} + g_K(V_m - V_K)`,
    `${BS}qquad ${BS}text{(2)}`,
    "$$",
    "",
    "describes the Hodgkin-Huxley membrane current.",
    "",
  ].join("\n");
  const ledger = [
    { sourceVisualId: "S1.P4.E1", sourceId: "src", pageNumber: 4, type: "equation", caption: "Quadratic optimization objective over constrained output variables" },
    { sourceVisualId: "S1.P4.E2", sourceId: "src", pageNumber: 4, type: "equation", caption: "Hodgkin-Huxley membrane current equation" },
  ];
  const anchors = buildCanonicalSourceAnchors(makeGarden(body, ledger));
  assert.match(anchors["S1.P4.E1"].exactText ?? "", /E\(y\)/, "optimization caption should match the E(y) objective");
  assert.match(anchors["S1.P4.E2"].exactText ?? "", /C_m/, "Hodgkin-Huxley caption should match the membrane current equation");
});
