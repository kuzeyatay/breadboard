import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as service from "@/lib/deep-research/service.ts";
import { deepResearchErrorResponse } from "@/lib/deep-research/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TERMINAL = new Set(["run.completed", "run.failed", "run.aborted"]);

// Breadboard owns the stream the browser sees: the loopback service exposes
// events-since as JSON and this route re-emits them as SSE, so the service
// secret and its raw responses never reach the client. Supports resume through
// `since` or `Last-Event-ID`, and answers with JSON when SSE is not requested
// (one-shot refresh reads and tests).
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const userId = await requireUserId();
    const { runId } = await params;
    const url = new URL(request.url);
    const lastEventId =
      Number(request.headers.get("last-event-id") ?? url.searchParams.get("since") ?? 0) || 0;

    if (!(request.headers.get("accept") ?? "").includes("text/event-stream")) {
      return NextResponse.json({
        ok: true,
        events: await service.listEvents(userId, runId, lastEventId),
      });
    }

    const encoder = new TextEncoder();
    let cursor = lastEventId;
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const pump = async (): Promise<boolean> => {
          const fresh = await service.listEvents(userId, runId, cursor);
          let done = false;
          for (const event of fresh) {
            controller.enqueue(
              encoder.encode(
                `id: ${event.sequenceNumber}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
              ),
            );
            cursor = event.sequenceNumber;
            if (TERMINAL.has(event.type)) done = true;
          }
          return done;
        };

        // Backlog first, then poll until the run is terminal or the client leaves.
        if (await pump()) {
          controller.close();
          return;
        }
        const interval = setInterval(async () => {
          if (closed) return;
          try {
            const done = await pump();
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
        }, 1_000);

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
    return deepResearchErrorResponse(error);
  }
}
