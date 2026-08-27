import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";

import type {
  CanonicalSourceAnchor,
  FinalGardenPage,
} from "./final-garden-state.ts";
import type { LearningUnitContract } from "./learning-unit-contract.ts";
import { formulaMetricFamily } from "./learn-utils.ts";

export type FormulaSemanticFamily =
  | "accuracy"
  | "latency"
  | "spike_count"
  | "energy"
  | "energy_efficiency"
  | "convergence"
  | "loss"
  | "learning_rate"
  | "membrane_dynamics"
  | "spike_timing"
  | "other";

export type FormulaIdentityEvidence = {
  formulaText?: string;
  title?: string;
  caption?: string;
  sourceContext?: string;
  detectedVariables: string[];
  detectedTerms: string[];
  familyScores: Partial<Record<FormulaSemanticFamily, number>>;
  selectedFamily: FormulaSemanticFamily;
  confidence: "high" | "medium" | "low" | "unsupported";
  provenance:
    | "exact_formula_text"
    | "source_caption"
    | "source_context"
    | "combined_evidence"
    | "legacy_inference";
  reason: string;
};

export type CanonicalFormulaIdentity = {
  anchorId: string;
  sourceId?: string;
  page?: number;
  canonicalText?: string;
  title: string;
  caption?: string;
  family: FormulaSemanticFamily;
  evidence: FormulaIdentityEvidence;
  verified: boolean;
  problems: string[];
};

export type FormulaIdentityConflict = {
  anchorId: string;
  declaredFamily?: string;
  verifiedFamily?: FormulaSemanticFamily;
  conflict:
    | "registry_family_wrong"
    | "contract_assignment_wrong"
    | "page_formula_wrong"
    | "ambiguous_identity";
  affectedUnitIds: string[];
  affectedPages: string[];
  repairAction:
    | "update_formula_registry"
    | "replace_contract_formula_anchor"
    | "move_formula_assignment"
    | "repair_page_formula_metadata"
    | "needs_chatmock";
  reason: string;
};

export type FormulaAssignmentCandidate = {
  anchorId: string;
  identity: CanonicalFormulaIdentity;
  unitId: string;
  pagePath: string;
  unitTitleOverlap: number;
  learningQuestionOverlap: number;
  pageConceptOverlap: number;
  formulaFamilyCompatibility: number;
  sourcePageProximity: number;
  totalScore: number;
  compatible: boolean;
  reason: string;
};

export type FormulaIdentityRepairPacket = {
  issueId: string;
  currentAnchor: {
    anchorId: string;
    declaredFamily?: string;
    formulaText?: string;
    caption?: string;
    sourcePage?: number;
    sourceContext?: string;
  };
  currentUsage: {
    unitId: string;
    unitTitle: string;
    learningQuestion?: string;
    pagePath: string;
    pageTitle: string;
    pageFormulaFamilies: string[];
    relevantPageExcerpt: string;
  };
  assignmentCandidates: {
    anchorId: string;
    formulaText?: string;
    title: string;
    caption?: string;
    sourcePage?: number;
    verifiedFamily: FormulaSemanticFamily;
    score: number;
    reason: string;
  }[];
  allowedActions: (
    | "confirm_anchor_identity"
    | "correct_anchor_family"
    | "replace_contract_assignment"
    | "reject_formula_assignment"
  )[];
};

export type FormulaIdentityRepairDecision = {
  issueId: string;
  action:
    | "confirm_anchor_identity"
    | "correct_anchor_family"
    | "replace_contract_assignment"
    | "reject_formula_assignment";
  verifiedFamily?: FormulaSemanticFamily;
  replacementAnchorId?: string;
  confidence: "high" | "medium" | "low";
  justification: string;
};

export type ContractFormulaAssignmentStatus =
  | "verified"
  | "repaired"
  | "moved"
  | "ambiguous"
  | "unsupported";

