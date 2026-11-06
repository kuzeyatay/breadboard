import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {pathToFileURL} from "node:url";
import readline from "node:readline";
import {DATA_MIGRATION_LOCK, resolveDataRoot, validateDataRoot, writeDataLocation} from "../src/main/data-location.ts";
import {VERIFICATION_RECEIPTS, fileIdentity, openVerificationLedger} from "./data-migration-verification.mjs";

const MARKER = ".breadboard-data-root.json";
const INVENTORY_CHECKPOINT = ".breadboard-migration-inventory.jsonl";
const RUNTIME_SCRATCH = path.join("runtime-v2", "temp");

function inside(root, relative) {
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Migration path escaped its data root.");
  return target;
}

async function hash(file, size) {
  const digest = crypto.createHash("sha256");
  if (Number.isSafeInteger(size) && size >= 0 && size <= 1024 * 1024) {
    // Most retained job receipts are tiny. One bounded buffer avoids stream
    // setup per receipt without allowing a concurrently growing file to cause
    // an unbounded readFile allocation.
    const handle = await fs.promises.open(file, "r");
    try {
      const bytes = Buffer.allocUnsafe(size + 1);
      let read = 0;
      while (read < bytes.length) {
        const result = await handle.read(bytes, read, bytes.length - read, read);
        if (!result.bytesRead) break;
        read += result.bytesRead;
      }
      if (read > size) throw new Error("File grew during verification; retry the final offline copy.");
      return digest.update(bytes.subarray(0, read)).digest("hex");
    } finally { await handle.close(); }
  }
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

async function inventory(root, onProgress = () => {}, visit, options = {}) {
  const {allowMissingLinkTargets = false, checkpoint, destination, skipRuntimeScratch = false, stageErrors, minimal = false} = options;
  const files = new Map();
  const complete = new Set();
  let checkpointFd, checkpointBuffer = "";
  const checkpointHeader = {version: 2, source: root, destination, skipRuntimeScratch};
  function append(value) {
    if (checkpointFd === undefined) return;
    checkpointBuffer += JSON.stringify(value) + "\n";
    if (checkpointBuffer.length >= 1024 * 1024) flush();
  }
  function flush() {
    if (!checkpointBuffer) return;
    fs.writeSync(checkpointFd, checkpointBuffer);
    checkpointBuffer = "";
  }
  if (checkpoint) {
    const metadata = fs.lstatSync(checkpoint, {throwIfNoEntry: false});
    if (metadata) {
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Inventory checkpoint must be a direct file.");
      let first = true, validBytes = 0, stageComplete = false;
      const lines = readline.createInterface({input: fs.createReadStream(checkpoint), crlfDelay: Infinity});
      for await (const line of lines) {
        const nextBytes = validBytes + Buffer.byteLength(line) + 1;
        if (nextBytes > metadata.size) break; // Discard only an incomplete final record after a crash.
        let value;
        try { value = JSON.parse(line); }
        catch { throw new Error("Inventory checkpoint is incomplete or corrupt; preserve it and start a new staging checkpoint."); }
        validBytes = nextBytes;
        if (first) {
          if (JSON.stringify(value) !== JSON.stringify(checkpointHeader)) throw new Error("Inventory checkpoint belongs to another migration.");
          first = false;
        } else if (value.entry) {
          const entry = value.entry;
          if (typeof entry.relative !== "string" || !["file", "directory", "link"].includes(entry.kind)) throw new Error("Inventory checkpoint entry is invalid.");
          inside(root, entry.relative);
          if (entry.kind === "link") inside(root, entry.target);
          if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !Number.isFinite(entry.mtimeMs)) throw new Error("Inventory checkpoint metadata is invalid.");
          files.set(entry.relative, entry);
        } else if (typeof value.complete === "string") {
          if (value.complete) inside(root, value.complete);
          complete.add(value.complete);
        } else if (value.stageComplete === true) stageComplete = true;
        else if (value.issue && stageErrors) stageErrors.push(value.issue);
        else throw new Error("Inventory checkpoint record is invalid.");
      }
      if (first) throw new Error("Inventory checkpoint header was not fully written.");
      if (validBytes !== metadata.size) fs.truncateSync(checkpoint, validBytes);
      if (stageComplete) {
        files.clear(); complete.clear(); stageErrors.length = 0;
        fs.writeFileSync(checkpoint, JSON.stringify(checkpointHeader) + "\n");
      }
      checkpointFd = fs.openSync(checkpoint, "a");
    } else {
      checkpointFd = fs.openSync(checkpoint, "wx", 0o600);
      append(checkpointHeader); flush();
    }
  }
  const record = file => {
    if (visit) visit(file);
    else files.set(file.relative, file);
    append({entry: file});
  };
  const linkTargets = new Map();
  let entries = files.size;
  onProgress({phase: "scan", entries, resumedDirectories: complete.size});
  const resuming = complete.size > 0;
  const directories = [root];
  const queuedDirectories = resuming ? new Set(directories) : null;
  function enqueue(directory) {
    if (!queuedDirectories?.has(directory)) { queuedDirectories?.add(directory); directories.push(directory); }
  }
  async function scanDirectory(directory) {
    const directoryRelative = path.relative(root, directory);
    if (complete.has(directoryRelative)) return;
    let children;
    try { children = await fs.promises.readdir(directory, {withFileTypes: true}); }
    catch (error) {
      if (!stageErrors || !["EACCES", "EPERM", "ENOENT", "EBUSY"].includes(error.code)) throw error;
      const issue = {relative: directoryRelative, error: `Inventory deferred: ${error.code}`};
      stageErrors.push(issue); append({issue}); return;
    }
    for (let offset = 0; offset < children.length; offset += 8) {
      const batch = await Promise.allSettled(children.slice(offset, offset + 8).map(async entry => {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      if (relative === MARKER || relative === INVENTORY_CHECKPOINT || relative === VERIFICATION_RECEIPTS) return;
      if (++entries % 10_000 === 0) onProgress({phase: "scan", entries, tree: relative.split(path.sep)[0]});
      let stat;
      try { stat = await fs.promises.lstat(absolute, {bigint: true}); }
      catch (error) {
        if (!stageErrors || !["EACCES", "EPERM", "ENOENT", "EBUSY"].includes(error.code)) throw error;
        const issue = {relative, error: `Inventory deferred: ${error.code}`};
        stageErrors.push(issue); append({issue}); return;
      }
      if (stat.isSymbolicLink()) {
        // Bun and pnpm use links within their dependency store. Preserve those
        // links with a new local target, without traversing them during copy.
        const raw = fs.readlinkSync(absolute).replace(/^\\\\\?\\/u, "");
        const resolved = path.resolve(path.dirname(absolute), raw);
        const lexicalTarget = path.relative(root, resolved);
        if (!lexicalTarget || lexicalTarget.startsWith("..") || path.isAbsolute(lexicalTarget)) {
          throw new Error(`Migration cannot follow an external symlink or junction: ${relative}`);
        }
        let targetInfo = linkTargets.get(resolved);
        if (!targetInfo) {
          try {
            const canonical = fs.realpathSync.native(resolved).replace(/^\\\\\?\\/u, "");
            targetInfo = {canonical, directory: fs.statSync(canonical).isDirectory()};
          } catch (error) {
            if (!allowMissingLinkTargets || error.code !== "ENOENT") throw error;
            // An older stage omitted empty directories. Accept its dangling
            // internal link only after resolving the existing ancestor; this
            // still rejects an intermediate junction escaping the data root.
            let ancestor = path.dirname(resolved);
            while (!fs.lstatSync(ancestor, {throwIfNoEntry: false})) ancestor = path.dirname(ancestor);
            const canonicalAncestor = fs.realpathSync.native(ancestor).replace(/^\\\\\?\\/u, "");
            targetInfo = {canonical: path.resolve(canonicalAncestor, path.relative(ancestor, resolved)), directory: null};
          }
          linkTargets.set(resolved, targetInfo);
        }
        const target = path.relative(root, targetInfo.canonical);
        if (!target || target.startsWith("..") || path.isAbsolute(target)) {
          throw new Error(`Migration cannot follow an external symlink or junction: ${relative}`);
        }
        record({relative, kind: "link", target, directory: targetInfo.directory, size: 0, mtimeMs: 0});
      } else if (stat.isDirectory()) {
        record({relative, kind: "directory", size: 0, mtimeMs: 0});
        if (!(skipRuntimeScratch && relative === RUNTIME_SCRATCH)) enqueue(absolute);
      } else if (stat.isFile()) record(minimal ? {relative, kind: "file", size: 0, mtimeMs: 0}
        : {relative, kind: "file", size: Number(stat.size), mtimeMs: Number(stat.mtimeNs) / 1e6, mtimeNs: stat.mtimeNs.toString(), ctimeNs: stat.ctimeNs.toString()});
      else throw new Error(`Unsupported data entry: ${relative}`);
      }));
      const failed = batch.find(result => result.status === "rejected");
      if (failed) throw failed.reason;
    }
    if (resuming) complete.add(directoryRelative);
    append({complete: directoryRelative});
  }
  // Each directory enumerates bounded batches; eight directory workers keep
  // Windows metadata I/O moving without spawning an unbounded promise per file.
  try {
    // Completed directories in a resumed snapshot may contain unfinished child
    // directories, so seed those recorded children without re-enumerating parents.
    if (checkpoint) for (const file of files.values()) {
      if (file.kind === "directory" && !complete.has(file.relative)
        && !(skipRuntimeScratch && file.relative === RUNTIME_SCRATCH)) enqueue(inside(root, file.relative));
    }
    let next = 0, active = 0;
    await new Promise((resolve, reject) => {
      let failure;
      function pump() {
        if (failure) { if (!active) reject(failure); return; }
        while (active < 8 && next < directories.length) {
          const directory = directories[next]; directories[next++] = null; active++;
          scanDirectory(directory).then(() => {
            active--;
            if (!failure && !active && next === directories.length) resolve(); else pump();
          }, error => { active--; failure ??= error; pump(); });
        }
      }
      pump();
    });
    flush();
    return [...files.values()];
  } finally {
    if (checkpointFd !== undefined) { flush(); fs.closeSync(checkpointFd); }
  }
}

