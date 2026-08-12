// The real-Postiz layer: config resolution, the generated compose override, the
// wall-clock↔instant boundary, and the public API client's contract.
//
// Docker itself is never invoked here — these cover the parts that decide what
// Docker is asked to do, and what Postiz is sent once it answers.

import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import http from "node:http";
import { tmpdir } from "node:os";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { socialsManagerMode, resolveSocialsManagerConfig } from "../src/lib/socials-manager/config.ts";
import {
  containerCliCandidates,
  suppressDesktopDashboard,
} from "../src/lib/socials-manager/docker.ts";
import { renderOverride } from "../src/lib/socials-manager/stack.ts";
import { ensureApiKey } from "../src/lib/socials-manager/bootstrap.ts";
import {
  PostizApiClient,
  PostizApiError,
  isoToWallClock,
  wallClockToIso,
} from "../src/lib/socials-manager/api-client.ts";
import { integrationFor, publishToPostiz } from "../src/lib/socials-manager/service.ts";

const credentials = {
  email: "breadboard@localhost.local",
  password: "pw",
  apiKey: "key-123",
  jwtSecret: "secret-abc",
  createdAt: "2026-08-01T00:00:00.000Z",
};

// ----------------------------------------------------------------- config

test("the stack is the default mode", () => {
  assert.equal(socialsManagerMode({}), "stack");
  assert.equal(socialsManagerMode({ SOCIALS_MANAGER_MODE: "adapter" }), "adapter");
  assert.equal(socialsManagerMode({ SOCIALS_MANAGER_MODE: "disabled" }), "disabled");
});

test("the public API root is derived from the app url", () => {
  const config = resolveSocialsManagerConfig({ SOCIALS_MANAGER_URL: "http://localhost:4007" });
  assert.equal(config.publicApiUrl, "http://localhost:4007/api/public/v1");
  assert.equal(config.appApiUrl, "http://localhost:4007/api");
});

test("a trailing slash in the url does not double up", () => {
  const config = resolveSocialsManagerConfig({ SOCIALS_MANAGER_URL: "http://localhost:4007/" });
  assert.equal(config.publicApiUrl, "http://localhost:4007/api/public/v1");
});

test("Docker auto-start is on unless explicitly turned off", () => {
  assert.equal(resolveSocialsManagerConfig({}).autoStartDocker, true);
  assert.equal(
    resolveSocialsManagerConfig({ SOCIALS_MANAGER_AUTOSTART_DOCKER: "false" }).autoStartDocker,
    false,
  );
});

test("Docker's dashboard is suppressed by default for background startup", () => {
  assert.equal(resolveSocialsManagerConfig({}).suppressDockerUi, true);
  assert.equal(
    resolveSocialsManagerConfig({ SOCIALS_MANAGER_SUPPRESS_DOCKER_UI: "false" }).suppressDockerUi,
    false,
  );
});

// ------------------------------------------------------------------ engine

test("packaged startup can find a container CLI without the shell PATH", () => {
  const candidates = containerCliCandidates("docker", {
    ProgramFiles: "C:\\Program Files",
    HOME: "/Users/breadboard",
  });
  assert.equal(candidates.at(-1), "docker");
  if (process.platform === "win32") {
    assert.equal(
      candidates[0],
      path.join("C:\\Program Files", "Docker", "Docker", "resources", "bin", "docker.exe"),
    );
  } else {
    assert.ok(candidates.some((candidate) => path.isAbsolute(candidate)));
  }
});

test("the dashboard suppression adds its key without dropping other settings", (t) => {
  if (process.platform !== "win32") return t.skip("Windows settings path");
  const appData = mkdtempSync(path.join(tmpdir(), "bb-docker-"));
  mkdirSync(path.join(appData, "Docker"), { recursive: true });
  const settings = path.join(appData, "Docker", "settings-store.json");
  writeFileSync(settings, JSON.stringify({ AutoStart: false }), "utf8");

  assert.equal(suppressDesktopDashboard({ APPDATA: appData }), true);

  const written = JSON.parse(readFileSync(settings, "utf8"));
  assert.equal(written.OpenUIOnStartupDisabled, true);
  assert.equal(written.AutoStart, false);
});

