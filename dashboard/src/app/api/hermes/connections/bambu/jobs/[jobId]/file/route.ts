import { bambuService } from "@/lib/bambu/server.ts";
import { trustedPrinterUser, printerConversation, boundedBytes, printerError, printerResponse } from "@/lib/bambu/http.ts";
import { MAX_FILE_BYTES } from "@/lib/bambu/inspection.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const userId = await trustedPrinterUser(request, true), conversation = printerConversation(request, userId), { jobId } = await params, service = bambuService();
    service.store.get(jobId, userId, conversation);
    const name = decodeURIComponent(request.headers.get("x-bambu-filename") ?? "");
    await service.stage(jobId, userId, conversation, Number(request.headers.get("x-bambu-revision")), await boundedBytes(request, MAX_FILE_BYTES), name);
    return printerResponse(service.view(jobId, userId, conversation));
  } catch (error) { return printerError(error); }
}
