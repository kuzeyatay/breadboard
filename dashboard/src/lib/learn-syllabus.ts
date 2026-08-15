/**
 * Syllabus reading, material resolution, and the anti-hallucination gate.
 *
 * A syllabus names the materials a course teaches from — "Smith, *Introduction
 * to Spiking Networks*, ch. 3", "Nature 2019 neuromorphic survey", "Lecture 4
 * slides". Some of those are uploaded into the garden; some are not. This module
 * turns that list into a decision the pipeline can act on:
 *
 *   1. `normalizeSyllabusPlan` parses the model's reading of the syllabus into
 *      units (weeks/modules) and the materials each one references.
 *   2. A source-grounded model authors material availability and unit coverage.
 *      `syllabusCoverageDecisionProblems` verifies that decision mechanically,
 *      and `projectModelAuthoredSyllabusCoverage` persists it without guessing.
 *   3. `unavailableCitationProbes` + `detectUnavailableCitations` catch a page
 *      that writes about a material the garden does not have.
 *
 * Step 3 is the point. Without it, a syllabus reliably induces hallucination:
 * the model sees "ch. 3 covers refractory dynamics", has no ch. 3, and writes a
 * plausible summary of it anyway.
 */

export type SyllabusMaterialKind =
  | "textbook"
  | "chapter"
  | "paper"
  | "reading"
  | "lecture"
  | "slides"
  | "dataset"
  | "video"
  | "other";

export interface SyllabusReferencedMaterial {
  id: string;
  /** The reference exactly as the syllabus writes it. */
  citation: string;
  title?: string;
  authors?: string[];
  kind: SyllabusMaterialKind;
  /** "ch. 3", "pp. 40-58", "Week 2" — the part of the work being assigned. */
  locator?: string;
  required: boolean;
}

export interface SyllabusUnit {
  id: string;
  /** "Week 1", "Module 2", "Session 3" — the syllabus's own numbering. */
  label?: string;
  title: string;
  objectives: string[];
  topics: string[];
  /** Ids from `referencedMaterials`. */
  materialIds: string[];
}

export interface SyllabusPlan {
  courseTitle?: string;
  units: SyllabusUnit[];
  referencedMaterials: SyllabusReferencedMaterial[];
}

/**
 * - `available`: at least one garden document satisfies the citation.
 * - `missing`: the citation is specific enough to look for and nothing matches.
 * - `generic`: the citation names no identifiable work ("Lecture 3", "Readings
 *   TBD"). Never gated on — there is nothing to hallucinate *about*.
 */
export type SyllabusMaterialStatus = "available" | "missing" | "generic";

export interface SyllabusMaterialResolution {
  materialId: string;
  citation: string;
  status: SyllabusMaterialStatus;
  /** Garden documents that satisfy the citation, strongest match first. */
  sourceIds: string[];
  /** The model's source-grounded explanation for this exact verdict. */
  matchReason: string;
}

export interface SyllabusUnitCoverage {
  unitId: string;
  label?: string;
  title: string;
  objectives: string[];
  topics: string[];
  /** Documents this unit should be taught from, heavily. */
  availableSourceIds: string[];
  /** Citations this unit assigns that the garden does not contain. */
  missingCitations: string[];
  /** Model-authored verdict after reviewing this unit and the selected sources. */
  teachable: boolean;
  /** The model's explanation of what the selected sources can or cannot teach. */
  coverageReason: string;
}

/**
 * The complete semantic decision authored by the syllabus-coverage model.
 * Text copied from the syllabus and all IDs are subsequently checked exactly;
 * code does not rank documents, decide availability, or infer teachability.
 */
export interface ModelAuthoredSyllabusCoverageDecision {
  resolutions: SyllabusMaterialResolution[];
  units: Array<{
    unitId: string;
    availableSourceIds: string[];
    missingCitations: string[];
    teachable: boolean;
    coverageReason: string;
  }>;
}

