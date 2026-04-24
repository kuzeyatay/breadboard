import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { PDFParse } from "pdf-parse";

const GITHUB_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "raw.githubusercontent.com",
  "gist.githubusercontent.com",
]);
const GITHUB_TOKEN_HOSTS = new Set([...GITHUB_HOSTS, "api.github.com"]);
const DEFAULT_MAX_LINKS = 6;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_DOCUMENT_CHARS = 14_000;
const DEFAULT_MAX_CONTEXT_CHARS = 42_000;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 4;

type JsonRecord = Record<string, unknown>;

interface LinkContextResult {
  context: string;
  sources: string[];
}

function numberEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function maxLinks(): number {
  return numberEnv(
    "LINK_FETCH_MAX_LINKS",
    numberEnv("GITHUB_LINK_MAX_LINKS", DEFAULT_MAX_LINKS),
  );
}

function maxBytes(): number {
  return numberEnv("LINK_FETCH_MAX_BYTES", DEFAULT_MAX_BYTES);
}

function maxDocumentChars(): number {
  return numberEnv(
    "LINK_FETCH_MAX_DOCUMENT_CHARS",
    numberEnv("GITHUB_LINK_MAX_FILE_CHARS", DEFAULT_MAX_DOCUMENT_CHARS),
  );
}

function maxContextChars(): number {
  return numberEnv(
    "LINK_FETCH_MAX_CONTEXT_CHARS",
    numberEnv("GITHUB_LINK_MAX_CONTEXT_CHARS", DEFAULT_MAX_CONTEXT_CHARS),
  );
}

function trimTrailingUrlPunctuation(value: string): string {
  return value.replace(/[),.;\]}>]+$/g, "");
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as JsonRecord;
      return typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function recentUserText(messages: unknown[]): string {
  const chunks: string[] = [];

  for (let index = messages.length - 1; index >= 0 && chunks.length < 4; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") continue;
    const record = message as JsonRecord;
    if (record.role !== "user") continue;
    const text = extractMessageText(record.content);
    if (text) chunks.unshift(text);
  }

  return chunks.join("\n\n");
}

function urlsFromText(text: string): URL[] {
  const rawUrls = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  const urls: URL[] = [];
  const seen = new Set<string>();

  for (const rawUrl of rawUrls) {
    try {
      const url = new URL(trimTrailingUrlPunctuation(rawUrl));
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      url.hash = "";
      const normalized = url.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      urls.push(url);
    } catch {
      // Ignore malformed links in the user's message.
    }
  }

  return urls.slice(0, maxLinks());
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: JsonRecord, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trimEnd()}\n\n[Link context truncated]`;
}

function compactText(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function headersForUrl(url: URL, accept: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": "breadboard-link-context",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token && GITHUB_TOKEN_HOSTS.has(url.hostname.toLowerCase())) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".lan") ||
    lower.endsWith(".internal")
  );
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    return isPrivateIpv4(lower.slice("::ffff:".length));
  }

  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("ff")
  );
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS links are supported");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error("Local or private hostnames are not allowed");
  }

  const directIpVersion = isIP(url.hostname);
  if (directIpVersion !== 0) {
    if (isPrivateAddress(url.hostname)) {
      throw new Error("Private or local IP addresses are not allowed");
    }
    return;
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error("Hostname did not resolve");

  for (const address of addresses) {
    if (isPrivateAddress(address.address)) {
      throw new Error("This link resolves to a private or local address");
    }
  }
}

async function fetchWithTimeout(url: URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url.toString(), {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPublicUrl(
  url: URL,
  accept: string,
  redirectCount = 0,
): Promise<Response> {
  await assertPublicUrl(url);

  const response = await fetchWithTimeout(url, {
    headers: headersForUrl(url, accept),
    redirect: "manual",
  });

  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.has("location")
  ) {
    if (redirectCount >= MAX_REDIRECTS) {
      throw new Error("Too many redirects");
    }
    const redirected = new URL(response.headers.get("location") ?? "", url);
    return fetchPublicUrl(redirected, accept, redirectCount + 1);
  }

  return response;
}

async function readLimitedBuffer(response: Response): Promise<Buffer> {
  const limit = maxBytes();
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw new Error(`Response is larger than ${limit} bytes`);
  }

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > limit) {
      throw new Error(`Response is larger than ${limit} bytes`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    const chunk = Buffer.from(value);
    total += chunk.byteLength;
    if (total > limit) {
      throw new Error(`Response is larger than ${limit} bytes`);
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[lower] ?? match;
  });
}

function htmlTitle(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  return compactText(decodeHtmlEntities(title.replace(/<[^>]+>/g, " ")));
}

function htmlToText(html: string): string {
  const withoutHidden = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  const withBreaks = withoutHidden
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|main|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ");

  return compactText(
    decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n[ \t]+/g, "\n"),
  );
}

function contentType(response: Response): string {
  return (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
}

function looksLikePdf(url: URL, type: string): boolean {
  return type === "application/pdf" || url.pathname.toLowerCase().endsWith(".pdf");
}

function isTextualContentType(type: string): boolean {
  return (
    type.startsWith("text/") ||
    [
      "application/json",
      "application/ld+json",
      "application/xml",
      "application/rss+xml",
      "application/atom+xml",
      "application/javascript",
      "application/x-javascript",
      "application/x-ndjson",
      "application/x-yaml",
      "application/yaml",
    ].includes(type) ||
    type.endsWith("+json") ||
    type.endsWith("+xml")
  );
}

async function parsePdfBuffer(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText({ pageJoiner: "\n\n" });
    return compactText(result.text);
  } finally {
    await parser.destroy();
  }
}

async function fetchReadableUrl(url: URL): Promise<{ title: string; content: string }> {
  const response = await fetchPublicUrl(
    url,
    "text/html,application/xhtml+xml,application/pdf,text/plain,application/json,application/xml,text/markdown,*/*;q=0.5",
  );
  if (!response.ok) {
    throw new Error(`Link returned ${response.status}`);
  }

  const type = contentType(response);
  const buffer = await readLimitedBuffer(response);

  if (looksLikePdf(url, type)) {
    return {
      title: url.toString(),
      content: truncate(await parsePdfBuffer(buffer), maxDocumentChars()),
    };
  }

  const text = buffer.toString("utf-8");
  if (type === "text/html" || type === "application/xhtml+xml" || /<\/?[a-z][\s\S]*>/i.test(text.slice(0, 1000))) {
    const title = htmlTitle(text) || url.toString();
    return {
      title,
      content: truncate(htmlToText(text), maxDocumentChars()),
    };
  }

  if (!type || isTextualContentType(type)) {
    return {
      title: url.toString(),
      content: truncate(compactText(text), maxDocumentChars()),
    };
  }

  throw new Error(`Unsupported content type: ${type || "unknown"}`);
}

function decodeGithubContent(content: string, encoding: string): string {
  if (encoding !== "base64") return content;
  return Buffer.from(content.replace(/\s+/g, ""), "base64").toString("utf-8");
}

async function fetchGithubApiJson(url: string): Promise<unknown> {
  const apiUrl = new URL(url);
  const response = await fetchPublicUrl(apiUrl, "application/vnd.github+json");
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}`);
  }
  return response.json();
}