export function assertOffline(source, {processAlive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}} = {}) {
  const endpoint = path.join(source, "runtime", "endpoints.json");
  if (fs.existsSync(endpoint)) {
    const receipt = JSON.parse(fs.readFileSync(endpoint, "utf8"));
    if (!Number.isSafeInteger(receipt.pid) || receipt.pid <= 0) throw new Error("Runtime owner receipt is invalid.");
    if (processAlive(receipt.pid)) throw new Error("Breadboard is still running. Final migration requires a graceful shutdown after active jobs finish.");
  }
  const file = path.join(source, "runtime-v2", "runtime-v2.sqlite3");
  if (fs.existsSync(file)) {
    const db = new DatabaseSync(file, {readOnly: true});
    try {
      const active = db.prepare("SELECT job_id, state, user_id, owner_principal FROM runtime_jobs WHERE state IN ('queued','admitted','starting','running','checkpointing','cancelling')").all()
        .filter(row =>
          // A future scheduled maintenance tick has no process or user work to
          // interrupt. Its queued record can safely travel with the ledger.
          !(row.state === "queued" && row.user_id === null && row.owner_principal === "internal:runtime-scheduler"));
      if (active.length) throw new Error(`Migration cannot switch while ${active.length} Runtime jobs are unfinished.`);
    } finally { db.close(); }
  }
}

