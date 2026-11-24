// Standing "always allow" terminal command rules for the signed-in user.
// Rules are only ever created from a permission card (see the permissions
// route); this route lists and removes them.

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, ApiError } from "@/lib/hermes/route-helpers.ts";
import { recordAuditEvent } from "@/lib/hermes/runtime-store.ts";
import {
  listTerminalCommandRules,
  removeTerminalCommandRule,
} from "@/lib/hermes/terminal-command-rules.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ rules: listTerminalCommandRules(userId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError(400, "invalid_rule_id", "A valid rule id is required.");
    }
    if (!removeTerminalCommandRule(userId, id)) {
      throw new ApiError(404, "rule_not_found", "That rule no longer exists.");
    }
    recordAuditEvent({
      eventType: "terminal.command_rule_removed",
      runtimeSessionId: null,
      userId,
      payload: { ruleId: id },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
