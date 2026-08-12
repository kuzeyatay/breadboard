// "Run now" — the same code path the scheduler tick uses, without waiting for the
// next occurrence. It deliberately does not advance `next_run_at`: a manual run is
// an extra run, not a replacement for the scheduled one.

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { getScheduledChatJobStore } from "@/lib/schedules/instance.ts";
import { runScheduledChatJob } from "@/lib/schedules/runner.ts";
import { presentScheduledChatJob, ScheduleError } from "@/lib/schedules/store.ts";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ scheduleId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const id = Number((await params).scheduleId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ScheduleError(400, "That schedule id is not valid.");
    }

    const store = getScheduledChatJobStore();
    const job = store.require(userId, id);
    const result = await runScheduledChatJob(job);
    store.recordRun(job.id, {
      status: result.status,
      conversationId: result.conversationId,
      error: result.error ?? null,
    });

    return NextResponse.json({
      started: result.status === "ok",
      conversationId: result.conversationId,
      error: result.error ?? null,
      schedule: presentScheduledChatJob(store.require(userId, id)),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
