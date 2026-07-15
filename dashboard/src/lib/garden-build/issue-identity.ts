import crypto from "node:crypto";
import type { GardenIssue, GardenIssueBase, GardenIssueSeverity, GardenIssueTarget } from "./issues.ts";

const TARGET_KEYS: (keyof GardenIssueTarget)[] = [
  "sourceId", "anchorId", "formulaAnchorId", "formulaAssignmentId", "sectionId",
  "unitId", "pageId", "conceptId", "claimId", "visualId",
];

function normalizedCategory(evidence: Record<string, unknown>): string {
  const value = evidence.semanticCategory ?? evidence.failureReason ?? evidence.verifiedFormulaFamily ?? evidence.missingAnchorId;
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-|-$/g, "") : "";
}

export function stableGardenIssueId(issue: Omit<GardenIssueBase, "issueId">): string {
  const parts = [issue.type];
  for (const key of TARGET_KEYS) {
    const value = issue.target[key];
    if (value) parts.push(`${key}=${value}`);
  }
  const category = normalizedCategory(issue.evidence);
  if (category) parts.push(`category=${category}`);
  if (parts.length > 1) return parts.join(":");
  const fallback = crypto.createHash("sha1").update(`${issue.type}:${category}`).digest("hex").slice(0, 12);
  return `${issue.type}:category=${category || fallback}`;
}

const severityRank: Record<GardenIssueSeverity, number> = { diagnostic: 0, warning: 1, blocking: 2 };

function mergeEvidence(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (!(key in merged)) { merged[key] = value; continue; }
    const previous = merged[key];
    if (JSON.stringify(previous) === JSON.stringify(value)) continue;
    const values = [
      ...(Array.isArray(previous) ? previous : [previous]),
      ...(Array.isArray(value) ? value : [value]),
    ];
    merged[key] = values.filter((entry, index) => values.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(entry)) === index);
  }
  return merged;
}

export function mergeGardenIssues(issueSets: GardenIssue[][]): GardenIssue[] {
  const merged = new Map<string, GardenIssue>();
  for (const issue of issueSets.flat()) {
    const existing = merged.get(issue.issueId);
    if (!existing) {
      merged.set(issue.issueId, { ...issue, detectedBy: [...new Set(issue.detectedBy)].sort() } as GardenIssue);
      continue;
    }
    const severity = severityRank[issue.severity] > severityRank[existing.severity] ? issue.severity : existing.severity;
    merged.set(issue.issueId, {
      ...existing,
      severity,
      target: Object.fromEntries(TARGET_KEYS.map((key) => [key, existing.target[key] ?? issue.target[key]]).filter(([, value]) => value)) as GardenIssueTarget,
      evidence: mergeEvidence(existing.evidence, issue.evidence),
      detectedBy: [...new Set([...existing.detectedBy, ...issue.detectedBy])].sort(),
    } as GardenIssue);
  }
  return [...merged.values()].sort((left, right) => left.issueId.localeCompare(right.issueId));
}
