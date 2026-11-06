import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderMarkdownToPdf } from "../src/lib/markdown-render/pdf.ts";

const hash = value => createHash("sha256").update(value).digest("hex");
const fence = (lang, value) => `\n\n\`\`\`${lang}\n${value}\n\`\`\`\n\n`;
const legacy = {
  id: "vis_shm_xva_001", type: "linked_time_plots", title: "Position, velocity, and acceleration",
  sourceAnchors: [{ sourceId: "lecture", page: 12, description: "Linked motion" }],
  conceptTargets: ["harmonic motion"], pedagogicalPurpose: "Show the phase relationship.",
  props: { amplitude: 1, angularFrequency: 1, phase: 0, showVelocity: true },
  controls: [{ name: "amplitude", label: "Amplitude A", type: "slider", min: 0.2, max: 2, step: 0.1 }],
  caption: "The curves describe the same motion.", regenerationPrompt: "Explain the phase relationship.", version: 1,
};

function nativeSnapshot() {
  const source = "// Validated native visualizer fixture";
  const nativeRuntime = {
    engine: "breadboard-interactive-visualizer", version: "2.0.0",
    sourceSkill: "interactive-visualizer-in-chat", skillHash: "f".repeat(64),
    html: `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>body{margin:0;padding:22px;font:16px Arial;background:#f7faf8;color:#183f31}svg{width:100%;height:240px}h2{font-size:24px}label{display:block;margin:18px 0}</style></head><body><h2>Channel capacity explorer</h2><p>Vary the load to compare occupied and available channels.</p><svg viewBox="0 0 800 240"><rect x="10" y="40" width="780" height="140" rx="12" fill="#d6e8dd"/><rect x="10" y="40" width="460" height="140" rx="12" fill="#387d60"/><text x="80" y="120" font-size="24" fill="white">Occupied channels</text><text x="530" y="120" font-size="24">Available</text></svg><label>Load <input type="range" min="0" max="100" value="60"></label><script>document.fonts.ready.then(()=>requestAnimationFrame(()=>parent.postMessage({protocol:'breadboard:interactive-visualizer:v1',channel:'standalone',type:'ready',height:420},'*')));</script></body></html>`,
  };
  const compiled = `globalThis.__BREADBOARD_GENERATED_VISUAL__ = Object.freeze(${JSON.stringify({ sdkVersion: "1.0.0", title: "Channel capacity explorer", description: "Inspect channel use.", nativeRuntime })});\n`;
  const manifest = { id: "channel-capacity", version: 1, status: "published", title: "Channel capacity explorer",
    targetPage: "learning/lesson.md", targetHeading: "Channel capacity", insertionAnchor: "pdf:capacity",
    sourceHash: hash(source), compiledHash: hash(compiled), sourceSkill: nativeRuntime.sourceSkill,
    skillHash: nativeRuntime.skillHash, runtimeEngine: nativeRuntime.engine };
  return { schemaVersion: 1, source, compiled, manifest, validation: { valid: true }, tests: { passed: true }, critic: { approved: true } };
}

test("folder PDFs keep image captions together and snapshot legacy, generated and detached visualizers", { timeout: 90_000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-figures-"));
  const oldRoot = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = root;
  t.after(() => { if (oldRoot === undefined) delete process.env.QUARTZ_CONTENT_PATH; else process.env.QUARTZ_CONTENT_PATH = oldRoot; fs.rmSync(root, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, "demo/assets"), { recursive: true });
  const svg = `<svg width="1100" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="1100" height="500" fill="#e4f0eb"/><path d="M70 400 L300 120 L540 350 L800 90 L1030 250" fill="none" stroke="#30684e" stroke-width="12"/><text x="65" y="65" font-family="Arial" font-size="32">Traffic load over time</text></svg>`;
  await sharp(Buffer.from(svg)).webp().toFile(path.join(root, "demo/assets/traffic.webp"));
  fs.mkdirSync(path.join(root, "demo/copied/assets/original/assets"), { recursive: true });
  fs.copyFileSync(path.join(root, "demo/assets/traffic.webp"), path.join(root, "demo/copied/assets/original/assets/traffic.webp"));
  const snap = nativeSnapshot();
  const artifact = path.join(root, "demo/.breadboard/visuals/channel-capacity/versions/1");
  fs.mkdirSync(artifact, { recursive: true });
  for (const key of ["manifest", "validation", "tests", "critic"]) fs.writeFileSync(path.join(artifact, `${key}.json`), JSON.stringify(snap[key]));
  fs.writeFileSync(path.join(artifact, "compiled.js"), snap.compiled);
  fs.writeFileSync(path.join(artifact, "source.tsx"), snap.source);
  const detached = { ...snap, manifest: { ...snap.manifest, detached: true } };
  const intro = "A shared channel carries independent traffic flows. Figures should remain readable and their captions should stay on the same page. ";
  const documents = [
    { title: "Channel capacity", slug: "demo/learning/lesson", content: intro.repeat(24) +
      "\n\n![Traffic](../assets/traffic.webp)\n\n*Figure 1. Traffic load measured over time.*\n\n" +
      "<!-- pdf:capacity -->" + fence("breadboard-generated-visual", "id: channel-capacity\nversion: 1") },
    { title: "Motion and copied visualization", slug: "demo/notes/motion", content: "# Motion and copied visualization\n" +
      fence("breadboard-visual", JSON.stringify(legacy)) + fence("breadboard-detached-visual", JSON.stringify(detached)) +
      "![Copied image](/demo/copied/assets/original/assets/traffic.webp)\n\n*Figure 2. A copied folder retains its image.*\n\nFinal note after all figures." },
  ];
  const bytes = await renderMarkdownToPdf(documents, { title: "Folder export quality check", clusterSlug: "demo" });
  if (process.env.PDF_EXPORT_QA_OUTPUT) { fs.mkdirSync(path.dirname(process.env.PDF_EXPORT_QA_OUTPUT), { recursive: true }); fs.writeFileSync(process.env.PDF_EXPORT_QA_OUTPUT, bytes); }
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  try {
    let images = 0, captionWithFigure = false;
    const text = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const words = content.items.filter(item => "str" in item).map(item => item.str).join(" ");
      const ops = await page.getOperatorList();
      const pageImages = ops.fnArray.filter(op => op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject).length;
      images += pageImages; text.push(words);
      if (words.includes("Figure 1.")) captionWithFigure = pageImages > 0;
      for (const item of content.items.filter(item => "str" in item && item.str.trim())) {
        assert.ok(item.transform[5] >= 20 && item.transform[5] <= page.view[3] - 35, `text remains on page ${number}: ${item.str}`);
      }
    }
    assert.equal(images, 5, "both original and copied images plus all three interactive visualizers are PDF images");
    assert.ok(captionWithFigure, "source caption stays on its figure's page");
    assert.match(text.join(" ").replace(/\s+/g, " "), /Final note after all figures/);
    assert.doesNotMatch(text.join(" "), /nativeRuntime|compiledHash|pdf:capacity|breadboard-generated-visual|\[Image:/);
  } finally { await pdf.destroy(); }

  await assert.rejects(renderMarkdownToPdf([{ ...documents[0], slug: "other/learning/lesson" }], { clusterSlug: "demo" }), /outside its garden/);
  const damaged = { ...detached, compiled: detached.compiled + "tampered" };
  await assert.rejects(renderMarkdownToPdf([{ title: "Damaged", content: fence("breadboard-detached-visual", JSON.stringify(damaged)) }]), /artifact hash does not match/);
});
