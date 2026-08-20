import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth.ts";
import {
  buildBrainGraphAccessContext,
  expandBrainGraph,
} from "@/lib/profile/brain-graph.ts";
import {
  BrainGraphAccessError,
  parseBrainScope,
} from "@/lib/profile/brain-graph-auth.ts";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  Vary: "Cookie",
};

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const context = buildBrainGraphAccessContext(userId);
    const { searchParams } = new URL(request.url);
    const scope = parseBrainScope(searchParams, context);
    const nodeId = searchParams.get("node")?.trim() ?? "";
    if (!nodeId || nodeId.length > 320) {
      throw new BrainGraphAccessError(400, "invalid_node", "That Knowledge Map node is not available.");
    }
    const rawDepth = Number(searchParams.get("depth") ?? 1);
    if (!Number.isInteger(rawDepth) || rawDepth < 1 || rawDepth > 2) {
      throw new BrainGraphAccessError(400, "invalid_depth", "That expansion depth is not available.");
    }
    const graph = await expandBrainGraph(
      context,
      scope,
      nodeId,
      rawDepth,
      request.signal,
    );
    return NextResponse.json(graph, { headers: PRIVATE_HEADERS });
  } catch (error) {
    const rawStatus = (error as { status?: unknown } | null)?.status;
    const status =
      error instanceof BrainGraphAccessError
        ? error.status
        : typeof rawStatus === "number" && rawStatus >= 400 && rawStatus < 600
          ? rawStatus
          : 500;
    const message =
      status === 401
        ? "Sign in to view your Knowledge Map."
        : status === 404
          ? "That Knowledge Map node is not available."
          : status < 500
            ? "That Knowledge Map expansion is not valid."
            : "The Knowledge Map could not be expanded.";
    return NextResponse.json({ error: message }, { status, headers: PRIVATE_HEADERS });
  }
}