export interface SyllabusCoverage {
  courseTitle?: string;
  plan: SyllabusPlan;
  resolutions: SyllabusMaterialResolution[];
  units: SyllabusUnitCoverage[];
  /** Every garden document a syllabus unit points at. */
  availableSourceIds: string[];
  missingCitations: string[];
  /** Units with no available material at all — planning must not invent these. */
  untaughtUnitTitles: string[];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const MATERIAL_KINDS = new Set<SyllabusMaterialKind>([
  "textbook",
  "chapter",
  "paper",
  "reading",
  "lecture",
  "slides",
  "dataset",
  "video",
  "other",
]);

function asText(value: unknown, maxLength = 400): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function asTextList(value: unknown, maxItems = 20, maxLength = 400): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const text = asText(entry, maxLength);
    if (text) out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Parse the syllabus-reading response. Everything is optional and defensively
 * typed: a malformed reading degrades to "no syllabus structure", which the
 * caller treats exactly like having no syllabus at all.
 */
export function normalizeSyllabusPlan(raw: unknown): SyllabusPlan {
  const root = asRecord(raw);
  if (!root) return { units: [], referencedMaterials: [] };

  const materials: SyllabusReferencedMaterial[] = [];
  const seenMaterialIds = new Set<string>();
  const rawMaterials = Array.isArray(root.referencedMaterials)
    ? root.referencedMaterials
    : [];
  for (const entry of rawMaterials) {
    const record = asRecord(entry);
    if (!record) continue;
    const citation = asText(record.citation) || asText(record.title);
    if (!citation) continue;
    let id = asText(record.id, 40) || `R${materials.length + 1}`;
    while (seenMaterialIds.has(id)) id = `${id}_${materials.length + 1}`;
    seenMaterialIds.add(id);
    const kindText = asText(record.kind, 40).toLowerCase() as SyllabusMaterialKind;
    materials.push({
      id,
      citation,
      title: asText(record.title) || undefined,
      authors: asTextList(record.authors, 10, 120),
      kind: MATERIAL_KINDS.has(kindText) ? kindText : "other",
      locator: asText(record.locator, 120) || undefined,
      required: record.required !== false,
    });
    if (materials.length >= 200) break;
  }

  const knownMaterialIds = new Set(materials.map((material) => material.id));
  const units: SyllabusUnit[] = [];
  const rawUnits = Array.isArray(root.units) ? root.units : [];
  for (const entry of rawUnits) {
    const record = asRecord(entry);
    if (!record) continue;
    const title = asText(record.title);
    if (!title) continue;
    units.push({
      id: asText(record.id, 40) || `SU${units.length + 1}`,
      label: asText(record.label, 80) || undefined,
      title,
      objectives: asTextList(record.objectives, 15, 400),
      topics: asTextList(record.topics, 25, 200),
      materialIds: asTextList(record.materialIds, 25, 40).filter((id) =>
        knownMaterialIds.has(id),
      ),
    });
    if (units.length >= 100) break;
  }

  return {
    courseTitle: asText(root.courseTitle, 200) || undefined,
    units,
    referencedMaterials: materials,
  };
}

function exactAuthoredString(value: unknown, path: string, problems: string[]): value is string {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    problems.push(`${path} must be a non-empty exact string`);
    return false;
  }
  return true;
}

function exactAuthoredStringArray(value: unknown, path: string, problems: string[]): value is string[] {
  if (!Array.isArray(value)) {
    problems.push(`${path} must be an array of exact strings`);
    return false;
  }
  let valid = true;
  value.forEach((entry, index) => {
    if (!exactAuthoredString(entry, `${path}[${index}]`, problems)) valid = false;
  });
  if (value.every((entry) => typeof entry === "string") && new Set(value).size !== value.length) {
    problems.push(`${path} must not contain duplicates`);
    valid = false;
  }
  return valid;
}

/** Strict active-Learn parser boundary. It reports malformed model output but
 * never trims, truncates, drops, defaults, renames, or de-duplicates semantic
 * fields before the model receives a repair attempt. */
