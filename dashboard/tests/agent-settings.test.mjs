import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import { ensureAgentSettingsSchema } from "../src/lib/agent-settings/schema.ts";

import {
  CONFIGURABLE_AGENTS,
  agentSettingDefaults,
  describeAgentSettings,
  findConfigurableAgent,
  isDefaultAgentSettings,
  normalizeAgentSettings,
} from "../src/lib/agent-settings/catalog.ts";
import {
  deepResearchDefaults,
  hardwarePreferenceNote,
  hardwarePreferences,
  maxStepsSetting,
  parametricCadDefaults,
  socialsManagerDefaults,
  rufloDefaults,
  vimaxDefaults,
} from "../src/lib/agent-settings/defaults.ts";
import { parseResearchRequest } from "../src/lib/deep-research/identity.ts";
import { parseParametricCadRequest } from "../src/lib/cad/identity.ts";
import { parseVimaxRequest } from "../src/lib/vimax/identity.ts";
import { parseSocialsManagerRequest } from "../src/lib/socials-manager/identity.ts";
import { isSocialsManagerProviderId } from "../src/lib/socials-manager/providers.ts";

const root = path.resolve(".");
const source = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");
const agent = (id) => {
  const found = findConfigurableAgent(id);
  assert.ok(found, `${id} is missing from the settings catalog`);
  return found;
};

test("the catalog is internally consistent", () => {
  const ids = new Set();
  for (const entry of CONFIGURABLE_AGENTS) {
    assert.ok(!ids.has(entry.id), `${entry.id} is listed twice`);
    ids.add(entry.id);
    assert.match(entry.command, /^\/agents?:/);
    assert.ok(entry.fields.length > 0, `${entry.id} has a settings page with no settings`);

    const keys = new Set();
    for (const field of entry.fields) {
      assert.ok(!keys.has(field.key), `${entry.id}.${field.key} is declared twice`);
      keys.add(field.key);
      assert.ok(field.label && field.help, `${entry.id}.${field.key} is undocumented`);
      if (field.kind === "select") {
        assert.ok(
          field.options.some((option) => option.value === field.default),
          `${entry.id}.${field.key} defaults to a value it does not offer`,
        );
      }
      if (field.kind === "multiselect") {
        const allowed = new Set(field.options.map((option) => option.value));
        for (const value of field.default) {
          assert.ok(allowed.has(value), `${entry.id}.${field.key} defaults to an unoffered value`);
        }
      }
      if (field.kind === "number") {
        assert.ok(field.min <= field.max);
        const usable =
          (field.default >= field.min && field.default <= field.max) ||
          field.default === field.unsetValue;
        assert.ok(usable, `${entry.id}.${field.key} defaults outside its own range`);
      }
    }
  }
});

test("defaults round-trip and nonsense is repaired, not trusted", () => {
  for (const entry of CONFIGURABLE_AGENTS) {
    const defaults = agentSettingDefaults(entry);
    assert.deepEqual(normalizeAgentSettings(entry, defaults), defaults);
    assert.deepEqual(normalizeAgentSettings(entry, {}), defaults);
    assert.deepEqual(normalizeAgentSettings(entry, null), defaults);
    assert.deepEqual(normalizeAgentSettings(entry, "nope"), defaults);
    assert.ok(isDefaultAgentSettings(entry, defaults));

    // Unknown keys are dropped rather than stored.
    const withJunk = normalizeAgentSettings(entry, { ...defaults, notAField: "x" });
    assert.equal(withJunk.notAField, undefined);
  }
});

test("numbers are clamped, and 'let the run decide' survives clamping", () => {
  const research = agent("deep-research");
  assert.equal(normalizeAgentSettings(research, { breadth: 99 }).breadth, 10);
  assert.equal(normalizeAgentSettings(research, { breadth: -4 }).breadth, 1);
  assert.equal(normalizeAgentSettings(research, { breadth: "4" }).breadth, 4);
  assert.equal(normalizeAgentSettings(research, { breadth: "abc" }).breadth, 4);

  const vimax = agent("vimax");
  // 0 is outside the 1–12 range on purpose: it is the "unset" value.
  assert.equal(normalizeAgentSettings(vimax, { scenes: 0 }).scenes, 0);
  assert.equal(normalizeAgentSettings(vimax, { scenes: 40 }).scenes, 12);
});

