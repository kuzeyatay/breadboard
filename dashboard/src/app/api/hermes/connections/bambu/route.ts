import { bambuService, savePrinter } from "@/lib/bambu/server.ts";
import { ensureBambuRuntime, releaseIdleBambuRuntime } from "@/lib/bambu/runtime-client.ts";
import { trustedPrinterUser, printerJson, printerError, printerResponse } from "@/lib/bambu/http.ts";
import { fail } from "@/lib/bambu/types.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const userId = await trustedPrinterUser(request), service = bambuService();
    return printerResponse({ printers: service.store.printers(userId), activeJobs: service.store.active().filter(j => j.scope.userId === userId).map(j => ({ id:j.id, revision:j.revision, printerId:j.review?.printerId, name:j.file?.name ?? "Prepared print", state:j.state, mayHaveStarted:Boolean(j.attempt?.startIntentAt) })) });
  } catch (error) { return printerError(error); }
}
export async function POST(request: Request) {
  try {
    const userId = await trustedPrinterUser(request, true), body = await printerJson(request), service = bambuService();
    if (body.action === "save") return printerResponse({ printer: savePrinter(userId, body) });
    if (body.action === "resolve_inspected" && typeof body.jobId === "string") {
      // Retained ownership allows recovery even when the originating task was deleted.
      const job = service.store.get(body.jobId, userId);
      await ensureBambuRuntime(service.store);
      await service.resolveInspected(job.id, userId, job.scope.conversationPublicId, body.revision, body.inspected);
      return printerResponse({ ok: true });
    }
    if (body.action === "test" && typeof body.printerId === "string") {
      service.store.printer(body.printerId, userId);
      await ensureBambuRuntime(service.store);
      try { return printerResponse(await service.testPrinter(userId, body.printerId)); }
      finally { await releaseIdleBambuRuntime(service.store); }
    }
    if (body.action === "disconnect" && typeof body.printerId === "string") {
      service.store.transaction(() => {
        const printer = service.store.printer(body.printerId as string, userId);
        if (service.store.isLocked(printer.physicalIdentity)) fail("This printer has an active or unresolved job. Resolve it before disconnecting. Disconnecting never cancels a physical print.", "printer_locked");
        service.store.db.prepare("DELETE FROM connected_app_credentials WHERE user_id = ? AND slug = ?").run(userId, `bambu:${printer.config.id}`);
        printer.config.configured = false; printer.config.authenticated = false; printer.config.startCapability = "not_tested"; printer.config.revision++;
        service.store.savePrinter(printer); // Keep identity and history to prevent duplicate redispatch.
      });
      return printerResponse({ ok: true });
    }
    fail("Unsupported connection action.", "invalid_action", 400);
  } catch (error) { return printerError(error); }
}
