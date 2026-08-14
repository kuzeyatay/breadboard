import type { LearningUnitContract } from "./learning-unit-contract.ts";

export type VisualizationContractControlKind =
  | "variable"
  | "select_case"
  | "process_position";

export interface VisualizationContractEvidenceRef {
  anchor: string;
  quote: string;
}

export interface VisualizationContractControlRepair {
  kind: VisualizationContractControlKind;
  label: string;
  options?: string[];
  evidence: VisualizationContractEvidenceRef[];
}

export interface VisualizationContractUnitRepair {
  unitId: string;
  controls: VisualizationContractControlRepair[];
  expectedInsight: string;
  expectedInsightEvidence: VisualizationContractEvidenceRef[];
}

export interface VisualizationContractEvidenceEntry {
  anchor: string;
  kind:
    | "learning_question"
    | "concept"
    | "knowledge_claim"
    | "formula_term"
    | "formula_goal"
    | "figure_goal"
    | "table_goal";
  text: string;
}

const GENERIC_CONTROL_RE =
  /^(?:control|exploration level|input|key variable|main output|output|parameter|process step|result|step|value|variable)$/i;
const GENERIC_INSIGHT_RE = /^(?:observe the response|see what happens|the output changes|result|insight)$/i;
const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "be", "by", "can", "choose", "does", "for", "from",
  "how", "in", "into", "is", "it", "of", "on", "or", "select", "the", "this", "to",
  "what", "when", "which", "with",
]);

function compact(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function stem(value: string): string {
  return value
    .replace(/(?:ization|isation|ation|ition|ments?|ingly|edly|ing|ed|es|s)$/i, "")
    .slice(0, 32);
}

function tokens(value: string): string[] {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map(stem)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function phraseGroundedInText(phrase: string, text: string): boolean {
  const phraseTokens = [...new Set(tokens(phrase))];
  if (phraseTokens.length === 0) return false;
  const evidenceTokens = new Set(tokens(text));
  return phraseTokens.every((token) => evidenceTokens.has(token));
}

export function visualizationContractEvidenceForUnit(
  unit: LearningUnitContract,
): VisualizationContractEvidenceEntry[] {
  const entries: VisualizationContractEvidenceEntry[] = [];
  const push = (entry: VisualizationContractEvidenceEntry) => {
    const text = compact(entry.text);
    if (text) entries.push({ ...entry, text });
  };
  push({
    anchor: `unit:${unit.id}:learning-question`,
    kind: "learning_question",
    text: unit.learningQuestion,
  });
  for (const concept of [
    ...unit.newConcepts,
    ...(unit.semanticConcepts ?? []).flatMap((item) => [item.preferredLabel, ...item.aliases]),
  ]) {
    push({ anchor: `unit:${unit.id}:concept`, kind: "concept", text: concept });
  }
  for (const claim of unit.knowledgeClaims ?? []) {
    push({
      anchor: claim.evidenceAnchors[0] ?? `unit:${unit.id}:claim`,
      kind: "knowledge_claim",
      text: claim.text,
    });
  }
  for (const formula of unit.sourceFormulas) {
    for (const term of formula.termsToDefine) {
      push({ anchor: formula.id, kind: "formula_term", text: term });
    }
    push({ anchor: formula.id, kind: "formula_goal", text: formula.teachingGoal });
  }
  for (const figure of unit.sourceFigures) {
    push({
      anchor: figure.id,
      kind: "figure_goal",
      text: `${figure.mustBeDiscussedWith} ${figure.interpretationGoal}`,
    });
  }
  for (const table of unit.sourceTables) {
    push({
      anchor: table.id,
      kind: "table_goal",
      text: `${table.teachingGoal} ${table.rowsOrColumnsToExplain.join(" ")}`,
    });
  }
  return entries;
}

function evidenceRefsAreValid(
  refs: readonly VisualizationContractEvidenceRef[],
  entries: readonly VisualizationContractEvidenceEntry[],
): { valid: boolean; entries: VisualizationContractEvidenceEntry[] } {
  if (refs.length === 0) return { valid: false, entries: [] };
  const matched: VisualizationContractEvidenceEntry[] = [];
  for (const ref of refs) {
    const quote = compact(ref.quote);
    const anchor = compact(ref.anchor);
    const entry = entries.find((candidate) =>
      candidate.anchor === anchor &&
      compact(candidate.text).toLowerCase().includes(quote.toLowerCase()),
    );
    if (!entry || !quote) return { valid: false, entries: [] };
    matched.push(entry);
  }
  return { valid: true, entries: matched };
}

function normalizeEvidenceRefs(value: unknown): VisualizationContractEvidenceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const anchor = compact(record.anchor);
    const quote = compact(record.quote);
    return anchor && quote ? [{ anchor, quote }] : [];
  }).slice(0, 6);
}

