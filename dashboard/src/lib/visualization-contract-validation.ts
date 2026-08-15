import { isDeepStrictEqual } from "node:util";

import type { LearningUnitContract } from "./learning-unit-contract.ts";
import { GENERATED_VISUAL_CAPABILITY_MANIFEST } from "./generated-visual-capabilities.ts";
import type {
  InteractiveVisualControlContract,
  InteractiveVisualControlInputType,
  InteractiveVisualControlProtocolRole,
  InteractiveVisualIntent,
  InteractiveVisualObservableContract,
  InteractiveVisualOutputRepresentation,
  InteractiveVisualPedagogyContract,
} from "./visual-necessity-types.ts";
import type { VisualizationInteractionGoal } from "./visualization-registry.ts";

export type VisualizationContractControlKind =
  (typeof GENERATED_VISUAL_CAPABILITY_MANIFEST.requiredContractControls.kinds)[number];
export type VisualizationContractProtocolRole =
  (typeof GENERATED_VISUAL_CAPABILITY_MANIFEST.requiredContractControls.protocolRoles)[number];

export interface VisualizationContractEvidenceRef {
  anchor: string;
  quote: string;
}

export interface VisualizationContractControlRepair
  extends InteractiveVisualControlContract {
  kind: VisualizationContractControlKind;
  type: InteractiveVisualControlInputType;
  evidence: VisualizationContractEvidenceRef[];
}

export interface VisualizationContractUnitRepair {
  unitId: string;
  /** Required on the active repair path; optional for the shared control validator. */
  interactionGoal?: VisualizationInteractionGoal;
  /** Required on the active repair path; the model authors the complete learner sequence. */
  learnerAction?: string;
  /** Required on the active repair path; authored in full by the repair model. */
  visualIntent?: InteractiveVisualIntent;
  controls: VisualizationContractControlRepair[];
  /** Required on the active repair path; authored in full by the repair model. */
  observable?: InteractiveVisualObservableContract;
  expectedInsight: string;
  expectedInsightEvidence: VisualizationContractEvidenceRef[];
}

/** The full replacement record required by the live repair loop. */
export interface CompleteVisualizationContractUnitRepair
  extends VisualizationContractUnitRepair {
  interactionGoal: VisualizationInteractionGoal;
  learnerAction: string;
  visualIntent: InteractiveVisualIntent;
  observable: InteractiveVisualObservableContract;
}

export function pedagogyContractFromCompleteRepair(
  repair: CompleteVisualizationContractUnitRepair,
): InteractiveVisualPedagogyContract {
  return {
    interactionGoal: repair.interactionGoal,
    uniqueConcept: repair.visualIntent.uniqueConcept,
    whyStaticSourceFigureIsNotEnough: repair.visualIntent.whyStaticSourceFigureIsNotEnough,
    learnerAction: repair.learnerAction,
    controls: repair.controls,
    observable: repair.observable,
    expectedInsight: repair.expectedInsight,
    expectedInsightEvidence: repair.expectedInsightEvidence,
    duplicateSignature: repair.visualIntent.duplicateSignature,
  };
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
    | "table_goal"
    | "source_text"
    | "source_formula"
    | "source_figure"
    | "source_table";
  text: string;
}

export interface VisualizationContractRepairParseResult {
  repairs: VisualizationContractUnitRepair[];
  problems: string[];
}

export interface VisualizationContractRepairParseOptions {
  /** Complete replacement contracts are mandatory for the active repair loop. */
  requireCompleteContract?: boolean;
  /** When supplied, the response must contain each target exactly once and no other unit. */
  expectedUnitIds?: readonly string[];
}

export const MAX_VISUALIZATION_CONTRACT_REPAIR_RESPONSE_BYTES = 512_000;

function quotedUnion(values: readonly string[]): string {
  return values.map((value) => JSON.stringify(value)).join("|");
}

/** Shared strict complete-record schema used by both model prompts and validators. */
export const VISUALIZATION_CONTRACT_CONTROL_SCHEMA =
  `{"id":string,"kind":${quotedUnion(GENERATED_VISUAL_CAPABILITY_MANIFEST.requiredContractControls.kinds)},"label":string,"type":${quotedUnion(GENERATED_VISUAL_CAPABILITY_MANIFEST.requiredContractControls.types)},"protocolRole"?:${quotedUnion(GENERATED_VISUAL_CAPABILITY_MANIFEST.requiredContractControls.protocolRoles)},"unit"?:string,"min"?:number,"max"?:number,"step"?:number,"options"?:string[],"defaultValue":number|string|boolean,"evidence":[{"anchor":string,"quote":string}]}`;
