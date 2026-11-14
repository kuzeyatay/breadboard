import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { gardenDirectory } from "../garden-directory.ts";
import { gardenFiles } from "./repository.ts";
import { GardenFileError, gardenFilePath, type GardenFileScope, type GardenFileStore } from "./store.ts";
import { randomUUID } from "node:crypto";

export function libraryFolderScope(userId: number, gardenId: string): GardenFileScope {
  const row = gardenFiles().database.prepare("SELECT id FROM clusters WHERE slug = ? AND user_id = ?").get(gardenId, userId) as { id: number } | undefined;
  if (!row) throw new GardenFileError(404, "file_not_found", "This garden is unavailable.");
  return { userId, ownerId: userId, clusterId: row.id, gardenId };
}

/** Called inside the canonical garden lease. The SQLite transaction also fences imports. */
export function changeMixedFolder(store: GardenFileStore, scope: GardenFileScope, action: "move" | "copy" | "trash", from: string, to: string, changeDisk: () => void): void {
  if (to && to !== from && fs.existsSync(path.join(gardenDirectory(scope.gardenId), gardenFilePath(to)))) throw new GardenFileError(409, "file_name_conflict", "A folder with that name already exists.");
  const entry = store.createFolder(scope, from);
  ensureFolderRecoverySchema(store);
  const operation = randomUUID();
  store.database.prepare("INSERT INTO garden_folder_operations(id,pid,scope,action,entry_id,source,destination) VALUES(?,?,?,?,?,?,?)").run(operation, process.pid, JSON.stringify(scope), action, entry.id, from, to);
  try {
    store.database.transaction(() => {
      if (action === "move") store.move(scope, entry.id, entry.revision, to);
      if (action === "copy") {
        if (store.list(scope).some(item => item.path.toLowerCase() === to.toLowerCase())) throw new GardenFileError(409, "file_name_conflict", "A folder with that name already exists.");
        store.copy(scope, entry.id, to);
      }
      if (action === "trash") store.trash(scope, entry.id, entry.revision);
      changeDisk();
    }).immediate();
    store.database.prepare("DELETE FROM garden_folder_operations WHERE id = ?").run(operation);
  } catch (error) {
    // SQLite rolls metadata back. Undo any filesystem work before allowing a retry.
    try { recoverMixedFolderOperations(store, operation); }
    catch (recoveryError) { store.database.prepare("UPDATE garden_folder_operations SET pid = 2147483647 WHERE id = ?").run(operation); throw recoveryError; }
    throw error;
  }
}

function ensureFolderRecoverySchema(store: GardenFileStore) {
  store.database.exec(`
    CREATE TABLE IF NOT EXISTS garden_folder_operations(id TEXT PRIMARY KEY,pid INTEGER NOT NULL,scope TEXT NOT NULL,action TEXT NOT NULL,entry_id TEXT NOT NULL,source TEXT NOT NULL,destination TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS garden_folder_pdf_backups(folder_id TEXT NOT NULL,revision INTEGER NOT NULL,document_slug TEXT NOT NULL,source_pdf_path TEXT NOT NULL,pdf_data BLOB NOT NULL,byte_length INTEGER NOT NULL,updated_by_user_id INTEGER,updated_at TEXT NOT NULL,PRIMARY KEY(folder_id,revision,document_slug));
  `);
}

export function restoreMixedFolder(store: GardenFileStore, scope: GardenFileScope, id: string) {
  const entry = store.get(scope, id, true);
  if (!entry.deletedAt) return entry;
  const destination = store.restoreDestination(scope, id), operation = randomUUID();
  if (fs.existsSync(path.join(gardenDirectory(scope.gardenId), destination))) throw new GardenFileError(409, "file_restore_conflict", "A notes folder already uses that name. Rename it before restoring.");
  ensureFolderRecoverySchema(store);
  store.database.prepare("INSERT INTO garden_folder_operations(id,pid,scope,action,entry_id,source,destination) VALUES(?,?,?,?,?,?,?)").run(operation, process.pid, JSON.stringify(scope), "restore", id, entry.path, destination);
  try {
    const restored = store.database.transaction(() => {
      const result = store.restore(scope, id);
      if (result.path !== destination) throw new GardenFileError(409, "file_restore_conflict", "This folder changed while restoring. Try again.");
      restoreFolderNotes(store, scope, id, destination);
      return result;
    }).immediate();
    store.database.prepare("DELETE FROM garden_folder_operations WHERE id = ?").run(operation);
    return restored;
  } catch (error) {
    try { recoverMixedFolderOperations(store, operation); }
    catch (recoveryError) { store.database.prepare("UPDATE garden_folder_operations SET pid = 2147483647 WHERE id = ?").run(operation); throw recoveryError; }
    throw error;
  }
}

