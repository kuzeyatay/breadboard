import path from "node:path";
import { trustedPrinterUser, printerJson, printerError, printerResponse, boundedBytes } from "@/lib/bambu/http.ts";
import { inspectBambuStudio, openBambuStudio, stageStudioModel } from "@/lib/bambu/studio.ts";
import { dashboardBulkDataDir } from "@/lib/runtime-paths.ts";
import { fail } from "@/lib/bambu/types.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { await trustedPrinterUser(request); return printerResponse(await inspectBambuStudio()); }
  catch (error) { return printerError(error); }
}
export async function POST(request: Request) {
  try {
    const userId = await trustedPrinterUser(request, true);
    if (request.headers.get("content-type")?.startsWith("application/json")) {
      const body = await printerJson(request);
      if (body.action !== "open" || Object.keys(body).length !== 1) fail("Choose Open Bambu Studio or upload a model file.", "invalid_action", 400);
      return printerResponse(await openBambuStudio());
    }
    const status = await inspectBambuStudio();
    if (!status.installed) fail(status.message, "bambu_studio_missing", 404);
    let name: string;
    try { name = decodeURIComponent(request.headers.get("x-bambu-filename") ?? ""); }
    catch { fail("The model filename is invalid.", "bambu_studio_file", 400); }
    const bytes = await boundedBytes(request, 128 * 1024 * 1024);
    const file = await stageStudioModel(path.join(dashboardBulkDataDir(), "bambu", "studio", String(userId)), name, bytes);
    return printerResponse(await openBambuStudio(file));
  } catch (error) { return printerError(error); }
}