async function fetchText(url: string, accept = "text/plain"): Promise<string> {
  const targetUrl = new URL(url);
  const response = await fetchPublicUrl(targetUrl, accept);
  if (!response.ok) {
    throw new Error(`Link returned ${response.status}`);
  }
  return truncate(
    compactText((await readLimitedBuffer(response)).toString("utf-8")),
    maxDocumentChars(),
  );
}

function rawUrlFromGithubBlob(url: URL, owner: string, repo: string): URL | null {
  const parts = url.pathname.split("/").filter(Boolean);
  const markerIndex = parts.findIndex((part) => part === "blob" || part === "raw");
  if (markerIndex < 0 || markerIndex + 2 >= parts.length) return null;

  const ref = parts[markerIndex + 1];
  const filePath = parts.slice(markerIndex + 2).join("/");
  return new URL(
    `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`,
  );
}

async function fetchReadme(owner: string, repo: string): Promise<string> {
  const json = await fetchGithubApiJson(
    `https://api.github.com/repos/${owner}/${repo}/readme`,
  );
  if (!isRecord(json)) throw new Error("README response was not an object");

  const downloadUrl = stringField(json, "download_url");
  if (downloadUrl) return fetchText(downloadUrl);

  const content = stringField(json, "content");
  const encoding = stringField(json, "encoding");
  if (!content) throw new Error("README did not include content");
  return truncate(decodeGithubContent(content, encoding), maxDocumentChars());
}

function commonFileRank(name: string): number {
  const lower = name.toLowerCase();
  const priorities = [
    "readme.md",
    "readme",
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "cargo.toml",
    "go.mod",
    "dockerfile",
    "compose.yml",
    "docker-compose.yml",
  ];
  const index = priorities.indexOf(lower);
  return index >= 0 ? index : priorities.length + lower.localeCompare("zzzz");
}

function summarizeDirectory(entries: unknown): string {
  if (!Array.isArray(entries)) return "No directory entries returned.";

  return entries
    .filter(isRecord)
    .slice(0, 80)
    .map((entry) => {
      const type = stringField(entry, "type") || "item";
      const path = stringField(entry, "path") || stringField(entry, "name");
      return `- ${type}: ${path}`;
    })
    .join("\n");
}

async function fetchContentsPath(
  owner: string,
  repo: string,
  ref: string,
  filePath: string,
): Promise<unknown> {
  const encodedPath = filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
  return fetchGithubApiJson(url);
}

