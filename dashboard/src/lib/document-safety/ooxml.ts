// Hidden runs inside Office Open XML packages (.docx/.docm, .pptx, .xlsx).
//
// Ported from `scan_docx` in wppoland/hidden-text-detector (MIT), with the
// three checks it makes on each run kept exactly: the hidden attribute
// (`w:vanish`), a sub-legible font below 2pt, and white text against the same
// three near-white hexes upstream uses.
//
// Upstream reaches the runs through python-docx and then re-reads every XML
// part raw, because the object model does not expose headers, footers, fields
// or comments — which is exactly where somebody hiding text would put it. That
// two-pass shape is kept. There is no python-docx here, so the run walk is a
// regex over the part, which is fragile in general and adequate here: OOXML
// run markup is machine-generated, and the only thing being read out of it is
// a handful of attribute values plus the run's own text.
//
// Two deviations, both deliberate:
//
//  1. .pptx and .xlsx are scanned too. Upstream is a PDF/DOCX tool; this
//     pipeline ingests all three, and a hidden run in a slide deck reaches a
//     model by exactly the same route. The DrawingML equivalents of the
//     WordprocessingML checks are used (`sz` in hundredths of a point, an
//     `a:srgbClr` inside the run's `a:solidFill`).
//  2. A white run whose own shading is dark is reported at warning severity
//     rather than critical. Upstream compares against a colour list with no
//     background check, so white-on-navy — a real design, common in headings —
//     reads as an attack. The finding still fires, it just does not claim
//     certainty it does not have.

import AdmZip from "adm-zip";

import type { SafetyFinding } from "./types.ts";
import { quote, scanUnicode } from "./unicode.ts";

/** Near-white text colours, as upstream. */
const WHITE_HEX = new Set(["FFFFFF", "FEFEFE", "FDFDFD"]);

/** The legibility floor, in points, shared with the PDF layer. */
const MIN_LEGIBLE_PT = 2.0;

/** Fills that mean "no shading", so a white run over one is still invisible. */
const TRANSPARENT_FILLS = new Set(["AUTO", "FFFFFF", "NONE", ""]);

/** Cap the evidence collected from one package. */
const MAX_FINDINGS_PER_PART = 20;

export interface OoxmlScanResult {
  findings: SafetyFinding[];
  /** Text proved invisible, for the injection layer to read. */
  hiddenText: string;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    // Ampersand last, so "&amp;lt;" does not become "<".
    .replace(/&amp;/g, "&");
}

/** Read an attribute off an opening tag, namespace prefix optional. */
function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`(?:^|\\s)(?:[a-zA-Z0-9]+:)?${name}="([^"]*)"`));
  return match ? match[1] : undefined;
}

/**
 * Whether an on/off OOXML element is on. These elements are true when present
 * with no value at all, which is why a plain `includes("vanish")` would be
 * right most of the time and wrong exactly when it matters — Word writes
 * `<w:vanish w:val="false"/>` when a user un-hides text.
 */
function toggleIsOn(part: string, elementName: string): boolean {
  const match = part.match(new RegExp(`<w:${elementName}(\\s[^>]*)?/?>`));
  if (!match) return false;
  const value = match[1] ? attribute(match[1], "val") : undefined;
  if (value === undefined) return true;
  const normalized = value.trim().toLowerCase();
  return normalized !== "false" && normalized !== "0" && normalized !== "off";
}

