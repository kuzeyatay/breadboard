import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { generateConversationTitle } from "@/lib/conversations/title-service";
import {
  apiErrorResponse,
  readJsonBody,
  requireString,
} from "@/lib/hermes/route-helpers";

export const dynamic = "force-dynamic";

/** A tool-free, first-prompt-only title completion for local chat surfaces. */
export async function POST(request: Request) {
  try {
    await requireUserId();
    const body = await readJsonBody(request, 32 * 1024);
    const firstPrompt = requireString(body.firstPrompt, "firstPrompt", 4_000);
    const { baseURL } = resolveChatmockBaseUrl(request);
    const title = await generateConversationTitle({
      firstPrompt,
      model: body.model,
      baseUrl: baseURL,
    });
    return NextResponse.json({ title });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
