import { NextResponse } from "next/server";

import { RecallError } from "@/lib/recall/errors.ts";
import { readRecallBody, recallErrorResponse } from "@/lib/recall/route-helpers.ts";
import { controlRecall, type RecallControlAction } from "@/lib/recall/service.ts";
import { requireUserId } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS: readonly RecallControlAction[] = ["start", "stop", "start-audio", "stop-audio"];

/** Start or stop capture from the settings tab. */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readRecallBody(request);
    const action = body.action;
    if (typeof action !== "string" || !ACTIONS.includes(action as RecallControlAction)) {
      throw new RecallError("invalid_input", {
        userMessage: `action must be one of: ${ACTIONS.join(", ")}.`,
      });
    }
    return NextResponse.json({
      result: await controlRecall(userId, action as RecallControlAction),
    });
  } catch (error) {
    return recallErrorResponse(error);
  }
}
