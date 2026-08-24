// `workflow_propose` — the agent offering to automate something, not doing it.
//
// The tool can create a proposal and read the repetition evidence behind one.
// It cannot create a workflow, edit one, run one, or accept its own offer:
// those all live behind a request carrying the user's own session. That
// separation is the whole feature. An agent that could write into `workflows`
// would be able to give itself a standing instruction, which is a much larger
// grant than "may suggest things".

import { NextResponse } from "next/server";

import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  ApiError,
} from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import {
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import {
  conversationIsTemporary,
  getConversationById,
} from "@/lib/conversations/store.ts";
import {
  listProposals,
  proposeWorkflow,
  MAX_PENDING_PROPOSALS,
} from "@/lib/workflows/proposals";
import { evidenceLines, repetitionSignals } from "@/lib/workflows/repetition";
import type { TriggerKind } from "@/lib/workflows/native-execution";

export const dynamic = "force-dynamic";

const TRIGGERS: readonly TriggerKind[] = ["manual", "chat", "webhook", "schedule"];

export async function POST(request: Request) {
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: "workflow_propose" })) {
      throw new ApiError(
        403,
        "workflow_propose_denied",
        "Proposing an automation is not authorized here.",
      );
    }
    const session = getRuntimeSessionById(Number(verified.token.breadboardSessionId));
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
        "workflow_propose_scope_mismatch",
        "The runtime session scope is invalid.",
      );
    }

    const body = await readJsonBody(request, 128 * 1024);
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const action = typeof args.action === "string" ? args.action : "propose";

    if (action === "evidence") {
      const signals = repetitionSignals(session.user_id, { limit: 5 });
      return NextResponse.json({
        ok: true,
        data: {
          signals: signals.map((signal) => ({
            terms: signal.terms,
            occurrences: signal.occurrences,
            distinctDays: signal.distinctDays,
            firstSeen: signal.firstSeen,
            lastSeen: signal.lastSeen,
            examples: signal.examples,
          })),
          note:
            signals.length === 0
              ? "Nothing has been asked often enough, across enough separate days, to call a routine."
              : `${signals.length} recurring request${signals.length === 1 ? "" : "s"}. Propose only what an automation would genuinely save.`,
        },
      });
    }

    if (action === "pending") {
      return NextResponse.json({
        ok: true,
        data: { proposals: listProposals(session.user_id, "pending") },
      });
    }

    if (action !== "propose") {
      throw new ApiError(400, "unknown_action", `Unknown action "${action}".`);
    }

    // A temporary chat leaves no trace, and an automation is the most durable
    // trace there is.
    if (conversationIsTemporary(getConversationById(session.conversation_id))) {
      return NextResponse.json({
        ok: true,
        data: {
          created: false,
          reason: "temporary_chat",
          note:
            "This is a temporary chat, so nothing from it is kept — including " +
            "an automation. Offer it again in an ordinary conversation.",
        },
      });
    }

    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!name) throw new ApiError(400, "name_required", "name is required.");

    const rawEvidence = Array.isArray(args.evidence)
      ? args.evidence.filter((item): item is string => typeof item === "string")
      : [];
    // Attach the measured evidence when the agent did not bring its own, so a
    // proposal is never presented on nothing but confidence.
    const evidence =
      rawEvidence.length > 0
        ? rawEvidence
        : (repetitionSignals(session.user_id, { limit: 1 })[0]
            ? evidenceLines(repetitionSignals(session.user_id, { limit: 1 })[0])
            : []);

    const result = proposeWorkflow({
      userId: session.user_id,
      conversationId: session.conversation_id,
      name,
      description: typeof args.description === "string" ? args.description : "",
      rationale: typeof args.rationale === "string" ? args.rationale : "",
      evidence,
      triggerKind:
        typeof args.triggerKind === "string" &&
        (TRIGGERS as readonly string[]).includes(args.triggerKind)
          ? (args.triggerKind as TriggerKind)
          : "manual",
      state: args.state,
    });

    recordAuditEvent({
      eventType: "workflow.tool.propose",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        proposalId: result.proposal.id,
        created: result.created,
        reason: result.reason ?? null,
        name: result.proposal.name,
      },
    });

    const note = result.created
      ? "Proposed. Tell the user it is waiting for them on the Workflows page — " +
        "it does not exist as an automation until they accept it."
      : result.reason === "already_declined"
        ? "They have already turned this down. Do not offer it again unless they raise it."
        : result.reason === "already_pending"
          ? "This is already waiting for them; there is nothing to add by offering twice."
          : `They already have ${MAX_PENDING_PROPOSALS} offers waiting. Leave it until some are answered.`;

    return NextResponse.json({
      ok: true,
      data: { created: result.created, reason: result.reason ?? null, proposal: result.proposal, note },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
