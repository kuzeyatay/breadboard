import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth.ts";
import { getEventsSince, isTerminal } from "@/lib/codex/run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { runId } = await params;
    const url = new URL(request.url);
    const since = Number(request.headers.get("last-event-id") ?? url.searchParams.get("since") ?? 0) || 0;
    if (!(request.headers.get("accept") ?? "").includes("text/event-stream")) {
      return NextResponse.json({ ok: true, events: getEventsSince(userId, runId, since) });
    }

    const encoder = new TextEncoder();
    let cursor = since;
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const flush = (): boolean => {
          for (const event of getEventsSince(userId, runId, cursor)) {
            controller.enqueue(
              encoder.encode(
                `id: ${event.sequenceNumber}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
              ),
            );
            cursor = event.sequenceNumber;
          }
          return isTerminal(userId, runId);
        };
        if (flush()) {
          controller.close();
          return;
        }
        const interval = setInterval(() => {
          if (closed) return;
          try {
            const done = flush();
            controller.enqueue(encoder.encode(": ping\n\n"));
            if (done) {
              clearInterval(interval);
              controller.close();
            }
          } catch {
            clearInterval(interval);
            try {
              controller.close();
            } catch {
              // The client already closed the stream.
            }
          }
        }, 600);
        request.signal.addEventListener("abort", () => {
          closed = true;
          clearInterval(interval);
          try {
            controller.close();
          } catch {
            // The client already closed the stream.
          }
        });
      },
      cancel() {
        closed = true;
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const status = error instanceof Error && error.message === "run_not_found" ? 404 : 500;
    return NextResponse.json(
      { ok: false, error: status === 404 ? "run_not_found" : "internal_error" },
      { status },
    );
  }
}
