import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function rootSource(relativePath) {
  return fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function dashboardSource(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("connected apps need no Nango service, Docker, or broker API key", () => {
  const rootEnv = rootSource(".env.example");
  const dashboardEnv = rootSource("dashboard/.env.example");
  const pkg = JSON.parse(rootSource("package.json"));
  const devAll = rootSource("scripts/dev-all.mjs");
  const start = rootSource("start.bat");

  for (const env of [rootEnv, dashboardEnv]) {
    assert.match(env, /^BREADBOARD_PUBLIC_URL=http:\/\/localhost:3000$/m);
    assert.match(env, /^BREADBOARD_CONNECTION_VAULT_KEY=$/m);
    assert.match(env, /^BREADBOARD_GOOGLE_CLIENT_ID=$/m);
    assert.match(env, /^BREADBOARD_GITHUB_CLIENT_ID=$/m);
    assert.match(env, /^BREADBOARD_OAUTH_CREDENTIALS_JSON=$/m);
    assert.match(env, /\/api\/hermes\/connections\/oauth\/callback/);
    assert.doesNotMatch(env, /NANGO_(?:API|SECRET|BASE|AUTOSTART)/);
    assert.doesNotMatch(env, /ACTIVEPIECES_/);
  }

  assert.equal(pkg.scripts["dev:nango"], undefined);
  assert.doesNotMatch(devAll, /start-nango|nango-local-env|api\.nango\.dev|docker/i);
  assert.match(start, /npm run dev/);
});

test("the embedded OAuth broker binds one-time state and PKCE to a user", () => {
  const broker = dashboardSource("src/lib/connected-apps/broker.ts");
  const schema = dashboardSource("src/lib/nango/schema.ts");
  const callback = dashboardSource(
    "src/app/api/hermes/connections/oauth/callback/route.ts",
  );

  assert.match(broker, /randomBytes\(32\)/);
  assert.match(broker, /stateHash\(state\)/);
  assert.match(broker, /code_challenge_method: "S256"/);
  assert.match(broker, /DELETE FROM connected_app_oauth_states/);
  assert.match(broker, /secureProviderUrl/);
  assert.match(broker, /url\.protocol !== "https:"/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS connected_app_oauth_states/);
  assert.match(schema, /user_id\s+INTEGER NOT NULL/);
  assert.match(schema, /state_hash\s+TEXT PRIMARY KEY/);
  assert.match(callback, /completeEmbeddedOAuth/);
  assert.match(callback, /Cache-Control/);
  assert.match(callback, /Content-Security-Policy/);
  assert.doesNotMatch(callback, /requireUserId/);
});

test("provider tokens are encrypted at rest and never stored in plaintext columns", () => {
  const vault = dashboardSource("src/lib/connected-apps/vault.ts");
  const schema = dashboardSource("src/lib/nango/schema.ts");

  assert.match(vault, /createCipheriv\("aes-256-gcm"/);
  assert.match(vault, /randomBytes\(12\)/);
  assert.match(vault, /cipher\.setAAD/);
  assert.match(vault, /cipher\.getAuthTag/);
  assert.match(vault, /BREADBOARD_CONNECTION_VAULT_KEY/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS connected_app_credentials/);
  assert.match(schema, /encrypted_value\s+TEXT NOT NULL/);
  assert.doesNotMatch(schema, /access_token|refresh_token|client_secret|api_key/i);
});

test("connected-app API calls remain server-side and response-bounded", () => {
  const broker = dashboardSource("src/lib/connected-apps/broker.ts");
  const executor = dashboardSource("src/lib/nango/executor.ts");

  assert.match(broker, /MAX_PROVIDER_RESPONSE_BYTES/);
  assert.match(broker, /AbortSignal\.timeout\(20_000\)/);
  assert.match(broker, /Authorization:/);
  assert.match(broker, /url\.origin !== base\.origin/);
  assert.match(executor, /embeddedProviderRequest/);
  assert.doesNotMatch(executor, /clientSecret|accessToken|refreshToken/);
});