/** Finish or roll back filesystem changes left by a stopped server process. */
export function recoverMixedFolderOperations(store: GardenFileStore, forceOperation?: string) {
  ensureFolderRecoverySchema(store);
  const operations = store.database.prepare("SELECT * FROM garden_folder_operations").all() as { id: string; pid: number; scope: string; action: string; entry_id: string; source: string; destination: string }[];
  for (const operation of operations) {
    if (forceOperation && operation.id !== forceOperation) continue;
    if (!forceOperation) {
      try { process.kill(operation.pid, 0); continue; } catch { /* The process that owned the filesystem operation is gone. */ }
    }
    const scope = JSON.parse(operation.scope) as GardenFileScope;
    const source = gardenFilePath(operation.source), destination = gardenFilePath(operation.destination, true);
    const root = path.resolve(gardenDirectory(scope.gardenId));
    const from = path.resolve(root, source), to = destination ? path.resolve(root, destination) : "";
    if (!from.startsWith(root + path.sep) || (to && !to.startsWith(root + path.sep))) throw new GardenFileError(400, "file_path_invalid", "Invalid recovery folder.");
    const entry = store.get(scope, operation.entry_id, true);
    if (operation.action === "move" && entry.path === source && to && fs.existsSync(to)) {
      if (fs.existsSync(from)) throw new GardenFileError(409, "file_recovery_conflict", "A folder move needs recovery because both folder names exist. Your files are preserved.");
      fs.renameSync(to, from);
    }
    if (operation.action === "copy" && to && !store.list(scope).some(file => file.path === destination)) fs.rmSync(to, { recursive: true, force: true });
    if (operation.action === "trash") {
      if (entry.deletedAt) fs.rmSync(from, { recursive: true, force: true });
      else restoreFolderNotes(store, scope, entry.id, source, true);
    }
    if (operation.action === "restore" && entry.deletedAt && to) fs.rmSync(to, { recursive: true, force: true });
    if (to) fs.rmSync(path.join(path.dirname(to), `.breadboard-restore-${entry.id}`), { recursive: true, force: true });
    store.database.prepare("DELETE FROM garden_folder_operations WHERE id = ?").run(operation.id);
  }
}

/** Quarantine legacy notes outside Quartz before deleting a mixed folder. */
export function preserveFolderForTrash(store: GardenFileStore, scope: GardenFileScope, folder: string): string {
  ensureFolderRecoverySchema(store);
  const entry = store.createFolder(scope, folder), source = path.resolve(gardenDirectory(scope.gardenId), folder);
  const root = path.resolve(gardenDirectory(scope.gardenId));
  if (!source.startsWith(root + path.sep)) throw new GardenFileError(400, "file_path_invalid", "Invalid folder.");
  const target = path.join(store.root, "folder-trash", entry.id, String(entry.revision));
  if (!fs.existsSync(target)) {
    // Copy only verified regular files/directories, never follow a symlink outside the garden.
    const verify = (dir: string) => { for (const item of fs.readdirSync(dir, { withFileTypes: true })) { if (item.isSymbolicLink()) throw new GardenFileError(400, "file_symlink", "This folder contains a linked directory. Remove the link before moving it to trash."); if (item.isDirectory()) verify(path.join(dir, item.name)); } };
    verify(source);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = path.join(path.dirname(target), `${randomUUID()}.pending`);
    try { fs.cpSync(source, temporary, { recursive: true, errorOnExist: true, force: false }); fs.renameSync(temporary, target); }
    finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }
  const snapshotPdf = store.database.prepare(`INSERT OR REPLACE INTO garden_folder_pdf_backups(folder_id,revision,document_slug,source_pdf_path,pdf_data,byte_length,updated_by_user_id,updated_at)
    SELECT ?,?,document_slug,source_pdf_path,pdf_data,byte_length,updated_by_user_id,updated_at FROM pdf_document_edits WHERE cluster_id = ? AND document_slug = ?`);
  const snapshot = (dir: string) => { for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory()) snapshot(path.join(dir, item.name));
    else if (item.isFile() && /\.md$/i.test(item.name)) snapshotPdf.run(entry.id, entry.revision, scope.clusterId, item.name.slice(0,-3));
  } };
  store.database.transaction(() => snapshot(source)).immediate();
  return entry.id;
}

export function restoreFolderNotes(store: GardenFileStore, scope: GardenFileScope, id: string, destination: string, repair = false): void {
  ensureFolderRecoverySchema(store);
  const archive = path.join(store.root, "folder-trash", id);
  if (!fs.existsSync(archive)) return;
  const version = fs.readdirSync(archive).filter(name => /^\d+$/.test(name)).sort((a,b) => Number(b) - Number(a))[0];
  if (!version) return;
  const backup = path.join(archive, version);
  const root = path.resolve(gardenDirectory(scope.gardenId)), target = path.resolve(root, destination);
  if (!target.startsWith(root + path.sep)) throw new GardenFileError(400, "file_path_invalid", "Invalid folder.");
  if (!repair && fs.existsSync(target)) throw new GardenFileError(409, "file_restore_conflict", "A notes folder already uses that name. Rename it before restoring.");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const pending = path.join(path.dirname(target), `.breadboard-restore-${id}`);
  try {
    fs.cpSync(backup, pending, { recursive: true, force: false, errorOnExist: true });
    if (repair) fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(pending, target);
  } finally { fs.rmSync(pending, { recursive: true, force: true }); }
  store.database.prepare(`INSERT OR IGNORE INTO pdf_document_edits(cluster_id,document_slug,source_pdf_path,pdf_data,byte_length,updated_by_user_id,updated_at)
    SELECT ?,document_slug,source_pdf_path,pdf_data,byte_length,updated_by_user_id,updated_at FROM garden_folder_pdf_backups WHERE folder_id = ? AND revision = ?`).run(scope.clusterId, id, Number(version));
}
