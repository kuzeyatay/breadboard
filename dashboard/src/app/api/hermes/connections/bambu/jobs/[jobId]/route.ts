import { bambuService, printerResource } from "@/lib/bambu/server.ts";
import { ensureBambuRuntime } from "@/lib/bambu/runtime-client.ts";
import { trustedPrinterUser, printerConversation, printerJson, printerError, printerResponse } from "@/lib/bambu/http.ts";
import { slicedAttachments, stageAttachment } from "@/lib/bambu/attachments.ts";
import { fail, type PrintReview } from "@/lib/bambu/types.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ jobId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const userId = await trustedPrinterUser(request), conversation = printerConversation(request, userId), { jobId } = await context.params;
    const service = bambuService(), view = service.view(jobId, userId, conversation);
    return printerResponse({ ...view, attachments: slicedAttachments(service.store.get(jobId, userId, conversation)) });
  } catch (error) { return printerError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const userId = await trustedPrinterUser(request, true), conversation = printerConversation(request, userId), { jobId } = await context.params;
    const service = bambuService(), job = service.store.get(jobId, userId, conversation), body = await printerJson(request);
    switch (body.action) {
      case "review": service.review(jobId, userId, conversation, body.revision, body.review as PrintReview); break;
      case "approve":
        await ensureBambuRuntime(service.store);
        service.approve(jobId, userId, conversation, body.revision, { plateClear: body.plateClear, physicalSetup: body.physicalSetup }); break;
      case "pause": case "resume": case "cancel":
        await ensureBambuRuntime(service.store);
        await service.control(jobId, userId, conversation, body.action, body.confirmed); break;
      case "cancel_draft": service.cancelDraft(jobId, userId, conversation); break;
      case "resolve_inspected":
        await ensureBambuRuntime(service.store);
        await service.resolveInspected(jobId, userId, conversation, body.revision, body.inspected); break;
      case "attach":
        if (body.revision !== job.revision) fail("The draft changed. Reload before selecting the attachment.", "stale_review");
        await stageAttachment(job, body); break;
      case "again": {
        const draft = service.again(jobId, userId, conversation);
        return printerResponse({ ...service.view(draft.id, userId, conversation), resource: printerResource(draft) });
      }
      default: fail("Unsupported print job action.", "invalid_action", 400);
    }
    return printerResponse(service.view(jobId, userId, conversation));
  } catch (error) { return printerError(error); }
}
