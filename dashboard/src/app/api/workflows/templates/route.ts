import { NextRequest, NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { publicTemplateJson } from "@/lib/workflows/n8n";
import { normalizeTemplateSearchPayload } from "@/lib/workflows/template-safety";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 12;

export async function GET(request: NextRequest) {
  try {
    await requireUserId();
    const search = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 120);
    const rawPage = Number(request.nextUrl.searchParams.get("page") ?? "1");
    const page = Number.isInteger(rawPage) ? Math.min(50, Math.max(1, rawPage)) : 1;
    const payload = await publicTemplateJson("templates/search", {
      search,
      page: String(page),
      limit: String(PAGE_SIZE),
      category: "",
    });
    return NextResponse.json(
      { ...normalizeTemplateSearchPayload(payload), page, pageSize: PAGE_SIZE },
      { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=240" } },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}
