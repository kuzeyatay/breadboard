const ARTIFACT_CATALOG_REF = "#/extractedSourceArtifacts";

type PromptRecord = Record<string, unknown>;

export interface LearningSpinePromptArtifact extends PromptRecord {
  id: string;
  sourceId: string;
  kind: string;
}

export interface LearningSpinePlanningPacketInput {
  sourceOnly: boolean;
  syllabus: unknown;
  syllabusCoverage: unknown;
  sourceMap: unknown;
  scopeContract: unknown;
  sources: unknown;
  extractedSourceArtifacts: readonly LearningSpinePromptArtifact[];
  responseShape: string;
}

function promptRecord(value: unknown, label: string): PromptRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object before learning-spine projection.`);
  }
  return value as PromptRecord;
}

function exactArtifactId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    throw new Error(`${label} must contain an exact non-empty artifact id.`);
  }
  return value;
}

function sourceMapAnnotation(
  figure: PromptRecord,
  artifact: LearningSpinePromptArtifact,
): PromptRecord {
  const annotation: PromptRecord = {};
  for (const [key, value] of Object.entries(figure)) {
    if (key === "id" || key === "sourceId" || key === "kind") continue;
    // An identical value is already available on the canonical record. Keep
    // only genuinely distinct model-authored Source Map semantics here.
    if (key in artifact && Object.is(artifact[key], value)) continue;
    annotation[key] = value;
  }
  return annotation;
}

/**
 * Build the Learning Spine request packet with one canonical artifact catalog.
 *
 * Source Map has already passed its strict completeness/identity validator at
 * this boundary. This projection nevertheless fails closed if the two inputs
 * drift, then co-locates each Source Map artifact annotation with the matching
 * canonical record. Other packet semantics are copied without compaction.
 */
export function projectCanonicalLearningSpinePacket(
  input: LearningSpinePlanningPacketInput,
): PromptRecord {
  const sourceContext = promptRecord(input.sources, "Learning Spine sources");
  const sourceMap = promptRecord(input.sourceMap, "Learning Spine sourceMap");
  if (!Array.isArray(sourceMap.figures)) {
    throw new Error("Learning Spine sourceMap.figures must be a validated array before projection.");
  }

  const artifactById = new Map<string, LearningSpinePromptArtifact>();
  for (const [index, artifact] of input.extractedSourceArtifacts.entries()) {
    const id = exactArtifactId(artifact.id, `extractedSourceArtifacts[${index}]`);
    if (artifactById.has(id)) {
      throw new Error(`Canonical Learning Spine artifact ${id} appears more than once.`);
    }
    artifactById.set(id, artifact);
  }

  const annotationById = new Map<string, PromptRecord>();
  for (const [index, value] of sourceMap.figures.entries()) {
    const figure = promptRecord(value, `sourceMap.figures[${index}]`);
    const id = exactArtifactId(figure.id, `sourceMap.figures[${index}]`);
    const artifact = artifactById.get(id);
    if (!artifact) {
      throw new Error(`Source Map artifact ${id} is absent from the canonical Learning Spine catalog.`);
    }
    if (annotationById.has(id)) {
      throw new Error(`Source Map artifact ${id} appears more than once.`);
    }
    if (figure.sourceId !== artifact.sourceId || figure.kind !== artifact.kind) {
      throw new Error(`Source Map artifact ${id} does not match its canonical sourceId and kind.`);
    }
    annotationById.set(id, sourceMapAnnotation(figure, artifact));
  }

  for (const id of artifactById.keys()) {
    if (!annotationById.has(id)) {
      throw new Error(`Canonical Learning Spine artifact ${id} is missing from the validated Source Map.`);
    }
  }

  const semanticSources = { ...sourceContext };
  delete semanticSources.sourceVisuals;
  delete semanticSources.sourceFigures;
  const semanticSourceMap = { ...sourceMap };
  delete semanticSourceMap.figures;

  return {
    sourceOnly: input.sourceOnly,
    syllabus: input.syllabus,
    syllabusCoverage: input.syllabusCoverage,
    sourceMap: {
      ...semanticSourceMap,
      sourceArtifactCatalogRef: ARTIFACT_CATALOG_REF,
    },
    scopeContract: input.scopeContract,
    sources: {
      ...semanticSources,
      sourceArtifactCatalogRef: ARTIFACT_CATALOG_REF,
    },
    extractedSourceArtifacts: input.extractedSourceArtifacts.map((artifact) => {
      const annotation = annotationById.get(artifact.id) ?? {};
      return {
        ...artifact,
        ...(Object.keys(annotation).length > 0
          ? { sourceMapAnnotation: annotation }
          : {}),
      };
    }),
    responseShape: input.responseShape,
  };
}

export const LEARNING_SPINE_ARTIFACT_CATALOG_REF = ARTIFACT_CATALOG_REF;
