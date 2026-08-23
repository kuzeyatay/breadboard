import { createHash } from "node:crypto";

import type {
  SourceVisual,
  SourceVisualBBox,
  SourceVisualSourceIdentity,
} from "@/lib/source-visuals";

/**
 * The exact selected-source visual projection that a Source Map is allowed to
 * reason about.  This is deliberately a structural inventory, not an
 * interpretation of a figure: model-authored prompts decide relevance and
 * pedagogy while this helper only detects whether their supplied registry
 * changed underneath an already-authored map.
 */
export interface SelectedSourceArtifactInventorySnapshot {
  schemaVersion: 1;
  selectedSourceIds: string[];
  sourceIdentityMapHash: string;
  artifacts: CanonicalSelectedSourceArtifact[];
  sourceArtifactInventoryHash: string;
}

export interface CanonicalSelectedSourceArtifact {
  sourceVisualId: string;
  sourceId: string;
  sourceIndex: number;
  pageNumber: number;
  type: SourceVisual["type"];
  caption: string;
  exactText: string | null;
  bbox: SourceVisualBBox | null;
  croppedImagePath: string | null;
  pageImagePath: string | null;
}

/** The deliberately small artifact taxonomy used by Source Map contracts.
 * Detector labels remain in the source-visual ledger; this helper only
 * projects them into the planner's registered-artifact contract. */
export type SourceMapArtifactKind = "figure" | "graph" | "table" | "formula";

export type SourceMapArtifactInputKind =
  | "figure"
  | "graph"
  | "table"
  | "equation"
  | "diagram"
  | "photo"
  | "formula"
  | "unknown";

export function sourceMapArtifactKind(
  kind: SourceMapArtifactInputKind,
): SourceMapArtifactKind {
  if (kind === "table") return "table";
  if (kind === "equation" || kind === "formula") return "formula";
  if (kind === "graph") return "graph";
  return "figure";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalBBox(value: SourceVisual["bbox"]): SourceVisualBBox | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object") {
    throw new Error("Selected source artifact has an invalid bbox.");
  }
  const fields: Array<keyof SourceVisualBBox> = ["x", "y", "width", "height"];
  for (const field of fields) {
    if (!Number.isFinite(value[field])) {
      throw new Error(`Selected source artifact has a non-finite bbox ${field}.`);
    }
  }
  if (
    value.x < 0 || value.y < 0 || value.x > 1 || value.y > 1 ||
    value.width <= 0 || value.height <= 0 || value.width > 1 || value.height > 1 ||
    value.x + value.width > 1 || value.y + value.height > 1
  ) {
    throw new Error("Selected source artifact has a bbox outside the normalized page bounds.");
  }
  return {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  };
}

interface CanonicalSourceIdentityMap {
  selectedIdentities: SourceVisualSourceIdentity[];
  identityByIndex: Map<number, SourceVisualSourceIdentity>;
}

function canonicalSourceIdentityMap(
  selectedSourceIds: readonly string[],
  sourceIdentityMap: readonly SourceVisualSourceIdentity[],
): CanonicalSourceIdentityMap {
  const selected = [...selectedSourceIds];
  const selectedSet = new Set<string>();
  for (const sourceId of selected) {
    if (!sourceId || sourceId.trim() !== sourceId || selectedSet.has(sourceId)) {
      throw new Error("Selected source artifact inventory requires unique exact selected source ids.");
    }
    selectedSet.add(sourceId);
  }

  const identityBySource = new Map<string, SourceVisualSourceIdentity>();
  const seenIndexes = new Set<number>();
  for (const identity of sourceIdentityMap) {
    const sourceId = typeof identity?.sourceId === "string" ? identity.sourceId : "";
    const sourceIndex = Number(identity?.sourceIndex);
    if (
      !sourceId || sourceId.trim() !== sourceId ||
      !Number.isSafeInteger(sourceIndex) || sourceIndex < 1
    ) {
      throw new Error("Selected source artifact inventory has an invalid source identity entry.");
    }
    if (identityBySource.has(sourceId) || seenIndexes.has(sourceIndex)) {
      throw new Error("Selected source artifact inventory has duplicate/conflicting source identities.");
    }
    identityBySource.set(sourceId, { sourceId, sourceIndex });
    seenIndexes.add(sourceIndex);
  }

  const selectedIdentities = selected.map((sourceId) => {
    const identity = identityBySource.get(sourceId);
    if (!identity) {
      throw new Error(`Selected source artifact inventory has no stable identity for "${sourceId}".`);
    }
    return identity;
  });
  return {
    selectedIdentities: selectedIdentities.sort((left, right) =>
      left.sourceIndex - right.sourceIndex || compareCanonicalStrings(left.sourceId, right.sourceId)),
    identityByIndex: new Map(
      [...identityBySource.values()].map((identity) => [identity.sourceIndex, identity]),
    ),
  };
}

