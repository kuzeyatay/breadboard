import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ConsoleMessage,
  ElectronApplication,
  Page,
  Request,
  Response,
} from "playwright";

export const REDACTED = "[REDACTED]";

export type DiagnosticSource = "electron" | "main" | "renderer" | "network" | "service";
export type DiagnosticLevel = "debug" | "info" | "warning" | "error" | "fatal";
export type RedactedJson =
  | null
  | boolean
  | number
  | string
  | RedactedJson[]
  | { [key: string]: RedactedJson };

export interface DiagnosticEntryInput {
  readonly source: DiagnosticSource;
  readonly level: DiagnosticLevel;
  readonly event: string;
  readonly message: string;
  readonly pageId?: string;
  readonly url?: string;
  readonly service?: string;
  /** False means useful evidence, but not something the collector calls a bug. */
  readonly actionable?: boolean;
  readonly data?: unknown;
}

export interface DiagnosticEntry
  extends Omit<DiagnosticEntryInput, "data"> {
  readonly sequence: number;
  readonly timestamp: string;
  readonly data?: RedactedJson;
}

export interface RedactionOptions {
  readonly replacement?: string;
  /** Known per-run values, such as the disposable invite code. */
  readonly secretValues?: readonly string[];
  readonly sensitiveNames?: readonly string[];
}

export interface DiagnosticsCollectorOptions extends RedactionOptions {
  readonly outputDir: string;
  readonly serviceLogsDir?: string;
  readonly maxEntries?: number;
  readonly maxMessageBytes?: number;
  readonly maxBodyBytes?: number;
  readonly console?: "errors-and-warnings" | "all";
  readonly captureRequestBodies?: boolean;
  readonly captureResponseBodies?: boolean;
  readonly detectMalformedJson?: boolean;
  /** Mark a known response as expected evidence rather than an actionable error. */
  readonly isExpectedResponse?: (response: Response) => boolean | Promise<boolean>;
  readonly now?: () => Date;
}

export interface ServiceLogSnapshot {
  readonly service: string;
  readonly source: string;
  readonly artifact: string | null;
  readonly sourceBytes: number;
  readonly capturedBytes: number;
  readonly lineCount: number;
  readonly truncated: boolean;
}

export interface SnapshotServiceLogsOptions {
  readonly logsDir: string;
  readonly outputDir?: string;
  readonly redactor?: SecretRedactor;
  readonly collector?: DiagnosticsCollector;
  readonly maxFiles?: number;
  readonly maxBytesPerFile?: number;
  readonly maxStructuredLinesPerFile?: number;
}

export interface DiagnosticSnapshot {
  readonly generatedAt: string;
  readonly eventLog: string;
  readonly droppedEntries: number;
  readonly counts: {
    readonly byLevel: Record<DiagnosticLevel, number>;
    readonly bySource: Record<DiagnosticSource, number>;
  };
  readonly serviceLogs: readonly ServiceLogSnapshot[];
  readonly entries: readonly DiagnosticEntry[];
}

export interface FinalizeDiagnosticsOptions {
  readonly snapshotServiceLogs?: boolean;
  readonly fileName?: string;
}

interface PageHandlers {
  console: (message: ConsoleMessage) => void;
  pageerror: (error: Error) => void;
  crash: () => void;
  requestfailed: (request: Request) => void;
  response: (response: Response) => void;
  close: () => void;
}

interface ResponseTextCapture {
  readonly text: string;
  readonly complete: boolean;
  readonly reason:
    | "complete"
    | "content_length_unavailable"
    | "content_length_exceeds_limit"
    | "body_exceeds_limit"
    | "body_unavailable";
}

const DEFAULT_SENSITIVE_NAMES = [
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "apikey",
  "accesskey",
  "clientsecret",
  "credential",
  "invitecode",
  "password",
  "passwd",
  "privatekey",
  "secret",
  "session",
  "token",
  "xapikey",
  "xauthtoken",
  "xcapabilitytoken",
  "xcsrftoken",
] as const;

const LOG_FILE_PATTERN = /(?:\.log(?:\.1)?|\.txt|\.ndjson|startup-status\.json)$/i;
const JSON_CONTENT_TYPE = /(?:^|[+\/])json(?:;|$)/i;
const TEXT_CONTENT_TYPE = /^(?:text\/|application\/(?:problem\+json|xml|x-www-form-urlencoded))/i;

/** Redacts structured values as well as common secret encodings in free text. */
export class SecretRedactor {
  readonly replacement: string;
  private readonly secrets = new Set<string>();
  private readonly sensitiveNames = new Set<string>();

