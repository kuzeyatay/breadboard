// Per-page acceptance receipts inside a Learn build workspace.
//
// A resumed generation replays a page's model calls only while its request
// hash is unchanged, so any prompt edit made the next resume rewrite every
// lesson that had already passed its gates (telecom-1, 2026-09-16: 20 accepted
// pages regenerated overnight). The workspace now records, for each accepted
// page, the inputs it was written from and the accepted body; a resume whose
// inputs hash the same reuses the body and its visual outcomes without any
// model call, whatever the prompts look like now. The receipt lives under the
// staging garden's `.breadboard/Internal` so it travels with the retained
// workspace and never publishes.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { VisualizationPublicationOutcome } from "./visualization-opportunities.ts";

export const ACCEPTED_PAGES_RELATIVE_PATH = path.join(".breadboard", "Internal", "learn-accepted-pages.json");
const SCHEMA_VERSION = 2;

export interface AcceptedPageReceipt {
  inputHash: string;
  /** The same inputs without the earlier lessons' prose. A rewritten earlier
   * lesson must not discard later accepted lessons (telecom-1, 2026-10-06:
   * one rewritten lesson cascaded into rewriting every later one). */
  stableInputHash?: string;
  /** Integrity of the exact accepted text and its review inputs. */
  bodyHash?: string;
  /** The accepted lesson body after interactive-visual reconciliation, before frontmatter. */
  pageBody: string;
  visualIds: string[];
  visualizationOutcomes: VisualizationPublicationOutcome[];
  councilRunId?: string;
  acceptedAt: string;
  jobId: string;
}

interface AcceptedPagesFile {
  schemaVersion: number;
  pages: Record<string, AcceptedPageReceipt>;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Hash of everything a page is written from. Prompts are deliberately not
 * part of it: a prompt change must not throw away an accepted page. */
export function acceptedPageInputHash(input: {
  pageRelPath: string;
  dossier: unknown;
  /** Actual earlier prose and the teaching gate version, not just plan labels. */
  teachingContextHash?: string;
  assignedVisualIds: readonly string[];
  taughtEarlier: readonly string[];
  taughtLater: readonly string[];
  sourceSetHash: string;
  confirmedLearningMapId: string;
}): string {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

function receiptPath(stagingGardenDir: string): string {
  return path.join(stagingGardenDir, ACCEPTED_PAGES_RELATIVE_PATH);
}

export function readAcceptedPages(stagingGardenDir: string): Record<string, AcceptedPageReceipt> {
  const file = receiptPath(stagingGardenDir);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AcceptedPagesFile>;
    if (parsed?.schemaVersion !== SCHEMA_VERSION || !parsed.pages || typeof parsed.pages !== "object") return {};
    return parsed.pages;
  } catch {
    return {};
  }
}

export function readAcceptedPage(
  stagingGardenDir: string,
  pageRelPath: string,
  inputHash: string,
  stableInputHash?: string,
): AcceptedPageReceipt | null {
  const receipt = readAcceptedPages(stagingGardenDir)[pageRelPath];
  if (!receipt) return null;
  // Exact inputs, or the same inputs apart from earlier lessons' prose. A
  // receipt from before stableInputHash existed is kept as written: the user
  // asked that written lessons never be rewritten (2026-10-06).
  const matches = receipt.inputHash === inputHash ||
    (stableInputHash !== undefined &&
      (receipt.stableInputHash === undefined || receipt.stableInputHash === stableInputHash));
  if (!matches) return null;
  if (typeof receipt.pageBody !== "string" || !receipt.pageBody.trim()) return null;
  if (receipt.bodyHash !== acceptedBodyHash(receipt)) return null;
  if (!Array.isArray(receipt.visualIds) || !Array.isArray(receipt.visualizationOutcomes)) return null;
  return receipt;
}

export function writeAcceptedPage(
  stagingGardenDir: string,
  pageRelPath: string,
  receipt: AcceptedPageReceipt,
): void {
  const file = receiptPath(stagingGardenDir);
  const pages = readAcceptedPages(stagingGardenDir);
  pages[pageRelPath] = { ...receipt, bodyHash: acceptedBodyHash(receipt) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload: AcceptedPagesFile = { schemaVersion: SCHEMA_VERSION, pages };
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload)}\n`);
  fs.renameSync(temporary, file);
}

function acceptedBodyHash(receipt: AcceptedPageReceipt): string {
  return createHash("sha256").update(JSON.stringify({ inputHash: receipt.inputHash, pageBody: receipt.pageBody })).digest("hex");
}
