// The user's side of skill lessons: read what a skill has learned about running
// on this machine, and retire anything that is wrong or no longer true.
//
// This route is why lessons live in Breadboard's database rather than inside a
// skill's reviewed directory. A lesson is written by the assistant but owned by
// the user, and something they cannot open and delete is not a note — it is an
// instruction accumulating behind their back.

import { NextResponse } from "next/server";

import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { forgetSkillLesson, listAllSkillLessons } from "@/lib/hermes/skill-lessons.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ lessons: listAllSkillLessons(userId) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "A lesson id is required." }, { status: 400 });
    }
    // Scoped to the caller, so a guessed id reads as "not found" rather than
    // deleting somebody else's lesson.
    if (!forgetSkillLesson(userId, id)) {
      return NextResponse.json({ error: "No such lesson." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
