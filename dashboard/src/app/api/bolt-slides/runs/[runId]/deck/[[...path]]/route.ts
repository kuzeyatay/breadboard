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

import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { liveArtifacts } from "@/lib/bolt-slides/run-manager.ts";
import {
  BoltSlidesWorkspaceError,
  requireWorkspaceOwner,
  resolveDeckFile,
} from "@/lib/bolt-slides/workspace.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string; path?: string[] }> },
) {
  try {
    const userId = await requireUserId();
    const { runId, path: segments } = await params;
    if (!liveArtifacts(userId, runId)) requireWorkspaceOwner(userId, runId);
    const file = resolveDeckFile(runId, (segments ?? []).join("/"));
    const headers = new Headers({
      "content-type": file.contentType,
      "content-length": String(statSync(file.absolutePath).size),
      "x-content-type-options": "nosniff",
      // Hashed asset names make a build immutable, but the deck's own page is
      // rewritten by a repair build, so nothing here is cached across a reload.
      "cache-control": "private, max-age=0, must-revalidate",
    });
    const stream = Readable.toWeb(
      createReadStream(file.absolutePath),
    ) as ReadableStream<Uint8Array>;
    return new Response(stream, { status: 200, headers });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof BoltSlidesWorkspaceError) {
      return NextResponse.json(
        { ok: false, error: error.code },
        { status: error.code === "invalid_run_id" ? 400 : 404 },
      );
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
