import { hasReadyArtifactForRun } from "./artifact-store.ts";
import { getRuntimeRun, parseRuntimeRunDispatch, type RuntimeRunRow, type RuntimeArtifactRequirement } from "./run-store.ts";

/** Only this request's lineage may satisfy its deliverable requirements. */
export function missingRunArtifact(run: RuntimeRunRow, conversationId: number): RuntimeArtifactRequirement | null {
  const dispatch = parseRuntimeRunDispatch(run);
  const candidates = [run, ...(dispatch.taskRecovery?.previousRunIds ?? dispatch.goalMode?.previousRunIds ?? [])
    .flatMap(id => { const previous = getRuntimeRun(id); return previous ? [previous] : []; })];
  return (dispatch.requiredArtifacts ?? []).find(requirement => !candidates.some(candidate => {
    const clientMessageId = parseRuntimeRunDispatch(candidate).clientMessageId;
    return Boolean(clientMessageId) && hasReadyArtifactForRun({ runId: candidate.id, conversationId,
      assistantClientMessageId: clientMessageId!, ...requirement });
  })) ?? null;
}
