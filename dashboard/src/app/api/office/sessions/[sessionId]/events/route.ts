import { officeSession, subscribeOfficeSession } from "@/lib/office/editor-sessions.ts";
import { encodeWire } from "@/lib/office/wire.ts";
import { requireUserId } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/** Everything the host pushes to the editor: webContents.send, dialogs, Garden versions. */
export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  let session;
  try { session = officeSession((await params).sessionId, await requireUserId()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: (error as { status?: number }).status ?? 401 }); }
  const encoder = new TextEncoder();
  let unsubscribe = () => {}, heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => { try { controller.enqueue(encoder.encode(text)); } catch { /* closed */ } };
      unsubscribe = subscribeOfficeSession(session, message => {
        write(`data: ${JSON.stringify(encodeWire(message))}\n\n`);
        if (message.type === "ended") { try { controller.close(); } catch { /* closed */ } }
      });
      heartbeat = setInterval(() => write(": keepalive\n\n"), 20_000);
      request.signal.addEventListener("abort", () => { clearInterval(heartbeat); unsubscribe(); try { controller.close(); } catch { /* closed */ } });
    },
    cancel() { clearInterval(heartbeat); unsubscribe(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