test("suppression is idempotent and creates the file when absent", (t) => {
  if (process.platform !== "win32") return t.skip("Windows settings path");
  const appData = mkdtempSync(path.join(tmpdir(), "bb-docker-"));

  assert.equal(suppressDesktopDashboard({ APPDATA: appData }), true);
  assert.equal(suppressDesktopDashboard({ APPDATA: appData }), true);

  const written = JSON.parse(
    readFileSync(path.join(appData, "Docker", "settings-store.json"), "utf8"),
  );
  assert.equal(written.OpenUIOnStartupDisabled, true);
});

test("a malformed settings file is not allowed to break startup", (t) => {
  if (process.platform !== "win32") return t.skip("Windows settings path");
  const appData = mkdtempSync(path.join(tmpdir(), "bb-docker-"));
  mkdirSync(path.join(appData, "Docker"), { recursive: true });
  writeFileSync(
    path.join(appData, "Docker", "settings-store.json"),
    "{ not json",
    "utf8",
  );
  assert.equal(suppressDesktopDashboard({ APPDATA: appData }), false);
});

// --------------------------------------------------------------- override

test("the override carries a real secret and the published port", () => {
  const config = resolveSocialsManagerConfig({ SOCIALS_MANAGER_URL: "http://localhost:4007" });
  const yaml = renderOverride(config, credentials, {});

  assert.match(yaml, /JWT_SECRET: 'secret-abc'/);
  assert.match(yaml, /MAIN_URL: 'http:\/\/localhost:4007'/);
  assert.match(yaml, /NEXT_PUBLIC_BACKEND_URL: 'http:\/\/localhost:4007\/api'/);
  assert.match(yaml, /ports: !override/);
  assert.match(yaml, /- '127\.0\.0\.1:4007:5000'/);
});

test("NOT_SECURED is set so bootstrap can read the auth token back", () => {
  const config = resolveSocialsManagerConfig({ SOCIALS_MANAGER_URL: "http://localhost:4007" });
  // Without this Postiz only sets a Secure cookie, which a plain-http
  // server-side fetch drops — and the API key could never be obtained.
  assert.match(renderOverride(config, credentials, {}), /NOT_SECURED: 'true'/);
});

