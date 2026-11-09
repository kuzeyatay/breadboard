import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Startup can resume existing envelopes and teams only. It cannot supply a
 * message, identity, target, or permission; normal dispatch reauthorizes work. */
export async function POST(request: Request) {
  const configured = process.env.BREADBOARD_HERMES_TOOL_SECRET?.trim() || process.env.HERMES_TOOL_SECRET?.trim();
  if (!configured) return new NextResponse(null, { status: 404 });
  const header = request.headers.get("authorization") ?? "";
  const supplied = Buffer.from(header.startsWith("Bearer ") ? header.slice(7).trim() : "");
  const expected = Buffer.from(configured);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return new NextResponse(null, { status: 401 });
  }
  // The endpoint is a signal, never a command envelope. Do not read an
  // unbounded request body or let callers choose what will be dispatched.
  if (new URL(request.url).search || request.headers.get("content-length") !== "0" || request.headers.has("transfer-encoding")) {
    return new NextResponse(null, { status: 400 });
  }
  const [{ recoverChatMessages }, { recoverSwarms }] = await Promise.all([
    import("@/lib/conversations/coordination.ts"), import("@/lib/swarm/pump.ts"),
  ]);
  recoverChatMessages();
  recoverSwarms();
  return NextResponse.json({ accepted: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
