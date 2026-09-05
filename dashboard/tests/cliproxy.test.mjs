import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

// A scratch home keeps generated secrets out of the developer's real install.
const scratchHome = fs.mkdtempSync(path.join(os.tmpdir(), "bb-cliproxy-"));
process.env.CLIPROXY_HOME = scratchHome;
process.env.CLIPROXY_PORT = "8399";
delete process.env.CLIPROXY_API_KEY;
delete process.env.CLIPROXY_MANAGEMENT_KEY;
delete process.env.CLIPROXY_BASE_URL;

const config = await import("../src/lib/cliproxy/config.ts");
const claudeCode = await import("../src/lib/claude-code.ts");
const { cliproxyModelIdsFromPayload } = await import(
  "../src/lib/cliproxy/management.ts"
);

test.after(() => {
  fs.rmSync(scratchHome, { recursive: true, force: true });
});

test("only OAuth providers this build actually exposes are offered", () => {
  const ids = config.CLIPROXY_PROVIDERS.map((provider) => provider.id);
  // Verified against CLIProxyAPI v7.2.111. ChatGPT is excluded on purpose (see
  // below), so these four remain.
  assert.deepEqual(ids, ["claude", "antigravity", "kimi", "xai"]);
  // gemini-cli/qwen/iflow return 404 on mainline, so offering them would be a
  // button that always fails.
  assert.equal(config.cliproxyProvider("qwen"), null);
  assert.equal(config.cliproxyProvider("iflow"), null);
});

test("ChatGPT has exactly one sign-in, and it is ChatMock's", () => {
  // The proxy can do codex-auth-url, but offering it meant two credentials for
  // one account and two ids per model. ChatMock's own OAuth owns ChatGPT.
  assert.equal(config.cliproxyProvider("codex"), null);
  assert.equal(
    config.CLIPROXY_PROVIDERS.some((provider) => /chatgpt|codex/i.test(provider.label)),
    false,
  );

  // ChatGPT's sign-in belongs to the account list, and lives there rather than
  // being offered a second time further down the page.
  const accounts = source("src/app/components/settings-accounts.tsx");
  assert.match(accounts, /\/api\/chatmock\/account\/login/);
  const panel = source("src/app/components/settings-providers.tsx");
  assert.doesNotMatch(panel, /chatmock\/account\/login/);
});

test("the sync never lists a model ChatMock already serves natively", () => {
  // The sync itself lives in a library so the model picker can run it on a
  // timer; the route only translates its errors.
  const sync = source("src/lib/cliproxy/catalog-sync.ts");
  const route = source("src/app/api/cliproxy/sync/route.ts");
  assert.match(route, /syncSubscriptionCatalog\(request, userId\)/);
  assert.match(sync, /chatgptModels/);
  assert.match(sync, /native\.has\(model\)/);
  // A Runtime V2 port belongs only to the current app session. ChatMock reads
  // it from its supervised environment, so sync must remove any older value.
  assert.match(sync, /apiKey: ""/);
  assert.match(sync, /baseUrl: ""/);
  assert.doesNotMatch(sync, /cliproxyApiKey|cliproxyBaseUrl/);
  // Discovery: every read of the picker may schedule a background sync.
  const models = source("src/app/api/models/route.ts");
  assert.match(models, /scheduleSubscriptionCatalogAutoSync\(request, userId\)/);
  assert.match(sync, /AUTO_SYNC_INTERVAL_MS/);
});

