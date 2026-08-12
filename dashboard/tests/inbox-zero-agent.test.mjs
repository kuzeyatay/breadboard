import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  INBOX_ZERO_AGENT_ID,
  INBOX_ZERO_COMMAND,
  inboxZeroUserMessage,
  instruction,
  readsAsEmailWork,
  taskFromInboxZeroCommand,
} from "../src/lib/inbox-zero/identity.ts";
import {
  containerModelSettings,
  hasEmailProvider,
  renderOverride,
} from "../src/lib/inbox-zero/stack.ts";
import { resolveInboxZeroConfig } from "../src/lib/inbox-zero/config.ts";
import { signSessionToken } from "../src/lib/inbox-zero/session.ts";
import { inboxZeroDefaults } from "../src/lib/agent-settings/defaults.ts";
import { CONFIGURABLE_AGENTS } from "../src/lib/agent-settings/catalog.ts";
import {
  runtimeAgentById,
  runtimeAgentByToken,
} from "../src/lib/hermes/capability-combinations.ts";
import { EXTERNAL_AGENT_RUN_KINDS } from "../src/lib/conversations/external-agent-runs.ts";

function source(relative) {
  return fs.readFileSync(path.join(import.meta.dirname, "..", relative), "utf8");
}

const CREDENTIALS = {
  authSecret: "auth-secret",
  internalApiKey: "internal-key",
  redisToken: "redis-token",
  cronSecret: "cron-secret",
  postgresPassword: "pg-pass",
  googleClientId: "client-id.apps.googleusercontent.com",
  googleClientSecret: "GOCSPX-secret",
  microsoftClientId: "",
  microsoftClientSecret: "",
  createdAt: "2026-08-12T00:00:00.000Z",
};

test("the command token is recognised, and prose does not become an instruction", () => {
  assert.equal(taskFromInboxZeroCommand("what is in my inbox"), null);
  assert.equal(taskFromInboxZeroCommand("/agents:openscience do a thing"), null);
  // A bare token selects the agent; the person is still typing, so the caller
  // waits rather than launching an empty run.
  assert.equal(taskFromInboxZeroCommand(INBOX_ZERO_COMMAND), "");
  assert.equal(taskFromInboxZeroCommand(`  ${INBOX_ZERO_COMMAND}  `), "");
  assert.equal(
    taskFromInboxZeroCommand(`${INBOX_ZERO_COMMAND} archive everything from Stripe`),
    "archive everything from Stripe",
  );
  // Case-insensitive, and the two aliases people reach for reach the same agent.
  assert.equal(taskFromInboxZeroCommand("/AGENTS:INBOX-ZERO  reply to Ana"), "reply to Ana");
  assert.equal(taskFromInboxZeroCommand("/agents:email reply to Ana"), "reply to Ana");
  assert.equal(taskFromInboxZeroCommand("/agents:inboxzero reply to Ana"), "reply to Ana");
});

test("a stacked capability token is preserved so the resolver can refuse it", () => {
  // The token is not stripped here: the run route hands the instruction to
  // findCapabilityConflict, which is what produces the refusal message.
  assert.equal(
    taskFromInboxZeroCommand(`${INBOX_ZERO_COMMAND} /skill:unslop reply to Ana`),
    "/skill:unslop reply to Ana",
  );
});

test("the user half of the turn round-trips through the command", () => {
  assert.equal(inboxZeroUserMessage(""), INBOX_ZERO_COMMAND);
  assert.equal(inboxZeroUserMessage("   "), INBOX_ZERO_COMMAND);
  assert.equal(
    taskFromInboxZeroCommand(inboxZeroUserMessage("unsubscribe me from everything")),
    "unsubscribe me from everything",
  );
});