test("a half-filled printer volume constrains nothing", () => {
  const cad = agent("parametric-cad");
  assert.equal(normalizeAgentSettings(cad, { printerBed: { x: 220, y: 220 } }).printerBed, null);
  assert.equal(normalizeAgentSettings(cad, { printerBed: { x: 220, y: 0, z: 250 } }).printerBed, null);
  assert.equal(normalizeAgentSettings(cad, { printerBed: "220x220" }).printerBed, null);
  assert.deepEqual(normalizeAgentSettings(cad, { printerBed: { x: 220, y: "220", z: 250 } }).printerBed, {
    x: 220,
    y: 220,
    z: 250,
  });
});

test("only real networks can be stored as Socials Manager defaults", () => {
  const socialsManager = agent("socials-manager");
  const stored = normalizeAgentSettings(socialsManager, {
    networks: ["x", "LINKEDIN", "not-a-network", "x"],
  });
  assert.deepEqual(stored.networks, ["x", "linkedin"]);
  for (const id of stored.networks) assert.ok(isSocialsManagerProviderId(id));
});

test("Deep Research: settings set the starting point, flags still win", () => {
  const settings = normalizeAgentSettings(agent("deep-research"), {
    breadth: 6,
    depth: 3,
    output: "answer",
  });
  const defaults = deepResearchDefaults(settings);

  const plain = parseResearchRequest("what changed in EU battery rules", defaults);
  assert.equal(plain.breadth, 6);
  assert.equal(plain.depth, 3);
  assert.equal(plain.output, "answer");
  assert.equal(plain.query, "what changed in EU battery rules");

  const flagged = parseResearchRequest("same question --breadth 2 --report", defaults);
  assert.equal(flagged.breadth, 2);
  assert.equal(flagged.depth, 3, "a flag overrides only what it names");
  assert.equal(flagged.output, "report");
  assert.equal(flagged.query, "same question");

  // No settings at all uses the full report defaults.
  const untouched = parseResearchRequest("a question");
  assert.equal(untouched.breadth, 4);
  assert.equal(untouched.depth, 2);
  assert.equal(untouched.output, "report");
});

test("Parametric CAD: process, units and volume default from settings", () => {
  const settings = normalizeAgentSettings(agent("parametric-cad"), {
    process: "sla",
    units: "inch",
    printerBed: { x: 145, y: 145, z: 175 },
  });
  const defaults = parametricCadDefaults(settings);

  const plain = parseParametricCadRequest("a bracket for a 20mm tube", defaults);
  assert.equal(plain.process, "sla");
  assert.equal(plain.units, "inch");
  assert.deepEqual(plain.printerBed, { x: 145, y: 145, z: 175 });
  assert.equal(plain.fresh, false, "'fresh' describes one message and is never a preference");

  const flagged = parseParametricCadRequest("the same bracket --fdm --bed 220x220x250", defaults);
  assert.equal(flagged.process, "fdm");
  assert.deepEqual(flagged.printerBed, { x: 220, y: 220, z: 250 });
  assert.equal(flagged.units, "inch");
});

test("ViMax: every default has a flag that undoes it", () => {
  const settings = normalizeAgentSettings(agent("vimax"), {
    mode: "script2video",
    aspectRatio: "9:16",
    style: "watercolour",
    scenes: 4,
    shots: 3,
    images: false,
  });
  const defaults = vimaxDefaults(settings);

  const plain = parseVimaxRequest("a film about tides", defaults);
  assert.equal(plain.mode, "script2video");
  assert.equal(plain.aspectRatio, "9:16");
  assert.equal(plain.style, "watercolour");
  assert.equal(plain.sceneCount, 4);
  assert.equal(plain.shotBudget, 3);
  assert.equal(plain.images, false);
  assert.match(plain.userRequirement, /exactly 4 scenes/);

  const undone = parseVimaxRequest(
    "a film about tides --idea --landscape --images --scenes 2",
    defaults,
  );
  assert.equal(undone.mode, "idea2video");
  assert.equal(undone.aspectRatio, "16:9");
  assert.equal(undone.images, true);
  assert.equal(undone.sceneCount, 2);
  assert.equal(undone.brief, "a film about tides");
});

