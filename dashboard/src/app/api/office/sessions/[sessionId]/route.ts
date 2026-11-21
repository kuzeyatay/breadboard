import { closeOfficeSession, officeAnswer, officeFlush, officeInvoke, officeMenu, officeSend, officeSession, officeUpload, officeWindowClosed } from "@/lib/office/editor-sessions.ts";
import { decodeWire, encodeWire } from "@/lib/office/wire.ts";
import { requireUserId } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ sessionId: string }> };

const reply = (value: unknown, status = 200) => Response.json(encodeWire(value), { status, headers: { "Cache-Control": "no-store" } });

/** The editor iframe's ipcRenderer: invoke, send, dialog answers and picked files. */
export async function POST(request: Request, { params }: Context) {
  try {
    const session = officeSession((await params).sessionId, await requireUserId());
    const body = decodeWire(await request.json()) as { action?: string; channel?: string; args?: unknown[]; id?: number; value?: unknown; name?: string; data?: Uint8Array; accelerator?: string; wc?: number };
    const wc = Number(body.wc) || 0;
    switch (body.action) {
      case "invoke": return reply({ ok: true, value: await officeInvoke(session, String(body.channel), body.args ?? [], wc) });
      case "send": officeSend(session, String(body.channel), body.args ?? [], wc); return reply({ ok: true });
      case "answer": officeAnswer(session, Number(body.id), body.value); return reply({ ok: true });
      case "window-closed": officeWindowClosed(session, wc); return reply({ ok: true });
      case "menu": officeMenu(session, String(body.accelerator)); return reply({ ok: true });
      case "flush": return reply({ ok: true, value: await officeFlush(session) });
      case "upload": return reply({ ok: true, value: officeUpload(session, String(body.name), body.data ?? new Uint8Array()) });
      default: return reply({ ok: false, error: "Unknown editor request." }, 400);
    }
  } catch (error) {
    return reply({ ok: false, error: error instanceof Error ? error.message : String(error) }, (error as { status?: number }).status ?? 500);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const session = officeSession((await params).sessionId, await requireUserId());
    await closeOfficeSession(session.id);
  } catch { /* already closed */ }
  return new Response(null, { status: 204 });
}
