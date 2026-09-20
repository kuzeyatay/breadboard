/** A bounded repair may change evidence bindings, never the teaching objective,
 * required artifacts, claim text, or another unit. Semantic support is judged
 * by the model from exact canonical passages and rechecked by the critic. */
export interface UnitReanchorCandidate {
  contractBefore: string;
  contractAfter: string;
  unit: Record<string, unknown>;
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

function withoutBindings(unit: Record<string, unknown>): unknown {
  const { sourceAnchors: _anchors, semanticConcepts, knowledgeClaims, ...rest } = unit;
  const strip = (entries: unknown, claim: boolean): unknown => Array.isArray(entries) ? entries.map((entry) => {
    const { evidenceAnchors: _evidence, ...other } = entry;
    if (!claim) return other;
    const { derivationAnchors: _derivation, ...fixed } = other;
    return fixed;
  }) : entries;
  return { ...rest, semanticConcepts: strip(semanticConcepts, false), knowledgeClaims: strip(knowledgeClaims, true) };
}

export function prepareUnitReanchor(
  contractBefore: string,
  unitId: string,
  proposal: unknown,
  candidateIds: readonly string[],
): UnitReanchorCandidate {
  const contract = JSON.parse(contractBefore);
  const original = contract.learningUnits?.find((unit: { id: string }) => unit.id === unitId);
  const units = (proposal as { learningUnits?: Record<string, unknown>[] } | null)?.learningUnits;
  if (!original || !Array.isArray(units) || units.length !== 1 || units[0]?.id !== unitId ||
      Object.keys(proposal as object).some((key) => key !== "learningUnits")) {
    throw new Error("Re-anchoring must return exactly the requested unit, with its unchanged id.");
  }
  const revised = units[0];
  if (stable(withoutBindings(original)) !== stable(withoutBindings(revised))) {
    throw new Error("Re-anchoring may change only source and claim/concept evidence bindings, not objectives or required artifacts.");
  }
  const oldIds = new Set<string>(original.sourceAnchors ?? []);
  const offered = new Set(candidateIds);
  const selected = revised.sourceAnchors;
  if (!Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length ||
      selected.some((id) => typeof id !== "string" || (!oldIds.has(id) && !offered.has(id))) ||
      !selected.some((id) => !oldIds.has(id) && offered.has(id))) {
    throw new Error("Re-anchoring must select at least one new offered canonical anchor and no invented anchors.");
  }
  for (const key of ["semanticConcepts", "knowledgeClaims"]) {
    const beforeEntries = original[key] ?? [];
    for (const [index, entry] of ((revised[key] ?? []) as Record<string, unknown>[]).entries()) {
      for (const binding of key === "knowledgeClaims" ? ["evidenceAnchors", "derivationAnchors"] : ["evidenceAnchors"]) {
        if (stable(entry[binding]) === stable(beforeEntries[index]?.[binding])) continue;
        const ids = entry[binding];
        if (!Array.isArray(ids) || !ids.length || ids.some((id) => !selected.includes(id))) {
          throw new Error(`Re-anchoring ${key}.${binding} must use selected canonical evidence and cannot remove all evidence.`);
        }
      }
    }
  }
  contract.learningUnits = contract.learningUnits.map((unit: { id: string }) => unit.id === unitId ? revised : unit);
  return { contractBefore, contractAfter: `${JSON.stringify(contract, null, 2)}\n`, unit: revised };
}
