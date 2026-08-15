import * as path from "node:path";
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Isolated QA runs intentionally start with an empty Next.js cache. The first
// visit to a large route such as /dashboard can spend well over 30 seconds in
// a legitimate cold webpack compile, so keep user actions bounded but allow
// that observed startup cost.
const DEFAULT_UI_TIMEOUT_MS = 2 * 60_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 2 * 60_000;

export interface QaUserCredentials {
  readonly username: string;
  readonly email: string;
  readonly password: string;
  readonly inviteCode: string;
}

export interface SignInCredentials {
  readonly email: string;
  readonly password: string;
}

export interface CreateGardenInput {
  readonly name: string;
  readonly description?: string;
}

export interface GardenInfo {
  readonly name: string;
  readonly description: string;
  readonly slug: string;
  readonly readerHref: string;
  readonly workspaceHref: string;
}

export interface UploadedDocument {
  readonly filePath: string;
  readonly fileName: string;
  /** The title shown by the document library for TXT and Markdown fixtures. */
  readonly displayedTitle: string;
}

export interface ReloadCoreStateExpectation {
  readonly garden?: GardenInfo;
  readonly uploadedDocuments?: readonly (UploadedDocument | string)[];
  /** Defaults to the surface that was open immediately before the reload. */
  readonly surface?: "dashboard" | "garden-workspace";
  /** Only meaningful on the dashboard surface. */
  readonly terminal?: "open" | "closed";
  readonly timeoutMs?: number;
}

/**
 * Register a fresh user through the real account form, then sign in through
 * NextAuth's credentials form. The QA environment is expected to provide a
 * disposable invite and user values; this helper never reads secrets itself.
 */
export async function registerAndSignIn(
  page: Page,
  credentials: QaUserCredentials,
  timeoutMs = DEFAULT_UI_TIMEOUT_MS,
): Promise<void> {
  await registerAccount(page, credentials, timeoutMs);
  await signIn(page, credentials, timeoutMs);
}

export async function registerAccount(
  page: Page,
  credentials: QaUserCredentials,
  timeoutMs = DEFAULT_UI_TIMEOUT_MS,
): Promise<void> {
  await page.goto(appUrl(page, "/auth/register"), {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs,
  });

  await expect(
    page.getByRole("heading", { name: "Create account", exact: true }),
  ).toBeVisible({ timeout: timeoutMs });

  // A cold Next.js dev compile can paint the server-rendered form before its
  // submit handler is hydrated. Wait for React to attach the real onSubmit
  // callback; otherwise a native form submit performs a GET and leaks the
  // values into the query string. The visible password control below then
  // verifies that the hydrated client state is actually responding.
  await page.waitForFunction(
    () => {
      const form = document.querySelector("form");
      if (!form) return false;
      return Object.getOwnPropertyNames(form).some((key) => {
        if (!key.startsWith("__reactProps$")) return false;
        const props = (form as unknown as Record<string, unknown>)[key];
        return Boolean(
          props &&
            typeof props === "object" &&
            typeof (props as { onSubmit?: unknown }).onSubmit === "function",
        );
      });
    },
    undefined,
    { timeout: timeoutMs },
  );

  const passwordToggle = page.getByRole("button", {
    name: "Show password",
    exact: true,
  });
  await passwordToggle.click();
  await expect(
    page.getByRole("button", { name: "Hide password", exact: true }),
  ).toBeVisible({ timeout: timeoutMs });
  await page
    .getByRole("button", { name: "Hide password", exact: true })
    .click();
  await expect(passwordToggle).toBeVisible({ timeout: timeoutMs });

  await page.getByLabel("Invite code", { exact: true }).fill(credentials.inviteCode);
  await page.getByLabel("Username", { exact: true }).fill(credentials.username);
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByLabel("Confirm password", { exact: true }).fill(credentials.password);

  await expect(page.getByLabel("Invite code", { exact: true })).toHaveValue(
    credentials.inviteCode,
  );
  await expect(page.getByLabel("Username", { exact: true })).toHaveValue(
    credentials.username,
  );
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    credentials.email,
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    credentials.password,
  );
  await expect(page.getByLabel("Confirm password", { exact: true })).toHaveValue(
    credentials.password,
  );

  await Promise.all([
    page.waitForURL(
      (url) =>
        url.pathname === "/auth/login" &&
        url.searchParams.get("registered") === "true",
      { timeout: timeoutMs },
    ),
    page.getByRole("button", { name: "Create account", exact: true }).click(),
  ]);

  await expect(page.getByText(/Account created.+sign in below\./)).toBeVisible({
    timeout: timeoutMs,
  });
}

