import { createHash } from "node:crypto";
import db from "../db.ts";
import { normalizeAssistantModelId } from "../ai-models.ts";
import { getRuntimeRun, parseRuntimeRunDispatch } from "./run-store.ts";
import { recordAuditEvent } from "./runtime-store.ts";
import {
  isExplanationCandidate, reviewExplanation,
  type ExplanationReviewResult,
} from "./explanation-review.ts";
import type { EvidenceRecord } from "./evidence.ts";
import { explanationReviewModel } from "./explanation-review-provider.ts";
import { explanationSourceContext } from "./explanation-review-context.ts";
import { boundPromptContext } from "./prompt-budget.ts";

/** Shared by the Terminal/Quartz event pump and the Garden/inline SSE adapter. */
export async function reviewRuntimeExplanation(input: {
  runId: string;
  answer: string;
  evidence: EvidenceRecord[];
  onStage?: (stage: "plan" | "review" | "repair" | "verify") => void;
}): Promise<ExplanationReviewResult | null> {
  const run = getRuntimeRun(input.runId);
  if (!run || run.status !== "active") return null;
  const dispatch = parseRuntimeRunDispatch(run);
  const model = normalizeAssistantModelId(dispatch.modelIdentity?.modelID ?? dispatch.model?.modelID) ?? "";
  const skipped: ExplanationReviewResult = {
    answer: input.answer,
    report: { status: "not_applicable", reason: "This turn does not need an explanation review.", model, obligations: [], coverage: [], calls: 0, durationMs: 0 },
  };
  if (/^(?:0|false|off|no)$/i.test(process.env.ENABLE_EXPLANATION_REVIEW?.trim() ?? "") ||
      !isExplanationCandidate(run.instruction) || dispatch.requiredArtifacts?.length || dispatch.delegatedAgents?.length) return skipped;
  if (!model) return { ...skipped, report: { ...skipped.report, status: "unavailable", reason: "The answering model was not recorded; review was skipped." } };
  // The original question and pre-dispatch context define the obligations.
  // Tool summaries are evidence leads, not proof that the source was read.
  const context = [
    // Legacy runs have no scoped packet. Keep the selection rather than the
    // head/tail of a system prompt dominated by feature policy and profile.
    dispatch.explanationContext?.context ?? "Current turn and selected excerpt:\n" + (dispatch.runtimeText ?? run.instruction),
    "Observed tool evidence (summaries may be incomplete):\n" + boundPromptContext(JSON.stringify(input.evidence), 6_000),
  ].join("\n\n");
  // Keep source passages separate from prior model prose so the planner must
  // support its requirements with actual source excerpts.
  const sourcePassages = dispatch.explanationContext?.sourcePassages ?? await explanationSourceContext(run.runtime_session_id,
    `${run.instruction}\n${(dispatch.runtimeText ?? "").slice(-6_000)}`);
  const hash = createHash("sha256").update(JSON.stringify({ version: 5, question: run.instruction, context, sourcePassages, answer: input.answer, model })).digest("hex");
  // Retrieval can yield while a stop or supersession changes the run.
  if (getRuntimeRun(input.runId)?.status !== "active") return null;
  const cached = dispatch.explanationReview;
  if (cached?.inputHash === hash) return cached.result;
  const controller = new AbortController();
  let result: ExplanationReviewResult | undefined;
  let stateReadFailed = false;
  // Detached readers may disconnect without cancelling work. Only the durable
  // run's stop/supersession cancels review, just as it cancels generation.
  const stopIfCancelled = () => {
    try {
      if (getRuntimeRun(input.runId)?.status !== "active") controller.abort();
    } catch {
      stateReadFailed = true;
      controller.abort();
    }
  };
  const poll = setInterval(stopIfCancelled, 250);
  poll.unref?.();
  try {
    stopIfCancelled();
    result = await reviewExplanation({
      userRequest: run.instruction, context, sourcePassages, answer: input.answer, model,
      complete: explanationReviewModel(model), signal: controller.signal,
      onStage: input.onStage,
    });
    stopIfCancelled();
    if (controller.signal.aborted) {
      if (stateReadFailed) throw new Error("Run state unavailable");
      return null;
    }
    // Store the exact answer and receipt together before either is exposed.
    // Reconnects reuse this result instead of paying for another review.
    const latest = getRuntimeRun(input.runId);
    if (!latest || latest.status !== "active") return null;
    const saved = db.prepare("UPDATE hermes_runs SET dispatch_json = ? WHERE id = ? AND status = 'active'")
      .run(JSON.stringify({ ...parseRuntimeRunDispatch(latest), explanationReview: { inputHash: hash, result } }), input.runId);
    if (!saved.changes) return null;
    try {
      recordAuditEvent({
        eventType: "answer.explanation_review", runtimeSessionId: run.runtime_session_id,
        payload: { runId: input.runId, inputHash: hash, ...result.report },
      });
    } catch { /* The durable run receipt already owns the result. */ }
    return result;
  } catch {
    if (controller.signal.aborted && !stateReadFailed) return null;
    return { ...skipped, ...(result?.usage ? { usage: result.usage } : {}), report: {
      ...(result?.report ?? skipped.report), status: "unavailable",
      reason: "The explanation review could not be saved; the draft was retained.",
    } };
  } finally {
    clearInterval(poll);
  }
}
