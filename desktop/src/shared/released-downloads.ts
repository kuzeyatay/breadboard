import fs from "node:fs";
import path from "node:path";

const receiptName = ".breadboard-completed-download.json";
/** The installer calls this only after the verified application has been moved
 * out of staging and no recovery operation needs its downloaded archive. */
export function releaseInstallationDownload(directory: string, filename: string): void {
  if (filename !== "vscode.zip") throw new Error("Unknown installation archive");
  const file = path.join(directory, filename), stat = fs.lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid installation archive");
  fs.writeFileSync(path.join(directory, receiptName), JSON.stringify({ version: 1, owner: "vscode-installer", filename,
    releasedAt: Date.now(), identity: `${stat.dev}:${stat.ino}`, modified: Number(stat.mtimeMs), bytes: Number(stat.size) }), { flag: "wx", mode: 0o600 });
}

/** Only completed, explicitly released archives qualify. Failed downloads,
 * extracted trees and installed application versions remain untouched. */
export function cleanReleasedInstallationDownloads(versions: string, shouldYield: () => boolean, now = Date.now()): number {
  let directory: fs.Dir | undefined, released = 0;
  const valid = (file: string) => {
    const expected = path.resolve(file), actual = fs.realpathSync(expected);
    return !fs.lstatSync(expected).isSymbolicLink() && (process.platform === "win32" ? actual.toLowerCase() === expected.toLowerCase() : actual === expected);
  };
  try {
    if (!valid(versions)) return 0;
    directory = fs.opendirSync(versions);
    for (let count = 0; count < 16 && !shouldYield(); count++) {
      const entry = directory.readSync(); if (!entry) break;
      if (!entry.isDirectory() || !/^\.download-[a-f0-9-]{36}$/u.test(entry.name)) continue;
      const root = path.join(versions, entry.name), manifest = path.join(root, receiptName);
      try {
        if (!valid(root) || !valid(manifest) || fs.statSync(manifest).size > 1024) continue;
        const receipt = JSON.parse(fs.readFileSync(manifest, "utf8"));
        if (receipt.version !== 1 || receipt.owner !== "vscode-installer" || receipt.filename !== "vscode.zip"
          || !Number.isSafeInteger(receipt.releasedAt) || receipt.releasedAt > now - 7 * 86400_000) continue;
        const archive = path.join(root, "vscode.zip");
        if (!valid(archive)) continue;
        const stat = fs.lstatSync(archive, { bigint: true });
        if (!stat.isFile() || `${stat.dev}:${stat.ino}` !== receipt.identity || Number(stat.mtimeMs) !== receipt.modified || Number(stat.size) !== receipt.bytes) continue;
        fs.unlinkSync(archive); if (stat.nlink === 1n) released += Number(stat.blocks * 512n);
        fs.unlinkSync(manifest);
        try { fs.rmdirSync(root); } catch { /* Unexpected contents are protected. */ }
      } catch { /* Busy, redirected or unproven downloads remain intact. */ }
    }
  } catch { /* No owned staging directory yet. */ }
  finally { directory?.closeSync(); }
  return released;
}
