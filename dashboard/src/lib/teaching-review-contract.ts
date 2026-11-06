import type { TeachingPlan } from "./teaching-plan.ts";
import type { QualityProblem } from "./learn-utils.ts";
import { noteProseWordCount } from "./hermes/note-depth.ts";

export const TEACHING_COVERAGE_REVIEW = `When a teachingPlan is supplied, review the complete delivered text in reader order against that plan AND the actual user request. A correct definition somewhere later does not establish a prerequisite earlier. A chain of definitions without worked use is not beginner teaching. Require an actual missing bridge, not a preferred writing style or compulsory phrase such as "is called". Harmless future destinations are allowed. Sources may be reorganized, but required coverage must survive. Respect the edit scope, quotes, mathematical rigor, length and formatting constraints; do not silently waive a constraint because the draft violated it.
Inspect equations as well as prose: before a mathematical function or operation carries a reasoning step, verify that the learner has a usable meaning for it in the stated background, actual earlier teaching, or preceding explanation. A related function being explained does not explain this one. Require only the bridge needed for the present use, not an unrelated full chapter.
The internal plan is fallible. Do not turn an ambiguous plan paraphrase into an ordering requirement the user did not impose. A different valid sequence is not itself a learning obstacle: identify the actual unexplained dependency. The user's scope and requirements take precedence over the plan's interpretation.
For compound coverage items, check every constituent obligation, not merely the presence of their shared topic. Mark the item missing when a required derivation, transformation, condition, or worked step is absent, and identify that exact omission. When preserving an original page's coverage is requested, compare its supplied text with the replacement: a final formula without the original requested reasoning is a coverage loss. Do not accept a broad quotation containing neighboring topics as evidence for a step it never explains.
Before reporting an incorrect result, recompute it and compare your correction with the actual quoted draft. If the draft already states that correction, do not report it as wrong. A qualified claim followed by its remaining cases is not a contradiction. Findings describe defects in this draft, not errors in a cited source or an earlier draft. Preserve correct mathematics; do not require reproducing a source's arithmetic error. Remove any finding whose own explanation says the result is correct or the entry should be omitted.
Additionally return planCoverage with exactly one entry per teachingPlan.requiredCoverage item: {item: exact item, status: "taught" or "missing", quote: exact contiguous draft passage, missingStep: specific explanation of what the learner cannot follow or do}. For taught, the quote must actually teach the item to the requested depth. For missing, quote the nearest dependent passage and explain the gap. When a required item itself says it is subject to a documented source-evidence gap, the sources cannot complete that part: mark it taught when the draft teaches everything else in the item and states the gap precisely (what is missing and why it cannot be completed from the sources) without inventing the missing content; never require the writer to obtain or invent the missing material. A completely absent concept belongs in planCoverage as missing; never invent a sentence or definition to place it in terms or concepts. Every blocking entry in those arrays must quote text actually present in pageMarkdown, including an unsupported taught_earlier entry. Preserve punctuation, math delimiters, backslashes and line breaks in quotations. Also return contractIssues: [{quote: exact draft passage, problem: concrete violation of requested scope, factual source support, or format}]. Empty contractIssues means none. Never quote the plan as draft evidence. If the whole draft is unrelated, quote its actual opening. Check all constraints independently; this is not a word-count or vocabulary blacklist.`;

