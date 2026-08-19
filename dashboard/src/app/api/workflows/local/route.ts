// The user's saved workflows. Kept at this path because the chat palette, the
// super-agent inventory, and the canvas home all read the same list; only the
// backing store changed from n8n to Breadboard's own tables.

import { NextRequest, NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { createWorkflow, listWorkflows } from "@/lib/workflows/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json(
      { workflows: listWorkflows(userId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = (await request.json().catch(() => ({}))) as { name?: unknown; description?: unknown };
    const workflow = createWorkflow(userId, {
      name: typeof body.name === "string" ? body.name : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
    });
    return NextResponse.json({ id: workflow.id, name: workflow.name }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
