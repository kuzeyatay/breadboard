import fs from "node:fs/promises";
import path from "node:path";
import { bambuService, bambuRoot, savePrinterPhoto } from "@/lib/bambu/server.ts";
import { trustedPrinterUser, boundedBytes, printerError, printerResponse } from "@/lib/bambu/http.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ printerId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const userId = await trustedPrinterUser(request), { printerId } = await context.params;
    const printer = bambuService().store.printer(printerId, userId);
    if (!printer.config.photo) return new Response(null, { status: 404 });
    const bytes = await fs.readFile(path.join(bambuRoot(), "photos", `${printer.config.id}.png`));
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
  } catch (error) { return printerError(error); }
}
export async function POST(request: Request, context: Context) {
  try { const userId = await trustedPrinterUser(request, true), { printerId } = await context.params; bambuService().store.printer(printerId, userId); await savePrinterPhoto(userId, printerId, await boundedBytes(request, 5 * 1024 * 1024)); return printerResponse({ ok: true }); }
  catch (error) { return printerError(error); }
}
