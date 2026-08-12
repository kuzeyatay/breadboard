import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  decideCapabilityMode,
  mergeCapabilityToolPolicy,
  outcomeWithoutCapabilityTokens,
  permissionRulesForDecision,
} from "../src/lib/hermes/capability-policy.ts";
import {
  classifySkill,
  listApprovedSkills,
} from "../src/lib/hermes/skills.ts";
import {
  registryItemsForUser,
  resolveCommandMessage,
} from "../src/lib/hermes/commands.ts";

const root = path.resolve(".");

test("knowledge is the default for conceptual and analytical software requests", () => {
  for (const requestedOutcome of [
    "Explain how React components work.",
    "Compare two API design approaches.",
    "Plan a migration without changing files.",
    "Summarize this repository architecture from the supplied document.",
    "Explain what this React component does.",
    "Review this code conceptually without changing it.",
    "Run the test suite.",
  ]) {
    const decision = decideCapabilityMode({
      surface: "dashboard_terminal",
      userId: 1,
      requestedOutcome,
      authorizedRoot: root,
    });
    assert.equal(decision.mode, "knowledge");
    assert.equal(decision.implementationRequired, false);
    assert.equal(decision.authorizedRoots.length, 0);
  }
});

test("technical inspection receives read-only scope without mutation tools", () => {
  const decision = decideCapabilityMode({
    surface: "dashboard_terminal",
    userId: 1,
    requestedOutcome: "Diagnose why this TypeScript route reports an error, but do not change it.",
    authorizedRoot: root,
  });
  assert.equal(decision.mode, "technical_read");
  assert.ok(decision.allowedTools.includes("read"));
  assert.ok(decision.allowedTools.includes("grep"));
  assert.ok(!decision.allowedTools.includes("edit"));
  assert.ok(!decision.allowedTools.includes("bash"));
});

test("technical-read examples never acquire mutation permissions", () => {
  for (const requestedOutcome of [
    "Find where the slash palette is mounted.",
    "Analyze this error log and identify the likely source.",
    "Show me which files would need to change, but do not modify them.",
  ]) {
    const decision = decideCapabilityMode({
      surface: "dashboard_terminal",
      userId: 1,
      requestedOutcome,
      authorizedRoot: root,
    });
    assert.equal(decision.mode, "technical_read");
    assert.ok(!decision.allowedTools.includes("edit"));
    assert.ok(!decision.allowedCommandPatterns.length);
  }
});

test("a concrete authenticated implementation task gets a narrow expiring grant", () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const decision = decideCapabilityMode({
    surface: "dashboard_terminal",
    userId: 7,
    requestedOutcome: "Implement keyboard navigation in the capability palette and add a focused regression test.",
    authorizedRoot: root,
    now,
  });
  assert.equal(decision.mode, "scoped_implementation");
  assert.equal(decision.implementationRequired, true);
  assert.deepEqual(decision.authorizedRoots, [root]);
  assert.ok(decision.authorizedPathPatterns.length > 0);
  assert.ok(decision.allowedOperations.includes("code_write"));
  assert.ok(decision.allowedOperations.includes("focused_test"));
  assert.ok(decision.allowedOperations.includes("typecheck"));
  assert.ok(!decision.allowedOperations.includes("dependency_install"));
  assert.equal(decision.expiresAt, "2026-07-18T12:30:00.000Z");
  const rules = permissionRulesForDecision(decision);
  assert.ok(rules.some((rule) => rule.permission === "edit" && rule.action === "allow"));
  assert.ok(!rules.some((rule) => rule.permission === "edit" && rule.pattern === "*" && rule.action === "allow"));
  assert.ok(!decision.allowedCommandPatterns.some((pattern) => /push|commit|deploy/.test(pattern)));
});

test("implementation is denied when the server cannot derive a narrow path scope", () => {
  const decision = decideCapabilityMode({
    surface: "dashboard_terminal",
    userId: 1,
    requestedOutcome: "Implement some software improvements.",
    authorizedRoot: root,
  });
  assert.equal(decision.mode, "knowledge");
  assert.match(decision.decisionReason, /could not be limited/i);
});

test("surface, authentication, high-impact, and crafted-token checks fail closed", () => {
  const cases = [
    { surface: "garden_chat", userId: 1, requestedOutcome: "Fix the React component." },
    { surface: "quartz_ai", userId: 1, requestedOutcome: "Fix the React component." },
    { surface: "dashboard_terminal", userId: null, requestedOutcome: "Fix the React component." },
    { surface: "dashboard_terminal", userId: 1, requestedOutcome: "Fix the React component and push it to production." },
    { surface: "dashboard_terminal", userId: 1, requestedOutcome: "/react-repair Explain React components." },
  ];
  for (const input of cases) {
    const decision = decideCapabilityMode({
      ...input,
      authorizedRoot: root,
    });
    assert.equal(decision.mode, "knowledge");
  }
  assert.equal(outcomeWithoutCapabilityTokens("/skill:react-repair /drive explain this"), "explain this");
});

test("selected tools cannot widen the server decision", () => {
  const knowledge = decideCapabilityMode({
    surface: "dashboard_terminal",
    userId: 1,
    requestedOutcome: "Summarize my notes.",
    authorizedRoot: root,
  });
  const tools = mergeCapabilityToolPolicy(knowledge, {
    bash: true,
    edit: true,
    drive_search: true,
    github_push: true,
    github_create_branch: true,
  });
  assert.equal(tools.bash, false);
  assert.equal(tools.edit, false);
  assert.equal(tools.drive_search, true);
  assert.equal(tools.github_push, false);
  assert.equal(tools.github_create_branch, false);
  const rules = permissionRulesForDecision(knowledge);
  assert.ok(rules.some((rule) => rule.permission === "bash" && rule.action === "deny"));
  assert.ok(!rules.some((rule) => rule.pattern.includes("git push") && rule.action === "allow"));
});

