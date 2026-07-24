// Screenshot storage on the filesystem (never in a relational DB).
//
// Screenshots are associated to a run + sequence number, size/format checked,
// and served ONLY through authenticated Breadboard routes. Path traversal is
// rejected at every boundary. A retention sweep bounds disk usage.

import fs from "node:fs";
import path from "node:path";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5 MB hard cap
const SAFE_RUN_ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface StoredScreenshot {
  screenshotId: string;
  bytes: number;
}

export class ScreenshotStoreError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "ScreenshotStoreError";
    this.code = code;
  }
}

function assertSafeRunId(runId: string): void {
  if (!SAFE_RUN_ID.test(runId)) throw new ScreenshotStoreError("invalid_run_id");
}

/** screenshotId is the sequence number; reject anything non-numeric. */
function assertSafeScreenshotId(id: string): void {
  if (!/^[0-9]{1,12}$/.test(id)) throw new ScreenshotStoreError("invalid_screenshot_id");
}

export class ScreenshotStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private runDir(runId: string): string {
    assertSafeRunId(runId);
    const dir = path.join(this.baseDir, runId);
    const resolved = path.resolve(dir);
    // Defense in depth: resolved path must stay under baseDir.
    if (!resolved.startsWith(path.resolve(this.baseDir) + path.sep) && resolved !== path.resolve(this.baseDir)) {
      throw new ScreenshotStoreError("path_escape");
    }
    return resolved;
  }

  /** Persist a base64 PNG for a run+sequence. Validates format and size. */
  async put(runId: string, sequenceNumber: number, base64Png: string): Promise<StoredScreenshot> {
    const screenshotId = String(sequenceNumber);
    assertSafeScreenshotId(screenshotId);
    let buf: Buffer;
    try {
      buf = Buffer.from(base64Png, "base64");
    } catch {
      throw new ScreenshotStoreError("invalid_base64");
    }
    if (buf.length === 0 || buf.length > MAX_SCREENSHOT_BYTES) {
      throw new ScreenshotStoreError("invalid_screenshot_size");
    }
    if (!buf.subarray(0, 8).equals(PNG_MAGIC)) {
      throw new ScreenshotStoreError("not_a_png");
    }
    const dir = this.runDir(runId);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, `${screenshotId}.png`), buf);
    return { screenshotId, bytes: buf.length };
  }

  /** Resolve an on-disk path for reading, with traversal protection. */
  resolvePath(runId: string, screenshotId: string): string {
    assertSafeScreenshotId(screenshotId);
    const dir = this.runDir(runId);
    const p = path.resolve(path.join(dir, `${screenshotId}.png`));
    if (!p.startsWith(dir + path.sep) && p !== dir) throw new ScreenshotStoreError("path_escape");
    return p;
  }

  async read(runId: string, screenshotId: string): Promise<Buffer | null> {
    try {
      return await fs.promises.readFile(this.resolvePath(runId, screenshotId));
    } catch {
      return null;
    }
  }

  async deleteRun(runId: string): Promise<void> {
    const dir = this.runDir(runId);
    await fs.promises.rm(dir, { recursive: true, force: true });
  }

  /** Delete screenshot directories older than maxAgeMs (0 = disabled). */
  async sweep(maxAgeMs: number, now: number = Date.now()): Promise<number> {
    if (maxAgeMs <= 0) return 0;
    let removed = 0;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(this.baseDir, { withFileTypes: true });
    } catch {
      return 0;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(this.baseDir, e.name);
      try {
        const stat = await fs.promises.stat(dir);
        if (now - stat.mtimeMs > maxAgeMs) {
          await fs.promises.rm(dir, { recursive: true, force: true });
          removed += 1;
        }
      } catch {
        // ignore
      }
    }
    return removed;
  }
}