test("the app container waits for a healthy Temporal API", () => {
  const config = resolveSocialsManagerConfig({ SOCIALS_MANAGER_URL: "http://localhost:4567" });
  const yaml = renderOverride(config, credentials, {});
  assert.match(yaml, /postiz:[\s\S]*depends_on:[\s\S]*temporal:[\s\S]*condition: service_healthy/);
  assert.match(yaml, /temporal:[\s\S]*healthcheck:[\s\S]*operator', 'cluster', 'health'/);
});

test("bootstrap reads the current publicApi field and persists it", async () => {
  const stateDir = mkdtempSync(path.join(tmpdir(), "bb-postiz-bootstrap-"));
  const server = http.createServer((request, response) => {
    if (request.url === "/api/auth/register") {
      response.writeHead(200, { auth: "local-jwt" }).end('{"register":true}');
      return;
    }
    if (request.url === "/api/user/self") {
      assert.equal(request.headers.auth, "local-jwt");
      response.writeHead(200, { "content-type": "application/json" }).end(
        '{"publicApi":"organization-key"}',
      );
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("mock server has no port");
    const base = resolveSocialsManagerConfig({ SOCIALS_MANAGER_URL: `http://127.0.0.1:${address.port}` });
    const config = {
      ...base,
      stateDir,
      overrideFile: path.join(stateDir, "override.yaml"),
      credentialsFile: path.join(stateDir, "credentials.json"),
    };
    assert.equal(await ensureApiKey(config), "organization-key");
    assert.equal(JSON.parse(readFileSync(config.credentialsFile, "utf8")).apiKey, "organization-key");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("configured social OAuth apps are passed through, unset ones are not", () => {
  const config = resolveSocialsManagerConfig({ SOCIALS_MANAGER_URL: "http://localhost:4007" });
  const yaml = renderOverride(config, credentials, {
    LINKEDIN_CLIENT_ID: "li-id",
    LINKEDIN_CLIENT_SECRET: "li-secret",
    INSTAGRAM_APP_ID: "ig-id",
    INSTAGRAM_APP_SECRET: "ig-secret",
    TELEGRAM_TOKEN: "telegram-token",
    X_API_KEY: "   ",
  });

  assert.match(yaml, /LINKEDIN_CLIENT_ID: 'li-id'/);
  assert.match(yaml, /LINKEDIN_CLIENT_SECRET: 'li-secret'/);
  assert.match(yaml, /INSTAGRAM_APP_ID: 'ig-id'/);
  assert.match(yaml, /INSTAGRAM_APP_SECRET: 'ig-secret'/);
  assert.match(yaml, /TELEGRAM_TOKEN: 'telegram-token'/);
  assert.doesNotMatch(yaml, /X_API_KEY/);
});

test("a quote in a secret cannot break out of the YAML string", () => {
  const config = resolveSocialsManagerConfig({ SOCIALS_MANAGER_URL: "http://localhost:4007" });
  const yaml = renderOverride(config, { ...credentials, jwtSecret: "a'b" }, {});
  assert.match(yaml, /JWT_SECRET: 'a''b'/);
});

test("the override never edits the vendored clone", () => {
  const config = resolveSocialsManagerConfig({});
  assert.ok(!config.overrideFile.startsWith(config.cloneRoot));
});

// ------------------------------------------------------------------- time

test("wall-clock stamps convert to an instant and back unchanged", () => {
  const stamp = "2026-08-05T09:00";
  assert.equal(isoToWallClock(wallClockToIso(stamp)), stamp);
});

test("a malformed stamp does not produce an invalid date", () => {
  const reference = new Date("2026-08-01T12:00:00.000Z");
  assert.equal(wallClockToIso("not a time", reference), reference.toISOString());
});

test("an unparseable instant is reported rather than guessed at", () => {
  assert.equal(isoToWallClock("nonsense"), null);
});

// ------------------------------------------------------------- api client

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = original;
  };
}

function client() {
  return new PostizApiClient(
    resolveSocialsManagerConfig({ SOCIALS_MANAGER_URL: "http://localhost:4007" }),
    "key-123",
  );
}

test("the API key is sent raw, not as a Bearer token", async () => {
  let seen = null;
  const restore = stubFetch(async (url, init) => {
    seen = { url: String(url), headers: init.headers };
    return { ok: true, status: 200, async text() { return "[]"; } };
  });
  try {
    await client().listIntegrations();
  } finally {
    restore();
  }
  assert.equal(seen.url, "http://localhost:4007/api/public/v1/integrations");
  assert.equal(seen.headers.authorization, "key-123");
});

test("provider settings use Postiz's live catalog and public connection flow", async () => {
  const seen = [];
  const restore = stubFetch(async (url, init) => {
    seen.push({ url: String(url), init });
    if (String(url).endsWith("/api/integrations")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            social: [{
              identifier: "threads",
              name: "Threads",
              isExternal: false,
              isWeb3: false,
              isChromeExtension: false,
              customFields: [{ key: "identifier", label: "Identifier", type: "text" }],
            }],
          });
        },
      };
    }
    return { ok: true, status: 200, async text() { return '{"url":"state-1"}'; } };
  });
  try {
    const postiz = client();
    const catalog = await postiz.listProviderConnections();
    assert.equal(catalog[0].identifier, "threads");
    assert.equal(catalog[0].customFields[0].label, "Identifier");
    assert.equal(await postiz.createConnectionUrl("threads"), "state-1");
  } finally {
    restore();
  }
  assert.equal(seen[0].url, "http://localhost:4007/api/integrations");
  assert.equal(seen[1].url, "http://localhost:4007/api/public/v1/social/threads");
  assert.equal(seen[1].init.headers.authorization, "key-123");
});