export function normalizeVisualizationContractRepairResponse(
  value: unknown,
): VisualizationContractUnitRepair[] {
  if (!value || typeof value !== "object") return [];
  const rawRepairs = (value as Record<string, unknown>).repairs;
  const records: unknown[] = Array.isArray(rawRepairs) ? rawRepairs : [];
  return records.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const unitId = compact(record.unitId);
    const expectedInsight = compact(record.expectedInsight);
    const controls = Array.isArray(record.controls)
      ? record.controls.flatMap((control): VisualizationContractControlRepair[] => {
          if (!control || typeof control !== "object") return [];
          const candidate = control as Record<string, unknown>;
          const kind = compact(candidate.kind) as VisualizationContractControlKind;
          const label = compact(candidate.label);
          if (!( ["variable", "select_case", "process_position"] as string[]).includes(kind)) {
            return [];
          }
          const options = Array.isArray(candidate.options)
            ? candidate.options.map(compact).filter(Boolean).slice(0, 8)
            : [];
          return [{
            kind,
            label,
            ...(options.length > 0 ? { options } : {}),
            evidence: normalizeEvidenceRefs(candidate.evidence),
          }];
        }).slice(0, 3)
      : [];
    if (!unitId || controls.length === 0 || !expectedInsight) return [];
    return [{
      unitId,
      controls,
      expectedInsight,
      expectedInsightEvidence: normalizeEvidenceRefs(record.expectedInsightEvidence),
    }];
  });
}

export function validateVisualizationContractUnitRepair(input: {
  repair: VisualizationContractUnitRepair;
  unit: LearningUnitContract;
}): string[] {
  const { repair, unit } = input;
  const problems: string[] = [];
  if (repair.unitId !== unit.id) problems.push(`repair targets ${repair.unitId}, expected ${unit.id}`);
  if (unit.interactiveVisualPlan?.requirement !== "required") {
    problems.push(`${unit.id} is not a required interactive visual`);
  }
  const evidence = visualizationContractEvidenceForUnit(unit);
  for (const control of repair.controls) {
    if (!control.label || GENERIC_CONTROL_RE.test(control.label)) {
      problems.push(`${unit.id}: generic learner control "${control.label || "(missing)"}"`);
      continue;
    }
    const refs = evidenceRefsAreValid(control.evidence, evidence);
    if (!refs.valid) {
      problems.push(`${unit.id}: control "${control.label}" has an invalid evidence quote or anchor`);
      continue;
    }
    const quotedText = control.evidence.map((item) => item.quote).join(" ");
    if (!phraseGroundedInText(control.label, quotedText)) {
      problems.push(`${unit.id}: control "${control.label}" is not present in its cited evidence`);
    }
    if (control.kind === "select_case") {
      const declaredOptions = (control.options ?? []).map(compact).filter(Boolean);
      const normalizedOptions = new Set(declaredOptions.map((option) => option.toLowerCase()));
      const options = [...new Set(declaredOptions)];
      if (options.length < 2) {
        problems.push(`${unit.id}: select control "${control.label}" needs at least two cases`);
      } else if (normalizedOptions.size !== declaredOptions.length) {
        problems.push(`${unit.id}: select control "${control.label}" contains duplicate cases`);
      } else {
        for (const option of options) {
          if (!phraseGroundedInText(option, quotedText)) {
            problems.push(`${unit.id}: select option "${option}" is not present in its cited evidence`);
          }
        }
      }
    }
  }
  if (!repair.expectedInsight || GENERIC_INSIGHT_RE.test(repair.expectedInsight)) {
    problems.push(`${unit.id}: expected insight is generic or missing`);
  } else {
    const insightRefs = evidenceRefsAreValid(repair.expectedInsightEvidence, evidence);
    if (!insightRefs.valid) {
      problems.push(`${unit.id}: expected insight has an invalid evidence quote or anchor`);
    } else if (!phraseGroundedInText(
      repair.expectedInsight,
      repair.expectedInsightEvidence.map((item) => item.quote).join(" "),
    )) {
      problems.push(`${unit.id}: expected insight is not grounded in its cited evidence`);
    }
  }
  return [...new Set(problems)];
}

export function persistedVisualizationControlContractProblems(
  unit: LearningUnitContract,
): string[] {
  const plan = unit.interactiveVisualPlan;
  const intent = plan?.visualIntent ?? unit.interactiveVisual;
  if (
    !plan?.controlContract?.length ||
    !plan.interactionGoal ||
    !plan.observable?.label ||
    !plan.observable.evidence.length ||
    !intent?.expectedInsight ||
    !plan.expectedInsightEvidence?.length
  ) {
    return [`${unit.id}: no validated model-authored learner control contract is present`];
  }
  const validationUnit: LearningUnitContract = {
    ...unit,
    interactiveVisualPlan: {
      ...plan,
      // The shared repair validator protects its targeted-repair API by
      // requiring "required". Persistence validation applies to every active
      // model-authored interaction, so validate an equivalent required view.
      requirement: "required",
    },
  };
  const controlProblems = validateVisualizationContractUnitRepair({
    unit: validationUnit,
    repair: {
      unitId: unit.id,
      controls: plan.controlContract.map((control) => ({
        kind: control.kind,
        label: control.label,
        ...(control.options ? { options: control.options } : {}),
        evidence: control.evidence,
      })),
      expectedInsight: intent.expectedInsight,
      expectedInsightEvidence: plan.expectedInsightEvidence,
    },
  });
  const observableProblems = validateVisualizationContractUnitRepair({
    unit: validationUnit,
    repair: {
      unitId: unit.id,
      controls: plan.controlContract.map((control) => ({
        kind: control.kind,
        label: control.label,
        ...(control.options ? { options: control.options } : {}),
        evidence: control.evidence,
      })),
      expectedInsight: plan.observable.label,
      expectedInsightEvidence: plan.observable.evidence,
    },
  });
  return [...new Set([...controlProblems, ...observableProblems])];
}
