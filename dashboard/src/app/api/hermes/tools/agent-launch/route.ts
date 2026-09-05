// `agent_launch` — a Super Agent or reviewed routed skill starting one of the
// runtime agents under a turn-scoped capability decision.
//
// The runtime agents (`/agents:*`) each run as their own service and take a
// whole turn. Until now only the user could start one, so the best a super-agent
// turn could do was name the command and stop. This route lets the agent make
// the choice while leaving the launch itself where it has always been: the chat
// surface performs it through its structured delegation path.
//
// Most agents are validated here and queued for their surface launcher. Max
// Research is the deliberate exception: it is read-only and long-running, so
// this authenticated boundary starts and attaches it durably before returning.
// The client then observes that run rather than owning whether it exists.

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import {
  tokenAllows,
  verifyCapabilityToken,
} from "@/lib/hermes/capability-token.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import {
  getActiveRuntimeRun,
  parseRuntimeRunDispatch,
} from "@/lib/hermes/run-store.ts";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import {
  getConversationById,
  getConversationMessageByClientId,
  presentConversationMessage,
} from "@/lib/conversations/store.ts";
import { recordExternalAgentTurn } from "@/lib/conversations/external-agent-turns.ts";
import {
  abortRun as abortMaxResearchRun,
  startRun as startMaxResearchRun,
} from "@/lib/max-research/runtime-run-manager.ts";
import { observeMaxResearchConversationTurn } from "@/lib/max-research/conversation-persistence.ts";
import {
  findCapabilityConflict,
  modelLaunchableRuntimeAgents,
  runtimeAgentById,
  type CapabilitySurface,
} from "@/lib/hermes/capability-combinations.ts";
import {
  listAgentLaunchRequestsAfter,
  recordAgentLaunchRequest,
  releaseAgentLaunchRequestSlot,
  reserveAgentLaunchRequestSlot,
} from "@/lib/hermes/agent-launch-store.ts";
import { MAX_PARALLEL_AGENT_LAUNCHES } from "@/lib/hermes/agent-launch.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOOL = "agent_launch";
const MAX_BRIEF_LENGTH = 8_000;
const MAX_REASON_LENGTH = 240;

