import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { requireBuzzUser } from "@/lib/buzz/route-helpers.ts";
import { onOrganizationActivity, orgListener } from "@/lib/crumbs/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The open Organization page listens here. When a message, edit or reaction
 * from another machine has been added to this machine's transcript, it is told
 * which rooms changed and refreshes them at once instead of on its timer.
 * Only room ids travel here; the page reads the rooms as it always does.
 */
export async function GET(request: Request) {
  try {
    const { userId } = await requireBuzzUser();
    orgListener.start(userId);
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (text: string) => { try { controller.enqueue(encoder.encode(text)); } catch { cleanup(); } };
        const unsubscribe = onOrganizationActivity(change => {
          if (change.userId === userId) send(`data: ${JSON.stringify({ rooms: change.roomIds })}\n\n`);
        });
        const keepAlive = setInterval(() => send(": ping\n\n"), 25_000);
        cleanup = () => { unsubscribe(); clearInterval(keepAlive); try { controller.close(); } catch { /* already closed */ } };
        request.signal.addEventListener("abort", () => cleanup(), { once: true });
        send(": connected\n\n");
      },
      cancel() { cleanup(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
