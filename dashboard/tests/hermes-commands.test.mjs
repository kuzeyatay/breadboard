import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-commands-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { default: db } = await import("../src/lib/db.ts");
const {
  mcpToolSelection,
  assignCommandTokens,
  promptRequestsImplementation,
  resolveCommandMessage,
} = await import("../src/lib/hermes/commands.ts");
const { createPrompt, resolvePrompt } = await import("../src/lib/hermes/prompts.ts");
const { parseMcpConfig, saveMcpConnection } = await import("../src/lib/hermes/mcp-connections.ts");
const { getAgentRuntime } = await import("../src/lib/agent-runtime/runtime.ts");

db.prepare(
  "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'commands', 'commands@example.test', 'x')",
).run();

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("MCP selection changes only real MCP namespaces", () => {
  const selection = mcpToolSelection(
    {
      tools: [
        "read",
        "apply_patch",
        "garden_search",
        "capability_gap",
        "alpha_lookup",
        "beta_write",
      ],
      mcp: { alpha: { status: "connected" }, beta: { status: "connected" } },
    },
    "alpha",
  );
  assert.deepEqual(selection.selected, ["alpha_lookup"]);
  assert.deepEqual(selection.tools, { alpha_lookup: true, beta_write: false });
});

test("plain messages pass through unchanged", async () => {
  const result = await resolveCommandMessage(1, "inspect the repository");
  assert.equal(result.text, "inspect the repository");
  assert.equal(result.userText, "inspect the repository");
  assert.deepEqual(result.invocations, []);
});

test("agent commands are namespaced, keep only the last selection, and preserve the user request", async () => {
  const selected = await resolveCommandMessage(
    1,
    "/agent:ux-researcher /agents:agency-agents:frontend-developer review this interface",
  );
  assert.equal(selected.text, "review this interface");
  assert.equal(selected.userText, "review this interface");
  assert.deepEqual(selected.agencyAgentSelection, {
    action: "set",
    slug: "frontend-developer",
    id: selected.invocations[0].id,
  });
  assert.deepEqual(selected.invocations.map((item) => [item.kind, item.slug]), [
    ["agent", "frontend-developer"],
  ]);

  const cleared = await resolveCommandMessage(1, "/agent:none continue normally");
  assert.deepEqual(cleared.agencyAgentSelection, { action: "clear" });
  assert.equal(cleared.userText, "continue normally");
});

test("agent-like text in prose or code is not interpreted and unknown agents are useful errors", async () => {
  const prose = "Please document `/agent:frontend-developer` without selecting it.";
  assert.equal((await resolveCommandMessage(1, prose)).text, prose);
  const code = "```\n/agent:frontend-developer\n```";
  assert.equal((await resolveCommandMessage(1, code)).text, code);
  await assert.rejects(
    () => resolveCommandMessage(1, "/agent:not-a-real-agent help"),
    /Choose one from the Agents tab or use \/agent:none/,
  );
});

test("a prompt token resolves server-side and preserves user text", async () => {
  const result = await resolveCommandMessage(
    1,
    "/prompt:study-guide focus on chapter two",
  );
  assert.match(result.text, /Server-resolved prompt: Study guide/);
  assert.match(result.text, /User request\]\nfocus on chapter two/);
  assert.deepEqual(result.invocations, [
    { kind: "prompt", slug: "study-guide", id: "dp-2" },
  ]);
});

test("multiple saved prompts compose in order with clean and legacy tokens", async () => {
  const prompts = [
    createPrompt(1, { title: "Fix teaching style", content: "Use rigorous, proof-based explanations." }),
    createPrompt(1, { title: "Chapter creation", content: "Write a chapter from the supplied materials." }),
    resolvePrompt(1, "study-guide"),
  ];
  const request = "Explain dot products, cross products, angles, projections, and proofs.";
  for (const prefix of ["/", "/prompt:"]) {
    for (const count of [2, 3]) {
      const selected = prompts.slice(0, count);
      const result = await resolveCommandMessage(
        1,
        `${selected.map((prompt) => `${prefix}${prompt.slug}`).join(" ")} ${request}`,
        undefined,
        { mode: "knowledge", surface: "garden_chat" },
      );
      assert.equal(result.userText, request);
      assert.equal(result.text, [
        ...selected.map((prompt) => `[Server-resolved prompt: ${prompt.title}]\n${prompt.content}`),
        `[User request]\n${request}`,
      ].join("\n\n"));
      assert.deepEqual(result.invocations, selected.map((prompt) => ({
        kind: "prompt", slug: prompt.slug, id: prompt.id,
      })));
    }
  }
});

