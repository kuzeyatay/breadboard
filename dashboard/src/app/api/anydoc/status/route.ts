// Tells the upload UI whether "Parse with anydoc" can be offered right now, and
// what to say when it cannot. The only way it is unavailable is a missing or
// wrong-platform native binary, so the probe is a module load — cheap after the
// first call, and it never touches the uploaded file.

import { NextResponse } from "next/server";

import { anydocAvailability } from "@/lib/anydoc/convert";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUserId();
    return NextResponse.json(await anydocAvailability());
  } catch (err) {
    return routeErrorResponse(err);
  }
}
