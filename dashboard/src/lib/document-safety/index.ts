// The hidden-content scan: the final stage of document ingestion.
//
// Detection rules are ported from wppoland/hidden-text-detector (MIT), with
// the prompt-injection phrase layer taking its shape from
// Andy8647/pdf-injection-scanner (MIT). Provenance, the deviations from each,
// and what this port does *not* check are documented at the top of the file
// that owns each layer — `unicode.ts`, `ooxml.ts`, `pdf.ts`, `injection.ts` —
// rather than summarised here, so the note is next to the code it describes.
//
// Raw `node --test` cannot import a directory, so tests import this file by
// its explicit `index.ts` path even though the bundler accepts the folder.

export {
  renderSafetyCallout,
  safetyFrontmatter,
  scanDocumentForHiddenContent,
  type DocumentSafetyScanInput,
} from "./scan.ts";
export { decodeUnicodeTags, scanUnicode } from "./unicode.ts";
export { scanOoxml } from "./ooxml.ts";
export { MISSING_CHECKS, scanPdf } from "./pdf.ts";
export {
  INJECTION_PATTERN_COUNT,
  scanHiddenTextForInjection,
  scanVisibleTextForInjection,
} from "./injection.ts";
export {
  SEVERITY_ORDER,
  type DocumentSafetyReport,
  type SafetyFinding,
  type SafetySeverity,
  type SafetyVerdict,
} from "./types.ts";
