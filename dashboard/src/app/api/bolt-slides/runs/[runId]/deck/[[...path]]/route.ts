// The built deck, served straight out of the run's workspace.
//
// This is what the run card frames and what "Open the deck" opens in a tab.
// It reads only from that run's `dist/`, and only for the account that owns the
// workspace, so a deck link is no more shareable than any other page behind the
// session.
//
// The deck was built with `base: "./"`, so every asset it asks for arrives here
// as a path under this route and resolves relatively — which is what lets one
// build be served from a run-scoped URL without being rebuilt for it.

import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { readDeckFile } from "@/lib/bolt-slides/runtime-run-manager.ts";
import { withBoltDeckBase } from "@/lib/bolt-slides/deck-preview.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string; path?: string[] }> },
) {
  try {
    const userId = await requireUserId();
    const { runId, path: segments } = await params;
    const relativePath = (segments ?? []).join("/");
    const file = await readDeckFile(userId, runId, relativePath);
    if (!file) {
      return NextResponse.json({ ok: false, error: "deck_not_found" }, { status: 404 });
    }
    const headers = new Headers({
      "content-type": file.contentType,
      "content-length": String(file.size),
      "x-content-type-options": "nosniff",
      // Hashed asset names make a build immutable, but the deck's own page is
      // rewritten by a repair build, so nothing here is cached across a reload.
      "cache-control": "private, max-age=0, must-revalidate",
    });
    // Next canonicalizes /deck/ to /deck. Without an explicit document base,
    // the built relative assets resolve beside /deck and return 404. Keep the
    // portable build unchanged and bind only the served entry to its owner.
    if ((!relativePath || relativePath === "index.html") && file.contentType.startsWith("text/html")) {
      const html = withBoltDeckBase(await new Response(file.stream).text(), runId);
      headers.set("content-length", String(Buffer.byteLength(html, "utf8")));
      return new Response(html, { status: 200, headers });
    }
    return new Response(file.stream, { status: 200, headers });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const status = error instanceof Error && error.message === "run_not_found" ? 404 : 500;
    return NextResponse.json(
      { ok: false, error: status === 404 ? "run_not_found" : "internal_error" },
      { status },
    );
  }
}
