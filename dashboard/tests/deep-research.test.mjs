// Deep Research agent: config resolution, run-request validation, health
// normalization, and the loopback client's error mapping + ownership plumbing.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const source = (relativePath) =>
  fs.readFileSync(
    fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
    "utf8",
  );

const config = await import("../src/lib/deep-research/config.ts");
const client = await import("../src/lib/deep-research/client.ts");
const events = await import("../src/lib/deep-research/events.ts");
const identity = await import("../src/lib/deep-research/identity.ts");

// --- chat identity: the agent is reached only through its slash command -----

test("the command is recognized with or without a trailing question", () => {
  assert.equal(identity.DEEP_RESEARCH_SLASH_COMMAND, "/agents:deep-research");
  assert.equal(
    identity.taskFromDeepResearchCommand("/agents:deep-research tidal energy"),
    "tidal energy",
  );
  assert.equal(
    identity.taskFromDeepResearchCommand("  /Agents:Deep-Research  tides  "),
    "tides",
  );
  assert.equal(
    identity.taskFromDeepResearchCommand("/agents:deep-research"),
    "",
  );
  // Not the command: a normal prompt must never be hijacked.
  assert.equal(
    identity.taskFromDeepResearchCommand("research tidal energy"),
    null,
  );
  assert.equal(
    identity.taskFromDeepResearchCommand("do deep research on tidal energy"),
    null,
  );
  assert.equal(
    identity.taskFromDeepResearchCommand("/agents:deep-researchx tides"),
    null,
  );
  assert.equal(
    identity.taskFromDeepResearchCommand("/agents:agent-tars open example.com"),
    null,
  );
});

test("an explicit plain-language deep-research instruction launches the agent", () => {
  assert.equal(
    identity.taskFromDeepResearchIntent(
      "why is robotics considered the future, what would its consequences be to the world economy, do deep research",
    ),
    "why is robotics considered the future, what would its consequences be to the world economy",
  );
  assert.equal(
    identity.taskFromDeepResearchIntent(
      "Please conduct deep research on tidal energy",
    ),
    "tidal energy",
  );
  assert.equal(
    identity.taskFromDeepResearchIntent(
      "Could you use deep-research to compare battery chemistries?",
    ),
    "compare battery chemistries?",
  );
  assert.equal(identity.taskFromDeepResearchIntent("do deep research"), "");

  // Talking about the feature is not an instruction to launch it.
  assert.equal(
    identity.taskFromDeepResearchIntent("what is deep research?"),
    null,
  );
  assert.equal(
    identity.taskFromDeepResearchIntent("research tidal energy"),
    null,
  );
});

test("Super Agent keeps natural deep research private while slash commands stay explicit", () => {
  const natural = "compare battery chemistries, do deep research";
  assert.deepEqual(identity.directDeepResearchInvocation(natural, false), {
    task: "compare battery chemistries",
    selectAgent: false,
  });
  assert.equal(identity.directDeepResearchInvocation(natural, true), null);
  assert.deepEqual(
    identity.directDeepResearchInvocation(
      "/agents:deep-research compare battery chemistries",
      true,
    ),
    { task: "compare battery chemistries", selectAgent: true },
  );
});

test("a plain question uses the chat defaults", () => {
  assert.deepEqual(
    identity.parseResearchRequest("how do tidal turbines scale?"),
    {
      query: "how do tidal turbines scale?",
      breadth: identity.DEFAULT_BREADTH,
      depth: identity.DEFAULT_DEPTH,
      output: "report",
    },
  );
});

test("inline flags replace the removed dialog's controls", () => {
  assert.deepEqual(
    identity.parseResearchRequest("--answer -b 5 -d 3 who runs the grid?"),
    {
      query: "who runs the grid?",
      breadth: 5,
      depth: 3,
      output: "answer",
    },
  );
  assert.deepEqual(
    identity.parseResearchRequest("shore power --breadth=4 --depth=2"),
    {
      query: "shore power",
      breadth: 4,
      depth: 2,
      output: "report",
    },
  );
});

