// Whether this machine can teach a workflow, and starting a session on it.
//
// The Workflows page asks the GET before it offers the button, so an install
// with no capture backend explains itself instead of failing after the user has
// already started demonstrating.

import { NextRequest, NextResponse } from "next/server";

import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { teachAvailability } from "@/lib/teach/backends";
import { ensureTeachRecovery } from "@/lib/teach/recovery";
import { startTeaching } from "@/lib/teach/session-manager";
import { speechAvailability } from "@/lib/teach/transcription";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    ensureTeachRecovery();
    await requireUserId();
    const availability = teachAvailability();
    const speech = await speechAvailability();
    return NextResponse.json(
      {
        ...availability,
        speech: {
          ready: speech.ready,
          installable: speech.installable,
          model: speech.model,
          ...(speech.reason ? { reason: speech.reason } : {}),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    // Settle anything a previous process left claiming to be live.
    ensureTeachRecovery();
    const userId = await requireUserId();
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      objective?: unknown;
      reteachWorkflowId?: unknown;
      captureFrames?: unknown;
    };

    const result = await startTeaching({
      userId,
      name: typeof body.name === "string" ? body.name : undefined,
      objective: typeof body.objective === "string" ? body.objective : undefined,
      reteachWorkflowId:
        typeof body.reteachWorkflowId === "string" ? body.reteachWorkflowId : null,
      captureFrames: body.captureFrames !== false,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