test("the agent's name is spelled the same in every registry", () => {
  assert.equal(INBOX_ZERO_COMMAND, `/agents:${INBOX_ZERO_AGENT_ID}`);
  const profile = runtimeAgentById(INBOX_ZERO_AGENT_ID);
  assert.ok(profile, "Inbox Zero is missing from the runtime agent table");
  assert.equal(runtimeAgentByToken(INBOX_ZERO_COMMAND), profile);
  // It writes to a real mailbox, so a model-selected launch still asks first.
  assert.equal(profile.launchableByModel, true);
  assert.equal(profile.requiresLaunchApproval, true);
  // The instruction reaches Inbox Zero's own assistant verbatim.
  assert.equal(profile.stacksCapabilities, false);
  assert.equal(profile.acceptsAttachments, false);

  assert.ok(EXTERNAL_AGENT_RUN_KINDS.includes("inbox_zero"));
  const entry = CONFIGURABLE_AGENTS.find((agent) => agent.id === INBOX_ZERO_AGENT_ID);
  assert.ok(entry, "Inbox Zero is missing from the settings catalog");
  assert.equal(entry.command, INBOX_ZERO_COMMAND);
});

test("read-only mode is stated to the assistant, not silently assumed", () => {
  // Breadboard is a client of Inbox Zero's API, not its owner, so this is an
  // instruction the assistant follows rather than a filter Breadboard enforces.
  // The test exists so the setting cannot quietly become a no-op.
  assert.equal(instruction("archive the newsletters", true), "archive the newsletters");
  const restricted = instruction("archive the newsletters", false);
  assert.match(restricted, /Read-only mode/);
  assert.match(restricted, /Do not archive, delete, label/);
  assert.ok(restricted.endsWith("archive the newsletters"));

  assert.equal(inboxZeroDefaults({}).allowActions, true);
  assert.equal(inboxZeroDefaults({ allowActions: false }).allowActions, false);
  assert.equal(inboxZeroDefaults({ mailbox: "  me@example.com " }).mailbox, "me@example.com");
});

test("the session cookie is signed the way better-auth verifies it", () => {
  // `apps/web/utils/mobile-auth/session-cookie.ts` builds the same value with
  // better-auth's makeSignature: base64url(HMAC-SHA256(secret, token)), unpadded.
  const signed = signSessionToken("token-value", "the-secret");
  const [token, signature] = signed.split(".");
  assert.equal(token, "token-value");
  assert.equal(
    signature,
    createHmac("sha256", "the-secret").update("token-value").digest("base64url"),
  );
  assert.doesNotMatch(signature, /=/, "the signature must be unpadded");
});

test("a mailbox needs an OAuth client the user owns", () => {
  assert.equal(hasEmailProvider({ ...CREDENTIALS }), true);
  // Half a client is not a client: both halves are needed before the app can
  // even offer the sign-in.
  assert.equal(hasEmailProvider({ ...CREDENTIALS, googleClientSecret: "" }), false);
  assert.equal(
    hasEmailProvider({
      ...CREDENTIALS,
      googleClientId: "",
      googleClientSecret: "",
      microsoftClientId: "id",
      microsoftClientSecret: "secret",
    }),
    true,
  );
});

test("the model settings reach the container by a hostname the container can resolve", () => {
  const settings = containerModelSettings({
    chatmockBaseUrl: "http://127.0.0.1:8000/v1",
    chatmockApiKey: "key",
    model: "default",
  });
  // `localhost` inside a container is the container. This is the whole reason
  // the URL is rewritten rather than passed through.
  assert.equal(settings.OPENAI_COMPATIBLE_BASE_URL, "http://host.docker.internal:8000/v1");
  assert.equal(settings.DEFAULT_LLMS, "openai-compatible:default");
  assert.equal(settings.OPENAI_COMPATIBLE_AUTH_HEADER, "Bearer key");

  // A remote ChatMock is left alone.
  assert.equal(
    containerModelSettings({
      chatmockBaseUrl: "https://chatmock.example.com/v1",
      chatmockApiKey: "key",
      model: "default",
    }).OPENAI_COMPATIBLE_BASE_URL,
    "https://chatmock.example.com/v1",
  );
});

