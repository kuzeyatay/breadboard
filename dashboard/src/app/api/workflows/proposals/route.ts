import { NextResponse } from "next/server";

import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import {
  acceptProposal,
  declineProposal,
  listProposals,
  reopenProposal,
} from "@/lib/workflows/proposals";

export const dynamic = "force-dynamic";

// The review half of the proposal loop.
//
// Everything here needs the user's own session, which is the point: the agent
// may offer an automation, and only a person may agree to one. Accepting is
// what copies a draft into `workflows` and makes it something that can run.

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const wanted =
      status === "accepted" || status === "declined" || status === "superseded"
        ? status
        : "pending";
    return NextResponse.json({ ok: true, proposals: listProposals(userId, wanted) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json()) as { id?: unknown; action?: unknown };
    const id = typeof body?.id === "string" ? body.id : "";
    const action = typeof body?.action === "string" ? body.action : "";
    if (!id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }

    if (action === "accept") {
      const accepted = acceptProposal(userId, id);
      if (!accepted) {
        return NextResponse.json(
          { ok: false, error: "No pending proposal with that id." },
          { status: 404 },
        );
      }
      return NextResponse.json({
        ok: true,
        workflowId: accepted.workflowId,
        proposal: accepted.proposal,
      });
    }

    if (action === "decline") {
      if (!declineProposal(userId, id)) {
        return NextResponse.json(
          { ok: false, error: "No pending proposal with that id." },
          { status: 404 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "reopen") {
      if (!reopenProposal(userId, id)) {
        return NextResponse.json(
          { ok: false, error: "No declined proposal with that id." },
          { status: 404 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { ok: false, error: `action must be accept, decline, or reopen` },
      { status: 400 },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}
