import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import {
  normalizeLearningUnits,
  projectModelAuthoredSourceArtifactOmissions,
  type LearningUnitContract,
  type SourceArtifactOmission,
} from "./learning-unit-contract.ts";
import { stripMarkdownFrontmatter } from "./learn-utils.ts";

export interface IncrementalLearnBaseline {
  learningUnits: LearningUnitContract[];
  sourceArtifactOmissions: SourceArtifactOmission[];
}

export interface PublishedLearningPage {
  learningUnitId: string;
  relPath: string;
  body: string;
}

/**
 * Visual routing is a later, whole-garden planning stage.  The learning-spine
 * update freezes the semantic/source contract of an existing unit, then lets
 * that later stage re-evaluate only its presentation contract in the context
 * of the newly enlarged garden.
 */
export function semanticLearningUnitForIncrementalUpdate(
  unit: LearningUnitContract,
): LearningUnitContract {
  const semanticUnit = structuredClone(unit);
  delete semanticUnit.interactiveVisual;
  delete semanticUnit.interactiveVisualPlan;
  delete semanticUnit.teachingMediumPlan;
  return semanticUnit;
}

export function readIncrementalLearnBaseline(
  gardenDir: string,
): IncrementalLearnBaseline | null {
  const contractPath = path.join(
    gardenDir,
    ".breadboard",
    "learning-unit-contract.json",
  );
  if (!fs.existsSync(contractPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(contractPath, "utf8")) as unknown;
    const learningUnits = normalizeLearningUnits(parsed, {
      modelAuthoredOnly: true,
    }).map(semanticLearningUnitForIncrementalUpdate);
    if (learningUnits.length === 0) return null;
    return {
      learningUnits,
      sourceArtifactOmissions:
        projectModelAuthoredSourceArtifactOmissions(parsed),
    };
  } catch {
    return null;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function stableUnit(unit: LearningUnitContract): string {
  return stableJson(semanticLearningUnitForIncrementalUpdate(unit));
}

/**
 * Existing units are immutable during an additive Learn run.  New units may be
 * inserted anywhere, but the prior units must remain byte-equivalent at the
 * normalized contract level and retain their relative order.
 */
export function incrementalLearningUnitPreservationProblems(
  candidateUnits: readonly LearningUnitContract[],
  baselineUnits: readonly LearningUnitContract[],
): string[] {
  if (baselineUnits.length === 0) return [];
  const problems: string[] = [];
  const candidateById = new Map(
    candidateUnits.map((unit, index) => [unit.id, { unit, index }]),
  );
  let previousIndex = -1;
  for (const baseline of baselineUnits) {
    const candidate = candidateById.get(baseline.id);
    if (!candidate) {
      problems.push(
        `existing unit "${baseline.id}" was removed; additive Learn updates must retain every existing unit`,
      );
      continue;
    }
    if (candidate.index <= previousIndex) {
      problems.push(
        `existing unit "${baseline.id}" changed relative order; new units may be inserted but existing units must stay ordered`,
      );
    }
    previousIndex = Math.max(previousIndex, candidate.index);
    if (stableUnit(candidate.unit) !== stableUnit(baseline)) {
      problems.push(
        `existing unit "${baseline.id}" changed; copy its supplied existingCurriculum record exactly and express new material in new units`,
      );
    }
  }
  return problems;
}

function records(value: unknown, key: string): Record<string, unknown>[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const list = (value as Record<string, unknown>)[key];
  return Array.isArray(list)
    ? list.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item && typeof item === "object" && !Array.isArray(item)),
      )
    : [];
}

function namedRecordPreservationProblems({
  candidateSourceMap,
  baselineSourceMap,
  key,
  recordLabel,
}: {
  candidateSourceMap: unknown;
  baselineSourceMap: unknown;
  key: "sourceAnchors" | "sourceQuestions";
  recordLabel: string;
}): string[] {
  const baseline = records(baselineSourceMap, key);
  if (baseline.length === 0) return [];
  const candidate = records(candidateSourceMap, key);
  const candidateById = new Map(
    candidate.map((record, index) => [String(record.id ?? ""), {
      record,
      index,
    }]),
  );
  const problems: string[] = [];
  let previousIndex = -1;
  for (const record of baseline) {
    const id = String(record.id ?? "").trim();
    if (!id) continue;
    const next = candidateById.get(id);
    if (!next) {
      problems.push(`existing ${recordLabel} "${id}" was removed`);
      continue;
    }
    if (next.index <= previousIndex) {
      problems.push(`existing ${recordLabel} "${id}" changed relative order`);
    }
    previousIndex = Math.max(previousIndex, next.index);
    if (stableJson(next.record) !== stableJson(record)) {
      problems.push(`existing ${recordLabel} "${id}" changed`);
    }
  }
  return problems.map(
    (problem) =>
      `${problem}; additive Learn must copy existingSourceMap.${key} exactly and add new records with new ids`,
  );
}

/** Source-anchor and question ids are referenced by existing unit contracts and
 * therefore form part of the stable additive-update identity. */
export function incrementalSourceMapPreservationProblems(
  candidateSourceMap: unknown,
  baselineSourceMap: unknown,
): string[] {
  return [
    ...namedRecordPreservationProblems({
      candidateSourceMap,
      baselineSourceMap,
      key: "sourceAnchors",
      recordLabel: "source anchor",
    }),
    ...namedRecordPreservationProblems({
      candidateSourceMap,
      baselineSourceMap,
      key: "sourceQuestions",
      recordLabel: "source question",
    }),
  ];
}

export function incrementalSourceQuestionPreservationProblems(
  candidateSourceMap: unknown,
  baselineSourceMap: unknown,
): string[] {
  return namedRecordPreservationProblems({
    candidateSourceMap,
    baselineSourceMap,
    key: "sourceQuestions",
    recordLabel: "source question",
  });
}

function frontmatterScalar(markdown: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(
    new RegExp(`^${escaped}\\s*:\\s*(.+?)\\s*$`, "mi"),
  );
  if (!match) return "";
  const raw = match[1].trim();
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "string" ? parsed.trim() : "";
    } catch {
      return "";
    }
  }
  return raw.replace(/^['"]|['"]$/g, "").trim();
}

/** Read the currently published lesson body for each stable learning-unit id. */
export function publishedLearningPagesByUnitId(
  gardenDir: string,
): Map<string, PublishedLearningPage> {
  const learningDir = path.join(gardenDir, "learning");
  const pages = new Map<string, PublishedLearningPage>();
  if (!fs.existsSync(learningDir)) return pages;

  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
        continue;
      }
      const markdown = fs.readFileSync(absolute, "utf8");
      const learningUnitId =
        frontmatterScalar(markdown, "learningUnitId") ||
        frontmatterScalar(markdown, "generatedFromUnitId");
      if (!learningUnitId) continue;
      if (pages.has(learningUnitId)) {
        throw new Error(
          `Published Learn content contains more than one page for learning unit ${learningUnitId}; repair the garden before adding material.`,
        );
      }
      pages.set(learningUnitId, {
        learningUnitId,
        relPath: path.relative(gardenDir, absolute).replace(/\\/g, "/"),
        body: stripMarkdownFrontmatter(markdown).trim(),
      });
    }
  };
  visit(learningDir);
  return pages;
}
