import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Size-bounded per-service log files with a single rotation generation
 * (`<id>.log` -> `<id>.log.1`). A redaction hook keeps secrets out of logs.
 */
export interface LogWriter {
  write(line: string): void;
  readTail(maxLines: number): string[];
  filePath: string;
  close(): void;
}

export interface LogManagerOptions {
  logsDir: string;
  maxBytesPerFile?: number;
  redact?: (line: string) => string;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export class LogManager {
  private readonly logsDir: string;
  private readonly maxBytes: number;
  private readonly redact: (line: string) => string;
  private readonly writers = new Map<string, LogWriter>();

  constructor(options: LogManagerOptions) {
    this.logsDir = options.logsDir;
    this.maxBytes = options.maxBytesPerFile ?? DEFAULT_MAX_BYTES;
    this.redact = options.redact ?? ((line) => line);
    fs.mkdirSync(this.logsDir, { recursive: true });
  }

  get directory(): string {
    return this.logsDir;
  }

  forService(id: string): LogWriter {
    const existing = this.writers.get(id);
    if (existing) return existing;
    const filePath = path.join(this.logsDir, `${sanitizeId(id)}.log`);
    const writer = new FileLogWriter(filePath, this.maxBytes, this.redact);
    this.writers.set(id, writer);
    return writer;
  }

  closeAll(): void {
    for (const writer of this.writers.values()) writer.close();
    this.writers.clear();
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

class FileLogWriter implements LogWriter {
  readonly filePath: string;
  private readonly maxBytes: number;
  private readonly redact: (line: string) => string;
  private fd: number | null = null;
  private bytes = 0;

  constructor(filePath: string, maxBytes: number, redact: (line: string) => string) {
    this.filePath = filePath;
    this.maxBytes = maxBytes;
    this.redact = redact;
    this.open("a");
  }

  private open(flags: "a" | "w"): void {
    try {
      this.fd = fs.openSync(this.filePath, flags);
      this.bytes = flags === "a" ? fs.fstatSync(this.fd).size : 0;
    } catch {
      // Logging must never crash the supervisor.
      this.fd = null;
      this.bytes = 0;
    }
  }

  write(line: string): void {
    const clean = this.redact(line.replace(/\r?\n$/, ""));
    const payload = `${new Date().toISOString()} ${clean}\n`;
    if (this.bytes + Buffer.byteLength(payload) > this.maxBytes) this.rotate();
    if (this.fd === null) return;
    try {
      this.bytes += fs.writeSync(this.fd, payload);
    } catch {
      // Disk full or handle revoked; drop the line rather than crash.
    }
  }

  private rotate(): void {
    this.close();
    try {
      const rotated = `${this.filePath}.1`;
      fs.rmSync(rotated, { force: true });
      fs.renameSync(this.filePath, rotated);
    } catch {
      // If rotation fails (external lock), truncate instead so the file stays
      // bounded.
    }
    this.open("w");
  }

  readTail(maxLines: number): string[] {
    try {
      const contents = fs.readFileSync(this.filePath, "utf8");
      const lines = contents.split(/\r?\n/).filter((line) => line.length > 0);
      return lines.slice(-maxLines);
    } catch {
      return [];
    }
  }

  close(): void {
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd);
      } catch {
        // Already closed.
      }
      this.fd = null;
    }
  }
}