export async function signIn(
  page: Page,
  credentials: SignInCredentials,
  timeoutMs = DEFAULT_UI_TIMEOUT_MS,
): Promise<void> {
  if (new URL(page.url()).pathname !== "/auth/login") {
    await page.goto(appUrl(page, "/auth/login"), {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
  }

  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible({ timeout: timeoutMs });
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);

  await Promise.all([
    page.waitForURL((url) => url.pathname === "/dashboard", {
      timeout: timeoutMs,
    }),
    page.getByRole("button", { name: "Sign in", exact: true }).click(),
  ]);

  await assertAuthenticatedDashboard(page, undefined, timeoutMs);
}

/**
 * Navigate to the dashboard and sign in only when the app redirects to the
 * login page. This is useful after an Electron restart with the same QA data.
 */
export async function ensureAuthenticatedDashboard(
  page: Page,
  credentials?: SignInCredentials,
  timeoutMs = DEFAULT_UI_TIMEOUT_MS,
): Promise<void> {
  await page.goto(appUrl(page, "/dashboard"), {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs,
  });

  const gardensHeading = page.getByRole("heading", {
    name: "Gardens",
    exact: true,
  });
  const signInHeading = page.getByRole("heading", {
    name: "Sign in",
    exact: true,
  });
  await gardensHeading.or(signInHeading).first().waitFor({
    state: "visible",
    timeout: timeoutMs,
  });

  if (await signInHeading.isVisible()) {
    if (!credentials) {
      throw new Error(
        "The dashboard requires authentication, but no sign-in credentials were provided",
      );
    }
    await signIn(page, credentials, timeoutMs);
    return;
  }

  await assertAuthenticatedDashboard(page, undefined, timeoutMs);
}

export async function assertAuthenticatedDashboard(
  page: Page,
  garden?: Pick<GardenInfo, "name">,
  timeoutMs = DEFAULT_UI_TIMEOUT_MS,
): Promise<void> {
  await page.waitForURL((url) => url.pathname === "/dashboard", {
    timeout: timeoutMs,
  });
  await expect(
    page.getByRole("heading", { name: "Gardens", exact: true }),
  ).toBeVisible({ timeout: timeoutMs });
  await expect(
    page.getByRole("button", { name: "My gardens", exact: true }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Search your gardens", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New garden", exact: true }),
  ).toBeVisible();

  if (garden) {
    await expect(gardenCard(page, garden.name)).toBeVisible({ timeout: timeoutMs });
  }
}

/** Create a garden and resolve its real reader/workspace links from its card. */
export async function createGarden(
  page: Page,
  input: CreateGardenInput,
  timeoutMs = DEFAULT_UI_TIMEOUT_MS,
): Promise<GardenInfo> {
  const name = input.name.trim();
  const description = (input.description ?? "").trim();
  if (!name) throw new Error("Garden name cannot be empty");
  await assertAuthenticatedDashboard(page, undefined, timeoutMs);

  await page.getByRole("button", { name: "New garden", exact: true }).click();
  const modal = modalWithHeading(page, "New garden");
  await expect(modal).toBeVisible({ timeout: timeoutMs });
  await modal.getByPlaceholder("My garden", { exact: true }).fill(name);
  await modal
    .getByPlaceholder("What's this garden about?", { exact: true })
    .fill(description);
  await modal.getByRole("button", { name: "Create", exact: true }).click();

  await expect(modal).toBeHidden({ timeout: timeoutMs });
  const card = gardenCard(page, name);
  await expect(card).toHaveCount(1, { timeout: timeoutMs });
  await expect(card).toBeVisible({ timeout: timeoutMs });
  if (description) {
    await expect(card.getByText(description, { exact: true })).toBeVisible();
  }

  const readerHref = await requiredHref(
    card.getByRole("link", { name: "Open garden view", exact: true }),
    `reader link for ${name}`,
  );
  const workspaceHref = await requiredHref(
    card.getByRole("link", { name: "Open garden dashboard", exact: true }),
    `workspace link for ${name}`,
  );
  const match = new URL(workspaceHref, page.url()).pathname.match(/^\/gardens\/([^/]+)$/);
  if (!match?.[1]) {
    throw new Error(`Unexpected garden workspace link: ${workspaceHref}`);
  }

  return {
    name,
    description,
    slug: decodeURIComponent(match[1]),
    readerHref,
    workspaceHref,
  };
}

