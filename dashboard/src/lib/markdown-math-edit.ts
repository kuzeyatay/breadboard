export { normalizeLatexDelimiters as repairMarkdownMathFormatting } from "./latex-delimiters";

/** Only standalone formatting requests may bypass the model. Compound edits,
 * mathematical corrections and requests to explain/rewrite still use it. */
export function wantsMathFormattingOnly(instruction: string): boolean {
  return /^(?:please\s+)?(?:fix|repair|normalize|correct)\s+(?:the\s+)?(?:latex(?:\s+(?:formatting|delimiters))?|(?:math|equation)\s+(?:formatting|delimiters))(?:\s+(?:in|of|for|on)\s+(?:(?:the|this|current|open)\s+)?(?:markdown|note|page|document))?[.!]?$/i.test(instruction.trim());
}
