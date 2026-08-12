import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getPlanStore } from "@/lib/plan/instance.ts";
import { readTaskCreate, readTaskQuery } from "@/lib/plan/payload.ts";

export const dynamic = "force-dynamic";

/**
 * Filtered cards across every project. The calendar view uses `?dueFrom=&dueTo=`
 * to draw the week's due work beside the week's events.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const tasks = getPlanStore().queryTasks(userId, readTaskQuery(url.searchParams));
    return NextResponse.json({ tasks });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request);
    const task = getPlanStore().createTask(userId, readTaskCreate(body));
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