export const COMPLETE_VISUALIZATION_CONTRACT_REPAIR_SCHEMA =
  `{"unitId":string,"interactionGoal":"manipulate_variables"|"observe_change_over_time"|"compare_cases"|"step_through_process"|"explore_structure"|"test_prediction"|"inspect_relationship"|"simulate_system","learnerAction":string,"visualIntent":{"id":string,"uniqueConcept":string,"visualType":string,"whyStaticSourceFigureIsNotEnough":string,"learnerManipulates":string[],"expectedInsight":string,"sourceAnchors":string[],"duplicateSignature":string,"reuseOf"?:string},"controls":[${VISUALIZATION_CONTRACT_CONTROL_SCHEMA}],"observable":{"label":string,"representation":${quotedUnion(GENERATED_VISUAL_CAPABILITY_MANIFEST.outputs.representations)},"evidence":[{"anchor":string,"quote":string}]},"expectedInsight":string,"expectedInsightEvidence":[{"anchor":string,"quote":string}]}`;

const GENERIC_CONTROL_RE =
  /^(?:control|exploration level|input|key variable|main output|output|parameter|process step|result|step|value|variable)$/i;
const GENERIC_INSIGHT_RE = /^(?:observe the response|see what happens|the output changes|result|insight)$/i;
const INTERACTION_GOALS = new Set<VisualizationInteractionGoal>([
  "manipulate_variables",
  "observe_change_over_time",
  "compare_cases",
  "step_through_process",
  "explore_structure",
  "test_prediction",
  "inspect_relationship",
  "simulate_system",
]);
const REQUIRED_CONTROL_TYPES = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.requiredContractControls.types,
);
const REQUIRED_CONTROL_KINDS = new Set<string>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.requiredContractControls.kinds,
);
const PROTOCOL_ROLES = new Set<InteractiveVisualControlProtocolRole>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.requiredContractControls.protocolRoles,
);
const OUTPUT_REPRESENTATIONS = new Set<InteractiveVisualOutputRepresentation>(
  GENERATED_VISUAL_CAPABILITY_MANIFEST.outputs.representations,
);
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

function responseByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function exactObjectKeys(input: {
  value: Record<string, unknown>;
  path: string;
  required: readonly string[];
  optional?: readonly string[];
  problems: string[];
}): void {
  const allowed = new Set([...input.required, ...(input.optional ?? [])]);
  for (const key of input.required) {
    if (!Object.prototype.hasOwnProperty.call(input.value, key)) {
      input.problems.push(`${input.path}.${key} is required`);
    }
  }
  for (const key of Object.keys(input.value)) {
    if (!allowed.has(key)) {
      input.problems.push(`${input.path}.${key} is unexpected`);
    }
  }
}

function isIdentifierCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}_]/u.test(value);
}

/**
 * Accept an exact source symbol or formula without treating an identifier
 * fragment as evidence. For example, `t` is grounded in `E_x(z,t)`, while
 * `r` is not grounded merely because it appears inside `sqrt`.
 */
function literalPhraseGroundedInText(phrase: string, text: string): boolean {
  const needle = compact(phrase).normalize("NFKC");
  const haystack = compact(text).normalize("NFKC");
  if (!needle || !haystack) return false;

  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) return false;
    const end = index + needle.length;
    const leftBoundary = !isIdentifierCharacter(needle[0]) ||
      !isIdentifierCharacter(haystack[index - 1]);
    const rightBoundary = !isIdentifierCharacter(needle[needle.length - 1]) ||
      !isIdentifierCharacter(haystack[end]);
    if (leftBoundary && rightBoundary) return true;
    offset = index + 1;
  }
  return false;
}

function phraseGroundedInText(phrase: string, text: string): boolean {
  if (literalPhraseGroundedInText(phrase, text)) return true;
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
      compact(candidate.text).includes(quote),
    );
    if (!entry || !quote) return { valid: false, entries: [] };
    matched.push(entry);
  }
  return { valid: true, entries: matched };
}

function parseEvidenceRefs(
  value: unknown,
  path: string,
  problems: string[],
): VisualizationContractEvidenceRef[] {
  if (!Array.isArray(value)) {
    problems.push(`${path} must be an array`);
    return [];
  }
  const refs: VisualizationContractEvidenceRef[] = [];
  value.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      problems.push(`${path}[${index}] must be an object`);
      return;
    }
    const record = item as Record<string, unknown>;
    exactObjectKeys({
      value: record,
      path: `${path}[${index}]`,
      required: ["anchor", "quote"],
      problems,
    });
    if (typeof record.anchor !== "string" || !record.anchor.trim()) {
      problems.push(`${path}[${index}].anchor must be a non-empty string`);
    }
    if (typeof record.quote !== "string" || !record.quote.trim()) {
      problems.push(`${path}[${index}].quote must be a non-empty string`);
    }
    if (typeof record.anchor === "string" && typeof record.quote === "string") {
      refs.push({ anchor: record.anchor, quote: record.quote });
    }
  });
  return refs;
}

