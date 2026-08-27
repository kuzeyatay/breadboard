import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as service from "@/lib/agent-browser/service.ts";
import { readRunView } from "@/lib/agent-browser/run-manager.ts";
import { agentBrowserErrorResponse } from "@/lib/agent-browser/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Normalized event stream for an Agent Browser Runtime V2 job. The durable
// worker projection replays across dashboard/runtime restarts and compaction.
export async function GET(request: Request, { params }: { params: Promise<{ agentId: string; runId: string }> }) {
  try {
    const userId = await requireUserId();
    const { agentId, runId } = await params;
    service.requireAgent(userId, agentId);

    const url = new URL(request.url);
    const parsedSince = Number(request.headers.get("last-event-id") ?? url.searchParams.get("since") ?? 0);
    const since = Number.isSafeInteger(parsedSince) && parsedSince >= 0 ? parsedSince : 0;

    if (!(request.headers.get("accept") ?? "").includes("text/event-stream")) {
      const view = await readRunView(userId, agentId, runId, since);
      return NextResponse.json({ ok: true, events: view.events });
    }

    const encoder = new TextEncoder();
    let cursor = since;
    let closed = false;
    let inFlight = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const close = () => {
          if (closed) return;
          closed = true;
          if (interval) clearInterval(interval);
          interval = null;
          try {
            controller.close();
          } catch {
            // The browser already released its reader.
          }
        };
        const flush = async () => {
          if (closed || inFlight) return;
          inFlight = true;
          try {
            const view = await readRunView(userId, agentId, runId, cursor);
            for (const event of view.events) {
              if (closed) return;
              controller.enqueue(
                encoder.encode(`id: ${event.sequenceNumber}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
              );
              cursor = event.sequenceNumber;
            }
            if (view.terminal) {
              close();
              return;
            }
            controller.enqueue(
              encoder.encode(": ping\n\n"),
            );
          } catch {
            close();
          } finally {
            inFlight = false;
          }
        };

        void flush().then(() => {
          if (!closed) interval = setInterval(() => void flush(), 600);
        });

        request.signal.addEventListener("abort", () => {
          close();
        }, { once: true });
      },
      cancel() {
        closed = true;
        if (interval) clearInterval(interval);
        interval = null;
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
