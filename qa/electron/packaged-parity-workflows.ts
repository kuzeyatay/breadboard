import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { expect, type FrameLocator, type Page, type Request, type Response } from "@playwright/test";

import type { ElectronQaHarness } from "./fixtures";
import type { PackagedParityPlan } from "./packaged-parity-plan.mjs";
import {
  injectUnresolvablePersonaSelection,
  readInjectedPersonaSelection,
} from "./packaged-parity-recovery-state.mjs";
import { buildRuntimePassClaims } from "./packaged-parity-runtime-evidence.mjs";
import { capturePackagedRuntimeSnapshot, type RuntimeParitySnapshot } from "./packaged-parity-runtime";
import {
  assertAuthenticatedDashboard,
  ensureAuthenticatedDashboard,
  openGardenWorkspace,
  openTerminal,
  type GardenInfo,
} from "./user-journeys";

const ACTION_TIMEOUT_MS = 180_000;
const TURN_TIMEOUT_MS = 12 * 60_000;
const MAX_NETWORK_RECORDS = 100;

interface NetworkRecord {
  readonly method: string;
  readonly path: string;
  readonly status: number | null;
  readonly requestBodySha256: string | null;
  readonly requestBodyExcerpt: string | null;
  readonly requestFacts: readonly string[];
  readonly responseBodySha256: string | null;
  readonly responseBodyExcerpt: string | null;
  readonly sessionId: string | null;
  readonly selectedModel: string | null;
  readonly runId: string | null;
  readonly accepted: boolean | null;
  readonly replayed: boolean | null;
}

interface AcceptedMessageRun {
  readonly sessionId: string;
  readonly runId: string;
}

export interface PackagedParityUiAuthority {
  readonly garden: GardenInfo;
  readonly quartzDocumentTitle: string;
}

type PreparedTurn =
  | {
      readonly kind: "dashboard" | "garden" | "legacy-garden";
      readonly beforeActions: number;
      readonly beforeAlerts: number;
    }
  | {
      readonly kind: "quartz";
      readonly beforeAssistantMessages: number;
    };

export interface PackagedParityWorkflowOutcome {
  readonly capabilityId: string;
  readonly uiEntryPoint: string;
  readonly result: "PASS" | "BLOCKED" | "FAIL";
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly workflowIdentity: {
    readonly electronRunId: string;
    readonly workflowId: string;
    readonly conversationIdSha256: string;
  };
  readonly artifactPath: string;
  readonly claims?: {
    readonly electron: Record<string, unknown>;
    readonly service: readonly Record<string, unknown>[];
    readonly worker: readonly Record<string, unknown>[];
    readonly output: Record<string, unknown>;
    readonly cancellation: Record<string, unknown>;
    readonly recovery: Record<string, unknown>;
  };
  readonly blocker?: {
    readonly prerequisiteType: string;
    readonly prerequisiteId: string;
    readonly code: string;
    readonly summary: string;
  };
  readonly baselineBlockerAuthority?: null;
  readonly failure?: { readonly code: string; readonly summary: string };
}

class NetworkWitness {
  readonly records: NetworkRecord[] = [];
  private readonly requests = new Map<Request, NetworkRecord>();
  private readonly pendingResponses = new Set<Promise<void>>();
  private sessionId: string | null = null;

  constructor(private readonly page: Page) {
    page.on("request", this.onRequest);
    page.on("response", this.onResponse);
  }

  stop(): void {
    this.page.off("request", this.onRequest);
    this.page.off("response", this.onResponse);
  }

  conversationId(): string {
    if (!this.sessionId) throw new Error("A normal packaged UI request produced no exact conversation/session identity.");
    return this.sessionId;
  }

  cursor(): number {
    return this.records.length;
  }

  conversationIdsSince(cursor: number): readonly string[] {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.records.length) {
      throw new Error("Network witness cursor is outside the recorded request range.");
    }
    return Object.freeze(
      this.records.slice(cursor).flatMap(({ sessionId }) => sessionId ? [sessionId] : []),
    );
  }

  messageDispatchCountSince(cursor: number): number {
    return this.messageDispatchesSince(cursor).length;
  }

  messageDispatchesSince(cursor: number): readonly NetworkRecord[] {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.records.length) {
      throw new Error("Network witness cursor is outside the recorded request range.");
    }
    return Object.freeze(this.records.slice(cursor).filter(({ method, path: requestPath }) =>
      method === "POST" && /^\/api\/hermes\/sessions\/[^/]+\/messages$/u.test(requestPath)));
  }

  requestUsedModelSince(cursor: number, model: string): boolean {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.records.length) {
      throw new Error("Network witness cursor is outside the recorded request range.");
    }
    return this.records.slice(cursor).some(({ selectedModel }) => selectedModel === model);
  }

  async settle(): Promise<void> {
    await Promise.all([...this.pendingResponses]);
  }

  requestContains(value: string): boolean {
    return this.records.some(({ requestBodyExcerpt }) => requestBodyExcerpt?.includes(value));
  }

  requestContainsSince(cursor: number, value: string): boolean {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.records.length) {
      throw new Error("Network witness cursor is outside the recorded request range.");
    }
    return this.records.slice(cursor).some(({ requestBodyExcerpt }) => requestBodyExcerpt?.includes(value));
  }

  responseContains(value: string): boolean {
    return this.records.some(({ responseBodyExcerpt }) => responseBodyExcerpt?.includes(value));
  }

  responseContainsSince(cursor: number, value: string): boolean {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.records.length) {
      throw new Error("Network witness cursor is outside the recorded request range.");
    }
    return this.records.slice(cursor).some(({ responseBodyExcerpt }) => responseBodyExcerpt?.includes(value));
  }

  responseMatches(pattern: RegExp): boolean {
    return this.records.some(({ responseBodyExcerpt }) => responseBodyExcerpt !== null && pattern.test(responseBodyExcerpt));
  }

  requestPathMatches(pattern: RegExp): boolean {
    return this.records.some(({ path }) => pattern.test(path));
  }

  requestHasFact(fact: string): boolean {
    return this.records.some(({ requestFacts }) => requestFacts.includes(fact));
  }

  private readonly onRequest = (request: Request): void => {
    if (this.records.length >= MAX_NETWORK_RECORDS || !/^(?:POST|PATCH|DELETE)$/u.test(request.method())) return;
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return;
    const session = /\/api\/hermes\/sessions\/([^/]+)/u.exec(url.pathname)?.[1]
      ?? /\/api\/chat-sessions\/([^/]+)/u.exec(url.pathname)?.[1]
      ?? null;
    const pathSession = session ? decodeURIComponent(session) : null;
    if (pathSession) this.sessionId = pathSession;
    const body = request.postData();
    const parsedBody = parseJsonRecord(body);
    const requestFacts = requestFactsFor(parsedBody);
    const bodySession = stringOrNumberId(parsedBody?.sessionId)
      ?? stringOrNumberId(parsedBody?.chatSessionId);
    const selectedModel = typeof parsedBody?.model === "string" && parsedBody.model.trim()
      ? parsedBody.model
      : null;
    if (bodySession) this.sessionId = bodySession;
    const record: NetworkRecord = {
      method: request.method(),
      path: url.pathname,
      status: null,
      requestBodySha256: body ? sha256(body) : null,
      requestBodyExcerpt: body ? redact(body).slice(0, 1_000) : null,
      requestFacts,
      responseBodySha256: null,
      responseBodyExcerpt: null,
      sessionId: pathSession ?? bodySession,
      selectedModel,
      runId: null,
      accepted: null,
      replayed: null,
    };
    this.records.push(record);
    this.requests.set(request, record);
  };

  private readonly onResponse = (response: Response): void => {
    const record = this.requests.get(response.request());
    if (!record) return;
    (record as { status: number | null }).status = response.status();
    const pending = response.text()
      .then((body) => {
        (record as { responseBodySha256: string | null }).responseBodySha256 = body ? sha256(body) : null;
        const safe = body ? redact(body) : "";
        (record as { responseBodyExcerpt: string | null }).responseBodyExcerpt = safe
          ? safe.length <= 16_000
            ? safe
            : `${safe.slice(0, 8_000)}\n[RESPONSE-MIDDLE-OMITTED]\n${safe.slice(-8_000)}`
          : null;
        const parsedResponse = parseJsonRecord(body);
        const responseSession = stringOrNumberId(parsedResponse?.sessionId)
          ?? stringOrNumberId(parsedResponse?.conversationId);
        if (responseSession) {
          this.sessionId = responseSession;
          (record as { sessionId: string | null }).sessionId = responseSession;
        }
        (record as { runId: string | null }).runId = stringOrNumberId(parsedResponse?.runId);
        (record as { accepted: boolean | null }).accepted = typeof parsedResponse?.accepted === "boolean"
          ? parsedResponse.accepted
          : null;
        (record as { replayed: boolean | null }).replayed = typeof parsedResponse?.replayed === "boolean"
          ? parsedResponse.replayed
          : null;
      })
      .catch(() => undefined)
      .then(() => undefined);
    this.pendingResponses.add(pending);
    void pending.finally(() => this.pendingResponses.delete(pending));
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").toUpperCase();
}

