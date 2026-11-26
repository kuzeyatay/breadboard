import "server-only";

import db from "@/lib/db";
import { GLOBAL_MODEL_SENTINEL } from "@/lib/ai-models";
import { localChatmockBaseUrl } from "@/lib/chatmock-server";
import { CrumbsError, createCrumbs } from "./core.ts";
import { ensureLocalCrumbsServices } from "./local-services.ts";
import { createBuzzBridge, type BridgeFiles } from "./buzz-bridge.ts";
import { createDrive, DriveError } from "../drive/drive-client.ts";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { findStoredFileBlob, StoredFileBlobError, writeStoredFileBlob } from "../conversations/stored-file-blob-store.ts";
import { storedFileAttachmentFormat, type StoredFileAttachmentFormat } from "../stored-file-attachments.ts";
import { createOrgListener } from "./org-listener.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import { feedHistory } from "./feed-history.ts";

/** Crumbs AI runs on the user's own fallback model, so it costs the service nothing. */
async function complete(_userId: number, system: string, prompt: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${localChatmockBaseUrl()}/chat/completions`, {
      method: "POST", signal: AbortSignal.timeout(90_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY || "local"}` },
      body: JSON.stringify({ model: GLOBAL_MODEL_SENTINEL, stream: false, temperature: 0.2, max_completion_tokens: 900,
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
    });
  } catch { throw new CrumbsError(503, "Your model did not answer. Try again."); }
  if (!response.ok) throw new CrumbsError(503, "Your model did not answer. Try again.");
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const text = String(payload.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!text) throw new CrumbsError(503, "Your model sent an empty answer. Try again.");
  return text;
}

export const crumbs = createCrumbs({ db, complete, ensureServers: ensureLocalCrumbsServices, readFeedHistory: user => feedHistory(db, dashboardDataDir(), user) });
export { CrumbsError };

/** Google Drive, the carrier for files shared in organizations. */
export const drive = createDrive({ db });

/**
 * Files in organization messages: read from this machine's file store, sent
 * encrypted through the sender's Drive, and kept in the reader's own store on
 * arrival, so a file stays readable here even after the sender removes it.
 */
const organizationFiles: BridgeFiles = {
  async upload(userId, file) {
    const blob = findStoredFileBlob({ userId, blobId: file.blobId });
    if (!blob) throw new DriveError(404, "That file is no longer on this machine.", "file_missing");
    return drive.uploadEncrypted(userId, await fs.promises.readFile(blob.path), file.name);
  },
  async receive(userId, ref) {
    const bytes = await drive.downloadDecrypted(ref);
    const store = (format: StoredFileAttachmentFormat) => writeStoredFileBlob({ userId, format, body: new Blob([new Uint8Array(bytes)]).stream() });
    const format = storedFileAttachmentFormat(ref.name) ?? "bin";
    // A file whose name promises text but whose bytes are not is still kept, whole, as a plain file.
    const stored = await store(format).catch(error => { if (format !== "bin" && error instanceof StoredFileBlobError && error.status === 415) return store("bin"); throw error; });
    return { blobId: stored.blobId, format: stored.format, sizeBytes: stored.byteSize };
  },
  // Network trouble and Google's own errors are tried again; a missing connection, a forbidden share,
  // a removed or damaged file, or one too large are not.
  retryable: error => !(error instanceof DriveError || error instanceof StoredFileBlobError) || (error instanceof DriveError && error.status >= 500 && error.status !== 507),
};

/** Carries encrypted organizations onto the Organization page. */
export const buzzBridge = createBuzzBridge({ db, crumbs, files: organizationFiles });

/** Open Organization pages listen here for rooms that changed, so they refresh without waiting for their timer. */
type OrgActivity = { userId: number; roomIds: number[] | null };
const activity = new Set<(change: OrgActivity) => void>();
export function onOrganizationActivity(listener: (change: OrgActivity) => void): () => void {
  activity.add(listener);
  return () => { activity.delete(listener); };
}

/** The live connection to the organization store, one per signed-in Crumbs account. */
export const orgListener = createOrgListener({
  crumbs, bridge: buzzBridge,
  onChange: (userId, roomIds) => { for (const listener of activity) { try { listener({ userId, roomIds }); } catch { /* one page's failure is not the others' */ } } },
});
/**
 * At startup: every account on this machine that is signed in to Crumbs starts
 * listening. A light local check also sends what was written here while no page
 * asked for it, such as an agent's answer that finished after its page closed.
 */
let outgoingTimer: ReturnType<typeof setInterval> | null = null;
export function startOrganizationListeners(): void {
  for (const { user_id: userId } of db.prepare("SELECT user_id FROM crumbs_accounts").all() as Array<{ user_id: number }>) orgListener.start(userId);
  outgoingTimer ??= setInterval(() => {
    for (const { user_id: userId } of db.prepare("SELECT DISTINCT user_id FROM crumbs_buzz_rooms").all() as Array<{ user_id: number }>) {
      if (orgListener.isLive(userId) && buzzBridge.hasOutgoing(userId)) void relayOrganizations(userId, undefined, { force: true });
    }
  }, 5_000);
  outgoingTimer.unref?.();
}

const lastRelay = new Map<string, number>();
/**
 * Relay organization messages for one room, or for everything this account
 * belongs to. Throttled, never throws, and waits at most `waitMs` so a slow
 * network cannot hold the Organization page up. While the live connection is
 * up, new messages arrive through it, so only forced relays (sending what was
 * just written here) go to the store.
 */
export async function relayOrganizations(userId: number, roomId?: number, options: { waitMs?: number; force?: boolean } = {}): Promise<void> {
  orgListener.start(userId);
  if (!options.force && orgListener.isLive(userId) && !buzzBridge.hasOutgoing(userId, roomId)) return;
  const key = roomId === undefined ? `all:${userId}` : `room:${roomId}`;
  if (!options.force && Date.now() - (lastRelay.get(key) ?? 0) < (roomId === undefined ? 10_000 : 3_000)) return;
  lastRelay.set(key, Date.now());
  const work = (roomId === undefined ? buzzBridge.syncAll(userId) : buzzBridge.syncRoom(userId, roomId)).catch(() => {});
  if (options.waitMs) await Promise.race([work, new Promise(resolve => setTimeout(resolve, options.waitMs))]);
}

export function crumbsErrorResponse(error: unknown): Response | null {
  return error instanceof CrumbsError ? Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } }) : null;
}
