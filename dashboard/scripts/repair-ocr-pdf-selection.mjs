// Rebuild selection geometry from the retained scan and existing OCR notes.
// Writes a NEW PDF; never overwrites a PDF that might contain annotations.
// Usage: node --experimental-strip-types scripts/repair-ocr-pdf-selection.mjs
//   --source original.pdf --transcript source-note.md --output repaired.pdf
//   --base-url http://127.0.0.1:PORT/v1 --model provider/model
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createChatmockClient } from "../src/lib/chatmock-client.ts";
import { withCouncil } from "../src/lib/council.ts";
import { locateOcrText } from "../src/lib/ocr-positioning.ts";
import { embedOcrTextLayer } from "../src/lib/pdf-text-layer.ts";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
for (const key of ["--source", "--transcript", "--output", "--model"]) {
  if (!args.get(key)) throw new Error(`Missing ${key}. See usage at the top of this script.`);
}
const source = path.resolve(args.get("--source"));
const output = path.resolve(args.get("--output"));
if (source === output || fs.existsSync(output)) throw new Error("Choose a new output path; existing PDFs are never overwritten.");
const bytes = fs.readFileSync(source);
const markdown = fs.readFileSync(args.get("--transcript"), "utf8");
const headings = [...markdown.matchAll(/^## Page (\d+)\s*$/gm)];
const pages = headings.map((match, index) => ({
  pageNumber: Number(match[1]),
  text: markdown.slice(match.index + match[0].length, headings[index + 1]?.index ?? markdown.length).trim(),
}));
if (!pages.length || new Set(pages.map(page => page.pageNumber)).size !== pages.length) {
  throw new Error("Expected one '## Page N' section per source page in the OCR notes.");
}
const model = args.get("--model");
const identity = createHash("sha256").update(bytes).update(markdown).update(model).update("word-boxes-v1").digest("hex");
const checkpointPath = `${output}.positioning.json`;
const checkpoint = fs.existsSync(checkpointPath)
  ? JSON.parse(fs.readFileSync(checkpointPath, "utf8")) : {identity, pages: {}};
if (checkpoint.identity !== identity) throw new Error("Checkpoint belongs to different source bytes, notes, or model.");
fs.mkdirSync(path.dirname(output), {recursive: true});
const baseUrl = args.get("--base-url") || process.env.OPENAI_BASE_URL;
if (!baseUrl) throw new Error("Pass --base-url for the configured OCR provider.");
if (!process.env.OPENAI_API_KEY && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname)) {
  process.env.OPENAI_API_KEY = "local";
}
const client = createChatmockClient(baseUrl, {maxRetries: 0, timeout: 180_000});
const runFile = promisify(execFile);
const renderWorker = fileURLToPath(new URL("./runtime-v2-pdf-render-batch-worker.mjs", import.meta.url));
for (const page of pages) {
  if (!checkpoint.pages[page.pageNumber]) {
    const rendered = await runFile(process.execPath, [renderWorker, source,
      String(page.pageNumber), String(page.pageNumber), "1400"], {maxBuffer: 32 * 1024 * 1024, windowsHide: true});
    const [image] = JSON.parse(rendered.stdout);
    checkpoint.pages[page.pageNumber] = await locateOcrText({text: page.text, dataUrl: image.dataUrl,
      locate: async ({prompt, dataUrl, signal}) => {
        const response = await client.chat.completions.create(withCouncil({model,
          messages: [{role: "user", content: [
            {type: "image_url", image_url: {url: dataUrl}}, {type: "text", text: prompt},
          ]}],
        }, {taskType: "ocr"}), {signal});
        return response.choices[0]?.message?.content ?? "";
      }});
    // Resume after a provider outage without charging for completed pages again.
    const temporary = `${checkpointPath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(checkpoint));
    fs.renameSync(temporary, checkpointPath);
  }
  console.log(`Located page ${page.pageNumber} (${checkpoint.pages[page.pageNumber].length} text boxes)`);
}
const result = await embedOcrTextLayer({pdf: bytes, requirePositions: true,
  pages: pages.map(page => ({...page, lines: checkpoint.pages[page.pageNumber]}))});
if (result.skippedPages.length || result.positionedPages !== pages.length) {
  throw new Error(`Incomplete text layer; skipped pages: ${result.skippedPages.join(", ")}`);
}
fs.writeFileSync(output, result.bytes, {flag: "wx"});
console.log(`Wrote ${result.positionedPages} positioned pages to ${output}`);
