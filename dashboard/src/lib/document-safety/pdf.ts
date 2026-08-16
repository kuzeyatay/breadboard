// Hidden text inside PDFs.
//
// Ported in intent from `scan_pdf` in wppoland/hidden-text-detector (MIT), and
// re-implemented in method, because the two runtimes do not offer the same
// handle on a page.
//
// Upstream leans on PyMuPDF twice: `page.get_texttrace()` hands it every span
// pre-decoded with its size, colour, opacity, render mode and bounding box;
// and `page.get_pixmap()` lets it render the page and measure the actual
// contrast across a span's own area. That second check is the good one — it is
// technique-agnostic, and it catches black-on-black and text-covered-by-a-shape
// that no signature list will ever enumerate.
//
// Neither is available here. `pdf-parse` wraps pdf.js for text and page
// rasters, but exposes no per-span graphics state, and measuring contrast would
// mean decoding a PNG and mapping text boxes into it — a large amount of
// machinery to reimplement a check that needs the span geometry we do not have
// in the first place.
//
// So this reads the content streams directly, which is where all of that state
// is written down anyway. `zlib` is in Node, and a PDF content stream is a
// small stack language; the operators that matter are `Tr` (render mode), the
// fill-colour setters, `Tf` (size), `Tm`/`Td`/`cm` (placement) and `gs`
// (alpha). What is lost relative to upstream is stated plainly rather than
// papered over — see MISSING_CHECKS at the bottom, which the report surfaces
// so nobody reads a clean PDF verdict as stronger than it is.

import zlib from "node:zlib";

import type { SafetyFinding } from "./types.ts";
import { quote, scanUnicode } from "./unicode.ts";

/** The legibility floor in points, shared with the OOXML layer. */
const MIN_LEGIBLE_PT = 2.0;

/** Below this the text is transparent enough to be gone. Upstream's value. */
const MIN_OPACITY = 0.1;

/** Every channel above this and the text is near-white. Upstream's value. */
const NEAR_WHITE_CHANNEL = 0.9;

/**
 * A page whose text is *entirely* in render mode 3 is the OCR layer of a scan,
 * which is both legitimate and extremely common. Only isolated invisible spans
 * are suspicious. Upstream's ratio.
 */
const OCR_LAYER_RATIO = 0.8;

/** Placement slack when testing a point against the page box, as upstream. */
const PAGE_BOX_SLACK = 1;

const MAX_FINDINGS_PER_PAGE = 20;
const MAX_CONTENT_STREAMS = 400;
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;
const MAX_SNIPPET = 300;

export interface PdfScanResult {
  findings: SafetyFinding[];
  hiddenText: string;
  /** False when the file could not be parsed structurally at all. */
  scanned: boolean;
}

type Rgb = [number, number, number];

// ── PDF object plumbing ────────────────────────────────────────────────────
//
// The file is read as latin1 so one character is one byte: indices found by a
// regex map straight back into the buffer, and `Buffer.from(slice, "latin1")`
// recovers the exact bytes. Every `raw` below is such a string.

interface PdfObject {
  id: number;
  body: string;
  /** Byte range of the stream payload, when the object has one. */
  stream?: { start: number; end: number };
}

function parseObjects(raw: string): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();

  for (const match of raw.matchAll(/(\d+)\s+(\d+)\s+obj\b/g)) {
    const id = Number.parseInt(match[1], 10);
    const bodyStart = match.index + match[0].length;
    const endObj = raw.indexOf("endobj", bodyStart);
    if (endObj === -1) continue;

    const body = raw.slice(bodyStart, endObj);
    const streamKeyword = body.search(/\bstream\r?\n?/);
    let stream: PdfObject["stream"];

    if (streamKeyword !== -1) {
      const opener = body.slice(streamKeyword).match(/^stream\r\n|^stream\n|^stream\r/);
      if (opener) {
        const start = bodyStart + streamKeyword + opener[0].length;
        const endStream = raw.indexOf("endstream", start);
        if (endStream !== -1) stream = { start, end: endStream };
      }
    }

    // A later definition of the same object number is an incremental update
    // and supersedes the earlier one, so the last write wins.
    objects.set(id, { id, body: stream ? body.slice(0, streamKeyword) : body, stream });
  }

  return objects;
}

