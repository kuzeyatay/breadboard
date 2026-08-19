import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { findDocumentBlob } from "@/lib/conversations/document-blob-store.ts";
import { readIndexStatus } from "@/lib/colpali/index-status.ts";
import { colpaliMode } from "@/lib/colpali/config.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Whether this document's pages can be searched yet.
 *
 * Indexing runs after the upload responds, so for the first seconds of a
 * document's life a question about it is answered from the whole inlined text
 * rather than from retrieved pages. Both are correct answers; they are not the
 * same answer, and the composer chip is where a person can see which one they
 * are about to get.
 *
 * Ownership comes from `findDocumentBlob`, which only ever looks under the
 * caller's own directory — somebody else's blob is simply not there.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ blobId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { blobId } = await params;
    const blob = findDocumentBlob({ userId, blobId });
    if (!blob) {
      return NextResponse.json({ error: "document_not_found" }, { status: 404 });
    }

    if (colpaliMode() === "disabled") {
      return NextResponse.json({ state: "off", pages: 0, detail: "", label: "" });
    }

    const status = readIndexStatus(blob.path);
    if (!status) {
      // No sidecar: uploaded before ColPali existed, or with it turned off.
      // Not an error and not pending — there is simply nothing to wait for.
      return NextResponse.json({ state: "off", pages: 0, detail: "", label: "" });
    }

    return NextResponse.json({
      state: status.state,
      pages: status.pages,
      truncated: status.truncated,
      detail: status.detail,
      // Worded here rather than in the component, so every surface that shows
      // it says the same thing.
      label:
        status.state === "ready"
          ? `${status.pages} page${status.pages === 1 ? "" : "s"} searchable${
              status.truncated ? " (first 300)" : ""
            }`
          : status.state === "pending"
            ? "reading pages…"
            : "",
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