test("the ChatGPT badge follows the Account tab, not the credential store", async () => {
  const { providerStatusBadge } = await import("../src/lib/provider-status.ts");
  const chatgpt = { kind: "chatgpt_oauth", enabled: true, configured: true };

  // `configured: true` here only means "not switched off" — it must never be
  // read as a signed-in ChatGPT account.
  assert.deepEqual(providerStatusBadge(chatgpt, { signedIn: false, email: null, plan: "free" }), {
    text: "Not signed in",
    tone: "idle",
  });
  assert.deepEqual(
    providerStatusBadge(chatgpt, { signedIn: true, email: "a@b.c", plan: "pro" }),
    { text: "Connected", tone: "connected" },
  );
  // Account still loading: say nothing rather than guess.
  assert.equal(providerStatusBadge(chatgpt, null), null);

  // Ordinary providers are unaffected and ignore the ChatGPT account.
  const keyed = { kind: "openai_compatible", enabled: true, configured: true };
  assert.equal(providerStatusBadge(keyed, null).text, "Connected");
  assert.equal(providerStatusBadge({ ...keyed, configured: false }, null).text, "Not configured");
  assert.equal(providerStatusBadge({ ...keyed, enabled: false }, null).text, "Off");
});

test("device-code providers are marked so the UI can show the code", () => {
  assert.equal(config.cliproxyProvider("kimi").flow, "device");
  assert.equal(config.cliproxyProvider("xai").flow, "device");
  assert.equal(config.cliproxyProvider("claude").flow, "redirect");
});

