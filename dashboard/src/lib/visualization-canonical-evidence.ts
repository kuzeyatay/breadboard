import { buildCanonicalSourceAnchors } from "./final-garden-state.ts";
import type { LearningUnitContract } from "./learning-unit-contract.ts";
import type { VisualizationContractEvidenceEntry } from "./visualization-contract-validation.ts";

/**
 * Source ids declared by the model-authored unit. The order is part of the
 * reviewer packet: first declaration wins and no source is inferred here.
 */
export function declaredVisualizationSourceAnchorIdsForUnit(
  unit: LearningUnitContract,
): string[] {
  return [...new Set([
    ...unit.sourceAnchors,
    ...unit.sourceFigures.map((artifact) => artifact.id),
    ...unit.sourceFormulas.map((artifact) => artifact.id),
    ...unit.sourceTables.map((artifact) => artifact.id),
    ...(unit.semanticConcepts ?? []).flatMap((concept) => concept.evidenceAnchors),
    ...(unit.knowledgeClaims ?? []).flatMap((claim) => [
      ...claim.evidenceAnchors,
      ...(claim.derivationAnchors ?? []),
    ]),
  ])];
}

/**
 * Rebuild the exact canonical evidence packet from durable garden sources.
 * Planning and final publication verification intentionally share this pure
 * projection so a self-consistent edited audit ledger cannot redefine what
 * evidence the reviewer saw.
 */
export function canonicalVisualizationEvidenceByUnit(
  gardenDir: string,
  units: readonly LearningUnitContract[],
): Record<string, VisualizationContractEvidenceEntry[]> {
  const registry = buildCanonicalSourceAnchors(gardenDir, {
    allowInferredFormulaText: false,
  });
  return Object.fromEntries(units.map((unit) => {
    const entries: VisualizationContractEvidenceEntry[] = [];
    for (const anchorId of declaredVisualizationSourceAnchorIdsForUnit(unit)) {
      const anchor = registry[anchorId];
      if (!anchor) continue;
      const kind: VisualizationContractEvidenceEntry["kind"] =
        anchor.kind === "formula"
          ? "source_formula"
          : anchor.kind === "table"
            ? "source_table"
            : anchor.kind === "figure" || anchor.kind === "graph"
              ? "source_figure"
              : "source_text";
      const texts = anchor.exactText
        ? [anchor.exactText]
        : (anchor.kind === "figure" || anchor.kind === "graph" || anchor.kind === "table") && anchor.caption
          ? [anchor.caption]
          : [];
      for (const text of texts) entries.push({ anchor: anchorId, kind, text });
    }
    return [unit.id, entries];
  }));
}
