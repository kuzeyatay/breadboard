import { NextResponse } from "next/server";
import { randomArtwork } from "@/lib/paint-pomodoro";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const exclude = new URL(request.url).searchParams.get("exclude") ?? undefined;
  const artwork = randomArtwork(exclude);
  return NextResponse.json({ artwork }, { headers: { "Cache-Control": "no-store" } });
}
