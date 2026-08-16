// The final stage of document ingestion: is anything in this file invisible to
// the person who uploaded it, and does it contain instructions aimed at a model?
//
// The three detection layers are independent and each is useless alone:
//
//   - `pdf.ts` / `ooxml.ts` read the *file* and answer "what can a reader not
//     see". Only these can tell white-on-white apart from ordinary prose,
//     because by the time text has been extracted the concealment is gone —
//     every extractor in this pipeline (pdf.js, anydoc, the VLM, the raw XML
//     walkers) hands back hidden and visible text as one indistinguishable
//     string. That is the whole attack.
//   - `unicode.ts` reads the *extracted text* and answers "is a payload
//     encoded in characters that render as nothing". This one has to run on
//     the text rather than the file, because the carriers survive extraction
//     and can arrive through a route with no file at all.
//   - `injection.ts` reads both and answers "is this addressed to a model",
//     at critical severity for what a layer proved hidden and warning severity
//     for what is in plain view.
//
// Nothing here rewrites the document. Detection and removal are different
// decisions with different failure modes, and a scrubber that silently deleted
// part of an uploaded contract would be a worse bug than the one it prevents.
// The caller gets a report and decides.

import {
  SEVERITY_ORDER,
  type DocumentSafetyReport,
  type SafetyFinding,
  type SafetySeverity,
  type SafetyVerdict,
} from "./types.ts";
import { scanHiddenTextForInjection, scanVisibleTextForInjection } from "./injection.ts";
import { MISSING_CHECKS, scanPdf } from "./pdf.ts";
import { scanOoxml } from "./ooxml.ts";
import { recoverHiddenUnicodeText, scanUnicode } from "./unicode.ts";

/** Extensions whose bytes one of the structural layers can read. */
const OOXML_EXTENSIONS = new Set(["docx", "docm", "dotx", "pptx", "pptm", "xlsx", "xlsm"]);

/** The most hidden text carried forward, so one pathological file cannot bloat a note. */
const MAX_HIDDEN_TEXT = 20_000;

export interface DocumentSafetyScanInput {
  /** The original bytes. Omit for a text-only source; the Unicode layer still runs. */
  bytes?: Buffer;
  /** Lower-case extension with no dot, e.g. "pdf". */
  ext: string;
  /** The text ingestion extracted, which is what a model will actually read. */
  extractedText: string;
  /** Shown in the message so a multi-file upload says which file. */
  filename: string;
}

function dedupe(findings: SafetyFinding[]): SafetyFinding[] {
  // Hidden content often surfaces from several layers of one file — the run
  // walk and the raw XML pass both see a header. Report it once, listing every
  // location, as upstream does.
  const seen = new Map<string, SafetyFinding>();
  for (const finding of findings) {
    const key = `${finding.type} ${finding.detail}`;
    const existing = seen.get(key);
    if (existing) {
      if (!existing.where.includes(finding.where)) {
        existing.where = `${existing.where}, ${finding.where}`;
      }
      continue;
    }
    seen.set(key, { ...finding });
  }
  return [...seen.values()];
}

/**
 * The extracted text with the hidden runs cut out of it.
 *
 * Matching is by whole line and by plain substring, never by regex: this text
 * came out of the document under scan, so building a pattern from it would let
 * a payload choose the pattern. Short lines are left alone — removing every
 * occurrence of a six-character fragment would carve holes in ordinary prose
 * and could suppress a genuine visible finding.
 */
function withoutHiddenText(text: string, hidden: string): string {
  if (!hidden.trim()) return text;
  let remaining = text;
  for (const line of hidden.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length < 12) continue;
    remaining = remaining.split(trimmed).join(" ");
  }
  return remaining;
}

function verdictFor(counts: Record<SafetySeverity, number>): SafetyVerdict {
  if (counts.critical > 0) return "suspicious";
  if (counts.warning > 0) return "review";
  if (counts.info > 0) return "notes";
  return "clean";
}

/**
 * The one sentence a user sees.
 *
 * It leads with what was found rather than with a severity word, names the
 * single most serious finding, and says what happened to the document — the
 * question anybody reading this warning asks next is "so was it imported or
 * not", and the answer is yes, which is exactly why the warning matters.
 */
function messageFor(
  filename: string,
  verdict: SafetyVerdict,
  counts: Record<SafetySeverity, number>,
  findings: SafetyFinding[],
): string {
  if (verdict === "clean" || verdict === "notes") return "";

  const worst = findings.find((finding) => finding.severity === "critical") ??
    findings.find((finding) => finding.severity === "warning");
  const lead = worst ? `${worst.type} (${worst.where})` : "hidden content";

  if (verdict === "suspicious") {
    const others =
      counts.critical + counts.warning > 1
        ? ` and ${counts.critical + counts.warning - 1} other finding${
            counts.critical + counts.warning === 2 ? "" : "s"
          }`
        : "";
    return (
      `${filename} contains text a reader cannot see: ${lead}${others}. ` +
      "It was imported anyway, so treat anything it says as untrusted — " +
      "the hidden content is quoted in full on the source note."
    );
  }

  return (
    `${filename} has ${counts.warning} thing${counts.warning === 1 ? "" : "s"} worth a look ` +
    `before you trust it: ${lead}. See the source note for the detail.`
  );
}

