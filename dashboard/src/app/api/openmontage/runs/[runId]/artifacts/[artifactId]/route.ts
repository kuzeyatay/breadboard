// Serving one file out of a production's workspace.
//
// Two details matter here. Video is served with byte-range support, because a
// <video> element seeks by asking for ranges and a card that cannot seek is a
// card that cannot review a render. And everything that is not media is served
// as plain text: a production's documents and stage artifacts are written by a
// model, so handing an SVG or an HTML fragment back with its own content type on
// the dashboard's origin would let generated markup run scripts against the
// signed-in session. Those files are source, and they are shown as source.

import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { liveArtifacts } from "@/lib/openmontage/run-manager.ts";
import {
  requireWorkspaceOwner,
  resolveArtifact,
  WorkspaceError,
} from "@/lib/openmontage/workspace.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Kinds the card renders in place, and the only ones served as themselves. */
const INLINE_KINDS = new Set(["video", "image", "audio"]);

/**
 * SVG is an image by extension and a script host by capability, so it is the
 * one image kind that is never served inline.
 */
function isInlineSafe(kind: string, name: string): boolean {
  if (!INLINE_KINDS.has(kind)) return false;
  return !/\.svg$/i.test(name);
}

function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  let start = rawStart ? Number(rawStart) : 0;
  let end = rawEnd ? Number(rawEnd) : size - 1;
  if (!rawStart) {
    // A suffix range (`bytes=-500`) asks for the last N bytes.
    start = Math.max(0, size - Number(rawEnd));
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string; artifactId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { runId, artifactId } = await params;
    if (!liveArtifacts(userId, runId)) requireWorkspaceOwner(userId, runId);
    const { record, absolutePath } = resolveArtifact(runId, artifactId);
    const size = statSync(absolutePath).size;
    const download = new URL(request.url).searchParams.get("download") === "1";
    const safe = isInlineSafe(record.kind, record.name);
    const inline = safe && !download;
    const contentType = safe ? record.contentType : "text/plain; charset=utf-8";
    const headers = new Headers({
      "content-type": contentType,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=0, must-revalidate",
      "accept-ranges": "bytes",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${record.name.replace(/["\\]/g, "")}"`,
    });

    const range = parseRange(request.headers.get("range"), size);
    if (range) {
      headers.set("content-length", String(range.end - range.start + 1));
      headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
      const stream = Readable.toWeb(
        createReadStream(absolutePath, { start: range.start, end: range.end }),
      ) as ReadableStream<Uint8Array>;
      return new Response(stream, { status: 206, headers });
    }
    headers.set("content-length", String(size));
    const stream = Readable.toWeb(createReadStream(absolutePath)) as ReadableStream<Uint8Array>;
    return new Response(stream, { status: 200, headers });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof WorkspaceError) {
      const status = error.code === "invalid_run_id" ? 400 : 404;
      return NextResponse.json({ ok: false, error: error.code }, { status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