  constructor(options: RedactionOptions = {}) {
    this.replacement = options.replacement ?? REDACTED;
    for (const name of [...DEFAULT_SENSITIVE_NAMES, ...(options.sensitiveNames ?? [])]) {
      this.sensitiveNames.add(normalizeName(name));
    }
    this.addSecrets(options.secretValues ?? []);
  }

  addSecrets(values: readonly string[]): void {
    for (const value of values) {
      // Very short literals create destructive false positives in normal prose.
      if (value.trim().length >= 4) this.secrets.add(value);
    }
  }

  isSensitiveName(name: string): boolean {
    const normalized = normalizeName(name);
    if (this.sensitiveNames.has(normalized)) return true;
    return /(?:apikey|authorization|bearer|cookie|credential|invitecode|password|privatekey|secret|sessiontoken|token)$/.test(
      normalized,
    );
  }

  redactText(input: string): string {
    let text = input;
    for (const secret of [...this.secrets].sort((left, right) => right.length - left.length)) {
      text = text.replaceAll(secret, this.replacement);
    }

    // Authentication schemes, JWTs, URL credentials/query values, and common
    // JSON/env/log assignments cover both headers and unstructured service logs.
    text = text
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, `$1 ${this.replacement}`)
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, this.replacement)
      .replace(
        /([?&](?:api_?key|authorization|code|credential|key|password|secret|session|token)=)[^&#\s]*/gi,
        `$1${this.replacement}`,
      )
      .replace(
        /((?:api_?key|authorization|cookie|credential|invite_?code|password|private_?key|secret|session|token)\s*[:=]\s*)('[^']*'|"[^"]*"|[^\s,;}]+)/gi,
        `$1${this.replacement}`,
      )
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${this.replacement}@`);
    return text;
  }

  redactUrl(input: string): string {
    try {
      const parsed = new URL(input);
      if (parsed.username || parsed.password) {
        parsed.username = this.replacement;
        parsed.password = "";
      }
      for (const key of [...parsed.searchParams.keys()]) {
        if (this.isSensitiveName(key)) parsed.searchParams.set(key, this.replacement);
      }
      parsed.hash = "";
      return this.redactText(parsed.toString());
    } catch {
      return this.redactText(input);
    }
  }

  redactHeaders(
    headers: Record<string, string | string[] | undefined>,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [name, raw] of Object.entries(headers)) {
      if (raw === undefined) continue;
      result[name] = this.isSensitiveName(name)
        ? this.replacement
        : this.redactText(Array.isArray(raw) ? raw.join(", ") : raw);
    }
    return result;
  }

  redactValue(value: unknown): RedactedJson {
    return this.redactValueInner(value, new WeakSet<object>());
  }

  private redactValueInner(value: unknown, seen: WeakSet<object>): RedactedJson {
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return this.redactText(value);
    if (typeof value === "bigint") return value.toString();
    if (value === undefined) return null;
    if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
    if (typeof value === "symbol") return value.toString();
    if (Buffer.isBuffer(value)) return `[Buffer ${value.byteLength} bytes]`;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof URL) return this.redactUrl(value.toString());
    if (value instanceof Error) {
      return {
        name: value.name,
        message: this.redactText(value.message),
        stack: value.stack ? this.redactText(value.stack) : null,
      };
    }
    if (typeof value !== "object") return this.redactText(String(value));
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) {
      const result = value.map((item) => this.redactValueInner(item, seen));
      seen.delete(value);
      return result;
    }

    const result: Record<string, RedactedJson> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = this.isSensitiveName(key)
        ? this.replacement
        : this.redactValueInner(item, seen);
    }
    seen.delete(value);
    return result;
  }
}

export function redactText(input: string, options: RedactionOptions = {}): string {
  return new SecretRedactor(options).redactText(input);
}

export function redactUrl(input: string, options: RedactionOptions = {}): string {
  return new SecretRedactor(options).redactUrl(input);
}

export function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
  options: RedactionOptions = {},
): Record<string, string> {
  return new SecretRedactor(options).redactHeaders(headers);
}

export function redactBody(
  body: unknown,
  redactor: SecretRedactor = new SecretRedactor(),
): RedactedJson {
  if (typeof body !== "string") return redactor.redactValue(body);
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return redactor.redactValue(JSON.parse(trimmed));
    } catch {
      // Preserve malformed-response evidence, still applying text redaction.
    }
  }
  return redactor.redactText(body);
}

/**
 * Bounded JSONL collector for Electron, renderer, network, and service evidence.
 * Attach it immediately after `electron.launch`, before awaiting firstWindow().
 */
export class DiagnosticsCollector {
  readonly outputDir: string;
  readonly eventLogPath: string;
  readonly redactor: SecretRedactor;

  private readonly options: Required<
    Pick<
      DiagnosticsCollectorOptions,
      | "maxEntries"
      | "maxMessageBytes"
      | "maxBodyBytes"
      | "console"
      | "captureRequestBodies"
      | "captureResponseBodies"
      | "detectMalformedJson"
    >
  > &
    DiagnosticsCollectorOptions;
  private readonly now: () => Date;
  private readonly retainedEntries: DiagnosticEntry[] = [];
  private readonly serviceLogSnapshots: ServiceLogSnapshot[] = [];
  private readonly pageIds = new WeakMap<Page, string>();
  private readonly pageHandlers = new Map<Page, PageHandlers>();
  private readonly pending = new Set<Promise<void>>();
  private application: ElectronApplication | null = null;
  private sequence = 0;
  private pageSequence = 0;
  private droppedEntries = 0;
  private serviceLogsCaptured = false;
  private expectedShutdown = false;
  private stdoutLines: LineAccumulator | null = null;
  private stderrLines: LineAccumulator | null = null;
  private processListeners:
    | {
        process: ReturnType<ElectronApplication["process"]>;
        stdout: (chunk: Buffer | string) => void;
        stderr: (chunk: Buffer | string) => void;
        error: (error: Error) => void;
        exit: (code: number | null, signal: NodeJS.Signals | null) => void;
      }
    | null = null;

  private readonly onWindow = (page: Page): void => this.attachPage(page);
  private readonly onApplicationClose = (): void => {
    this.record({
      source: "electron",
      level: this.expectedShutdown ? "info" : "error",
      event: "application-close",
      message: this.expectedShutdown
        ? "Electron application closed after requested shutdown"
        : "Electron application closed unexpectedly",
      actionable: !this.expectedShutdown,
    });
  };
  private readonly onMainConsole = (message: ConsoleMessage): void => {
    const type = message.type();
    const level = consoleLevel(type);
    if (this.options.console !== "all" && level !== "warning" && level !== "error") return;
    this.record({
      source: "main",
      level,
      event: "main-console",
      message: message.text(),
      data: { type, location: message.location() },
    });
  };

  constructor(options: DiagnosticsCollectorOptions) {
    this.outputDir = path.resolve(options.outputDir);
    this.eventLogPath = path.join(this.outputDir, "diagnostics.jsonl");
    this.options = {
      ...options,
      maxEntries: options.maxEntries ?? 5_000,
      maxMessageBytes: options.maxMessageBytes ?? 16 * 1024,
      maxBodyBytes: options.maxBodyBytes ?? 32 * 1024,
      console: options.console ?? "errors-and-warnings",
      captureRequestBodies: options.captureRequestBodies ?? false,
      captureResponseBodies: options.captureResponseBodies ?? true,
      detectMalformedJson: options.detectMalformedJson ?? true,
    };
    this.now = options.now ?? (() => new Date());
    this.redactor = new SecretRedactor(options);
    fs.mkdirSync(this.outputDir, { recursive: true });
    // Append supports an app restart within one QA run without losing evidence.
    fs.closeSync(fs.openSync(this.eventLogPath, "a", 0o600));
  }

  get entries(): readonly DiagnosticEntry[] {
    return [...this.retainedEntries];
  }

  get hasActionableErrors(): boolean {
    return this.retainedEntries.some(
      (entry) =>
        entry.actionable !== false && (entry.level === "error" || entry.level === "fatal"),
    );
  }

  addSecrets(values: readonly string[]): void {
    this.redactor.addSecrets(values);
  }

  record(input: DiagnosticEntryInput): DiagnosticEntry {
    const message = truncateUtf8(
      this.redactor.redactText(input.message),
      this.options.maxMessageBytes,
    );
    const entry: DiagnosticEntry = {
      sequence: ++this.sequence,
      timestamp: this.now().toISOString(),
      source: input.source,
      level: input.level,
      event: input.event,
      message,
      ...(input.pageId ? { pageId: input.pageId } : {}),
      ...(input.url ? { url: this.redactor.redactUrl(input.url) } : {}),
      ...(input.service ? { service: input.service } : {}),
      ...(input.actionable !== undefined ? { actionable: input.actionable } : {}),
      ...(input.data !== undefined ? { data: this.redactor.redactValue(input.data) } : {}),
    };

    this.retainedEntries.push(entry);
    if (this.retainedEntries.length > this.options.maxEntries) {
      this.retainedEntries.shift();
      this.droppedEntries += 1;
    }
    try {
      fs.appendFileSync(this.eventLogPath, `${JSON.stringify(entry)}\n`, "utf8");
    } catch {
      // Diagnostics must never change the product's behavior. The in-memory
      // copy remains available even when the artifact disk is full or revoked.
    }
    return entry;
  }

  attach(application: ElectronApplication): this {
    if (this.application === application) return this;
    if (this.application) throw new Error("DiagnosticsCollector is already attached to an app");
    this.application = application;

    // Subscribe before enumerating to close the gap in which Breadboard can
    // create its hidden dashboard window and begin hydrating it.
    application.on("window", this.onWindow);
    application.on("close", this.onApplicationClose);
    application.on("console", this.onMainConsole);
    for (const page of application.windows()) this.attachPage(page);
    this.attachProcess(application.process());
    this.record({
      source: "electron",
      level: "info",
      event: "diagnostics-attached",
      message: `Attached diagnostics to ${application.windows().length} existing window(s)`,
      actionable: false,
    });
    return this;
  }

  /** Descriptive alias for fixture code. */
  attachElectron(application: ElectronApplication): this {
    return this.attach(application);
  }

  attachPage(page: Page): void {
    if (this.pageHandlers.has(page)) return;
    const pageId = `page-${++this.pageSequence}`;
    this.pageIds.set(page, pageId);

    const handlers: PageHandlers = {
      console: (message) => this.captureRendererConsole(page, message),
      pageerror: (error) => {
        this.record({
          source: "renderer",
          level: "error",
          event: "page-error",
          message: error.stack ?? error.message,
          pageId,
          url: safePageUrl(page),
          data: { name: error.name },
        });
      },
      crash: () => {
        this.record({
          source: "renderer",
          level: "fatal",
          event: "renderer-crash",
          message: "Renderer process crashed",
          pageId,
          url: safePageUrl(page),
        });
      },
      requestfailed: (request) => this.captureRequestFailure(page, request),
      response: (response) => this.track(this.captureResponse(page, response)),
      close: () => {
        this.record({
          source: "renderer",
          level: "info",
          event: "window-close",
          message: "Renderer window closed",
          pageId,
          url: safePageUrl(page),
          actionable: false,
        });
        this.detachPage(page);
      },
    };
    this.pageHandlers.set(page, handlers);
    page.on("console", handlers.console);
    page.on("pageerror", handlers.pageerror);
    page.on("crash", handlers.crash);
    page.on("requestfailed", handlers.requestfailed);
    page.on("response", handlers.response);
    page.on("close", handlers.close);
    this.record({
      source: "renderer",
      level: "info",
      event: "window-attached",
      message: "Attached renderer diagnostics",
      pageId,
      url: safePageUrl(page),
      actionable: false,
    });
  }

  /** Call immediately before the fixture deliberately closes Electron. */
  markExpectedShutdown(): void {
    this.expectedShutdown = true;
    this.record({
      source: "electron",
      level: "info",
      event: "shutdown-requested",
      message: "QA fixture requested application shutdown",
      actionable: false,
    });
  }

  async snapshotServiceLogs(): Promise<readonly ServiceLogSnapshot[]> {
    if (this.serviceLogsCaptured) return [...this.serviceLogSnapshots];
    this.serviceLogsCaptured = true;
    const logsDir = this.options.serviceLogsDir;
    if (!logsDir) return [];
    const snapshots = await snapshotServiceLogs({
      logsDir,
      outputDir: path.join(this.outputDir, "service-logs"),
      redactor: this.redactor,
      collector: this,
    });
    this.serviceLogSnapshots.push(...snapshots);
    return [...this.serviceLogSnapshots];
  }

  async finalize(options: FinalizeDiagnosticsOptions = {}): Promise<DiagnosticSnapshot> {
    if (options.snapshotServiceLogs !== false) await this.snapshotServiceLogs();
    await this.drainPending();
    return this.writeSnapshot(options.fileName ?? "diagnostics.json");
  }

  /** Persist the evidence bundle at the point an assertion or scenario fails. */
  async snapshotFailure(fileName = "failure-diagnostics.json"): Promise<DiagnosticSnapshot> {
    return this.finalize({ snapshotServiceLogs: true, fileName });
  }

  assertNoFatal(context = "Electron QA diagnostics"): void {
    const fatal = this.retainedEntries.filter(
      (entry) => entry.actionable !== false && entry.level === "fatal",
    );
    if (fatal.length === 0) return;
    const summary = fatal
      .slice(-5)
      .map((entry) => `${entry.source}/${entry.event}: ${entry.message}`)
      .join("\n");
    throw new Error(`${context} captured ${fatal.length} fatal event(s):\n${summary}`);
  }

  writeSnapshot(fileName = "diagnostics.json"): DiagnosticSnapshot {
    const safeName = safeArtifactName(fileName);
    const snapshot: DiagnosticSnapshot = {
      generatedAt: this.now().toISOString(),
      eventLog: this.eventLogPath,
      droppedEntries: this.droppedEntries,
      counts: diagnosticCounts(this.retainedEntries),
      serviceLogs: [...this.serviceLogSnapshots],
      entries: [...this.retainedEntries],
    };
    const outputPath = path.join(this.outputDir, safeName);
    const temporary = `${outputPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      fs.renameSync(temporary, outputPath);
    } catch {
      fs.rmSync(outputPath, { force: true });
      fs.renameSync(temporary, outputPath);
    }
    return snapshot;
  }

  async dispose(): Promise<void> {
    const application = this.application;
    if (application) {
      application.off("window", this.onWindow);
      application.off("close", this.onApplicationClose);
      application.off("console", this.onMainConsole);
    }
    for (const page of [...this.pageHandlers.keys()]) this.detachPage(page);
    this.detachProcess();
    await this.drainPending();
    this.application = null;
  }

  private captureRendererConsole(page: Page, message: ConsoleMessage): void {
    const type = message.type();
    const level = consoleLevel(type);
    if (this.options.console !== "all" && level !== "warning" && level !== "error") return;
    const text = message.text();
    const lower = text.toLowerCase();
    const event = lower.includes("hydration")
      ? "hydration-error"
      : lower.includes("react") || lower.includes("error boundary")
        ? "react-console"
        : "renderer-console";
    this.record({
      source: "renderer",
      level,
      event,
      message: text,
      pageId: this.pageId(page),
      url: safePageUrl(page),
      data: { type, location: message.location() },
    });
  }

  private captureRequestFailure(page: Page, request: Request): void {
    const failure = request.failure();
    const errorText = failure?.errorText ?? "request failed";
    const timedOut = /timed?_?out|timeout/i.test(errorText);
    const aborted = /aborted|cancelled|canceled/i.test(errorText);
    const data: Record<string, unknown> = {
      method: request.method(),
      resourceType: request.resourceType(),
      failure: errorText,
      headers: this.redactor.redactHeaders(request.headers()),
    };
    if (this.options.captureRequestBodies) {
      const postData = request.postData();
      if (postData !== null) {
        data["body"] = redactBody(
          truncateUtf8(postData, this.options.maxBodyBytes),
          this.redactor,
        );
      }
    }
    this.record({
      source: "network",
      level: aborted ? "info" : "error",
      event: timedOut ? "request-timeout" : aborted ? "request-aborted" : "request-failed",
      message: `${request.method()} ${this.redactor.redactUrl(request.url())}: ${errorText}`,
      pageId: this.pageId(page),
      url: request.url(),
      actionable: !aborted,
      data,
    });
  }

  private async captureResponse(page: Page, response: Response): Promise<void> {
    const status = response.status();
    const headers = response.headers();
    const contentType = headers["content-type"] ?? "";
    if (status >= 400) {
      const explicitlyExpected = await this.options.isExpectedResponse?.(response);
      // A 404 remains visible evidence but needs scenario context before being
      // called a product bug. Other known negative paths use the callback.
      const actionable = explicitlyExpected !== true && status !== 404;
      const data: Record<string, unknown> = {
        status,
        statusText: response.statusText(),
        method: response.request().method(),
        headers: this.redactor.redactHeaders(headers),
        expected: explicitlyExpected === true,
      };
      if (this.options.captureResponseBodies && isCapturableContentType(contentType)) {
        const capture = await this.readResponseText(response);
        data["body"] = redactBody(capture.text, this.redactor);
      }
      this.record({
        source: "network",
        level: !actionable ? "info" : status >= 500 ? "error" : "warning",
        event: "http-error-response",
        message: `${response.request().method()} ${response.url()} returned ${status} ${response.statusText()}`,
        pageId: this.pageId(page),
        url: response.url(),
        actionable,
        data,
      });
      return;
    }

    if (
      this.options.detectMalformedJson &&
      status !== 204 &&
      JSON_CONTENT_TYPE.test(contentType) &&
      isLikelyApiUrl(response.url())
    ) {
      const capture = await this.readResponseText(response, true);
      if (!capture.complete) {
        this.record({
          source: "network",
          level: "info",
          event: "json-response-validation-skipped",
          message: `${response.request().method()} ${response.url()} was not parsed because diagnostics could not capture the complete body within ${this.options.maxBodyBytes} bytes`,
          pageId: this.pageId(page),
          url: response.url(),
          actionable: false,
          data: {
            status,
            reason: capture.reason,
            body: redactBody(capture.text, this.redactor),
          },
        });
        return;
      }
      const body = capture.text;
      if (body.trim() === "") return;
      try {
        JSON.parse(body);
      } catch (error) {
        this.record({
          source: "network",
          level: "error",
          event: "malformed-json-response",
          message: `${response.request().method()} ${response.url()} returned malformed JSON`,
          pageId: this.pageId(page),
          url: response.url(),
          data: {
            status,
            parseError: error instanceof Error ? error.message : String(error),
            body: redactBody(body, this.redactor),
          },
        });
      }
    }
  }

  private async readResponseText(
    response: Response,
    requireCompleteWithinLimit = false,
  ): Promise<ResponseTextCapture> {
    const rawLength = response.headers()["content-length"];
    const contentLength = rawLength === undefined ? Number.NaN : Number(rawLength);
    if (requireCompleteWithinLimit && !Number.isFinite(contentLength)) {
      return {
        text: "[body not read: content length unavailable]",
        complete: false,
        reason: "content_length_unavailable",
      };
    }
    if (
      requireCompleteWithinLimit &&
      contentLength > this.options.maxBodyBytes
    ) {
      return {
        text: `[body omitted: ${contentLength} bytes exceeds the ${this.options.maxBodyBytes} byte diagnostics limit]\n[truncated]`,
        complete: false,
        reason: "content_length_exceeds_limit",
      };
    }
    if (Number.isFinite(contentLength) && contentLength > this.options.maxBodyBytes * 4) {
      return {
        text: `[body omitted: ${contentLength} bytes]\n[truncated]`,
        complete: false,
        reason: "content_length_exceeds_limit",
      };
    }
    try {
      const body = await response.text();
      const complete = Buffer.byteLength(body, "utf8") <= this.options.maxBodyBytes;
      return {
        text: truncateUtf8(body, this.options.maxBodyBytes),
        complete,
        reason: complete ? "complete" : "body_exceeds_limit",
      };
    } catch (error) {
      return {
        text: `[body unavailable: ${error instanceof Error ? error.message : String(error)}]`,
        complete: false,
        reason: "body_unavailable",
      };
    }
  }

  private attachProcess(child: ReturnType<ElectronApplication["process"]>): void {
    const stdoutLines = new LineAccumulator((line) => this.captureMainLine("stdout", line));
    const stderrLines = new LineAccumulator((line) => this.captureMainLine("stderr", line));
    const stdout = (chunk: Buffer | string): void => stdoutLines.push(chunk);
    const stderr = (chunk: Buffer | string): void => stderrLines.push(chunk);
    const error = (cause: Error): void => {
      this.record({
        source: "main",
        level: "fatal",
        event: "main-process-error",
        message: cause.stack ?? cause.message,
      });
    };
    const exit = (code: number | null, signal: NodeJS.Signals | null): void => {
      stdoutLines.flush();
      stderrLines.flush();
      const clean = this.expectedShutdown && (code === 0 || code === null);
      this.record({
        source: "main",
        level: clean ? "info" : "fatal",
        event: "main-process-exit",
        message: `Electron main process exited (code ${code ?? "null"}, signal ${signal ?? "null"})`,
        actionable: !clean,
        data: { code, signal, expectedShutdown: this.expectedShutdown },
      });
    };
    child.stdout?.on("data", stdout);
    child.stderr?.on("data", stderr);
    child.on("error", error);
    child.on("exit", exit);
    this.stdoutLines = stdoutLines;
    this.stderrLines = stderrLines;
    this.processListeners = { process: child, stdout, stderr, error, exit };
  }

  private captureMainLine(stream: "stdout" | "stderr", line: string): void {
    const level = mainLineLevel(stream, line);
    const lower = line.toLowerCase();
    const event = /unhandled(?:promiserejection| rejection)/i.test(line)
      ? "unhandled-rejection"
      : /uncaught(?:exception)?/i.test(line)
        ? "uncaught-exception"
        : /fatal startup|service.+(?:failed|could not start)|required service/i.test(line)
          ? "service-startup-failure"
          : `main-${stream}`;
    this.record({
      source: "main",
      level,
      event,
      message: line,
      actionable: event !== `main-${stream}` || level === "error" || level === "fatal",
      data: lower.includes("eaddrinuse") ? { category: "port-conflict" } : undefined,
    });
  }

  private detachPage(page: Page): void {
    const handlers = this.pageHandlers.get(page);
    if (!handlers) return;
    try {
      page.off("console", handlers.console);
      page.off("pageerror", handlers.pageerror);
      page.off("crash", handlers.crash);
      page.off("requestfailed", handlers.requestfailed);
      page.off("response", handlers.response);
      page.off("close", handlers.close);
    } catch {
      // A destroyed BrowserWindow may reject listener operations during swap.
    }
    this.pageHandlers.delete(page);
  }

  private detachProcess(): void {
    const listeners = this.processListeners;
    if (!listeners) return;
    listeners.process.stdout?.off("data", listeners.stdout);
    listeners.process.stderr?.off("data", listeners.stderr);
    listeners.process.off("error", listeners.error);
    listeners.process.off("exit", listeners.exit);
    this.stdoutLines?.flush();
    this.stderrLines?.flush();
    this.stdoutLines = null;
    this.stderrLines = null;
    this.processListeners = null;
  }

  private pageId(page: Page): string {
    return this.pageIds.get(page) ?? "unknown-page";
  }

  private track(promise: Promise<void>): void {
    this.pending.add(promise);
    void promise
      .catch((error) => {
        this.record({
          source: "electron",
          level: "warning",
          event: "diagnostic-capture-error",
          message: error instanceof Error ? error.stack ?? error.message : String(error),
          actionable: false,
        });
      })
      .finally(() => this.pending.delete(promise));
  }

  private async drainPending(): Promise<void> {
    // Response handlers may settle while the first batch is being awaited.
    for (let round = 0; round < 8 && this.pending.size > 0; round += 1) {
      await Promise.allSettled([...this.pending]);
    }
  }
}

