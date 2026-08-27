// Fetching a paper's PDF, safely.
//
// This is the one place in Get Doc that pulls bytes from an arbitrary host, so
// it is also the only place that has to assume the address is hostile. Three
// rules hold:
//
//   1. The browser never supplies a URL. It names a document from a run, and the
//      server looks the address up in that run's own results. A download request
//      therefore cannot reach an address no catalog ever returned.
//   2. Every hop — the first request and each redirect — is re-checked: https
//      only, and the hostname must resolve to a public address. Otherwise a
//      redirect to 127.0.0.1 or 169.254.169.254 would turn this into a way to
//      read the machine Breadboard runs on.
//   3. What comes back must actually be a PDF, and must fit. A publisher that
//      answers a login page instead of the paper is a failed download, not a
//      1 KB artifact called "paper.pdf".

import dns from "node:dns/promises";
import fsp from "node:fs/promises";
import net from "node:net";

export const MAX_PDF_BYTES = 64 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 90_000;
const USER_AGENT = "Breadboard-GetDoc/1.0 (+https://github.com/breadboard)";

export class DocumentDownloadError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DocumentDownloadError";
    this.code = code;
  }
}

/** True for addresses that belong to the public internet and nowhere else. */
export function isPublicAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return false;
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false; // IETF protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a >= 224) return false; // multicast and reserved
    return true;
  }
  if (version === 6) {
    const normalized = address.toLowerCase().split("%")[0];
    if (normalized === "::" || normalized === "::1") return false;
    // IPv4 written as IPv6 is still IPv4 as far as reachability goes.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
    if (mapped) return isPublicAddress(mapped[1]);
    if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return false; // unique local
    if (/^fe[89ab][0-9a-f]:/.test(normalized)) return false; // link-local
    if (normalized.startsWith("ff")) return false; // multicast
    return true;
  }
  return false;
}

/** Resolve a hostname and refuse it unless every address it answers is public. */
export async function assertPublicHost(hostname: string): Promise<void> {
  const literal = net.isIP(hostname);
  if (literal) {
    if (!isPublicAddress(hostname)) {
      throw new DocumentDownloadError("private_address", "That address is not on the public internet.");
    }
    return;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new DocumentDownloadError("host_unresolved", `${hostname} could not be resolved.`);
  }
  if (!addresses.length || !addresses.every((entry) => isPublicAddress(entry.address))) {
    // Checking every answer, not just the first, is what stops a host that
    // returns one public and one private address from slipping through.
    throw new DocumentDownloadError(
      "private_address",
      `${hostname} resolves to an address that is not on the public internet.`,
    );
  }
}

async function assertReachable(url: URL): Promise<void> {
  if (url.protocol !== "https:") {
    throw new DocumentDownloadError("insecure_url", "Only https downloads are allowed.");
  }
  await assertPublicHost(url.hostname);
}

export interface DownloadedPdf {
  buffer: Buffer;
  /** The address the bytes actually came from, after redirects. */
  finalUrl: string;
  byteSize: number;
}

/**
 * Download one PDF. Redirects are followed by hand so each hop is checked; the
 * body is read in chunks so an endless response is cut off rather than filling
 * memory.
 */