function parseStringArray(
  value: unknown,
  path: string,
  problems: string[],
): string[] {
  if (!Array.isArray(value)) {
    problems.push(`${path} must be a string array`);
    return [];
  }
  const strings: string[] = [];
  value.forEach((item, index) => {
    if (typeof item !== "string") {
      problems.push(`${path}[${index}] must be a string`);
      return;
    }
    strings.push(item);
  });
  return strings;
}

function parseVisualIntent(
  value: unknown,
  path: string,
  problems: string[],
  required: boolean,
): InteractiveVisualIntent | undefined {
  if (value === undefined || value === null) {
    if (required) problems.push(`${path} is required`);
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    problems.push(`${path} must be an object`);
    return undefined;
  }
  const record = value as Record<string, unknown>;
  exactObjectKeys({
    value: record,
    path,
    required: [
      "id",
      "uniqueConcept",
      "visualType",
      "whyStaticSourceFigureIsNotEnough",
      "learnerManipulates",
      "expectedInsight",
      "sourceAnchors",
      "duplicateSignature",
    ],
    optional: ["reuseOf"],
    problems,
  });
  const stringField = (field: string): string => {
    if (typeof record[field] !== "string") {
      problems.push(`${path}.${field} must be a string`);
      return "";
    }
    return record[field];
  };
  if (record.reuseOf !== undefined && typeof record.reuseOf !== "string") {
    problems.push(`${path}.reuseOf must be a string when supplied`);
  }
  return {
    id: stringField("id"),
    uniqueConcept: stringField("uniqueConcept"),
    visualType: stringField("visualType"),
    whyStaticSourceFigureIsNotEnough: stringField("whyStaticSourceFigureIsNotEnough"),
    learnerManipulates: parseStringArray(
      record.learnerManipulates,
      `${path}.learnerManipulates`,
      problems,
    ),
    expectedInsight: stringField("expectedInsight"),
    sourceAnchors: parseStringArray(record.sourceAnchors, `${path}.sourceAnchors`, problems),
    duplicateSignature: stringField("duplicateSignature"),
    ...(typeof record.reuseOf === "string" ? { reuseOf: record.reuseOf } : {}),
  };
}

function parseObservable(
  value: unknown,
  path: string,
  problems: string[],
  required: boolean,
): InteractiveVisualObservableContract | undefined {
  if (value === undefined || value === null) {
    if (required) problems.push(`${path} is required`);
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    problems.push(`${path} must be an object`);
    return undefined;
  }
  const record = value as Record<string, unknown>;
  exactObjectKeys({
    value: record,
    path,
    required: ["label", "representation", "evidence"],
    problems,
  });
  if (typeof record.label !== "string") problems.push(`${path}.label must be a string`);
  if (typeof record.representation !== "string") {
    problems.push(`${path}.representation must be a string`);
  }
  return {
    label: typeof record.label === "string" ? record.label : "",
    representation: typeof record.representation === "string"
      ? record.representation as InteractiveVisualOutputRepresentation
      : "" as InteractiveVisualOutputRepresentation,
    evidence: parseEvidenceRefs(record.evidence, `${path}.evidence`, problems),
  };
}