test("runtime permission projection preserves scoped files and brokered web tools", () => {
  const scoped = permissionRulesForDecision({
    mode: "technical_read",
    requestedOutcome: "Inspect Downloads.",
    implementationRequired: false,
    decisionReason: "test",
    decisionSource: "test",
    authorizedRoots: ["/home/me/Downloads"],
    authorizedPathPatterns: ["/home/me/Downloads/**"],
    allowedTools: ["read", "glob", "grep", "webfetch", "websearch"],
    allowedOperations: [],
    allowedCommandPatterns: [],
    selectedConditionalSkills: [],
    selectedConnections: [],
    createdAt: new Date(0).toISOString(),
    expiresAt: null,
    revokedAt: null,
  });
  assert.ok(scoped.some((rule) => rule.permission === "external_directory" && rule.pattern === "/home/me/Downloads/**" && rule.action === "allow"));
  assert.ok(scoped.some((rule) => rule.permission === "read" && rule.pattern === "/home/me/Downloads/**" && rule.action === "allow"));
  assert.ok(!scoped.some((rule) => rule.permission === "read" && rule.pattern === "*" && rule.action === "allow"));
  assert.ok(scoped.some((rule) => rule.permission === "webfetch" && rule.action === "allow"));
  assert.ok(scoped.some((rule) => rule.permission === "websearch" && rule.action === "allow"));
});

test("skill classifications distinguish general, coding, unknown, incompatible, and prohibited", () => {
  assert.equal(classifySkill({ name: "research-synthesis", description: "Literature review and structured writing" }).classification, "eligible_general");
  assert.equal(classifySkill({ name: "react-repair", description: "Debug and edit React frontend code" }).classification, "eligible_coding_conditional");
  assert.equal(classifySkill({ name: "python-dependency-upgrader", description: "Upgrade Python dependencies and package metadata" }).classification, "eligible_coding_conditional");
  assert.equal(classifySkill({ name: "rust-crate-helper", description: "Maintain Rust crates and Cargo configuration" }).classification, "eligible_coding_conditional");
  assert.equal(classifySkill({ name: "container-release", description: "Maintain Dockerfiles and Kubernetes manifests" }).classification, "eligible_coding_conditional");
  assert.equal(classifySkill({ name: "mystery" }).classification, "unknown");
  assert.equal(classifySkill({ name: "firmware", description: "Firmware flasher and kernel module workflow" }).classification, "blocked_incompatible");
  assert.equal(classifySkill({ name: "stealer", description: "Credential theft and token exfiltration" }).classification, "blocked_security");
});

test("coding skills stay visible but resolve only for a repository coding agent", async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bb-conditional-skill-"));
  const previous = process.env.HERMES_SKILLS_APPROVED;
  process.env.HERMES_SKILLS_APPROVED = temporary;
  t.after(() => {
    if (previous === undefined) delete process.env.HERMES_SKILLS_APPROVED;
    else process.env.HERMES_SKILLS_APPROVED = previous;
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const skillRoot = path.join(temporary, "react-repair");
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(path.join(skillRoot, "SKILL.md"), "---\nname: react-repair\ndescription: Debug and edit React frontend code\n---\n\nRepair only the relevant interface.");
  const staleClassification = {
    ...classifySkill({ name: "research-helper", description: "Research and writing guidance" }),
    classifierVersion: "breadboard-skill-policy-v1",
  };
  fs.writeFileSync(path.join(temporary, "registry.json"), JSON.stringify({
    skills: { "react-repair": { classification: staleClassification } },
  }));
  assert.equal(
    listApprovedSkills().some(
      (skill) =>
        skill.slug === "react-repair" &&
        skill.classification === "eligible_coding_conditional",
    ),
    true,
  );
  const registryItem = registryItemsForUser(1, {
    mode: "knowledge",
    surface: "dashboard_terminal",
  }).find((item) => item.slug === "react-repair");
  assert.equal(registryItem?.requiresOpenCode, true);
  assert.equal(registryItem?.requiredCapabilityMode, "scoped_implementation");
  await assert.rejects(
    resolveCommandMessage(
      1,
      "/skill:react-repair explain what should be checked",
      root,
      { mode: "knowledge", surface: "dashboard_terminal" },
    ),
    (error) =>
      error?.code === "opencode_required" &&
      /must run through Codex, OpenCode, or Ruflo/i.test(error.message),
  );
  const resolved = await resolveCommandMessage(
    1,
    "/skill:react-repair fix the broken component",
    root,
    {
      mode: "scoped_implementation",
      surface: "dashboard_terminal",
      executionTarget: "opencode",
    },
  );
  assert.match(resolved.text, /Reviewed skill guidance: react-repair/i);
  assert.match(resolved.text, /fix the broken component/);
  const codexResolved = await resolveCommandMessage(
    1,
    "/skill:react-repair fix the broken component with Codex",
    root,
    {
      mode: "scoped_implementation",
      surface: "dashboard_terminal",
      executionTarget: "codex",
    },
  );
  assert.match(codexResolved.text, /Reviewed skill guidance: react-repair/i);
  assert.match(codexResolved.text, /fix the broken component with Codex/);
  assert.equal(
    resolved.invocations[0]?.contentHash !== undefined,
    false,
  );
});