test("Claude authentication is owned by the official Claude Code CLI", () => {
  const status = claudeCode.parseClaudeCodeStatus({
    loggedIn: true,
    authMethod: "claude.ai",
    email: "person@example.com",
    subscriptionType: "pro",
  });
  assert.equal(status.installed, true);
  assert.equal(status.loggedIn, true);
  assert.equal(status.email, "person@example.com");
  assert.equal(status.subscriptionType, "pro");

  const implementation = source("src/lib/claude-code.ts");
  assert.doesNotMatch(implementation, /\.credentials\.json|readFileSync|CLIPROXY_MANAGEMENT_KEY/);
  assert.doesNotMatch(implementation, /node:child_process|\bexecFile\s*\(|\bspawn\s*\(/);
  assert.match(implementation, /runClaudeAccountJob/);
  const executor = source("scripts/runtime-v2-managed-setup-executor.mjs");
  assert.match(executor, /\["auth", "status", "--json"\]/);
  assert.match(executor, /\["auth", "logout"\]/);

  const management = source("src/lib/cliproxy/management.ts");
  assert.match(management, /spec\.id === "claude"/);
  assert.match(management, /linkClaudeCodeLogin/);
  assert.match(management, /filter\(\(model\) => !isClaudeCodeModel\(model\)\)/);
});

test("Claude subscription model ids are stable and isolated from other subscriptions", () => {
  assert.deepEqual([...claudeCode.CLAUDE_CODE_MODELS], [
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-haiku-4-5-20251001",
    "claude-fable-5",
    "claude-fable-5-efficient",
  ]);
  assert.equal(claudeCode.isClaudeCodeModel("cliproxy/claude-sonnet-5"), true);
  assert.equal(claudeCode.isClaudeCodeModel("gemini-3-pro"), false);

  const dispatch = source("../chatmock/chatmock/providers/dispatch.py");
  assert.match(dispatch, /spec\.id == "cliproxy" and claude_code\.is_claude_model/);
  assert.match(dispatch, /return claude_code/);
});

test("local secrets are generated once, per install, and reused", () => {
  const apiKey = config.cliproxyApiKey();
  const managementKey = config.cliproxyManagementKey();

  assert.match(apiKey, /^[0-9a-f]{48}$/);
  assert.match(managementKey, /^[0-9a-f]{48}$/);
  assert.notEqual(apiKey, managementKey);
  // Stable across calls, so a restart does not invalidate a running proxy.
  assert.equal(config.cliproxyApiKey(), apiKey);
  assert.equal(config.cliproxyManagementKey(), managementKey);

  const mode = fs.statSync(path.join(scratchHome, "api-key")).mode & 0o777;
  if (process.platform !== "win32") assert.equal(mode, 0o600);
});

test("the generated config binds to loopback and locks down management", () => {
  const yaml = config.renderCliproxyConfig();
  assert.match(yaml, /host: "127\.0\.0\.1"/);
  assert.match(yaml, /port: 8399/);
  assert.match(yaml, /allow-remote: false/);
  // The bundled control panel would be a second, unauthenticated way to start
  // OAuth flows against the same credentials.
  assert.match(yaml, /disable-control-panel: true/);
  assert.match(yaml, /usage-statistics-enabled: false/);
  assert.match(yaml, new RegExp(config.cliproxyApiKey()));
});

test("windows paths are emitted as forward slashes", () => {
  const yaml = config.renderCliproxyConfig({ authDir: "C:\\Users\\x\\auth" });
  assert.match(yaml, /auth-dir: "C:\/Users\/x\/auth"/);
  assert.doesNotMatch(yaml, /C:\\\\Users/);
});

test("accounts are read from credential filenames", () => {
  fs.mkdirSync(config.cliproxyAuthDir(), { recursive: true });
  fs.writeFileSync(path.join(config.cliproxyAuthDir(), "claude-alice.json"), "{}");
  fs.writeFileSync(path.join(config.cliproxyAuthDir(), "antigravity-bob.json"), "{}");
  fs.writeFileSync(path.join(config.cliproxyAuthDir(), "notes.txt"), "ignore me");

  const accounts = config.readCliproxyAccounts();
  assert.deepEqual(
    accounts.map((account) => account.provider).sort(),
    ["antigravity", "claude"],
  );
});

test("sibling credentials are returned in chronological order", () => {
  const authDir = config.cliproxyAuthDir();
  const older = path.join(authDir, "kimi-older@example.com.json");
  const newer = path.join(authDir, "kimi-newer@example.com.json");
  fs.writeFileSync(older, "{}");
  fs.writeFileSync(newer, "{}");
  fs.utimesSync(older, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
  fs.utimesSync(newer, new Date("2026-02-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z"));

  const siblings = config
    .readCliproxyAccounts()
    .filter((account) => account.provider === "kimi");
  assert.deepEqual(
    siblings.map((account) => account.account),
    ["older@example.com", "newer@example.com"],
  );
  assert.ok(siblings[0].connectedAt < siblings[1].connectedAt);
});

test("an empty auth dir is not an error", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "bb-cliproxy-empty-"));
  const previous = process.env.CLIPROXY_HOME;
  process.env.CLIPROXY_HOME = empty;
  try {
    assert.deepEqual(config.readCliproxyAccounts(), []);
    assert.equal(config.isCliproxyInstalled(), false);
  } finally {
    process.env.CLIPROXY_HOME = previous;
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test("ChatMock registers cliproxy as a keyless provider", () => {
  const catalog = source("../chatmock/chatmock/providers/catalog.py");
  assert.match(catalog, /id="cliproxy"/);
  // Subscription models must not demand an API key from the user.
  assert.match(catalog, /id="cliproxy"[\s\S]*?requires_api_key=False/);
  assert.match(catalog, /CLIPROXY_API_KEY/);
  assert.match(catalog, /CLIPROXY_BASE_URL/);
});

test("the launcher is cached, escapable, and never vendors the binary", () => {
  const launcher = source("../scripts/start-cliproxy.mjs");
  assert.match(launcher, /mode === "disabled"/);
  assert.match(launcher, /releases\/latest/);
  assert.match(launcher, /WRITABLE_PATH/);
  // Regenerated each launch so a stale port or secret cannot win.
  assert.match(launcher, /renderCliproxyConfig\(\)/);
});

test("the subscription proxy is required by default, in both launchers", () => {
  // Not optional: without it every subscription model silently disappears, and
  // the only clue is a log line nobody reads.
  const launcher = source("../scripts/start-cliproxy.mjs");
  assert.match(launcher, /CLIPROXY_MODE\?\.trim\(\)\.toLowerCase\(\) \|\| "required"/);

  const devAll = source("../scripts/dev-all.mjs");
  assert.match(devAll, /CLIPROXY_MODE\?\.trim\(\)\.toLowerCase\(\) \|\| "required"/);
  // A failed health check must abort the stack in required mode.
  assert.match(devAll, /if \(cliproxyMode === "required"\) throw error;/);
  // The escape hatches still exist for offline machines.
  assert.match(devAll, /cliproxyMode !== "disabled"/);
});

test("dev-all shares the bearer with ChatMock and probes with it", () => {
  const devAll = source("../scripts/dev-all.mjs");
  assert.match(devAll, /start-cliproxy\.mjs/);
  assert.match(devAll, /CLIPROXY_BASE_URL: cliproxyBaseUrlValue/);
  // The probe must authenticate or a healthy proxy's 401 reads as "starting".
  assert.match(devAll, /Authorization: `Bearer \$\{cliproxyApiKeyValue\}`/);
});

test("the panel no longer tells the user to opt in", () => {
  // The proxy card is gone; how to start the proxy is now said beside the
  // sign-in buttons it disables, which is the only place it was ever needed.
  const panel = source("src/app/components/settings-accounts.tsx");
  assert.doesNotMatch(panel, /CLIPROXY_MODE=optional/);
  assert.match(panel, /npm run cliproxy/);
  assert.match(panel, /subscriptions\?\.installed/);
});

test("cliproxy routes authenticate the session and never leak the token", () => {
  for (const route of [
    "src/app/api/cliproxy/status/route.ts",
    "src/app/api/cliproxy/login/route.ts",
    "src/app/api/cliproxy/sync/route.ts",
  ]) {
    const text = source(route);
    assert.match(text, /await requireUserId\(\)/, `${route} must authenticate`);
  }

  // The browser gets a sign-in URL and a state, never a credential.
  const login = source("src/app/api/cliproxy/login/route.ts");
  assert.doesNotMatch(login, /cliproxyManagementKey|cliproxyApiKey/);
});

test("the sign-in panel polls and then syncs the unlocked models", () => {
  // Signing in is the account list's job, so the poll that finishes it lives
  // there too — beside the row the new credential becomes.
  const panel = source("src/app/components/settings-accounts.tsx");
  assert.match(panel, /\/api\/cliproxy\/login\?state=/);
  assert.match(panel, /\/api\/cliproxy\/sync/);
  // Device-code providers must show the code, or the flow is unusable.
  assert.match(panel, /userCode/);
});

test("a sign-in that completed unobserved still takes effect", () => {
  // The poll only runs while the panel is mounted with a login pending. A
  // sign-in finished after the panel closed left the credential in the proxy
  // but its models absent from ChatMock — connected, yet nothing worked. This
  // reconcile was the proxy card's one irreplaceable job, so it moved into the
  // account list rather than being deleted with it.
  const panel = source("src/app/components/settings-accounts.tsx");
  assert.match(panel, /reconciledRef/);
  assert.match(panel, /subscriptions\.accounts\.length/);
  assert.match(panel, /syncSubscriptionModels/);
});

test("pay-per-token providers stay hidden except explicit setup integrations", () => {
  const settings = source("src/app/components/settings-providers.tsx");
  // Breadboard runs on subscriptions; a pay-per-token provider only appears
  // when a key was explicitly stored, never from a stray environment variable.
  // Google and OpenRouter are the setup-first exceptions, so a quota-limited
  // subscription user can configure either API-key recovery path.
  assert.match(settings, /provider\.id === "google"/);
  assert.match(settings, /provider\.id === "openrouter"/);
  assert.match(settings, /!provider\.requiresApiKey/);
  assert.match(settings, /provider\.hasStoredKey/);
  assert.match(settings, /visibleProviders\.map/);
});

test("usage limits are scoped to the plan they actually describe", () => {
  const popover = source("src/app/components/usage-limits-popover.tsx");
  assert.match(popover, /activeModel/);
  assert.match(popover, /isChatgptModel/);
  assert.match(popover, /providerUsageLink/);
  assert.match(popover, /target="_blank"/);
  // Google and Claude subscription models have their own read-only quota
  // snapshots. Other external providers remain excluded from polling.
  assert.match(popover, /isGoogleSubscriptionModel/);
  assert.match(popover, /isClaudeSubscriptionModel/);
  assert.match(popover, /query\.set\("model", activeModel\)/);
  assert.match(
    popover,
    /!isChatgptModel\(activeModel\)\s*&&\s*!googleUsageActive\s*&&\s*!claudeUsageActive/,
  );
  assert.match(popover, /Google-reported model quota/);
  assert.match(popover, /Anthropic-reported subscription usage/);

  const composer = source("src/app/components/assistant-composer.tsx");
  assert.match(composer, /activeModel=\{model\}/);
});

test("environment API keys do not configure pay-per-token providers", () => {
  // A stray OPENAI_API_KEY (frequently ChatMock's own `local` placeholder)
  // was marking OpenAI configured and filling the model picker with ids that
  // answer 401. Env keys for key-requiring providers are now opt-in.
  const store = source("../chatmock/chatmock/providers/store.py");
  assert.match(store, /def env_provider_keys_allowed\(\)/);
  assert.match(store, /CHATMOCK_ALLOW_ENV_PROVIDER_KEYS/);
  assert.match(store, /if spec\.requires_api_key and not env_provider_keys_allowed\(\)/);

  // The settings list keys off a *stored* credential, not a resolved one.
  const settings = source("src/app/components/settings-providers.tsx");
  assert.match(settings, /provider\.hasStoredKey/);
  assert.match(settings, /provider\.id === "google"/);
  assert.match(settings, /provider\.id === "openrouter"/);
});

test("Google reconnect sync uses the fresh rich model catalog", () => {
  const management = source("src/lib/cliproxy/management.ts");
  assert.match(
    management,
    /searchParams\.set\("client_version", "breadboard"\)/,
  );

  assert.deepEqual(
    cliproxyModelIdsFromPayload({
      models: [
        { slug: "gemini-3.7-flash-high", visibility: "list" },
        { id: "gemini-3.7-flash-low" },
        { slug: "gemini-3.7-flash-low" },
        { slug: "internal-hidden-model", visibility: "hide" },
      ],
    }),
    ["gemini-3.7-flash-high", "gemini-3.7-flash-low"],
  );
  assert.deepEqual(
    cliproxyModelIdsFromPayload({
      data: [{ id: "gemini-2.5-pro" }, { id: "gemini-2.5-flash" }],
    }),
    ["gemini-2.5-pro", "gemini-2.5-flash"],
  );
});

test("model labels drop the routing prefix", async () => {
  const { formatAssistantModelName } = await import("../src/lib/ai-models.ts");
  // A column of "cliproxy/claude-…" buries the part that tells them apart. The
  // provider is still on screen — as the section heading the model sits under.
  assert.equal(formatAssistantModelName("cliproxy/claude-fable-5"), "Claude Fable 5");
  assert.equal(
    formatAssistantModelName("openrouter/google/gemini-3.7-flash-high"),
    "Gemini 3.7 Flash High",
  );
  assert.equal(formatAssistantModelName("gpt-5.6-sol"), "GPT-5.6 Sol");
  assert.equal(formatAssistantModelName("default"), "Background model");
});

test("credential filenames yield the account they belong to", () => {
  const dir = config.cliproxyAuthDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "claude-someone@example.com.json"), "{}");

  // Match the exact file: a sibling test seeds other claude-* credentials into
  // this same scratch directory.
  const claude = config
    .readCliproxyAccounts()
    .find((account) => account.file === "claude-someone@example.com.json");
  assert.equal(claude.account, "someone@example.com");
  assert.equal(claude.label, "Claude");
});

test("each vendor is offered once, by the account list's rows", () => {
  const settings = source("src/app/components/settings-providers.tsx");
  // ChatGPT and the proxy are offered in the account list, so a provider card
  // for either would be the same entry twice under two names.
  assert.match(settings, /provider\.kind !== "chatgpt_oauth"/);
  assert.match(settings, /provider\.id !== "cliproxy"/);
  assert.doesNotMatch(settings, /isChatgpt/);

  // The proxy card kept a second copy of that vendor list. It is gone entirely
  // now: one list, where connected rows can switch or add and disconnected
  // providers can connect directly.
  assert.doesNotMatch(settings, /SettingsSubscriptions/);
  assert.equal(
    fs.existsSync(new URL("../src/app/components/settings-subscriptions.tsx", import.meta.url)),
    false,
  );

  const accounts = source("src/app/components/settings-accounts.tsx");
  assert.match(accounts, /\.filter\(\(provider\) => !provider\.connected\)/);
  assert.match(accounts, /Add another/);
  assert.doesNotMatch(accounts, /Add an account/);
  assert.doesNotMatch(accounts, />\s*Refresh\s*</);
});

test("a single-account vendor shows but disables the second-account action", () => {
  // Claude's credential belongs to the Claude Code CLI, which keeps a single
  // login. The row keeps the same action layout as every provider, but does not
  // pretend that clicking Add another can create a sibling credential.
  assert.equal(config.cliproxyProvider("claude").singleAccount, true);
  for (const id of ["antigravity", "kimi", "xai"]) {
    assert.notEqual(config.cliproxyProvider(id).singleAccount, true, id);
  }

  const management = source("src/lib/cliproxy/management.ts");
  assert.match(management, /singleAccount: provider\.singleAccount === true/);

  const accounts = source("src/app/components/settings-accounts.tsx");
  assert.match(accounts, /provider\?\.singleAccount !== true/);
  assert.match(accounts, /disabled=\{!supportsMultiple \|\| busy !== null \|\| pendingSignIn\}/);
  assert.match(accounts, /supports one account at a time/);
});

test("connectedness is stated once per page, by the account list's dots", () => {
  // The list has a dot per account, and it is the only thing on the page that
  // reports connectedness — the proxy card that also counted signed-in
  // accounts has been removed.
  const providers = source("src/app/components/settings-providers.tsx");
  assert.doesNotMatch(providers, /subscription accounts signed in|Subscription proxy/);

  const accounts = source("src/app/components/settings-accounts.tsx");
  assert.match(accounts, /function ConnectionDot/);
  assert.match(accounts, /Not connected/);
  assert.doesNotMatch(accounts, /ConnectedBadge/);
});

test("an account connected in either half of the page reaches the other", () => {
  // Both halves are mounted at once, so neither remounts on the way back from
  // the other. A provider connected below announces itself for the model
  // pickers; the account list listens rather than going stale.
  const accounts = source("src/app/components/settings-accounts.tsx");
  assert.match(accounts, /ASSISTANT_MODELS_CHANGED_EVENT/);
  assert.match(accounts, /addEventListener\(ASSISTANT_MODELS_CHANGED_EVENT/);

  const providers = source("src/app/components/settings-providers.tsx");
  assert.match(providers, /notifyAssistantModelsChanged\(\)/);
});

test("the Account tab is one list of every account", () => {
  const dialog = source("src/app/components/settings-dialog.tsx");
  assert.match(dialog, /Every account Breadboard is signed in to/);
  // One panel, not a ChatGPT box beside a Subscriptions box — they are the
  // same kind of thing and read as two when split.
  assert.match(dialog, /<SettingsAccounts \/>/);
  assert.doesNotMatch(dialog, /SettingsSubscriptionAccounts/);
  assert.doesNotMatch(dialog, /SettingsChatgptAccount/);

  const accounts = source("src/app/components/settings-accounts.tsx");
  assert.match(accounts, /\/api\/chatmock\/account/);
  assert.match(accounts, /\/api\/chatmock\/accounts/);
  assert.match(accounts, /\/api\/cliproxy\/status/);
  // Rows are named after the vendor, matching the model picker's headings.
  assert.match(accounts, /subscription\.vendorLabel/);
  assert.match(accounts, /OpenAI/);
});