function inflateStream(
  object: PdfObject,
  raw: string,
  budget: { used: number },
): string | null {
  if (!object.stream) return null;
  if (budget.used > MAX_INFLATED_BYTES) return null;

  const payload = Buffer.from(raw.slice(object.stream.start, object.stream.end), "latin1");
  budget.used += payload.length;

  const filter = object.body.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/)?.[1] ?? "";

  // Anything but Flate (JPX, DCT, CCITT, and the LZW/RunLength pair) is either
  // an image or a filter chain not worth reimplementing; those are not content
  // streams, so skipping them costs nothing here.
  if (!filter) return payload.toString("latin1");
  if (!filter.includes("FlateDecode")) return null;

  for (const inflate of [zlib.inflateSync, zlib.inflateRawSync]) {
    try {
      return inflate(payload).toString("latin1");
    } catch {
      // Try the other framing, then give up on this stream.
    }
  }
  return null;
}

// ── String decoding ────────────────────────────────────────────────────────

const LITERAL_ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  "(": "(",
  ")": ")",
  "\\": "\\",
};

/** Decode a `( … )` literal string's bytes, honouring PDF escape syntax. */
function decodeLiteral(source: string): string {
  let out = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character !== "\\") {
      out += character;
      continue;
    }
    const next = source[index + 1];
    if (next === undefined) break;
    if (next >= "0" && next <= "7") {
      const octal = source.slice(index + 1).match(/^[0-7]{1,3}/)![0];
      out += String.fromCharCode(Number.parseInt(octal, 8));
      index += octal.length;
      continue;
    }
    if (next === "\n" || next === "\r") {
      // A line continuation inside a string contributes nothing.
      index += 1;
      continue;
    }
    out += LITERAL_ESCAPES[next] ?? next;
    index += 1;
  }
  return out;
}

function decodeHexString(source: string): string {
  const digits = source.replace(/[^0-9a-fA-F]/g, "");
  const padded = digits.length % 2 === 1 ? `${digits}0` : digits;
  let out = "";
  for (let index = 0; index < padded.length; index += 2) {
    out += String.fromCharCode(Number.parseInt(padded.slice(index, index + 2), 16));
  }
  return out;
}

/** `swap16` throws on an odd length, which a truncated string can have. */
function utf16BigEndian(bytes: string): string | null {
  if (bytes.length < 2 || bytes.length % 2 === 1) return null;
  return Buffer.from(bytes, "latin1").swap16().toString("utf16le");
}

/**
 * Turn the raw bytes a `Tj` showed into something quotable.
 *
 * With a subset font the bytes are glyph indices, not characters, and printing
 * them would put mojibake in a security finding. So the result is checked for
 * legibility, and an illegible one is reported as absent rather than guessed
 * at — the *structural* finding stands on its own either way.
 */
function readableSnippet(bytes: string): string {
  const utf16 =
    bytes.charCodeAt(0) === 0xfe && bytes.charCodeAt(1) === 0xff
      ? utf16BigEndian(bytes.slice(2))
      : null;
  const candidate = utf16 ?? bytes;

  const printable = [...candidate].filter(
    (character) => /[\p{L}\p{N}\p{P}\p{Zs}]/u.test(character),
  ).length;
  if (candidate.length === 0) return "";
  if (printable / candidate.length < 0.7) return "";
  return candidate.replace(/\s+/g, " ").trim().slice(0, MAX_SNIPPET);
}

// ── Colour ─────────────────────────────────────────────────────────────────

