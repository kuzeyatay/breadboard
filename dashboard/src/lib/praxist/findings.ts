import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";

async function boundedFile(file: string): Promise<string> {
  const metadata = await stat(file).catch(() => null);
  if (!metadata?.isFile() || metadata.size > 2 * 1024 * 1024) return "";
  return readFile(file, "utf8").catch(() => "");
}

/** Only follow result references within this run, including after symlink resolution. */
async function containedFile(runDir: string, subtree: string, reference: unknown): Promise<string> {
  if (typeof reference !== "string" || reference.includes("\0") || path.isAbsolute(reference)) return "";
  const root = await realpath(path.join(runDir, subtree)).catch(() => "");
  const file = await realpath(path.resolve(runDir, reference)).catch(() => "");
  if (!root || !file) return "";
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) return "";
  return boundedFile(file);
}

async function resultReceipt(runDir: string, reference: unknown): Promise<unknown> {
  const content = await containedFile(runDir, "results", reference);
  try { return JSON.parse(content); } catch { return undefined; }
}

async function canonicalFindingPayload(runDir: string, findingId: string, runId: unknown, refs: unknown): Promise<unknown> {
  if (!Array.isArray(refs)) return undefined;
  for (const ref of refs) {
    if (ref?.artifact_type !== "finding" || ref.run_id !== runId ||
      typeof ref.content_hash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(ref.content_hash)) continue;
    const content = await containedFile(runDir, "artifacts", ref.payload_path);
    if (!content || `sha256:${createHash("sha256").update(content).digest("hex")}` !== ref.content_hash) continue;
    try {
      const payload = JSON.parse(content);
      if (payload.finding_id === findingId) return payload.legacy_finding;
    } catch { /* try another canonical evidence reference */ }
  }
  return undefined;
}

/** Read accepted findings, including the substantive payload behind their index. */
export async function acceptedPraxistFindings(runDir: string): Promise<string> {
  const index = await boundedFile(path.join(runDir, "findings", "findings.jsonl"));
  // Praxist's canonical replay contract counts frontier records as accepted.
  // The legacy finding itself may retain "draft" after workflow promotion.
  const frontier = await boundedFile(path.join(runDir, "findings", "frontier.jsonl"));
  const promoted = new Set<string>();
  for (const line of frontier.split(/\r?\n/)) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (record.schema_version !== "praxist.frontier.v1" || typeof record.run_id !== "string" ||
      typeof record.finding_id !== "string") continue;
    const key = JSON.stringify([record.run_id, record.finding_id]);
    if (record.action === "promoted") promoted.add(key);
    else promoted.delete(key);
  }
  const results: string[] = [];
  for (const line of index.split(/\r?\n/)) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (typeof record.finding_id !== "string") continue;
    const workflowAccepted = promoted.has(JSON.stringify([record.run_id, record.finding_id]));
    if (record.status !== "accepted" && !(record.status === "draft" && workflowAccepted)) continue;
    const id = record.finding_id;
    // The legacy artifact name is derived from the id, never a supplied path.
    if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(id)) continue;
    const detail = await boundedFile(path.join(runDir, "findings", "legacy", `${id}.json`));
    let payload;
    try { payload = JSON.parse(detail)?.legacy_finding; } catch { /* use the index claim */ }
    payload ??= await canonicalFindingPayload(runDir, id, record.run_id, record.evidence_refs);
    const receipt = await resultReceipt(runDir, payload?.source_result_path ?? payload?.metrics?.source_result_path);
    results.push(JSON.stringify({
      findingId: id, claim: record.claim, status: record.status,
      acceptance: workflowAccepted ? "Canonical workflow frontier promotion" : "Explicit accepted finding status",
      provenance: record.provenance_quality, provenanceWarning: record.provenance_warning,
      scores: record.scores, evidence: payload ?? record.evidence_refs,
      resultReceipt: receipt,
    }, null, 2));
    if (results.length >= 20) break;
  }
  return results.length ? `Accepted research findings (an acceptance or arithmetic score does not establish scientific truth):\n\n${results.join("\n\n")}` : "";
}
