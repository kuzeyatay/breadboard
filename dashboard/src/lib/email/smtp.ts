// A small SMTP client: enough to send a reply, and nothing else.
//
// Same reasoning as the IMAP side. Sending one plain-text message to one
// recipient is EHLO, maybe STARTTLS, AUTH, MAIL FROM, RCPT TO, DATA — six
// commands against a line-oriented protocol with numeric status codes.
//
// Not implemented: attachments, multiple recipients, HTML alternatives,
// connection pooling, DSN. A reply from an assistant is prose to one person.

import net from "node:net";
import tls from "node:tls";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  /** True for implicit TLS (465). False starts plain and issues STARTTLS. */
  secure: boolean;
  allowSelfSigned?: boolean;
  /** Skip STARTTLS on a non-secure connection. See the IMAP config for why. */
  allowPlaintext?: boolean;
  timeoutMs?: number;
}

export interface OutgoingMail {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  text: string;
  /** Set on a reply so mail clients thread it under the original. */
  inReplyTo?: string;
  references?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

class SmtpError extends Error {}

class SmtpConnection {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer = "";
  private pending: {
    resolve: (response: { code: number; lines: string[] }) => void;
    reject: (error: Error) => void;
    lines: string[];
  } | null = null;

  private readonly config: SmtpConfig;

  constructor(config: SmtpConfig) {
    this.config = config;
  }

  private get timeout(): number {
    return this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async connect(): Promise<void> {
    await this.open();
    await this.expect(220);
    await this.command(`EHLO ${hostLabel()}`, 250);

    if (!this.config.secure && !this.config.allowPlaintext) {
      await this.command("STARTTLS", 220);
      await this.upgrade();
      // EHLO again: the capability list before and after TLS are different
      // documents, and AUTH usually only appears in the second.
      await this.command(`EHLO ${hostLabel()}`, 250);
    }
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
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
      socket.once("timeout", () => onError(new SmtpError("The mail server did not respond.")));
      socket.once(this.config.secure ? "secureConnect" : "connect", () => {
        socket.removeListener("error", onError);
        this.attach(socket);
        resolve();
      });
    });
  }

  private attach(socket: net.Socket | tls.TLSSocket): void {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.onData(chunk));
    socket.on("error", (error: Error) => {
      const pending = this.pending;
      this.pending = null;
      pending?.reject(error);
    });
  }

  private async upgrade(): Promise<void> {
    const plain = this.socket as net.Socket;
    plain.removeAllListeners("data");
    const secured = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const upgraded = tls.connect(
        {
          socket: plain,
          servername: this.config.host,
          rejectUnauthorized: !this.config.allowSelfSigned,
        },
        () => resolve(upgraded),
      );
      upgraded.once("error", reject);
    });
    this.attach(secured);
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
    const pending = this.pending;
    if (!pending) return;
    pending.lines.push(line);
    // A dash after the code means more lines follow; a space ends the reply.
    if (/^\d{3} /.test(line)) {
      this.pending = null;
      pending.resolve({ code: Number.parseInt(line.slice(0, 3), 10), lines: pending.lines });
    }
  }

  private read(): Promise<{ code: number; lines: string[] }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new SmtpError("The mail server stopped replying."));
      }, this.timeout);
      this.pending = {
        lines: [],
        resolve: (response) => {
          clearTimeout(timer);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
    });
  }

  async expect(code: number): Promise<{ code: number; lines: string[] }> {
    const response = await this.read();
    if (response.code !== code) {
      throw new SmtpError(response.lines.join(" ") || `Expected ${code}, got ${response.code}.`);
    }
    return response;
  }

  async command(text: string, expected: number): Promise<{ code: number; lines: string[] }> {
    if (!this.socket) throw new SmtpError("Not connected.");
    const reader = this.read();
    this.socket.write(`${text}\r\n`);
    const response = await reader;
    if (response.code !== expected) {
      throw new SmtpError(
        response.lines.join(" ") || `${text.split(" ")[0]} failed with ${response.code}.`,
      );
    }
    return response;
  }

  write(text: string): void {
    this.socket?.write(text);
  }

  close(): void {
    try {
      this.socket?.end();
      this.socket?.destroy();
    } catch {
      // Already gone.
    }
    this.socket = null;
  }
}

function hostLabel(): string {
  return "breadboard.local";
}

/**
 * Encode a header value that may not be ASCII.
 *
 * A subject line with an em dash in it is not exotic, and an un-encoded one
 * arrives as mojibake or gets the message rejected.
 */
export function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Dot-stuff and normalise line endings, as DATA requires. */
export function encodeBody(text: string): string {
  return text
    .replace(/\r?\n/g, "\r\n")
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

export function buildMessage(mail: OutgoingMail): string {
  const from = mail.fromName
    ? `${encodeHeader(mail.fromName)} <${mail.from}>`
    : mail.from;
  const headers = [
    `From: ${from}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@${hostLabel()}>`,
    mail.inReplyTo ? `In-Reply-To: <${mail.inReplyTo.replace(/[<>]/g, "")}>` : null,
    mail.references ? `References: <${mail.references.replace(/[<>]/g, "")}>` : null,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    // Standard signal to well-behaved autoresponders not to reply to a robot.
    "Auto-Submitted: auto-replied",
  ].filter((line): line is string => line !== null);

  return `${headers.join("\r\n")}\r\n\r\n${encodeBody(mail.text)}\r\n.\r\n`;
}

async function authenticate(connection: SmtpConnection, config: SmtpConfig): Promise<void> {
  // AUTH LOGIN is the widest-supported of the plaintext mechanisms and is only
  // ever used over a channel that is already TLS by this point.
  await connection.command("AUTH LOGIN", 334);
  await connection.command(Buffer.from(config.user, "utf8").toString("base64"), 334);
  await connection.command(Buffer.from(config.password, "utf8").toString("base64"), 235);
}

/** Check credentials without sending anything. */
export async function verifySmtp(
  config: SmtpConfig,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const connection = new SmtpConnection(config);
  try {
    await connection.connect();
    await authenticate(connection, config);
    await connection.command("QUIT", 221);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    connection.close();
  }
}

export async function sendMail(config: SmtpConfig, mail: OutgoingMail): Promise<void> {
  const connection = new SmtpConnection(config);
  try {
    await connection.connect();
    await authenticate(connection, config);
    await connection.command(`MAIL FROM:<${mail.from}>`, 250);
    await connection.command(`RCPT TO:<${mail.to}>`, 250);
    await connection.command("DATA", 354);
    connection.write(buildMessage(mail));
    await connection.expect(250);
    await connection.command("QUIT", 221);
  } finally {
    connection.close();
  }
}