function cmykToRgb(c: number, m: number, y: number, k: number): Rgb {
  return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
}

function isNearWhite(color: Rgb | null): boolean {
  if (!color) return false;
  return color.every((channel) => channel > NEAR_WHITE_CHANNEL);
}

function formatColor(color: Rgb | null): string {
  if (!color) return "?";
  const hex = color
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(channel * 255)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
  return `#${hex}`;
}

// ── The content-stream walk ────────────────────────────────────────────────

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function multiply(left: Matrix, right: Matrix): Matrix {
  return {
    a: left.a * right.a + left.b * right.c,
    b: left.a * right.b + left.b * right.d,
    c: left.c * right.a + left.d * right.c,
    d: left.c * right.b + left.d * right.d,
    e: left.e * right.a + left.f * right.c + right.e,
    f: left.e * right.b + left.f * right.d + right.f,
  };
}

/** The vertical scale a matrix applies, which is what a font size is in. */
function verticalScale(matrix: Matrix): number {
  return Math.sqrt(matrix.b * matrix.b + matrix.d * matrix.d) || 1;
}

interface ShownText {
  text: string;
  renderMode: number;
  fillColor: Rgb | null;
  /** Font size after the text and current transformation matrices. */
  effectiveSize: number;
  alpha: number;
  x: number;
  y: number;
}

/**
 * Tokenise one content stream and return every text-showing operation with the
 * graphics state that was in force when it ran.
 *
 * This is not a PDF interpreter. It tracks only the operators the checks need,
 * and it treats an unrecognised operator as a no-op — which is the right
 * failure mode: an unknown operator can make a check miss, never fire falsely.
 */
