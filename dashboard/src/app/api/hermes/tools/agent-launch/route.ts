// `agent_launch` — a super-agent turn starting one of the runtime agents.
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
import { getConversationById } from "@/lib/conversations/store.ts";
import { attachExternalAgentRun } from "@/lib/conversations/external-agent-turns.ts";
import {
  abortRun as abortMaxResearchRun,
  startRun as startMaxResearchRun,
} from "@/lib/max-research/runtime-run-manager.ts";
import {
  findCapabilityConflict,
  modelLaunchableRuntimeAgents,
  runtimeAgentById,
  type CapabilitySurface,
} from "@/lib/hermes/capability-combinations.ts";
import {
  countAgentLaunchRequests,
  recordAgentLaunchRequest,
} from "@/lib/hermes/agent-launch-store.ts";

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
            .map((candidate) => candidate.id)
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

    const originClientMessageId =
      parseRuntimeRunDispatch(run).clientMessageId?.trim() || undefined;
    if (!originClientMessageId) {
      throw new ApiError(
        409,
        "agent_launch_origin_required",
        "This delegated run cannot be attached because its originating assistant turn is missing.",
      );
    }

    // One assistant message can own one inline run card. If the model needs a
    // chain, the completed run returns in a later turn where the next card has
    // its own owner. Accepting two here would either overwrite the first card
    // or force one of the prompts into a synthetic user message.
    if (countAgentLaunchRequests(run.id) > 0) {
      throw new ApiError(
        409,
        "agent_launch_one_per_turn",
        "This assistant turn already delegated one runtime agent. Wait for its result before starting another.",
      );
    }

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
      const maxRun = await startMaxResearchRun({
        userId: session.user_id,
        requestId: originClientMessageId,
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
        attachExternalAgentRun({
          conversation,
          clientMessageId: originClientMessageId,
          run: startedRun,
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
          ? `${agent.name} is running privately. Its card is not shown to the user.`
          : `${agent.name} starts privately after this turn. Its card is not shown to the user.`,
        continuation:
          "You will be given its result as a new internal turn. Summarize it in your own response and present any artifact or file it produced.",
        instruction: `Do not ask for approval, mention a run card, or invent output. Briefly say that you are checking with ${agent.name}; when its result returns, speak as the Super Agent and summarize it.`,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
