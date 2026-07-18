import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { deletePrompt, updatePrompt } from "@/lib/openharness/prompts.ts";
import { ApiError, apiErrorResponse, readJsonBody, requireEnabled, requireString } from "@/lib/openharness/route-helpers.ts";

export const dynamic = "force-dynamic";

function numericId(value: string): number {
  const id = Number(value.replace(/^user-/, ""));
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "invalid_prompt_id", "Invalid prompt id.");
  return id;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ promptId: string }> }) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const body = await readJsonBody(request);
    const { promptId } = await params;
    const prompt = updatePrompt(userId, numericId(promptId), {
      title: requireString(body.title, "title", 200),
      content: requireString(body.content, "content", 50_000),
      category: typeof body.category === "string" ? body.category.trim().slice(0, 100) : "Custom",
      favorite: body.favorite === true,
    });
    if (!prompt) throw new ApiError(404, "prompt_not_found", "Prompt not found.");
    return NextResponse.json({ prompt });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ promptId: string }> }) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { promptId } = await params;
    if (!deletePrompt(userId, numericId(promptId))) throw new ApiError(404, "prompt_not_found", "Prompt not found.");
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