test("multiple skills and prompts can share a turn", async () => {
  const result = await resolveCommandMessage(
    1,
    "/study-guide /skill:respons-solely-on-garden /quiz-me /skill:save-to-garden explain vectors",
    undefined,
    { mode: "knowledge", surface: "garden_chat" },
  );
  assert.equal(result.userText, "explain vectors");
  assert.deepEqual(result.invocations.map(({ kind, slug }) => [kind, slug]), [
    ["prompt", "study-guide"],
    ["skill", "respons-solely-on-garden"],
    ["prompt", "quiz-me"],
    ["skill", "save-to-garden"],
  ]);
  assert.equal(result.text.match(/\[Reviewed skill guidance:/g)?.length, 2);
  assert.match(result.text, /Server-resolved prompt: Study guide/);
  assert.match(result.text, /Server-resolved prompt: Quiz me/);
});

test("multiple connections keep the union of selected tools when combined with a prompt", async (t) => {
  for (const slug of ["alpha", "beta", "gamma"]) {
    saveMcpConnection(1, parseMcpConfig({
      transport: "remote",
      displayName: slug,
      url: `https://${slug}.example.test/mcp`,
      oauth: false,
    }));
  }
  const runtime = getAgentRuntime();
  const added = t.mock.method(runtime, "addMcpConnection", async () => {});
  t.mock.method(runtime, "listCapabilities", async () => ({
    tools: ["garden_search", "alpha_lookup", "beta_lookup", "gamma_lookup"],
    mcp: {
      alpha: { status: "connected" },
      beta: { status: "connected" },
      gamma: { status: "connected" },
    },
  }));
  const result = await resolveCommandMessage(
    1, "/alpha /study-guide /mcp:beta compare the sources", dataRoot,
  );
  assert.deepEqual(added.mock.calls.map((call) => call.arguments[1]), ["alpha", "beta"]);
  assert.deepEqual(result.tools, { alpha_lookup: true, beta_lookup: true, gamma_lookup: false });
  assert.deepEqual(result.invocations.map(({ kind, slug }) => [kind, slug]), [
    ["mcp", "alpha"], ["prompt", "study-guide"], ["mcp", "beta"],
  ]);
  assert.equal(result.userText, "compare the sources");
  assert.match(result.text, /connection="alpha"/);
  assert.match(result.text, /connection="beta"/);
  assert.doesNotMatch(result.text, /Use only the selected/);
});

test("stacking prompts preserves each prompt's implementation and ownership checks", async () => {
  const implementation = createPrompt(1, { title: "Implement code", content: "Fix the source code." });
  await assert.rejects(
    resolveCommandMessage(1, `/study-guide /${implementation.slug} explain vectors`),
    { code: "implementation_capability_required" },
  );
  await assert.rejects(
    resolveCommandMessage(2, `/prompt:study-guide /prompt:${implementation.slug} explain vectors`),
    { code: "prompt_not_found" },
  );
});

test("long-form writing prompts are not mistaken for software implementation", () => {
  assert.equal(
    promptRequestsImplementation(
      "Build the logic step by step. Treat the transcript as a primary source of substance.",
    ),
    false,
  );
  assert.equal(
    promptRequestsImplementation(
      "Do not edit the source code. Explain the existing implementation.",
    ),
    false,
  );
  assert.equal(
    promptRequestsImplementation(
      "Inspect the behavior, then implement the fix in the source code.",
    ),
    true,
  );
});

test("malformed and unavailable slash commands are rejected clearly", async () => {
  await assert.rejects(
    () => resolveCommandMessage(1, "/prompt study"),
    /unavailable in the current surface or task mode/,
  );
  await assert.rejects(
    () => resolveCommandMessage(1, "/prompt:study-guide /skill:test do it"),
    { code: "skill_not_available" },
  );
});

test("runtime-agent commands never degrade into a generic capability error", async () => {
  await assert.rejects(
    () => resolveCommandMessage(1, "/agents:deep-research compare batteries"),
    (error) =>
      error?.code === "external_agent_dispatch_required" &&
      /chat runner/.test(error.message),
  );
});

test("clean tokens resolve and collisions receive deterministic visible namespaces", async () => {
  const result = await resolveCommandMessage(1, "/study-guide focus on chapter two");
  assert.match(result.text, /Server-resolved prompt: Study guide/);
  assert.deepEqual(
    assignCommandTokens([
      { kind: "skill", slug: "shared" },
      { kind: "prompt", slug: "shared" },
      { kind: "mcp", slug: "drive" },
      { kind: "agent", slug: "shared" },
      { kind: "agent", slug: "geographer", source: "Agency Agents" },
    ]),
    [
      { kind: "skill", slug: "shared", token: "skill-shared" },
      { kind: "prompt", slug: "shared", token: "prompt-shared" },
      { kind: "mcp", slug: "drive", token: "drive" },
      { kind: "agent", slug: "shared", token: "agent:shared" },
      {
        kind: "agent",
        slug: "geographer",
        source: "Agency Agents",
        token: "agents:agency-agents:geographer",
      },
    ],
  );
});

test("anonymous Quartz readers cannot invoke an MCP connection by guessing its slug", async () => {
  await assert.rejects(
    () => resolveCommandMessage(null, "/mcp:gbrain recall this"),
    /Sign in/,
  );
});