/** Convenience constructor used by fixtures immediately after launch. */
export function attachDiagnostics(
  application: ElectronApplication,
  options: DiagnosticsCollectorOptions,
): DiagnosticsCollector {
  return new DiagnosticsCollector(options).attach(application);
}

/** Copy bounded, redacted service tails and turn each retained line into JSONL. */
export async function snapshotServiceLogs(
  options: SnapshotServiceLogsOptions,
): Promise<ServiceLogSnapshot[]> {
  const logsDir = path.resolve(options.logsDir);
  if (!fs.existsSync(logsDir)) return [];
  const stat = fs.lstatSync(logsDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return [];

  const redactor = options.redactor ?? new SecretRedactor();
  const maxFiles = options.maxFiles ?? 64;
  const maxBytes = options.maxBytesPerFile ?? 256 * 1024;
  const maxStructuredLines = options.maxStructuredLinesPerFile ?? 500;
  const files = discoverLogFiles(logsDir).slice(0, maxFiles);
  const outputDir = options.outputDir ? path.resolve(options.outputDir) : null;
  if (outputDir) fs.mkdirSync(outputDir, { recursive: true });
  const snapshots: ServiceLogSnapshot[] = [];

  // .log.1 is older than .log; sort that generation first per service.
  files.sort((left, right) => chronologicalLogName(left).localeCompare(chronologicalLogName(right)));
  for (const relative of files) {
    const sourcePath = safeChildPath(logsDir, relative);
    const sourceStat = fs.lstatSync(sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) continue;
    const captured = readTail(sourcePath, maxBytes);
    const clean = redactor.redactText(captured.text);
    let artifact: string | null = null;
    if (outputDir) {
      artifact = safeChildPath(outputDir, relative);
      fs.mkdirSync(path.dirname(artifact), { recursive: true });
      fs.writeFileSync(artifact, clean, { encoding: "utf8", mode: 0o600 });
    }
    const lines = clean.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const service = serviceIdFromLog(relative);
    const structuredLines = lines.slice(-maxStructuredLines);
    for (const line of structuredLines) {
      options.collector?.record({
        source: "service",
        level: serviceLineLevel(line),
        event: "service-log",
        message: line,
        service,
        data: { file: relative },
      });
    }
    snapshots.push({
      service,
      source: relative,
      artifact,
      sourceBytes: sourceStat.size,
      capturedBytes: Buffer.byteLength(clean),
      lineCount: lines.length,
      truncated: captured.truncated,
    });
  }
  return snapshots;
}

function discoverLogFiles(root: string): string[] {
  const results: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && LOG_FILE_PATTERN.test(entry.name)) {
        results.push(path.relative(root, absolute));
      }
    }
  };
  visit(root);
  return results;
}