test("the compose override carries the secrets and never edits the clone", () => {
  const config = resolveInboxZeroConfig({});
  const override = renderOverride(
    config,
    CREDENTIALS,
    containerModelSettings({
      chatmockBaseUrl: "http://localhost:8000/v1",
      chatmockApiKey: "key",
      model: "default",
    }),
  );
  assert.match(override, /AUTH_SECRET: 'auth-secret'/);
  assert.match(override, /GOOGLE_CLIENT_ID: 'client-id\.apps\.googleusercontent\.com'/);
  assert.match(override, /DATABASE_URL: 'postgresql:\/\/postgres:pg-pass@db:5432\/inboxzero/);
  assert.match(override, /NEXT_PUBLIC_BASE_URL: 'http:\/\/localhost:4021'/);
  // Published on loopback only: this is the user's mail, not a service on the
  // network.
  assert.match(override, /'127\.0\.0\.1:4021:3000'/);
  assert.match(override, /'127\.0\.0\.1:5442:5432'/);
  // The override lives in Breadboard's own state directory, so `git pull` in
  // the clone stays a plain fast-forward.
  assert.ok(!config.overrideFile.startsWith(config.cloneRoot));
});

test("the stack is started with the profiles its database and Redis live behind", () => {
  // Upstream hides db, redis and the Redis HTTP shim behind compose profiles.
  // A start that omits them brings up a web container with nothing behind it,
  // which crash-loops on a connection error rather than failing visibly.
  const stack = source("src/lib/inbox-zero/stack.ts");
  assert.match(stack, /const PROFILES = \["all", "queue-worker"\]/);
  assert.match(stack, /"--profile", profile/);
});

test("email work is routed to Inbox Zero in super agent mode", () => {
  const superAgent = source("src/lib/hermes/super-agent.ts");
  assert.match(superAgent, /## Email goes to Inbox Zero — always/);
  assert.match(superAgent, /agent_launch/);
  assert.match(superAgent, /INBOX_ZERO_AGENT_ID/);
  // The rule is only stated when the agent is actually in the inventory: a
  // directive naming an agent the turn cannot launch is worse than no rule.
  assert.match(superAgent, /inventory\.runtimeAgents\.some\(\(agent\) => agent\.id === INBOX_ZERO_AGENT_ID\)/);
  // Writing a message body the user asked for is still writing, not email.
  assert.match(superAgent, /is writing, not email/);
});

test("the email hint recognises mail work without swallowing ordinary writing", () => {
  assert.equal(readsAsEmailWork("did anyone email me about the invoice?"), true);
  assert.equal(readsAsEmailWork("clear my inbox"), true);
  assert.equal(readsAsEmailWork("unsubscribe me from these newsletters"), true);
  assert.equal(readsAsEmailWork("reply to Ana"), true);
  assert.equal(readsAsEmailWork("write a poem about the sea"), false);
  assert.equal(readsAsEmailWork("refactor the parser"), false);
});

test("the run route refuses a stacked capability and needs a model", () => {
  const route = source("src/app/api/inbox-zero/runs/route.ts");
  assert.match(route, /findCapabilityConflict/);
  assert.match(route, /activeRuntimeAgentId: "inbox-zero"/);
  assert.match(route, /model_not_configured/);
  // Follow-ups in one chat continue one Inbox Zero conversation, so "archive
  // those too" still knows which ones.
  assert.match(route, /conversationKey/);
});

test("health never starts the stack", () => {
  // Opening a settings panel must not cost a four-image pull, so the read-only
  // path observes and only a run may start containers.
  const health = source("src/app/api/inbox-zero/health/route.ts");
  assert.match(health, /setupStatus\(config\)/);
  assert.doesNotMatch(health, /startStack/);
  const service = source("src/lib/inbox-zero/service.ts");
  assert.match(service, /allowStart/);
});

test("the settings panel never echoes a secret back", () => {
  const health = source("src/app/api/inbox-zero/health/route.ts");
  // Only the presence of a client is reported, never its value.
  assert.match(health, /google: Boolean\(/);
  assert.doesNotMatch(health, /googleClientSecret:\s*credentials/);
  const setup = source("src/app/api/inbox-zero/setup/route.ts");
  // An empty field keeps what is stored: the panel shows secrets as blank, so
  // submitting the form must not erase one the user never saw.
  assert.match(setup, /text\(body\.googleClientSecret\) \|\| credentials\.googleClientSecret/);
});