/**
 * Build a versioned, canonical snapshot of every selected, registered source
 * artifact that the Source Map sees. Full-page fallback records are renderer
 * transport, not planner artifacts, and are intentionally excluded.
 *
 * This helper never chooses, matches, remaps, or repairs artifacts. Duplicate
 * ids and provenance conflicts fail closed rather than allowing a stale map to
 * be treated as grounded in an ambiguous registry.
 */
export function selectedSourceArtifactInventorySnapshot(input: {
  selectedSourceIds: readonly string[];
  sourceIdentityMap: readonly SourceVisualSourceIdentity[];
  visuals: readonly SourceVisual[];
}): SelectedSourceArtifactInventorySnapshot {
  const identities = canonicalSourceIdentityMap(
    input.selectedSourceIds,
    input.sourceIdentityMap,
  );
  const selectedIdentities = identities.selectedIdentities;
  // The input source selection may arrive in a presentation order. The
  // inventory is authority data, so its source set is ordered by immutable
  // S<n> identity rather than by that incidental caller order.
  const selectedSourceIds = selectedIdentities.map((identity) => identity.sourceId);
  const selectedIdentityBySource = new Map(
    selectedIdentities.map((identity) => [identity.sourceId, identity]),
  );
  const artifactsById = new Map<string, CanonicalSelectedSourceArtifact>();

  for (const rawVisual of input.visuals) {
    const visual = rawVisual as Partial<SourceVisual>;
    const rawSourceId = typeof visual.sourceId === "string" ? visual.sourceId : "";
    const normalizedSourceId = rawSourceId.trim();
    const visualId = typeof visual.sourceVisualId === "string" ? visual.sourceVisualId : "";
    const indexedSource = /^S([1-9]\d*)\.P[1-9]\d*\.[A-Z][1-9]\d*$/.exec(visualId)?.[1];
    const indexedIdentity = indexedSource
      ? identities.identityByIndex.get(Number(indexedSource))
      : undefined;

    // The durable source index is the ownership authority even for rows that
    // will be omitted from this selected-source snapshot. Without this check,
    // a selected S<n> row could be hidden merely by changing sourceId to an
    // unselected source before the filtering below.
    if (indexedSource) {
      if (!indexedIdentity || rawSourceId !== indexedIdentity.sourceId) {
        throw new Error("Selected source artifact inventory has a source/index ownership conflict.");
      }
    }

    const identity = selectedIdentityBySource.get(rawSourceId);
    if (!identity) {
      if (normalizedSourceId && selectedIdentityBySource.has(normalizedSourceId)) {
        throw new Error("Selected source artifact inventory has a source id with surrounding whitespace.");
      }
      // A structurally valid row owned by a known unselected source is outside
      // this planner snapshot. All selected or malformed structured rows have
      // already failed above rather than being silently filtered out.
      continue;
    }
    const allowedTypes = new Set<SourceVisual["type"]>([
      "figure",
      "graph",
      "table",
      "equation",
      "diagram",
      "full_page_fallback",
    ]);
    if (!allowedTypes.has(visual.type as SourceVisual["type"])) {
      throw new Error("Selected source artifact inventory has an unknown artifact type.");
    }
    if (visual.type === "full_page_fallback") continue;
    if (typeof visual.sourceVisualId !== "string" || !visual.sourceVisualId || visual.sourceVisualId.trim() !== visual.sourceVisualId) {
      throw new Error("Selected source artifact inventory requires an exact non-empty artifact id.");
    }
    const pageNumber = visual.pageNumber;
    if (typeof pageNumber !== "number" || !Number.isSafeInteger(pageNumber) || pageNumber < 1) {
      throw new Error(`Selected source artifact ${visual.sourceVisualId} has an invalid page number.`);
    }
    if (typeof visual.caption !== "string" || !visual.caption.trim()) {
      throw new Error(`Selected source artifact ${visual.sourceVisualId} has an invalid caption.`);
    }
    for (const [name, value] of [
      ["exactText", visual.exactText],
      ["croppedImagePath", visual.croppedImagePath],
      ["pageImagePath", visual.pageImagePath],
    ] as const) {
      if (value !== undefined && value !== null && typeof value !== "string") {
        throw new Error(`Selected source artifact ${visual.sourceVisualId} has an invalid ${name}.`);
      }
    }
    const expectedPrefix = `S${identity.sourceIndex}.P${pageNumber}.`;
    if (!visual.sourceVisualId.startsWith(expectedPrefix)) {
      throw new Error(
        `Selected source artifact ${visual.sourceVisualId} conflicts with its stable source/page identity.`,
      );
    }
    const artifact: CanonicalSelectedSourceArtifact = {
      sourceVisualId: visual.sourceVisualId,
      sourceId: rawSourceId,
      sourceIndex: identity.sourceIndex,
      pageNumber,
      type: visual.type as SourceVisual["type"],
      caption: visual.caption,
      exactText: visual.exactText ?? null,
      bbox: canonicalBBox(visual.bbox),
      croppedImagePath: visual.croppedImagePath ?? null,
      pageImagePath: visual.pageImagePath ?? null,
    };
    if (artifactsById.has(artifact.sourceVisualId)) {
      throw new Error(`Selected source artifact inventory has duplicate/conflicting id ${artifact.sourceVisualId}.`);
    }
    artifactsById.set(artifact.sourceVisualId, artifact);
  }

  const artifacts = [...artifactsById.values()].sort((left, right) =>
    compareCanonicalStrings(left.sourceVisualId, right.sourceVisualId));
  const sourceIdentityMapHash = sha256(JSON.stringify({
    schemaVersion: 1,
    sourceIdentityMap: selectedIdentities,
  }));
  const canonical = {
    schemaVersion: 1 as const,
    selectedSourceIds,
    sourceIdentityMapHash,
    artifacts,
  };
  return {
    ...canonical,
    sourceArtifactInventoryHash: sha256(JSON.stringify(canonical)),
  };
}

