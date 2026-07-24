import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as service from "@/lib/ui-tars/service.ts";
import * as store from "@/lib/ui-tars/store.ts";
import { uiTarsErrorResponse } from "@/lib/ui-tars/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TERMINAL = new Set(["completed", "failed", "aborted", "runtime_lost"]);

// Normalized event stream. Breadboard owns the stream — events are synced from
// the adapter, persisted, and then emitted (never the raw adapter SSE). Supports
// resume via `since` or the `Last-Event-ID` header. Returns JSON when SSE is not
// requested (used for one-shot refresh reads + tests).
export async function GET(request: Request, { params }: { params: Promise<{ agentId: string; runId: string }> }) {
  try {
    const userId = await requireUserId();
    const { agentId, runId } = await params;
    service.requireAgent(userId, agentId);
    // Ownership of the run is enforced inside the service/store calls below.
    const url = new URL(request.url);
    const lastEventId = Number(request.headers.get("last-event-id") ?? url.searchParams.get("since") ?? 0) || 0;

    if (!(request.headers.get("accept") ?? "").includes("text/event-stream")) {
      await service.syncRun(userId, runId).catch(() => null);
      return NextResponse.json({ ok: true, events: store.listEvents(userId, runId, lastEventId) });
    }

    const encoder = new TextEncoder();
    let cursor = lastEventId;
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (e: { sequenceNumber: number; type: string; payload: unknown; at: string }) => {
          controller.enqueue(
            encoder.encode(`id: ${e.sequenceNumber}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`),
          );
        };
        const pump = async (): Promise<boolean> => {
          await service.syncRun(userId, runId).catch(() => null);
          const fresh = store.listEvents(userId, runId, cursor);
          for (const e of fresh) {
            send(e);
            cursor = e.sequenceNumber;
          }
          const run = store.getRun(userId, runId);
          return !!run && TERMINAL.has(run.status);
        };

        // Backlog first, then poll until terminal or client disconnect.
        const terminalNow = await pump();
        if (terminalNow) {
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
        }, 700);

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
    return uiTarsErrorResponse(error);
  }
}
