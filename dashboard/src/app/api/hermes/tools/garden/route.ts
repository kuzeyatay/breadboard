import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  ApiError,
} from "@/lib/hermes/route-helpers.ts";
import { executeGardenTool } from "@/lib/hermes/garden-tools.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";

export const dynamic = "force-dynamic";

// Internal server-to-server endpoint invoked by the Hermes garden/quartz
// tool adapter. It is NOT authenticated by a browser session — it authenticates
// solely via the short-lived HMAC capability token the gateway minted and placed
// in the session's isolated workspace. The token pins the garden scope, so a
// model-supplied garden id cannot escape it. Only the Hermes process that
// holds the workspace file can present a valid token.
export async function POST(request: Request) {
  try {
    requireEnabled();
    const authHeader = request.headers.get("authorization");
    const bearer = authHeader?.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : undefined;
    const body = await readJsonBody(request);
    const token = capabilityForInternalToolRequest(request) ??
      bearer ??
      (typeof body.token === "string" ? body.token : undefined);
    if (!token) throw new ApiError(401, "missing_capability", "A capability token is required.");

    const tool = typeof body.tool === "string" ? body.tool : "";
    if (!tool) throw new ApiError(400, "missing_tool", "A tool name is required.");
    const args = body.args && typeof body.args === "object" ? (body.args as Record<string, unknown>) : {};

    const result = await executeGardenTool({ rawToken: token, tool, args });
    // Return 200 even for tool-level failures so the model receives a structured
    // error it can react to, but 401 for token failures so callers don't retry.
    if (!result.ok && /token/i.test(result.error ?? "")) {
      return NextResponse.json(result, { status: 401 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
