import crypto from "node:crypto";
import type { GardenBuildState } from "./types.ts";

const EXCLUDED_KEYS = new Set([
  "fingerprint", "legacyPath", "acceptedAt", "timestamp", "createdAt", "updatedAt",
  "requestId", "modelRequestId", "debug", "logs", "reportProse", "rootPath", "abs", "path",
]);

function semanticValue(value: unknown, key = ""): unknown {
  if (EXCLUDED_KEYS.has(key)) return undefined;
  if (Array.isArray(value)) return value.map((entry) => semanticValue(entry)).filter((entry) => entry !== undefined);
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(input).sort().map((name) => [name, semanticValue(input[name], name)]).filter(([, entry]) => entry !== undefined),
  );
}

export function fingerprintGardenBuildState(state: GardenBuildState): string {
  const semantic = semanticValue({
    schemaVersion: state.schemaVersion,
    gardenId: state.gardenId,
    gardenSlug: state.gardenSlug,
    topicTitle: state.topicTitle,
    sourceSetHash: state.sourceSetHash,
    sources: state.sources,
    sourceAnchors: state.sourceAnchors,
    sections: state.sections,
    units: state.units,
    pages: state.pages,
    concepts: state.concepts,
    claims: state.claims,
    visuals: state.visuals,
    formulaAssignments: state.formulaAssignments,
    sourceCoverage: state.sourceCoverage,
    activeIssueIds: state.issueState.active.map((issue) => issue.issueId).sort(),
  });
  return crypto.createHash("sha256").update(JSON.stringify(semantic)).digest("hex");
}

export function contentFingerprint(content: string): string {
  return crypto.createHash("sha256").update(content.replace(/\r\n/g, "\n")).digest("hex");
}