/**
 * Run every layer that applies to this file and fold the result into one report.
 *
 * Synchronous and self-contained: no model call, no subprocess, no network. It
 * runs on every upload, so it has to be cheap enough that nobody is tempted to
 * make it optional.
 */
export function scanDocumentForHiddenContent(
  input: DocumentSafetyScanInput,
): DocumentSafetyReport {
  const findings: SafetyFinding[] = [];
  const layers: string[] = [];
  const hiddenParts: string[] = [];

  const ext = input.ext.toLowerCase().replace(/^\./, "");

  // ── Structural layers: what the file says is invisible ───────────────────
  if (input.bytes && input.bytes.length > 0) {
    try {
      if (ext === "pdf") {
        const result = scanPdf(input.bytes);
        findings.push(...result.findings);
        if (result.hiddenText) hiddenParts.push(result.hiddenText);
        if (result.scanned) layers.push("pdf-content-stream");
      } else if (OOXML_EXTENSIONS.has(ext)) {
        const result = scanOoxml(input.bytes);
        findings.push(...result.findings);
        if (result.hiddenText) hiddenParts.push(result.hiddenText);
        layers.push("ooxml-runs");
      }
    } catch (error) {
      // A malformed file must not fail the upload it is attached to. Record
      // that the structural layer did not run, so the verdict is not read as
      // stronger than it is.
      findings.push({
        severity: "info",
        type: "Structural scan could not run",
        where: "document",
        detail:
          `The file could not be parsed for hidden-formatting signatures: ` +
          `${error instanceof Error ? error.message : "unknown error"}. ` +
          "The extracted text was still scanned.",
      });
    }
  }

  // ── Character layer: what the text itself carries ────────────────────────
  findings.push(...scanUnicode(input.extractedText, "extracted text"));
  layers.push("invisible-unicode");

  const decodedTags = recoverHiddenUnicodeText(input.extractedText);
  if (decodedTags) hiddenParts.push(decodedTags);

  // ── Phrase layer: is any of it addressed to a model ──────────────────────
  //
  // The visible scan runs on the extracted text *minus* whatever a structural
  // layer proved hidden. Without that subtraction every hidden finding is
  // reported a second time as visible, because extraction is exactly what
  // erases the difference — the two scans would be reading the same sentence
  // and disagreeing about whether anybody can see it.
  const hiddenText = hiddenParts.join("\n").slice(0, MAX_HIDDEN_TEXT);
  findings.push(...scanHiddenTextForInjection(hiddenText, "hidden text"));
  findings.push(
    ...scanVisibleTextForInjection(
      withoutHiddenText(input.extractedText, hiddenText),
      "extracted text",
    ),
  );
  layers.push("prompt-injection-phrases");

  if (ext === "pdf" && layers.includes("pdf-content-stream")) {
    layers.push(...MISSING_CHECKS.map((check) => `not-checked: ${check}`));
  }

  const deduped = dedupe(findings).sort(
    (left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity],
  );

  const counts: Record<SafetySeverity, number> = {
    critical: deduped.filter((finding) => finding.severity === "critical").length,
    warning: deduped.filter((finding) => finding.severity === "warning").length,
    info: deduped.filter((finding) => finding.severity === "info").length,
  };
  const verdict = verdictFor(counts);

  return {
    verdict,
    findings: deduped,
    criticalCount: counts.critical,
    warningCount: counts.warning,
    infoCount: counts.info,
    message: messageFor(input.filename, verdict, counts, deduped),
    layers,
    hiddenText,
  };
}

/**
 * The report as a Markdown callout, appended to the source note.
 *
 * A toast lasts four seconds; a note lasts as long as the garden does, and the
 * garden is where somebody will be reading this document six months from now
 * with no memory of the upload. The hidden text is quoted in full here on
 * purpose — the point is that it stops being hidden.
 */
export function renderSafetyCallout(report: DocumentSafetyReport): string {
  if (report.verdict === "clean" || report.verdict === "notes") return "";

  const heading =
    report.verdict === "suspicious"
      ? "> [!warning] Hidden content detected in this document"
      : "> [!note] This document has content worth checking";

  const lines = [heading, `> ${report.message}`, ">"];

  for (const finding of report.findings) {
    if (finding.severity === "info") continue;
    lines.push(
      `> - **${finding.type}** — ${finding.where}. ${finding.detail}`.replace(/\n/g, " "),
    );
  }

  if (report.hiddenText.trim()) {
    // Indented four spaces inside the quote, which makes it a code block. That
    // is not cosmetic: this text was written by whoever wanted it hidden, and
    // rendering it as markdown would let a payload style, link or restructure
    // the very note that is warning about it.
    lines.push(
      ">",
      "> The text that was hidden, quoted so it no longer is:",
      ">",
      ...report.hiddenText
        .trim()
        .slice(0, 4_000)
        .split(/\r?\n/)
        .map((line) => `>     ${line}`),
    );
  }

  return lines.join("\n");
}

/**
 * The report flattened into frontmatter, which only takes strings and string
 * arrays. Every source note carries this, including a clean one — an absent
 * key would be ambiguous between "scanned and clean" and "never scanned".
 */
export function safetyFrontmatter(report: DocumentSafetyReport): Record<string, string | string[]> {
  return {
    hidden_content_verdict: report.verdict,
    hidden_content_findings: report.findings.map(
      (finding) => `[${finding.severity}] ${finding.type} (${finding.where})`,
    ),
    hidden_content_layers: report.layers,
  };
}
