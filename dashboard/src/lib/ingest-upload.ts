if (typeof window !== "undefined") {
  throw new Error("Breadboard ingestion staging is server-only.");
}

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import Busboy from "busboy";

export interface IngestUploadFile {
  name: string;
  type: string;
  size: number;
  readBuffer(): Promise<Buffer>;
  text(): Promise<string>;
}

export class StagedIngestUpload implements IngestUploadFile {
  size = 0;
  private cachedBytes: Buffer | null = null;
  readonly name: string;
  readonly type: string;
  readonly path: string;

  constructor(name: string, type: string, diskPath: string) {
    this.name = name;
    this.type = type;
    this.path = diskPath;
  }

  async readBuffer(): Promise<Buffer> {
    this.cachedBytes ??= await fs.promises.readFile(this.path);
    return this.cachedBytes;
  }

  async text(): Promise<string> {
    return this.cachedBytes
      ? this.cachedBytes.toString("utf8")
      : fs.promises.readFile(this.path, "utf8");
  }
}

export interface ParsedIngestUpload {
  fields: Map<string, string>;
  file: IngestUploadFile | null;
  cleanup(): Promise<void>;
}

export function uploadLimitBytes(env: NodeJS.ProcessEnv = process.env): number {
  const key = "BREADBOARD_INGEST_MAX_UPLOAD_MB";
  const raw = env[key]?.trim();
  if (!raw) return 512 * 1024 * 1024;
  if (!/^\d+$/.test(raw)) throw new Error(`${key} must be a whole number of MB.`);
  const mb = Number(raw);
  if (!Number.isSafeInteger(mb) || mb < 16 || mb > 2048) {
    throw new Error(`${key} must be between 16 and 2048 MB.`);
  }
  return mb * 1024 * 1024;
}

function browserFile(file: File): IngestUploadFile {
  let cachedBytes: Buffer | null = null;
  return {
    name: file.name,
    type: file.type,
    size: file.size,
    async readBuffer() {
      cachedBytes ??= Buffer.from(await file.arrayBuffer());
      return cachedBytes;
    },
    async text() {
      return cachedBytes ? cachedBytes.toString("utf8") : file.text();
    },
  };
}

export async function parseIngestUpload(request: Request): Promise<ParsedIngestUpload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\b/i.test(contentType) || !request.body) {
    const form = await request.formData();
    const file = form.get("file");
    return {
      fields: new Map(
        [...form.entries()].flatMap(([key, value]) =>
          typeof value === "string" ? [[key, value] as const] : [],
        ),
      ),
      file: file instanceof File ? browserFile(file) : null,
      cleanup: async () => undefined,
    };
  }

  const root = process.env.BREADBOARD_DATA_DIR?.trim()
    ? path.join(process.env.BREADBOARD_DATA_DIR, "runtime", "ingest-uploads")
    : path.join(os.tmpdir(), "breadboard-ingest-uploads");
  await fs.promises.mkdir(root, { recursive: true });
  const stagingDir = await fs.promises.mkdtemp(path.join(root, "upload-"));
  const fields = new Map<string, string>();
  const writes: Promise<void>[] = [];
  let staged: StagedIngestUpload | null = null;
  let parseError: Error | null = null;
  const parser = Busboy({
    headers: { "content-type": contentType },
    limits: { fileSize: uploadLimitBytes(), files: 1, fields: 32, fieldSize: 64 * 1024, parts: 33 },
  });
  parser.on("field", (name, value) => fields.set(name, value));
  parser.on("file", (name, stream, info) => {
    if (name !== "file" || staged) {
      stream.resume();
      return;
    }
    const diskPath = path.join(stagingDir, randomUUID());
    staged = new StagedIngestUpload(
      path.basename(info.filename || "upload"),
      info.mimeType || "application/octet-stream",
      diskPath,
    );
    const output = fs.createWriteStream(diskPath, { flags: "wx", mode: 0o600 });
    writes.push(new Promise<void>((resolve) => {
      output.once("finish", resolve);
      output.once("error", (error) => {
        parseError ??= error;
        resolve();
      });
      output.once("close", () => {
        if (!output.writableFinished) {
          parseError ??= new Error("Upload staging ended early.");
          resolve();
        }
      });
      stream.once("error", (error) => {
        parseError ??= error;
        resolve();
      });
    }));
    stream.on("data", (chunk: Buffer) => { if (staged) staged.size += chunk.byteLength; });
    stream.on("limit", () => {
      parseError = new Error("Upload exceeds the configured ingestion size limit.");
      output.destroy(parseError);
    });
    stream.pipe(output);
  });
  parser.on("filesLimit", () => { parseError = new Error("Only one ingestion file is allowed."); });
  parser.on("fieldsLimit", () => { parseError = new Error("Too many ingestion fields."); });
  parser.on("partsLimit", () => { parseError = new Error("Too many ingestion parts."); });

  const source = Readable.fromWeb(request.body as never);
  try {
    await new Promise<void>((resolve, reject) => {
      source.once("error", reject);
      parser.once("error", reject);
      parser.once("close", resolve);
      source.pipe(parser);
    });
    await Promise.all(writes);
    if (parseError) throw parseError;
    return {
      fields,
      file: staged,
      cleanup: () => fs.promises.rm(stagingDir, { recursive: true, force: true }),
    };
  } catch (error) {
    source.unpipe(parser);
    await fs.promises.rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}
