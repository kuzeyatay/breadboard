import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as service from "@/lib/agent-browser/service.ts";
import { getEventsSince, isTerminal } from "@/lib/agent-browser/run-manager.ts";
import { agentBrowserErrorResponse } from "@/lib/agent-browser/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Normalized event stream for an agent-browser run. Events live in the in-memory
// run manager; this replays from `since`/`Last-Event-ID` and polls until the run
// is terminal or the client disconnects. Returns JSON when SSE is not requested.
export async function GET(request: Request, { params }: { params: Promise<{ agentId: string; runId: string }> }) {
  try {
    const userId = await requireUserId();
    const { agentId, runId } = await params;
    service.requireAgent(userId, agentId);

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
              encoder.encode(`id: ${event.sequenceNumber}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
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
              /* already closed */
            }
          }
        }, 600);

        request.signal.addEventListener("abort", () => {
          closed = true;
          clearInterval(interval);
          try {
            controller.close();
          } catch {
            /* ignore */
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
    return agentBrowserErrorResponse(error);
  }
}
