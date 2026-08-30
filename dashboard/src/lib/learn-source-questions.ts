/**
 * Source-authored questions that must survive Learn planning and reach the
 * learner page that teaches their underlying concept.
 *
 * The Source Map authors the semantic mapping. Code only exposes exact source
 * evidence, validates identities/cardinality, and projects the accepted
 * records into page dossiers.
 */

export type SourceQuestionPlacement =
  | "inside_worked_example"
  | "guided_practice"
  | "end_of_page_check";

export const SOURCE_QUESTION_PLACEMENTS: readonly SourceQuestionPlacement[] = [
  "inside_worked_example",
  "guided_practice",
  "end_of_page_check",
];

export interface SourceQuestionContract {
  id: string;
  placement: SourceQuestionPlacement;
  teachingGoal: string;
}

export interface SourceQuestionSyllabusAssignment {
  unitId: string;
  reference: string;
}

export interface SourceQuestionPlan {
  id: string;
  sourceId: string;
  label: string;
  /** Verbatim prompt copied from the selected source. */
  prompt: string;
  sourceAnchorIds: string[];
  relatedFigureIds: string[];
  syllabusAssignments: SourceQuestionSyllabusAssignment[];
  teachingValue: string;
}

export interface UnresolvedSyllabusQuestionReference {
  unitId: string;
  reference: string;
  reason: string;
}

export interface SourceQuestionEvidenceRecord {
  anchorId: string;
  sourceId: string;
  page: number;
  title: string;
  exactText: string;
  relatedFigureIds: string[];
  syllabusAssignments: SourceQuestionSyllabusAssignment[];
}

interface SourceQuestionAnchorInput {
  id: string;
  sourceId: string;
  page: number;
  title: string;
  exactText: string;
}

interface SourceQuestionFigureInput {
  figureId: string;
  sourceId?: string;
  page?: number;
  kind?: string;
  caption?: string;
}

interface SourceQuestionSyllabusUnitInput {
  id: string;
  questionReferences?: readonly string[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function exactStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(
    (entry) => typeof entry === "string" && entry.length > 0 && entry.trim() === entry,
  );
}

function normalizedEvidenceText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expandedReferenceRange(left: string, right: string): string[] {
  const parsedLeft = /^([A-Za-z]?)(\d+(?:\.\d+)*)$/.exec(left);
  const parsedRight = /^([A-Za-z]?)(\d+(?:\.\d+)*)$/.exec(right);
  if (!parsedLeft || !parsedRight) return [];
  const prefix = parsedLeft[1]!;
  if (parsedRight[1] && parsedRight[1].toLowerCase() !== prefix.toLowerCase()) return [];
  const leftParts = parsedLeft[2]!.split(".");
  let rightParts = parsedRight[2]!.split(".");
  if (rightParts.length === 1 && leftParts.length > 1) {
    rightParts = [...leftParts.slice(0, -1), rightParts[0]!];
  }
  if (
    leftParts.length !== rightParts.length ||
    leftParts.slice(0, -1).some((part, index) => part !== rightParts[index])
  ) return [];
  const start = Number(leftParts.at(-1));
  const end = Number(rightParts.at(-1));
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || end - start > 100) return [];
  const stem = leftParts.slice(0, -1);
  return Array.from({ length: end - start + 1 }, (_, index) =>
    `${prefix}${[...stem, String(start + index)].join(".")}`,
  );
}

/** Exact problem-like identifiers mentioned by a figure caption. */
export function sourceQuestionReferencesFromCaption(caption: string | undefined): string[] {
  const text = caption?.trim() ?? "";
  if (!text) return [];
  const references: string[] = [];
  const mention = /\b(problem|question|exercise|drill)s?\s+([^\n]+)/gi;
  for (const match of text.matchAll(mention)) {
    const kind = `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1).toLowerCase()}`;
    const identifiers = [...match[2]!.matchAll(
      /(?:^|,\s*|\band\s+|&\s*|\/\s*)([A-Za-z]?\d+(?:\.\d+)*)\b/gi,
    )].map((identifier) => identifier[1]!);
    for (const identifier of identifiers) references.push(`${kind} ${identifier}`);
  }
  return [...new Set(references)];
}

