// Whether a document has been indexed, kept beside the document.
//
// The bytes already live in a per-user directory whose *path* enforces
// ownership, and the extractor already writes a figures sidecar next to them.
// This is one more sidecar in the same place, for the same reason: no table, so
// no migration, and nothing that can drift out of step with the file it
// describes. Deleting the blob directory deletes the status with it.
//
// The status matters to more than bookkeeping. Indexing runs in the background
// after an upload, so a question asked in the first few seconds arrives before
// there is anything to retrieve from — and the honest answer then is to inline
// the whole document exactly as Breadboard always did. Every state other than
// `ready` means precisely that.

import fs from "node:fs";
import path from "node:path";

/** Matches the service's own ceiling; a longer document is indexed in part. */
export const MAX_INDEXED_PAGES = 300;

export type ColpaliIndexState =
  | "pending"
  | "ready"
  | "failed"
  /** The format has no page renderer, so there is nothing to embed. */
  | "unsupported";

export interface ColpaliIndexStatus {
  state: ColpaliIndexState;
  /** Pages actually embedded. */
  pages: number;
  /** The checkpoint that wrote the vectors; a change invalidates them. */
  modelId: string;
  /** True when the document ran past MAX_INDEXED_PAGES. */
  truncated: boolean;
  /** Why, when the state is `failed` or `unsupported`. */
  detail: string;
  updatedAt: string;
}

function statusPath(blobPath: string): string {
  const directory = path.dirname(blobPath);
  const base = path.basename(blobPath, path.extname(blobPath));
  return path.join(directory, `${base}.colpali.json`);
}

export function readIndexStatus(blobPath: string): ColpaliIndexStatus | null {
  try {
    const raw = fs.readFileSync(statusPath(blobPath), "utf8");
    const parsed = JSON.parse(raw) as Partial<ColpaliIndexStatus>;
    const state = parsed.state;
    if (state !== "pending" && state !== "ready" && state !== "failed" && state !== "unsupported") {
      return null;
    }
    return {
      state,
      pages: Number.isFinite(parsed.pages) ? Number(parsed.pages) : 0,
      modelId: typeof parsed.modelId === "string" ? parsed.modelId : "",
      truncated: parsed.truncated === true,
      detail: typeof parsed.detail === "string" ? parsed.detail : "",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    // No sidecar is the ordinary state for every document uploaded before this
    // existed, and for every one uploaded with ColPali turned off.
    return null;
  }
}

export function writeIndexStatus(
  blobPath: string,
  status: Omit<ColpaliIndexStatus, "updatedAt">,
): void {
  const payload: ColpaliIndexStatus = { ...status, updatedAt: new Date().toISOString() };
  try {
    fs.writeFileSync(statusPath(blobPath), JSON.stringify(payload, null, 2), "utf8");
  } catch {
    // A status that cannot be written costs a re-index, not a failed upload.
  }
}

/**
 * True when this document's pages can actually be retrieved right now.
 *
 * The model check is the subtle half: vectors written by one checkpoint are
 * meaningless to another, and scoring across them would return confident
 * nonsense rather than an error. The service refuses that too — this is the
 * cheap check that avoids the round trip.
 */
export function indexIsUsable(
  status: ColpaliIndexStatus | null,
  modelId: string,
): status is ColpaliIndexStatus {
  return status !== null && status.state === "ready" && status.pages > 0 && status.modelId === modelId;
}
