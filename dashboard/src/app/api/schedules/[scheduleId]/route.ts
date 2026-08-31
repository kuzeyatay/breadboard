import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";
import { getScheduledChatJobStore } from "@/lib/schedules/instance.ts";
import {
  presentScheduledChatJob,
  ScheduleError,
  type UpdateScheduledChatInput,
} from "@/lib/schedules/store.ts";

export const dynamic = "force-dynamic";

function scheduleId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ScheduleError(400, "That schedule id is not valid.");
  }
  return id;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ scheduleId: string }> },
) {
  try {
    const userId = await requireUserId();
    const id = scheduleId((await params).scheduleId);
    const body = await readJsonBody(request);

    const update: UpdateScheduledChatInput = {};
    if (typeof body.title === "string") update.title = body.title;
    if (typeof body.prompt === "string") update.prompt = body.prompt;
    if (typeof body.cron === "string") update.cron = body.cron;
    if (typeof body.model === "string") update.model = body.model;
    if (typeof body.reasoningEffort === "string") {
      update.reasoningEffort = body.reasoningEffort;
    }
    if (typeof body.enabled === "boolean") update.enabled = body.enabled;
    if (body.surface === "garden_chat" || body.surface === "dashboard_terminal") {
      update.surface = body.surface;
    }
    if (typeof body.gardenSlug === "string") update.gardenSlug = body.gardenSlug.trim();

    const store = getScheduledChatJobStore();
    const existing = store.require(userId, id);
    const targetSurface = update.surface ?? existing.surface;
    const targetGarden = update.gardenSlug ?? existing.garden_slug;
    if (targetSurface === "garden_chat" && targetGarden) {
      authorizeGardenAccess(userId, targetGarden);
    }

    return NextResponse.json({
      schedule: presentScheduledChatJob(store.update(userId, id, update)),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ scheduleId: string }> },
) {
  try {
    const userId = await requireUserId();
    const id = scheduleId((await params).scheduleId);
    const deleted = getScheduledChatJobStore().delete(userId, id);
    if (!deleted) throw new ScheduleError(404, "This schedule no longer exists.");
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
