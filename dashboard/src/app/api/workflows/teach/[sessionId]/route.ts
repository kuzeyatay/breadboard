// One teaching session: its state while recording, its draft once analysed, and
// the controls that move it between the two.
//
// The vocabulary is deliberately small. A browser can say pause, resume, finish
// or cancel about a session it started; it cannot reach a capture handle, a
// helper process, or the desktop.

import { NextRequest, NextResponse } from "next/server";

import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";
import { ensureTeachRecovery } from "@/lib/teach/recovery";
import {
  cancelTeaching,
  finishTeaching,
  pauseTeaching,
  processingStatus,
  resumeTeaching,
  reteachDiff,
  saveTeaching,
} from "@/lib/teach/session-manager";
import * as store from "@/lib/teach/store";
import type { DemonstratedProcedure } from "@/lib/teach/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  try {
    // Settle anything a previous process left claiming to be live.
    ensureTeachRecovery();
    const userId = await requireUserId();
    const { sessionId } = await context.params;
    const row = store.getDemonstration(userId, sessionId);
    if (!row) throw new RouteError(404, "That teaching session does not exist.");

    return NextResponse.json(
      {
        session: store.summarizeDemonstration(row),
        draft: store.readDraft(row),
        processing: processingStatus(sessionId),
        diff: reteachDiff(userId, sessionId),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  try {
    // Settle anything a previous process left claiming to be live.
    ensureTeachRecovery();
    const userId = await requireUserId();
    const { sessionId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      procedure?: unknown;
      answers?: unknown;
      retainRecording?: unknown;
    };

    switch (body.action) {
      case "pause":
        return NextResponse.json({ session: await pauseTeaching(userId, sessionId) });
      case "resume":
        return NextResponse.json({ session: await resumeTeaching(userId, sessionId) });
      case "finish":
        return NextResponse.json({ session: await finishTeaching(userId, sessionId) });
      case "cancel":
        return NextResponse.json({ session: await cancelTeaching(userId, sessionId) });
      case "save": {
        const answers =
          body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
            ? Object.fromEntries(
                Object.entries(body.answers as Record<string, unknown>)
                  .filter(([, value]) => typeof value === "string")
                  .map(([key, value]) => [key, value as string]),
              )
            : {};
        const result = await saveTeaching({
          userId,
          sessionId,
          procedure: (body.procedure as DemonstratedProcedure | undefined) ?? undefined,
          answers,
          retainRecording: body.retainRecording === true,
        });
        return NextResponse.json(result);
      }
      default:
        throw new RouteError(400, "Unknown action.");
    }
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  try {
    // Settle anything a previous process left claiming to be live.
    ensureTeachRecovery();
    const userId = await requireUserId();
    const { sessionId } = await context.params;
    return NextResponse.json({ session: await cancelTeaching(userId, sessionId) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
