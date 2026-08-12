import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";
import { getScheduledChatJobStore } from "@/lib/schedules/instance.ts";
import { presentScheduledChatJob, ScheduleError } from "@/lib/schedules/store.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    const store = getScheduledChatJobStore();
    return NextResponse.json({
      // Wrapped rather than point-free: the presenter takes an optional clock,
      // and a bare reference would hand it the array index.
      schedules: store.list(userId).map((row) => presentScheduledChatJob(row)),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request);
    const surface = body.surface === "garden_chat" ? "garden_chat" : "dashboard_terminal";
    const gardenSlug = typeof body.gardenSlug === "string" ? body.gardenSlug.trim() : "";

    if (surface === "garden_chat") {
      if (!gardenSlug) throw new ScheduleError(400, "A garden schedule needs a garden.");
      // Fail now rather than at 3am: prove the garden is reachable by this user.
      authorizeGardenAccess(userId, gardenSlug);
    }

    const created = getScheduledChatJobStore().create(userId, {
      title: typeof body.title === "string" ? body.title : "",
      prompt: typeof body.prompt === "string" ? body.prompt : "",
      cron: typeof body.cron === "string" ? body.cron : "",
      surface,
      gardenSlug: surface === "garden_chat" ? gardenSlug : null,
      promptSlug: typeof body.promptSlug === "string" ? body.promptSlug : null,
      enabled: body.enabled !== false,
    });
    return NextResponse.json({ schedule: presentScheduledChatJob(created) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
