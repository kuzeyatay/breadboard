// Initial installation only. Run during the coordinated normal shutdown,
// before rebuilding/restarting the desktop and syncing native manifests.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readLeanDesktopLease, LEAN_DESKTOP_LEASE_RELATIVE } from "../../desktop/scripts/lean-desktop-lease.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const paths = ["dashboard/scripts/runtime-v2-dashboard.mjs", "dashboard/scripts/learn-worker-import-hook.mjs"];
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const entries = paths.map(relative => {
  const target = path.join(root, relative);
  const next = fs.readFileSync(path.join(root, ".tmp/self-repair-staging", relative));
  const baseline = fs.readFileSync(path.join(root, ".tmp/source-repair-baseline", relative.replaceAll("/", "__")));
  const current = fs.readFileSync(target);
  if (digest(current) !== digest(baseline) && digest(current) !== digest(next)) throw new Error(`Concurrent launcher changes require review: ${relative}`);
  return { relative, target, next, current, changed: digest(current) !== digest(next) };
});
if (!process.argv.includes("--apply")) {
  console.log(JSON.stringify({ pending: entries.filter(entry => entry.changed).map(entry => entry.relative) }));
} else {
  const lease = readLeanDesktopLease(path.join(root, LEAN_DESKTOP_LEASE_RELATIVE));
  if (lease) {
    let live = true;
    try { process.kill(lease.pid, 0); } catch (error) { if (error.code === "ESRCH") live = false; }
    if (live) throw new Error("A desktop/build lifecycle still owns this checkout. Wait for its coordinated shutdown.");
  }
  // Check every deny-write lock before changing either launcher.
  const handles = [];
  try { for (const entry of entries.filter(entry => entry.changed)) handles.push(fs.openSync(entry.target, "r+")); }
  finally { for (const handle of handles) fs.closeSync(handle); }
  const write = (target, bytes) => {
    const temporary = `${target}.${randomUUID()}.pending`;
    fs.writeFileSync(temporary, bytes, { flag: "wx" });
    try { fs.renameSync(temporary, target); } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  };
  const completed = [];
  try {
    for (const entry of entries.filter(entry => entry.changed)) { write(entry.target, entry.next); completed.push(entry); }
  } catch (error) { for (const entry of completed.reverse()) write(entry.target, entry.current); throw error; }
  const marker = path.join(root, ".runtime/source-repair-installation.json");
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  write(marker, JSON.stringify({ version: 1, installedAt: new Date().toISOString(), launchers: entries.map(entry => ({ path: entry.relative, sha256: digest(entry.next) })) }));
  console.log(JSON.stringify({ installed: entries.map(entry => ({ path: entry.relative, sha256: digest(fs.readFileSync(entry.target)) })) }));
}
