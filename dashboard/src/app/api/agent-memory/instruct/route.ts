import { NextResponse } from "next/server";
import {
  applyMemoryInstruction,
  MAX_INSTRUCTION_CHARACTERS,
} from "@/lib/conversations/memory-instruction";
import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/** Apply one plain-language memory instruction typed in Settings -> Memory. */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
    if (!instruction) {
      throw new RouteError(400, "Type what you would like Breadboard to remember.");
    }
    if (instruction.length > MAX_INSTRUCTION_CHARACTERS) {
      throw new RouteError(
        400,
        `A memory instruction must be ${MAX_INSTRUCTION_CHARACTERS} characters or fewer.`,
      );
    }

    const outcome = await applyMemoryInstruction({ userId, instruction });
    if (outcome.result === "failed") {
      throw new RouteError(503, outcome.reason ?? "That instruction could not be applied.");
    }
    return NextResponse.json({ ok: true, ...outcome });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