function readShownText(content: string, lowAlphaStates: Set<string>): ShownText[] {
  const shown: ShownText[] = [];

  const graphicsStack: Array<{ ctm: Matrix; fill: Rgb | null; alpha: number }> = [];
  let ctm: Matrix = IDENTITY;
  let fill: Rgb | null = null;
  let alpha = 1;

  let textMatrix: Matrix = IDENTITY;
  let lineMatrix: Matrix = IDENTITY;
  let fontSize = 0;
  let renderMode = 0;
  let leading = 0;

  // Operands accumulate until an operator consumes them. Strings are pushed as
  // tagged entries so `TJ` arrays and `Tj` literals decode the same way.
  let operands: Array<{ kind: "number" | "name" | "string"; value: string }> = [];
  const numbers = () =>
    operands.filter((item) => item.kind === "number").map((item) => Number.parseFloat(item.value));

  const pushShown = (bytes: string) => {
    if (!bytes) return;
    shown.push({
      text: bytes,
      renderMode,
      fillColor: fill,
      effectiveSize: fontSize * verticalScale(textMatrix) * verticalScale(ctm),
      alpha,
      x: textMatrix.e * ctm.a + textMatrix.f * ctm.c + ctm.e,
      y: textMatrix.e * ctm.b + textMatrix.f * ctm.d + ctm.f,
    });
  };

  const TOKEN =
    /\((?:\\.|[^\\()])*\)|<[0-9a-fA-F\s]*>|\/[^\s/[\]()<>{}]*|[-+]?[\d.]+|[A-Za-z'"*]+|[[\]]/g;

  for (const match of content.matchAll(TOKEN)) {
    const token = match[0];

    if (token.startsWith("(")) {
      operands.push({ kind: "string", value: decodeLiteral(token.slice(1, -1)) });
      continue;
    }
    if (token.startsWith("<") && !token.startsWith("<<")) {
      operands.push({ kind: "string", value: decodeHexString(token.slice(1, -1)) });
      continue;
    }
    if (token.startsWith("/")) {
      operands.push({ kind: "name", value: token.slice(1) });
      continue;
    }
    if (/^[-+]?[\d.]+$/.test(token)) {
      operands.push({ kind: "number", value: token });
      continue;
    }
    if (token === "[" || token === "]") continue;

    switch (token) {
      case "q":
        graphicsStack.push({ ctm, fill, alpha });
        break;
      case "Q": {
        const restored = graphicsStack.pop();
        if (restored) ({ ctm, fill, alpha } = restored);
        break;
      }
      case "cm": {
        const [a, b, c, d, e, f] = numbers();
        if (Number.isFinite(f)) ctm = multiply({ a, b, c, d, e, f }, ctm);
        break;
      }
      case "gs": {
        const name = operands.find((item) => item.kind === "name")?.value;
        if (name && lowAlphaStates.has(name)) alpha = 0;
        break;
      }
      case "g":
      case "G": {
        const [grey] = numbers();
        if (token === "g" && Number.isFinite(grey)) fill = [grey, grey, grey];
        break;
      }
      case "rg":
      case "RG": {
        const [r, gr, b] = numbers();
        if (token === "rg" && Number.isFinite(r)) fill = [r, gr, b];
        break;
      }
      case "k":
      case "K": {
        const [c, m, y, kk] = numbers();
        if (token === "k" && Number.isFinite(c)) fill = cmykToRgb(c, m, y, kk);
        break;
      }
      case "sc":
      case "scn": {
        // The colour space is whatever `cs` last selected, which this does not
        // track; the operand count is a reliable enough stand-in for the three
        // device spaces, and a pattern fill (a name operand) is ignored.
        const values = numbers();
        if (values.length === 1) fill = [values[0], values[0], values[0]];
        else if (values.length === 3) fill = [values[0], values[1], values[2]];
        else if (values.length === 4)
          fill = cmykToRgb(values[0], values[1], values[2], values[3]);
        break;
      }
      case "BT":
        textMatrix = IDENTITY;
        lineMatrix = IDENTITY;
        break;
      case "Tf": {
        const values = numbers();
        fontSize = values[values.length - 1] ?? fontSize;
        break;
      }
      case "Tr": {
        const [mode] = numbers();
        if (Number.isFinite(mode)) renderMode = mode;
        break;
      }
      case "TL": {
        const [value] = numbers();
        if (Number.isFinite(value)) leading = value;
        break;
      }
      case "Tm": {
        const [a, b, c, d, e, f] = numbers();
        if (Number.isFinite(f)) {
          textMatrix = { a, b, c, d, e, f };
          lineMatrix = textMatrix;
        }
        break;
      }
      case "Td": {
        const [tx, ty] = numbers();
        if (Number.isFinite(tx)) {
          lineMatrix = multiply({ ...IDENTITY, e: tx, f: ty }, lineMatrix);
          textMatrix = lineMatrix;
        }
        break;
      }
      case "TD": {
        const [tx, ty] = numbers();
        if (Number.isFinite(tx)) {
          leading = -ty;
          lineMatrix = multiply({ ...IDENTITY, e: tx, f: ty }, lineMatrix);
          textMatrix = lineMatrix;
        }
        break;
      }
      case "T*":
        lineMatrix = multiply({ ...IDENTITY, e: 0, f: -leading }, lineMatrix);
        textMatrix = lineMatrix;
        break;
      case "Tj":
      case "'":
      case '"': {
        if (token !== "Tj") {
          lineMatrix = multiply({ ...IDENTITY, e: 0, f: -leading }, lineMatrix);
          textMatrix = lineMatrix;
        }
        const last = [...operands].reverse().find((item) => item.kind === "string");
        if (last) pushShown(last.value);
        break;
      }
      case "TJ": {
        const joined = operands
          .filter((item) => item.kind === "string")
          .map((item) => item.value)
          .join("");
        pushShown(joined);
        break;
      }
      default:
        break;
    }

    operands = [];
  }

  return shown;
}

// ── Page assembly ──────────────────────────────────────────────────────────

interface PdfPage {
  label: string;
  mediaBox: [number, number, number, number] | null;
  content: string;
}

function parseMediaBox(value: string | undefined): PdfPage["mediaBox"] {
  if (!value) return null;
  const numbers = value.match(/[-+]?[\d.]+/g);
  if (!numbers || numbers.length < 4) return null;
  const [x0, y0, x1, y1] = numbers.slice(0, 4).map(Number.parseFloat);
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

/**
 * Collect the ExtGState names whose fill alpha is effectively zero.
 *
 * Names are scoped per resource dictionary, so a name reused with a different
 * alpha elsewhere in the file could in principle make this over-report. In
 * practice producers generate unique names, and the alternative — resolving
 * each page's resource dictionary — buys very little for a lot of plumbing.
 */
function lowAlphaExtGStates(raw: string): Set<string> {
  const names = new Set<string>();
  for (const match of raw.matchAll(/\/([^\s/<>[\]]+)\s*<<([^>]*?)>>/g)) {
    const alpha = match[2].match(/\/ca\s+([\d.]+)/);
    if (alpha && Number.parseFloat(alpha[1]) < MIN_OPACITY) names.add(match[1]);
  }
  return names;
}

/**
 * Pages, in the order their objects appear in the file.
 *
 * The page *tree* would give the authoritative order, but it can live inside a
 * compressed object stream that this does not unpack, and appearance order
 * matches tree order in everything a normal producer writes. When no page
 * object is visible at all — a fully object-stream'd PDF 1.5+ file — the
 * caller falls back to scanning content streams without page numbers, which
 * loses the label and keeps every check.
 */
function collectPages(
  raw: string,
  objects: Map<number, PdfObject>,
  budget: { used: number },
): PdfPage[] {
  const pages: PdfPage[] = [];
  const inheritedBox = parseMediaBox(
    [...objects.values()]
      .find((object) => /\/Type\s*\/Pages\b/.test(object.body))
      ?.body.match(/\/MediaBox\s*(\[[^\]]*\])/)?.[1],
  );

  for (const object of objects.values()) {
    if (!/\/Type\s*\/Page\b/.test(object.body)) continue;

    const contentRefs = object.body.match(/\/Contents\s*(\d+\s+\d+\s+R|\[[^\]]*\])/)?.[1] ?? "";
    const ids = [...contentRefs.matchAll(/(\d+)\s+\d+\s+R/g)].map((match) =>
      Number.parseInt(match[1], 10),
    );

    const content = ids
      .map((id) => {
        const target = objects.get(id);
        return target ? (inflateStream(target, raw, budget) ?? "") : "";
      })
      .join("\n");

    pages.push({
      label: `page ${pages.length + 1}`,
      mediaBox: parseMediaBox(object.body.match(/\/MediaBox\s*(\[[^\]]*\])/)?.[1]) ?? inheritedBox,
      content,
    });
  }

  return pages;
}

