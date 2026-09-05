if (typeof window !== "undefined") {
  throw new Error("Breadboard ingestion staging is server-only.");
}

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import Busboy from "busboy";
import {
  abandonRuntimeJobInput,
  reserveRuntimeJobInput,
  uploadRuntimeJobInput,
  type RuntimeJobAuthority,
  type RuntimeJobInput,
  type RuntimeJobInputReservation,
} from "./supervisor-control.ts";

export interface IngestUploadMetadata {
  name: string;
  type: string;
  size: number;
}

export interface IngestUploadFile extends IngestUploadMetadata {
  readBuffer(): Promise<Buffer>;
  text(): Promise<string>;
}

export class StagedIngestUpload implements IngestUploadFile {
  size = 0;
  private cachedBytes: Buffer | null = null;
  private readonly streamedDigest = createHash("sha256");
  private completedDigest: string | null = null;
  readonly name: string;
  readonly type: string;
  readonly path: string;
  readonly stagingId: string;

  constructor(name: string, type: string, stagingId: string, diskPath: string) {
    this.name = name;
    this.type = type;
    this.stagingId = stagingId;
    this.path = diskPath;
  }

  noteChunk(chunk: Buffer): void {
    if (this.completedDigest !== null) {
      throw new Error("The completed ingestion upload cannot accept more bytes.");
    }
    this.size += chunk.byteLength;
    this.streamedDigest.update(chunk);
  }

  sealDigest(): void {
    if (this.completedDigest === null) {
      this.completedDigest = this.streamedDigest.digest("hex");
    }
  }