function parseControls(
  value: unknown,
  path: string,
  problems: string[],
): VisualizationContractControlRepair[] {
  if (!Array.isArray(value)) {
    problems.push(`${path} must be an array`);
    return [];
  }
  if (value.length === 0) problems.push(`${path} must contain at least one control`);
  const maximumControls = GENERATED_VISUAL_CAPABILITY_MANIFEST.requiredContractControls.maximum;
  if (value.length > maximumControls) {
    problems.push(`${path} contains ${value.length} controls; at most ${maximumControls} are allowed`);
  }
  const controls: VisualizationContractControlRepair[] = [];
  value.forEach((item, index) => {
    const controlPath = `${path}[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      problems.push(`${controlPath} must be an object`);
      return;
    }
    const record = item as Record<string, unknown>;
    exactObjectKeys({
      value: record,
      path: controlPath,
      required: ["id", "kind", "label", "type", "defaultValue", "evidence"],
      optional: ["protocolRole", "unit", "min", "max", "step", "options"],
      problems,
    });
    const id = typeof record.id === "string" ? record.id : "";
    const kind = typeof record.kind === "string"
      ? record.kind as VisualizationContractControlKind
      : "" as VisualizationContractControlKind;
    const label = typeof record.label === "string" ? record.label : "";
    const type = typeof record.type === "string"
      ? record.type as InteractiveVisualControlInputType
      : "" as InteractiveVisualControlInputType;
    const protocolRole = typeof record.protocolRole === "string"
      ? record.protocolRole as InteractiveVisualControlProtocolRole
      : undefined;
    if (typeof record.id !== "string") problems.push(`${controlPath}.id must be a string`);
    if (typeof record.kind !== "string") problems.push(`${controlPath}.kind must be a string`);
    if (typeof record.label !== "string") problems.push(`${controlPath}.label must be a string`);
    if (typeof record.type !== "string") problems.push(`${controlPath}.type must be a string`);
    if (record.protocolRole !== undefined && typeof record.protocolRole !== "string") {
      problems.push(`${controlPath}.protocolRole must be a string when supplied`);
    }
    if (record.unit !== undefined && typeof record.unit !== "string") {
      problems.push(`${controlPath}.unit must be a string when supplied`);
    }
    for (const field of ["min", "max", "step"] as const) {
      if (record[field] !== undefined && typeof record[field] !== "number") {
        problems.push(`${controlPath}.${field} must be a number when supplied`);
      }
    }
    let options: string[] | undefined;
    if (record.options !== undefined) {
      if (!Array.isArray(record.options) || record.options.some((option) => typeof option !== "string")) {
        problems.push(`${controlPath}.options must be a string array when supplied`);
      } else {
        options = [...record.options];
      }
    }
    if (record.defaultValue === undefined) {
      problems.push(`${controlPath}.defaultValue is required`);
    } else if (
      typeof record.defaultValue !== "number" &&
      typeof record.defaultValue !== "string" &&
      typeof record.defaultValue !== "boolean"
    ) {
      problems.push(`${controlPath}.defaultValue must be a number, string, or boolean`);
    }
    const evidence = parseEvidenceRefs(record.evidence, `${controlPath}.evidence`, problems);
    controls.push({
      id,
      kind,
      label,
      type,
      ...(protocolRole ? { protocolRole } : {}),
      ...(typeof record.unit === "string" ? { unit: record.unit } : {}),
      ...(typeof record.min === "number" ? { min: record.min } : {}),
      ...(typeof record.max === "number" ? { max: record.max } : {}),
      ...(typeof record.step === "number" ? { step: record.step } : {}),
      ...(options ? { options } : {}),
      defaultValue:
        typeof record.defaultValue === "number" ||
        typeof record.defaultValue === "string" ||
        typeof record.defaultValue === "boolean"
          ? record.defaultValue
          : "",
      evidence,
    });
  });
  return controls;
}

export function parseVisualizationContractRepairResponse(
  value: unknown,
  options: VisualizationContractRepairParseOptions = {},
): VisualizationContractRepairParseResult {
  const problems: string[] = [];
  if (responseByteLength(value) > MAX_VISUALIZATION_CONTRACT_REPAIR_RESPONSE_BYTES) {
    return {
      repairs: [],
      problems: [
        `response exceeds ${MAX_VISUALIZATION_CONTRACT_REPAIR_RESPONSE_BYTES} UTF-8 bytes`,
      ],
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { repairs: [], problems: ["response must be an object"] };
  }
  const responseRecord = value as Record<string, unknown>;
  exactObjectKeys({
    value: responseRecord,
    path: "response",
    required: ["repairs"],
    problems,
  });
  const rawRepairs = responseRecord.repairs;
  if (!Array.isArray(rawRepairs)) {
    return { repairs: [], problems: [...new Set([...problems, "repairs must be an array"])] };
  }
  const repairs: VisualizationContractUnitRepair[] = [];
  const seenUnitIds = new Set<string>();
  rawRepairs.forEach((item, index) => {
    const repairPath = `repairs[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      problems.push(`${repairPath} must be an object`);
      return;
    }
    const record = item as Record<string, unknown>;
    const itemProblemsBefore = problems.length;
    exactObjectKeys({
      value: record,
      path: repairPath,
      required: options.requireCompleteContract
        ? [
            "unitId",
            "interactionGoal",
            "learnerAction",
            "visualIntent",
            "controls",
            "observable",
            "expectedInsight",
            "expectedInsightEvidence",
          ]
        : ["unitId", "controls", "expectedInsight", "expectedInsightEvidence"],
      optional: options.requireCompleteContract
        ? []
        : ["interactionGoal", "learnerAction", "visualIntent", "observable"],
      problems,
    });
    const unitId = typeof record.unitId === "string" ? record.unitId : "";
    const interactionGoal = typeof record.interactionGoal === "string"
      ? record.interactionGoal as VisualizationInteractionGoal
      : undefined;
    const learnerAction = typeof record.learnerAction === "string"
      ? record.learnerAction
      : undefined;
    const expectedInsight = typeof record.expectedInsight === "string"
      ? record.expectedInsight
      : "";
    if (typeof record.unitId !== "string") problems.push(`${repairPath}.unitId must be a string`);
    if (unitId && seenUnitIds.has(unitId)) {
      problems.push(`${repairPath}.unitId duplicates repair for ${unitId}`);
    }
    if (unitId) seenUnitIds.add(unitId);
    if (record.interactionGoal !== undefined && typeof record.interactionGoal !== "string") {
      problems.push(`${repairPath}.interactionGoal must be a string`);
    } else if (options.requireCompleteContract && interactionGoal === undefined) {
      problems.push(`${repairPath}.interactionGoal is required`);
    }
    if (record.learnerAction !== undefined && typeof record.learnerAction !== "string") {
      problems.push(`${repairPath}.learnerAction must be a string`);
    } else if (options.requireCompleteContract && !learnerAction?.trim()) {
      problems.push(`${repairPath}.learnerAction is required`);
    }
    if (typeof record.expectedInsight !== "string") {
      problems.push(`${repairPath}.expectedInsight must be a string`);
    }
    const visualIntent = parseVisualIntent(
      record.visualIntent,
      `${repairPath}.visualIntent`,
      problems,
      options.requireCompleteContract === true,
    );
    const observable = parseObservable(
      record.observable,
      `${repairPath}.observable`,
      problems,
      options.requireCompleteContract === true,
    );
    const parsedRepair: VisualizationContractUnitRepair = {
      unitId,
      ...(interactionGoal ? { interactionGoal } : {}),
      ...(learnerAction !== undefined ? { learnerAction } : {}),
      ...(visualIntent ? { visualIntent } : {}),
      controls: parseControls(record.controls, `${repairPath}.controls`, problems),
      ...(observable ? { observable } : {}),
      expectedInsight,
      expectedInsightEvidence: parseEvidenceRefs(
        record.expectedInsightEvidence,
        `${repairPath}.expectedInsightEvidence`,
        problems,
      ),
    };
    if (options.requireCompleteContract && problems.length === itemProblemsBefore) {
      repairs.push(structuredClone(record) as unknown as CompleteVisualizationContractUnitRepair);
    } else {
      repairs.push(parsedRepair);
    }
  });
  if (options.expectedUnitIds) {
    const expectedIds = [...options.expectedUnitIds];
    if (new Set(expectedIds).size !== expectedIds.length) {
      problems.push("expectedUnitIds must be unique");
    }
    for (const unitId of expectedIds) {
      if (!seenUnitIds.has(unitId)) problems.push(`repair response omitted affected unit ${unitId}`);
    }
    for (const unitId of seenUnitIds) {
      if (!expectedIds.includes(unitId)) {
        problems.push(`repair targets unaffected or unknown unit ${unitId}`);
      }
    }
    if (rawRepairs.length !== expectedIds.length) {
      problems.push(
        `repair response must contain exactly ${expectedIds.length} repair(s), received ${rawRepairs.length}`,
      );
    }
  }
  return { repairs, problems: [...new Set(problems)] };
}