export function modelAuthoredSyllabusPlanProblems(value: unknown): string[] {
  const root = asRecord(value);
  if (!root) return ["syllabus plan must be a JSON object"];
  const problems: string[] = [];
  if (root.courseTitle !== undefined) {
    exactAuthoredString(root.courseTitle, "courseTitle", problems);
  }
  if (!Array.isArray(root.referencedMaterials)) {
    problems.push("referencedMaterials must be an array");
  }
  if (!Array.isArray(root.units)) problems.push("units must be an array");

  const materialIds = new Set<string>();
  const materials = Array.isArray(root.referencedMaterials) ? root.referencedMaterials : [];
  materials.forEach((entry, index) => {
    const material = asRecord(entry);
    const prefix = `referencedMaterials[${index}]`;
    if (!material) {
      problems.push(`${prefix} must be an object`);
      return;
    }
    if (exactAuthoredString(material.id, `${prefix}.id`, problems)) {
      if (materialIds.has(material.id)) problems.push(`${prefix}.id duplicates ${material.id}`);
      materialIds.add(material.id);
    }
    exactAuthoredString(material.citation, `${prefix}.citation`, problems);
    if (material.title !== undefined) exactAuthoredString(material.title, `${prefix}.title`, problems);
    if (material.locator !== undefined) exactAuthoredString(material.locator, `${prefix}.locator`, problems);
    exactAuthoredStringArray(material.authors, `${prefix}.authors`, problems);
    if (typeof material.kind !== "string" || !MATERIAL_KINDS.has(material.kind as SyllabusMaterialKind)) {
      problems.push(`${prefix}.kind is invalid`);
    }
    if (typeof material.required !== "boolean") problems.push(`${prefix}.required must be boolean`);
  });

  const unitIds = new Set<string>();
  const units = Array.isArray(root.units) ? root.units : [];
  units.forEach((entry, index) => {
    const unit = asRecord(entry);
    const prefix = `units[${index}]`;
    if (!unit) {
      problems.push(`${prefix} must be an object`);
      return;
    }
    if (exactAuthoredString(unit.id, `${prefix}.id`, problems)) {
      if (unitIds.has(unit.id)) problems.push(`${prefix}.id duplicates ${unit.id}`);
      unitIds.add(unit.id);
    }
    if (unit.label !== undefined) exactAuthoredString(unit.label, `${prefix}.label`, problems);
    exactAuthoredString(unit.title, `${prefix}.title`, problems);
    exactAuthoredStringArray(unit.objectives, `${prefix}.objectives`, problems);
    exactAuthoredStringArray(unit.topics, `${prefix}.topics`, problems);
    if (exactAuthoredStringArray(unit.materialIds, `${prefix}.materialIds`, problems)) {
      for (const materialId of unit.materialIds) {
        if (!materialIds.has(materialId)) problems.push(`${prefix}.materialIds references unknown ${materialId}`);
      }
    }
  });
  return [...new Set(problems)];
}

/** Exact projection of a response that passed modelAuthoredSyllabusPlanProblems. */
export function projectModelAuthoredSyllabusPlan(value: unknown): SyllabusPlan {
  const problems = modelAuthoredSyllabusPlanProblems(value);
  if (problems.length > 0) {
    throw new Error(`Invalid model-authored syllabus plan: ${problems.join("; ")}`);
  }
  const root = value as Record<string, unknown>;
  return {
    ...(root.courseTitle !== undefined ? { courseTitle: root.courseTitle as string } : {}),
    referencedMaterials: (root.referencedMaterials as Array<Record<string, unknown>>).map((material) => ({
      id: material.id as string,
      citation: material.citation as string,
      ...(material.title !== undefined ? { title: material.title as string } : {}),
      authors: [...(material.authors as string[])],
      kind: material.kind as SyllabusMaterialKind,
      ...(material.locator !== undefined ? { locator: material.locator as string } : {}),
      required: material.required as boolean,
    })),
    units: (root.units as Array<Record<string, unknown>>).map((unit) => ({
      id: unit.id as string,
      ...(unit.label !== undefined ? { label: unit.label as string } : {}),
      title: unit.title as string,
      objectives: [...(unit.objectives as string[])],
      topics: [...(unit.topics as string[])],
      materialIds: [...(unit.materialIds as string[])],
    })),
  };
}

