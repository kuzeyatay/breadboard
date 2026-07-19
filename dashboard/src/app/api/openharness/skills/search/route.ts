import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled } from "@/lib/openharness/route-helpers.ts";
import {
  conditionalSkillRelevant,
  searchSkillCatalog,
} from "@/lib/openharness/skills.ts";
import {
  getActiveCapabilityDecision,
  recordAuditEvent,
} from "@/lib/openharness/runtime-store.ts";
import { authorizeRuntimeSession } from "@/lib/openharness/session-service.ts";
import { decideCapabilityMode } from "@/lib/openharness/capability-policy.ts";

export const dynamic = "force-dynamic";

// Search the official skill ecosystem. Terminal/scout surface only — this is a
// dashboard-user action (authenticated). Returns candidate METADATA only; no
// download or install happens here.
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const query = new URL(request.url).searchParams.get("q") ?? "";
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const runtimeSessionId = Number(url.searchParams.get("sessionId"));
    const includeReview = url.searchParams.get("includeReview") === "1";
    const session =
      Number.isInteger(runtimeSessionId) && runtimeSessionId > 0
        ? authorizeRuntimeSession(userId, runtimeSessionId)
        : null;
    const decision = session
      ? getActiveCapabilityDecision(session.row.id)
      : null;
    const outcome = url.searchParams.get("outcome")?.trim().slice(0, 4_000) ?? "";
    const preview = session && outcome
      ? decideCapabilityMode({
          surface: session.row.surface,
          userId,
          requestedOutcome: outcome,
          authorizedRoot: session.activeDirectory,
        })
      : null;
    const mode =
      decision?.mode === "scoped_implementation" ||
      preview?.mode === "scoped_implementation"
        ? "scoped_implementation"
        : decision?.mode ?? preview?.mode ?? "knowledge";
    const page = await searchSkillCatalog({ query, cursor });
    const candidates = page.candidates.filter((candidate) => {
      const eligibility = candidate.classification.classification;
      if (eligibility === "eligible_general") return true;
      if (
        eligibility === "eligible_coding_conditional" &&
        mode === "scoped_implementation" &&
        session?.row.surface === "dashboard_terminal" &&
        conditionalSkillRelevant(candidate, outcome || decision?.requestedOutcome)
      ) return true;
      return includeReview && (eligibility === "needs_review" || eligibility === "unknown");
    });
    recordAuditEvent({
      eventType: "skill.search",
      userId,
      payload: {
        query: query.slice(0, 200),
        resultCount: candidates.length,
        provider: page.provider,
        stale: page.stale,
        capabilityMode: mode,
      },
    });
    return NextResponse.json({
      candidates,
      nextCursor: page.nextCursor,
      provider: page.provider,
      stale: page.stale,
      capabilityMode: mode,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
