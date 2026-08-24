// A small IMAP client: enough to read new mail, and nothing else.
//
// Breadboard vendors rather than depends, and the part of IMAP this channel
// needs is genuinely small — log in, select the inbox, ask which messages are
// unread, fetch them, mark them read. That is five commands against a
// line-oriented protocol, which is less code than the shim around a general
// library would be, and it means the mail path has no dependency that can go
// unmaintained underneath it.
//
// What is deliberately not implemented: IDLE (the channel polls, which is
// simpler and survives flaky connections), server-side search beyond UNSEEN,
// partial fetches, and anything to do with folders other than INBOX. If any of
// those are needed later they belong here, not scattered through the caller.

import net from "node:net";
import tls from "node:tls";

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  /** True for implicit TLS (993). False starts plain and issues STARTTLS. */
  secure: boolean;
  /** Accept a self-signed certificate. Off unless the operator says so. */
  allowSelfSigned?: boolean;
  /**
   * Skip STARTTLS on a non-secure connection.
   *
   * Off by default and deliberately not reachable from the settings page: a
   * plaintext IMAP session hands the mailbox password to anything on the
   * path. It exists because a local test server and an operator's own
   * loopback relay are real cases, and a client that cannot express them at
   * all is a client people work around.
   */
  allowPlaintext?: boolean;
  timeoutMs?: number;
}

export interface ImapMessage {
  uid: number;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  messageId: string;
  date: string;
  /** The plain-text body, decoded and stripped of quoted history. */
  text: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
/** More than this in one poll is a backlog, not a conversation. */
const MAX_MESSAGES_PER_POLL = 10;
/** Nothing useful in a mail body lies past this, and it bounds memory. */
const MAX_BODY_BYTES = 256 * 1024;

class ImapError extends Error {}

/**
 * One connection, used for one exchange and closed.
 *
 * A long-lived connection would need reconnection, keepalive and re-selection
 * logic to survive a laptop sleeping, which is most of what makes IMAP clients
 * large. Polling with a fresh connection costs a TLS handshake every cycle and
 * removes all of it.
 */
class ImapConnection {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer = "";
  private tag = 0;
  private pending: {
    tag: string;
    resolve: (lines: string[]) => void;
    reject: (error: Error) => void;
    lines: string[];
  } | null = null;

  private readonly config: ImapConfig;

  constructor(config: ImapConfig) {
    this.config = config;
  }

  private get timeout(): number {
    return this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      const socket = this.config.secure
        ? tls.connect({
            host: this.config.host,
            port: this.config.port,
            rejectUnauthorized: !this.config.allowSelfSigned,
          })
        : net.connect({ host: this.config.host, port: this.config.port });

      socket.setTimeout(this.timeout);
      socket.once("error", onError);
      socket.once("timeout", () => onError(new ImapError("The mail server did not respond.")));
      socket.once(this.config.secure ? "secureConnect" : "connect", () => {
        socket.removeListener("error", onError);
        this.socket = socket;
        socket.setEncoding("utf8");
        socket.on("data", (chunk: string) => this.onData(chunk));
        socket.on("error", (error: Error) => this.failPending(error));
        socket.on("close", () =>
          this.failPending(new ImapError("The mail server closed the connection.")),
        );
        resolve();
      });
    });

    // The greeting arrives unsolicited before any command.
    await this.readGreeting();