// ---------------------------------------------------------------------------
// Validating the model-authored syllabus decision
// ---------------------------------------------------------------------------

const MATERIAL_STATUSES = new Set<SyllabusMaterialStatus>([
  "available",
  "missing",
  "generic",
]);

function exactStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function duplicateStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function sameStringsInOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Mechanically validate a complete model-authored availability/coverage
 * decision. This intentionally contains no title matching, token scoring,
 * chapter inference, or teachability rule.
 */
export function syllabusCoverageDecisionProblems(
  value: unknown,
  plan: SyllabusPlan,
  knownSourceIds: readonly string[],
): string[] {
  const root = asRecord(value);
  if (!root) return ["coverage decision must be a JSON object"];

  const problems: string[] = [];
  const rawResolutions = Array.isArray(root.resolutions) ? root.resolutions : [];
  const rawUnits = Array.isArray(root.units) ? root.units : [];
  if (!Array.isArray(root.resolutions)) problems.push("resolutions must be an array");
  if (!Array.isArray(root.units)) problems.push("units must be an array");
  if (rawResolutions.length !== plan.referencedMaterials.length) {
    problems.push(
      `resolutions must contain exactly ${plan.referencedMaterials.length} entries, one for every referenced material`,
    );
  }
  if (rawUnits.length !== plan.units.length) {
    problems.push(`units must contain exactly ${plan.units.length} entries, one for every syllabus unit`);
  }

  const knownSources = new Set(knownSourceIds);
  const knownMaterials = new Map(plan.referencedMaterials.map((material) => [material.id, material]));
  const resolutionById = new Map<string, SyllabusMaterialResolution>();

  rawResolutions.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      problems.push(`resolutions[${index}] must be an object`);
      return;
    }
    const expected = plan.referencedMaterials[index];
    const materialId = typeof record.materialId === "string" ? record.materialId : "";
    if (!materialId) problems.push(`resolutions[${index}].materialId is required`);
    if (expected && materialId !== expected.id) {
      problems.push(`resolutions[${index}].materialId must be exact plan id ${expected.id}`);
    }
    const material = knownMaterials.get(materialId);
    if (!material) problems.push(`resolutions[${index}] references unknown material id ${materialId || "(empty)"}`);
    if (resolutionById.has(materialId)) problems.push(`material resolution ${materialId} is duplicated`);

    const citation = typeof record.citation === "string" ? record.citation : "";
    if (material && citation !== material.citation) {
      problems.push(`resolution ${materialId}.citation must exactly equal the extracted syllabus citation`);
    }
    const status = typeof record.status === "string" ? record.status : "";
    if (!MATERIAL_STATUSES.has(status as SyllabusMaterialStatus)) {
      problems.push(`resolution ${materialId || index}.status must be available, missing, or generic`);
    }
    if (!exactStringArray(record.sourceIds)) {
      problems.push(`resolution ${materialId || index}.sourceIds must be an array of exact source ids`);
    }
    const sourceIds = exactStringArray(record.sourceIds) ? record.sourceIds : [];
    for (const duplicate of duplicateStrings(sourceIds)) {
      problems.push(`resolution ${materialId || index}.sourceIds duplicates ${duplicate}`);
    }
    for (const sourceId of sourceIds) {
      if (!knownSources.has(sourceId)) {
        problems.push(`resolution ${materialId || index} references unknown source id ${sourceId}`);
      }
    }
    if (status === "available" && sourceIds.length === 0) {
      problems.push(`available material ${materialId || index} must select at least one exact source id`);
    }
    if ((status === "missing" || status === "generic") && sourceIds.length > 0) {
      problems.push(`${status} material ${materialId || index} must not select source ids`);
    }
    const matchReason = typeof record.matchReason === "string" ? record.matchReason : "";
    if (!matchReason.trim()) problems.push(`resolution ${materialId || index}.matchReason is required`);

    if (
      material &&
      MATERIAL_STATUSES.has(status as SyllabusMaterialStatus) &&
      exactStringArray(record.sourceIds) &&
      matchReason.trim()
    ) {
      resolutionById.set(materialId, {
        materialId,
        citation,
        status: status as SyllabusMaterialStatus,
        sourceIds: [...sourceIds],
        matchReason,
      });
    }
  });

  const seenUnitIds = new Set<string>();
  rawUnits.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      problems.push(`units[${index}] must be an object`);
      return;
    }
    const expected = plan.units[index];
    const unitId = typeof record.unitId === "string" ? record.unitId : "";
    if (!unitId) problems.push(`units[${index}].unitId is required`);
    if (expected && unitId !== expected.id) {
      problems.push(`units[${index}].unitId must be exact plan id ${expected.id}`);
    }
    const unit = plan.units.find((candidate) => candidate.id === unitId);
    if (!unit) problems.push(`units[${index}] references unknown syllabus unit id ${unitId || "(empty)"}`);
    if (seenUnitIds.has(unitId)) problems.push(`syllabus unit coverage ${unitId} is duplicated`);
    seenUnitIds.add(unitId);

    if (!exactStringArray(record.availableSourceIds)) {
      problems.push(`unit ${unitId || index}.availableSourceIds must be an array of exact source ids`);
    }
    const availableSourceIds = exactStringArray(record.availableSourceIds)
      ? record.availableSourceIds
      : [];
    for (const duplicate of duplicateStrings(availableSourceIds)) {
      problems.push(`unit ${unitId || index}.availableSourceIds duplicates ${duplicate}`);
    }
    for (const sourceId of availableSourceIds) {
      if (!knownSources.has(sourceId)) {
        problems.push(`unit ${unitId || index} references unknown source id ${sourceId}`);
      }
    }

    if (!exactStringArray(record.missingCitations)) {
      problems.push(`unit ${unitId || index}.missingCitations must be an array of exact citations`);
    }
    const missingCitations = exactStringArray(record.missingCitations)
      ? record.missingCitations
      : [];
    for (const duplicate of duplicateStrings(missingCitations)) {
      problems.push(`unit ${unitId || index}.missingCitations duplicates ${duplicate}`);
    }
    if (unit) {
      const expectedMissing = unit.materialIds.flatMap((materialId) => {
        const resolution = resolutionById.get(materialId);
        return resolution?.status === "missing" ? [resolution.citation] : [];
      });
      if (!sameStringsInOrder(missingCitations, expectedMissing)) {
        problems.push(
          `unit ${unitId}.missingCitations must exactly list, in syllabus order, its materials resolved as missing`,
        );
      }

      const assignedAvailableSources = new Set(unit.materialIds.flatMap((materialId) => {
        const resolution = resolutionById.get(materialId);
        return resolution?.status === "available" ? resolution.sourceIds : [];
      }));
      if (
        assignedAvailableSources.size > 0 &&
        !availableSourceIds.some((sourceId) => assignedAvailableSources.has(sourceId))
      ) {
        problems.push(
          `unit ${unitId}.availableSourceIds must include at least one source selected for its available assigned material`,
        );
      }
    }

    if (typeof record.teachable !== "boolean") {
      problems.push(`unit ${unitId || index}.teachable must be boolean`);
    } else if (record.teachable && availableSourceIds.length === 0) {
      problems.push(`teachable unit ${unitId || index} must select at least one exact supporting source id`);
    } else if (!record.teachable && availableSourceIds.length > 0) {
      problems.push(`unteachable unit ${unitId || index} must not select supporting source ids`);
    }
    if (typeof record.coverageReason !== "string" || !record.coverageReason.trim()) {
      problems.push(`unit ${unitId || index}.coverageReason is required`);
    }
  });

  return [...new Set(problems)];
}

