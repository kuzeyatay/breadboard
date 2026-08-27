import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import {
  ArtifactStoreError,
} from "@/lib/hermes/artifact-store.ts";
import {
  downloadDocumentViaRuntime,
  RuntimeDocumentDownloadError,
} from "@/lib/get-doc/download-runtime.ts";
import { findDocument, recordDownload } from "@/lib/get-doc/runtime-run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Save one document from a finished search into the conversation's artifacts.
 *
 * The request names a document in a run — never an address — so the only URLs
 * this route can ever fetch are ones a catalog returned for that user's own
 * search. A paper already saved in this run is returned as-is instead of being
 * downloaded a second time.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string; documentId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { runId, documentId } = await params;
    const text = await request.text();
    if (text.length > 8 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const conversationId =
      typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    if (!conversationId) {
      return NextResponse.json(
        { ok: false, error: "conversation_required" },
        { status: 400 },
      );
    }

    const found = await findDocument(userId, runId, documentId);
    if (!found) {
      return NextResponse.json({ ok: false, error: "document_not_found" }, { status: 404 });
    }
    if (found.saved) {
      return NextResponse.json({ ok: true, saved: found.saved, alreadySaved: true });
    }
    const { document } = found;
    if (!document.pdfUrl) {
      return NextResponse.json(
        {
          ok: false,
          error: "no_free_full_text",
          message:
            "No free full text was found for this paper. Open its page to see what access your institution has.",
        },
        { status: 409 },
      );
    }

    // Runtime owns DNS/fetch/redirect/body/artifact work. The dashboard sends
    // only the server-selected catalog result, never a renderer-selected URL.
    const downloaded = await downloadDocumentViaRuntime({
      userId,
      sourceRunId: runId,
      documentId,
      conversationPublicId: conversationId,
      document,
    });
    const saved = recordDownload({
      userId,
      runId,
      documentId,
      artifactId: downloaded.artifactId,
      filename: downloaded.filename,
      byteSize: downloaded.byteSize,
    });
    return NextResponse.json({
      ok: true,
      saved,
      alreadySaved: false,
      artifact: downloaded.artifact,
    });
  } catch (error) {
    if (error instanceof RuntimeDocumentDownloadError) {
      return NextResponse.json(
        { ok: false, error: error.code, message: error.message },
        { status: ["artifact_session_unavailable", "no_free_full_text"].includes(error.code) ? 409 : 502 },
      );
    }
    if (error instanceof ArtifactStoreError) {
      return NextResponse.json(
        { ok: false, error: error.code, message: error.message },
        { status: error.status },
      );
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    const status = error instanceof Error && error.message === "run_not_found" ? 404 : 500;
    return NextResponse.json(
      {
        ok: false,
        error: status === 404 ? "run_not_found" : "internal_error",
        message:
          status === 404
            ? "That search has expired. Run it again to download from it."
            : "The download could not be completed.",
      },
      { status },
    );
  }
}