    if (!this.config.secure && !this.config.allowPlaintext) {
      await this.command("STARTTLS");
      await this.upgrade();
    }
  }

  private async upgrade(): Promise<void> {
    const plain = this.socket as net.Socket;
    plain.removeAllListeners("data");
    this.socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const secured = tls.connect(
        {
          socket: plain,
          servername: this.config.host,
          rejectUnauthorized: !this.config.allowSelfSigned,
        },
        () => resolve(secured),
      );
      secured.once("error", reject);
    });
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk: string) => this.onData(chunk));
    this.socket.on("error", (error: Error) => this.failPending(error));
  }

  private greetingResolve: (() => void) | null = null;

  private readGreeting(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new ImapError("The mail server sent no greeting.")),
        this.timeout,
      );
      this.greetingResolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\r\n");
    while (index !== -1) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      this.onLine(line);
      index = this.buffer.indexOf("\r\n");
    }
  }

  private onLine(line: string): void {
    if (this.greetingResolve && line.startsWith("* ")) {
      const done = this.greetingResolve;
      this.greetingResolve = null;
      done();
      return;
    }
    const pending = this.pending;
    if (!pending) return;

    if (line.startsWith(`${pending.tag} `)) {
      const rest = line.slice(pending.tag.length + 1);
      this.pending = null;
      if (rest.startsWith("OK")) pending.resolve(pending.lines);
      else pending.reject(new ImapError(rest.replace(/^(NO|BAD)\s*/, "") || "IMAP command failed."));
      return;
    }
    pending.lines.push(line);
  }

  private failPending(error: Error): void {
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
  }

  command(text: string): Promise<string[]> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new ImapError("Not connected."));
    this.tag += 1;
    const tag = `A${String(this.tag).padStart(4, "0")}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new ImapError(`The mail server did not answer ${text.split(" ")[0]}.`));
      }, this.timeout);
      this.pending = {
        tag,
        lines: [],
        resolve: (lines) => {
          clearTimeout(timer);
          resolve(lines);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      socket.write(`${tag} ${text}\r\n`);
    });
  }

  close(): void {
    try {
      this.socket?.end();
      this.socket?.destroy();
    } catch {
      // Closing a socket that is already gone is not a failure.
    }
    this.socket = null;
  }
}

function quote(value: string): string {
  return `"${value.replace(/([\\"])/g, "\\$1")}"`;
}

/** Decode the encodings a header can arrive in, and give up gracefully. */
export function decodeHeader(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_match, charset: string, encoding: string, payload: string) => {
      try {
        const bytes =
          encoding.toUpperCase() === "B"
            ? Buffer.from(payload, "base64")
            : Buffer.from(payload.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (__, hex) =>
                String.fromCharCode(parseInt(hex, 16)),
              ), "binary");
        const label = charset.toLowerCase();
        return bytes.toString(
          label === "utf-8" || label === "utf8" ? "utf8" : "latin1",
        );
      } catch {
        return payload;
      }
    },
  );
}

function decodeBody(body: string, encoding: string, charset: string): string {
  const normalized = encoding.trim().toLowerCase();
  try {
    if (normalized === "base64") {
      return Buffer.from(body.replace(/\s+/g, ""), "base64").toString(
        charset.includes("utf") ? "utf8" : "latin1",
      );
    }
    if (normalized === "quoted-printable") {
      return body
        .replace(/=\r?\n/g, "")
        .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
    }
  } catch {
    return body;
  }
  return body;
}

/**
 * Strip the quoted history off a reply.
 *
 * A three-word answer under forty lines of quoted thread is three words of
 * intent and forty lines of noise, and the noise is what the model would
 * spend its attention on.
 */
export function stripQuotedText(body: string): string {
  const lines = body.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*(>|On .+ wrote:|-{2,}\s*Original Message|_{5,})/.test(line)) break;
    if (/^\s*(From|Sent|To|Subject):\s/.test(line) && kept.length > 2) break;
    kept.push(line);
  }
  return kept.join("\n").trim() || body.trim();
}

/** Pull the first text/plain part out of a MIME message. */
export function extractPlainText(raw: string): string {
  const separator = raw.indexOf("\r\n\r\n");
  const head = separator === -1 ? raw : raw.slice(0, separator);
  const body = separator === -1 ? "" : raw.slice(separator + 4);

  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(head)?.[1];
  if (!boundary) {
    const encoding = /content-transfer-encoding:\s*(\S+)/i.exec(head)?.[1] ?? "7bit";
    const charset = /charset="?([^";\r\n]+)"?/i.exec(head)?.[1] ?? "utf-8";
    const decoded = decodeBody(body, encoding, charset);
    return /content-type:\s*text\/html/i.test(head) ? htmlToText(decoded) : decoded;
  }

  const parts = body.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  let htmlFallback = "";
  for (const part of parts) {
    const partSeparator = part.indexOf("\r\n\r\n");
    if (partSeparator === -1) continue;
    const partHead = part.slice(0, partSeparator);
    const partBody = part.slice(partSeparator + 4);
    const encoding = /content-transfer-encoding:\s*(\S+)/i.exec(partHead)?.[1] ?? "7bit";
    const charset = /charset="?([^";\r\n]+)"?/i.exec(partHead)?.[1] ?? "utf-8";
    if (/content-type:\s*text\/plain/i.test(partHead)) {
      return decodeBody(partBody, encoding, charset);
    }
    if (/content-type:\s*text\/html/i.test(partHead) && !htmlFallback) {
      htmlFallback = htmlToText(decodeBody(partBody, encoding, charset));
    }
  }
  return htmlFallback;
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseAddress(value: string): { address: string; name: string } {
  const decoded = decodeHeader(value.trim());
  const angled = /<([^>]+)>/.exec(decoded);
  if (angled) {
    return {
      address: angled[1].trim().toLowerCase(),
      name: decoded.slice(0, angled.index).trim().replace(/^"|"$/g, ""),
    };
  }
  return { address: decoded.trim().toLowerCase(), name: "" };
}

