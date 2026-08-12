import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { HERMES_SURFACES, type HermesSurface } from "@/lib/hermes/config.ts";
import { listActiveRuntimeRunsForUser } from "@/lib/hermes/run-store.ts";
import { getScheduledChatJobStore } from "@/lib/schedules/instance.ts";
import {
  presentScheduledChatJob,
} from "@/lib/schedules/store.ts";
import { scheduleTargetLabel } from "@/lib/schedules/types.ts";
import { listLiveBreadboardProcesses } from "@/lib/processes/live-processes.ts";
import type { ProcessesSnapshot } from "@/lib/processes/types.ts";

export const dynamic = "force-dynamic";

function isHermesSurface(value: string): value is HermesSurface {
  return (HERMES_SURFACES as readonly string[]).includes(value);
}

export async function GET() {
  try {
    const userId = await requireUserId();
    const activeChats = listActiveRuntimeRunsForUser(userId)
      .filter((run) => isHermesSurface(run.surface))
      .map((run) => ({
        id: run.id,
        conversationId: run.conversationId,
        title: run.conversationTitle,
        instruction: run.instruction,
        surface: run.surface as HermesSurface,
        gardenId: run.gardenId,
        pageSlug: run.pageSlug,
        startedAt: run.startedAt,
      }));

    // Never infer liveness from the Plan board. It is durable history and can
    // retain an In progress card after a crash; only the live registry belongs
    // in Active now.
    const activeProcesses = listLiveBreadboardProcesses(userId);

    const schedules = getScheduledChatJobStore()
      .list(userId)
      // Wrapped rather than point-free: the presenter takes an optional clock,
      // and a bare reference would hand it the array index.
      .map((row) => presentScheduledChatJob(row))
      .map((job) => ({
        id: job.id,
        title: job.title,
        enabled: job.enabled,
        cadence: job.cronDescription,
        target: scheduleTargetLabel(job),
        nextRunAt: job.nextRunAt,
        lastRunAt: job.lastRunAt,
        lastStatus: job.lastStatus,
      }));

    const snapshot: ProcessesSnapshot = {
      activeChats,
      activeProcesses,
      schedules,
      // Hooks currently have an honest empty state. Keeping them in the shared
      // contract means persisted hooks can join this overview without a second
      // panel or a client-side fan-out later.
      hooks: [],
      generatedAt: new Date().toISOString(),
    };
    return NextResponse.json(snapshot);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