test("Socials Manager: default networks apply only when the message names none", () => {
  const settings = normalizeAgentSettings(agent("socials-manager"), {
    networks: ["x", "linkedin"],
    images: true,
  });
  const defaults = socialsManagerDefaults(settings);

  const plain = parseSocialsManagerRequest("we shipped the settings pages", defaults);
  assert.deepEqual(plain.providerIds, ["x", "linkedin"]);
  assert.equal(plain.withImages, true);

  const named = parseSocialsManagerRequest("we shipped --on threads --no-image", defaults);
  assert.deepEqual(named.providerIds, ["threads"], "--on replaces the defaults, never adds to them");
  assert.equal(named.withImages, false);
  assert.equal(named.brief, "we shipped");
});

test("Ruflo and the step-limited agents read their numbers", () => {
  const swarm = rufloDefaults(
    normalizeAgentSettings(agent("ruflo"), {
      workers: 9,
      queenType: "adaptive",
      consensus: "quorum",
      topology: "mesh",
    }),
  );
  assert.deepEqual(swarm, {
    workers: 9,
    queenType: "adaptive",
    consensus: "quorum",
    topology: "mesh",
  });

  assert.equal(maxStepsSetting(normalizeAgentSettings(agent("agent-reach"), { maxSteps: 30 }), 16), 30);
  assert.equal(maxStepsSetting(normalizeAgentSettings(agent("career-ops"), { maxSteps: 999 }), 24), 60);
  assert.equal(maxStepsSetting({}, 24), 24, "an unconfigured agent keeps its own fallback");
});

test("Hardware preferences are advice to the model, never an override", () => {
  const preferences = hardwarePreferences(
    normalizeAgentSettings(agent("hardware-blueprint"), {
      board: "esp32-devkit-v1",
      prototype: "pcb",
      firmware: "arduino",
      enclosure: "always",
    }),
  );
  assert.equal(preferences.board, "esp32-devkit-v1");
  assert.equal(preferences.enclosure, "always");

  const note = hardwarePreferenceNote(preferences);
  assert.match(note, /the brief wins/i);
  assert.match(note, /ESP32 DevKit v1/);
  assert.equal(hardwarePreferenceNote(hardwarePreferences({})), null, "nothing set says nothing");

  // The board must not be pushed into the parsed command flags, which override
  // what the model read out of the brief.
  const runManager = source("src", "lib", "hardware", "run-manager.ts");
  assert.match(runManager, /preferenceNote/);
  assert.doesNotMatch(
    runManager,
    /parsed\.board\s*=|parsed\.board\s*\?\?\s*input\.preferences/,
    "a stored board preference must never be written into the command flags",
  );
});