function referenceTokens(reference: string): string[] {
  const identifiers = reference.match(/\b[A-Za-z]?\d+(?:\.\d+)*\b/g) ?? [];
  const expanded = [...reference.matchAll(
    /\b([A-Za-z]?\d+(?:\.\d+)*)\s*(?:-|–|—|\bto\b)\s*([A-Za-z]?\d+(?:\.\d+)*)\b/gi,
  )].flatMap((match) => expandedReferenceRange(match[1]!, match[2]!));
  const tokens = [...new Set([...identifiers, ...expanded])];
  return tokens.length > 0 ? tokens : [reference];
}

function questionMatchesReference(question: Record<string, unknown>, reference: string): boolean {
  const text = `${typeof question.label === "string" ? question.label : ""}\n${
    typeof question.prompt === "string" ? question.prompt : ""
  }`;
  return referenceTokens(reference).some((token) =>
    new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(token)}(?=$|[^A-Za-z0-9])`, "i").test(text),
  );
}

function anchorContainsQuestionReference(anchorText: string, reference: string): boolean {
  return referenceTokens(reference).some((token) => {
    const escaped = escapeRegExp(token);
    return new RegExp(
      `(?:^|\\n)[ \\t]*(?:(?:problem|question|exercise|drill)[ \\t]+)?${escaped}(?=[ \\t\\r\\n]|$)`,
      "i",
    ).test(anchorText);
  });
}

/**
 * Expose complete source pages that are candidates for a figure-linked or
 * syllabus-assigned question. Selection is identity-based only: the planning
 * model still decides whether the evidence is a question and where it belongs.
 */
export function buildSourceQuestionEvidenceCatalog(input: {
  anchors: readonly SourceQuestionAnchorInput[];
  figures: readonly SourceQuestionFigureInput[];
  syllabusUnits?: readonly SourceQuestionSyllabusUnitInput[];
}): SourceQuestionEvidenceRecord[] {
  const evidence = new Map<string, SourceQuestionEvidenceRecord>();
  const add = (
    anchor: SourceQuestionAnchorInput,
    figureId?: string,
    syllabusAssignment?: SourceQuestionSyllabusAssignment,
  ) => {
    const current = evidence.get(anchor.id) ?? {
      anchorId: anchor.id,
      sourceId: anchor.sourceId,
      page: anchor.page,
      title: anchor.title,
      exactText: anchor.exactText,
      relatedFigureIds: [],
      syllabusAssignments: [],
    };
    if (figureId && !current.relatedFigureIds.includes(figureId)) {
      current.relatedFigureIds.push(figureId);
    }
    if (
      syllabusAssignment &&
      !current.syllabusAssignments.some(
        (assignment) =>
          assignment.unitId === syllabusAssignment.unitId &&
          assignment.reference === syllabusAssignment.reference,
      )
    ) {
      current.syllabusAssignments.push(syllabusAssignment);
    }
    evidence.set(anchor.id, current);
  };

  for (const figure of input.figures) {
    if (!figure.figureId || !figure.sourceId) continue;
    const references = sourceQuestionReferencesFromCaption(figure.caption);
    if (references.length === 0) continue;
    let matched = false;
    for (const anchor of input.anchors) {
      if (anchor.sourceId !== figure.sourceId) continue;
      if (!references.some((reference) => anchorContainsQuestionReference(anchor.exactText, reference))) {
        continue;
      }
      add(anchor, figure.figureId);
      matched = true;
    }
    // OCR can put a question label on an adjacent page while the figure
    // caption is on its own page. Those exact neighboring pages are useful
    // bounded evidence even when the label itself was not recognized.
    if (!matched && Number.isFinite(Number(figure.page))) {
      for (const anchor of input.anchors) {
        if (
          anchor.sourceId === figure.sourceId &&
          Math.abs(anchor.page - Number(figure.page)) <= 1
        ) {
          add(anchor, figure.figureId);
        }
      }
    }
  }

  for (const unit of input.syllabusUnits ?? []) {
    for (const reference of unit.questionReferences ?? []) {
      const assignment = { unitId: unit.id, reference };
      for (const anchor of input.anchors) {
        if (anchorContainsQuestionReference(anchor.exactText, reference)) {
          add(anchor, undefined, assignment);
        }
      }
    }
  }

  return [...evidence.values()].sort(
    (left, right) =>
      left.sourceId.localeCompare(right.sourceId) ||
      left.page - right.page ||
      left.anchorId.localeCompare(right.anchorId),
  );
}

export function projectSourceQuestions(value: unknown): SourceQuestionPlan[] {
  const root = record(value);
  const raw = Array.isArray(root.sourceQuestions) ? root.sourceQuestions : [];
  return raw.flatMap((entry) => {
    const question = record(entry);
    if (
      typeof question.id !== "string" ||
      typeof question.sourceId !== "string" ||
      typeof question.label !== "string" ||
      typeof question.prompt !== "string" ||
      !exactStringArray(question.sourceAnchorIds) ||
      !exactStringArray(question.relatedFigureIds) ||
      !Array.isArray(question.syllabusAssignments) ||
      typeof question.teachingValue !== "string"
    ) return [];
    const syllabusAssignments = question.syllabusAssignments.flatMap((entry) => {
      const assignment = record(entry);
      return typeof assignment.unitId === "string" && typeof assignment.reference === "string"
        ? [{ unitId: assignment.unitId, reference: assignment.reference }]
        : [];
    });
    return [{
      id: question.id,
      sourceId: question.sourceId,
      label: question.label,
      prompt: question.prompt,
      sourceAnchorIds: [...question.sourceAnchorIds],
      relatedFigureIds: [...question.relatedFigureIds],
      syllabusAssignments,
      teachingValue: question.teachingValue,
    }];
  });
}

/** Strict Source Map boundary for the source-question registry. */
export function sourceQuestionPlanProblems(input: {
  value: unknown;
  sourceIds: readonly string[];
  sourceBodies: readonly { sourceId: string; body: string }[];
  canonicalAnchors: readonly { id: string; sourceId: string }[];
  registeredFigures: readonly SourceQuestionFigureInput[];
  syllabusUnits?: readonly SourceQuestionSyllabusUnitInput[];
}): string[] {
  const root = record(input.value);
  const problems: string[] = [];
  if (!Array.isArray(root.sourceQuestions)) problems.push("sourceQuestions must be an array");
  if (!Array.isArray(root.unresolvedSyllabusQuestionReferences)) {
    problems.push("unresolvedSyllabusQuestionReferences must be an array");
  }
  const sourceIds = new Set(input.sourceIds);
  const sourceBodyById = new Map(input.sourceBodies.map((source) => [source.sourceId, source.body]));
  const anchorById = new Map(input.canonicalAnchors.map((anchor) => [anchor.id, anchor]));
  const figureById = new Map(input.registeredFigures.map((figure) => [figure.figureId, figure]));
  const expectedSyllabusAssignments = new Set(
    (input.syllabusUnits ?? []).flatMap((unit) =>
      (unit.questionReferences ?? []).map((reference) => JSON.stringify([unit.id, reference])),
    ),
  );
  const seenQuestionIds = new Set<string>();
  const seenFigureIds = new Map<string, string[]>();
  const matchedFigureReferences = new Map<string, Set<string>>();
  const seenSyllabusAssignments = new Map<string, string[]>();

  const rawQuestions = Array.isArray(root.sourceQuestions) ? root.sourceQuestions : [];
  rawQuestions.forEach((entry, index) => {
    const question = record(entry);
    const at = `sourceQuestions[${index}]`;
    const id = typeof question.id === "string" ? question.id : "";
    if (!id || id.trim() !== id || !/^[A-Za-z0-9_.-]+$/.test(id)) {
      problems.push(`${at}.id must be an exact canonical identifier`);
    } else if (seenQuestionIds.has(id)) {
      problems.push(`${at}.id duplicates source question ${id}`);
    } else seenQuestionIds.add(id);
    const sourceId = typeof question.sourceId === "string" ? question.sourceId : "";
    if (!sourceIds.has(sourceId)) problems.push(`${at}.sourceId must be an exact supplied source id`);
    for (const field of ["label", "prompt", "teachingValue"] as const) {
      if (typeof question[field] !== "string" || !question[field].trim()) {
        problems.push(`${at}.${field} must be a non-empty string`);
      }
    }
    if (typeof question.prompt === "string" && sourceId) {
      const body = normalizedEvidenceText(sourceBodyById.get(sourceId) ?? "");
      const prompt = normalizedEvidenceText(question.prompt);
      if (prompt && !body.includes(prompt)) {
        problems.push(`${at}.prompt must be copied verbatim from source ${sourceId}`);
      }
    }
    if (!exactStringArray(question.sourceAnchorIds) || question.sourceAnchorIds.length === 0) {
      problems.push(`${at}.sourceAnchorIds must be a non-empty array of exact canonical anchor ids`);
    } else {
      for (const anchorId of question.sourceAnchorIds) {
        const anchor = anchorById.get(anchorId);
        if (!anchor) problems.push(`${at}.sourceAnchorIds references unknown anchor ${anchorId}`);
        else if (anchor.sourceId !== sourceId) {
          problems.push(`${at}.sourceAnchorIds anchor ${anchorId} belongs to another source`);
        }
      }
    }
    if (!exactStringArray(question.relatedFigureIds)) {
      problems.push(`${at}.relatedFigureIds must be an array of exact registered figure ids`);
    } else {
      for (const figureId of question.relatedFigureIds) {
        const figure = figureById.get(figureId);
        if (!figure) problems.push(`${at}.relatedFigureIds references unknown figure ${figureId}`);
        else {
          if (figure.sourceId !== sourceId) {
            problems.push(`${at}.relatedFigureIds figure ${figureId} belongs to another source`);
          }
          const owners = seenFigureIds.get(figureId) ?? [];
          owners.push(id || at);
          seenFigureIds.set(figureId, owners);
          const matchedReferences = matchedFigureReferences.get(figureId) ?? new Set<string>();
          for (const reference of sourceQuestionReferencesFromCaption(figure.caption)) {
            if (questionMatchesReference(question, reference)) matchedReferences.add(reference);
          }
          matchedFigureReferences.set(figureId, matchedReferences);
        }
      }
    }
    if (!Array.isArray(question.syllabusAssignments)) {
      problems.push(`${at}.syllabusAssignments must be an array`);
    } else {
      question.syllabusAssignments.forEach((rawAssignment, assignmentIndex) => {
        const assignment = record(rawAssignment);
        const unitId = typeof assignment.unitId === "string" ? assignment.unitId : "";
        const reference = typeof assignment.reference === "string" ? assignment.reference : "";
        const key = JSON.stringify([unitId, reference]);
        if (!unitId || !reference || !expectedSyllabusAssignments.has(key)) {
          problems.push(`${at}.syllabusAssignments[${assignmentIndex}] must copy an exact syllabus unit/reference pair`);
          return;
        }
        if (!questionMatchesReference(question, reference)) {
          problems.push(
            `${at}.syllabusAssignments[${assignmentIndex}] does not match the question identifier in ${reference}`,
          );
        }
        const owners = seenSyllabusAssignments.get(key) ?? [];
        owners.push(id || at);
        seenSyllabusAssignments.set(key, owners);
      });
    }
  });

  const rawUnresolved = Array.isArray(root.unresolvedSyllabusQuestionReferences)
    ? root.unresolvedSyllabusQuestionReferences
    : [];
  rawUnresolved.forEach((entry, index) => {
    const unresolved = record(entry);
    const unitId = typeof unresolved.unitId === "string" ? unresolved.unitId : "";
    const reference = typeof unresolved.reference === "string" ? unresolved.reference : "";
    const key = JSON.stringify([unitId, reference]);
    if (!unitId || !reference || !expectedSyllabusAssignments.has(key)) {
      problems.push(`unresolvedSyllabusQuestionReferences[${index}] must copy an exact syllabus unit/reference pair`);
    } else {
      const owners = seenSyllabusAssignments.get(key) ?? [];
      owners.push(`unresolved[${index}]`);
      seenSyllabusAssignments.set(key, owners);
    }
    if (typeof unresolved.reason !== "string" || !unresolved.reason.trim()) {
      problems.push(`unresolvedSyllabusQuestionReferences[${index}].reason is required`);
    }
  });

  for (const figure of input.registeredFigures) {
    const references = sourceQuestionReferencesFromCaption(figure.caption);
    if (references.length === 0) continue;
    const owners = seenFigureIds.get(figure.figureId) ?? [];
    if (owners.length === 0) {
      problems.push(
        `question-linked source figure ${figure.figureId} must belong to at least one sourceQuestions record`,
      );
    }
    const matchedReferences = matchedFigureReferences.get(figure.figureId) ?? new Set<string>();
    for (const reference of references) {
      if (!matchedReferences.has(reference)) {
        problems.push(
          `question-linked source figure ${figure.figureId} names ${reference}, but no linked source question matches that reference`,
        );
      }
    }
  }
  for (const assignment of expectedSyllabusAssignments) {
    const owners = seenSyllabusAssignments.get(assignment) ?? [];
    const mappedQuestions = owners.filter((owner) => !owner.startsWith("unresolved["));
    const unresolved = owners.filter((owner) => owner.startsWith("unresolved["));
    const valid =
      (mappedQuestions.length > 0 && unresolved.length === 0) ||
      (mappedQuestions.length === 0 && unresolved.length === 1);
    if (!valid) {
      const [unitId, reference] = JSON.parse(assignment) as [string, string];
      problems.push(
        `syllabus question reference ${unitId} / ${reference} must map to one or more source questions or one unresolved record, never both`,
      );
    }
  }
  return [...new Set(problems)];
}

/** Validate the model-authored question-to-learning-unit projection. */
export function sourceQuestionAssignmentProblems(
  units: readonly {
    id: string;
    sourceAnchors: readonly string[];
    sourceFigures: readonly { id: string }[];
    syllabusUnitIds?: readonly string[];
    sourceQuestions?: readonly SourceQuestionContract[];
  }[],
  questions: readonly SourceQuestionPlan[],
): string[] {
  const problems: string[] = [];
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const owners = new Map<string, string[]>();
  for (const unit of units) {
    const unitAnchors = new Set(unit.sourceAnchors);
    const unitFigures = new Set(unit.sourceFigures.map((figure) => figure.id));
    const unitSyllabusIds = new Set(unit.syllabusUnitIds ?? []);
    for (const contract of unit.sourceQuestions ?? []) {
      const question = questionById.get(contract.id);
      if (!question) {
        problems.push(`unit "${unit.id}": source question ${contract.id} is not in the validated Source Map registry`);
        continue;
      }
      const currentOwners = owners.get(contract.id) ?? [];
      currentOwners.push(unit.id);
      owners.set(contract.id, currentOwners);
      for (const anchorId of question.sourceAnchorIds) {
        if (!unitAnchors.has(anchorId)) {
          problems.push(`unit "${unit.id}": source question ${question.id} requires source anchor ${anchorId}`);
        }
      }
      for (const figureId of question.relatedFigureIds) {
        if (!unitFigures.has(figureId)) {
          problems.push(`unit "${unit.id}": source question ${question.id} must own its related figure ${figureId}`);
        }
      }
      for (const assignment of question.syllabusAssignments) {
        if (!unitSyllabusIds.has(assignment.unitId)) {
          problems.push(
            `unit "${unit.id}": source question ${question.id} must stay mapped to syllabus unit ${assignment.unitId}`,
          );
        }
      }
    }
  }
  for (const question of questions) {
    const questionOwners = owners.get(question.id) ?? [];
    if (questionOwners.length !== 1) {
      problems.push(
        `source question "${question.id}" must be assigned to exactly one learning unit; found ${questionOwners.join(", ") || "none"}`,
      );
    }
  }
  return [...new Set(problems)];
}
