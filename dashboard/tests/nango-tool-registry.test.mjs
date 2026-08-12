import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(new URL(`../${relativePath}`, import.meta.url));
}

test("Breadboard derives its connection catalog from the cloned Nango providers", () => {
  const nangoPackage = JSON.parse(source("../nango/package.json"));
  const providers = source("../nango/packages/providers/providers.yaml");
  const catalog = source("src/lib/nango/catalog.ts");

  assert.equal(typeof nangoPackage.version, "string");
  for (const provider of [
    "google-mail:",
    "google-calendar:",
    "slack:",
    "github:",
    "outlook:",
    "microsoft-teams:",
    "notion:",
  ]) {
    assert.match(providers, new RegExp(`^${provider}`, "m"));
  }
  assert.match(catalog, /"packages",\s*"providers",\s*"providers\.yaml"/);
  assert.match(catalog, /breadboard-\$\{slug\}/);
  assert.match(catalog, /const FEATURED/);
  assert.match(catalog, /\/api\/hermes\/nango\/integrations\/logo/);
});

test("Breadboard owns OAuth state and stores provider tokens in its encrypted vault", () => {
  const schema = source("src/lib/nango/schema.ts");
  const broker = source("src/lib/connected-apps/broker.ts");
  const vault = source("src/lib/connected-apps/vault.ts");

  assert.match(broker, /beginEmbeddedOAuth/);
  assert.match(broker, /completeEmbeddedOAuth/);
  assert.match(broker, /embeddedProviderRequest/);
  assert.match(vault, /aes-256-gcm/);
  assert.match(vault, /BREADBOARD_CONNECTION_VAULT_KEY/);
  assert.doesNotMatch(broker, /NANGO_API_KEY|api\.nango\.dev/);

  assert.match(schema, /CREATE TABLE IF NOT EXISTS nango_connections/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS connected_app_credentials/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS connected_app_oauth_states/);
  assert.match(schema, /UNIQUE\(user_id, slug\)/);
  assert.match(schema, /encrypted_value\s+TEXT NOT NULL/);
  assert.doesNotMatch(schema, /access_token|refresh_token|client_secret|api_key/i);
});

test("connection setup uses Breadboard's embedded one-provider OAuth broker", () => {
  assert.ok(exists("src/lib/nango/service.ts"));
  assert.ok(exists("src/app/api/hermes/nango/route.ts"));
  assert.ok(exists("src/app/api/hermes/nango/integrations/route.ts"));

  const service = source("src/lib/nango/service.ts");
  const route = source("src/app/api/hermes/nango/route.ts");

  assert.match(service, /beginEmbeddedOAuth/);
  assert.match(service, /connectionVaultConfigured/);
  assert.match(service, /provider: "Breadboard"/);
  assert.doesNotMatch(service, /api\.nango\.dev|NANGO_API_KEY/);
  assert.doesNotMatch(service, /access_token|refresh_token|oauth_tokens_json/i);

  assert.match(route, /requireUserId/);
  assert.match(route, /beginNangoProviderConnection/);
  assert.match(route, /nangoConnectionStatus\(userId, true\)/);
  assert.match(route, /removeNangoConnection/);
  assert.doesNotMatch(route, /client_secret|access_token|refresh_token/i);
});

test("Nango exposes typed core app actions plus a policy-gated generic provider request", () => {
  assert.ok(exists("src/lib/nango/actions.ts"));
  const actions = source("src/lib/nango/actions.ts");

  for (const action of [
    "gmail_list_messages",
    "gmail_get_message",
    "gmail_send_message",
    "slack_list_conversations",
    "slack_post_message",
    "github_list_repositories",
    "github_create_issue",
    "google_calendar_list_events",
    "google_calendar_create_event",
    "outlook_list_messages",
    "outlook_send_mail",
    "teams_list_joined_teams",
    "teams_send_channel_message",
    "notion_search",
    "notion_create_page",
    "provider_api_request",
  ]) {
    assert.match(actions, new RegExp(`["']${action}["']`));
  }
  assert.match(actions, /readOnly/);
  assert.match(actions, /method/);
  assert.match(actions, /nangoAction/);
});

test("each turn merges Composio-backed actions with local and installed MCP tools", () => {
  const registry = source("src/lib/hermes/unified-tool-registry.ts");
  const turnService = source("src/lib/conversations/turn-service.ts");
  const mcpRoute = source("src/app/api/hermes/tools/mcp/route.ts");
  const hermesTool = source("../hermes-config/tool/mcp.ts");

  assert.match(registry, /COMPOSIO_RUNTIME_NAME/);
  assert.match(registry, /composioConnectedIntegrationSlugs/);
  assert.match(registry, /mcp_call/);
  assert.match(registry, /nangoAction/);
  assert.match(registry, /connectionNames/);
  assert.match(turnService, /\.\.\.connectedApps\.connectionNames/);
  assert.match(turnService, /\.\.\.connectedApps\.tools/);
  assert.match(turnService, /connectedApps\.systemContext/);

  assert.match(mcpRoute, /decision\.selectedConnections\.includes\(slug\)/);
  assert.match(mcpRoute, /COMPOSIO_RUNTIME_NAME/);
  assert.match(mcpRoute, /executeComposioAction/);
  assert.match(mcpRoute, /readOnly/);
  assert.match(mcpRoute, /decision\.mode !== "scoped_implementation"/);

  assert.match(hermesTool, /export const call = tool/);
  assert.match(hermesTool, /\/api\/hermes\/tools\/mcp/);
  assert.match(hermesTool, /connected_app_permission_required/);
  assert.match(hermesTool, /ctx\.ask/);
});

test("the Connections surface uses Composio while the embedded broker remains retained", () => {
  // Connections live in Settings → Connections, reached from the composer's
  // Intelligence menu; the capability palette no longer carries them.
  const connections = source("src/app/components/settings-connections.tsx");
  const dialog = source("src/app/components/settings-dialog.tsx");
  const palette = source("src/app/components/hermes/command-hub.tsx");

  assert.match(dialog, /value: "connections",\s*\n\s*label: "Connections"/);
  assert.match(dialog, /visitedTabs\.has\("connections"\)[\s\S]*<SettingsConnections \/>/);
  assert.match(connections, /\/api\/hermes\/composio/);
  assert.match(connections, /provider: "Composio"/);
  assert.match(connections, /connectApp\(integration\)/);
  assert.match(connections, /placeholder="Search connections"/);
  assert.match(
    connections,
    /Connections securely link external apps to Breadboard/,
  );
  assert.match(connections, /refreshAfterExternalAuthorization/);
  assert.match(connections, /visibilitychange/);
  assert.doesNotMatch(connections, /\/api\/hermes\/activepieces/);
  assert.doesNotMatch(connections, /Activepieces/i);
  assert.match(connections, /through Composio/);
  assert.match(
    connections,
    /role="status" className="mx-1 text-xs text-\[var\(--botanical\)\]"/,
  );
  assert.doesNotMatch(connections, /text-\[#8a6f00\]/);
  assert.doesNotMatch(palette, /\/api\/hermes\/composio/);
  assert.ok(exists("src/app/api/hermes/nango/route.ts"));
  assert.ok(exists("src/lib/connected-apps/broker.ts"));
  assert.ok(exists("src/app/api/hermes/composio/route.ts"));
  assert.ok(exists("src/lib/composio/service.ts"));
  assert.ok(exists("src/lib/composio/executor.ts"));
  assert.equal(exists("src/app/api/hermes/activepieces/route.ts"), false);
  assert.equal(exists("src/lib/activepieces/service.ts"), false);
});
