import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  ApiError,
} from "@/lib/openharness/route-helpers.ts";
import { executeGBrainTool } from "@/lib/openharness/gbrain-tools.ts";
import { capabilityForInternalToolRequest } from "@/lib/openharness/tool-service-auth.ts";

export const dynamic = "force-dynamic";

// Internal server-to-server endpoint invoked by the OpenHarness GBrain tool
// adapter. It is NOT a browser API. Authentication is the same short-lived HMAC
// capability token the gateway mints; the token pins the user, surface, and
// authorized garden set. GBrain source ids are derived server-side from that
// authorized set, so a model-supplied garden or source id cannot escape scope.
// Only read/synthesis operations are reachable — capture and edits go through
// Breadboard proposals, not this route.
export async function POST(request: Request) {
  try {
    requireEnabled();
    const authHeader = request.headers.get("authorization");
    const bearer = authHeader?.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : undefined;
    const body = await readJsonBody(request);
    const token =
      capabilityForInternalToolRequest(request) ??
      bearer ??
      (typeof body.token === "string" ? body.token : undefined);
    if (!token) throw new ApiError(401, "missing_capability", "A capability token is required.");

    const tool = typeof body.tool === "string" ? body.tool : "";
    if (!tool) throw new ApiError(400, "missing_tool", "A tool name is required.");
    const args = body.args && typeof body.args === "object" ? (body.args as Record<string, unknown>) : {};

    const result = await executeGBrainTool({ rawToken: token, tool, args });
    if (!result.ok && /token/i.test(result.error ?? "")) {
      return NextResponse.json(result, { status: 401 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
