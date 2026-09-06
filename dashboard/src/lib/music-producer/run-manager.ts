import { createHash } from "node:crypto";
import { getConversationForUser } from "../conversations/store.ts";
import { attachExternalAgentRun, recordExternalAgentTurn, finishExternalAgentTurn } from "../conversations/external-agent-turns.ts";
import { resolveAceStepConfig } from "../acestep/config.ts";
import { musicArtifactContext } from "./artifacts.ts";
import { musicError } from "./errors.ts";
import { getOuterAgentRuntimeRunByRequest } from "../runtime-v2/outer-agent-run-store.ts";
import { startOuterAgentRun, readOuterAgentRunView, abortOuterAgentRun, type OuterAgentRunView } from "../runtime-v2/outer-agent-run.ts";
import { createMusicLaunch, musicLaunch, updateMusicLaunch } from "./store.ts";
import { musicProducerUserMessage } from "./identity.ts";
import type { MusicWorkerRequest } from "./worker.ts";
export async function startRun(input: Omit<MusicWorkerRequest, "launchId"> & {
  userId: number;
  clientMessageId: string;
  delegatedAgentRun?: boolean;
  internalAgentContinuation?: boolean;
  attachToExistingTurn?: boolean;
}) {
  const conversation = getConversationForUser(input.conversationPublicId, input.userId);
  if (conversation.surface !== "dashboard_terminal" && conversation.surface !== "garden_chat")
    throw new Error("invalid_music_surface");
  const id = `music_${createHash("sha256").update(`${input.userId}:${conversation.public_id}:${input.clientMessageId}`).digest("hex").slice(0, 32)}`;
  const launchJson = JSON.stringify({ ...input, conversationContext: undefined });
  const fresh = createMusicLaunch({ id, userId: input.userId, conversationPublicId: conversation.public_id, clientMessageId: input.clientMessageId, task: input.task, launchJson });
  const existing = musicLaunch(input.userId, id);
  if (existing.task !== input.task || (!fresh && existing.launch_json !== '{}' && existing.launch_json !== launchJson))
    throw new Error("client_message_id_conflict");
  if (!fresh)
    return { runId: id, status: existing.collection_state };
  // Durable descriptor precedes admission. Deleting a conversation can now cancel even queued work.
  try {
    updateMusicLaunch(input.userId, id, { launch_json: launchJson, created_at: Date.now() });
    const run = { kind: "music_producer" as const, runId: id, task: input.task };
    if (input.attachToExistingTurn)
      attachExternalAgentRun({ conversation, clientMessageId: input.clientMessageId, run });
    else
      recordExternalAgentTurn({
        conversation, clientMessageId: input.clientMessageId, surface: conversation.surface,
        userContent: input.delegatedAgentRun ? input.task : musicProducerUserMessage(input.task), run, outcome: "running",
        delegatedAgentRun: input.delegatedAgentRun, internalAgentContinuation: input.internalAgentContinuation
      });
    const commandPart = input.task.split(/(?:^|\n)Lyrics:\s*\r?\n/i)[0];
    const resumeId = /(?:^|\s)--resume\s+(music_[a-f0-9]{32})(?:\s|$)/.exec(commandPart)?.[1];
    if (/(?:^|\s)--resume\b/.test(commandPart) && !resumeId)
      throw Error("Resume requires an exact Music Producer run ID from this conversation.");
    const previous = resumeId ? musicLaunch(input.userId, resumeId) : null;
    if (previous) {
      if (previous.conversation_public_id !== conversation.public_id || !previous.provider_receipt || !previous.request_json || previous.artifact_id)
        throw new Error("Resume requires an uncollected receipt from this conversation.");
      if (!(await readRun(input.userId, previous.id)).terminal)
        throw new Error("The original collector is still active.");
    }
    updateMusicLaunch(input.userId, id, {
      context_json: JSON.stringify(musicArtifactContext(input.userId, id)), provider_json: previous?.provider_json ?? JSON.stringify(resolveAceStepConfig(input.userId)),
      ...(previous ? { request_json: previous.request_json, provider_receipt: previous.provider_receipt, provider_state: previous.provider_state } : {})
    });
    const job = await startOuterAgentRun({
      kind: "music-producer", userId: input.userId, requestId: id,
      requestPayload: {
        launchId: id, task: input.task, model: input.model, reasoningEffort: input.reasoningEffort,
        baseUrl: input.baseUrl, conversationPublicId: input.conversationPublicId, conversationContext: input.conversationContext,
        defaults: input.defaults, explicit: input.explicit
      }
    });
    updateMusicLaunch(input.userId, id, { runtime_job_id: job.runId });
    if (musicLaunch(input.userId, id).collection_state === "cancelling")
      await abortOuterAgentRun("music-producer", input.userId, job.runId);
    return { runId: id, status: "queued" };
  }
  catch (error) {
    const summary = musicError(error).message;
    updateMusicLaunch(input.userId, id, { collection_state: "failed", summary });
    try {
      finishExternalAgentTurn({ conversationId: conversation.id, clientMessageId: input.clientMessageId, outcome: "failed", content: summary });
    }
    catch { /* Launch-message validation may have failed. */ }
    throw error;
  }
}
export async function readRun(userId: number, id: string, since = 0): Promise<OuterAgentRunView> {
  const launch = musicLaunch(userId, id);
  getConversationForUser(launch.conversation_public_id, userId);
  // Recover a crash between native admission and saving the facade's native job id.
  if (!launch.runtime_job_id) {
    const admitted = getOuterAgentRuntimeRunByRequest(userId, "music-producer", id);
    if (admitted) {
      launch.runtime_job_id = admitted.job_id;
      updateMusicLaunch(userId, id, { runtime_job_id: admitted.job_id });
    }
  }
  if (launch.runtime_job_id)
    return readOuterAgentRunView("music-producer", userId, launch.runtime_job_id, since);
  const terminal = ["failed", "aborted", "uncertain"].includes(launch.collection_state) || (launch.created_at > 0 && Date.now() - launch.created_at > 120000);
  return { terminal, status: terminal ? "failed" : "queued", events: terminal && since < 1 ? [{ sequenceNumber: 1, at: new Date(0).toISOString(), type: "run.failed", payload: { summary: launch.summary || "Submission is uncertain. Explicitly retry after checking Runtime status." } }] : [] };
}
export async function abortRun(userId: number, id: string): Promise<boolean> {
  const launch = musicLaunch(userId, id);
  if (["completed", "failed", "aborted"].includes(launch.collection_state))
    return false;
  updateMusicLaunch(userId, id, { collection_state: "cancelling" });
  if (launch.runtime_job_id)
    await abortOuterAgentRun("music-producer", userId, launch.runtime_job_id);
  return true;
}
export async function getEventsSince(userId: number, id: string, since = 0) { return (await readRun(userId, id, since)).events; }
export async function isTerminal(userId: number, id: string) { return (await readRun(userId, id)).terminal; }
