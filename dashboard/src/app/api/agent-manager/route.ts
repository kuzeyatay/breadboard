import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { AGENT_MANAGER_CATALOG, AGENT_MANAGER_WORKFLOWS } from "@/lib/agent-manager/catalog.ts";
import { managerSetups } from "@/lib/agent-manager/store.ts";
import { AgentManagerError, cancelAgentManagerOperation, readAgentManagerOperation, startAgentManagerOperation } from "@/lib/agent-manager/service.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import { dashboardDataDir } from "@/lib/runtime-paths.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function failure(error: unknown) {
  const runtimeResponse = runtimeAuthorityErrorResponse(error);
  if (runtimeResponse) return runtimeResponse;
  if (error instanceof RouteError || error instanceof AgentManagerError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  if (error instanceof SyntaxError) return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  return NextResponse.json({ ok: false, error: "Agent Manager could not reach the Runtime. Retry the status check." }, { status: 500 });
}
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const agentId = new URL(request.url).searchParams.get("agentId");
    if (agentId) return NextResponse.json({ ok: true, operation: await readAgentManagerOperation(userId, agentId) });
    return NextResponse.json({
      ok: true, agents: AGENT_MANAGER_CATALOG, workflows: AGENT_MANAGER_WORKFLOWS,
      storageRoot: dashboardDataDir(),
      bulkStorageRoot: process.env.BREADBOARD_BULK_DATA_DIR?.trim() || null,
      operationAgentIds: managerSetups(userId).map((saved) => saved.agent_id),
    });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 4096) return NextResponse.json({ ok: false, error: "Setup request is too large." }, { status: 413 });
    const operation = await startAgentManagerOperation(userId, JSON.parse(text));
    return NextResponse.json({ ok: true, operation }, { status: operation.finished ? 200 : 202 });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const agentId = new URL(request.url).searchParams.get("agentId");
    if (!agentId) throw new AgentManagerError(400, "Choose the agent whose setup should stop.");
    return NextResponse.json({ ok: true, operation: await cancelAgentManagerOperation(userId, agentId) });
  } catch (error) { return failure(error); }
}