/**
 * A Source Map is allowed a small number of complete model-authored
 * reauthorizations when scanning its exact selected pages reveals previously
 * unregistered artifacts. The cap is deliberately fixed and low: new evidence
 * is never mechanically assigned, omitted, or folded into an earlier map.
 */
export const MAX_SOURCE_MAP_EVIDENCE_REAUTHORS = 2;

function boundedSourceMapEvidenceTransition({
  changed,
  reauthorAttempts,
}: {
  changed: boolean;
  reauthorAttempts: number;
}): "stable" | "reauthor" | "fail" {
  // A malformed counter must never make a stale Source Map look stable.
  if (!Number.isSafeInteger(reauthorAttempts) || reauthorAttempts < 0) {
    return "fail";
  }
  if (!changed) return "stable";
  return reauthorAttempts < MAX_SOURCE_MAP_EVIDENCE_REAUTHORS
    ? "reauthor"
    : "fail";
}

/**
 * The Source Map may be re-authored up to the bounded evidence budget when
 * late exact-page extraction adds or changes registered artifacts. A later
 * mutation still aborts before scope planning.
 */
export function sourceMapArtifactInventoryTransition(input: {
  before: SelectedSourceArtifactInventorySnapshot;
  after: SelectedSourceArtifactInventorySnapshot;
  reauthorAttempts: number;
}): "stable" | "reauthor" | "fail" {
  return boundedSourceMapEvidenceTransition({
    changed: input.before.sourceArtifactInventoryHash !== input.after.sourceArtifactInventoryHash,
    reauthorAttempts: input.reauthorAttempts,
  });
}

/**
 * The Source Map is also bound to the reviewed source-set hash. A late page
 * scan can change that hash when it causes the formula-review ledger to be
 * revalidated, even if it did not add a planner-visible visual artifact. Keep
 * that structural transition separate from any academic decision: callers use
 * the result only to decide whether to ask the model to re-author every
 * evidence-bound planning artifact within the same fixed budget.
 */
export function sourceMapPlanningEvidenceTransition(input: {
  before: {
    sourceSetHash: string;
    sourceArtifactInventoryHash: string;
  };
  after: {
      sourceSetHash: string;
      sourceArtifactInventoryHash: string;
    };
  reauthorAttempts: number;
}): "stable" | "reauthor" | "fail" {
  return boundedSourceMapEvidenceTransition({
    changed:
      input.before.sourceSetHash !== input.after.sourceSetHash ||
      input.before.sourceArtifactInventoryHash !== input.after.sourceArtifactInventoryHash,
    reauthorAttempts: input.reauthorAttempts,
  });
}
