import { randomUUID } from "node:crypto";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import db from "../db.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import { maintainRuntimeStorage } from "../supervisor-control.ts";
import { ColdPayloadWorker, ensureChatPayloadSchema } from "./chat-payloads.ts";
import { StorageScanner, allocatedBytes, cleanDisposableFiles, disposablePreview } from "./filesystem.ts";
import { classifyStoragePath, largeChats, noteChatFile, saveChatUsage, storageBudget, type ChatUsage } from "./budget.ts";
import { acquireStorageLease, ensureStorageSchema, sqliteSpace, storageSettings } from "./store.ts";
import { DAY_MS, STORAGE_POLICY, type StorageMaintenanceResult } from "./policy.ts";
import { enqueueImmutableCandidate, ensureImmutableFileSchema, ImmutableFileWorker, collectImmutableFiles, shareFreshImmutableUpload } from "./immutable-files.ts";
import { deduplicatePdfRevision, ensurePdfObjectSchema } from "./pdf-revisions.ts";
import { cleanScratch } from "./scratch.ts";
import { indexAttachmentReferences, attachmentIndexComplete } from "./attachment-references.ts";
import { learnWorkspaceGardenSlugs, pruneSupersededLearnBuildWorkspaces } from "../learn-build-workspace.ts";
import { readStorageCompaction, requestStorageCompaction } from "./compaction-state.ts";
import { WorkspaceStorageWorker, enqueueWorkspaceCandidate, workspaceStorageStatus, collectWorkspaceStorage } from "./workspace-storage.ts";
import { ColdFileWorker, coldFileStatus, enqueueColdFile } from "./cold-files.ts";

const state = globalThis as typeof globalThis & { breadboardStorageScanner?: StorageScanner; breadboardImmutableWorker?: ImmutableFileWorker; breadboardColdWorker?: ColdPayloadWorker; breadboardWorkspaceWorker?: WorkspaceStorageWorker; breadboardColdFileWorker?: ColdFileWorker; breadboardStoragePhase?: number; breadboardStorageGarden?: number };
const workspaceScanState = globalThis as typeof globalThis & { breadboardWorkspaceScanner?: StorageScanner };

const chatUsage = new WeakMap<StorageScanner, ChatUsage>();

function foregroundBusy(): boolean {
  return !!db.prepare(`SELECT 1 FROM conversation_messages WHERE status='pending'
    AND updated_at>datetime('now','-2 minutes') LIMIT 1`).get();
}

/** Best effort and never in the way of an upload: a failure leaves the file
 * exactly as written, and the idle worker still considers it after a week. */
export async function shareFreshUpload(absolutePath: string, sha256: string): Promise<number> {
  try {
    return await shareFreshImmutableUpload(db, dashboardDataDir(), absolutePath, sha256);
  } catch {
    return 0;
  }
}

export async function storageStatus() {
  ensureStorageSchema(db); ensureChatPayloadSchema(db);
  const settings = storageSettings(db);
  const volume = await fs.promises.statfs(dashboardDataDir());
  const compression = db.prepare("SELECT COALESCE(SUM(p.raw_bytes-length(p.data)-octet_length(CASE p.field WHEN 'metadata' THEN m.metadata ELSE m.sources END)),0) AS bytes FROM storage_message_payloads p JOIN conversation_messages m ON m.id=p.message_id").get() as { bytes: number };
  const disposables = await disposablePreview(db,dashboardDataDir());
  return {
    budget: storageBudget(db, settings.inventory ? JSON.parse(settings.inventory) : null),
    chats: largeChats(db),
    automatic: settings.automatic === 1, policy: STORAGE_POLICY,
    compaction: readStorageCompaction(dashboardDataDir()),
    freeBytes: volume.bavail * volume.bsize,
    inventory: settings.inventory ? JSON.parse(settings.inventory) : null,
    lastResult: settings.last_result ? JSON.parse(settings.last_result) : null,
    compressedPayloadBytesSaved: compression.bytes,
    workspaces: workspaceStorageStatus(db),
    coldFiles: coldFileStatus(db),
    disposables,
    database: sqliteSpace(db),
    protected: ["Chats and attachments", "Workspace outputs and recoverable drafts", "Recall recordings", "Installed models and runtimes"],
  };
}