test("every wired agent actually reads its settings on the way to a run", () => {
  const wiring = [
    [path.join("src", "app", "api", "hardware-blueprint", "runs", "route.ts"), "hardware-blueprint"],
    [path.join("src", "app", "api", "cad", "runs", "route.ts"), "parametric-cad"],
    [path.join("src", "app", "api", "vimax", "runs", "route.ts"), "vimax"],
    [path.join("src", "app", "api", "ruflo", "runs", "route.ts"), "ruflo"],
    [path.join("src", "app", "api", "agent-reach", "runs", "route.ts"), "agent-reach"],
    [path.join("src", "app", "api", "career-ops", "runs", "route.ts"), "career-ops"],
    [path.join("src", "lib", "socials-manager", "run-manager.ts"), "socials-manager"],
  ];
  for (const [file, agentId] of wiring) {
    const text = source(file);
    assert.match(text, /agentSettingsFor\(/, `${file} never reads the settings store`);
    assert.ok(text.includes(`"${agentId}"`), `${file} reads settings for the wrong agent`);
  }

  // Deep Research parses in the browser, so its settings arrive over the client
  // loader instead of the store.
  for (const file of [
    path.join("src", "app", "components", "hermes", "use-deep-research-agent.ts"),
    path.join("src", "app", "gardens", "[clusterSlug]", "workspace-client.tsx"),
  ]) {
    const text = source(file);
    assert.match(text, /loadAgentSettings\("deep-research"\)/, `${file} launches without settings`);
  }
});

test("settings open from the agent, in one panel, and never as a page", () => {
  assert.equal(
    fs.existsSync(path.join(root, "src", "app", "agents")),
    false,
    "there is no agents page any more — settings live with the agent",
  );

  const hub = source("src", "app", "components", "hermes", "command-hub.tsx");
  assert.match(hub, /function AgentSettingsButton/);
  assert.doesNotMatch(hub, /SettingsGearIcon/, "one settings control per agent, not two");
  assert.doesNotMatch(
    hub,
    /Agent settings\s*<\/span>/,
    "settings belong on each agent, not in a list entry of their own",
  );

  // The panel for the agents that had none of their own.
  const dialog = source("src", "app", "components", "hermes", "agent-settings-dialog.tsx");
  assert.match(dialog, /bb-modal-backdrop/, "it has to look like every other agent panel");
  assert.match(dialog, /AgentRunDefaults/);

  // The agents that already had a panel keep exactly one, with the defaults in it.
  for (const [file, agentId] of [
    ["agent-reach-settings-dialog.tsx", "agent-reach"],
    ["socials-manager-settings-dialog.tsx", "socials-manager"],
    ["tradingagents-settings-dialog.tsx", "trading-agent"],
  ]) {
    const text = source("src", "app", "components", "hermes", file);
    assert.match(
      text,
      /<AgentRunDefaults[\s\S]{0,80}agentId=/,
      `${file} opens without the agent's own defaults in it`,
    );
    // The id may be written out or imported from the agent's identity module;
    // the constant is the better form, because a rename then cannot miss it.
    assert.ok(
      text.includes(`agentId="${agentId}"`) || /agentId=\{[A-Z_]*AGENT_ID\}/.test(text),
      `${file} renders another agent's defaults`,
    );
    assert.doesNotMatch(text, /\/agents\/[a-z-]+\/settings/, `${file} still links to a deleted page`);
  }

  // Every agent the palette offers can reach its settings from its own row.
  for (const entry of CONFIGURABLE_AGENTS) {
    // `agent:<id>` is how a palette row identifies itself for highlighting.
    if (!hub.includes(`"agent:${entry.id}"`)) continue;
    assert.ok(
      hub.includes(`setAgentSettingsFor("${entry.id}")`) ||
        new RegExp(`name="${entry.name}"\\s*\\n\\s*onOpen=`).test(hub),
      `${entry.id} is offered in the palette with no way to reach its settings`,
    );
  }
});

test("one row per user per agent, and it leaves with the user", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(
    "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, email TEXT, password_hash TEXT);",
  );
  db.prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)").run(
    "k",
    "k@example.com",
    "x",
  );

  ensureAgentSettingsSchema(db);
  ensureAgentSettingsSchema(db); // re-applying must be harmless

  // The store's own upsert, so a typo in it fails here rather than in the app.
  const write = db.prepare(
    `INSERT INTO agent_settings (user_id, agent_id, values_json, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, agent_id) DO UPDATE SET
       values_json = excluded.values_json,
       updated_at  = excluded.updated_at`,
  );
  const read = db.prepare("SELECT values_json FROM agent_settings WHERE user_id = ? AND agent_id = ?");
  const count = () => db.prepare("SELECT COUNT(*) AS n FROM agent_settings").get().n;

  write.run(1, "deep-research", JSON.stringify({ breadth: 6 }));
  write.run(1, "deep-research", JSON.stringify({ breadth: 9 }));
  assert.equal(count(), 1, "saving twice must update, not accumulate");
  assert.equal(read.get(1, "deep-research").values_json, '{"breadth":9}');

  // Resetting removes the row: no row is what "never configured" means.
  db.prepare("DELETE FROM agent_settings WHERE user_id = ? AND agent_id = ?").run(1, "deep-research");
  assert.equal(read.get(1, "deep-research"), undefined);

  write.run(1, "vimax", "{}");
  db.prepare("DELETE FROM users WHERE id = 1").run();
  assert.equal(count(), 0, "settings must not outlive the account they belong to");
  db.close();
});

test("a settings summary reads as a sentence, not as JSON", () => {
  const research = agent("deep-research");
  const described = describeAgentSettings(
    research,
    normalizeAgentSettings(research, { breadth: 5, depth: 2, output: "answer" }),
  );
  assert.equal(described, "Breadth: 5 · Depth: 2 · Output: Answer");

  const vimax = agent("vimax");
  const quiet = describeAgentSettings(vimax, agentSettingDefaults(vimax));
  assert.doesNotMatch(quiet, /Scenes/, "an unset number is not worth reporting");
});
