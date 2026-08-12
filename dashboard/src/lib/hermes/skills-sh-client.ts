export const SKILLS_CATALOG_PROXY_ENV = "BREADBOARD_SKILLS_CATALOG_URL";
export const SKILLS_SH_MAX_PAGE_SIZE = 500;

export type SkillsShView = "all-time" | "trending" | "hot";

export interface SkillsShSkill {
  id: string;
  slug: string;
  name: string;
  source: string;
  installs: number;
  sourceType: string | null;
  installUrl: string | null;
  url: string | null;
  duplicate: boolean;
}

export interface SkillsShPage {
  data: SkillsShSkill[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    hasMore: boolean;
  };
  cacheMaxAgeSeconds: number | null;
  rateLimit: SkillsShRateLimit;
}

export interface SkillsShDetail {
  id: string;
  source: string;
  slug: string;
  installs: number;
  hash: string | null;
  files: Array<{ path: string; contents: string }> | null;
}

export interface SkillsShAudit {
  provider: string;
  slug: string;
  status: string;
  summary: string | null;
  auditedAt: string | null;
  riskLevel: string | null;
}

export interface SkillsShRateLimit {
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
  retryAfterSeconds: number | null;
}

export class SkillsCatalogConfigurationError extends Error {
  constructor(message = `${SKILLS_CATALOG_PROXY_ENV} must contain the HTTPS Breadboard catalog proxy URL ending in /api/v1.`) {
    super(message);
    this.name = "SkillsCatalogConfigurationError";
  }
}

export class SkillsCatalogProxyError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  readonly rateLimit: SkillsShRateLimit;

  constructor(message: string, status: number, headers?: Headers) {
    super(message);
    this.name = "SkillsCatalogProxyError";
    this.status = status;
    this.retryAfterSeconds = retryAfter(headers?.get("retry-after") ?? null);
    this.rateLimit = rateLimitFromHeaders(headers);
  }
}

export interface SkillsShClientOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  random?: () => number;
}

export class SkillsShClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly random: () => number;

  constructor(options: SkillsShClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = normalizeCatalogProxyUrl(options.baseUrl ?? process.env[SKILLS_CATALOG_PROXY_ENV]);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.retries = options.retries ?? 3;
    this.random = options.random ?? Math.random;
  }

  async listSkills(input: {
    page: number;
    perPage?: number;
    view?: SkillsShView;
    signal?: AbortSignal;
  }): Promise<SkillsShPage> {
    const page = Math.max(0, Math.trunc(input.page));
    const perPage = Math.min(
      SKILLS_SH_MAX_PAGE_SIZE,
      Math.max(1, Math.trunc(input.perPage ?? SKILLS_SH_MAX_PAGE_SIZE)),
    );
    const payload = await this.requestJson("/skills", {
      page: String(page),
      per_page: String(perPage),
      view: input.view ?? "all-time",
    }, input.signal);
    const body = record(payload.body, "skills catalog");
    const pagination = record(body.pagination, "skills catalog pagination");
    const data = array(body.data, "skills catalog data").map(normalizeSkill);
    return {
      data,
      pagination: {
        page: finiteInteger(pagination.page, page),
        perPage: finiteInteger(pagination.perPage ?? pagination.per_page, perPage),
        total: finiteInteger(pagination.total, data.length),
        hasMore: pagination.hasMore === true || pagination.has_more === true,
      },
      cacheMaxAgeSeconds: cacheMaxAge(payload.headers.get("cache-control")),
      rateLimit: rateLimitFromHeaders(payload.headers),
    };
  }

  async search(query: string, limit = 100, signal?: AbortSignal): Promise<SkillsShSkill[]> {
    const normalized = query.trim().slice(0, 200);
    if (normalized.length < 2) return [];
    const payload = await this.requestJson("/skills/search", {
      q: normalized,
      limit: String(Math.min(200, Math.max(1, Math.trunc(limit)))),
    }, signal);
    const body = record(payload.body, "skills search");
    const values = Array.isArray(body.data)
      ? body.data
      : Array.isArray(body.skills)
        ? body.skills
        : [];
    return values.map(normalizeSkill);
  }

  async curated(signal?: AbortSignal): Promise<Set<string>> {
    const payload = await this.requestJson("/skills/curated", {}, signal);
    const body = record(payload.body, "curated skills");
    const owners = Array.isArray(body.data)
      ? body.data
      : Array.isArray(body.owners)
        ? body.owners
        : [];
    const ids = new Set<string>();
    for (const ownerValue of owners) {
      const owner = record(ownerValue, "curated owner");
      for (const skillValue of Array.isArray(owner.skills) ? owner.skills : []) {
        const skill = record(skillValue, "curated skill");
        if (typeof skill.id === "string" && skill.id.trim()) ids.add(skill.id.trim());
      }
    }
    return ids;
  }

  async detail(source: string, slug: string, signal?: AbortSignal): Promise<SkillsShDetail> {
    const endpoint = `/skills/${sourcePath(source)}/${encodeURIComponent(validSegment(slug, "skill slug"))}`;
    const payload = await this.requestJson(endpoint, {}, signal);
    const body = record(payload.body, "skill detail");
    const files = body.files === null ? null : array(body.files, "skill detail files").map((value) => {
      const file = record(value, "skill detail file");
      if (typeof file.path !== "string" || typeof file.contents !== "string") {
        throw new TypeError("The catalog proxy returned a malformed skill file");
      }
      return { path: file.path, contents: file.contents };
    });
    return {
      id: requiredString(body.id, "detail id"),
      source: requiredString(body.source, "detail source"),
      slug: requiredString(body.slug, "detail slug"),
      installs: finiteInteger(body.installs, 0),
      hash: nullableString(body.hash),
      files,
    };
  }

  async audits(source: string, slug: string, signal?: AbortSignal): Promise<SkillsShAudit[]> {
    const endpoint = `/skills/audit/${sourcePath(source)}/${encodeURIComponent(validSegment(slug, "skill slug"))}`;
    const payload = await this.requestJson(endpoint, {}, signal);
    const body = record(payload.body, "skill audits");
    return array(body.audits ?? [], "skill audits").map((value) => {
      const audit = record(value, "skill audit");
      return {
        provider: requiredString(audit.provider, "audit provider"),
        slug: typeof audit.slug === "string" ? audit.slug : slug,
        status: requiredString(audit.status, "audit status"),
        summary: nullableString(audit.summary),
        auditedAt: nullableString(audit.auditedAt ?? audit.audited_at),
        riskLevel: nullableString(audit.riskLevel ?? audit.risk_level),
      };
    });
  }

  private async requestJson(
    endpoint: string,
    parameters: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<{ body: unknown; headers: Headers }> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
          cache: "no-store",
          signal: combined,
        });
        if (response.ok) return { body: await response.json(), headers: response.headers };
        const message = await providerErrorMessage(response);
        const error = new SkillsCatalogProxyError(message, response.status, response.headers);
        if (!retryableStatus(response.status) || attempt === this.retries) throw error;
        await delay(retryDelayMs(error.retryAfterSeconds, attempt, this.random), signal);
        lastError = error;
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        if (error instanceof SkillsCatalogProxyError && !retryableStatus(error.status)) throw error;
        lastError = error;
        if (attempt === this.retries) break;
        await delay(retryDelayMs(null, attempt, this.random), signal);
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error("Breadboard catalog proxy request failed");
  }
}