export async function POST(request: Request) {
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(
      capabilityForInternalToolRequest(request),
    );
    if (!verified.ok || !tokenAllows(verified.token, { tool: TOOL })) {
      throw new ApiError(
        403,
        "agent_launch_capability_denied",
        "Launching a runtime agent is not authorized for this turn.",
      );
    }
    const session = getRuntimeSessionById(
      Number(verified.token.breadboardSessionId),
    );
    if (
      !session ||
      session.user_id === null ||
      session.conversation_id === null ||
      !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(
        403,
        "agent_launch_session_scope_mismatch",
        "Agent launch session scope is invalid.",
      );
    }
    // The active parent run supplies the authenticated origin and the assistant
    // row a private worker belongs to. Surface-launched agents also need it for
    // delivery; server-started Max Research needs it for durable attachment.
    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(
        409,
        "agent_launch_run_required",
        "Launching a runtime agent requires a current chat run.",
      );
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (!decision || !decision.allowedTools.includes(TOOL)) {
      throw new ApiError(
        403,
        "agent_launch_capability_denied",
        "Launching a runtime agent is not authorized for this turn.",
      );
    }

    const body = await readJsonBody(request, 32 * 1024);
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const agentId =
      typeof args.agent === "string" ? args.agent.trim().toLowerCase() : "";
    const brief =
      typeof args.brief === "string"
        ? args.brief.trim().slice(0, MAX_BRIEF_LENGTH)
        : "";
    const reason =
      typeof args.reason === "string"
        ? args.reason.trim().replace(/\s+/g, " ").slice(0, MAX_REASON_LENGTH)
        : "";
    // A delegated worker is never the visible respondent. Its output must
    // always come back through the Super Agent, even if an older model sends
    // the retired `await_result: false` option.
    const awaitResult = true;

    const surface = session.surface as CapabilitySurface;
    const launchable = modelLaunchableRuntimeAgents(surface);
    const agent = launchable.find((candidate) => candidate.id === agentId);
    if (!agent) {
      // Distinguish the three ways this goes wrong, because the model can
      // recover from each of them differently: pick another agent, use the
      // other surface, or tell the user to open the form themselves.
      const known = runtimeAgentById(agentId);
      if (!known) {
        throw new ApiError(
          404,
          "agent_launch_unknown_agent",
          `There is no runtime agent with the id "${agentId}". Use one of the ids listed in your context: ${launchable
            .map((candidate) => `${candidate.id} (${candidate.name})`)
            .join(", ")}.`,
        );
      }
      if (!known.surfaces.includes(surface)) {
        throw new ApiError(
          400,
          "agent_launch_surface_unavailable",
          `${known.name} does not run on this surface, so it cannot be started from this chat.`,
        );
      }
      throw new ApiError(
        400,
        "agent_launch_not_launchable",
        `${known.name} is started from its own form rather than from a brief, so only the user can start it. Tell them to send ${known.command} and fill it in.`,
      );
    }
    if (!brief) {
      throw new ApiError(
        400,
        "agent_launch_brief_required",
        `A brief is required: it is the whole instruction ${agent.name} receives, and it cannot see this conversation.`,
      );
    }
    // The reason is the decision, not paperwork. The directive's launch test —
    // name what this agent reaches that the turn cannot — went unenforced, so a
    // launch made on topic match alone looked exactly like a considered one.
    // Requiring the line at the boundary makes the model state its case before
    // the user is asked to wait, and the confirmation chip and evidence ledger
    // show that case verbatim.
    if (!reason) {
      throw new ApiError(
        400,
        "agent_launch_reason_required",
        `A reason is required: one line naming what ${agent.name} reaches that this turn does not — a mailbox, a repository, a browser, a persistent workspace, a file kind. If you cannot name one, do not launch; answer the request yourself.`,
      );
    }
    // A slash-prefixed brief is a capability expression, not a self-contained
    // instruction for an isolated specialist. Reject it at the tool boundary
    // even though the structured client path no longer replays the command.
    const conflict = findCapabilityConflict({
      text: `${agent.command} ${brief}`,
      surface,
    });
    if (conflict) {
      throw new ApiError(400, conflict.code, conflict.message);
    }
    // A second worker has to be a different job. The narrow case caught here is
    // the literal same job twice — one agent, one brief — which is what a retry
    // loop or a thoroughness reflex produces, never a considered batch. Two
    // different briefs to the same agent stay allowed: they can be genuinely
    // independent parts.
    const normalizedBrief = brief.replace(/\s+/g, " ").toLowerCase();
    const duplicate = listAgentLaunchRequestsAfter({
      runId: run.id,
      afterId: 0,
    }).some(
      (queued) =>
        queued.agentId === agent.id &&
        queued.brief.replace(/\s+/g, " ").toLowerCase() === normalizedBrief,
    );
    if (duplicate) {
      throw new ApiError(
        409,
        "agent_launch_duplicate_job",
        `${agent.name} is already queued with this exact brief. One worker owns one job — wait for its result instead of doubling it, and launch a second worker only for a genuinely different part of the work.`,
      );
    }

    const originClientMessageId =
      parseRuntimeRunDispatch(run).clientMessageId?.trim() || undefined;
    if (!originClientMessageId) {
      throw new ApiError(
        409,
        "agent_launch_origin_required",
        "This delegated run cannot be attached because its originating assistant turn is missing.",
      );
    }

    // Independent workers get distinct hidden transcript turns, so a Super
    // Agent may staff a small batch in one response. The ceiling prevents a
    // model loop from turning one user message into an unbounded fan-out.
    if (!reserveAgentLaunchRequestSlot(run.id)) {
      throw new ApiError(
        429,
        "agent_launch_batch_limit_reached",
        `This assistant turn already launched ${MAX_PARALLEL_AGENT_LAUNCHES} workers. Finish the batch with those results before starting another round.`,
      );
    }
    try {
      const workerClientMessageId = `agent-launch-${randomUUID()}`;

    // Max Research is read-only, approval-free, and commonly takes close to an
    // hour. Start it at the authenticated tool boundary instead of asking the
    // current page to start it after the parent turn: if the user navigates
    // away two seconds after Send, this request still completes and the run is
    // already attached to the originating assistant row when they return.
    let startedRun:
      | { kind: "max_research"; runId: string; query: string }
      | undefined;
    if (agent.id === "max-research") {
      const conversation = getConversationById(session.conversation_id);
      if (!conversation || conversation.user_id !== session.user_id) {
        throw new ApiError(
          409,
          "agent_launch_conversation_missing",
          "The conversation for this delegated run could not be found.",
        );
      }
      const dispatch = parseRuntimeRunDispatch(run);
      const originMessage = getConversationMessageByClientId(
        conversation.id,
        originClientMessageId,
        "assistant",
      );
      const originMetadata = originMessage
        ? presentConversationMessage(originMessage).metadata
        : {};
      const deliveryChannel =
        originMetadata.deliveryChannel === "telegram" ||
        originMetadata.deliveryChannel === "whatsapp"
          ? originMetadata.deliveryChannel
          : undefined;
      const maxRun = await startMaxResearchRun({
        userId: session.user_id,
        requestId: workerClientMessageId,
        question: brief,
        model:
          dispatch.model?.modelID ?? dispatch.modelIdentity?.modelID ?? "",
        reasoningEffort: dispatch.variant ?? "high",
        baseUrl: resolveChatmockBaseUrl(request).baseURL,
      });
      startedRun = {
        kind: "max_research",
        runId: maxRun.runId,
        query: brief,
      };
      try {
        recordExternalAgentTurn({
          conversation,
          clientMessageId: workerClientMessageId,
          surface,
          // Private worker turns are hidden by metadata, not by violating the
          // canonical store's non-empty message contract. Keep the exact brief
          // that was sealed into the Runtime launch so replay and audit retain
          // what this worker was actually asked to do.
          userContent: brief,
          run: startedRun,
          delegatedAgentRun: true,
          internalAgentContinuation: true,
          delegatedAgentReason: reason,
          deliveryChannel,
        });
        observeMaxResearchConversationTurn({
          userId: session.user_id,
          conversationId: conversation.id,
          clientMessageId: workerClientMessageId,
          runId: maxRun.runId,
        });
      } catch (error) {
        await abortMaxResearchRun(session.user_id, maxRun.runId).catch(
          () => false,
        );
        throw error;
      }
    }

    const queued = recordAgentLaunchRequest({
      runId: run.id,
      workerClientMessageId,
      agentId: agent.id,
      agentName: agent.name,
      command: agent.command,
      brief,
      reason,
      awaitResult,
      requiresApproval: agent.requiresLaunchApproval,
      originClientMessageId,
      ...(startedRun ? { startedRun } : {}),
    });
    if (!queued) {
      throw new ApiError(
        429,
        "agent_launch_limit_reached",
        "This turn has already queued as many agent launches as it may. Finish with what you have and let the user decide what runs next.",
      );
    }

    recordAuditEvent({
      eventType: "agent.launch_requested",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        agentId: agent.id,
        surface: session.surface,
        awaitResult,
        tool: TOOL,
      },
    });
      return NextResponse.json({
        ok: true,
        data: {
          status: "queued",
          agent: agent.name,
          agentId: agent.id,
          requestId: queued.requestId,
          confirmationRequired: agent.requiresLaunchApproval,
          effect: startedRun
            ? `${agent.name} is running privately as part of this batch. Its card is not shown to the user.`
            : `${agent.name} starts privately after this turn as part of this batch. Its card is not shown to the user.`,
          continuation:
            "Each worker result is returned as a new internal turn. Summarize useful results as they arrive, say when other workers are still running, and present any artifact or file produced.",
          instruction: `Do not ask for approval, mention a run card, or invent output. Briefly say that you are checking with ${agent.name}; when its result returns, speak as the Super Agent and summarize it.`,
        },
      });
    } finally {
      releaseAgentLaunchRequestSlot(run.id);
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