test("flag values are clamped and unknown flags stay part of the question", () => {
  const clamped = identity.parseResearchRequest(
    "--breadth 99 --depth 0 grid inertia",
  );
  assert.equal(clamped.breadth, 10);
  assert.equal(clamped.depth, 1);

  const unknown = identity.parseResearchRequest("--fast compare A --vs B");
  assert.equal(unknown.query, "--fast compare A --vs B");
  assert.equal(unknown.breadth, identity.DEFAULT_BREADTH);
});

test("the user message keeps the command so the transcript replays correctly", () => {
  assert.equal(
    identity.deepResearchUserMessage("tidal energy"),
    "/agents:deep-research tidal energy",
  );
  assert.equal(
    identity.deepResearchUserMessage("   "),
    "/agents:deep-research",
  );
});

// --- surface wiring: chat only, no separate UI ------------------------------

test("selecting Deep Research activates it in chat instead of opening a dialog", () => {
  const hub = source("src/app/components/hermes/command-hub.tsx");
  const composer = source("src/app/components/assistant-composer.tsx");

  // The entry activates the agent; the standalone dialog/panel is gone.
  assert.match(hub, /id="deep-research-entry"/);
  assert.match(hub, /onSelectDeepResearch\(\);/);
  assert.doesNotMatch(hub, /DeepResearchDialog/);
  assert.equal(
    fs.existsSync(
      fileURLToPath(
        new URL(
          "../src/app/components/agents/deep-research.tsx",
          import.meta.url,
        ),
      ),
    ),
    false,
  );

  // Same contract as the other runtime agents: insert the command, show a chip.
  assert.match(composer, /insertCommandToken\(DEEP_RESEARCH_SLASH_COMMAND\)/);
  assert.match(composer, />\{DEEP_RESEARCH_SLASH_COMMAND\}<\/span>/);
});