/** Open the private garden workspace from its real dashboard card. */
export async function openGardenWorkspace(
  page: Page,
  garden: GardenInfo,
  timeoutMs = DEFAULT_UI_TIMEOUT_MS,
): Promise<void> {
  const targetPath = new URL(garden.workspaceHref, page.url()).pathname;
  if (new URL(page.url()).pathname === "/dashboard") {
    const workspaceLink = gardenCard(page, garden.name).getByRole("link", {
      name: "Open garden dashboard",
      exact: true,
    });
    await expect(workspaceLink).toBeVisible({ timeout: timeoutMs });
    await Promise.all([
      page.waitForURL((url) => url.pathname === targetPath, { timeout: timeoutMs }),
      workspaceLink.click(),
    ]);
  } else {
    await page.goto(appUrl(page, targetPath), {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
  }

  await assertGardenWorkspace(page, garden, [], timeoutMs);
}

/**
 * Upload via the real workspace modal. Learning Map generation is explicitly
 * switched off so small deterministic TXT/Markdown fixtures stay local and do
 * not require a model provider.
 */
export async function uploadDocuments(
  page: Page,
  filePaths: readonly string[],
  timeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS,
): Promise<readonly UploadedDocument[]> {
  if (filePaths.length === 0) throw new Error("At least one upload file is required");
  await expect(page.getByPlaceholder(/Ask about your documents/)).toBeVisible({
    timeout: Math.min(timeoutMs, DEFAULT_UI_TIMEOUT_MS),
  });

  await page.getByRole("button", { name: "Add document", exact: true }).click();
  const modal = modalWithHeading(page, "Add documents");
  await expect(modal).toBeVisible();

  // The picker is intentionally hidden behind the semantic Add document UI;
  // setInputFiles is Playwright's user-file-selection primitive.
  const fileInput = modal.locator('input[type="file"]');
  await expect(fileInput).toHaveCount(1);
  await fileInput.setInputFiles([...filePaths]);

  const learningMap = modal.getByRole("checkbox", {
    name: /Generate Learning Map/i,
  });
  await expect(learningMap).toBeVisible();
  if (await learningMap.isChecked()) await learningMap.uncheck();
  await expect(learningMap).not.toBeChecked();

  const uploadButton = modal.getByRole("button", {
    name: /^Upload \d+ files?$/,
  });
  await expect(uploadButton).toBeEnabled();
  await Promise.all([
    page.getByText("Upload complete", { exact: true }).waitFor({
      state: "visible",
      timeout: timeoutMs,
    }),
    uploadButton.click(),
  ]);

  await expect(modal.getByRole("button", { name: "Close", exact: true })).toBeVisible({
    timeout: timeoutMs,
  });
  await expect(modal.getByText("Failed", { exact: true })).toHaveCount(0);

  const uploaded = filePaths.map((filePath) => {
    const fileName = path.basename(filePath);
    return {
      filePath,
      fileName,
      displayedTitle: path.parse(fileName).name,
    } satisfies UploadedDocument;
  });
  for (const document of uploaded) {
    await expect(modal.getByText(document.fileName, { exact: true })).toBeVisible();
  }

  await modal.getByRole("button", { name: "Close", exact: true }).click();
  await expect(modal).toBeHidden();
  await ensureDocumentsExpanded(page, timeoutMs);

  const resolved: UploadedDocument[] = [];
  for (const document of uploaded) {
    const expectedSlug = slugifyFixtureName(path.parse(document.fileName).name);
    let matched: { href: string; title: string } | undefined;
    await expect
      .poll(
        async () => {
          const links = await page.getByTitle("Open note", { exact: true }).evaluateAll(
            (elements) =>
              elements.map((element) => ({
                href: element.getAttribute("href") ?? "",
                title: element.textContent?.trim() ?? "",
              })),
          );
          matched = links.find((entry) => {
            try {
              const note = new URL(entry.href, page.url()).searchParams.get("note") ?? "";
              return slugifyFixtureName(note.split("/").at(-1) ?? "") === expectedSlug;
            } catch {
              return false;
            }
          });
          return matched?.title ?? null;
        },
        {
          message: `expected an ingested document link for ${document.fileName}`,
          timeout: timeoutMs,
        },
      )
      .not.toBeNull();
    if (!matched?.title) {
      throw new Error(`Ingested document ${document.fileName} has no visible title`);
    }
    resolved.push({ ...document, displayedTitle: matched.title });
  }
  return resolved;
}

export async function openTerminal(
  page: Page,
  timeoutMs = DEFAULT_UI_TIMEOUT_MS,
): Promise<void> {
  if (await terminalCloseSurface(page).isVisible()) {
    await assertTerminalOpen(page, timeoutMs);
    return;
  }

  const openButton = page.getByRole("button", {
    name: "Open terminal",
    exact: true,
  });
  await expect(openButton).toBeVisible({ timeout: timeoutMs });
  await openButton.click();
  await assertTerminalOpen(page, timeoutMs);
}

export async function closeTerminal(
  page: Page,
  timeoutMs = DEFAULT_UI_TIMEOUT_MS,
): Promise<void> {
  const openButton = page.getByRole("button", {
    name: "Open terminal",
    exact: true,
  });
  if (await openButton.isVisible()) return;

  const closeSurface = terminalCloseSurface(page);
  await expect(closeSurface).toBeVisible({ timeout: timeoutMs });
  await closeSurface.click();
  await expect(openButton).toBeVisible({ timeout: timeoutMs });
}

export async function assertTerminalOpen(
  page: Page,
  timeoutMs = DEFAULT_UI_TIMEOUT_MS,
): Promise<void> {
  await expect(terminalCloseSurface(page)).toBeVisible({ timeout: timeoutMs });
  await expect(
    page.getByPlaceholder(/Ask anything across your gardens/),
  ).toBeVisible({ timeout: timeoutMs });
  await expect(
    page.getByRole("button", { name: "Toggle the sidebar", exact: true }),
  ).toBeVisible({ timeout: timeoutMs });
}

export async function assertTerminalClosed(
  page: Page,
  timeoutMs = DEFAULT_UI_TIMEOUT_MS,
): Promise<void> {
  await expect(
    page.getByRole("button", { name: "Open terminal", exact: true }),
  ).toBeVisible({ timeout: timeoutMs });
  await expect(page.getByPlaceholder(/Ask anything across your gardens/)).toBeHidden();
}

export async function assertGardenWorkspace(
  page: Page,
  garden: GardenInfo,
  documentTitles: readonly string[] = [],
  timeoutMs = DEFAULT_UI_TIMEOUT_MS,
): Promise<void> {
  const targetPath = new URL(garden.workspaceHref, page.url()).pathname;
  await page.waitForURL((url) => url.pathname === targetPath, { timeout: timeoutMs });
  await expect(
    page.getByRole("banner").getByRole("link", {
      name: garden.name,
      exact: true,
    }),
  ).toBeVisible({ timeout: timeoutMs });
  await expect(page.getByRole("link", { name: "Back to dashboard", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New chat", exact: true }).first(),
  ).toBeVisible();
  const composer = page.getByPlaceholder(/Ask about your documents/).first();
  await expect(composer).toBeVisible();

  // A cold Next route can paint the server-rendered composer well before
  // React hydrates it. A visible textarea is not enough: Playwright could
  // fill the DOM while the controlled value and Send state remain unchanged.
  // Wait for the real React onChange/onKeyDown handlers and for chat history
  // loading to release the composer. This is QA synchronization only; it does
  // not alter the product runtime or its production behavior.
  await page.waitForFunction(
    () => {
      const node = document.querySelector(
        'textarea[placeholder*="Ask about your documents"]',
      ) as (HTMLTextAreaElement & Record<string, unknown>) | null;
      if (!node) return false;
      const reactProps = Object.entries(node).find(([key]) =>
        key.startsWith("__reactProps$"),
      )?.[1];
      if (!reactProps || typeof reactProps !== "object") return false;
      const props = reactProps as Record<string, unknown>;
      return typeof props.onChange === "function" && typeof props.onKeyDown === "function";
    },
    undefined,
    { timeout: timeoutMs },
  );
  await expect(
    page.getByRole("button", { name: "New chat", exact: true }).first(),
  ).toBeEnabled({ timeout: timeoutMs });
  await expect(composer).toBeEditable({ timeout: timeoutMs });

  if (documentTitles.length > 0) {
    await ensureDocumentsExpanded(page, timeoutMs);
    for (const title of documentTitles) {
      await expect(
        page.getByRole("link", { name: title, exact: true }),
      ).toBeVisible({ timeout: timeoutMs });
    }
  }
}

async function ensureDocumentsExpanded(
  page: Page,
  timeoutMs = DEFAULT_UI_TIMEOUT_MS,
): Promise<void> {
  const documentsAccordion = page
    .getByRole("button", { name: /^Documents(?:\s|\()/ })
    .first();
  await expect(documentsAccordion).toBeVisible({ timeout: timeoutMs });
  if ((await documentsAccordion.getAttribute("aria-expanded")) !== "true") {
    await documentsAccordion.click();
  }
  await expect(documentsAccordion).toHaveAttribute("aria-expanded", "true", {
    timeout: timeoutMs,
  });
}

function slugifyFixtureName(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Reload the current renderer and verify durable user-visible state. */
export async function reloadAndAssertCoreState(
  page: Page,
  expected: ReloadCoreStateExpectation = {},
): Promise<void> {
  const previousPath = new URL(page.url()).pathname;
  const surface =
    expected.surface ??
    (previousPath.startsWith("/gardens/") ? "garden-workspace" : "dashboard");
  const timeoutMs = expected.timeoutMs ?? DEFAULT_UI_TIMEOUT_MS;

  await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });

  if (surface === "garden-workspace") {
    if (!expected.garden) {
      throw new Error("A garden is required to assert workspace state after reload");
    }
    const titles = (expected.uploadedDocuments ?? []).map((document) =>
      typeof document === "string" ? document : document.displayedTitle,
    );
    await assertGardenWorkspace(page, expected.garden, titles, timeoutMs);
    return;
  }

  await assertAuthenticatedDashboard(page, expected.garden, timeoutMs);
  if (expected.terminal === "open") await assertTerminalOpen(page, timeoutMs);
  if (expected.terminal === "closed") await assertTerminalClosed(page, timeoutMs);
}

/** This first-party card has no semantic group role, so scope it by its heading. */
export function gardenCard(page: Page, name: string): Locator {
  return page.locator(".dashboard-garden-card").filter({
    has: page.getByRole("heading", { name, exact: true }),
  });
}

function modalWithHeading(page: Page, heading: string): Locator {
  // The current modal panels do not expose role=dialog; scope by their heading
  // so duplicate Cancel/Create controls elsewhere cannot be selected.
  return page.locator(".bb-modal-panel").filter({
    has: page.getByRole("heading", { name: heading, exact: true }),
  });
}

function terminalCloseSurface(page: Page): Locator {
  return page.getByTitle(
    "Click empty space to close, or drag to resize the terminal",
    { exact: true },
  );
}

function appUrl(page: Page, pathname: string): string {
  const current = new URL(page.url());
  if (current.protocol !== "http:" && current.protocol !== "https:") {
    throw new Error(
      `Cannot resolve a dashboard route from non-HTTP page ${page.url()}`,
    );
  }
  return new URL(pathname, current.origin).toString();
}

async function requiredHref(locator: Locator, label: string): Promise<string> {
  await expect(locator).toBeVisible();
  const href = await locator.getAttribute("href");
  if (!href) throw new Error(`Missing ${label}`);
  return href;
}
