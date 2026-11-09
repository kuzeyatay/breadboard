import path from "node:path";
import { trustedPrinterUser, boundedBytes, printerResponse, printerError } from "@/lib/bambu/http.ts";
import { inspectBambuConnect, handoffConnectPlate } from "@/lib/bambu/connect.ts";
import { dashboardBulkDataDir } from "@/lib/runtime-paths.ts";
import { MAX_FILE_BYTES } from "@/lib/bambu/inspection.ts";
import { fail } from "@/lib/bambu/types.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { await trustedPrinterUser(request); return printerResponse(await inspectBambuConnect()); }
  catch (error) { return printerError(error); }
}
export async function POST(request: Request) {
  try {
    const userId = await trustedPrinterUser(request, true);
    if (request.headers.get("content-type") !== "application/octet-stream") fail("Upload a sliced .gcode.3mf file.", "sliced_file_required", 400);
    let name: string;
    try { name = decodeURIComponent(request.headers.get("x-bambu-filename") ?? ""); }
    catch { fail("The filename is invalid.", "invalid_filename", 400); }
    const bytes = await boundedBytes(request, MAX_FILE_BYTES);
    return printerResponse(await handoffConnectPlate(path.join(dashboardBulkDataDir(), "bambu/connect", String(userId)), bytes, name));
  } catch (error) { return printerError(error); }
}