test("every chat host routes the command to a run and renders it inline", () => {
  const terminal = source(
    "src/app/components/hermes/dashboard-agent-terminal.tsx",
  );
  const garden = source("src/app/components/hermes/garden-agent-chat.tsx");
  const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");
  const hook = source("src/app/components/hermes/use-deep-research-agent.ts");

  for (const host of [terminal, garden]) {
    assert.match(
      host,
      /directDeepResearchInvocation\(\s*text,\s*isSuperAgentEnabled\(\)/,
    );
    assert.match(
      host,
      /taskFromDeepResearchIntent\(text\) !== null[\s\S]*?deepResearch\.clear\(\)/,
    );
    assert.match(host, /invocation\.selectAgent/);
    assert.match(
      host,
      /invocation\.selectAgent \? \{\} : \{ userContent: text \}/,
    );
    assert.match(host, /deepResearch\.launch\(/);
    assert.match(
      host,
      /routeDeepResearchCommand\(previousUser\.content, \{ branchGroupId \}\)/,
    );
    assert.match(host, /routeDeepResearchCommand\(text, \{ branchGroupId \}\)/);
    assert.match(host, /routeDeepResearchCommand\(trimmed\)/);
    assert.match(
      host,
      /if \(deepResearch\.agent\) \{\s+await deepResearch\.launch\(trimmed\);/,
    );
  }
  assert.match(panel, /message\.deepResearchRun/);
  assert.match(panel, /<InlineDeepResearchRun/);
  assert.match(hook, /deepResearchUserMessage\(task\)/);
  assert.match(hook, /deepResearchRun: \{/);
  assert.match(hook, /branchGroupId: options\.branchGroupId/);
  assert.match(
    hook,
    /options\.userContent\?\.trim\(\) \|\| deepResearchUserMessage\(task\)/,
  );
  assert.match(hook, /model: titleModel/);
  assert.match(hook, /taskFromDeepResearchCommand\(latestUser\.content\)/);
});

test("a delegated run stays private and leaves the originating assistant message intact", () => {
  const session = source("src/app/components/hermes/use-agent-session.ts");
  const turns = source("src/lib/conversations/external-agent-turns.ts");
  const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");
  const route = source(
    "src/app/api/hermes/sessions/[sessionId]/external-turns/route.ts",
  );

  assert.match(session, /beginDelegatedExternalAgentTurn/);
  assert.match(session, /pendingDelegatedExternalTurnRef\.current/);
  assert.match(
    session,
    /delegatedExternalTurnIdsRef\.current\.add\(clientMessageId\)/,
  );
  assert.match(
    session,
    /attachToExistingTurn =\s*\n\s*input\.attachToExistingTurn === true \|\|\s*\n\s*delegatedExternalTurnIdsRef\.current\.has/,
  );
  assert.match(turns, /export function attachExternalAgentRun/);
  assert.match(turns, /role = 'assistant'/);
  assert.match(turns, /delegatedAgentRun: true/);
  assert.match(turns, /delegatedAgentPreamble/);
  assert.match(turns, /externalAgentResult/);
  assert.match(session, /delegatedAgentPreamble\?: string/);
  assert.match(session, /externalAgentResult\?: string/);
  assert.match(panel, /message\.delegatedAgentPreamble/);
  assert.match(panel, /message\.delegatedAgentRun \? "hidden" : "contents"/);
  assert.match(route, /body\.attachToExistingTurn === true/);
  assert.match(route, /attachExternalAgentRun\(\{/);
});

test("duplicate submit events cannot launch duplicate Deep Research turns", () => {
  const terminal = source(
    "src/app/components/hermes/dashboard-agent-terminal.tsx",
  );
  const garden = source("src/app/components/hermes/garden-agent-chat.tsx");
  const hook = source("src/app/components/hermes/use-deep-research-agent.ts");
  const legacyGarden = source(
    "src/app/gardens/[clusterSlug]/workspace-client.tsx",
  );

  assert.match(hook, /const launchingRef = useRef\(false\)/);
  assert.match(hook, /if \(launchingRef\.current\) return/);
  assert.match(
    hook,
    /launchingRef\.current = true;[\s\S]*?setLaunching\(true\)/,
  );
  assert.match(
    hook,
    /finally \{[\s\S]*?launchingRef\.current = false;[\s\S]*?setLaunching\(false\)/,
  );
  for (const host of [terminal, garden]) {
    assert.match(host, /const deepResearchDispatchingRef = useRef\(false\)/);
    assert.match(
      host,
      /deepResearch\.launching \|\| deepResearchDispatchingRef\.current/,
    );
    assert.match(
      host,
      /finally \{[\s\S]*?deepResearchDispatchingRef\.current = false/,
    );
  }
  assert.match(legacyGarden, /const externalAgentLaunchRef = useRef</);
  assert.match(legacyGarden, /if \(externalAgentLaunchRef\.current\) return/);
});

test("selecting Deep Research recovers its local service on demand", () => {
  const service = source("src/lib/deep-research/service.ts");
  const runtime = source("src/lib/deep-research/runtime.ts");

  assert.match(service, /await ensureDeepResearchService\(\)/);
  assert.match(runtime, /DEEP_RESEARCH_AUTOSTART/);
  assert.match(runtime, /path\.join\(root, "deep-research"\)/);
  assert.match(runtime, /windowsHide: true/);
  assert.match(runtime, /DEEP_RESEARCH_SECRET: config\.secret/);
  assert.match(runtime, /CHATMOCK_BASE_URL:/);
  assert.match(runtime, /new URL\("\/health", url\)/);
  assert.match(runtime, /attempt < 120/);
});

test("event polling restarts a lost sidecar and reconciles interrupted runs", () => {
  const service = source("src/lib/deep-research/service.ts");
  const runtime = source("src/lib/deep-research/runtime.ts");

  assert.match(service, /function isRecoverableConnectionFailure/);
  assert.match(service, /error\.code === "unavailable"/);
  assert.match(service, /error\.code === "timeout"/);
  assert.match(
    service,
    /listEvents[\s\S]*?ensureDeepResearchService\(\)[\s\S]*?eventsSince\(runId, userId, since\)/,
  );
  assert.match(runtime, /local service exited/);
  assert.match(runtime, /local service failed to start/);
  assert.match(runtime, /const surviveWorkerRestart = env\.NODE_ENV === "development"/);
  assert.match(runtime, /detached: surviveWorkerRestart/);
  assert.match(runtime, /if \(surviveWorkerRestart\) child\.unref\(\)/);
});

test("the inline run card uses the paper design tokens, not the dialog's palette", () => {
  const inline = source(
    "src/app/components/hermes/inline-deep-research-run.tsx",
  );
  assert.match(inline, /bb-agent-run-card/);
  assert.match(inline, /bb-agent-run-inset/);
  assert.match(inline, /bb-agent-run-text/);
  assert.match(inline, /text-\[var\(--ink-heading\)\]/);
  assert.doesNotMatch(inline, /text-sky-|bg-gray-950|text-gray-|text-white/);
});

test("Deep Research stop is single-click and consumes terminal recovery responses", () => {
  const inline = source(
    "src/app/components/hermes/inline-deep-research-run.tsx",
  );

  assert.match(inline, /if \(stopPendingRef\.current\) return/);
  assert.match(inline, /stopPendingRef\.current = true/);
  assert.match(inline, /disabled=\{stopPending\}/);
  assert.match(inline, /aria-busy=\{stopPending\}/);
  assert.match(inline, /motion-reduce:animate-none/);
  assert.match(
    inline,
    /if \(response\.ok\)[\s\S]*?for \(const event of data\?\.events \?\? \[\]\) applyEvent\(event\)/,
  );
  assert.match(inline, /type: `run\.\$\{run\.status\}`/);
});

test("completed research clears its writing phase and reports aggregated model usage", () => {
  const inline = source(
    "src/app/components/hermes/inline-deep-research-run.tsx",
  );
  const engine = source("../deep-research/src/deep-research.ts");
  const service = source("../deep-research/src/api.ts");

  assert.match(inline, /"run\.usage"/);
  assert.match(inline, /usage=\{usage\}/);
  assert.match(inline, /setNote\(null\)/);
  assert.match(inline, /notifyTaskCompleted\(query\)/);
  assert.match(inline, /!terminal && \(progress\?\.currentQuery \|\| note\)/);
  assert.doesNotMatch(inline, /summary=\{note/);
  assert.match(engine, /onUsage\?\.\(res\.usage\)/);
  assert.match(service, /emit\(run, 'run\.usage'/);
});

// --- mode + connection settings ---------------------------------------------

test("mode defaults to optional and only accepts known values", () => {
  assert.equal(config.deepResearchMode({}), "optional");
  assert.equal(
    config.deepResearchMode({ DEEP_RESEARCH_MODE: "REQUIRED" }),
    "required",
  );
  assert.equal(
    config.deepResearchMode({ DEEP_RESEARCH_MODE: "disabled" }),
    "disabled",
  );
  assert.equal(
    config.deepResearchMode({ DEEP_RESEARCH_MODE: "nonsense" }),
    "optional",
  );
  assert.equal(
    config.deepResearchEnabled({ DEEP_RESEARCH_MODE: "disabled" }),
    false,
  );
  assert.equal(config.deepResearchEnabled({}), true);
});

test("service settings default to loopback and carry no secret of their own", () => {
  const resolved = config.resolveDeepResearchConfig({});
  assert.equal(resolved.serviceUrl, "http://127.0.0.1:7722");
  assert.equal(resolved.secret, "");
  assert.equal(resolved.requestTimeoutMs, 15_000);

  const custom = config.resolveDeepResearchConfig({
    DEEP_RESEARCH_URL: "http://127.0.0.1:9999",
    DEEP_RESEARCH_SECRET: "s3cret",
    DEEP_RESEARCH_REQUEST_TIMEOUT_MS: "2500",
  });
  assert.equal(custom.serviceUrl, "http://127.0.0.1:9999");
  assert.equal(custom.secret, "s3cret");
  assert.equal(custom.requestTimeoutMs, 2500);
});

// --- run request validation --------------------------------------------------

test("run requests are validated with stable error codes", () => {
  assert.deepEqual(config.validateRunRequest(null), {
    ok: false,
    error: "invalid_body",
  });
  assert.deepEqual(config.validateRunRequest({}), {
    ok: false,
    error: "invalid_query",
  });
  assert.deepEqual(config.validateRunRequest({ query: "   " }), {
    ok: false,
    error: "invalid_query",
  });
  assert.deepEqual(
    config.validateRunRequest({
      query: "x".repeat(config.RUN_LIMITS.maxQueryLength + 1),
    }),
    { ok: false, error: "invalid_query" },
  );
  assert.deepEqual(config.validateRunRequest({ query: "tides", breadth: 0 }), {
    ok: false,
    error: "invalid_breadth",
  });
  assert.deepEqual(config.validateRunRequest({ query: "tides", breadth: 11 }), {
    ok: false,
    error: "invalid_breadth",
  });
  assert.deepEqual(
    config.validateRunRequest({ query: "tides", breadth: 2.5 }),
    {
      ok: false,
      error: "invalid_breadth",
    },
  );
  assert.deepEqual(config.validateRunRequest({ query: "tides", depth: 6 }), {
    ok: false,
    error: "invalid_depth",
  });
});

test("valid run requests are normalized (trimmed query, defaults, report output)", () => {
  const result = config.validateRunRequest({ query: "  tidal energy  " });
  assert.deepEqual(result, {
    ok: true,
    value: {
      query: "tidal energy",
      breadth: identity.DEFAULT_BREADTH,
      depth: identity.DEFAULT_DEPTH,
      output: "report",
    },
  });

  const answer = config.validateRunRequest({
    query: "how many turbines",
    breadth: 5,
    depth: 3,
    output: "answer",
  });
  assert.deepEqual(answer.value, {
    query: "how many turbines",
    breadth: 5,
    depth: 3,
    output: "answer",
  });

  // Any unknown output falls back to a report rather than erroring.
  assert.equal(
    config.validateRunRequest({ query: "q", output: "essay" }).value.output,
    "report",
  );
});

// --- health normalization ----------------------------------------------------

test("health normalization keeps only known, non-secret fields", () => {
  const normalized = client.normalizeHealth({
    status: "ok",
    engine: "open-deep-research",
    version: "1.0.0",
    model: {
      provider: "chatmock",
      model: "gpt-5.6-sol",
      endpoint: "http://127.0.0.1:8765/v1",
    },
    search: { configured: true, backend: "firecrawl-cloud" },
    persistence: { configured: true, healthy: true },
    ready: true,
    activeRuns: 2,
    secret: "must-not-survive",
  });
  assert.equal(normalized.status, "healthy");
  assert.equal(normalized.model.provider, "chatmock");
  assert.equal(normalized.search.backend, "firecrawl-cloud");
  assert.equal(normalized.ready, true);
  assert.equal(normalized.activeRuns, 2);
  assert.deepEqual(normalized.persistence, { configured: true, healthy: true });
  assert.equal("secret" in normalized, false);
});

test("a malformed, unhealthy, or wrong-service body normalizes to unavailable", () => {
  for (const body of [
    null,
    {},
    "nope",
    { status: "degraded" },
    // Postiz also exposes /health on its historical 7721 port. A generic 200
    // must not be mistaken for the Deep Research engine again.
    { ready: true, integrations: 0 },
    { status: "ok", engine: "some-other-service", ready: true },
  ]) {
    const normalized = client.normalizeHealth(body);
    assert.equal(normalized.status, "unavailable");
    assert.equal(normalized.ready, false);
    assert.equal(normalized.model, null);
    assert.deepEqual(normalized.search, { configured: false, backend: null });
    assert.deepEqual(normalized.persistence, {
      configured: false,
      healthy: false,
    });
  }
});

// --- client behaviour against a stub service --------------------------------

const requests = [];
const server = http.createServer((request, response) => {
  requests.push({
    method: request.method,
    url: request.url,
    authorization: request.headers.authorization,
  });
  const send = (status, body) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (request.url === "/health")
    return send(200, { status: "ok", ready: false, search: {} });
  if (request.url?.startsWith("/runs/missing"))
    return send(404, { ok: false, error: "run_not_found" });
  if (request.url?.startsWith("/runs/r1/events")) {
    return send(200, {
      ok: true,
      data: [
        { sequenceNumber: 1, type: "run.started", at: "now", payload: {} },
      ],
    });
  }
  if (request.method === "POST" && request.url === "/runs") {
    return send(200, { ok: true, data: { runId: "r1", status: "running" } });
  }
  return send(200, { ok: true, data: {} });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const serviceUrl = `http://127.0.0.1:${server.address().port}`;
const stubClient = new client.DeepResearchClient({
  mode: "optional",
  serviceUrl,
  secret: "shared-secret",
  requestTimeoutMs: 5_000,
});

after(() => server.close());

test("calls are bearer-authenticated with the service secret", async () => {
  requests.length = 0;
  await stubClient.createRun({
    ownerUserId: 7,
    query: "tides",
    breadth: 2,
    depth: 1,
    output: "report",
  });
  assert.equal(requests[0].authorization, "Bearer shared-secret");
});

test("reads carry the session-derived userId so the service can enforce ownership", async () => {
  requests.length = 0;
  await stubClient.eventsSince("r1", 42, 3);
  assert.match(requests[0].url, /userId=42/);
  assert.match(requests[0].url, /since=3/);
});

test("service error codes surface as typed errors, not raw HTTP detail", async () => {
  await assert.rejects(
    () => stubClient.getRun("missing", 1),
    (error) =>
      error instanceof client.DeepResearchServiceError &&
      error.code === "run_not_found",
  );
});

test("an unreachable service reports unavailable instead of throwing from health()", async () => {
  const offline = new client.DeepResearchClient({
    mode: "optional",
    // Port 1 is never listening; the call fails at connect time.
    serviceUrl: "http://127.0.0.1:1",
    secret: "x",
    requestTimeoutMs: 500,
  });
  const health = await offline.health();
  assert.equal(health.status, "unavailable");
  assert.equal(health.ready, false);

  await assert.rejects(
    () => offline.getRun("r1", 1),
    (error) =>
      error instanceof client.DeepResearchServiceError &&
      error.code === "unavailable",
  );
});

test("structured research evidence keeps only registered, safe web sources", () => {
  const snapshot = events.normalizeResearchEvidenceSnapshot({
    sources: [
      {
        id: "S1",
        url: "https://user:password@example.com/report?year=2026",
        title: "Primary report",
      },
      { id: "S2", url: "javascript:alert(1)", title: "unsafe" },
      { id: "S3", url: "https://example.com/report?year=2026" },
    ],
    evidence: [
      {
        id: "E1",
        claim: "The report was published.",
        sourceIds: ["S1", "missing"],
      },
      {
        id: "E2",
        claim: "A claim with no registered source.",
        sourceIds: ["S2"],
      },
    ],
    warnings: [
      {
        code: "branch_failed",
        message: "One branch timed out.",
        recoverable: true,
      },
    ],
  });

  assert.equal(snapshot.sources.length, 1);
  assert.equal(snapshot.sources[0].url, "https://example.com/report?year=2026");
  assert.deepEqual(snapshot.evidence[0].sourceIds, ["S1"]);
  assert.deepEqual(snapshot.evidence[1].sourceIds, []);
  assert.equal(snapshot.coverage.totalClaims, 2);
  assert.equal(snapshot.coverage.citedClaims, 1);
  assert.equal(snapshot.coverage.ratio, 0.5);
  assert.equal(snapshot.warnings[0].code, "branch_failed");
});

test("legacy visited URLs normalize into stable source records", () => {
  const snapshot = events.normalizeResearchEvidenceSnapshot({
    visitedUrls: [
      "https://example.com/a",
      "https://example.com/a",
      "http://example.com/b",
    ],
  });
  assert.deepEqual(
    snapshot.sources.map(({ id, url }) => ({ id, url })),
    [
      { id: "S1", url: "https://example.com/a" },
      { id: "S2", url: "http://example.com/b" },
    ],
  );
});

test("research budgets expose processed tokens without trusting arbitrary fields", () => {
  assert.deepEqual(
    events.normalizeResearchBudget({
      searches: 4,
      modelCalls: 7,
      sources: 12,
      tokens: 573_644,
      elapsedMs: 721_000,
      stoppedReason: "tokens",
      secret: "discard me",
    }),
    {
      searches: 4,
      modelCalls: 7,
      sources: 12,
      tokens: 573_644,
      elapsedMs: 721_000,
      stoppedReason: "tokens",
    },
  );
  assert.equal(events.normalizeResearchBudget(null), null);
});