/** Every stream that looks like a content stream, for the no-page-tree case. */
function collectLooseContentStreams(
  raw: string,
  objects: Map<number, PdfObject>,
  budget: { used: number },
): PdfPage[] {
  const pages: PdfPage[] = [];
  for (const object of objects.values()) {
    if (!object.stream) continue;
    if (pages.length >= MAX_CONTENT_STREAMS) break;
    const content = inflateStream(object, raw, budget);
    if (!content) continue;
    if (!/\bBT\b/.test(content) || !/\bTf\b/.test(content)) continue;
    pages.push({
      label: `content stream ${object.id}`,
      mediaBox: null,
      content,
    });
  }
  return pages;
}

// ── The scan ───────────────────────────────────────────────────────────────

/**
 * Checks upstream performs that this port does not. Surfaced in the report so
 * a clean PDF verdict is read as "none of these signatures fired", not as
 * "there is definitely nothing hidden here".
 */
export const MISSING_CHECKS = [
  "rendered-pixel contrast (text hidden behind a shape, or matching a coloured background)",
  "text inside an optional content group whose default state is off, beyond noting that one exists",
];

export function scanPdf(bytes: Buffer): PdfScanResult {
  const findings: SafetyFinding[] = [];
  const hiddenParts: string[] = [];
  const raw = bytes.toString("latin1");

  if (!raw.startsWith("%PDF")) return { findings, hiddenText: "", scanned: false };

  // An encrypted PDF has encrypted streams, so nothing below can read them.
  // Say so rather than returning a clean verdict that means nothing.
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(raw)) {
    findings.push({
      severity: "info",
      type: "Encrypted PDF — structural scan skipped",
      where: "document",
      detail:
        "The content streams are encrypted, so hidden-text signatures could not " +
        "be checked. The extracted text was still scanned for invisible Unicode.",
    });
    return { findings, hiddenText: "", scanned: false };
  }

  const objects = parseObjects(raw);
  const budget = { used: 0 };
  const lowAlpha = lowAlphaExtGStates(raw);

  let pages = collectPages(raw, objects, budget);
  if (pages.length === 0 || pages.every((page) => !page.content)) {
    pages = collectLooseContentStreams(raw, objects, budget);
  }
  if (pages.length === 0) return { findings, hiddenText: "", scanned: false };

  for (const page of pages.slice(0, MAX_CONTENT_STREAMS)) {
    if (!page.content) continue;
    const pageFindings: SafetyFinding[] = [];
    const invisibleSpans: string[] = [];
    let totalSpans = 0;

    for (const span of readShownText(page.content, lowAlpha)) {
      if (!span.text.trim()) continue;
      totalSpans += 1;
      const snippet = readableSnippet(span.text);

      // The order of these mirrors upstream: the cheapest, most specific
      // signature first, and one finding per span.

      if (span.renderMode === 3 || span.renderMode === 7) {
        invisibleSpans.push(snippet);
        continue;
      }

      if (pageFindings.length >= MAX_FINDINGS_PER_PAGE) continue;

      if (span.alpha < MIN_OPACITY) {
        pageFindings.push({
          severity: "critical",
          type: "Transparent text",
          where: page.label,
          detail: `opacity=${span.alpha.toFixed(2)}${describe(snippet)}`,
        });
        if (snippet) hiddenParts.push(snippet);
        continue;
      }

      if (span.effectiveSize > 0 && span.effectiveSize < MIN_LEGIBLE_PT) {
        pageFindings.push({
          severity: "critical",
          type: "Sub-legible font size",
          where: page.label,
          detail:
            `size=${span.effectiveSize.toFixed(2)}pt (below the ${MIN_LEGIBLE_PT}pt ` +
            `legibility floor)${describe(snippet)}`,
        });
        if (snippet) hiddenParts.push(snippet);
        continue;
      }

      if (page.mediaBox) {
        const [x0, y0, x1, y1] = page.mediaBox;
        const offPage =
          span.x < x0 - PAGE_BOX_SLACK ||
          span.x > x1 + PAGE_BOX_SLACK ||
          span.y < y0 - PAGE_BOX_SLACK ||
          span.y > y1 + PAGE_BOX_SLACK;
        if (offPage) {
          pageFindings.push({
            severity: "critical",
            type: "Text positioned outside the page",
            where: page.label,
            detail:
              `placed at (${span.x.toFixed(1)}, ${span.y.toFixed(1)}) against a page ` +
              `box of (${x0}, ${y0}, ${x1}, ${y1})${describe(snippet)}`,
          });
          if (snippet) hiddenParts.push(snippet);
          continue;
        }
      }

      // Render mode 1 paints only the outline, so a white *fill* still shows.
      if (span.renderMode !== 1 && isNearWhite(span.fillColor)) {
        pageFindings.push({
          severity: "critical",
          type: "Near-white text",
          where: page.label,
          detail:
            `colour=${formatColor(span.fillColor)}. Invisible against a white page. ` +
            "This port cannot measure the rendered background, so text deliberately " +
            `set white over a dark band would read the same way${describe(snippet)}`,
        });
        if (snippet) hiddenParts.push(snippet);
      }
    }

    if (invisibleSpans.length > 0) {
      if (totalSpans > 0 && invisibleSpans.length / totalSpans > OCR_LAYER_RATIO) {
        pageFindings.push({
          severity: "info",
          type: "OCR text layer",
          where: page.label,
          detail:
            `The whole ${page.label} (${invisibleSpans.length} spans) uses invisible ` +
            "render mode, which is typical of a scanned document with OCR. Most likely benign.",
        });
      } else {
        for (const snippet of invisibleSpans.slice(0, MAX_FINDINGS_PER_PAGE)) {
          pageFindings.push({
            severity: "critical",
            type: "Text in invisible render mode (mode 3)",
            where: page.label,
            detail:
              "Never painted, but present in the text layer, so AI and copy-paste " +
              `both read it${describe(snippet)}`,
          });
          if (snippet) hiddenParts.push(snippet);
        }
      }
    }

    findings.push(...pageFindings);
  }

  findings.push(...scanOptionalContent(raw));
  findings.push(...scanDocumentInfo(raw, objects));

  return { findings, hiddenText: hiddenParts.join("\n"), scanned: true };
}