/** Invoked by the desktop's single idle coordinator. No durable job per tick. */
export async function runStorageMaintenance(input: { action: "tick" | "clean" | "scan" | "compact"; idleMs?: number; signal?: AbortSignal }) {
  ensureStorageSchema(db);
  const now = Date.now(), settings = storageSettings(db), holder = randomUUID();
  const result: StorageMaintenanceResult & { housekeepingAllowed: boolean; continueSoon:boolean } = { housekeepingAllowed: false, continueSoon:false, startedAt: now, finishedAt: now, filesRemoved: 0, bytesReleased: 0, payloadBytesSaved: 0, skipped: [] };
  if (input.action === "compact") return { ...result, compaction: requestStorageCompaction(dashboardDataDir()) };
  if (input.action === "tick" && (!settings.automatic || (input.idleMs ?? 0) < STORAGE_POLICY.idleMs))
    return { ...result, skipped: ["Waiting for an idle period."] };
  if (foregroundBusy()) return { ...result, skipped: ["Foreground work is active."] };
  if (!acquireStorageLease(db, holder, now)) return { ...result, skipped: ["Storage maintenance is already running."] };
  const root = dashboardDataDir();
  const eligibleArtifact = (relative: string) => {
    if (!relative.startsWith(`artifacts${path.sep}`)) return false;
    const location=relative.slice("artifacts".length+1).split(path.sep).join("/");
    const pieces=location.split("/");
    if (pieces.length < 4 || !/^v[1-9][0-9]*$/u.test(pieces[2])) return false;
    return !!db.prepare(`SELECT 1 FROM hermes_artifact_versions v JOIN hermes_artifacts a ON a.id=v.artifact_id
      WHERE v.artifact_id=? AND v.version=? AND a.user_id=? AND v.status='ready' AND v.version<a.current_version
        AND (v.output_location=? OR v.preview_location=?) LIMIT 1`).get(pieces[1], Number(pieces[2].slice(1)), Number(pieces[0]), location, location);
  };
  let deadline = Date.now() + STORAGE_POLICY.sliceMs;
  const shouldYield = () => !!input.signal?.aborted || Date.now() >= deadline;
  try {
    // The scheduler starts a job every few seconds, so "busy" is the usual
    // answer. It postpones housekeeping only: returning here also skipped the
    // measurement below, which is why Settings never showed a finished scan.
    const runtime = input.action !== "scan" ? await maintainRuntimeStorage() : undefined;
    if (runtime?.busy) result.skipped.push("The runtime is busy.");
    if (input.action !== "scan" && !runtime?.busy) {
      result.housekeepingAllowed = true;
      // The runtime clears a bounded batch per call; while it is finding work, come straight back.
      if (runtime && runtime.jobsPruned + runtime.directoriesRemoved + (runtime.eventsArchived ?? 0) > 0) result.continueSoon = true;
      if (runtime === null) result.skipped.push("Native runtime retention requires the desktop lifecycle owner.");
      if (runtime?.protected) result.skipped.push("Some runtime records retain recovery or unrecognized result data.");
      deadline = Date.now() + STORAGE_POLICY.sliceMs;
      indexAttachmentReferences(db, () => shouldYield() || Date.now() >= deadline - 200);
      if(!attachmentIndexComplete(db)) result.skipped.push("Attachment ownership indexing continues; unverified files remain protected.");
      const cleaned = await cleanDisposableFiles(db, root, now, shouldYield);
      result.filesRemoved += cleaned.filesRemoved; result.bytesReleased += cleaned.bytesReleased; result.skipped.push(...cleaned.skipped);
      if (!shouldYield()) {
        const scratch=await cleanScratch(root,shouldYield,now);
        result.filesRemoved+=scratch.filesRemoved; result.bytesReleased+=scratch.bytesReleased;
      }
      const volume = await fs.promises.statfs(root);
      const reserved = volume.bavail * volume.bsize >= STORAGE_POLICY.reserveBytes;
      // Over budget, compressing cold workspace files in place takes every other
      // turn, and it is the one step that still runs below the reserve: it needs
      // no scratch copy, and a full disk is when it matters most. Steps that do
      // copy check the reserve themselves.
      const over = storageBudget(db, settings.inventory ? JSON.parse(settings.inventory) : null).over;
      if (!shouldYield() && (reserved || over)) {
        state.breadboardColdWorker ??= new ColdPayloadWorker();
        const turn = state.breadboardStoragePhase ?? 0;
        const phase = !reserved || state.breadboardWorkspaceWorker?.pending || (over && turn % 2 === 1) ? 4 : turn % 5;
        state.breadboardStoragePhase = turn + 1;
        const compressed = phase === 0 ? await state.breadboardColdWorker.step(db, settings.compression_cursor, shouldYield) : {bytesSaved:0,cursor:settings.compression_cursor};
        result.payloadBytesSaved += compressed.bytesSaved;
        db.prepare("UPDATE storage_settings SET compression_cursor=? WHERE id=1").run(compressed.cursor);
        ensurePdfObjectSchema(db);
        if (phase === 1 && !shouldYield()) {
          // Larger revisions move during the requested offline window: copying
          // a large SQLite BLOB must not block foreground message writes.
          const revision=db.prepare("SELECT id,length(pdf_data) bytes FROM pdf_document_edit_history WHERE length(pdf_data) BETWEEN 1 AND 2097152 ORDER BY id LIMIT 1").get() as {id:number;bytes:number}|undefined;
          if(revision && volume.bavail * volume.bsize >= STORAGE_POLICY.reserveBytes + 3 * revision.bytes)
            result.payloadBytesSaved+=deduplicatePdfRevision(db,revision.id);
        }
        ensureImmutableFileSchema(db);
        if (phase === 2 && !shouldYield() && attachmentIndexComplete(db)) {
          state.breadboardImmutableWorker ??= new ImmutableFileWorker();
          result.bytesReleased+=await state.breadboardImmutableWorker.step(db,root,shouldYield,eligibleArtifact);
          if (!shouldYield()) result.bytesReleased+=await collectImmutableFiles(db,root,now,shouldYield);
        }
        if (phase === 3 && !shouldYield()) {
          const gardens = learnWorkspaceGardenSlugs();
          if (gardens.length) {
            const index = (state.breadboardStorageGarden ?? 0) % gardens.length;
            pruneSupersededLearnBuildWorkspaces({ gardenSlug: gardens[index] });
            state.breadboardStorageGarden = index + 1;
          }
        }
        if (phase === 4 && !shouldYield()) {
          const workspaces=path.join(root,"runtime","hermes-workspaces");
          if (fs.existsSync(workspaces)) {
            if (!workspaceScanState.breadboardWorkspaceScanner || (workspaceScanState.breadboardWorkspaceScanner.result.complete
              && now-workspaceScanState.breadboardWorkspaceScanner.result.updatedAt>7*DAY_MS))
              workspaceScanState.breadboardWorkspaceScanner=new StorageScanner(workspaces);
            if (!workspaceScanState.breadboardWorkspaceScanner.result.complete)
              await workspaceScanState.breadboardWorkspaceScanner.step(shouldYield,128,(relative,stat)=>enqueueWorkspaceCandidate(db,path.join("runtime","hermes-workspaces",relative),stat));
          }
          state.breadboardWorkspaceWorker ??= new WorkspaceStorageWorker();
          result.bytesReleased+=await state.breadboardWorkspaceWorker.step(db,root,shouldYield,input.signal);
          result.continueSoon||=state.breadboardWorkspaceWorker.pending;
          if (!shouldYield()) result.bytesReleased+=await collectWorkspaceStorage(db,root,shouldYield);
        }
      } else if (!reserved) {
        result.skipped.push("Compression is waiting for 2 GiB of free space.");
      }
      // Warm tier: files unchanged for two weeks are compressed in place. It
      // needs no scratch copy, so it also runs below the reserve, and it paces
      // its own I/O, so it shares every slice instead of waiting for a turn.
      if (!shouldYield()) {
        state.breadboardColdFileWorker ??= new ColdFileWorker();
        result.payloadBytesSaved += await state.breadboardColdFileWorker.step(db, root, shouldYield, input.signal);
      }
      // Incremental vacuum never upgrades an existing database on startup.
      if (!shouldYield() && db.pragma("auto_vacuum", { simple: true }) === 2) db.pragma("incremental_vacuum(32)");
    }
    if (input.action === "scan" && state.breadboardStorageScanner?.result.complete) state.breadboardStorageScanner = undefined;
    if (!state.breadboardStorageScanner || (state.breadboardStorageScanner.result.complete
      && now - state.breadboardStorageScanner.result.updatedAt > DAY_MS))
      state.breadboardStorageScanner = new StorageScanner(root);
    if (!state.breadboardStorageScanner.result.complete && !shouldYield()) {
      // The 250 ms slice is the bound. 128 entries a pass, one pass every 15 s,
      // needed weeks of idle time for a million files, and the scan restarts
      // with the server, so it never finished.
      deadline = Math.max(deadline, Date.now() + STORAGE_POLICY.sliceMs);
      const scanner = state.breadboardStorageScanner;
      if (!chatUsage.has(scanner)) chatUsage.set(scanner, new Map());
      const chats = chatUsage.get(scanner)!;
      const inventory = await scanner.step(shouldYield,4096,(relative,stat) => {
        noteChatFile(chats, relative, allocatedBytes(stat));
        if (stat.nlink === BigInt(1)) {
          const classes = scanner.result.classes ??= {}, storageClass = classifyStoragePath(relative);
          classes[storageClass] = (classes[storageClass] ?? 0) + allocatedBytes(stat);
        }
        enqueueImmutableCandidate(db,relative,stat,eligibleArtifact(relative));
        enqueueWorkspaceCandidate(db,relative,stat);
        enqueueColdFile(db,relative,stat);
      });
      db.prepare("UPDATE storage_settings SET inventory=? WHERE id=1").run(JSON.stringify(inventory));
      result.continueSoon ||= !inventory.complete;
      if (inventory.complete) saveChatUsage(db, chats);
    }
    return result;
  } catch (error) {
    result.skipped.push(error instanceof Error ? error.message : "Maintenance could not finish this batch.");
    return result;
  } finally {
    result.finishedAt = Date.now(); result.skipped = [...new Set(result.skipped)];
    db.prepare("UPDATE storage_settings SET last_result=?,updated_at=? WHERE id=1").run(JSON.stringify(result), Date.now());
    db.prepare("DELETE FROM storage_maintenance_lease WHERE id=1 AND holder=?").run(holder);
  }
}
