// The mail account on disk.
//
// Host, port and username are ordinary settings; the password is not. All four
// live in one 0600 file rather than splitting the password out, because a
// half-configured account is a worse failure mode than a slightly larger
// secret file — and the whole record is only ever read by this process.
//
// Nothing here reaches the browser. `describeAccount` is what the settings
// page sees: enough to recognise the account, never enough to use it.

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { emailCredentialsFile } from "./config.ts";

export interface EmailAccount {
  address: string;
  displayName: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  user: string;
  password: string;
  allowSelfSigned: boolean;
}

export interface EmailAccountSummary {
  address: string;
  displayName: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  user: string;
  configured: true;
}

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeAddress(value: unknown): boolean {
  return ADDRESS.test(String(value ?? "").trim());
}

function port(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 65_536 ? parsed : fallback;
}

export function readAccount(): EmailAccount | null {
  const file = emailCredentialsFile();
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<EmailAccount>;
    if (!looksLikeAddress(raw.address) || !raw.password || !raw.imapHost || !raw.smtpHost) {
      return null;
    }
    return {
      address: String(raw.address).trim().toLowerCase(),
      displayName: String(raw.displayName ?? "").trim(),
      imapHost: String(raw.imapHost).trim(),
      imapPort: port(raw.imapPort, 993),
      imapSecure: raw.imapSecure !== false,
      smtpHost: String(raw.smtpHost).trim(),
      smtpPort: port(raw.smtpPort, 465),
      smtpSecure: raw.smtpSecure !== false,
      user: String(raw.user ?? raw.address).trim(),
      password: String(raw.password),
      allowSelfSigned: raw.allowSelfSigned === true,
    };
  } catch {
    return null;
  }
}

export function hasAccount(): boolean {
  return readAccount() !== null;
}

/** What the settings page is allowed to know. */
export function describeAccount(): EmailAccountSummary | null {
  const account = readAccount();
  if (!account) return null;
  return {
    address: account.address,
    displayName: account.displayName,
    imapHost: account.imapHost,
    imapPort: account.imapPort,
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    user: account.user,
    configured: true,
  };
}

export function writeAccount(input: Omit<EmailAccount, "displayName"> & { displayName?: string }): void {
  if (!looksLikeAddress(input.address)) {
    throw new Error("That does not look like an email address.");
  }
  if (!input.password) throw new Error("A password or app password is required.");
  if (!input.imapHost.trim() || !input.smtpHost.trim()) {
    throw new Error("Both an IMAP and an SMTP server are required.");
  }

  const file = emailCredentialsFile();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        address: input.address.trim().toLowerCase(),
        displayName: (input.displayName ?? "").trim(),
        imapHost: input.imapHost.trim(),
        imapPort: port(input.imapPort, 993),
        imapSecure: input.imapSecure !== false,
        smtpHost: input.smtpHost.trim(),
        smtpPort: port(input.smtpPort, 465),
        smtpSecure: input.smtpSecure !== false,
        user: (input.user || input.address).trim(),
        password: input.password,
        allowSelfSigned: input.allowSelfSigned === true,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows has no POSIX mode; the file already sits in a per-user directory.
  }
}

export function clearAccount(): void {
  rmSync(emailCredentialsFile(), { force: true });
}
