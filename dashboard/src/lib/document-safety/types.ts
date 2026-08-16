// The vocabulary every layer of the hidden-content scan reports in.
//
// Severity mirrors the upstream scanner (see `unicode.ts` for the provenance
// note): CRITICAL is content a human reader cannot see but a model can read,
// WARNING is something worth a look that has legitimate uses, and INFO is a
// benign explanation for a pattern that would otherwise look alarming — the
// OCR text layer of a scanned page being the one that matters in practice.

export type SafetySeverity = "critical" | "warning" | "info";

/**
 * `verdict` is derived, never set by a layer:
 * - `suspicious` — at least one critical finding.
 * - `review` — warnings only.
 * - `notes` — info only.
 * - `clean` — nothing at all.
 */
export type SafetyVerdict = "suspicious" | "review" | "notes" | "clean";

export interface SafetyFinding {
  severity: SafetySeverity;
  /** Short rule name, e.g. "Text in invisible render mode (mode 3)". */
  type: string;
  /** Where in the document it was found, e.g. "page 3" or "XML/word/header1.xml". */
  where: string;
  /** The evidence: measurements, and a quoted snippet where one exists. */
  detail: string;
}

export interface DocumentSafetyReport {
  verdict: SafetyVerdict;
  findings: SafetyFinding[];
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  /**
   * One sentence fit for a toast or a note callout. Empty when the verdict is
   * `clean`, so callers can branch on truthiness without re-deriving anything.
   */
  message: string;
  /** Which layers actually ran, so a skipped format is visible rather than implied clean. */
  layers: string[];
  /**
   * Text a layer proved a human reader cannot see. The injection layer reads
   * this at critical severity and the visible text at warning severity, because
   * the same phrase means something very different in each.
   */
  hiddenText: string;
}

export const SEVERITY_ORDER: Record<SafetySeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};