async function ensureTarget(source, destination, onProgress) {
  validateDataRoot(source);
  validateDataRoot(destination, false);
  for (const [parent, child] of [[source, destination], [destination, source]]) {
    const relative = path.relative(parent, child);
    if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      throw new Error("Source and destination data directories must not overlap.");
    }
  }
  fs.mkdirSync(destination, {recursive: true});
  const marker = path.join(destination, MARKER);
  if (fs.existsSync(marker)) {
    const value = JSON.parse(fs.readFileSync(marker, "utf8"));
    if (value.version !== 1 || value.source !== source || value.destination !== destination) {
      throw new Error("The destination belongs to another data migration.");
    }
  } else {
    if (fs.readdirSync(destination).length) throw new Error("Migration destination must be empty or owned by this migration.");
    fs.writeFileSync(marker, JSON.stringify({version: 1, source, destination}) + "\n", {flag: "wx", mode: 0o600});
  }
  // Existing staged content must be direct too; never copy through a junction.
  return inventory(destination, progress => onProgress({...progress, phase: "scan-staged"}), undefined, {allowMissingLinkTargets: true, minimal: true});
}

export async function migrateDataLocation(options) {
  const profile = validateDataRoot(options.userDataDir);
  const source = validateDataRoot(resolveDataRoot(profile));
  if (!options.activate) return copyDataLocation({...options, profile, source});
  const lock = path.join(profile, DATA_MIGRATION_LOCK);
  fs.writeFileSync(lock, JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}) + "\n", {flag: "wx", mode: 0o600});
  try {
    return await copyDataLocation({...options, profile, source});
  } finally {
    fs.unlinkSync(lock);
  }
}

