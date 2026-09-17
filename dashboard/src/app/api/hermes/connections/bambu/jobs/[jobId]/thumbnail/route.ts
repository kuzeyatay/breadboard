import fs from "node:fs/promises";
import { bambuService } from "@/lib/bambu/server.ts";
import { trustedPrinterUser, printerConversation, printerError } from "@/lib/bambu/http.ts";
import { fail } from "@/lib/bambu/types.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const userId = await trustedPrinterUser(request), conversation = printerConversation(request, userId), { jobId } = await params, service = bambuService();
    const job = service.store.get(jobId, userId, conversation), plateId = Number(new URL(request.url).searchParams.get("plate"));
    if (!job.file?.plates.some(p => p.id === plateId && p.thumbnail)) fail("Plate thumbnail unavailable.", "thumbnail_not_found", 404);
    const bytes = await fs.readFile(service.artifactPath(job.file.id, `plate_${plateId}.png`));
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
  } catch (error) { return printerError(error); }
}
