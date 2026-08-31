import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth.ts";
import {
  buildBrainGraph,
  buildBrainGraphAccessContext,
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

function errorResponse(error: unknown): NextResponse {
  const status =
    error instanceof BrainGraphAccessError
      ? error.status
      : typeof (error as { status?: unknown } | null)?.status === "number"
        ? ((error as { status: number }).status >= 400 &&
          (error as { status: number }).status < 600
            ? (error as { status: number }).status
            : 500)
        : 500;
  const message =
    status === 401
      ? "Sign in to view your Thought Topology."
      : status === 404
        ? "That Thought Topology scope is not available."
        : status < 500
          ? "That Thought Topology request is not valid."
          : "Thought Topology could not be loaded.";
  return NextResponse.json({ error: message }, { status, headers: PRIVATE_HEADERS });
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const context = buildBrainGraphAccessContext(userId);
    const { searchParams } = new URL(request.url);
    const scope = parseBrainScope(searchParams, context);
    const mode = searchParams.get("mode") === "full" ? "full" : "overview";
    const graph = await buildBrainGraph(context, scope, {
      mode,
      signal: request.signal,
    });
    return NextResponse.json(graph, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}