/** Fold continuation lines and read the headers of a raw message. */
export function parseHeaders(raw: string): Map<string, string> {
  const separator = raw.indexOf("\r\n\r\n");
  const head = separator === -1 ? raw : raw.slice(0, separator);
  const headers = new Map<string, string>();
  let current = "";
  for (const line of head.split(/\r?\n/)) {
    if (/^\s/.test(line) && current) {
      headers.set(current, `${headers.get(current) ?? ""} ${line.trim()}`);
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    current = line.slice(0, colon).trim().toLowerCase();
    headers.set(current, line.slice(colon + 1).trim());
  }
  return headers;
}

/**
 * Verify credentials without changing anything on the server.
 *
 * Used by the settings flow, so a wrong password is reported when it is typed
 * rather than silently twenty minutes later.
 */
export async function verifyImap(config: ImapConfig): Promise<{ ok: true } | { ok: false; error: string }> {
  const connection = new ImapConnection(config);
  try {
    await connection.connect();
    await connection.command(`LOGIN ${quote(config.user)} ${quote(config.password)}`);
    await connection.command("LOGOUT");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    connection.close();
  }
}

/**
 * Fetch unread mail and mark it read.
 *
 * Marking read is what stops the same message being answered twice, and it is
 * done only after the message has been handed back to the caller — a crash
 * between the two costs a re-read, which the caller's own seen-message table
 * absorbs. The other order would lose mail.
 */
export async function fetchUnread(
  config: ImapConfig,
  options: { limit?: number; markSeen?: boolean } = {},
): Promise<ImapMessage[]> {
  const limit = Math.max(1, Math.min(MAX_MESSAGES_PER_POLL, options.limit ?? MAX_MESSAGES_PER_POLL));
  const connection = new ImapConnection(config);
  try {
    await connection.connect();
    await connection.command(`LOGIN ${quote(config.user)} ${quote(config.password)}`);
    await connection.command("SELECT INBOX");

    const searchLines = await connection.command("UID SEARCH UNSEEN");
    const uids = searchLines
      .filter((line) => line.toUpperCase().startsWith("* SEARCH"))
      .flatMap((line) => line.slice(8).trim().split(/\s+/))
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value) && value > 0)
      .slice(-limit);

    const messages: ImapMessage[] = [];
    for (const uid of uids) {
      // PEEK so a fetch that fails halfway does not silently consume the mail.
      const lines = await connection.command(`UID FETCH ${uid} (BODY.PEEK[])`);
      const raw = lines.join("\r\n").slice(0, MAX_BODY_BYTES);
      const headers = parseHeaders(raw);
      const from = parseAddress(headers.get("from") ?? "");
      if (!from.address) continue;

      messages.push({
        uid,
        from: from.address,
        fromName: from.name,
        to: parseAddress(headers.get("to") ?? "").address,
        subject: decodeHeader(headers.get("subject") ?? "").slice(0, 300),
        messageId: (headers.get("message-id") ?? `uid-${uid}`).replace(/[<>]/g, "").trim(),
        date: headers.get("date") ?? new Date().toISOString(),
        text: stripQuotedText(extractPlainText(raw)),
      });

      if (options.markSeen !== false) {
        await connection.command(`UID STORE ${uid} +FLAGS (\\Seen)`);
      }
    }

    await connection.command("LOGOUT");
    return messages;
  } finally {
    connection.close();
  }
}