/** Project a validated model decision into the persisted coverage shape. */
export function projectModelAuthoredSyllabusCoverage(
  plan: SyllabusPlan,
  value: unknown,
  knownSourceIds: readonly string[],
): SyllabusCoverage {
  const problems = syllabusCoverageDecisionProblems(value, plan, knownSourceIds);
  if (problems.length > 0) {
    throw new Error(`Invalid model-authored syllabus coverage: ${problems.join("; ")}`);
  }
  const decision = value as ModelAuthoredSyllabusCoverageDecision;
  const authoredUnits = new Map(decision.units.map((unit) => [unit.unitId, unit]));
  const units: SyllabusUnitCoverage[] = plan.units.map((unit) => {
    const authored = authoredUnits.get(unit.id)!;
    return {
      unitId: unit.id,
      label: unit.label,
      title: unit.title,
      objectives: [...unit.objectives],
      topics: [...unit.topics],
      availableSourceIds: [...authored.availableSourceIds],
      missingCitations: [...authored.missingCitations],
      teachable: authored.teachable,
      coverageReason: authored.coverageReason,
    };
  });
  const availableSourceIds = [...new Set(units.flatMap((unit) => unit.availableSourceIds))];
  return {
    courseTitle: plan.courseTitle,
    plan,
    resolutions: decision.resolutions.map((resolution) => ({
      materialId: resolution.materialId,
      citation: resolution.citation,
      status: resolution.status,
      sourceIds: [...resolution.sourceIds],
      matchReason: resolution.matchReason,
    })),
    units,
    availableSourceIds,
    missingCitations: decision.resolutions
      .filter((resolution) => resolution.status === "missing")
      .map((resolution) => resolution.citation),
    untaughtUnitTitles: units
      .filter((unit) => !unit.teachable)
      .map((unit) => `${unit.label ? `${unit.label}: ` : ""}${unit.title}`),
  };
}

