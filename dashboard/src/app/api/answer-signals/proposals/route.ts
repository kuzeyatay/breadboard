// The user's side of the loop: what the ratings have added up to, and the one
// decision that can turn any of it into behaviour.
//
// Everything reported here is recomputed from the signals on every read, so it
// cannot drift from the evidence. Only the *decisions* persist, and only an
// explicit accept writes anything: see `answer-signal-proposals.ts` for why a
// confirmed global preference is not something to infer silently.

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { listAnswerSignals } from "@/lib/hermes/answer-signals.ts";
import { analyzeAnswerSignals } from "@/lib/hermes/answer-signal-analysis.ts";
import {
  acceptProposal,
  decidedProposals,
  dismissProposal,
  pendingProposals,
  retractProposalDecision,
} from "@/lib/hermes/answer-signal-proposals.ts";
import { parseRequest } from "@/lib/humanizer/schemas.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const decideSchema = z.object({
  proposalId: z.string().min(1).max(200),
  action: z.enum(["accept", "dismiss", "retract"]),
});

function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function currentAnalysis(userId: number) {
  return analyzeAnswerSignals(listAnswerSignals(userId, { limit: 5_000 }));
}

export async function GET() {
  try {
    const userId = await requireUserId();
    const analysis = currentAnalysis(userId);
    return noStore({
      // The attribution table: which conditions the ratings actually cluster
      // on. This is the part meant to be read before anything is accepted.
      groups: analysis.groups,
      findings: analysis.findings,
      proposals: pendingProposals(userId, analysis.proposals),
      decided: decidedProposals(userId, analysis.proposals),
      considered: analysis.considered,
      excluded: analysis.excluded,
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const parsed = parseRequest(decideSchema, await request.json().catch(() => null));
    if (!parsed.ok) return noStore(parsed.failure, 422);

    if (parsed.value.action === "retract") {
      return noStore({
        retracted: retractProposalDecision(userId, parsed.value.proposalId),
      });
    }

    // Accepting is resolved against a freshly computed proposal rather than
    // against text the client sent: the sentence written to memory has to be
    // the one the evidence currently supports, not one a stale tab is holding.
    const analysis = currentAnalysis(userId);
    const proposal = analysis.proposals.find(
      (candidate) => candidate.id === parsed.value.proposalId,
    );
    if (!proposal) {
      return noStore({ error: "no_such_proposal" }, 404);
    }
    const decision =
      parsed.value.action === "accept"
        ? acceptProposal({ userId, proposal })
        : dismissProposal({
            userId,
            proposalId: proposal.id,
            content: proposal.content,
          });
    return noStore({ decision });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