function redact(value: string): string {
  return value
    .replace(/("(?:token|secret|password|authorization|cookie|api[_-]?key)"\s*:\s*")[^"]+/giu, "$1[REDACTED]")
    .replace(/(?:Bearer\s+)[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/gu, "[REDACTED-JWT]");
}

function parseJsonRecord(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function stringOrNumberId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}

function requestFactsFor(body: Record<string, unknown> | null): readonly string[] {
  if (!body) return Object.freeze([]);
  const facts: string[] = [];
  if (body.temporary === true) facts.push("temporary:true");
  if (Object.hasOwn(body, "clusterSlug")) facts.push("clusterSlug:present");
  if (Object.hasOwn(body, "activeMarkdown")) facts.push("activeMarkdown:present");
  if (Object.hasOwn(body, "selectedDocumentSlugs")) facts.push("selectedDocumentSlugs:present");
  if (body.prepareOnly === true) facts.push("prepareOnly:true");
  const context = body.context;
  if (context !== null && typeof context === "object" && !Array.isArray(context)) {
    if (Object.hasOwn(context, "gardenId")) facts.push("context.gardenId:present");
    if (Object.hasOwn(context, "pageSlug")) facts.push("context.pageSlug:present");
  }
  return Object.freeze(facts.sort());
}

function safeName(value: string): string {
  return `${value.replace(/[^A-Za-z0-9._-]+/gu, "-").slice(0, 96)}-${sha256(value).slice(0, 16)}`;
}

function relativeEvidencePath(repoRoot: string, file: string): string {
  const relative = path.relative(repoRoot, file).split(path.sep).join("/");
  if (!relative.startsWith(".qa-results/")) throw new Error(`Parity workflow artifact escaped .qa-results: ${relative}`);
  return relative;
}

function immutableJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function fixtureFor(repoRoot: string, capabilityId: string): string {
  const candidates: Record<string, string> = {
    "attachment:audio": "scriberr/tests/data/AMI-Corpus-IB4002.Mix-Headset-clip.wav",
    "attachment:document": "OfficeCLI/assets/showcase/restaurant-menu.docx",
    "attachment:image": "qa/runtime-v2/evidence/baseline-installed-2026-08-24T20-09-33-083Z/01-startup.png",
    "attachment:model": "OfficeCLI/examples/ppt/models/sun.glb",
    "attachment:text": "qa/fixtures/orchard-notes.txt",
    "attachment:video": "dashboard/Video Project 6.mp4",
    "runtime-agent:formsmith": "qa/runtime-v2/evidence/baseline-installed-2026-08-24T20-09-33-083Z/01-startup.png",
    "runtime-agent:shorts": "dashboard/Video Project 6.mp4",
  };
  const relative = candidates[capabilityId];
  if (!relative) throw new Error(`${capabilityId} has no allowlisted real input fixture.`);
  const file = path.join(repoRoot, ...relative.split("/"));
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error(`${capabilityId} input fixture is missing: ${file}`);
  return file;
}

async function terminalComposer(page: Page) {
  await assertAuthenticatedDashboard(page, undefined, ACTION_TIMEOUT_MS);
  await openTerminal(page, ACTION_TIMEOUT_MS);
  const composer = page.getByPlaceholder(/Ask anything across your gardens/).last();
  await expect(composer).toBeEditable({ timeout: ACTION_TIMEOUT_MS });
  return composer;
}

function surfaceKind(plan: PackagedParityPlan): PreparedTurn["kind"] {
  switch (plan.capabilityId) {
    case "surface:dashboard-terminal": return "dashboard";
    case "surface:garden-chat": return "garden";
    case "surface:legacy-garden-chat": return "legacy-garden";
    case "surface:quartz-ai": return "quartz";
    case "surface:temporary-chat": return "dashboard";
    default: throw new Error(`Unknown packaged chat-surface capability ${plan.capabilityId}.`);
  }
}

async function dashboardPage(page: Page): Promise<void> {
  if (new URL(page.url()).pathname !== "/dashboard") {
    await page.goto(new URL("/dashboard", page.url()).toString(), {
      waitUntil: "domcontentloaded",
      timeout: ACTION_TIMEOUT_MS,
    });
  }
  await assertAuthenticatedDashboard(page, undefined, ACTION_TIMEOUT_MS);
}

async function openGardenDocument(
  page: Page,
  authority: PackagedParityUiAuthority,
): Promise<void> {
  await openGardenWorkspace(page, authority.garden, ACTION_TIMEOUT_MS);
  const documentLink = page.getByRole("link", {
    name: authority.quartzDocumentTitle,
    exact: true,
  }).first();
  await expect(documentLink).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  await Promise.all([
    page.waitForURL((url) => url.pathname === `/garden/${authority.garden.slug}`, {
      timeout: ACTION_TIMEOUT_MS,
    }),
    documentLink.click(),
  ]);
  await expect(page.getByRole("link", { name: /Back to garden/ })).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
}

async function gardenComposer(page: Page, authority: PackagedParityUiAuthority) {
  await openGardenWorkspace(page, authority.garden, ACTION_TIMEOUT_MS);
  const composer = page.getByPlaceholder(/Ask about your documents/).last();
  await expect(composer).toBeEditable({ timeout: ACTION_TIMEOUT_MS });
  return composer;
}

async function legacyGardenComposer(page: Page, authority: PackagedParityUiAuthority) {
  await openGardenDocument(page, authority);
  const composer = page.getByPlaceholder(/Ask about a topic, page, source, or link/).last();
  if (!(await composer.isVisible().catch(() => false))) {
    const assistant = page.getByRole("button", { name: "Assistant", exact: true }).last();
    await expect(assistant).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
    await assistant.click();
  }
  await expect(composer).toBeEditable({ timeout: ACTION_TIMEOUT_MS });
  return composer;
}

async function quartzAssistant(
  page: Page,
  authority: PackagedParityUiAuthority,
): Promise<FrameLocator> {
  await openGardenDocument(page, authority);
  const frame = page.frameLocator(`iframe[title="${escapeCssString(`${authority.garden.name} garden`)}"]`);
  const open = frame.getByRole("button", { name: "Open Assistant for this page", exact: true });
  await expect(open).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  await open.click();
  await expect(frame.getByRole("dialog", { name: "Assistant", exact: true })).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  await expect(frame.getByRole("textbox", { name: "Ask about this page", exact: true })).toBeEditable({ timeout: ACTION_TIMEOUT_MS });
  return frame;
}

async function temporaryTerminalComposer(page: Page) {
  await dashboardPage(page);
  await openTerminal(page, ACTION_TIMEOUT_MS);
  const enabled = page.getByRole("status").filter({ hasText: "Temporary chat enabled" }).last();
  if (!(await enabled.isVisible().catch(() => false))) {
    let toggle = page.getByRole("button", { name: "Turn on temporary chat", exact: true }).last();
    if (!(await toggle.isVisible().catch(() => false))) {
      const newChat = page.getByRole("button", { name: "New chat", exact: true }).last();
      await expect(newChat).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
      await newChat.click();
      toggle = page.getByRole("button", { name: "Turn on temporary chat", exact: true }).last();
    }
    await expect(toggle).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
    await toggle.click();
  }
  await expect(enabled).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  const composer = page.getByPlaceholder(/Ask anything across your gardens/).last();
  await expect(composer).toBeEditable({ timeout: ACTION_TIMEOUT_MS });
  return composer;
}

async function selectSlash(page: Page, plan: PackagedParityPlan): Promise<void> {
  if (plan.driver.kind !== "slash") throw new Error(`${plan.capabilityId} is not slash-selectable.`);
  const composer = await terminalComposer(page);
  await composer.fill(plan.driver.slashCommand);
  const menu = page.getByRole("listbox", { name: "Available capabilities", exact: true });
  await expect(menu).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  const option = menu.getByRole("button").filter({ hasText: plan.driver.slashCommand }).first();
  await expect(option).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  await option.click();

  if (["runtime-agent:trading-agent", "runtime-agent:shorts", "runtime-agent:formsmith"].includes(plan.capabilityId)) {
    await expect(page.getByRole("button", { name: new RegExp(`^Clear ${escapeRegex(plan.displayName)}`, "i") })).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
    return;
  }
  await expect(composer).toHaveValue(new RegExp(`^${escapeRegex(plan.driver.slashCommand)}\\s`, "u"), { timeout: ACTION_TIMEOUT_MS });
}

async function openSettings(page: Page, tab: "Accounts" | "Connections" | "MCP"): Promise<ReturnType<Page["getByRole"]>> {
  const intelligence = page.getByTitle(/reasoning/i).last();
  await expect(intelligence).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  await intelligence.click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  const tabButton = dialog.getByRole("tab", { name: tab, exact: true });
  await expect(tabButton).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  await tabButton.click();
  await expect(tabButton).toHaveAttribute("aria-selected", "true");
  return dialog;
}

async function closeSettings(page: Page): Promise<void> {
  const close = page.getByRole("button", { name: /Close settings/i }).last();
  if (await close.isVisible().catch(() => false)) await close.click();
  else await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeHidden({ timeout: 30_000 });
}

async function selectNonSlash(page: Page, plan: PackagedParityPlan): Promise<{ exactSelectionText: string }> {
  switch (plan.driver.kind) {
    case "connection":
    case "connection-catalog": {
      const dialog = await openSettings(page, plan.capabilityId === "connection-catalog:mcp" ? "MCP" : "Connections");
      const exact = dialog.getByText(plan.displayName, { exact: true }).first();
      await expect(exact).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
      await closeSettings(page);
      return { exactSelectionText: plan.displayName };
    }
    case "provider": {
      const dialog = await openSettings(page, "Accounts");
      const exact = dialog.getByText(plan.displayName, { exact: true }).first();
      await expect(exact).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
      await closeSettings(page);
      return { exactSelectionText: plan.displayName };
    }
    case "model": {
      const intelligence = page.getByTitle(/reasoning/i).last();
      await expect(intelligence).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
      await intelligence.click();
      const exact = page.getByRole("button", {
        name: new RegExp(`^${escapeRegex(plan.displayName)}$`, "iu"),
      }).last();
      await expect(exact).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
      await exact.click();
      await expect(page.getByTitle(new RegExp(escapeRegex(plan.displayName), "i")).last()).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
      await page.getByRole("button", { name: "Close intelligence menu", exact: true }).click();
      return { exactSelectionText: plan.displayName };
    }
    case "profile": {
      await page.getByRole("link", { name: /Profile/i }).first().click();
      await expect(page.getByText("Location", { exact: true }).first()).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
      const enable = page.getByRole("button", { name: "Enable", exact: true });
      if (await enable.isVisible().catch(() => false)) await enable.click();
      await expect(page.getByRole("status").filter({ hasText: /Available|Location unavailable|Location access is blocked/i }).first()).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
      await page.getByRole("link", { name: /Dashboard|Gardens/i }).first().click();
      await assertAuthenticatedDashboard(page, undefined, ACTION_TIMEOUT_MS);
      return { exactSelectionText: "Location" };
    }
    default:
      // These capabilities are selected by their real user intent, then must
      // be corroborated by the response evidence panel below. Merely placing
      // the capability ID in a prompt is never accepted as selection proof.
      await terminalComposer(page);
      return { exactSelectionText: plan.displayName };
  }
}

function promptFor(plan: PackagedParityPlan, marker: string, cancellation = false): string {
  const duration = cancellation
    ? "Keep the real operation running long enough for me to use the visible Stop control; do not answer immediately."
    : `Finish by writing the exact marker ${marker}.`;
  switch (plan.driver.kind) {
    case "artifact":
      return `Use the normal artifact tools to create a real ${plan.output.expectedType} artifact with non-placeholder content about orchard planning. Openable output is required. ${duration}`;
    case "attachment":
      return `Use and inspect the attached ${plan.displayName} through its normal product path. State one concrete property derived from the file. ${duration}`;
    case "approval":
      return `Start the normal ${plan.displayName} operation and request its real sensitive-action approval in the UI. Do not assume or bypass approval. ${duration}`;
    case "connection":
    case "connection-catalog":
      return `Use the exact ${plan.displayName} connection through its normal connection-backed action now; do not substitute another connection. ${duration}`;
    case "provider":
    case "model":
      return `Answer through the exact selected ${plan.displayName} path and do not fall back to another provider or model. ${duration}`;
    case "profile":
      return `Use the current device location profile through its normal product path and state its truthful availability. ${duration}`;
    case "recovery":
    case "repository":
      return `Exercise the exact ${plan.displayName} operation on the isolated QA workspace through its normal UI, retaining its durable identity for refresh recovery. ${duration}`;
    case "registry":
      return `Exercise the exact ${plan.displayName} registry entry through the normal visible product path and report the selected entry. ${duration}`;
    case "surface":
      return `Exercise this exact ${plan.displayName} chat surface with a real request. ${duration}`;
    case "tool":
    case "workflow":
      return `Use the exact Breadboard capability ${plan.displayName} now through its normal product intent. This must be a real invocation, not a description. ${duration}`;
    case "slash":
      return `Exercise the selected ${plan.displayName} capability on a harmless orchard-planning request. ${duration}`;
  }
}

async function attachFixture(page: Page, plan: PackagedParityPlan, repoRoot: string): Promise<void> {
  const file = fixtureFor(repoRoot, plan.capabilityId);
  const add = page.getByRole("button", { name: "Add documents", exact: true }).last();
  await expect(add).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  const chooser = page.waitForEvent("filechooser", { timeout: ACTION_TIMEOUT_MS });
  await add.click();
  (await chooser).setFiles(file);
  await expect(page.getByText(path.basename(file), { exact: true }).last()).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
}

async function fillStructuredAgent(page: Page, plan: PackagedParityPlan, repoRoot: string): Promise<void> {
  if (plan.capabilityId === "runtime-agent:trading-agent") {
    const ticker = page.getByPlaceholder(/NVDA|BTC-USD/).first();
    await expect(ticker).toBeEditable({ timeout: ACTION_TIMEOUT_MS });
    await ticker.fill("NVDA");
    return;
  }
  const file = fixtureFor(repoRoot, plan.capabilityId);
  const input = page.locator('input[type="file"]').last();
  await expect(input).toBeAttached({ timeout: ACTION_TIMEOUT_MS });
  await input.setInputFiles(file);
  await expect(page.getByText(path.basename(file), { exact: true }).last()).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
}

async function prepareSurfaceAndSubmit(
  page: Page,
  plan: PackagedParityPlan,
  authority: PackagedParityUiAuthority,
  marker: string,
  cancellation: boolean,
): Promise<PreparedTurn> {
  const prompt = promptFor(plan, marker, cancellation);
  const kind = surfaceKind(plan);
  if (kind === "quartz") {
    const frame = await quartzAssistant(page, authority);
    const beforeAssistantMessages = await frame.locator(".breadboard-ai-assistant").count();
    const composer = frame.getByRole("textbox", { name: "Ask about this page", exact: true });
    await composer.fill(prompt);
    const send = frame.getByRole("button", { name: "Send", exact: true });
    await expect(send).toBeEnabled({ timeout: ACTION_TIMEOUT_MS });
    await send.click();
    return { kind, beforeAssistantMessages };
  }

  const composer = plan.capabilityId === "surface:garden-chat"
    ? await gardenComposer(page, authority)
    : plan.capabilityId === "surface:legacy-garden-chat"
      ? await legacyGardenComposer(page, authority)
      : plan.capabilityId === "surface:temporary-chat"
        ? await temporaryTerminalComposer(page)
        : await terminalComposer(page);
  const beforeActions = await page.getByRole("button", { name: "More response actions", exact: true }).count();
  const beforeAlerts = await page.getByRole("alert").count();
  await composer.fill(prompt);
  const send = page.getByRole("button", { name: "Send", exact: true }).last();
  await expect(send).toBeEnabled({ timeout: ACTION_TIMEOUT_MS });
  await send.click();
  return { kind, beforeActions, beforeAlerts };
}

async function prepareAndSubmit(
  page: Page,
  plan: PackagedParityPlan,
  repoRoot: string,
  uiAuthority: PackagedParityUiAuthority,
  marker: string,
  cancellation = false,
): Promise<PreparedTurn> {
  if (plan.driver.kind === "surface") {
    return prepareSurfaceAndSubmit(page, plan, uiAuthority, marker, cancellation);
  }
  if (plan.driver.kind === "slash") await selectSlash(page, plan);
  else await selectNonSlash(page, plan);

  if (plan.category === "attachment") await attachFixture(page, plan, repoRoot);
  if (["runtime-agent:trading-agent", "runtime-agent:shorts", "runtime-agent:formsmith"].includes(plan.capabilityId)) {
    await fillStructuredAgent(page, plan, repoRoot);
  } else {
    const composer = await terminalComposer(page);
    const prefix = plan.driver.kind === "slash" ? await composer.inputValue() : "";
    await composer.fill(`${prefix}${promptFor(plan, marker, cancellation)}`);
  }
  const beforeActions = await page.getByRole("button", { name: "More response actions", exact: true }).count();
  const beforeAlerts = await page.getByRole("alert").count();
  const send = page.getByRole("button", { name: /^(?:Send|Reconstruct the picture)$/ }).last();
  await expect(send).toBeEnabled({ timeout: ACTION_TIMEOUT_MS });
  await send.click();
  return { kind: "dashboard", beforeActions, beforeAlerts };
}

async function submitFollowUp(
  page: Page,
  prepared: PreparedTurn,
  uiAuthority: PackagedParityUiAuthority,
  marker: string,
): Promise<PreparedTurn> {
  const prompt =
    "This is a real second turn in the same live context. Repeat the exact completion marker from your immediately preceding answer without starting a new topic or changing the selected capability. " +
    `Then finish by writing the exact marker ${marker}.`;
  if (prepared.kind === "quartz") {
    const frame = page.frameLocator(`iframe[title="${escapeCssString(`${uiAuthority.garden.name} garden`)}"]`);
    const composer = frame.getByRole("textbox", { name: "Ask about this page", exact: true });
    await expect(composer).toBeEditable({ timeout: ACTION_TIMEOUT_MS });
    const beforeAssistantMessages = await frame.locator(".breadboard-ai-assistant").count();
    await composer.fill(prompt);
    const send = frame.getByRole("button", { name: "Send", exact: true });
    await expect(send).toBeEnabled({ timeout: ACTION_TIMEOUT_MS });
    await send.click();
    return { kind: "quartz", beforeAssistantMessages };
  }

  const composer = prepared.kind === "garden"
    ? page.getByPlaceholder(/Ask about your documents/).last()
    : prepared.kind === "legacy-garden"
      ? page.getByPlaceholder(/Ask about a topic, page, source, or link/).last()
      : await terminalComposer(page);
  await expect(composer).toBeEditable({ timeout: ACTION_TIMEOUT_MS });
  const beforeActions = await page.getByRole("button", { name: "More response actions", exact: true }).count();
  const beforeAlerts = await page.getByRole("alert").count();
  await composer.fill(prompt);
  const send = page.getByRole("button", { name: "Send", exact: true }).last();
  await expect(send).toBeEnabled({ timeout: ACTION_TIMEOUT_MS });
  await send.click();
  return { kind: prepared.kind, beforeActions, beforeAlerts };
}

async function submitDashboardRecoveryTurn(
  page: Page,
  prompt: string,
  personaPlan: PackagedParityPlan | null,
): Promise<PreparedTurn> {
  if (personaPlan) await selectSlash(page, personaPlan);
  const composer = await terminalComposer(page);
  const prefix = personaPlan ? await composer.inputValue() : "";
  const beforeActions = await page.getByRole("button", { name: "More response actions", exact: true }).count();
  const beforeAlerts = await page.getByRole("alert").count();
  await composer.fill(`${prefix}${prompt}`);
  const send = page.getByRole("button", { name: "Send", exact: true }).last();
  await expect(send).toBeEnabled({ timeout: ACTION_TIMEOUT_MS });
  await send.click();
  return { kind: "dashboard", beforeActions, beforeAlerts };
}

async function exerciseFollowUp(
  page: Page,
  prepared: PreparedTurn,
  uiAuthority: PackagedParityUiAuthority,
  witness: NetworkWitness,
  primaryMarker: string,
  followUpMarker: string,
): Promise<{ sameConversationObserved: true; priorContextObserved: true; outputSha256: string }> {
  const primaryConversationId = witness.conversationId();
  const cursor = witness.cursor();
  const followUpPrepared = await submitFollowUp(page, prepared, uiAuthority, followUpMarker);
  const followUp = await waitForTurn(page, followUpPrepared, followUpMarker, uiAuthority);
  await witness.settle();
  if (followUp.errorText) {
    throw new Error(`The real packaged follow-up failed visibly: ${redact(followUp.errorText).slice(0, 500)}`);
  }
  if (!followUp.outputText.includes(primaryMarker) || !followUp.outputText.includes(followUpMarker)) {
    throw new Error("The real second turn did not preserve the preceding answer's exact completion marker.");
  }
  const followUpConversationIds = witness.conversationIdsSince(cursor);
  if (
    followUpConversationIds.length === 0 ||
    followUpConversationIds.some((conversationId) => conversationId !== primaryConversationId) ||
    witness.conversationId() !== primaryConversationId
  ) {
    throw new Error("The real second turn did not remain bound to one exact conversation/session identity.");
  }
  return {
    sameConversationObserved: true,
    priorContextObserved: true,
    outputSha256: sha256(followUp.outputText),
  };
}

async function waitForTurn(
  page: Page,
  prepared: PreparedTurn,
  marker: string,
  uiAuthority: PackagedParityUiAuthority,
): Promise<{ outputText: string; errorText: string }> {
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  let outputText = "";
  let errorText = "";
  while (Date.now() < deadline) {
    if (prepared.kind === "quartz") {
      const frame = page.frameLocator(`iframe[title="${escapeCssString(`${uiAuthority.garden.name} garden`)}"]`);
      const assistants = frame.locator(".breadboard-ai-assistant");
      const count = await assistants.count();
      outputText = count > prepared.beforeAssistantMessages
        ? await assistants.last().innerText().catch(() => "")
        : "";
      errorText = await frame.locator(".breadboard-ai-error:not([hidden])").innerText().catch(() => "");
      const stopVisible = await frame.getByRole("button", { name: "Stop", exact: true }).isVisible().catch(() => false);
      if (count > prepared.beforeAssistantMessages && outputText.trim() && !stopVisible) return { outputText, errorText };
      if (errorText && !stopVisible) return { outputText, errorText };
    } else {
      const actions = await page.getByRole("button", { name: "More response actions", exact: true }).count();
      outputText = await page.locator('div[class~="text-gray-200"]').last().innerText().catch(() => "");
      errorText = (await page.getByRole("alert").allTextContents().catch(() => [])).slice(prepared.beforeAlerts).join(" ").trim();
      const stopVisible = await page.getByRole("button", { name: "Stop active run", exact: true }).last().isVisible().catch(() => false);
      if (actions > prepared.beforeActions && outputText.trim() && !stopVisible) return { outputText, errorText };
      if (errorText && !stopVisible) return { outputText, errorText };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Packaged workflow did not reach a visible terminal result containing ${marker}.`);
}

async function observeSelectionEvidence(page: Page, plan: PackagedParityPlan, witness: NetworkWitness): Promise<string> {
  if (plan.driver.kind === "surface") {
    const messageRoute = /^\/api\/hermes\/sessions\/[^/]+\/messages$/u;
    let transportObserved = false;
    let surfaceFact = "";
    switch (plan.capabilityId) {
      case "surface:dashboard-terminal":
        transportObserved = witness.requestPathMatches(messageRoute);
        surfaceFact = "dashboard terminal Hermes message route";
        break;
      case "surface:garden-chat":
        transportObserved = witness.requestPathMatches(/^\/api\/chat$/u) &&
          witness.requestHasFact("selectedDocumentSlugs:present");
        surfaceFact = "Garden workspace chat request with selectedDocumentSlugs";
        break;
      case "surface:legacy-garden-chat":
        transportObserved = witness.requestPathMatches(/^\/api\/chat$/u) &&
          witness.requestHasFact("activeMarkdown:present");
        surfaceFact = "legacy embedded Garden request with activeMarkdown";
        break;
      case "surface:quartz-ai":
        transportObserved = witness.requestPathMatches(/^\/api\/quartz-ai\/chat$/u) &&
          witness.requestHasFact("prepareOnly:true") &&
          witness.requestHasFact("context.gardenId:present") &&
          witness.requestHasFact("context.pageSlug:present");
        surfaceFact = "published Quartz frame prepare/dispatch request with page context";
        break;
      case "surface:temporary-chat":
        transportObserved = witness.requestPathMatches(messageRoute) && witness.requestHasFact("temporary:true");
        surfaceFact = "temporary conversation creation plus Hermes message route";
        break;
      default:
        throw new Error(`Unknown packaged chat-surface capability ${plan.capabilityId}.`);
    }
    if (!transportObserved) {
      throw new Error(`${plan.capabilityId} did not emit its exact real packaged surface transport.`);
    }
    return JSON.stringify({ capabilityId: plan.capabilityId, surfaceFact, transportObserved: true });
  }
  const action = page.getByRole("button", { name: "More response actions", exact: true }).last();
  await expect(action).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  await action.click();
  await page.getByRole("button", { name: "View evidence", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Response evidence", exact: true });
  await expect(dialog).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  const body = await dialog.innerText();
  const needles = [
    plan.displayName,
    plan.capabilityId,
    plan.driver.kind === "slash" ? plan.driver.slashCommand : "",
  ].filter(Boolean);
  if (!needles.some((needle) => body.toLocaleLowerCase().includes(needle.toLocaleLowerCase()))) {
    throw new Error(`${plan.capabilityId} is absent from the real response capability ledger.`);
  }
  if (plan.driver.kind === "slash") {
    if (!witness.requestContains(plan.driver.slashCommand)) {
      throw new Error(`${plan.capabilityId} exact selected slash command is absent from the real request.`);
    }
  } else {
    const exactCapabilityIdentity = witness.responseContains(plan.capabilityId);
    const exactArtifactIdentity = plan.category === "artifact-type" &&
      witness.responseMatches(new RegExp(`\"kind\"\\s*:\\s*\"${escapeRegex(plan.output.expectedType)}\"`, "u"));
    if (!exactCapabilityIdentity && !exactArtifactIdentity) {
      throw new Error(`${plan.capabilityId} stable identity is absent from the real packaged response/verification stream.`);
    }
  }
  await dialog.getByRole("button", { name: "Close evidence", exact: true }).click();
  return body.slice(0, 4_000);
}

async function observeOpenOutput(
  page: Page,
  plan: PackagedParityPlan,
  outputText: string,
  marker: string,
  witness: NetworkWitness,
): Promise<{ outputId: string; openBehaviorObserved: true; artifactContext: string | null }> {
  const substantive = outputText.replaceAll(marker, "").trim();
  if (substantive.length < 20) {
    throw new Error(`${plan.capabilityId} produced only a marker or placeholder-sized result.`);
  }
  if (plan.output.requiresOpenArtifact) {
    if (
      !witness.responseMatches(new RegExp(`\"kind\"\\s*:\\s*\"${escapeRegex(plan.output.expectedType)}\"`, "u")) &&
      !witness.responseMatches(new RegExp(`\"artifactType\"\\s*:\\s*\"${escapeRegex(plan.output.expectedType)}\"`, "u"))
    ) {
      throw new Error(`${plan.capabilityId} response stream lacks its exact artifact type identity.`);
    }
    const artifactContext = await openLatestArtifactContext(page, plan);
    return { outputId: `${outputText}\n${artifactContext}`, openBehaviorObserved: true, artifactContext };
  }
  if (!outputText.trim()) throw new Error(`${plan.capabilityId} produced no visible output.`);
  return { outputId: outputText, openBehaviorObserved: true, artifactContext: null };
}

async function openLatestArtifactContext(page: Page, plan: PackagedParityPlan): Promise<string> {
  const card = page.locator(".bb-neu-artifact-card").last();
  await expect(card).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  const cardText = (await card.innerText()).trim();
  if (!cardText) throw new Error(`${plan.capabilityId} artifact card was empty.`);
  const open = card.locator('button[title^="Open "]').first();
  await expect(open).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  await open.click();
  const dock = page.locator(".bb-artifact-dock").last();
  await expect(dock).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  const viewerText = (await dock.innerText()).trim();
  if (!viewerText) throw new Error(`${plan.capabilityId} artifact viewer was empty.`);
  await page.getByRole("button", { name: "Close artifact", exact: true }).click();
  return JSON.stringify({ cardText, viewerText });
}

async function exerciseCancellation(
  page: Page,
  plan: PackagedParityPlan,
  repoRoot: string,
  uiAuthority: PackagedParityUiAuthority,
  marker: string,
): Promise<{ requested: true; terminalVisible: true; controlCleared: true }> {
  const beforeText = await page.locator('div[class~="text-gray-200"]').last().innerText().catch(() => "");
  const prepared = await prepareAndSubmit(page, plan, repoRoot, uiAuthority, marker, true);
  if (prepared.kind === "quartz") {
    const frame = page.frameLocator(`iframe[title="${escapeCssString(`${uiAuthority.garden.name} garden`)}"]`);
    const stop = frame.getByRole("button", { name: "Stop", exact: true });
    await expect(stop).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
    await stop.click();
    await expect(stop).toBeHidden({ timeout: ACTION_TIMEOUT_MS });
    await expect(frame.getByRole("textbox", { name: "Ask about this page", exact: true })).toBeEditable({ timeout: ACTION_TIMEOUT_MS });
    await expect(frame.locator(".breadboard-ai-activity-title")).toHaveText("Cancelled", { timeout: ACTION_TIMEOUT_MS });
    const assistants = frame.locator(".breadboard-ai-assistant");
    if (await assistants.count() <= prepared.beforeAssistantMessages) {
      throw new Error(`${plan.capabilityId} cancellation left no new visible Quartz assistant state.`);
    }
    return { requested: true, terminalVisible: true, controlCleared: true };
  }
  const { beforeActions, beforeAlerts } = prepared;
  const stop = page.getByRole("button", { name: "Stop active run", exact: true }).last();
  await expect(stop).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  await stop.click();
  await expect(stop).toBeHidden({ timeout: ACTION_TIMEOUT_MS });
  const composer = prepared.kind === "garden"
    ? page.getByPlaceholder(/Ask about your documents/).last()
    : prepared.kind === "legacy-garden"
      ? page.getByPlaceholder(/Ask about a topic, page, source, or link/).last()
      : page.getByPlaceholder(/Ask anything across your gardens/).last();
  await expect(composer).toBeEditable({ timeout: ACTION_TIMEOUT_MS });
  const newAlerts = (await page.getByRole("alert").allTextContents().catch(() => [])).slice(beforeAlerts).join(" ").trim();
  const afterText = await page.locator('div[class~="text-gray-200"]').last().innerText().catch(() => "");
  const actionCount = await page.getByRole("button", { name: "More response actions", exact: true }).count();
  if (actionCount < beforeActions) throw new Error(`${plan.capabilityId} cancellation removed prior durable output.`);
  if (!newAlerts && afterText === beforeText && actionCount === beforeActions) {
    throw new Error(`${plan.capabilityId} cancellation left no new visible terminal state.`);
  }
  return { requested: true, terminalVisible: true, controlCleared: true };
}

async function assertRecovery(
  page: Page,
  plan: PackagedParityPlan,
  uiAuthority: PackagedParityUiAuthority,
  marker: string,
  before: RuntimeParitySnapshot,
  after: RuntimeParitySnapshot,
): Promise<void> {
  const oldIds = new Set(before.jobs.map(({ jobId }) => jobId));
  const unexpected = after.jobs.filter(({ jobId }) => !oldIds.has(jobId));
  if (unexpected.length !== 0) throw new Error(`${plan.capabilityId} refresh duplicated ${unexpected.length} Runtime job(s).`);
  if (plan.driver.kind === "surface") {
    switch (plan.capabilityId) {
      case "surface:dashboard-terminal":
      case "surface:temporary-chat":
        await openTerminal(page, ACTION_TIMEOUT_MS);
        await expect(page.getByText(marker, { exact: false }).last()).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
        break;
      case "surface:garden-chat":
        await expect(page.getByPlaceholder(/Ask about your documents/).last()).toBeEditable({ timeout: ACTION_TIMEOUT_MS });
        await expect(page.getByText(marker, { exact: false }).last()).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
        break;
      case "surface:legacy-garden-chat": {
        const composer = page.getByPlaceholder(/Ask about a topic, page, source, or link/).last();
        if (!(await composer.isVisible().catch(() => false))) {
          await page.getByRole("button", { name: "Assistant", exact: true }).last().click();
        }
        await expect(composer).toBeEditable({ timeout: ACTION_TIMEOUT_MS });
        await expect(page.getByText(marker, { exact: false }).last()).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
        break;
      }
      case "surface:quartz-ai": {
        const frame = page.frameLocator(`iframe[title="${escapeCssString(`${uiAuthority.garden.name} garden`)}"]`);
        const open = frame.getByRole("button", { name: "Open Assistant for this page", exact: true });
        if (await open.isVisible().catch(() => false)) await open.click();
        await expect(frame.locator(".breadboard-ai-assistant").filter({ hasText: marker }).last()).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
        break;
      }
      default:
        throw new Error(`Unknown packaged chat-surface capability ${plan.capabilityId}.`);
    }
  } else {
    await openTerminal(page, ACTION_TIMEOUT_MS);
    await expect(page.getByText(marker, { exact: false }).last()).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  }
  if (plan.category === "agency-persona") {
    await expect(page.getByRole("button", { name: `Clear ${plan.displayName} agent`, exact: true })).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  }
}

function assertNoUnexpectedRuntimeJobs(
  plan: PackagedParityPlan,
  before: RuntimeParitySnapshot,
  after: RuntimeParitySnapshot,
  boundary: string,
): void {
  const oldIds = new Set(before.jobs.map(({ jobId }) => jobId));
  const unexpected = after.jobs.filter(({ jobId }) => !oldIds.has(jobId));
  if (unexpected.length !== 0) {
    throw new Error(`${plan.capabilityId} ${boundary} duplicated or invented ${unexpected.length} Runtime job(s).`);
  }
}

function assertSameConversationAfterBoundary(
  witness: NetworkWitness,
  cursor: number,
  primaryConversationId: string,
  label: string,
): void {
  const observed = witness.conversationIdsSince(cursor);
  if (
    observed.length === 0 ||
    observed.some((conversationId) => conversationId !== primaryConversationId) ||
    witness.conversationId() !== primaryConversationId
  ) {
    throw new Error(`${label} did not remain bound to the exact pre-boundary conversation/session identity.`);
  }
}

async function exerciseSourceSelectionFailClosedRecovery(options: {
  readonly qa: ElectronQaHarness;
  readonly page: Page;
  readonly plan: PackagedParityPlan;
  readonly witness: NetworkWitness;
  readonly primaryMarker: string;
  readonly uiAuthority: PackagedParityUiAuthority;
  readonly snapshot: () => RuntimeParitySnapshot;
}): Promise<{
  readonly claim: Record<string, unknown>;
  readonly support: Record<string, unknown>;
}> {
  const { qa, page, plan, witness, primaryMarker, uiAuthority, snapshot } = options;
  const selectedIdentity = plan.recovery.selectionIdentity;
  if (!selectedIdentity || plan.driver.kind !== "slash") {
    throw new Error(`${plan.capabilityId} lacks an exact source-selection recovery identity.`);
  }
  const primaryConversationId = witness.conversationId();
  const selectedChip = page.getByRole("button", {
    name: `Clear ${plan.displayName} agent`,
    exact: true,
  }).last();
  await expect(selectedChip).toBeVisible({ timeout: ACTION_TIMEOUT_MS });

  const recoveryBefore = snapshot();
  const cursor = witness.cursor();
  const injected = injectUnresolvablePersonaSelection({
    repoRoot: qa.run.paths.repoRoot,
    runtimeRoot: qa.run.paths.runtimeRoot,
    runRoot: qa.run.paths.runRoot,
    dataDir: qa.run.paths.dataDir,
    runId: qa.run.runId,
    capabilityId: plan.capabilityId,
    expectedSelectionIdentity: selectedIdentity,
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: ACTION_TIMEOUT_MS });
  await dashboardPage(page);
  await openTerminal(page, ACTION_TIMEOUT_MS);

  const missingSourceNotice = "The selected Agency Agent is no longer available and was cleared.";
  await expect(page.getByText(missingSourceNotice, { exact: true }).last()).toBeVisible({
    timeout: ACTION_TIMEOUT_MS,
  });
  await expect(selectedChip).toBeHidden({ timeout: ACTION_TIMEOUT_MS });
  await expect(page.locator('button[aria-label^="Clear "][aria-label$=" agent"]')).toHaveCount(0, {
    timeout: ACTION_TIMEOUT_MS,
  });
  if (witness.messageDispatchCountSince(cursor) !== 0) {
    throw new Error(`${plan.capabilityId} source failure silently dispatched an unrelated persona/model turn.`);
  }
  const cleared = readInjectedPersonaSelection({
    repoRoot: qa.run.paths.repoRoot,
    runtimeRoot: qa.run.paths.runtimeRoot,
    runRoot: qa.run.paths.runRoot,
    dataDir: qa.run.paths.dataDir,
    runId: qa.run.runId,
    rowId: injected.rowId,
    conversationPublicId: injected.conversationPublicId,
  });
  if (cleared !== null) {
    throw new Error(`${plan.capabilityId} source failure did not clear the unresolvable persisted selection.`);
  }

  const recoveryMarker = `${primaryMarker}-SOURCE-RECOVERED`;
  const prepared = await submitDashboardRecoveryTurn(
    page,
    "The selected persona source was just reloaded through the normal Agents command in this same conversation. " +
      `Repeat the exact completion marker from the first completed answer in this conversation without being told that marker again, answer in the selected persona, and finish with ${recoveryMarker}.`,
    plan,
  );
  const turn = await waitForTurn(page, prepared, recoveryMarker, uiAuthority);
  await witness.settle();
  if (turn.errorText) {
    throw new Error(`The post-refresh source recovery turn failed visibly: ${redact(turn.errorText).slice(0, 500)}`);
  }
  if (!turn.outputText.includes(primaryMarker) || !turn.outputText.includes(recoveryMarker)) {
    throw new Error(`${plan.capabilityId} post-refresh source turn lost the exact prior conversation marker.`);
  }
  assertSameConversationAfterBoundary(
    witness,
    cursor,
    primaryConversationId,
    `${plan.capabilityId} source recovery`,
  );
  if (!witness.requestContainsSince(cursor, plan.driver.slashCommand)) {
    throw new Error(`${plan.capabilityId} post-refresh turn did not reselect its exact normal-UI command.`);
  }
  if (!witness.responseContainsSince(cursor, plan.capabilityId)) {
    throw new Error(`${plan.capabilityId} post-refresh response did not retain its exact selected capability identity.`);
  }
  await expect(page.getByRole("button", {
    name: `Clear ${plan.displayName} agent`,
    exact: true,
  }).last()).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  const capabilityLedger = await observeSelectionEvidence(page, plan, witness);
  const recoveryAfter = snapshot();
  assertNoUnexpectedRuntimeJobs(plan, recoveryBefore, recoveryAfter, "source recovery");

  return {
    claim: {
      applicability: "APPLICABLE",
      recoveryKind: "SOURCE_SELECTION_FAIL_CLOSED",
      selectedIdentitySha256: sha256(selectedIdentity),
      unresolvableSelectionInjected: true,
      truthfulFailurePresentationObserved: true,
      selectionCleared: true,
      noFallbackObserved: true,
      sourceContextRestored: true,
      sameConversationObserved: true,
      priorContextObserved: true,
      noDuplicationObserved: true,
    },
    support: {
      boundary: "renderer-refresh",
      selectedIdentitySha256: sha256(selectedIdentity),
      faultSelectionIdentitySha256: sha256(injected.faultSelectionIdentity),
      conversationPublicIdSha256: sha256(injected.conversationPublicId),
      recoveryOutputSha256: sha256(turn.outputText),
      recoveryCapabilityLedgerSha256: sha256(capabilityLedger),
      missingSourceNoticeSha256: sha256(missingSourceNotice),
    },
  };
}

async function exerciseStoredSelectionAppRestart(options: {
  readonly qa: ElectronQaHarness;
  readonly plan: PackagedParityPlan;
  readonly primaryMarker: string;
  readonly primaryConversationId: string;
  readonly uiAuthority: PackagedParityUiAuthority;
  readonly recoveryBefore: RuntimeParitySnapshot;
  readonly capture: (rootPids: readonly number[]) => RuntimeParitySnapshot;
}): Promise<{
  readonly page: Page;
  readonly rootPids: readonly number[];
  readonly claim: Record<string, unknown>;
  readonly support: Record<string, unknown>;
  readonly network: readonly NetworkRecord[];
}> {
  const { qa, plan, primaryMarker, primaryConversationId, uiAuthority, recoveryBefore, capture } = options;
  const selectedIdentity = plan.recovery.selectionIdentity;
  if (!selectedIdentity || plan.driver.kind !== "model") {
    throw new Error(`${plan.capabilityId} lacks an exact stored model-selection recovery identity.`);
  }
  const oldEndpointPid = qa.readEndpoints().pid;
  const restartReceipt = await qa.restart({ assertPortsReleased: true, timeoutMs: ACTION_TIMEOUT_MS });
  const page = await qa.dismissWelcome();
  const recoveryWitness = new NetworkWitness(page);
  try {
    await ensureAuthenticatedDashboard(page, qa.run.bootstrap.auth, ACTION_TIMEOUT_MS);
    await terminalComposer(page);
    const intelligence = page.getByTitle(new RegExp(escapeRegex(plan.displayName), "i")).last();
    await expect(intelligence).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
    await intelligence.click();
    const selectedButton = page.getByRole("button", {
      name: new RegExp(`^${escapeRegex(plan.displayName)}$`, "iu"),
    }).last();
    await expect(selectedButton).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
    await expect(selectedButton).toHaveClass(/\bneu-selected\b/u, { timeout: ACTION_TIMEOUT_MS });
    await page.getByRole("button", { name: "Close intelligence menu", exact: true }).click();

    const cursor = recoveryWitness.cursor();
    const recoveryMarker = `${primaryMarker}-MODEL-RESTARTED`;
    const prepared = await submitDashboardRecoveryTurn(
      page,
      "This is the first real turn after a full Breadboard restart. Do not change or reselect the stored model. " +
        `Repeat the exact completion marker from the first completed answer in this conversation without being told that marker again, and finish with ${recoveryMarker}.`,
      null,
    );
    const turn = await waitForTurn(page, prepared, recoveryMarker, uiAuthority);
    await recoveryWitness.settle();
    if (turn.errorText) {
      throw new Error(`The real post-restart stored-model turn failed visibly: ${redact(turn.errorText).slice(0, 500)}`);
    }
    if (!turn.outputText.includes(primaryMarker) || !turn.outputText.includes(recoveryMarker)) {
      throw new Error(`${plan.capabilityId} post-restart turn lost the exact prior conversation marker.`);
    }
    if (!recoveryWitness.requestUsedModelSince(cursor, selectedIdentity)) {
      throw new Error(`${plan.capabilityId} post-restart request did not use the exact stored model identity.`);
    }
    assertSameConversationAfterBoundary(
      recoveryWitness,
      cursor,
      primaryConversationId,
      `${plan.capabilityId} app restart`,
    );
    const capabilityLedger = await observeSelectionEvidence(page, plan, recoveryWitness);
    const rootPids = [await qa.mainProcessPid(), qa.readEndpoints().pid];
    if (rootPids[1] === oldEndpointPid) {
      throw new Error(`${plan.capabilityId} app restart reused the prior Runtime V2 PID.`);
    }
    const recoveryAfter = capture(rootPids);
    const livePids = new Set(recoveryAfter.processIds);
    const survivors = recoveryBefore.runtimeOwnedProcessIds.filter((pid) => livePids.has(pid));
    if (survivors.length > 0) {
      throw new Error(`${plan.capabilityId} app restart left old Runtime-owned PID(s): ${survivors.join(", ")}.`);
    }
    assertNoUnexpectedRuntimeJobs(plan, recoveryBefore, recoveryAfter, "stored-selection app restart");

    return {
      page,
      rootPids,
      claim: {
        applicability: "APPLICABLE",
        recoveryKind: "STORED_SELECTION_APP_RESTART",
        selectedIdentitySha256: sha256(selectedIdentity),
        appRestartObserved: true,
        storedSelectionRestored: true,
        postRestartRequestUsedSelection: true,
        sameConversationObserved: true,
        priorContextObserved: true,
        noDuplicationObserved: true,
        contextPreserved: true,
      },
      support: {
        boundary: "full-electron-restart",
        selectedIdentitySha256: sha256(selectedIdentity),
        recoveryOutputSha256: sha256(turn.outputText),
        recoveryCapabilityLedgerSha256: sha256(capabilityLedger),
        oldRuntimePidSha256: sha256(String(oldEndpointPid)),
        newRuntimePidSha256: sha256(String(rootPids[1])),
        restartExitCode: restartReceipt.exitCode,
        releasedPortCount: restartReceipt.releasedPorts.length,
      },
      network: Object.freeze([...recoveryWitness.records]),
    };
  } finally {
    recoveryWitness.stop();
  }
}

function exactBlockedPrerequisite(plan: PackagedParityPlan, visibleError: string) {
  const normalized = visibleError.toLocaleLowerCase();
  return plan.prerequisites.find(({ frozenRequirement }) =>
    normalized.includes(frozenRequirement.toLocaleLowerCase())) ?? null;
}

async function assertFailureSelectionVisible(
  page: Page,
  plan: PackagedParityPlan,
  witness: NetworkWitness,
): Promise<void> {
  if (plan.driver.kind === "surface") {
    await observeSelectionEvidence(page, plan, witness);
    return;
  }
  if (plan.driver.kind === "slash") {
    if (!witness.requestContains(plan.driver.slashCommand)) {
      throw new Error(`${plan.capabilityId} failure was not dispatched with its exact selected slash command.`);
    }
    return;
  }
  if (plan.driver.kind === "model" || plan.driver.kind === "profile") return;
  if (witness.responseContains(plan.capabilityId)) return;
  const visible = page.getByText(plan.displayName, { exact: true }).last();
  if (!(await visible.isVisible().catch(() => false))) {
    throw new Error(`${plan.capabilityId} failure has no exact visible selection identity; no FAIL observation is publishable.`);
  }
}

export async function runPackagedCapabilityWorkflow(options: {
  readonly qa: ElectronQaHarness;
  readonly plan: PackagedParityPlan;
  readonly parityRunId: string;
  readonly packageOpenedAtMs: number;
  readonly uiAuthority: PackagedParityUiAuthority;
}): Promise<PackagedParityWorkflowOutcome> {
  const { qa, plan, parityRunId, packageOpenedAtMs, uiAuthority } = options;
  if (plan.output.driverKind === null) {
    throw new Error(
      `${plan.capabilityId} has no implemented packaged ${plan.output.contractKind} output driver; the generic chat workflow is forbidden.`,
    );
  }
  if (plan.recovery.supported && plan.recovery.driverKind === null) {
    throw new Error(
      `${plan.capabilityId} has no implemented packaged ${plan.recovery.scenarioKind} recovery driver; the workflow cannot start.`,
    );
  }
  let page = qa.page;
  const repoRoot = qa.run.paths.repoRoot;
  const marker = `PARITY-${sha256(`${parityRunId}:${plan.capabilityId}`).slice(0, 20)}`;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const witness = new NetworkWitness(page);
  let roots: readonly number[] = [await qa.mainProcessPid(), qa.readEndpoints().pid];
  const capture = (rootPids: readonly number[]): RuntimeParitySnapshot => capturePackagedRuntimeSnapshot({
    repoRoot,
    dataDir: qa.run.paths.dataDir,
    endpoints: qa.readEndpoints().urls,
    runtimeRootPids: rootPids,
  });
  const snapshot = (): RuntimeParitySnapshot => capturePackagedRuntimeSnapshot({
    repoRoot,
    dataDir: qa.run.paths.dataDir,
    endpoints: qa.readEndpoints().urls,
    runtimeRootPids: roots,
  });
  const before = snapshot();
  try {
    const prepared = await prepareAndSubmit(page, plan, repoRoot, uiAuthority, marker);
    const turn = await waitForTurn(page, prepared, marker, uiAuthority);
    await witness.settle();
    const finishedPrimary = snapshot();
    if (turn.errorText) {
      await assertFailureSelectionVisible(page, plan, witness);
      const prerequisite = exactBlockedPrerequisite(plan, turn.errorText);
      const result = prerequisite ? "BLOCKED" : "FAIL";
      const artifactFile = path.join(repoRoot, ".qa-results", "parity", parityRunId, "workflows", `${safeName(plan.capabilityId)}.json`);
      const finishedAt = new Date().toISOString();
      immutableJson(artifactFile, {
        schemaVersion: 1,
        capabilityId: plan.capabilityId,
        result,
        startedAt,
        finishedAt,
        normalUiRequestObserved: witness.records.length > 0,
        visibleError: redact(turn.errorText).slice(0, 4_000),
        network: witness.records,
      });
      const workflowIdentity = {
        electronRunId: qa.run.runId,
        workflowId: `parity:${plan.capabilityId}`,
        conversationIdSha256: sha256(witness.conversationId()),
      };
      if (prerequisite) {
        return {
          capabilityId: plan.capabilityId,
          uiEntryPoint: plan.visibleEntryPoint,
          result: "BLOCKED",
          startedAt,
          finishedAt,
          workflowIdentity,
          artifactPath: relativeEvidencePath(repoRoot, artifactFile),
          blocker: {
            prerequisiteType: prerequisite.prerequisiteType,
            prerequisiteId: prerequisite.prerequisiteId,
            code: "FROZEN_EXTERNAL_PREREQUISITE_UNAVAILABLE",
            summary: redact(turn.errorText).replace(/[\r\n]+/gu, " ").slice(0, 500),
          },
          baselineBlockerAuthority: null,
        };
      }
      return {
        capabilityId: plan.capabilityId,
        uiEntryPoint: plan.visibleEntryPoint,
        result: "FAIL",
        startedAt,
        finishedAt,
        workflowIdentity,
        artifactPath: relativeEvidencePath(repoRoot, artifactFile),
        failure: {
          code: "VISIBLE_PACKAGED_WORKFLOW_FAILURE",
          summary: redact(turn.errorText).replace(/[\r\n]+/gu, " ").slice(0, 500),
        },
      };
    }
    if (!turn.outputText.includes(marker)) {
      throw new Error(`${plan.capabilityId} visible result omitted its harness-held completion marker.`);
    }
    const capabilityLedger = await observeSelectionEvidence(page, plan, witness);
    const output = await observeOpenOutput(page, plan, turn.outputText, marker, witness);

    const followUpMarker = `${marker}-FOLLOWUP`;
    const followUp = plan.followUp.supported
      ? await exerciseFollowUp(page, prepared, uiAuthority, witness, marker, followUpMarker)
      : null;
    const followUpClaim = followUp
      ? {
          applicability: "APPLICABLE",
          sameConversationObserved: followUp.sameConversationObserved,
          priorContextObserved: followUp.priorContextObserved,
        }
      : {
          applicability: "NOT_APPLICABLE",
          inventoryContractObserved: true,
          followUpNotSupported: true,
        };

    let cancellationBefore = finishedPrimary;
    let cancellationAfter = finishedPrimary;
    let cancellationUi: { requested: true; terminalVisible: true; controlCleared: true } | null = null;
    if (plan.cancellation.supported) {
      cancellationBefore = snapshot();
      cancellationUi = await exerciseCancellation(page, plan, repoRoot, uiAuthority, `${marker}-CANCEL`);
      cancellationAfter = snapshot();
    }

    let recoveryClaim: Record<string, unknown>;
    let recoverySupport: Record<string, unknown> | null = null;
    let recoveryNetwork: readonly NetworkRecord[] = Object.freeze([]);
    if (plan.recovery.supported) {
      if (plan.recovery.driverKind === "REFRESH") {
        const recoveryBefore = snapshot();
        await page.reload({ waitUntil: "domcontentloaded", timeout: ACTION_TIMEOUT_MS });
        const recoveryAfter = snapshot();
        await assertRecovery(page, plan, uiAuthority, marker, recoveryBefore, recoveryAfter);
        recoveryClaim = { applicability: "APPLICABLE", recoveryKind: "REFRESH", reconnected: true, noDuplicationObserved: true, contextPreserved: true };
        recoverySupport = { boundary: "renderer-refresh", recoveredMarkerSha256: sha256(marker) };
      } else if (plan.recovery.driverKind === "SOURCE_SELECTION_FAIL_CLOSED") {
        const sourceRecovery = await exerciseSourceSelectionFailClosedRecovery({
          qa,
          page,
          plan,
          witness,
          primaryMarker: marker,
          uiAuthority,
          snapshot,
        });
        recoveryClaim = sourceRecovery.claim;
        recoverySupport = sourceRecovery.support;
      } else if (plan.recovery.driverKind === "STORED_SELECTION_APP_RESTART") {
        const recoveryBefore = snapshot();
        const storedSelectionRecovery = await exerciseStoredSelectionAppRestart({
          qa,
          plan,
          primaryMarker: marker,
          primaryConversationId: witness.conversationId(),
          uiAuthority,
          recoveryBefore,
          capture,
        });
        page = storedSelectionRecovery.page;
        roots = storedSelectionRecovery.rootPids;
        recoveryClaim = storedSelectionRecovery.claim;
        recoverySupport = storedSelectionRecovery.support;
        recoveryNetwork = storedSelectionRecovery.network;
      } else {
        throw new Error(`${plan.capabilityId} has no implemented real packaged recovery scenario.`);
      }
    } else {
      if (!plan.recovery.notApplicable) {
        throw new Error(`${plan.capabilityId} has no source-backed typed recovery non-applicability authority.`);
      }
      recoveryClaim = {
        applicability: "NOT_APPLICABLE",
        inventoryContractObserved: true,
        recoveryNotSupported: true,
        reasonCode: plan.recovery.notApplicable.reasonCode,
        sourceProvenPreMigrationSemantics: plan.recovery.notApplicable.sourceProvenPreMigrationSemantics,
      };
    }

    const runtimeClaims = buildRuntimePassClaims({
      plan,
      before,
      after: finishedPrimary,
      cancellationBefore,
      cancellationAfter,
      packageOpenedAtMs,
      workflowStartedAtMs: startedAtMs,
      cancellationUi,
    });
    const finishedAt = new Date().toISOString();
    const artifactFile = path.join(repoRoot, ".qa-results", "parity", parityRunId, "workflows", `${safeName(plan.capabilityId)}.json`);
    immutableJson(artifactFile, {
      schemaVersion: 1,
      capabilityId: plan.capabilityId,
      uiEntryPoint: plan.visibleEntryPoint,
      result: "PASS",
      startedAt,
      finishedAt,
      markerSha256: sha256(marker),
      outputSha256: sha256(output.outputId),
      followUpOutputSha256: followUp?.outputSha256 ?? null,
      capabilityLedgerSha256: sha256(capabilityLedger),
      network: witness.records,
      recoveryNetwork,
      runtimeClaims,
      recoveryAuthority: {
        scenarioKind: plan.recovery.scenarioKind,
        contract: plan.recovery.contract,
        notApplicable: plan.recovery.notApplicable,
      },
      recovery: recoveryClaim,
      recoverySupport,
    });
    return {
      capabilityId: plan.capabilityId,
      uiEntryPoint: plan.visibleEntryPoint,
      result: "PASS",
      startedAt,
      finishedAt,
      workflowIdentity: {
        electronRunId: qa.run.runId,
        workflowId: `parity:${plan.capabilityId}`,
        conversationIdSha256: sha256(witness.conversationId()),
      },
      artifactPath: relativeEvidencePath(repoRoot, artifactFile),
      claims: {
        electron: {
          uiEntryPoint: plan.visibleEntryPoint,
          selectedCapabilityId: plan.capabilityId,
          normalEntryPointUsed: true,
          realRequestSubmitted: true,
          selectionObserved: true,
          semanticAssertionsPassed: true,
          followUp: followUpClaim,
        },
        service: runtimeClaims.service,
        worker: runtimeClaims.worker,
        output: {
          applicability: "APPLICABLE",
          outputKind: plan.output.outputKind,
          outputIdSha256: sha256(output.outputId),
          expectedOutputObserved: true,
          nonPlaceholderObserved: true,
          openBehaviorObserved: output.openBehaviorObserved,
        },
        cancellation: runtimeClaims.cancellation,
        recovery: recoveryClaim,
      },
    };
  } finally {
    witness.stop();
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function escapeCssString(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}
