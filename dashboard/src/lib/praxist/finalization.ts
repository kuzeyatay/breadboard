/** An early GenerationLoop summary precedes canonical finding publication. */
export function praxistFinalizationReady(
  summary: Record<string, unknown> | null,
  metadata: Record<string, unknown> | null,
  processExited: boolean,
): boolean {
  return processExited && !!summary && !!metadata &&
    ["succeeded", "failed"].includes(String(metadata.status)) &&
    summary.status === metadata.status &&
    typeof metadata.finalized_at === "string" && Number.isFinite(Date.parse(metadata.finalized_at));
}