export function teachingCoverageProblems(parsed: unknown, plan: TeachingPlan, markdown: string): QualityProblem[] {
  const value = parsed as { planCoverage?: unknown; contractIssues?: unknown };
  if (!Array.isArray(value?.planCoverage) || value.planCoverage.length !== plan.requiredCoverage.length || !Array.isArray(value.contractIssues)) {
    throw new Error("Teaching review omitted plan coverage or constraint inspection.");
  }
  const remaining = new Set(plan.requiredCoverage);
  const problems: QualityProblem[] = [];
  const errors: string[] = [];
  for (const [index, entry] of value.planCoverage.entries()) {
    const label = `planCoverage[${index}] (${JSON.stringify(entry?.item)})`;
    const item = matchingCoverageItem(entry?.item, remaining, plan.requiredCoverage[index]);
    if (item === undefined) errors.push(`${label}: item must match one unused requiredCoverage item exactly.`);
    else { remaining.delete(item); entry.item = item; }
    if (!["taught", "missing"].includes(entry?.status)) errors.push(`${label}: status must be taught or missing.`);
    const quotationError = draftQuotationError(entry?.quote, markdown, label);
    if (quotationError) errors.push(quotationError);
    else entry.quote = presentDraftQuote(entry.quote, markdown);
    if (entry?.status === "missing" && (typeof entry.missingStep !== "string" || !entry.missingStep.trim())) {
      errors.push(`${label}: explain the specific missing learning step.`);
    }
    if (entry?.status === "missing") problems.push({ code: "missing-teaching-coverage", hard: true,
      message: `${entry.item}: ${entry.missingStep}`, evidence: [entry.quote] });
  }
  for (const [index, entry] of value.contractIssues.entries()) {
    const label = `contractIssues[${index}]`;
    const quotationError = draftQuotationError(entry?.quote, markdown, label);
    if (quotationError) errors.push(quotationError);
    else entry.quote = presentDraftQuote(entry.quote, markdown);
    if (typeof entry?.problem !== "string" || !entry.problem.trim()) errors.push(`${label}: explain the concrete constraint violation.`);
    else problems.push({ code: "teaching-contract", hard: true, message: entry.problem, evidence: [entry.quote] });
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return problems;
}

/** The unused required coverage item a review entry names. Reviewers reword
 * long items slightly (telecom-1 lesson 1.4, 2026-10-05: "flat-band edge B"
 * in a 40-word item failed the whole review). A reworded entry still names
 * the item when it shares nearly all its words; the positional item wins. */
export function matchingCoverageItem(
  item: unknown,
  remaining: ReadonlySet<string>,
  positional: string | undefined,
): string | undefined {
  if (typeof item !== "string") return undefined;
  if (remaining.has(item)) return item;
  const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const similarity = (a: string, b: string) => {
    const left = words(a); const right = words(b);
    const shared = [...left].filter((word) => right.has(word)).length;
    return shared / Math.max(1, Math.max(left.size, right.size));
  };
  const candidates = [...remaining]
    .map((candidate) => ({ candidate, score: similarity(item, candidate) }))
    .filter(({ score }) => score >= 0.8)
    .sort((a, b) => Number(b.candidate === positional) - Number(a.candidate === positional) || b.score - a.score);
  return candidates[0]?.candidate;
}

/** The exact draft passage a quotation names. Reviewers transcribe LaTeX
 * loosely: telecom-1 lesson 1.4 (2026-10-03) quoted `f_\\Delta` for
 * `f_\Delta` and dropped the `$` closing `$B=f_0(1+r)$`, failing every term
 * review. Ignoring math delimiters, doubled backslashes and whitespace runs
 * still requires the passage to exist, and the exact draft span is returned. */
export function presentDraftQuote(quote: string, markdown: string): string | null {
  if (markdown.includes(quote)) return quote;
  const draft = looseQuoteText(markdown);
  const wanted = looseQuoteText(quote).text.trim();
  const start = wanted ? draft.text.indexOf(wanted) : -1;
  if (start < 0) return null;
  return markdown.slice(draft.offsets[start], draft.offsets[start + wanted.length - 1] + 1);
}

function looseQuoteText(value: string): { text: string; offsets: number[] } {
  let text = "";
  const offsets: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    // Math delimiters, braces and backslashes are what reviewers drop or
    // double (lesson 2.1, 2026-10-05: `\mathrm{kHz$` for `\mathrm{kHz}$`).
    // Whitespace too: 3.1 quoted `\text{ and}y(t)` for `\text{ and }y(t)`.
    if (char === "$" || char === "{" || char === "}" || char === "\\" || /\s/.test(char)) continue;
    text += char;
    offsets.push(index);
  }
  return { text, offsets };
}