function readTail(file: string, maxBytes: number): { text: string; truncated: boolean } {
  const size = fs.statSync(file).size;
  const length = Math.min(size, maxBytes);
  const buffer = Buffer.alloc(length);
  const descriptor = fs.openSync(file, "r");
  try {
    fs.readSync(descriptor, buffer, 0, length, Math.max(0, size - length));
  } finally {
    fs.closeSync(descriptor);
  }
  let text = buffer.toString("utf8");
  if (size > length) {
    const firstNewline = text.indexOf("\n");
    if (firstNewline >= 0) text = text.slice(firstNewline + 1);
    text = `[earlier log bytes omitted]\n${text}`;
  }
  return { text, truncated: size > length };
}

function diagnosticCounts(entries: readonly DiagnosticEntry[]): DiagnosticSnapshot["counts"] {
  const byLevel: Record<DiagnosticLevel, number> = {
    debug: 0,
    info: 0,
    warning: 0,
    error: 0,
    fatal: 0,
  };
  const bySource: Record<DiagnosticSource, number> = {
    electron: 0,
    main: 0,
    renderer: 0,
    network: 0,
    service: 0,
  };
  for (const entry of entries) {
    byLevel[entry.level] += 1;
    bySource[entry.source] += 1;
  }
  return { byLevel, bySource };
}