function describe(snippet: string): string {
  return snippet
    ? `, content: ${quote(snippet)}`
    : ". The bytes decode through a subset font, so the text itself could not be " +
        "quoted here — open the source document to read it.";
}

/**
 * A layer whose default view state is off.
 *
 * Upstream forces the layer on with pikepdf and diffs the extracted text,
 * which names the hidden content exactly. Without that, the presence of the
 * layer is still reportable, and it is worth reporting: ordinary extraction
 * skips such a layer, so its text can be in the file and in nothing this
 * pipeline saved.
 */
function scanOptionalContent(raw: string): SafetyFinding[] {
  const properties = raw.match(/\/OCProperties\s*<<([\s\S]{0,4000}?)>>\s*(?:\/|>>|endobj)/);
  if (!properties) return [];

  const off = properties[1].match(/\/OFF\s*\[([^\]]*)\]/)?.[1]?.trim();
  const baseStateOff = /\/BaseState\s*\/OFF\b/.test(properties[1]);
  if (!off && !baseStateOff) return [];

  const count = off ? [...off.matchAll(/\d+\s+\d+\s+R/g)].length : 0;
  return [
    {
      severity: "warning",
      type: "Hidden optional content group (layer)",
      where: "document",
      detail:
        (baseStateOff
          ? "The document's default layer state is /OFF. "
          : `${count} layer${count === 1 ? "" : "s"} default to /OFF. `) +
        "Content on such a layer is invisible in a normal viewer and is skipped by " +
        "ordinary text extraction, but remains in the file for anything that parses " +
        "the content stream. Open the original and enable all layers to read it.",
    },
  ];
}

/** Long metadata fields, and invisible Unicode anywhere in the Info dict. */
function scanDocumentInfo(raw: string, objects: Map<number, PdfObject>): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  const infoId = raw.match(/\/Info\s+(\d+)\s+\d+\s+R/)?.[1];
  const info = infoId ? objects.get(Number.parseInt(infoId, 10)) : undefined;
  if (!info) return findings;

  for (const field of info.body.matchAll(/\/(\w+)\s*\(((?:\\.|[^\\()])*)\)/g)) {
    const key = field[1];
    const value = decodeLiteral(field[2]);
    if (value.trim().length > 200) {
      findings.push({
        severity: "warning",
        type: `Unusually long metadata field (${key})`,
        where: "document metadata",
        detail: `${value.length} characters: ${quote(value.slice(0, MAX_SNIPPET))}`,
      });
    }
    findings.push(...scanUnicode(value, `metadata/${key}`));
  }

  return findings;
}