test("credential-backed connections complete over the loopback app API", async () => {
  let seen = null;
  const restore = stubFetch(async (url, init) => {
    seen = { url: String(url), init, body: JSON.parse(init.body) };
    return { ok: true, status: 200, async text() { return "{}"; } };
  });
  try {
    await client().completeConnection({
      providerId: "threads",
      state: "state-1",
      code: "encoded-credentials",
      timezone: 180,
    });
  } finally {
    restore();
  }
  assert.equal(seen.url, "http://localhost:4007/api/integrations/social-connect/threads");
  assert.deepEqual(seen.body, {
    state: "state-1",
    code: "encoded-credentials",
    timezone: "180",
  });
  assert.equal(seen.init.headers.authorization, undefined);
});

test("a created post matches Postiz's CreatePostDto", async () => {
  let body = null;
  const restore = stubFetch(async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, status: 200, async text() { return '{"id":"remote-1"}'; } };
  });
  try {
    await client().createPost({
      integrationId: "int-1",
      content: "hello",
      scheduledAt: "2026-08-05T09:00",
    });
  } finally {
    restore();
  }

  assert.equal(body.type, "schedule");
  assert.equal(body.shortLink, false);
  assert.deepEqual(body.tags, []);
  assert.equal(body.date, wallClockToIso("2026-08-05T09:00"));
  assert.equal(body.posts.length, 1);
  assert.deepEqual(body.posts[0].integration, { id: "int-1" });
  assert.deepEqual(body.posts[0].value, [{ content: "hello", image: [] }]);
});

test("a remote draft is saved without being scheduled", async () => {
  let body = null;
  const restore = stubFetch(async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, status: 200, async text() { return '{"id":"draft-1"}'; } };
  });
  try {
    await publishToPostiz(
      session([{ id: "int-1", name: "Me", identifier: "x" }]),
      {
        providerId: "x",
        content: "keep this as a draft",
        scheduledAt: "2026-08-05T09:00",
        type: "draft",
      },
    );
  } finally {
    restore();
  }

  assert.equal(body.type, "draft");
});

test("an error status surfaces as a PostizApiError", async () => {
  const restore = stubFetch(async () => ({
    ok: false,
    status: 401,
    async text() { return "Invalid API key"; },
  }));
  try {
    await assert.rejects(
      () => client().listIntegrations(),
      (error) => error instanceof PostizApiError && error.status === 401,
    );
  } finally {
    restore();
  }
});

// --------------------------------------------------------------- routing

const session = (integrations) => ({
  client: client(),
  integrations,
  config: resolveSocialsManagerConfig({}),
});

test("a network routes to its connected Postiz channel", () => {
  const found = integrationFor(
    session([{ id: "int-1", name: "Me", identifier: "linkedin" }]),
    "linkedin",
  );
  assert.equal(found.id, "int-1");
});

test("a disabled channel is not used", () => {
  assert.equal(
    integrationFor(
      session([{ id: "int-1", name: "Me", identifier: "x", disabled: true }]),
      "x",
    ),
    null,
  );
});

test("an unconnected network is reported, not thrown", async () => {
  const outcome = await publishToPostiz(session([]), {
    providerId: "x",
    content: "hi",
    scheduledAt: "2026-08-05T09:00",
  });
  assert.equal(outcome.remoteId, null);
  assert.match(outcome.reason, /No x channel is connected/);
});

test("a rejected post reports the reason instead of failing the run", async () => {
  const restore = stubFetch(async () => ({
    ok: false,
    status: 400,
    async text() { return "bad request"; },
  }));
  try {
    const outcome = await publishToPostiz(
      session([{ id: "int-1", name: "Me", identifier: "x" }]),
      { providerId: "x", content: "hi", scheduledAt: "2026-08-05T09:00" },
    );
    assert.equal(outcome.remoteId, null);
    assert.match(outcome.reason, /bad request/);
  } finally {
    restore();
  }
});

test("a successful publish returns the remote id", async () => {
  const restore = stubFetch(async () => ({
    ok: true,
    status: 200,
    async text() { return '{"id":"remote-9"}'; },
  }));
  try {
    const outcome = await publishToPostiz(
      session([{ id: "int-1", name: "Me", identifier: "x" }]),
      { providerId: "x", content: "hi", scheduledAt: "2026-08-05T09:00" },
    );
    assert.equal(outcome.remoteId, "remote-9");
  } finally {
    restore();
  }
});
