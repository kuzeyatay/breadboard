import { NextResponse } from "next/server";

import {
  clearGoogleImageGenerationCredentials,
  googleImageGenerationCredentialsStatus,
  storeGoogleImageGenerationCredentials,
} from "@/lib/hermes/google-image-generation-credentials.ts";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ status: googleImageGenerationCredentialsStatus(userId) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 16 * 1024) {
      return NextResponse.json({ error: "The credentials payload is too large." }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as unknown) : null;
    storeGoogleImageGenerationCredentials(userId, body);
    return NextResponse.json({ status: googleImageGenerationCredentialsStatus(userId) });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "The credentials payload is not valid JSON." }, { status: 400 });
    }
    return routeErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    const userId = await requireUserId();
    clearGoogleImageGenerationCredentials(userId);
    return NextResponse.json({ status: googleImageGenerationCredentialsStatus(userId) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