export function validateVisualizationContractUnitRepair(input: {
  repair: VisualizationContractUnitRepair;
  unit: LearningUnitContract;
  evidence?: readonly VisualizationContractEvidenceEntry[];
  /** Active repair uses a complete model-authored replacement contract. */
  requireCompleteContract?: boolean;
  /** Post-review gate: require an explicit ordered prediction protocol. */
  requireExecutableProtocol?: boolean;
}): string[] {
  const { repair, unit } = input;
  const problems: string[] = [];
  if (repair.unitId !== unit.id) problems.push(`repair targets ${repair.unitId}, expected ${unit.id}`);
  if (!unit.interactiveVisualPlan || unit.interactiveVisualPlan.requirement === "none") {
    problems.push(`${unit.id} is not a model-approved interactive visual`);
  }
  const evidence = input.evidence ?? visualizationContractEvidenceForUnit(unit);
  if (repair.controls.length === 0) {
    problems.push(`${unit.id}: at least one model-authored learner control is required`);
  }
  const maximumControls = GENERATED_VISUAL_CAPABILITY_MANIFEST.requiredContractControls.maximum;
  if (repair.controls.length > maximumControls) {
    problems.push(`${unit.id}: at most ${maximumControls} learner controls are allowed`);
  }
  const seenControlIds = new Set<string>();
  const protocolRoleIndex = new Map<InteractiveVisualControlProtocolRole, number>();
  repair.controls.forEach((control, controlIndex) => {
    if (!REQUIRED_CONTROL_KINDS.has(control.kind)) {
      problems.push(`${unit.id}: control "${control.label || control.id}" has invalid kind "${control.kind}"`);
    }
    if (!/^[a-z][a-z0-9_]{0,79}$/.test(control.id)) {
      problems.push(`${unit.id}: control id "${control.id || "(missing)"}" is invalid`);
    } else if (seenControlIds.has(control.id)) {
      problems.push(`${unit.id}: duplicate control id "${control.id}"`);
    }
    seenControlIds.add(control.id);
    if (!control.label || GENERIC_CONTROL_RE.test(control.label)) {
      problems.push(`${unit.id}: generic learner control "${control.label || "(missing)"}"`);
    }
    if (control.unit !== undefined && !control.unit.trim()) {
      problems.push(`${unit.id}: control "${control.label}" has an empty unit`);
    }
    if (!REQUIRED_CONTROL_TYPES.has(control.type)) {
      problems.push(`${unit.id}: control "${control.label}" has invalid input type "${control.type}"`);
    }
    const protocolRole = control.protocolRole;
    if (protocolRole !== undefined && !PROTOCOL_ROLES.has(protocolRole)) {
      problems.push(`${unit.id}: control "${control.label}" has invalid protocolRole "${protocolRole}"`);
    } else if (protocolRole !== undefined) {
      if (protocolRoleIndex.has(protocolRole)) {
        problems.push(`${unit.id}: protocolRole "${protocolRole}" must be unique`);
      } else {
        protocolRoleIndex.set(protocolRole, controlIndex);
      }
    }
    const isPureProtocolControl = control.type === "button" || control.type === "toggle";
    if (isPureProtocolControl) {
      if (control.kind !== "protocol_action") {
        problems.push(`${unit.id}: ${control.type} control "${control.label}" must use kind protocol_action`);
      }
      if (!protocolRole) {
        problems.push(`${unit.id}: ${control.type} control "${control.label}" requires protocolRole`);
      } else if (protocolRole === "prediction_input") {
        problems.push(
          `${unit.id}: prediction_input must mark an evidence-grounded subject control, not a pure protocol action`,
        );
      }
      for (const field of ["unit", "min", "max", "step", "options"] as const) {
        if (control[field] !== undefined) {
          problems.push(`${unit.id}: protocol control "${control.label}" must not declare ${field}`);
        }
      }
      if (control.evidence.length !== 0) {
        problems.push(
          `${unit.id}: pure protocol control "${control.label}" must carry exactly empty evidence`,
        );
      }
      if (control.type === "button" && control.defaultValue !== 0) {
        problems.push(`${unit.id}: protocol button "${control.label}" defaultValue must be 0`);
      }
      if (control.type === "toggle" && control.defaultValue !== false) {
        problems.push(`${unit.id}: protocol toggle "${control.label}" defaultValue must be false`);
      }
      return;
    }
    if (control.kind === "protocol_action") {
      problems.push(
        `${unit.id}: source-semantic control "${control.label}" must not use kind protocol_action`,
      );
    }
    if (
      protocolRole !== undefined &&
      protocolRole !== "prediction_input"
    ) {
      problems.push(
        `${unit.id}: ordinary source-semantic controls may carry only protocolRole prediction_input`,
      );
    }
    if (control.kind === "select_case" && control.type !== "select") {
      problems.push(`${unit.id}: select-case control "${control.label}" must use input type select`);
    }
    if (control.kind === "variable" && control.type === "select") {
      problems.push(`${unit.id}: variable control "${control.label}" must use a numeric input type`);
    }
    if (control.type === "select") {
      if (
        control.min !== undefined ||
        control.max !== undefined ||
        control.step !== undefined
      ) {
        problems.push(`${unit.id}: select control "${control.label}" must not declare a numeric domain`);
      }
      const options = control.options ?? [];
      const normalizedOptions = new Set(options.map((option) => option.toLowerCase()));
      if (options.length < 2) {
        problems.push(`${unit.id}: select control "${control.label}" needs at least two cases`);
      }
      if (options.some((option) => !option.trim())) {
        problems.push(`${unit.id}: select control "${control.label}" contains an empty case`);
      }
      if (normalizedOptions.size !== options.length) {
        problems.push(`${unit.id}: select control "${control.label}" contains duplicate cases`);
      }
      if (typeof control.defaultValue !== "string" || !options.includes(control.defaultValue)) {
        problems.push(`${unit.id}: select control "${control.label}" default must exactly match a declared case`);
      }
    } else if (control.type === "slider" || control.type === "number") {
      const numericFields = [
        ["min", control.min],
        ["max", control.max],
        ["step", control.step],
        ["defaultValue", control.defaultValue],
      ] as const;
      for (const [field, value] of numericFields) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          problems.push(`${unit.id}: numeric control "${control.label}" ${field} must be finite`);
        }
      }
      if (
        typeof control.min === "number" && Number.isFinite(control.min) &&
        typeof control.max === "number" && Number.isFinite(control.max) &&
        control.min >= control.max
      ) {
        problems.push(`${unit.id}: numeric control "${control.label}" requires min < max`);
      }
      if (typeof control.step === "number" && Number.isFinite(control.step) && control.step <= 0) {
        problems.push(`${unit.id}: numeric control "${control.label}" requires step > 0`);
      }
      if (
        typeof control.defaultValue === "number" && Number.isFinite(control.defaultValue) &&
        typeof control.min === "number" && Number.isFinite(control.min) &&
        typeof control.max === "number" && Number.isFinite(control.max) &&
        (control.defaultValue < control.min || control.defaultValue > control.max)
      ) {
        problems.push(`${unit.id}: numeric control "${control.label}" default is outside min/max`);
      }
      if (control.options !== undefined) {
        problems.push(`${unit.id}: numeric control "${control.label}" must not declare select options`);
      }
    }
    const refs = evidenceRefsAreValid(control.evidence, evidence);
    if (!refs.valid) {
      problems.push(`${unit.id}: control "${control.label}" has an invalid evidence quote or anchor`);
      return;
    }
    const quotedText = control.evidence.map((item) => item.quote).join(" ");
    if (!phraseGroundedInText(control.label, quotedText)) {
      problems.push(`${unit.id}: control "${control.label}" is not present in its cited evidence`);
    }
    if (control.type === "select") {
      for (const option of control.options ?? []) {
        if (!phraseGroundedInText(option, quotedText)) {
          problems.push(`${unit.id}: select option "${option}" is not present in its cited evidence`);
        }
      }
    }
  });
  if (repair.interactionGoal === "test_prediction" && input.requireExecutableProtocol) {
    const predictionInputIndex = protocolRoleIndex.get("prediction_input");
    const commitIndex = protocolRoleIndex.get("commit_prediction");
    const outcomeIndices = [
      protocolRoleIndex.get("reveal_outcome"),
      protocolRoleIndex.get("evaluate_prediction"),
    ].filter((index): index is number => index !== undefined);
    if (predictionInputIndex === undefined) {
      problems.push(
        `${unit.id}: test_prediction requires one evidence-grounded slider/number/select with protocolRole prediction_input`,
      );
    }
    if (commitIndex === undefined) {
      problems.push(
        `${unit.id}: test_prediction requires a distinct protocol_action button/toggle with protocolRole commit_prediction`,
      );
    }
    if (outcomeIndices.length === 0) {
      problems.push(
        `${unit.id}: test_prediction requires a distinct reveal_outcome or evaluate_prediction protocol control`,
      );
    }
    if (
      predictionInputIndex !== undefined &&
      commitIndex !== undefined &&
      predictionInputIndex >= commitIndex
    ) {
      problems.push(
        `${unit.id}: prediction_input control must precede commit_prediction in authored control order`,
      );
    }
    if (
      commitIndex !== undefined &&
      outcomeIndices.length > 0 &&
      commitIndex >= Math.min(...outcomeIndices)
    ) {
      problems.push(
        `${unit.id}: commit_prediction control must precede reveal_outcome/evaluate_prediction in authored control order`,
      );
    }
  } else if (
    repair.interactionGoal !== "test_prediction" &&
    (
      protocolRoleIndex.has("prediction_input") ||
      protocolRoleIndex.has("commit_prediction") ||
      protocolRoleIndex.has("reveal_outcome") ||
      protocolRoleIndex.has("evaluate_prediction")
    )
  ) {
    problems.push(`${unit.id}: prediction protocol roles require interactionGoal test_prediction`);
  }
  if (repair.interactionGoal !== undefined) {
    if (!INTERACTION_GOALS.has(repair.interactionGoal)) {
      problems.push(`${unit.id}: interactionGoal "${repair.interactionGoal}" is invalid`);
    }
  } else if (input.requireCompleteContract) {
    problems.push(`${unit.id}: complete repair is missing interactionGoal`);
  }
  if (repair.learnerAction !== undefined) {
    if (!compact(repair.learnerAction)) {
      problems.push(`${unit.id}: learnerAction is missing`);
    }
  } else if (input.requireCompleteContract) {
    problems.push(`${unit.id}: complete repair is missing learnerAction`);
  }

  const observable = repair.observable;
  if (observable) {
    if (!compact(observable.label)) {
      problems.push(`${unit.id}: observable label is missing`);
    }
    if (!OUTPUT_REPRESENTATIONS.has(observable.representation)) {
      problems.push(`${unit.id}: observable representation "${observable.representation}" is invalid`);
    }
    const observableEvidence = evidenceRefsAreValid(observable.evidence ?? [], evidence);
    if (!observableEvidence.valid) {
      problems.push(`${unit.id}: observable has an invalid evidence quote or anchor`);
    } else if (!phraseGroundedInText(
      observable.label,
      observable.evidence.map((item) => item.quote).join(" "),
    )) {
      problems.push(`${unit.id}: observable "${observable.label}" is not present in its cited evidence`);
    }
  } else if (input.requireCompleteContract) {
    problems.push(`${unit.id}: complete repair is missing observable`);
  }

  const visualIntent = repair.visualIntent;
  if (visualIntent) {
    if (!compact(visualIntent.id)) {
      problems.push(`${unit.id}: visualIntent.id is required`);
    }
    for (const [field, value] of [
      ["uniqueConcept", visualIntent.uniqueConcept],
      ["visualType", visualIntent.visualType],
      ["whyStaticSourceFigureIsNotEnough", visualIntent.whyStaticSourceFigureIsNotEnough],
      ["duplicateSignature", visualIntent.duplicateSignature],
    ] as const) {
      if (!compact(value)) problems.push(`${unit.id}: visualIntent.${field} is required`);
    }
    if (
      compact(visualIntent.visualType) &&
      !/^[a-z][a-z0-9_]{1,79}$/.test(visualIntent.visualType)
    ) {
      problems.push(`${unit.id}: visualIntent.visualType "${visualIntent.visualType}" is invalid`);
    }
    if (visualIntent.reuseOf !== undefined && !compact(visualIntent.reuseOf)) {
      problems.push(`${unit.id}: visualIntent.reuseOf cannot be empty`);
    }
    const controlLabels = repair.controls.map((control) => control.label);
    if (
      !Array.isArray(visualIntent.learnerManipulates) ||
      visualIntent.learnerManipulates.length !== controlLabels.length ||
      visualIntent.learnerManipulates.some((label, index) => label !== controlLabels[index])
    ) {
      problems.push(
        `${unit.id}: visualIntent.learnerManipulates must exactly match the model-authored control labels in order`,
      );
    }
    if (visualIntent.expectedInsight !== repair.expectedInsight) {
      problems.push(`${unit.id}: visualIntent.expectedInsight must exactly match expectedInsight`);
    }
    const sourceAnchors = Array.isArray(visualIntent.sourceAnchors)
      ? visualIntent.sourceAnchors
      : [];
    if (sourceAnchors.length === 0) {
      problems.push(`${unit.id}: visualIntent.sourceAnchors must cite canonical source evidence`);
    }
    if (new Set(sourceAnchors).size !== sourceAnchors.length) {
      problems.push(`${unit.id}: visualIntent.sourceAnchors contains duplicates`);
    }
    const canonicalAnchors = new Set(evidence.map((entry) => entry.anchor));
    for (const anchor of sourceAnchors) {
      if (!compact(anchor) || !canonicalAnchors.has(anchor)) {
        problems.push(`${unit.id}: visualIntent source anchor "${anchor || "(missing)"}" is not canonical evidence`);
      }
    }
    const citedAnchors = new Set([
      ...repair.controls.flatMap((control) => control.evidence.map((item) => item.anchor)),
      ...(observable?.evidence ?? []).map((item) => item.anchor),
      ...repair.expectedInsightEvidence.map((item) => item.anchor),
    ]);
    for (const anchor of citedAnchors) {
      if (!sourceAnchors.includes(anchor)) {
        problems.push(`${unit.id}: visualIntent.sourceAnchors omits cited evidence anchor "${anchor}"`);
      }
    }
  } else if (input.requireCompleteContract) {
    problems.push(`${unit.id}: complete repair is missing visualIntent`);
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
  evidence?: readonly VisualizationContractEvidenceEntry[],
): string[] {
  const plan = unit.interactiveVisualPlan;
  const intent = plan?.visualIntent;
  if (
    !plan?.controlContract?.length ||
    !plan.interactionGoal ||
    !plan.learnerAction?.trim() ||
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
    evidence,
    requireCompleteContract: true,
    repair: {
      unitId: unit.id,
      interactionGoal: plan.interactionGoal,
      learnerAction: plan.learnerAction,
      visualIntent: intent,
      controls: plan.controlContract.map((control) => ({ ...control })),
      observable: plan.observable,
      expectedInsight: intent.expectedInsight,
      expectedInsightEvidence: plan.expectedInsightEvidence,
    },
  });
  const completeRepair: CompleteVisualizationContractUnitRepair = {
    unitId: unit.id,
    interactionGoal: plan.interactionGoal,
    learnerAction: plan.learnerAction,
    visualIntent: intent,
    controls: plan.controlContract,
    observable: plan.observable,
    expectedInsight: intent.expectedInsight,
    expectedInsightEvidence: plan.expectedInsightEvidence,
  };
  const expectedDecisionInteraction = pedagogyContractFromCompleteRepair(completeRepair);
  if (!isDeepStrictEqual(plan.decision.interaction, expectedDecisionInteraction)) {
    controlProblems.push(
      `${unit.id}: decision.interaction must exactly match the authoritative model-authored interaction contract`,
    );
  }
  if (!isDeepStrictEqual(unit.interactiveVisual, intent)) {
    controlProblems.push(
      `${unit.id}: interactiveVisual must exactly match interactiveVisualPlan.visualIntent`,
    );
  }
  return [...new Set(controlProblems)];
}