function consoleLevel(type: string): DiagnosticLevel {
  if (type === "error" || type === "assert") return "error";
  if (type === "warning" || type === "warn") return "warning";
  if (type === "debug" || type === "trace") return "debug";
  return "info";
}

function mainLineLevel(stream: "stdout" | "stderr", line: string): DiagnosticLevel {
  if (/fatal|panic|uncaught|unhandled(?:promiserejection| rejection)/i.test(line)) return "fatal";
  if (/\berror\b|\bfailed\b|exception|eaddrinuse/i.test(line)) return "error";
  if (/\bwarn(?:ing)?\b|degraded|retry/i.test(line)) return "warning";
  return stream === "stderr" ? "warning" : "info";
}

function serviceLineLevel(line: string): DiagnosticLevel {
  if (/fatal|panic|uncaught|unhandled/i.test(line)) return "fatal";
  if (/\berror\b|\bfailed\b|exception|eaddrinuse|traceback/i.test(line)) return "error";
  if (/\bwarn(?:ing)?\b|degraded|retry/i.test(line)) return "warning";
  return "info";
}

function isCapturableContentType(contentType: string): boolean {
  return JSON_CONTENT_TYPE.test(contentType) || TEXT_CONTENT_TYPE.test(contentType);
}

function isLikelyApiUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.pathname === "/api" || parsed.pathname.startsWith("/api/");
  } catch {
    return /\/api(?:\/|\?|$)/.test(value);
  }
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function truncateUtf8(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) return value;
  return `${buffer.subarray(0, Math.max(0, maxBytes - 32)).toString("utf8")}\n[truncated]`;
}

function safePageUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return "";
  }
}

function safeArtifactName(value: string): string {
  const name = path.basename(value).replace(/[^A-Za-z0-9._-]/g, "_");
  if (!name || name === "." || name === "..") throw new Error("Invalid diagnostics file name");
  return name;
}

function safeChildPath(root: string, relative: string): string {
  const absolute = path.resolve(root, relative);
  const relation = path.relative(path.resolve(root), absolute);
  if (relation === "" || relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new Error(`Artifact path escaped its root: ${relative}`);
  }
  return absolute;
}

function serviceIdFromLog(relative: string): string {
  return path
    .basename(relative)
    .replace(/\.log\.1$/i, "")
    .replace(/\.(?:log|txt|ndjson|json)$/i, "");
}

function chronologicalLogName(relative: string): string {
  return relative.replace(/\.log\.1$/i, ".log.0").replace(/\.log$/i, ".log.1");
}

class LineAccumulator {
  private remainder = "";

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: Buffer | string): void {
    const combined = this.remainder + chunk.toString();
    const lines = combined.split(/\r?\n/);
    this.remainder = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) this.onLine(line);
    }
  }

  flush(): void {
    if (this.remainder.length > 0) this.onLine(this.remainder);
    this.remainder = "";
  }
}