function isNearWhite(hex: string | undefined): boolean {
  if (!hex) return false;
  return WHITE_HEX.has(hex.trim().toUpperCase().replace(/^#/, ""));
}

/** The run's own shading, if it sets any. */
function runShadingFill(runProperties: string): string | undefined {
  const shading = runProperties.match(/<w:shd(\s[^>]*)?\/?>/);
  if (!shading?.[1]) return undefined;
  return attribute(shading[1], "fill")?.trim().toUpperCase();
}

interface RunCheck {
  text: string;
  properties: string;
  where: string;
}

/**
 * Apply the three upstream checks to one run. Returns at most one finding:
 * upstream `return`s after each hit, and that ordering matters — a run that is
 * both hidden and 1pt is one act of concealment, not two.
 */
function checkWordRun(run: RunCheck): { finding: SafetyFinding; hidden: boolean } | null {
  const text = run.text.trim();
  if (!text) return null;
  const snippet = text.slice(0, 300);

  if (toggleIsOn(run.properties, "vanish")) {
    return {
      hidden: true,
      finding: {
        severity: "critical",
        type: "Text flagged hidden (w:vanish)",
        where: run.where,
        detail: `Invisible in Word, still present in the file. Content: ${quote(snippet)}`,
      },
    };
  }

  // `w:sz` is in half-points, so the 2pt floor is a value below 4.
  const size = run.properties.match(/<w:sz(\s[^>]*)\/?>/);
  const halfPoints = size?.[1] ? Number.parseFloat(attribute(size[1], "val") ?? "") : NaN;
  if (Number.isFinite(halfPoints) && halfPoints > 0 && halfPoints / 2 < MIN_LEGIBLE_PT) {
    return {
      hidden: true,
      finding: {
        severity: "critical",
        type: "Sub-legible font size",
        where: run.where,
        detail: `size=${(halfPoints / 2).toFixed(2)}pt, content: ${quote(snippet)}`,
      },
    };
  }

  const color = run.properties.match(/<w:color(\s[^>]*)\/?>/);
  const rgb = color?.[1] ? attribute(color[1], "val") : undefined;
  if (isNearWhite(rgb)) {
    const fill = runShadingFill(run.properties);
    const overDarkFill = fill !== undefined && !TRANSPARENT_FILLS.has(fill);
    return {
      hidden: !overDarkFill,
      finding: {
        severity: overDarkFill ? "warning" : "critical",
        type: "White text",
        where: run.where,
        detail: overDarkFill
          ? `color=#${rgb!.toUpperCase()} over shading #${fill}, so this may be ` +
            `an intentionally light heading rather than concealment. Content: ${quote(snippet)}`
          : `color=#${rgb!.toUpperCase()}, content: ${quote(snippet)}`,
      },
    };
  }

  return null;
}

/** Walk `<w:r>…</w:r>` runs in a WordprocessingML part. */
function scanWordPart(partName: string, xml: string): OoxmlScanResult {
  const findings: SafetyFinding[] = [];
  const hiddenParts: string[] = [];
  let index = 0;

  for (const run of xml.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
    index += 1;
    if (findings.length >= MAX_FINDINGS_PER_PART) break;

    const body = run[1];
    const properties = body.match(/<w:rPr(?:\s[^>]*)?>([\s\S]*?)<\/w:rPr>/)?.[1] ?? "";
    const text = [...body.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((match) => decodeXmlText(match[1]))
      .join("");

    const result = checkWordRun({
      text,
      properties,
      where: `${partName} run ${index}`,
    });
    if (!result) continue;
    findings.push(result.finding);
    if (result.hidden) hiddenParts.push(text.trim());
  }

  return { findings, hiddenText: hiddenParts.join("\n") };
}

/** Walk `<a:r>…</a:r>` runs in a DrawingML part (slides, and chart labels). */
function scanDrawingMlPart(partName: string, xml: string): OoxmlScanResult {
  const findings: SafetyFinding[] = [];
  const hiddenParts: string[] = [];
  let index = 0;

  for (const run of xml.matchAll(/<a:r(?:\s[^>]*)?>([\s\S]*?)<\/a:r>/g)) {
    index += 1;
    if (findings.length >= MAX_FINDINGS_PER_PART) break;

    const body = run[1];
    const propertiesTag = body.match(/<a:rPr(\s[^>]*?)\/?>/)?.[1] ?? "";
    const propertiesBlock =
      body.match(/<a:rPr(?:\s[^>]*)?>([\s\S]*?)<\/a:rPr>/)?.[1] ?? "";
    const text = decodeXmlText(
      body.match(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/)?.[1] ?? "",
    ).trim();
    if (!text) continue;
    const snippet = text.slice(0, 300);
    const where = `${partName} run ${index}`;

    // DrawingML sizes are in hundredths of a point.
    const hundredths = Number.parseFloat(attribute(propertiesTag, "sz") ?? "");
    if (Number.isFinite(hundredths) && hundredths > 0 && hundredths / 100 < MIN_LEGIBLE_PT) {
      findings.push({
        severity: "critical",
        type: "Sub-legible font size",
        where,
        detail: `size=${(hundredths / 100).toFixed(2)}pt, content: ${quote(snippet)}`,
      });
      hiddenParts.push(text);
      continue;
    }

    const fillColor = propertiesBlock
      .match(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/)?.[1]
      ?.match(/<a:srgbClr(\s[^>]*?)\/?>/)?.[1];
    const rgb = fillColor ? attribute(fillColor, "val") : undefined;
    if (isNearWhite(rgb)) {
      findings.push({
        severity: "warning",
        type: "White text",
        where,
        detail:
          `color=#${rgb!.toUpperCase()}. A slide's background is set on the shape ` +
          "or the layout rather than on the run, so this may be white text on a " +
          `dark slide rather than concealment. Content: ${quote(snippet)}`,
      });
      continue;
    }

    // An alpha of zero on the text fill is a transparent run: invisible, and
    // with none of the ambiguity the colour check has.
    const alpha = propertiesBlock.match(/<a:alpha(\s[^>]*?)\/?>/)?.[1];
    const alphaValue = alpha ? Number.parseFloat(attribute(alpha, "val") ?? "") : NaN;
    if (Number.isFinite(alphaValue) && alphaValue <= 10_000) {
      findings.push({
        severity: "critical",
        type: "Transparent text",
        where,
        detail: `alpha=${(alphaValue / 1000).toFixed(1)}%, content: ${quote(snippet)}`,
      });
      hiddenParts.push(text);
    }
  }

  return { findings, hiddenText: hiddenParts.join("\n") };
}

/**
 * Scan an Office Open XML package.
 *
 * Non-OOXML bytes are not an error: the caller routes by extension and this
 * returns an empty result for anything that is not a readable zip, so a
 * corrupt upload loses the scan rather than the upload.
 */
export function scanOoxml(bytes: Buffer): OoxmlScanResult {
  const findings: SafetyFinding[] = [];
  const hiddenParts: string[] = [];

  let zip: AdmZip;
  try {
    zip = new AdmZip(bytes);
  } catch {
    return { findings, hiddenText: "" };
  }

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    if (!name.endsWith(".xml")) continue;

    let xml: string;
    try {
      xml = entry.getData().toString("utf8");
    } catch {
      continue;
    }

    if (name.startsWith("word/")) {
      const result = scanWordPart(name, xml);
      findings.push(...result.findings);
      if (result.hiddenText) hiddenParts.push(result.hiddenText);
    } else if (name.startsWith("ppt/")) {
      const result = scanDrawingMlPart(name, xml);
      findings.push(...result.findings);
      if (result.hiddenText) hiddenParts.push(result.hiddenText);
    }

    // The raw pass. This is what catches headers, footers, fields, comments,
    // and the shared-string table of a workbook — none of which the run walk
    // above reaches, and all of which a model reads.
    findings.push(...scanUnicode(xml, `XML/${name}`));
  }

  return { findings, hiddenText: hiddenParts.join("\n") };
}
