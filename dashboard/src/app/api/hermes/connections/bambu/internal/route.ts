import { bambuService } from "@/lib/bambu/server.ts";
import { authorizeBambuRuntime, ensureBambuRuntime, releaseIdleBambuRuntime } from "@/lib/bambu/runtime-client.ts";
import { printerJson, printerError, printerResponse } from "@/lib/bambu/http.ts";
import { fail } from "@/lib/bambu/types.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let lastRenewed = 0;
export async function POST(request: Request) {
  try {
    authorizeBambuRuntime(request);
    const body = await printerJson(request), service = bambuService();
    if (body.action === "recover") service.recover();
    else if (body.action === "upload_progress") service.uploadProgress(String(body.attemptId), Number(body.bytes));
    else if (body.action === "tick") {
      await service.tick();
      if (service.store.active().length && Date.now() - lastRenewed > 3600000) { await ensureBambuRuntime(service.store); lastRenewed = Date.now(); }
      await releaseIdleBambuRuntime(service.store);
    } else fail("Unsupported internal printer action.", "invalid_action", 400);
    return printerResponse({ ok: true, serials: service.store.active().flatMap(job => job.review ? [service.store.printer(job.review.printerId).serial] : []) });
  } catch (error) { return printerError(error); }
}