export type ContractFormulaAssignmentProvenance = {
  formulaAnchorId: string;
  unitId: string;
  status: ContractFormulaAssignmentStatus;
  verifiedFamily?: FormulaSemanticFamily;
  previousUnitId?: string;
  replacementAnchorId?: string;
  reason: string;
};

export type FormulaIdentityRegistryArtifact = {
  schemaVersion: 1;
  identities: CanonicalFormulaIdentity[];
  conflicts: FormulaIdentityConflict[];
};

const FAMILIES: FormulaSemanticFamily[] = [
  "accuracy", "latency", "spike_count", "energy", "energy_efficiency",
  "convergence", "loss", "learning_rate", "membrane_dynamics", "spike_timing", "other",
];

const STOP_WORDS = new Set([
  "the", "and", "for", "from", "with", "into", "that", "this", "when", "where",
  "formula", "defined", "definition", "total", "source", "time", "using", "used",
]);

export function normalizeFormulaSemanticFamily(value?: string | null): FormulaSemanticFamily | undefined {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "efficiency") return "energy_efficiency";
  if (normalized === "spikecount") return "spike_count";
  if (normalized === "threshold" || normalized === "gradient" || normalized === "probability") return undefined;
  return FAMILIES.includes(normalized as FormulaSemanticFamily)
    ? normalized as FormulaSemanticFamily
    : undefined;
}

export function legacyFormulaFamily(family: FormulaSemanticFamily): string {
  if (family === "spike_count") return "spike-count";
  if (family === "energy_efficiency") return "efficiency";
  return family;
}