async function fetchBlobByCandidates(
  owner: string,
  repo: string,
  tailParts: string[],
): Promise<{ ref: string; filePath: string; content: string }> {
  for (let refLength = 1; refLength < tailParts.length; refLength += 1) {
    const ref = tailParts.slice(0, refLength).join("/");
    const filePath = tailParts.slice(refLength).join("/");

    try {
      const json = await fetchContentsPath(owner, repo, ref, filePath);
      if (!isRecord(json)) continue;
      if (stringField(json, "type") !== "file") continue;

      const downloadUrl = stringField(json, "download_url");
      const content = downloadUrl
        ? await fetchText(downloadUrl)
        : decodeGithubContent(
            stringField(json, "content"),
            stringField(json, "encoding"),
          );

      return { ref, filePath, content: truncate(content, maxDocumentChars()) };
    } catch {
      // Try the next possible ref/path split.
    }
  }

  throw new Error("Could not resolve GitHub file path");
}

async function fetchTreeByCandidates(
  owner: string,
  repo: string,
  tailParts: string[],
): Promise<{ ref: string; filePath: string; content: string }> {
  for (let refLength = 1; refLength <= tailParts.length; refLength += 1) {
    const ref = tailParts.slice(0, refLength).join("/");
    const filePath = tailParts.slice(refLength).join("/");

    try {
      const json = filePath
        ? await fetchContentsPath(owner, repo, ref, filePath)
        : await fetchGithubApiJson(
            `https://api.github.com/repos/${owner}/${repo}/contents?ref=${encodeURIComponent(ref)}`,
          );
      if (!Array.isArray(json)) continue;

      const entries = json.filter(isRecord);
      const listing = summarizeDirectory(entries);
      const selectedFiles = entries
        .filter((entry) => stringField(entry, "type") === "file")
        .sort((left, right) =>
          commonFileRank(stringField(left, "name")) -
          commonFileRank(stringField(right, "name")),
        )
        .slice(0, 3);
      const snippets: string[] = [];

      for (const file of selectedFiles) {
        const downloadUrl = stringField(file, "download_url");
        const name = stringField(file, "path") || stringField(file, "name");
        if (!downloadUrl || !name) continue;
        try {
          snippets.push(
            `## ${name}\n\n${truncate(await fetchText(downloadUrl), 5_000)}`,
          );
        } catch {
          // Directory listing is still useful if a sample file cannot be read.
        }
      }

      return {
        ref,
        filePath,
        content: truncate(
          [`Directory listing:\n${listing}`, ...snippets].join("\n\n"),
          maxDocumentChars(),
        ),
      };
    } catch {
      // Try the next possible ref/path split.
    }
  }

  throw new Error("Could not resolve GitHub directory path");
}

async function fetchGithubUrlContext(url: URL): Promise<{ title: string; content: string }> {
  const host = url.hostname.toLowerCase();
  if (host === "raw.githubusercontent.com" || host === "gist.githubusercontent.com") {
    return fetchReadableUrl(url);
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const [owner, repo] = parts;
  if (!owner || !repo) throw new Error("GitHub URL is missing owner or repo");

  const markerIndex = parts.findIndex((part) =>
    ["blob", "raw", "tree"].includes(part),
  );
  const marker = markerIndex >= 0 ? parts[markerIndex] : "";
  const tailParts = markerIndex >= 0 ? parts.slice(markerIndex + 1) : [];

  if (marker === "blob" || marker === "raw") {
    const rawUrl = rawUrlFromGithubBlob(url, owner, repo);
    if (rawUrl) {
      try {
        return {
          title: `${owner}/${repo}/${tailParts.join("/")}`,
          content: (await fetchReadableUrl(rawUrl)).content,
        };
      } catch {
        // Fall through to API resolution, which handles branch names with slashes.
      }
    }

    const result = await fetchBlobByCandidates(owner, repo, tailParts);
    return {
      title: `${owner}/${repo}@${result.ref}/${result.filePath}`,
      content: result.content,
    };
  }

  if (marker === "tree") {
    const result = await fetchTreeByCandidates(owner, repo, tailParts);
    return {
      title: `${owner}/${repo}@${result.ref}/${result.filePath || "."}`,
      content: result.content,
    };
  }

  return {
    title: `${owner}/${repo} README`,
    content: await fetchReadme(owner, repo),
  };
}

async function fetchUrlContext(url: URL): Promise<{ title: string; content: string }> {
  if (GITHUB_HOSTS.has(url.hostname.toLowerCase())) {
    return fetchGithubUrlContext(url);
  }
  return fetchReadableUrl(url);
}

export async function buildUrlLinkContext(
  messages: unknown[],
): Promise<LinkContextResult> {
  const urls = urlsFromText(recentUserText(messages));
  if (urls.length === 0) return { context: "", sources: [] };

  const sections: string[] = [];
  const sources: string[] = [];

  for (const url of urls) {
    try {
      const fetched = await fetchUrlContext(url);
      sources.push(url.toString());
      sections.push(
        `Source URL: ${url.toString()}\nResolved as: ${fetched.title}\n\n${fetched.content}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sections.push(
        `Source URL: ${url.toString()}\nCould not fetch this link: ${message}.`,
      );
    }
  }

  return {
    context: truncate(sections.join("\n\n---\n\n"), maxContextChars()),
    sources,
  };
}
