import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { createPrompt, importLegacyPrompts, listPrompts } from "@/lib/openharness/prompts.ts";
import { apiErrorResponse, readJsonBody, requireEnabled, requireString } from "@/lib/openharness/route-helpers.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    requireEnabled();
    return NextResponse.json({ prompts: listPrompts(userId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const body = await readJsonBody(request);
    if (body.action === "import_legacy") {
      const prompts = Array.isArray(body.prompts) ? body.prompts : [];
      return NextResponse.json(importLegacyPrompts(userId, prompts));
    }
    const prompt = createPrompt(userId, {
      title: requireString(body.title, "title", 200),
      content: requireString(body.content, "content", 50_000),
      category: typeof body.category === "string" ? body.category.trim().slice(0, 100) : "Custom",
      favorite: body.favorite === true,
    });
    return NextResponse.json({ prompt }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