function draftQuotationError(quote: unknown, markdown: string, label: string): string | null {
  if (typeof quote !== "string" || !quote.trim()) return `${label}: missing draft quotation. Copy a contiguous passage from pageMarkdown.`;
  if (presentDraftQuote(quote, markdown) !== null) return null;
  return `${label} quotes text absent from pageMarkdown: ${JSON.stringify(quote.slice(0, 500))}${quote.length > 500 ? " (quotation truncated in this diagnostic)" : ""}. Copy an exact contiguous draft passage, preserving punctuation, math delimiters, backslashes and line breaks; do not join separated passages or insert ellipses. Correct the review evidence, not the draft. Keep valid findings.`;
}

export function validateTeachingFindings(problems: readonly QualityProblem[], markdown: string): void {
  const errors: string[] = [];
  for (const [index, problem] of problems.entries()) {
    if (!problem.evidence?.length) {
      errors.push(`Teaching finding ${index + 1} (${problem.code}) has no draft quotation. Copy the exact contiguous passage from pageMarkdown that the learner cannot follow; do not quote the plan or sources.`);
    }
    for (const quote of problem.evidence ?? []) {
      const error = draftQuotationError(quote, markdown, `Teaching finding ${index + 1} (${problem.code})`);
      if (error) errors.push(error);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
}

/** Enforce only explicitly requested numeric limits; chat has no default floor. */
export function teachingLengthProblems(plan: TeachingPlan, markdown: string): QualityProblem[] {
  const constraints = plan.constraints.join("\n").replace(/(\d),(?=\d{3}\b)/g, "$1");
  const range = constraints.match(/\b(\d+)\s*(?:[-–—]|to)\s*(\d+)\s+(?:prose\s+)?words\b/i);
  const minimum = range?.[1] ?? constraints.match(/\b(?:at least|minimum(?: of)?)\s+(\d+)\s+(?:prose\s+)?words\b/i)?.[1];
  const maximum = range?.[2] ?? constraints.match(/\b(?:at most|no more than|maximum(?: of)?)\s+(\d+)\s+(?:prose\s+)?words\b/i)?.[1];
  if (!minimum && !maximum) return [];
  const count = noteProseWordCount(markdown);
  return (minimum && count < Number(minimum)) || (maximum && count > Number(maximum))
    ? [{ code: "requested-teaching-length", hard: true,
      message: `The text has ${count} prose words. Preserve the requested ${minimum ?? "0"}–${maximum ?? "unbounded"} word range while repairing the teaching.` }] : [];
}

/** Repair may change prose, not silently remove existing source targets or figures. */
export function teachingReferenceTargets(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(/\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]|\]\(([^\n)]+)\)/g)].map(match => match[1] ?? match[2]))];
}

export const TEACHING_REFERENCE_RULES = `referenceContract is the server's literal preservation inventory. requiredTargets come from the original page and initial draft; currentTargets and missingTargets describe the text under review. A retained required target is not missing or replaced merely because a cited source uses a different image rendition or URL. Do not substitute that alternative. Preserve the existing target and source attribution. Do not invent missing-asset claims without supplied evidence. This inventory verifies preservation, not whether a source supports a factual claim; assess that separately from the actual source text.`;

export function missingTeachingReferenceProblems(requiredTargets: readonly string[], revised: string): QualityProblem[] {
  const remaining = new Set(teachingReferenceTargets(revised));
  return [...new Set(requiredTargets)].filter(target => !remaining.has(target)).map(target => ({
    code: "missing-teaching-reference", hard: true, message: `Preserve source/figure target ${target}.`, evidence: [target],
  }));
}

export function protectedTeachingContentProblems(original: string, revised: string): QualityProblem[] {
  return missingTeachingReferenceProblems(teachingReferenceTargets(original), revised);
}