// ---------------------------------------------------------------------------
// The anti-hallucination gate
// ---------------------------------------------------------------------------

export interface UnavailableCitationProbe {
  citation: string;
  pattern: RegExp;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Exact model-authored citation/title matcher. Layout whitespace may differ,
 * but punctuation and every authored word must remain present in order. */
function exactAuthoredPhrasePattern(value: string): RegExp {
  return new RegExp(
    value.trim().split(/\s+/).map(escapeRegExp).join("\\s+"),
    "i",
  );
}

/**
 * Build the probes that decide whether a page wrote about material the garden
 * does not have.
 *
 * This is an exact mechanical guard, not another material resolver. It checks
 * only the full citation and full optional title authored in the syllabus
 * contract. It never infers equivalence from keywords, authors, or years.
 */
export function unavailableCitationProbes(
  coverage: SyllabusCoverage | null,
): UnavailableCitationProbe[] {
  if (!coverage) return [];
  const missingIds = new Set(
    coverage.resolutions
      .filter((entry) => entry.status === "missing")
      .map((entry) => entry.materialId),
  );
  const probes: UnavailableCitationProbe[] = [];

  for (const material of coverage.plan.referencedMaterials) {
    if (!missingIds.has(material.id)) continue;
    probes.push({
      citation: material.citation,
      pattern: exactAuthoredPhrasePattern(material.citation),
    });

    // The exact optional title is also a verbatim authored identifier.
    if (material.title && material.title !== material.citation) {
      probes.push({ citation: material.citation, pattern: exactAuthoredPhrasePattern(material.title) });
    }
  }

  return probes;
}

/**
 * The citations a page names that the garden cannot support. A non-empty result
 * means the page is teaching from material nobody uploaded.
 */
export function detectUnavailableCitations(
  prose: string,
  probes: UnavailableCitationProbe[],
): string[] {
  if (probes.length === 0) return [];
  const normalized = prose.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const hits: string[] = [];
  for (const probe of probes) {
    if (probe.pattern.test(normalized) && !hits.includes(probe.citation)) {
      hits.push(probe.citation);
    }
  }
  return hits;
}

/** One-line summary for the Learn panel and the run event log. */
export function summarizeSyllabusCoverage(coverage: SyllabusCoverage): {
  unitCount: number;
  materialCount: number;
  availableCount: number;
  missingCount: number;
  genericCount: number;
} {
  return {
    unitCount: coverage.units.length,
    materialCount: coverage.resolutions.length,
    availableCount: coverage.resolutions.filter((entry) => entry.status === "available").length,
    missingCount: coverage.resolutions.filter((entry) => entry.status === "missing").length,
    genericCount: coverage.resolutions.filter((entry) => entry.status === "generic").length,
  };
}
