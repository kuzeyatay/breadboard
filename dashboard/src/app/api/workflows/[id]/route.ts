// One saved workflow: the canvas reads it on open and PUTs its serialized graph
// back on a debounce.

import { NextRequest, NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { deleteWorkflow, getWorkflow, updateWorkflow } from "@/lib/workflows/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NOT_FOUND = { error: "This workflow does not exist." };

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await context.params;
    const workflow = getWorkflow(userId, id);
    if (!workflow) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json(workflow, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      description?: unknown;
      state?: unknown;
    };
    const updated = updateWorkflow(userId, id, {
      name: typeof body.name === "string" ? body.name : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      state: body.state,
    });
    if (!updated) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await context.params;
    if (!deleteWorkflow(userId, id)) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
