// Critic findings a person has read and accepted for a garden.
//
// Strict publish stops on any blocking finding, and that is the right default:
// a blocker nobody has looked at must not ship. But a finding can be true and
// still not worth what fixing it costs. telecom-1 finished a 31-lesson module
// with two units whose assigned evidence does not cover everything they teach
// - correctly flagged - and the honest ways to fix that were to re-plan (losing
// every accepted lesson) or to cut the content (2026-09-18). Accepting the
// finding is a third answer, and it has to be an explicit one: named issue
// ids, held in the garden itself, so the decision travels with the content
// and shows up in every report rather than vanishing into a waived gate.
//
// The file is small and hand-editable on purpose:
//
//   { "version": 1, "accepted": [
//       { "issueId": "u20-plastic-fiber-source-anchor-mismatch",
//         "reason": "Keiser POF chapter not assigned to U20; accepted for this run",
//         "acceptedAt": "2026-09-18T11:05:00.000Z" } ] }
//
// Only the ids matter to the gate; the reason is for the person reading the
// report later.

import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import crypto from "node:crypto";

export const ACCEPTED_RESIDUES_RELATIVE_PATH = path.join(".breadboard", "accepted-critic-residues.json");

export interface AcceptedCriticResidue {
  issueId: string;
  reason?: string;
  acceptedAt?: string;
}

export interface CriticPolicySnapshot {
  version: number | null;
  sha256: string | null;
  capturedAt: string;
  records: AcceptedCriticResidue[];
  criticMaxRounds: number | null;
  measurementReviewNewFindings: "block" | "warn";
}

/** Settings, acceptances and the audit hash must refer to the same read. */
export function readCriticPolicySnapshot(gardenDir: string): CriticPolicySnapshot {
  const snapshot: CriticPolicySnapshot = {
    version: null, sha256: null, capturedAt: new Date().toISOString(), records: [],
    criticMaxRounds: null, measurementReviewNewFindings: "block",
  };
  try {
    const bytes = fs.readFileSync(residuesPath(gardenDir));
    snapshot.sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const value = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object") return snapshot;
    snapshot.version = typeof value.version === "number" ? value.version : null;
    snapshot.criticMaxRounds = Number.isInteger(value.criticMaxRounds) && value.criticMaxRounds >= 1 ? value.criticMaxRounds : null;
    snapshot.measurementReviewNewFindings = value.measurementReviewNewFindings === "warn" ? "warn" : "block";
    snapshot.records = Array.isArray(value.accepted) ? value.accepted.flatMap((entry: AcceptedCriticResidue | null) =>
      entry && typeof entry.issueId === "string" && entry.issueId.trim() ? [{
        issueId: entry.issueId.trim(),
        ...(typeof entry.reason === "string" ? { reason: entry.reason } : {}),
        ...(typeof entry.acceptedAt === "string" ? { acceptedAt: entry.acceptedAt } : {}),
      }] : []) : [];
  } catch { /* invalid policy grants no exceptions */ }
  return snapshot;
}

function residuesPath(gardenDir: string): string {
  return path.join(gardenDir, ACCEPTED_RESIDUES_RELATIVE_PATH);
}

/** The accepted residues recorded for a garden, or none. Never throws: a
 * malformed file is treated as empty, so a typo cannot loosen the gate. */
export function readAcceptedCriticResidueRecords(gardenDir: string): AcceptedCriticResidue[] {
  try {
    const raw = fs.readFileSync(residuesPath(gardenDir), "utf-8");
    const parsed = JSON.parse(raw) as { accepted?: unknown };
    if (!parsed || !Array.isArray(parsed.accepted)) return [];
    return parsed.accepted.flatMap((entry) => {
      const issueId = (entry as { issueId?: unknown } | null)?.issueId;
      if (typeof issueId !== "string" || !issueId.trim()) return [];
      const reason = (entry as { reason?: unknown }).reason;
      const acceptedAt = (entry as { acceptedAt?: unknown }).acceptedAt;
      return [{
        issueId: issueId.trim(),
        ...(typeof reason === "string" ? { reason } : {}),
        ...(typeof acceptedAt === "string" ? { acceptedAt } : {}),
      }];
    });
  } catch {
    return [];
  }
}

/** Just the ids, which is all the publish decision consults. */
export function readAcceptedCriticResidues(gardenDir: string): string[] {
  return readAcceptedCriticResidueRecords(gardenDir).map((entry) => entry.issueId);
}

/** Record an acceptance. Replaces an existing entry for the same id. */
export function writeAcceptedCriticResidue(gardenDir: string, residue: AcceptedCriticResidue): void {
  const existing = readAcceptedCriticResidueRecords(gardenDir).filter((entry) => entry.issueId !== residue.issueId);
  const target = residuesPath(gardenDir);
  // Keep every other field a person put in this file (criticMaxRounds, say);
  // recording one residue must not erase a different decision.
  let others: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(target, "utf-8")) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      const { accepted: _accepted, version: _version, ...rest } = parsed;
      others = rest;
    }
  } catch {
    // No file yet, or unreadable: nothing to preserve.
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    `${JSON.stringify({ version: 1, ...others, accepted: [...existing, { acceptedAt: new Date().toISOString(), ...residue }] }, null, 2)}\n`,
    "utf-8",
  );
}

/**
 * A person's bound on how many repair rounds the critic may run for this
 * garden, or null for the loop's default. Held in the same file as the
 * accepted residues, under `criticMaxRounds`, because it is the same kind of
 * decision: a judgement about this garden, recorded so it travels with it.
 * Only a positive integer counts; anything else is the default, so a typo
 * can never disable the critic (0 is not accepted for that reason).
 */
export function readCriticRoundBound(gardenDir: string): number | null {
  try {
    const raw = fs.readFileSync(residuesPath(gardenDir), "utf-8");
    const parsed = JSON.parse(raw) as { criticMaxRounds?: unknown };
    const value = parsed?.criticMaxRounds;
    return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
  } catch {
    return null;
  }
}

/**
 * What to do with a blocking finding the critic raises for the first time in
 * its final measurement review, on a page no repair in that round touched.
 *
 * That review exists to measure the repairs; it cannot be followed by another
 * repair. So a finding it raises on an untouched page - one the same critic
 * passed one review earlier, on identical text - can never be fixed inside the
 * run, only reported. telecom-1 M2 lost runs 2, 3, 5 and 6 to exactly one
 * such finding each, on a different page every time (2026-09-19). "block"
 * (the default) keeps holding publication; "warn" publishes with the finding
 * reported as a warning, marked as demoted, for a person to read. Anything
 * the round already knew about, or on a page the round repaired, is not
 * affected by this setting: a repair that failed or regressed still blocks.
 */
export type MeasurementReviewNewFindingsPolicy = "block" | "warn";

export function readMeasurementReviewPolicy(gardenDir: string): MeasurementReviewNewFindingsPolicy {
  try {
    const raw = fs.readFileSync(residuesPath(gardenDir), "utf-8");
    const parsed = JSON.parse(raw) as { measurementReviewNewFindings?: unknown };
    return parsed?.measurementReviewNewFindings === "warn" ? "warn" : "block";
  } catch {
    return "block";
  }
}
