import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const providers = await import("../src/lib/chatmock-providers.ts");
const aiModels = await import("../src/lib/ai-models.ts");
const modelProvider = await import("../src/lib/ui-tars/model-provider.ts");

test("provider ids are constrained to the catalog's shape", () => {
  assert.equal(providers.isValidProviderId("anthropic"), true);
  assert.equal(providers.isValidProviderId("openrouter"), true);
  // Path traversal and injection attempts never reach ChatMock's URL.
  assert.equal(providers.isValidProviderId("../../etc/passwd"), false);
  assert.equal(providers.isValidProviderId("anthropic/claude"), false);
  assert.equal(providers.isValidProviderId(""), false);
  assert.equal(providers.isValidProviderId(undefined), false);
  assert.equal(providers.isValidProviderId("a".repeat(33)), false);
});

test("an unreachable proxy is reported as a 503, not a 500", () => {
  const unreachable = providers.providerErrorResponseInit(
    new providers.ChatmockUnreachableError(new Error("ECONNREFUSED")),
  );
  assert.equal(unreachable.status, 503);
  assert.match(unreachable.message, /not reachable/i);

  const upstream = providers.providerErrorResponseInit(
    new providers.ChatmockRequestError(400, "bad model"),
  );
  assert.equal(upstream.status, 400);
  assert.equal(upstream.message, "bad model");
});

test("the global model sentinel is what subsystems send by default", () => {
  assert.equal(aiModels.GLOBAL_MODEL_SENTINEL, "default");
  assert.equal(modelProvider.chatmockModel({}), "default");
  // An explicit pin still wins over the global choice.
  assert.equal(
    modelProvider.chatmockModel({ CHATMOCK_MODEL: "gpt-5.6-terra" }),
    "gpt-5.6-terra",
  );
});

test("every subsystem launcher defaults CHATMOCK_MODEL to the sentinel", () => {
  const launchers = [
    "../scripts/start-hermes.mjs",
    "../scripts/start-hermes.mjs",
    "../scripts/start-deep-research.mjs",
    "../scripts/dev-all.mjs",
  ];
  for (const launcher of launchers) {
    const text = source(launcher);
    assert.match(
      text,
      /CHATMOCK_MODEL\s*\|\|\s*"default"/,
      `${launcher} should fall back to the global background model`,
    );
    assert.doesNotMatch(
      text,
      /CHATMOCK_MODEL\s*\|\|\s*"gpt-5\.6-sol"/,
      `${launcher} should not pin a model`,
    );
  }
});

test("Breadboard enables Hermes tool search for compact provider requests", () => {
  for (const file of ["../scripts/start-hermes.mjs", "../native/runtime-core/src/service_environment.rs"]) {
    const text = source(file);
    assert.match(text, /tools:[\s\S]*?tool_search:[\s\S]*?enabled: on/);
  }
});

test("the desktop shell passes the sentinel to its services", () => {
  const definitions = source("../desktop/src/main/service-definitions.ts");
  assert.doesNotMatch(definitions, /CHATMOCK_MODEL"\]\s*\?\?\s*"gpt-5\.6-sol"/);
  assert.match(definitions, /CHATMOCK_MODEL"\]\s*\?\?\s*"default"/);
});

test("the providers panel is reachable, on the Accounts tab", () => {
  const dialog = source("src/app/components/settings-dialog.tsx");
  assert.match(dialog, /<SettingsProviders \/>/);
  // Accounts and providers are one page. A tab of its own would put "the
  // accounts I have" and "how I get another" behind different clicks again.
  assert.doesNotMatch(dialog, /value: "providers"/);
  assert.match(dialog, /label: "Accounts"/);
  // And neither half sends the reader to the other: those two buttons only
  // scrolled, which is a jump that signs nothing in.
  assert.doesNotMatch(dialog, /scrollIntoView/);
  assert.doesNotMatch(dialog, /onOpenAccount|onOpenProviders/);
});

test("the providers panel never renders a stored key back to the browser", () => {
  const panel = source("src/app/components/settings-providers.tsx");
  // Drafts start blank on every load and the API only ever returns a hint.
  assert.match(panel, /apiKey: ""/);
  assert.match(panel, /type="password"/);
  assert.doesNotMatch(panel, /provider\.apiKey\b/);
});

test("Google AI Studio and OpenRouter setup stay visible before keys are saved", () => {
  const panel = source("src/app/components/settings-providers.tsx");
  assert.match(panel, /provider\.id === "google"/);
  assert.match(panel, /provider\.id === "openrouter"/);
  assert.match(panel, /type="password"/);
});

test("connected providers use the account row's accessible green status dot", () => {
  const panel = source("src/app/components/settings-providers.tsx");
  assert.match(panel, /badge\?\.tone === "connected"/);
  assert.match(panel, /role="status"/);
  assert.match(panel, /aria-label=\{badge\.text\}/);
  assert.match(panel, /h-2 w-2 shrink-0 rounded-full bg-\[var\(--botanical\)\]/);
  assert.doesNotMatch(panel, /color-mix\(in_srgb,var\(--botanical\)/);
});

test("provider routes require a session before touching ChatMock", () => {
  for (const route of [
    "src/app/api/chatmock/providers/route.ts",
    "src/app/api/chatmock/providers/verify/route.ts",
    "src/app/api/chatmock/default-model/route.ts",
  ]) {
    const text = source(route);
    assert.match(text, /await requireUserId\(\)/, `${route} must authenticate`);
  }
});

test("the provider update route forwards only the fields it understands", () => {
  const route = source("src/app/api/chatmock/providers/route.ts");
  for (const field of ["apiKey", "baseUrl", "enabled", "models"]) {
    assert.match(route, new RegExp(`update\\.${field}`), `${field} should be forwarded`);
  }
  assert.match(route, /isValidProviderId\(body\.providerId\)/);
});
