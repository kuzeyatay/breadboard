import { Readable } from "node:stream";
import { ZipFile } from "yazl";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import type { ArchiveWriter } from "./archive.ts";

type Entry = { name: string } & (
  | { data: Buffer }
  | { filename: string; size: number }
);

/** ZIP64, bounded file reads and backpressure, without buffering the archive. */
export class StreamingArchive implements ArchiveWriter {
  private entries: Entry[] = [];

  addFile(name: string, data: Buffer): void {
    this.entries.push({ name, data });
  }

  addSourceFile(name: string, filename: string, size: number): void {
    this.entries.push({ name, filename, size });
  }

  stream(): Readable {
    const entries = this.entries;
    return Readable.from((async function* () {
      const zip = new ZipFile();
      const output = zip.outputStream as Readable;
      let active: Readable | undefined;
      let cancelled = false;
      zip.on("error", (error) => output.destroy(error));
      try {
        for (const entry of entries) {
          if ("data" in entry) {
            if (entry.name.endsWith("/")) zip.addEmptyDirectory(entry.name);
            else zip.addBuffer(entry.data, entry.name);
          } else {
            zip.addReadStreamLazy(entry.name, { size: entry.size }, (callback) => {
              if (cancelled) return;
              try {
                // Check again at read time: a removed/replaced source must fail
                // the download, never silently turn into a truncated backup.
                const stat = fs.lstatSync(entry.filename);
                if (!stat.isFile() || stat.isSymbolicLink()) {
                  throw new Error(`Export source is no longer a regular file: ${entry.name}`);
                }
                active = fs.createReadStream(entry.filename);
                callback(null, active);
              } catch (error) {
                output.destroy(error instanceof Error ? error : new Error(String(error)));
              }
            });
          }
        }
        zip.end();
        for await (const chunk of output) yield chunk;
      } finally {
        cancelled = true;
        active?.destroy();
        output.destroy();
      }
    })(), { objectMode: false });
  }
}