function compact(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clamp(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function addScore(
  scores: Partial<Record<FormulaSemanticFamily, number>>,
  family: FormulaSemanticFamily,
  amount: number,
): void {
  scores[family] = clamp((scores[family] ?? 0) + amount);
}

function structuralScores(text: string): Partial<Record<FormulaSemanticFamily, number>> {
  const scores: Partial<Record<FormulaSemanticFamily, number>> = {};
  const value = text.replace(/\\mathrm|\\text|\\operatorname/g, "").toLowerCase();

  if (/(?:t[_\s{]*(?:decision|response)|decision\s*time)[^=\n]*(?:-|−)[^\n]*(?:t[_\s{]*(?:0|onset|stimulus)|stimulus\s*onset)/i.test(value)
      || /(?:t[_\s{]*(?:first[^\n]{0,24}spike)|first\s*output\s*spike(?:\s*time)?)[^=\n]*(?:-|−)[^\n]*(?:t[_\s{]*(?:0|onset|stimulus)|stimulus\s*onset)/i.test(value)
      || /(?:latency|delta\s*t|\\delta\s*t)\s*=.*(?:decision|response).*(?:-|−).*(?:onset|stimulus)/i.test(value)) {
    addScore(scores, "latency", 0.98);
  }
  if (/(?:total\s*spikes?|n[_\s{]*(?:spikes?|spk)\}?|spike\s*count)\s*=.*(?:\\sum|\bsum\b)/i.test(value)
      || /(?:\\sum|\bsum\b)[\s\S]{0,100}(?:s[_\s{]*[a-z]|spike\s*(?:indicator|event))/i.test(value)) {
    addScore(scores, "spike_count", 0.98);
  }
  if (/(?:e[_\s{]*(?:total|energy))\s*=.*(?:e[_\s{]*spike|energy\s*per\s*spike).*(?:\+|plus).*(?:e[_\s{]*(?:syn|synop)|synaptic)/i.test(value)
      || /(?:n[_\s{]*spikes?|total\s*spikes?).*(?:e[_\s{]*spike|energy\s*per\s*spike).*(?:\+|plus)/i.test(value)) {
    addScore(scores, "energy", 0.96);
  }
  if (/(?:accuracy|correct)[^\n]{0,80}(?:\/|\\frac|per)[^\n]{0,80}(?:energy|joule)/i.test(value)
      || /(?:eta|η|efficiency)\s*=.*(?:accuracy|correct).*(?:energy|joule)/i.test(value)) {
    addScore(scores, "energy_efficiency", 0.99);
  }
  if (/(?:accuracy|correct\s*predictions?)\s*=.*(?:\/|\\frac).*?(?:total|predictions?)/i.test(value)
      || /n[_\s{]*correct[^\n]*(?:\/|\\frac)[^\n]*n[_\s{]*total/i.test(value)) {
    addScore(scores, "accuracy", 0.96);
  }
  if (/(?:\\min|min\s*\{|first)[^\n]{0,120}(?:epoch|iteration|e\s*:)[^\n]{0,120}(?:target|threshold|>=|\\geq)/i.test(value)
      || /(?:convergence|epoch)[^\n]{0,100}(?:target\s*accuracy|loss\s*threshold)/i.test(value)) {
    addScore(scores, "convergence", 0.96);
  }
  if (/(?:mathcal\s*\{?l|loss|cross.?entropy|mean.?squared|mse)\s*=/i.test(value)) addScore(scores, "loss", 0.9);
  if (/(?:learning\s*rate|eta|α|alpha)\s*=|(?:w|theta)[^=]*=[^\n]*(?:-|−)[^\n]*(?:gradient|nabla|∇)/i.test(value)) addScore(scores, "learning_rate", 0.86);
  if (/(?:dv\s*\/\s*dt|membrane\s*potential|tau[_\s{]*m)[^\n]*(?:v|voltage)/i.test(value)) addScore(scores, "membrane_dynamics", 0.91);
  if (/(?:delta\s*t|\\delta\s*t)\s*=.*(?:t[_\s{]*post|t[_\s{]*pre)|(?:stdp|spike.timing)/i.test(value)) addScore(scores, "spike_timing", 0.91);

  const detected = normalizeFormulaSemanticFamily(formulaMetricFamily(text));
  if (detected) addScore(scores, detected, 0.56);
  return scores;
}

const TERM_PATTERNS: Array<[string, FormulaSemanticFamily, RegExp]> = [
  ["decision time", "latency", /decision\s*time|response\s*delay|response\s*time/i],
  ["stimulus onset", "latency", /stimulus\s*onset|input\s*stimulus|\bt[_\s{]*(?:0|onset|stimulus)/i],
  ["latency", "latency", /\blatency\b|milliseconds?|timesteps?/i],
  ["total spikes", "spike_count", /total\s*spikes?|spike\s*count|number\s*of\s*spikes?|firing\s*count/i],
  ["spike indicators", "spike_count", /spike\s*(?:indicator|events?)|\bs[_\s{]*[a-z].*\([a-z]\)/i],
  ["energy cost", "energy", /energy\s*(?:cost|consumption|per)|joules?|synaptic\s*operations?/i],
  ["accuracy per energy", "energy_efficiency", /accuracy\s*(?:\/|per|over)\s*(?:energy|joule)|normalized\s*energy\s*efficiency/i],
  ["correct predictions", "accuracy", /correct\s*predictions?|classification\s*accuracy/i],
  ["convergence epoch", "convergence", /convergence\s*(?:time|epoch)|target\s*accuracy|training\s*(?:epoch|iteration|progress)/i],
  ["loss", "loss", /\bloss\b|cross.?entropy|mean.?squared/i],
  ["learning rate", "learning_rate", /learning\s*rate|step\s*size/i],
  ["membrane dynamics", "membrane_dynamics", /membrane\s*(?:potential|dynamics)|leaky\s*integrate/i],
  ["spike timing", "spike_timing", /spike.timing|pre.?synaptic|post.?synaptic|\bstdp\b/i],
];

function contextualScores(text: string, weight: number): {
  scores: Partial<Record<FormulaSemanticFamily, number>>;
  terms: string[];
} {
  const scores: Partial<Record<FormulaSemanticFamily, number>> = {};
  const terms: string[] = [];
  for (const [term, family, pattern] of TERM_PATTERNS) {
    if (!pattern.test(text)) continue;
    terms.push(term);
    addScore(scores, family, weight);
  }
  return { scores, terms };
}

function mergeScores(
  target: Partial<Record<FormulaSemanticFamily, number>>,
  incoming: Partial<Record<FormulaSemanticFamily, number>>,
): void {
  for (const family of FAMILIES) {
    if (incoming[family]) addScore(target, family, incoming[family]!);
  }
}

function sourcePageText(anchor: CanonicalSourceAnchor, gardenDir: string): string | undefined {
  if (!anchor.sourceId || !Number.isFinite(anchor.page)) return undefined;
  const sourcePath = path.join(gardenDir, "sources", `${anchor.sourceId}.md`);
  if (!fs.existsSync(sourcePath)) return undefined;
  const source = fs.readFileSync(sourcePath, "utf-8");
  const pattern = new RegExp(
    `(?:^|\\n)#{1,6}\\s*Page\\s+${anchor.page}\\s*(?:\\r?\\n)([\\s\\S]*?)(?=\\r?\\n#{1,6}\\s*Page\\s+\\d+\\b|$)`,
    "i",
  );
  return pattern.exec(source)?.[1]?.trim() || undefined;
}

function surroundingSourceContext(anchor: CanonicalSourceAnchor, gardenDir: string): string | undefined {
  const pageText = sourcePageText(anchor, gardenDir);
  if (!pageText) return undefined;
  const exact = compact(anchor.exactText);
  if (exact) {
    const compactPage = compact(pageText);
    const index = compactPage.toLowerCase().indexOf(exact.toLowerCase());
    if (index >= 0) return compactPage.slice(Math.max(0, index - 650), index + exact.length + 650);
  }
  const captionTerms = compact(anchor.caption ?? anchor.title).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
  const compactPage = compact(pageText);
  const index = captionTerms.map((term) => compactPage.toLowerCase().indexOf(term)).find((value) => value >= 0) ?? -1;
  return index >= 0 ? compactPage.slice(Math.max(0, index - 500), index + 1400) : compactPage.slice(0, 2400);
}

function detectedVariables(text: string): string[] {
  const variables = text.match(/(?:\\?[A-Za-zΑ-ω])(?:_\{?[^\s}=+\-*/]+\}?|\([^)]{1,20}\))?/g) ?? [];
  return [...new Set(variables.map((value) => value.replace(/[.,;:]$/, "")).filter((value) => !STOP_WORDS.has(value.toLowerCase())))].slice(0, 30);
}

/** Verify identity from symbolic structure first, then caption/title and source
 * context. Anchor suffixes are deliberately never consulted. */
export function verifyCanonicalFormulaIdentity(
  anchor: CanonicalSourceAnchor,
  gardenDir: string,
): CanonicalFormulaIdentity {
  const formulaText = compact(anchor.exactText) || undefined;
  const title = compact(anchor.title || anchor.id);
  const caption = compact(anchor.caption) || undefined;
  const sourceContext = surroundingSourceContext(anchor, gardenDir);
  const scores: Partial<Record<FormulaSemanticFamily, number>> = {};
  const terms = new Set<string>();

  if (formulaText) mergeScores(scores, structuralScores(formulaText));
  const titleEvidence = contextualScores(`${title} ${caption ?? ""}`, 0.28);
  mergeScores(scores, titleEvidence.scores);
  titleEvidence.terms.forEach((term) => terms.add(term));
  if (sourceContext) {
    const contextEvidence = contextualScores(sourceContext, 0.09);
    mergeScores(scores, contextEvidence.scores);
    contextEvidence.terms.forEach((term) => terms.add(term));
  }

  const ranked = FAMILIES.filter((family) => family !== "other")
    .map((family) => ({ family, score: clamp(scores[family] ?? 0) }))
    .sort((left, right) => right.score - left.score || left.family.localeCompare(right.family));
  const top = ranked[0] ?? { family: "other" as FormulaSemanticFamily, score: 0 };
  const second = ranked[1] ?? { family: "other" as FormulaSemanticFamily, score: 0 };
  const margin = top.score - second.score;
  const confidence: FormulaIdentityEvidence["confidence"] =
    top.score >= 0.8 && margin >= 0.18 ? "high"
      : top.score >= 0.62 && margin >= 0.1 ? "medium"
        : top.score > 0 ? "low" : "unsupported";
  const family = confidence === "high" || confidence === "medium" ? top.family : "other";
  const provenance: FormulaIdentityEvidence["provenance"] = formulaText && sourceContext
    ? "combined_evidence"
    : formulaText ? "exact_formula_text"
      : sourceContext ? "source_context"
        : caption || title ? "source_caption" : "legacy_inference";
  const declared = normalizeFormulaSemanticFamily(anchor.formulaFamily);
  const problems: string[] = [];
  if (family === "other") problems.push(top.score > 0 ? `ambiguous family evidence: ${top.family} ${top.score}, ${second.family} ${second.score}` : "no semantic formula evidence");
  if (!formulaText) problems.push("canonical formula text is unavailable");
  if (declared && family !== "other" && declared !== family) problems.push(`declared family ${declared} conflicts with verified family ${family}`);
  const evidence: FormulaIdentityEvidence = {
    formulaText,
    title,
    caption,
    sourceContext,
    detectedVariables: detectedVariables(formulaText ?? ""),
    detectedTerms: [...terms].sort(),
    familyScores: Object.fromEntries(ranked.filter((entry) => entry.score > 0).map((entry) => [entry.family, entry.score])),
    selectedFamily: family,
    confidence,
    provenance,
    reason: family === "other"
      ? `Identity not verified: top evidence ${top.family}=${top.score}, margin=${clamp(margin)}.`
      : `Verified ${family} from ${provenance}; structural/context score=${top.score}, margin=${clamp(margin)} over ${second.family}.`,
  };
  return {
    anchorId: anchor.id,
    sourceId: anchor.sourceId,
    page: anchor.page,
    canonicalText: formulaText,
    title,
    caption,
    family,
    evidence,
    verified: family !== "other" && (confidence === "high" || confidence === "medium"),
    problems,
  };
}

export function buildFormulaIdentityRegistry(
  anchors: Record<string, CanonicalSourceAnchor>,
  gardenDir: string,
): CanonicalFormulaIdentity[] {
  return Object.values(anchors)
    .filter((anchor) => anchor.kind === "formula")
    .map((anchor) => verifyCanonicalFormulaIdentity(anchor, gardenDir))
    .sort((left, right) => left.anchorId.localeCompare(right.anchorId));
}

export function formulaIdentityRegistryPath(gardenDir: string): string {
  return path.join(gardenDir, ".breadboard", "formula-identities.json");
}

export function renderFormulaIdentityRegistry(
  identities: CanonicalFormulaIdentity[],
  conflicts: FormulaIdentityConflict[] = [],
): string {
  const artifact: FormulaIdentityRegistryArtifact = {
    schemaVersion: 1,
    identities,
    conflicts,
  };
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

function tokens(value: string): string[] {
  return [...new Set(value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)))];
}

function overlap(left: string, right: string): number {
  const a = tokens(left);
  const b = new Set(tokens(right));
  return a.length ? clamp(a.filter((token) => b.has(token)).length / a.length) : 0;
}

export function formulaFamiliesForAssignmentContext(
  unit: LearningUnitContract,
  page?: FinalGardenPage,
): FormulaSemanticFamily[] {
  const formulaFamilies = (page?.formulas ?? []).flatMap((formula) => {
    const family = normalizeFormulaSemanticFamily(formula.formulaFamily)
      ?? normalizeFormulaSemanticFamily(formulaMetricFamily(formula.text));
    return family ? [family] : [];
  });
  if (formulaFamilies.length) return [...new Set(formulaFamilies)];
  const text = [
    unit.title, unit.learningQuestion, ...unit.newConcepts, ...unit.prerequisiteConcepts,
    page?.title, page?.body,
  ].filter(Boolean).join(" ");
  const scores = contextualScores(text, 0.4).scores;
  const ranked = FAMILIES.filter((family) => family !== "other" && (scores[family] ?? 0) > 0)
    .sort((left, right) => (scores[right] ?? 0) - (scores[left] ?? 0));
  return ranked.length ? [ranked[0]] : [];
}

export function findCompatibleFormulaAssignments(
  unit: LearningUnitContract,
  page: FinalGardenPage,
  formulaRegistry: CanonicalFormulaIdentity[],
): FormulaAssignmentCandidate[] {
  const contextFamilies = formulaFamiliesForAssignmentContext(unit, page);
  const unitText = `${unit.title} ${unit.newConcepts.join(" ")}`;
  const questionText = unit.learningQuestion;
  const pageText = `${page.title} ${page.formulas.map((formula) => `${formula.text} ${formula.formulaFamily ?? ""}`).join(" ")} ${page.body}`;
  return formulaRegistry.map((identity) => {
    const identityText = `${identity.title} ${identity.caption ?? ""} ${identity.canonicalText ?? ""} ${identity.evidence.detectedTerms.join(" ")}`;
    const unitTitleOverlap = overlap(identityText, unitText);
    const learningQuestionOverlap = overlap(identityText, questionText);
    const pageConceptOverlap = overlap(identityText, pageText);
    const formulaFamilyCompatibility = contextFamilies.length > 0 && contextFamilies.includes(identity.family) ? 1 : 0;
    const sourcePageProximity = page.sourceAnchors.includes(identity.anchorId)
      ? 1
      : page.sourceAnchors.some((id) => id.split(".").slice(0, 2).join(".") === identity.anchorId.split(".").slice(0, 2).join(".")) ? 0.5 : 0;
    const totalScore = clamp(
      formulaFamilyCompatibility * 0.7
      + unitTitleOverlap * 0.1
      + learningQuestionOverlap * 0.07
      + pageConceptOverlap * 0.08
      + sourcePageProximity * 0.05,
    );
    const compatible = identity.verified && formulaFamilyCompatibility === 1 && totalScore >= 0.65;
    return {
      anchorId: identity.anchorId,
      identity,
      unitId: unit.id,
      pagePath: page.rel,
      unitTitleOverlap,
      learningQuestionOverlap,
      pageConceptOverlap,
      formulaFamilyCompatibility,
      sourcePageProximity,
      totalScore,
      compatible,
      reason: compatible
        ? `verified ${identity.family}; family match=1, semantic score=${totalScore}`
        : !identity.verified ? `identity is not verified (${identity.evidence.confidence})`
          : `verified family ${identity.family} is incompatible with page/unit families [${contextFamilies.join(", ") || "unknown"}]`,
    };
  }).sort((left, right) => right.totalScore - left.totalScore || left.anchorId.localeCompare(right.anchorId));
}

export function assertFormulaAssignmentCompatible(
  formulaIdentity: CanonicalFormulaIdentity,
  unit: LearningUnitContract,
  page?: FinalGardenPage,
): void {
  if (!formulaIdentity.verified) {
    throw new Error(`Formula assignment rejected: ${formulaIdentity.anchorId} has no verified semantic identity.`);
  }
  const families = formulaFamiliesForAssignmentContext(unit, page);
  if (families.length === 0 || !families.includes(formulaIdentity.family)) {
    throw new Error(
      `Formula assignment rejected: ${formulaIdentity.anchorId} is ${formulaIdentity.family}, but ${unit.id}${page ? `/${page.rel}` : ""} supports [${families.join(", ") || "no verified family"}].`,
    );
  }
}

export function buildFormulaIdentityRepairPacket(args: {
  issueId: string;
  currentIdentity: CanonicalFormulaIdentity;
  declaredFamily?: string;
  unit: LearningUnitContract;
  page: FinalGardenPage;
  candidates: FormulaAssignmentCandidate[];
}): FormulaIdentityRepairPacket {
  return {
    issueId: args.issueId,
    currentAnchor: {
      anchorId: args.currentIdentity.anchorId,
      declaredFamily: args.declaredFamily,
      formulaText: args.currentIdentity.canonicalText,
      caption: args.currentIdentity.caption,
      sourcePage: args.currentIdentity.page,
      sourceContext: args.currentIdentity.evidence.sourceContext,
    },
    currentUsage: {
      unitId: args.unit.id,
      unitTitle: args.unit.title,
      learningQuestion: args.unit.learningQuestion,
      pagePath: args.page.rel,
      pageTitle: args.page.title,
      pageFormulaFamilies: formulaFamiliesForAssignmentContext(args.unit, args.page),
      relevantPageExcerpt: compact(args.page.body).slice(0, 1600),
    },
    assignmentCandidates: args.candidates.filter((candidate) => candidate.identity.verified).map((candidate) => ({
      anchorId: candidate.anchorId,
      formulaText: candidate.identity.canonicalText,
      title: candidate.identity.title,
      caption: candidate.identity.caption,
      sourcePage: candidate.identity.page,
      verifiedFamily: candidate.identity.family,
      score: candidate.totalScore,
      reason: candidate.reason,
    })),
    allowedActions: ["confirm_anchor_identity", "correct_anchor_family", "replace_contract_assignment", "reject_formula_assignment"],
  };
}

export function verifyFormulaIdentityRepairDecision(
  packet: FormulaIdentityRepairPacket,
  decision: FormulaIdentityRepairDecision,
  formulaRegistry: CanonicalFormulaIdentity[],
): { accepted: boolean; reason: string } {
  if (decision.issueId !== packet.issueId) return { accepted: false, reason: "decision issueId does not match packet" };
  if (!packet.allowedActions.includes(decision.action)) return { accepted: false, reason: "action is not allowed by packet" };
  if (decision.confidence === "low") return { accepted: false, reason: "low-confidence formula decisions are not mutation-safe" };
  if (!decision.justification.trim()) return { accepted: false, reason: "decision lacks justification" };
  const current = formulaRegistry.find((identity) => identity.anchorId === packet.currentAnchor.anchorId);
  if (decision.action === "replace_contract_assignment") {
    const allowed = packet.assignmentCandidates.find((candidate) => candidate.anchorId === decision.replacementAnchorId);
    const identity = formulaRegistry.find((candidate) => candidate.anchorId === decision.replacementAnchorId);
    if (!allowed || !identity) return { accepted: false, reason: "replacement anchor is outside the packet or registry" };
    if (!identity.verified || allowed.verifiedFamily !== identity.family) return { accepted: false, reason: "replacement identity is not independently verified" };
    if (!packet.currentUsage.pageFormulaFamilies.includes(identity.family)) return { accepted: false, reason: "replacement family does not match the page" };
    return { accepted: true, reason: "replacement exists, was packet-bounded, and independently matches the page" };
  }
  if (decision.action === "correct_anchor_family" || decision.action === "confirm_anchor_identity") {
    if (!current || !current.verified || decision.verifiedFamily !== current.family) {
      return { accepted: false, reason: "selected family is not supported by independently verified source evidence" };
    }
    if (decision.action === "confirm_anchor_identity" && !packet.currentUsage.pageFormulaFamilies.includes(current.family)) {
      return { accepted: false, reason: "confirmed identity would preserve the current page mismatch" };
    }
  }
  return { accepted: true, reason: decision.action === "reject_formula_assignment" ? "rejection is non-inventive" : "source evidence independently supports the decision" };
}