async function copyDataLocation({profile, source, destination, activate = false, onProgress = () => {}}) {
  const target = validateDataRoot(destination, false);
  if (activate) assertOffline(source);
  onProgress({phase: "scan-staged", entries: 0});
  const stagedFiles = await ensureTarget(source, target, onProgress);
  const errors = [];
  const sourceFiles = await inventory(source, onProgress, undefined, {
    skipRuntimeScratch: true,
    ...(activate ? {} : {checkpoint: path.join(target, INVENTORY_CHECKPOINT), destination: target, stageErrors: errors}),
  });
  // Avoid a second multi-million-entry array of temporary key/value tuples.
  const sourceEntries = new Map();
  for (const file of sourceFiles) sourceEntries.set(file.relative, file);
  for (const file of stagedFiles.filter(file => file.kind === "link")) {
    const expected = sourceEntries.get(file.relative);
    if (expected && (expected.kind !== "link" || expected.target !== file.target)) {
      throw new Error(`Staged dependency link no longer matches the source: ${file.relative}`);
    }
  }
  let copied = 0;
  let bytes = 0;
  let verified = 0;
  let reused = 0;
  const ordinaryFiles = sourceFiles.filter(file => file.kind === "file");
  onProgress({phase: "copy", files: sourceFiles.length, bytes: ordinaryFiles.reduce((sum, file) => sum + file.size, 0)});
  const stagedDirectories = new Set(stagedFiles.filter(file => file.kind === "directory").map(file => file.relative));
  for (const file of sourceFiles) {
    if (file.kind !== "directory") continue;
    if (stagedDirectories.has(file.relative)) { verified++; continue; }
    const to = inside(target, file.relative);
    const existing = fs.lstatSync(to, {throwIfNoEntry: false});
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error(`Staged directory conflicts with another entry: ${file.relative}`);
    if (!existing) { fs.mkdirSync(to, {recursive: true}); copied++; }
    verified++;
    if (verified % 10_000 === 0) onProgress({phase: "directories", files: sourceFiles.length, verified, copied});
  }
  stagedDirectories.clear();
  const ledger = await openVerificationLedger({
    file: path.join(target, VERIFICATION_RECEIPTS), source, destination: target, entries: sourceEntries,
    validatePath: relative => { inside(source, relative); inside(target, relative); }, onProgress,
  });
  const verifiedTargetParents = new Set();
  async function transfer(file) {
    const from = inside(source, file.relative), to = inside(target, file.relative);
    try {
      // A resumed snapshot must not follow a source directory that was replaced
      // with a link after it was inventoried. Canonicalize the current file too.
      const canonical = (await fs.promises.realpath(from)).replace(/^\\\\\?\\/u, "");
      const samePath = process.platform === "win32" ? canonical.toLowerCase() === from.toLowerCase() : canonical === from;
      if (!samePath) throw new Error("Source no longer has its inventoried direct path; retry after resolving the redirected entry.");
      const parent = path.dirname(to);
      if (!verifiedTargetParents.has(parent)) {
        const realParent = (await fs.promises.realpath(parent)).replace(/^\\\\\?\\/u, "");
        if (process.platform === "win32" ? realParent.toLowerCase() !== parent.toLowerCase() : realParent !== parent) throw new Error("Staged parent directory was redirected.");
        verifiedTargetParents.add(parent);
      }
      const before = await fs.promises.lstat(from, {bigint: true});
      if (!before.isFile() || before.isSymbolicLink()) throw new Error("Source is no longer a direct regular file.");
      const beforeIdentity = fileIdentity(before);
      const existing = fs.lstatSync(to, {throwIfNoEntry: false, bigint: true});
      if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error("Staged file is no longer a direct regular file.");
      let sourceHash = ledger.lookup(file.relative, before.ino === 0n ? null : beforeIdentity, existing?.ino === 0n ? null : fileIdentity(existing));
      const reusedReceipt = Boolean(sourceHash);
      if (!sourceHash) sourceHash = await hash(from, file.size);
      let hashedTargetIdentity = fileIdentity(existing);
      let targetHash = reusedReceipt ? sourceHash : existing?.size === BigInt(file.size) ? await hash(to, Number(existing.size)) : null;
      if (targetHash !== sourceHash) {
        await fs.promises.mkdir(path.dirname(to), {recursive: true});
        await fs.promises.copyFile(from, to);
        await fs.promises.utimes(to, new Date(file.mtimeMs), new Date(file.mtimeMs));
        copied++;
        hashedTargetIdentity = fileIdentity(await fs.promises.lstat(to, {bigint: true}));
        targetHash = await hash(to, file.size);
      }
      const after = await fs.promises.lstat(from, {bigint: true});
      const afterTarget = await fs.promises.lstat(to, {bigint: true});
      const matchesInventory = after.size === BigInt(file.size) && (file.mtimeNs
        ? after.mtimeNs.toString() === file.mtimeNs : Math.abs(Number(after.mtimeNs) / 1e6 - file.mtimeMs) < 0.001)
        && (!file.ctimeNs || after.ctimeNs.toString() === file.ctimeNs);
      if (!matchesInventory || fileIdentity(after) !== beforeIdentity || targetHash !== sourceHash
        || fileIdentity(afterTarget) !== hashedTargetIdentity) {
        throw new Error("A file changed during verification; final offline copy will retry it.");
      }
      ledger.record(file.relative, after.ino === 0n ? null : fileIdentity(after), afterTarget.ino === 0n ? null : fileIdentity(afterTarget), sourceHash);
      if (reusedReceipt) reused++;
      bytes += file.size;
      verified++;
    } catch (error) {
      errors.push({relative: file.relative, error: error.message});
      if (activate) throw error;
    }
    if ((verified + errors.length) % 1000 === 0) onProgress({files: sourceFiles.length, verified, copied, reused, bytes, changed: errors.length});
  }
  let nextFile = 0;
  let transfers;
  try {
    transfers = await Promise.allSettled(Array.from({length: 8}, async () => {
      for (;;) {
        const file = ordinaryFiles[nextFile++];
        if (!file) return;
        await transfer(file);
      }
    }));
  } finally { ledger.close(); }
  const failure = transfers.find(result => result.status === "rejected");
  if (failure) throw failure.reason;
  for (const file of sourceFiles.filter(file => file.kind === "link")) {
    const to = inside(target, file.relative), linkTarget = inside(target, file.target);
    fs.mkdirSync(path.dirname(to), {recursive: true});
    const existing = fs.lstatSync(to, {throwIfNoEntry: false});
    if (existing) {
      if (!existing.isSymbolicLink()) throw new Error(`Staged link conflicts with a regular file: ${file.relative}`);
      const current = fs.realpathSync.native(to).replace(/^\\\\\?\\/u, "");
      if (path.relative(target, current) !== file.target) throw new Error(`Staged link target changed: ${file.relative}`);
    } else {
      fs.symlinkSync(linkTarget, to, file.directory ? (process.platform === "win32" ? "junction" : "dir") : "file");
      copied++;
    }
    verified++;
  }
  let quarantine = null;
  if (activate) {
    assertOffline(source);
    let stableEntries = 0;
    await inventory(source, progress => onProgress({...progress, phase: "verify-source"}), file => {
      const before = sourceEntries.get(file.relative);
      if (!before || before.kind !== file.kind || before.size !== file.size || before.mtimeMs !== file.mtimeMs
        || before.mtimeNs !== file.mtimeNs || before.ctimeNs !== file.ctimeNs
        || before.target !== file.target || before.directory !== file.directory) throw new Error("Source changed during final verification.");
      stableEntries++;
    }, {skipRuntimeScratch: true});
    if (stableEntries !== sourceFiles.length) throw new Error("Source changed during final verification.");
    // Files deleted between staging and shutdown (especially SQLite WALs) must
    // not reappear in the activated copy. Preserve them outside the new root.
    const quarantinedDirectories = new Set();
    for (const file of stagedFiles) {
      if (sourceEntries.has(file.relative)) continue;
      let ancestor = path.dirname(file.relative), alreadyMoved = false;
      while (ancestor !== ".") {
        if (quarantinedDirectories.has(ancestor)) { alreadyMoved = true; break; }
        ancestor = path.dirname(ancestor);
      }
      if (alreadyMoved) continue;
      quarantine ??= `${target}.staging-history-${Date.now()}`;
      const from = inside(target, file.relative), to = inside(quarantine, file.relative);
      fs.mkdirSync(path.dirname(to), {recursive: true});
      fs.renameSync(from, to);
      if (file.kind === "directory") quarantinedDirectories.add(file.relative);
    }
    for (const file of sourceFiles.filter(file => file.kind === "file" && /\.(?:db|sqlite3?)$/iu.test(file.relative))) {
      const targetFile = inside(target, file.relative);
      const header = Buffer.alloc(16);
      const fd = fs.openSync(targetFile, "r");
      try { fs.readSync(fd, header, 0, 16, 0); } finally { fs.closeSync(fd); }
      if (header.toString("utf8") !== "SQLite format 3\0") continue;
      const db = new DatabaseSync(targetFile, {readOnly: true});
      try {
        const checks = db.prepare("PRAGMA quick_check").all();
        if (checks.some(row => Object.values(row)[0] !== "ok")) throw new Error(`Copied database failed integrity verification: ${file.relative}`);
      } finally { db.close(); }
    }
    assertOffline(source);
    writeDataLocation(profile, {version: 1, dataRoot: target, previousDataRoot: source, verifiedAt: new Date().toISOString()});
  }
  const report = {version: 1, source, destination: target, activated: activate, verifiedAt: new Date().toISOString(), files: sourceFiles.length, verified, copied, reused, bytes, errors, quarantine, excludedProcessScratch: ["runtime-v2/temp"], originalRetained: true};
  const reportFile = path.join(profile, "breadboard-data-migration.json");
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", {mode: 0o600});
  if (!activate) fs.appendFileSync(path.join(target, INVENTORY_CHECKPOINT), JSON.stringify({stageComplete: true}) + "\n");
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const value = flag => { const index = args.indexOf(flag); return index < 0 ? null : args[index + 1]; };
  const userDataDir = value("--user-data"), destination = value("--destination");
  if (!userDataDir || !destination || args.some(arg => arg.startsWith("--") && !["--user-data", "--destination", "--activate"].includes(arg))) {
    throw new Error("Usage: node --experimental-strip-types desktop/scripts/migrate-data-location.mjs --user-data <profile> --destination <directory> [--activate]");
  }
  const report = await migrateDataLocation({userDataDir, destination, activate: args.includes("--activate"), onProgress: progress => console.log(JSON.stringify(progress))});
  console.log(JSON.stringify(report));
}
