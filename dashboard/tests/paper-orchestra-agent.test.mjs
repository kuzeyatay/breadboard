import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  paperOrchestraUserMessage,
  parsePaperOrchestraTask,
  taskFromPaperOrchestraCommand,
} from "../src/lib/paper-orchestra/identity.ts";

test("the command token is stripped and other tokens stay", () => {
  assert.equal(taskFromPaperOrchestraCommand("/agents:paper-orchestra sparse attention for video"), "sparse attention for video");
  assert.equal(taskFromPaperOrchestraCommand("/goal /agents:paper-orchestra x"), "/goal x");
  assert.equal(taskFromPaperOrchestraCommand("/agents:paper-orchestra"), "");
  assert.equal(taskFromPaperOrchestraCommand("/agents:codex x"), null);
  assert.equal(paperOrchestraUserMessage(" idea "), "/agents:paper-orchestra idea");
});

test("flags pick the template and plotting; prose stays prose", () => {
  assert.deepEqual(parsePaperOrchestraTask("a method --cvpr --plots that beats x"), {
    brief: "a method that beats x", template: "cvpr2025", plotting: true,
  });
  assert.deepEqual(parsePaperOrchestraTask("compare to--cvpr baselines"), {
    brief: "compare to--cvpr baselines", template: "iclr2025", plotting: false,
  });
});

test("materials land in upstream's layout, images become listed figures", async () => {
  const { writeMaterials } = await import("../src/lib/paper-orchestra/run-manager.ts");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "po-test-"));
  try {
    writeMaterials(directory, { brief: "We got 91.2% on X.", template: "iclr2025", plotting: false }, "context\n\nWe got 91.2% on X.",
      ["data:image/png;base64,iVBORw0KGgo=", "data:text/plain;base64,AAAA"]);
    assert.match(fs.readFileSync(path.join(directory, "idea.md"), "utf8"), /context/);
    const log = fs.readFileSync(path.join(directory, "experimental_log.md"), "utf8");
    assert.match(log, /91\.2%/);
    assert.match(log, /without inventing results/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "figures", "info.json"), "utf8")).map((f) => f.name), ["figure_1.png"]);
    assert.ok(fs.existsSync(path.join(directory, "figures", "figure_1.png")));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("the bridge replaces every upstream model and LaTeX seam before loading the agents", () => {
  const bridge = fs.readFileSync(new URL("../../scripts/paper-orchestra-bridge.py", import.meta.url), "utf8");
  const patchAt = bridge.indexOf("pdf_utils.compile_latex = compile_latex");
  const agentsAt = bridge.indexOf("from methods.agents");
  assert.ok(patchAt > 0 && agentsAt > patchAt);
  for (const seam of ["call_gemini_with_contents", "call_gemini_with_text_prompt", "call_gemini_with_images",
    "generate_image_with_gemini", "call_openai_models_with_content", "call_openai_models_with_text_prompt"]) {
    assert.ok(bridge.includes(`_utils.${seam} = ${seam}`), seam);
  }
  // Related work comes from catalog search, not the model's memory.
  assert.match(bridge, /HybridLiteratureAgent\._discover_candidates = _discover_candidates/);
  assert.match(bridge, /HybridLiteratureAgent\._enrich_and_register_paper = _enrich_and_register_paper/);
});

test("the bridge's search requests and the run manager's replies agree on the protocol", () => {
  const bridge = fs.readFileSync(new URL("../../scripts/paper-orchestra-bridge.py", import.meta.url), "utf8");
  const manager = fs.readFileSync(new URL("../src/lib/paper-orchestra/run-manager.ts", import.meta.url), "utf8");
  assert.match(bridge, /emit\("search", id=request_id, queries=queries, yearTo=year_to, limit=limit\)/);
  assert.match(bridge, /\.get\("documents"\)/);
  assert.match(manager, /event\.type === "search"/);
  assert.match(manager, /JSON\.stringify\(\{ id: event\.id, documents \}\)/);
  assert.doesNotMatch(manager, /child\.stdin\?\.end\(/);
});