  get sha256(): string {
    if (this.completedDigest === null) {
      throw new Error("The ingestion upload digest is not complete.");
    }
    return this.completedDigest;
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
  file: IngestUploadMetadata | null;
  stageRuntimeInput(
    authority: RuntimeJobAuthority,
    signal?: AbortSignal,
  ): Promise<RuntimeJobInput>;
  markRuntimeInputSubmitted(): void;
  cleanup(): Promise<void>;
}

export interface RuntimeIngestUploadOptions {
  readonly authority: RuntimeJobAuthority;
  readonly declaredSizeBytes: number;
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

async function createPrivateStagingDirectory(root: string): Promise<{
  stagingId: string;
  stagingDir: string;
}> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stagingId = `blob_${randomUUID().replaceAll("-", "")}`;
    const stagingDir = path.join(root, stagingId);
    try {
      await fs.promises.mkdir(stagingDir, { mode: 0o700 });
      return { stagingId, stagingDir };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("A private ingestion staging identity could not be created.");
}

async function removePrivateStagingDirectory(
  root: string,
  stagingDir: string | null,
): Promise<void> {
  if (!stagingDir) return;
  const resolvedRoot = path.resolve(root);
  const resolvedStaging = path.resolve(stagingDir);
  if (
    path.dirname(resolvedStaging) !== resolvedRoot ||
    !/^blob_[a-f0-9]{32}$/u.test(path.basename(resolvedStaging))
  ) {
    throw new Error("Refusing to remove an invalid ingestion staging directory.");
  }
  await fs.promises.rm(resolvedStaging, { recursive: true, force: true });
}

function decodeMultipartFilename(value: string): string {
  // Busboy's default for a legacy `filename=` parameter is latin1, while
  // browsers and Node's WHATWG FormData put UTF-8 bytes there. Only reinterpret
  // byte-shaped strings: a correctly decoded Unicode filename contains code
  // points above 0xff and must be left alone. Fatal decoding also preserves a
  // genuinely latin1 filename instead of replacing any character.
  if ([...value].some((character) => character.codePointAt(0)! > 0xff)) {
    return value;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.from(value, "latin1"),
    );
  } catch {
    return value;
  }
}

function sameAuthority(
  left: RuntimeJobAuthority,
  right: RuntimeJobAuthority,
): boolean {
  return (
    left.userId === right.userId &&
    left.gardenId === right.gardenId &&
    left.conversationId === right.conversationId
  );
}

export async function parseIngestUpload(
  request: Request,
  runtime?: RuntimeIngestUploadOptions,
): Promise<ParsedIngestUpload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\b/i.test(contentType) || !request.body) {
    throw new Error("Document ingestion requires a multipart upload stream.");
  }

  const root = process.env.BREADBOARD_DATA_DIR?.trim()
    ? path.join(process.env.BREADBOARD_DATA_DIR, "runtime", "ingest-uploads")
    : path.join(os.tmpdir(), "breadboard-ingest-uploads");
  let stagingDir: string | null = null;
  let stagingId: string | null = null;
  if (!runtime) {
    await fs.promises.mkdir(root, { recursive: true });
    ({ stagingId, stagingDir } = await createPrivateStagingDirectory(root));
  }
  const fields = new Map<string, string>();
  const writes: Promise<void>[] = [];
  let staged: StagedIngestUpload | null = null;
  let metadata: IngestUploadMetadata | null = null;
  let reservation: RuntimeJobInputReservation | null = null;
  let runtimeInput: RuntimeJobInput | null = null;
  let runtimeAuthority: RuntimeJobAuthority | null = runtime?.authority ?? null;
  let submitted = false;
  let stagingRemoved = false;
  let parseError: Error | null = null;
  const maximumBytes = uploadLimitBytes();
  if (
    runtime &&
    (!Number.isSafeInteger(runtime.declaredSizeBytes) ||
      runtime.declaredSizeBytes < 1 ||
      runtime.declaredSizeBytes > maximumBytes)
  ) {
    throw new Error("The declared ingestion file size is invalid.");
  }
  const parser = Busboy({
    headers: { "content-type": contentType },
    limits: {
      // Busboy reports `limit` when the byte count reaches the configured
      // value. Permit the exact declared maximum and fail on the first extra
      // byte; Rust independently seals only the exact Content-Length.
      fileSize: (runtime?.declaredSizeBytes ?? maximumBytes) + 1,
      files: 1,
      fields: 32,
      fieldSize: 64 * 1024,
      parts: 33,
    },
  });
  parser.on("field", (name, value) => {
    if (
      new TextEncoder().encode(name).byteLength > 256 ||
      new TextEncoder().encode(value).byteLength >= 64 * 1024
    ) {
      parseError ??= new Error("An ingestion field exceeds its configured limit.");
      return;
    }
    fields.set(name, value);
  });
  parser.on("file", (name, stream, info) => {
    if (name !== "file" || metadata) {
      stream.resume();
      return;
    }
    const displayName = path.basename(
      decodeMultipartFilename(info.filename || "upload"),
    );
    const mediaType = info.mimeType || "application/octet-stream";
    metadata = {
      name: displayName,
      type: mediaType,
      size: runtime?.declaredSizeBytes ?? 0,
    };
    stream.on("limit", () => {
      parseError ??= new Error("Upload exceeds the configured ingestion size limit.");
    });

    if (runtime) {
      writes.push((async () => {
        try {
          reservation = await reserveRuntimeJobInput(
            runtime.authority,
            {
              gardenId: runtime.authority.gardenId,
              conversationId: runtime.authority.conversationId,
              displayName,
              mediaType,
              declaredSizeBytes: runtime.declaredSizeBytes,
            },
          );
          runtimeInput = await uploadRuntimeJobInput(
            runtime.authority,
            reservation,
            Readable.toWeb(stream as unknown as Readable) as ReadableStream<Uint8Array>,
            request.signal,
          );
          metadata = {
            name: runtimeInput.displayName,
            type: runtimeInput.mediaType ?? "application/octet-stream",
            size: runtimeInput.sizeBytes,
          };
        } catch (error) {
          parseError ??= error instanceof Error ? error : new Error("Upload staging failed.");
          stream.resume();
        }
      })());
      return;
    }

    const diskPath = path.join(stagingDir!, "payload");
    staged = new StagedIngestUpload(
      displayName,
      mediaType,
      stagingId!,
      diskPath,
    );
    const output = fs.createWriteStream(diskPath, { flags: "wx", mode: 0o600 });
    writes.push(new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      output.once("finish", finish);
      output.once("error", (error) => {
        parseError ??= error;
        finish();
      });
      output.once("close", () => {
        if (!output.writableFinished) {
          parseError ??= new Error("Upload staging ended early.");
        }
        finish();
      });
      stream.once("error", (error) => {
        parseError ??= error;
        finish();
      });
    }));
    stream.on("data", (chunk: Buffer) => staged?.noteChunk(chunk));
    stream.pipe(output);
  });
  parser.on("filesLimit", () => { parseError = new Error("Only one ingestion file is allowed."); });
  parser.on("fieldsLimit", () => { parseError = new Error("Too many ingestion fields."); });
  parser.on("partsLimit", () => { parseError = new Error("Too many ingestion parts."); });

  const source = Readable.fromWeb(request.body as never);
  const abandonReservation = async () => {
    if (!reservation || !runtimeAuthority || submitted) return;
    const uploadId = reservation.uploadId;
    reservation = null;
    runtimeInput = null;
    try {
      await abandonRuntimeJobInput(runtimeAuthority, uploadId);
    } catch (error) {
      console.warn(
        "[ingest-upload] Runtime input abandonment failed:",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  };
  const removeStaging = async () => {
    if (stagingRemoved) return;
    await removePrivateStagingDirectory(root, stagingDir);
    stagingRemoved = true;
  };
  try {
    await new Promise<void>((resolve, reject) => {
      source.once("error", reject);
      parser.once("error", reject);
      parser.once("close", resolve);
      source.pipe(parser);
    });
    await Promise.all(writes);
    if (parseError) throw parseError;
    const completedStaged = staged as StagedIngestUpload | null;
    if (completedStaged) {
      completedStaged.sealDigest();
      metadata = completedStaged;
    }
    return {
      fields,
      file: metadata,
      async stageRuntimeInput(authority, signal) {
        if (runtimeInput) {
          if (!runtimeAuthority || !sameAuthority(runtimeAuthority, authority)) {
            throw new Error("The staged ingestion upload belongs to another scope.");
          }
          return runtimeInput;
        }
        if (!staged) throw new Error("The ingestion upload does not contain a file.");
        runtimeAuthority = authority;
        reservation = await reserveRuntimeJobInput(authority, {
          gardenId: authority.gardenId,
          conversationId: authority.conversationId,
          displayName: staged.name,
          mediaType: staged.type || null,
          declaredSizeBytes: staged.size,
        });
        try {
          const input = fs.createReadStream(staged.path);
          runtimeInput = await uploadRuntimeJobInput(
            authority,
            reservation,
            Readable.toWeb(input) as ReadableStream<Uint8Array>,
            signal,
          );
          await removeStaging();
          return runtimeInput;
        } catch (error) {
          await abandonReservation();
          throw error;
        }
      },
      markRuntimeInputSubmitted() {
        if (!runtimeInput) {
          throw new Error("The ingestion input cannot be adopted before it is sealed.");
        }
        submitted = true;
      },
      async cleanup() {
        await abandonReservation();
        await removeStaging();
      },
    };
  } catch (error) {
    source.unpipe(parser);
    source.destroy();
    await Promise.allSettled(writes);
    await abandonReservation();
    await removeStaging();
    throw error;
  }
}