export async function downloadPdf(rawUrl: string): Promise<DownloadedPdf> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new DocumentDownloadError("invalid_url", "That download address is not a valid URL.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await assertReachable(current);
      const response = await fetch(current, {
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.5",
          "user-agent": USER_AGENT,
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new DocumentDownloadError("redirect_without_target", "The host redirected nowhere.");
        }
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) {
        throw new DocumentDownloadError(
          "download_failed",
          response.status === 403
            ? "The publisher refused the download — this copy is not free to fetch."
            : `The host answered ${response.status}.`,
        );
      }

      const declared = Number(response.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > MAX_PDF_BYTES) {
        throw new DocumentDownloadError("too_large", "That PDF is larger than 64 MiB.");
      }

      const buffer = await readBounded(response);
      // The content type is advisory — repositories serve PDFs as
      // application/octet-stream all the time — but the file header is not.
      if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
        const contentType = response.headers.get("content-type") ?? "";
        throw new DocumentDownloadError(
          "not_a_pdf",
          /html/i.test(contentType)
            ? "That link returned a web page, not a PDF — the full text is probably behind a login."
            : "That link did not return a PDF.",
        );
      }
      return { buffer, finalUrl: current.toString(), byteSize: buffer.byteLength };
    }
    throw new DocumentDownloadError("too_many_redirects", "The download redirected too many times.");
  } catch (error) {
    if (error instanceof DocumentDownloadError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new DocumentDownloadError("timeout", "The download timed out.");
    }
    throw new DocumentDownloadError(
      "download_unreachable",
      error instanceof Error ? error.message.slice(0, 200) : "The download could not be completed.",
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface DownloadedPdfFile {
  filePath: string;
  finalUrl: string;
  byteSize: number;
}

/**
 * Runtime-worker variant. The response is streamed into a fresh private file;
 * a 64 MiB paper therefore costs a fixed-size network buffer, not 64 MiB of
 * dashboard or worker heap.
 */
export async function downloadPdfToFile(
  rawUrl: string,
  outputPath: string,
  signal?: AbortSignal,
): Promise<DownloadedPdfFile> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new DocumentDownloadError("invalid_url", "That download address is not a valid URL.");
  }

  const controller = new AbortController();
  const relay = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener("abort", relay, { once: true });
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  const partial = `${outputPath}.partial`;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await assertReachable(current);
      const response = await fetch(current, {
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.5",
          "user-agent": USER_AGENT,
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new DocumentDownloadError("redirect_without_target", "The host redirected nowhere.");
        }
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) {
        throw new DocumentDownloadError(
          "download_failed",
          response.status === 403
            ? "The publisher refused the download — this copy is not free to fetch."
            : `The host answered ${response.status}.`,
        );
      }
      const declared = Number(response.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > MAX_PDF_BYTES) {
        throw new DocumentDownloadError("too_large", "That PDF is larger than 64 MiB.");
      }
      if (!response.body) {
        throw new DocumentDownloadError("download_failed", "The host returned no file body.");
      }

      const file = await fsp.open(partial, "wx");
      let total = 0;
      try {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          total += value.byteLength;
          if (total > MAX_PDF_BYTES) {
            await reader.cancel().catch(() => undefined);
            throw new DocumentDownloadError("too_large", "That PDF is larger than 64 MiB.");
          }
          await file.write(value);
        }
        const signature = Buffer.alloc(5);
        const read = await file.read(signature, 0, signature.length, 0);
        if (read.bytesRead !== 5 || signature.toString("ascii") !== "%PDF-") {
          const contentType = response.headers.get("content-type") ?? "";
          throw new DocumentDownloadError(
            "not_a_pdf",
            /html/i.test(contentType)
              ? "That link returned a web page, not a PDF — the full text is probably behind a login."
              : "That link did not return a PDF.",
          );
        }
      } finally {
        await file.close();
      }
      await fsp.rename(partial, outputPath);
      return { filePath: outputPath, finalUrl: current.toString(), byteSize: total };
    }
    throw new DocumentDownloadError("too_many_redirects", "The download redirected too many times.");
  } catch (error) {
    await fsp.rm(partial, { force: true }).catch(() => undefined);
    if (error instanceof DocumentDownloadError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new DocumentDownloadError("timeout", "The download timed out.");
    }
    throw new DocumentDownloadError(
      "download_unreachable",
      error instanceof Error ? error.message.slice(0, 200) : "The download could not be completed.",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relay);
  }
}

async function readBounded(response: Response): Promise<Buffer> {
  const body = response.body;
  if (!body) return Buffer.from(await response.arrayBuffer());
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_PDF_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new DocumentDownloadError("too_large", "That PDF is larger than 64 MiB.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

/** A filesystem-safe name for a paper, so downloads are recognizable on disk. */
export function pdfFilename(input: {
  title: string;
  year: number | null;
  firstAuthor: string | null;
}): string {
  const surname = input.firstAuthor?.trim().split(/\s+/).at(-1) ?? "";
  const stem = [surname, input.year ? String(input.year) : "", input.title]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${stem || "document"}.pdf`;
}
