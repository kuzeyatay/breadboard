// Hermes background computer use: shipped skill, automatic routing, Super
// Agent restraint, and the learned-workflow worker protocol.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

register("./teach-support/server-only-stub.mjs", import.meta.url);

const skillPath = new URL(
  "../../hermes-skills/prebuilt/computer-use/SKILL.md",
  import.meta.url,
);
const hermesRoot = fileURLToPath(new URL("../../hermes-agent", import.meta.url));
process.env.BREADBOARD_HERMES_APP_DIR = hermesRoot;
process.env.BREADBOARD_HERMES_PYTHON = path.join(
  hermesRoot,
  ".venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python",
);

const {
  computerUseCommandText,
  shouldAutoSelectComputerUse,
  COMPUTER_USE_SKILL,
} = await import("../src/lib/hermes/computer-use-intent.ts");
const { listFirstPartySkills } = await import("../src/lib/hermes/skills.ts");
const { HermesComputerBackend } = await import("../src/lib/teach/hermes-computer.ts");

function selects(text, priorMessages) {
  return shouldAutoSelectComputerUse({
    text,
    surface: "dashboard_terminal",
    authenticated: true,
    priorMessages,
  });
}

test("the first-party /computer-use skill is ready and requires background operation", () => {
  const markdown = fs.readFileSync(skillPath, "utf8").replaceAll("\r\n", "\n");
  for (const marker of [
    "name: computer-use",
    "allowed-tools:\n  - computer_use",
    "Windows, macOS, and Linux",
    "computer use is a last resort",
    'delivery_mode: "background"',
    "Never request foreground delivery",
    "hermes computer-use install",
  ]) {
    assert.ok(markdown.includes(marker), `skill lost ${marker}`);
  }

  const skill = listFirstPartySkills("dashboard_terminal").find(
    (entry) => entry.slug === COMPUTER_USE_SKILL,
  );
  assert.ok(skill, "computer-use must be discovered as a first-party skill");
  assert.equal(skill.availability, "ready");
  assert.equal(skill.classification, "eligible_general");
});

test("desktop-operation requests select the skill without stealing browser or discussion turns", () => {
  for (const request of [
    "Use my computer to fill in the desktop app.",
    "Click the Export button in the Photoshop window.",
    "Open Excel and select the Summary worksheet.",
    "Scroll down in the native app.",
  ]) {
    assert.equal(selects(request), true, request);
  }
  for (const request of [
    "Click the pricing button on this website.",
    "What is Hermes computer use?",
    "Does Hermes support desktop automation on Linux?",
    "Explain how Excel formulas work.",
  ]) {
    assert.equal(selects(request), false, request);
  }

  assert.equal(
    selects("Now click Save", [
      { role: "assistant", content: "I used Hermes background computer use for the prior step." },
    ]),
    true,
  );
  assert.deepEqual(
    computerUseCommandText({
      text: "Click Save in the desktop app",
      surface: "garden_chat",
      authenticated: true,
    }),
    {
      text: "/computer-use Click Save in the desktop app",
      automatic: true,
    },
  );

  for (const relative of [
    "../src/lib/conversations/turn-service.ts",
    "../src/lib/hermes/garden-chat-adapter.ts",
  ]) {
    const source = fs.readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /computerUseCommandText\(\{/u, `${relative} must run the router`);
    assert.match(source, /automaticComputerUse/u, `${relative} must record the automatic selection`);
    assert.match(
      source,
      /selectedConditionalSkills\.includes\(COMPUTER_USE_SKILL\)[\s\S]{0,120}computer_use: true/u,
      `${relative} must enable the tool whenever the skill is selected`,
    );
  }
});

test("Super Agent names computer use as a background-only last resort", () => {
  const source = fs.readFileSync(
    new URL("../src/lib/hermes/super-agent.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /Computer use is the last resort/u);
  assert.match(source, /never an opening move/u);
  assert.match(source, /Never request foreground delivery/u);
  assert.match(source, /inventory\.skillSlugs\.includes\("computer-use"\)/u);
});

test("Hermes sessions expose the computer_use toolset behind the last-resort prompt guard", () => {
  const source = fs.readFileSync(
    new URL("../src/lib/agent-runtime/adapters/hermes.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /const COMPUTER_USE_TOOLSET = "computer_use"/u);
  assert.match(source, /COMPUTER_USE_TOOLSET,[\s\S]*system_prompt/u);
  assert.match(source, /In Super Agent mode computer_use is always a last resort/u);
  assert.match(source, /Keep it in background delivery mode/u);
});

test(
  "learned workflows speak to Hermes through one background worker session",
  { timeout: 20_000 },
  async () => {
    const previous = process.env.HERMES_COMPUTER_USE_BACKEND;
    process.env.HERMES_COMPUTER_USE_BACKEND = "noop";
    const backend = new HermesComputerBackend();
    try {
      assert.deepEqual(backend.available(), { available: true });
      const observation = await backend.observe({ maxElements: 20 });
      assert.deepEqual(observation.screen, { width: 1024, height: 768 });
      assert.equal(observation.elements.length, 0);
      const action = await backend.execute({ kind: "key", key: "Enter" });
      assert.equal(action.ok, true);
      assert.ok(backend.processId(), "the workflow owns one live Hermes worker");
    } finally {
      await backend.stop();
      if (previous === undefined) delete process.env.HERMES_COMPUTER_USE_BACKEND;
      else process.env.HERMES_COMPUTER_USE_BACKEND = previous;
    }
    assert.equal(backend.processId(), null);
  },
);

test("the learned-workflow factory uses Hermes on every supported platform", () => {
  const source = fs.readFileSync(
    new URL("../src/lib/teach/backends.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /return new HermesComputerBackend\(\)/u);
  assert.doesNotMatch(source, /process\.platform === "win32" \? new WindowsComputerBackend/u);
});