export function normalizeCatalogProxyUrl(value: string | undefined): string {
  const configured = value?.trim();
  if (!configured) throw new SkillsCatalogConfigurationError();
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new SkillsCatalogConfigurationError("The Breadboard catalog proxy URL is malformed.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new SkillsCatalogConfigurationError("The Breadboard catalog proxy URL cannot contain credentials, query parameters, or a fragment.");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new SkillsCatalogConfigurationError("The Breadboard catalog proxy URL must use HTTPS; HTTP is allowed only for loopback development.");
  }
  if (url.hostname.toLowerCase() === "skills.sh") {
    throw new SkillsCatalogConfigurationError("Breadboard must use its catalog proxy and cannot connect directly to skills.sh.");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname !== "/api/v1") {
    throw new SkillsCatalogConfigurationError("The Breadboard catalog proxy URL must end in /api/v1.");
  }
  return `${url.origin}/api/v1`;
}

function normalizeSkill(value: unknown): SkillsShSkill {
  const skill = record(value, "skill");
  const source = requiredString(skill.source, "skill source");
  const slug = requiredString(skill.slug, "skill slug");
  return {
    id: requiredString(skill.id, "skill id"),
    slug,
    name: typeof skill.name === "string" && skill.name.trim() ? skill.name.trim() : slug,
    source,
    installs: finiteInteger(skill.installs, 0),
    sourceType: nullableString(skill.sourceType ?? skill.source_type),
    installUrl: nullableString(skill.installUrl ?? skill.install_url),
    url: nullableString(skill.url) ?? `https://skills.sh/${source}/${slug}`,
    duplicate: skill.duplicate === true || skill.isDuplicate === true,
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`The catalog proxy returned malformed ${label}`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`The catalog proxy returned malformed ${label}`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`The catalog proxy returned malformed ${label}`);
  }
  return value.trim();
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
}

function validSegment(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === "." || normalized === ".." || /[?#\\]/.test(normalized)) {
    throw new TypeError(`Invalid ${label}`);
  }
  return normalized;
}

function sourcePath(source: string): string {
  const segments = source.split("/").filter(Boolean);
  if (segments.length !== 2) throw new TypeError("Invalid skill source");
  return segments.map((segment) => encodeURIComponent(validSegment(segment, "skill source"))).join("/");
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
}

function retryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(0, Math.ceil((time - Date.now()) / 1_000)) : null;
}

function retryDelayMs(retryAfterSeconds: number | null, attempt: number, random: () => number): number {
  if (retryAfterSeconds !== null) return Math.min(60_000, retryAfterSeconds * 1_000);
  const base = Math.min(8_000, 500 * 2 ** attempt);
  return Math.trunc(base * (0.75 + random() * 0.5));
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Aborted"));
    }, { once: true });
  });
}

function cacheMaxAge(value: string | null): number | null {
  const match = value?.match(/(?:s-maxage|max-age)=(\d+)/i);
  return match ? Number(match[1]) : null;
}

function rateLimitFromHeaders(headers?: Headers): SkillsShRateLimit {
  const integer = (name: string) => {
    const value = headers?.get(name);
    const parsed = value === null || value === undefined ? Number.NaN : Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  };
  const reset = headers?.get("x-ratelimit-reset");
  const resetNumber = reset ? Number(reset) : Number.NaN;
  return {
    limit: integer("x-ratelimit-limit"),
    remaining: integer("x-ratelimit-remaining"),
    resetAt: Number.isFinite(resetNumber)
      ? new Date(resetNumber > 1_000_000_000 ? resetNumber * 1_000 : Date.now() + resetNumber * 1_000).toISOString()
      : null,
    retryAfterSeconds: retryAfter(headers?.get("retry-after") ?? null),
  };
}

async function providerErrorMessage(response: Response): Promise<string> {
  try {
    const body = record(await response.json(), "error response");
    if (typeof body.message === "string" && body.message.trim()) return body.message.trim();
  } catch {
    // Fall through to a status-only error without echoing provider HTML.
  }
  return `Breadboard catalog proxy returned HTTP ${response.status}`;
}
