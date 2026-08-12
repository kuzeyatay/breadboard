import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { ensureArtifactSchema } from "../src/lib/hermes/artifact-schema.ts";
import {
  ensureGadgetSchema,
  widenCheckConstraint,
} from "../src/lib/hermes/gadget-schema.ts";
import { ARTIFACT_KINDS } from "../src/lib/hermes/artifact-types.ts";
import { availableArtifactRenderers } from "../src/lib/hermes/artifact-renderers.ts";
import {
  parseStoredGadget,
  validateGadgetPackage,
} from "../src/lib/hermes/gadget-validator.ts";
import {
  gadgetHostApiReference,
  renderGadgetDocument,
} from "../src/lib/hermes/gadget-runtime.ts";
import {
  createGadgetRecord,
  decideGadgetAction,
  getGadgetAction,
  listGadgetActions,
  listGadgetObservations,
  markGadgetActionApplied,
  readGadgetStorage,
  recordGadgetObservation,
  setAutoApprovalRule,
  submitGadgetAction,
  writeGadgetStorage,
} from "../src/lib/hermes/gadget-store.ts";
import { gadgetBindingHandler } from "../src/lib/hermes/gadget-bindings.ts";
import { allowedToolsForSurface, GADGET_TOOLS } from "../src/lib/hermes/tool-scopes.ts";
import { BROKERED_TOOLS } from "../src/lib/hermes/capability-broker.ts";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function gadgetPackage(overrides = {}) {
  return {
    schemaVersion: 1,
    manifest: {
      schemaVersion: 1,
      artifactType: "gadget",
      title: "Reading queue",
      description: "Keeps a list of books to read.",
      purpose: "Track what you mean to read next.",
      entry: "index.html",
      bindings: [
        {
          name: "shelf",
          kind: "storage",
          purpose: "to keep your reading list between visits",
          writable: true,
        },
      ],
      runtime: { id: "breadboard-gadget", version: "1.0.0" },
      ...(overrides.manifest ?? {}),
    },
    files: {
      "index.html": '<main><ul id="list"></ul></main>\n<script src="main.js"></script>',
      "styles.css": "main { font-size: 14px; }",
      "main.js":
        "const books = await host.shelf.observe('get', { key: 'books' });\n" +
        "await host.shelf.act('set', { key: 'books', value: books ?? [] });\n" +
        "host.ready();",
      ...(overrides.files ?? {}),
    },
    assumptions: ["The list is personal to this chat."],
    limitations: ["It does not sync anywhere."],
    ...(overrides.top ?? {}),
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-gadget-"));
  const database = new Database(path.join(root, "gadget.sqlite"));
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY, slug TEXT, user_id INTEGER);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT, user_id INTEGER, surface TEXT, default_garden_id INTEGER);
    CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY);
    CREATE TABLE hermes_runs(id TEXT PRIMARY KEY, runtime_session_id INTEGER);
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY);
    INSERT INTO users VALUES (1);
    INSERT INTO conversations VALUES (10, 'conv_terminal', 1, 'dashboard_terminal', NULL);
    INSERT INTO hermes_runtime_sessions VALUES (20);
    INSERT INTO hermes_runs VALUES ('run_one', 20);
  `);
  ensureArtifactSchema(database);
  return { root, database };
}

/** A gadget record with no artifact row, for store-level queue tests. */
function queueFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-gadget-queue-"));
  const database = new Database(path.join(root, "queue.sqlite"));
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE hermes_artifacts(id TEXT PRIMARY KEY, user_id INTEGER, title TEXT);
    INSERT INTO hermes_artifacts VALUES ('art_1', 1, 'Reading queue');
  `);
  ensureGadgetSchema(database);
  createGadgetRecord({
    artifactId: "art_1",
    manifest: gadgetPackage().manifest,
    lifecycleStatus: "ready",
    database,
  });
  return { root, database };
}

function simulation(overrides = {}) {
  return {
    ok: true,
    outcome: "`books` would be created.",
    changes: [{ field: "books", before: null, after: "[]" }],
    simulatedResult: { key: "books", stored: true },
    ...overrides,
  };
}

function description(overrides = {}) {
  return {
    title: 'Save "books" in this gadget\'s storage',
    description: "Store a value under `books`.",
    binding: "shelf",
    operation: "set",
    actionKind: { tag: "storage.set", label: "Save gadget data" },
    implementsRevert: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The artifact kind and its migration
// ---------------------------------------------------------------------------

test("gadget is a first-class artifact kind with a registered renderer", () => {
  assert.ok(ARTIFACT_KINDS.includes("gadget"));
  const renderer = availableArtifactRenderers().find((entry) => entry.id === "gadget");
  assert.ok(renderer, "the gadget renderer is registered");
  assert.equal(renderer.kind, "gadget");
});

test("a database created before gadgets existed accepts them after migration", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-gadget-migration-"));
  const file = path.join(root, "legacy.sqlite");
  const legacy = new Database(file);
  legacy.pragma("foreign_keys = ON");
  // The exact shape shipped before gadgets, including a dependent table, so the
  // migration is exercised against real foreign keys rather than a bare table.
  legacy.exec(`
    CREATE TABLE hermes_artifacts (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('text','markdown','document','pdf','presentation','spreadsheet','html','code','image','audio','video','diagram','data','unknown')),
      title TEXT NOT NULL
    );
    CREATE INDEX idx_kind ON hermes_artifacts(kind);
    CREATE TABLE hermes_artifact_versions(id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES hermes_artifacts(id) ON DELETE CASCADE);
    INSERT INTO hermes_artifacts VALUES ('old_1', 'markdown', 'An existing note');
    INSERT INTO hermes_artifact_versions VALUES ('v1', 'old_1');
  `);
  assert.throws(
    () => legacy.prepare("INSERT INTO hermes_artifacts VALUES (?,?,?)").run("g1", "gadget", "Nope"),
    /CHECK constraint/i,
    "the legacy constraint rejects gadgets before migrating",
  );

  const migrated = widenCheckConstraint(legacy, {
    table: "hermes_artifacts",
    sentinel: "'gadget'",
    from: "'data','unknown'))",
    to: "'data','unknown','gadget'))",
  });
  assert.equal(migrated, true);
  assert.equal(
    widenCheckConstraint(legacy, {
      table: "hermes_artifacts",
      sentinel: "'gadget'",
      from: "'data','unknown'))",
      to: "'data','unknown','gadget'))",
    }),
    false,
    "running it again is a no-op",
  );

  legacy.prepare("INSERT INTO hermes_artifacts VALUES (?,?,?)").run("g1", "gadget", "A gadget");
  assert.throws(
    () => legacy.prepare("INSERT INTO hermes_artifacts VALUES (?,?,?)").run("g2", "bogus", "Bad"),
    /CHECK constraint/i,
    "the widened constraint still rejects everything else",
  );
  assert.equal(legacy.pragma("integrity_check", { simple: true }), "ok");
  assert.equal(legacy.pragma("foreign_key_check").length, 0);
  assert.equal(
    legacy.prepare("SELECT title FROM hermes_artifacts WHERE id = 'old_1'").get().title,
    "An existing note",
    "existing rows survive",
  );
  assert.equal(
    legacy.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND tbl_name='hermes_artifacts'").get().c >= 1,
    true,
    "indexes survive",
  );
  legacy.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("the migration refuses to rewrite a constraint it does not recognise", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-gadget-migration-guard-"));
  const database = new Database(path.join(root, "odd.sqlite"));
  database.exec(`CREATE TABLE hermes_artifacts (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('something','else')))`);
  assert.throws(
    () =>
      widenCheckConstraint(database, {
        table: "hermes_artifacts",
        sentinel: "'gadget'",
        from: "'data','unknown'))",
        to: "'data','unknown','gadget'))",
      }),
    /does not match the expected text/,
  );
  database.close();
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Validation — sandbox containment
// ---------------------------------------------------------------------------

test("a well-formed gadget validates and round-trips", () => {
  const { validation, value } = validateGadgetPackage(gadgetPackage());
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.valid, true);
  assert.equal(value.manifest.title, "Reading queue");
  const reparsed = parseStoredGadget(JSON.parse(JSON.stringify(value)));
  assert.equal(reparsed.ok, true);
  assert.equal(reparsed.value.manifest.bindings[0].name, "shelf");
});

test("code that would leave the sandbox is rejected at publication", () => {
  const escapes = {
    "calls fetch": "fetch('https://example.com');",
    "uses XHR": "new XMLHttpRequest();",
    "opens a socket": "new WebSocket('wss://example.com');",
    "uses browser storage": "localStorage.setItem('a','b');",
    "reaches the parent": "window.parent.postMessage(1);",
    "evaluates strings": "eval('1+1');",
    "reads cookies": "document.cookie;",
  };
  for (const [label, snippet] of Object.entries(escapes)) {
    const { validation } = validateGadgetPackage(
      gadgetPackage({ files: { "main.js": `${snippet}\nhost.ready();` } }),
    );
    assert.equal(validation.valid, false, `${label} should be rejected`);
    assert.ok(validation.errors.length > 0, `${label} reports why`);
  }
});

test("a gadget cannot call a binding it did not declare, or write through a read-only one", () => {
  const undeclared = validateGadgetPackage(
    gadgetPackage({
      files: { "main.js": "await host.phone.act('send', {});\nhost.ready();" },
    }),
  );
  assert.equal(undeclared.validation.valid, false);
  assert.ok(
    undeclared.validation.errors.some((error) => error.includes("host.phone")),
    "names the undeclared binding",
  );

  const readOnly = validateGadgetPackage(
    gadgetPackage({
      manifest: {
        bindings: [
          { name: "shelf", kind: "storage", purpose: "to read your list", writable: false },
        ],
      },
      files: {
        "main.js": "await host.shelf.act('set', { key: 'a', value: 1 });\nhost.ready();",
      },
    }),
  );
  assert.equal(readOnly.validation.valid, false);
  assert.ok(
    readOnly.validation.errors.some((error) => error.includes("read-only")),
    "explains that the binding is read-only",
  );
});

test("an unused binding is a warning, not a failure", () => {
  const { validation } = validateGadgetPackage(
    gadgetPackage({
      files: { "main.js": "host.ready();" },
    }),
  );
  assert.equal(validation.valid, true);
  assert.ok(validation.warnings.some((warning) => warning.includes("shelf")));
});

// ---------------------------------------------------------------------------
// The sandbox document
// ---------------------------------------------------------------------------

test("the rendered document inlines everything and exposes only declared bindings", () => {
  const { value } = validateGadgetPackage(gadgetPackage());
  const document = renderGadgetDocument(value);
  assert.ok(document.startsWith("<!doctype html>"));
  assert.ok(document.includes("main { font-size: 14px; }"), "styles are inlined");
  assert.ok(document.includes("host.shelf.observe"), "the gadget's code is inlined");
  assert.ok(
    !/<script[^>]*src=/i.test(document),
    "nothing is left to be fetched",
  );
  assert.ok(document.includes('"name":"shelf"'), "the bridge knows the binding");
  assert.ok(document.includes("parent.postMessage"), "the bridge talks to the embedder");
  assert.ok(
    !document.includes("Authorization") && !document.includes("Bearer"),
    "no credential is handed to the frame",
  );
});

test("a read-only binding gets no act method in the frame", () => {
  const { value } = validateGadgetPackage(
    gadgetPackage({
      manifest: {
        bindings: [
          { name: "shelf", kind: "storage", purpose: "to read your list", writable: false },
        ],
      },
      files: { "main.js": "await host.shelf.observe('keys', {});\nhost.ready();" },
    }),
  );
  const document = renderGadgetDocument(value);
  assert.ok(document.includes('"writable":false'));
  assert.ok(
    document.includes("if (binding.writable)"),
    "act is attached conditionally on writability",
  );
});

test("the host API reference tells the model that act has not happened yet", () => {
  const reference = gadgetHostApiReference();
  assert.match(reference, /Resolves IMMEDIATELY/);
  assert.match(reference, /has not occurred/);
  assert.match(reference, /queued/);
});

// ---------------------------------------------------------------------------
// The approval queue
// ---------------------------------------------------------------------------

test("submitting an action queues it and changes nothing", () => {
  const { root, database } = queueFixture();
  try {
    const before = readGadgetStorage({ artifactId: "art_1", key: "books", database });
    assert.equal(before, null);

    const action = submitGadgetAction({
      artifactId: "art_1",
      description: description(),
      payload: { key: "books", value: ["Dune"] },
      simulation: simulation(),
      database,
    });

    assert.equal(action.status, "pending");
    assert.equal(action.sequence, 1);
    assert.equal(action.appliedAt, null);
    assert.equal(
      readGadgetStorage({ artifactId: "art_1", key: "books", database }),
      null,
      "queueing a write does not perform it",
    );
    assert.equal(action.simulation.outcome, "`books` would be created.");
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a decision is recorded once and cannot be reversed by a second call", () => {
  const { root, database } = queueFixture();
  try {
    const action = submitGadgetAction({
      artifactId: "art_1",
      description: description(),
      payload: { key: "books", value: [] },
      simulation: simulation(),
      database,
    });
    const approved = decideGadgetAction({
      actionId: action.id,
      decision: "approved",
      database,
    });
    assert.equal(approved.status, "approved");
    assert.ok(approved.decidedAt);
    assert.throws(
      () => decideGadgetAction({ actionId: action.id, decision: "rejected", database }),
      /already approved/,
    );
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("auto-approval needs both a user rule and the action's own verdict", () => {
  const { root, database } = queueFixture();
  try {
    // A rule exists, but this action does not declare itself auto-approvable.
    setAutoApprovalRule({
      artifactId: "art_1",
      actionKindTag: "storage.set",
      actionKindLabel: "Save gadget data",
      enabled: true,
      database,
    });
    const withoutVerdict = submitGadgetAction({
      artifactId: "art_1",
      description: description({ autoApprovable: false }),
      payload: { key: "a", value: 1 },
      simulation: simulation(),
      database,
    });
    assert.equal(withoutVerdict.status, "pending", "a rule alone does not auto-approve");

    const withVerdict = submitGadgetAction({
      artifactId: "art_1",
      description: description({ autoApprovable: true }),
      payload: { key: "b", value: 2 },
      simulation: simulation(),
      database,
    });
    assert.equal(withVerdict.status, "approved");
    assert.equal(withVerdict.autoApplied, true);
    assert.equal(
      readGadgetStorage({ artifactId: "art_1", key: "b", database }),
      null,
      "even an auto-approved action is only queued, never applied on submit",
    );

    // And the verdict alone is not enough either.
    setAutoApprovalRule({
      artifactId: "art_1",
      actionKindTag: "storage.set",
      actionKindLabel: "Save gadget data",
      enabled: false,
      database,
    });
    const withoutRule = submitGadgetAction({
      artifactId: "art_1",
      description: description({ autoApprovable: true }),
      payload: { key: "c", value: 3 },
      simulation: simulation(),
      database,
    });
    assert.equal(withoutRule.status, "pending", "a verdict alone does not auto-approve");
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the queue refuses to grow past the point a person could review it", () => {
  const { root, database } = queueFixture();
  try {
    for (let index = 0; index < 50; index += 1) {
      submitGadgetAction({
        artifactId: "art_1",
        description: description(),
        payload: { key: `k${index}`, value: index },
        simulation: simulation(),
        database,
      });
    }
    assert.throws(
      () =>
        submitGadgetAction({
          artifactId: "art_1",
          description: description(),
          payload: { key: "overflow", value: 1 },
          simulation: simulation(),
          database,
        }),
      /waiting for a decision/,
    );
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reads are recorded as observations rather than queued", () => {
  const { root, database } = queueFixture();
  try {
    recordGadgetObservation({
      artifactId: "art_1",
      description: {
        title: "Read stored value \"books\"",
        description: "The gadget read its own saved value.",
        binding: "shelf",
        operation: "get",
      },
      database,
    });
    const observations = listGadgetObservations({ artifactId: "art_1", database });
    assert.equal(observations.length, 1);
    assert.equal(observations[0].description.operation, "get");
    assert.equal(
      listGadgetActions({ artifactId: "art_1", database }).length,
      0,
      "a read never enters the approval queue",
    );
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Binding handlers: describe / simulate / apply
// ---------------------------------------------------------------------------

test("simulating a storage write predicts the change without making it", async () => {
  const { root, database } = queueFixture();
  try {
    const handler = gadgetBindingHandler("storage");
    const context = {
      userId: 1,
      gadgetArtifactId: "art_1",
      conversationId: 10,
      conversationPublicId: "conv_terminal",
      clusterId: null,
      surface: "dashboard_terminal",
      runtimeSessionId: 20,
      hermesSessionId: "session",
      runId: "run_one",
      binding: { name: "shelf", kind: "storage", purpose: "p", writable: true },
    };
    writeGadgetStorage({ artifactId: "art_1", key: "books", value: ["Dune"], database });

    // The handlers reach the module-level database, so this test asserts the
    // *prediction* against the value it was given rather than re-reading.
    const predicted = await handler.actions.set.simulate({
      payload: { key: "books", value: ["Dune", "Neuromancer"] },
      context,
    });
    assert.equal(predicted.ok, true);
    assert.match(predicted.outcome, /`books` would be/);
    assert.equal(predicted.changes[0].field, "books");
    assert.deepEqual(predicted.simulatedResult, { key: "books", stored: true });

    const described = handler.actions.set.describe({
      payload: { key: "books", value: [] },
      context,
    });
    assert.equal(described.actionKind.tag, "storage.set");
    assert.equal(described.implementsRevert, true);
    assert.equal(typeof handler.actions.set.revert, "function");
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("irreversible bindings say so and are never auto-approvable", () => {
  const messaging = gadgetBindingHandler("messaging");
  const described = messaging.actions.send.describe({
    payload: { channel: "telegram", text: "hello" },
    context: {
      userId: 1,
      gadgetArtifactId: "art_1",
      conversationId: 10,
      conversationPublicId: "conv_terminal",
      clusterId: null,
      surface: "dashboard_terminal",
      runtimeSessionId: 20,
      hermesSessionId: "session",
      runId: "run_one",
      binding: { name: "phone", kind: "messaging", purpose: "p", writable: true },
    },
  });
  assert.equal(described.implementsRevert, false, "a sent message cannot be unsent");
  assert.equal(described.autoApprovable, false, "and is never auto-approvable");
  assert.equal(typeof messaging.actions.send.revert, "undefined");
  assert.match(described.description, /hello/, "the user sees what would be sent");

  const memory = gadgetBindingHandler("memory");
  const save = memory.actions.save.describe({
    payload: { content: "Prefers dark mode" },
    context: {
      userId: 1,
      gadgetArtifactId: "art_1",
      conversationId: 10,
      conversationPublicId: "conv_terminal",
      clusterId: null,
      surface: "dashboard_terminal",
      runtimeSessionId: 20,
      hermesSessionId: "session",
      runId: "run_one",
      binding: { name: "brain", kind: "memory", purpose: "p", writable: true },
    },
  });
  assert.equal(save.autoApprovable, false);
});

test("every declared revert contract is backed by a real revert", () => {
  for (const kind of ["storage", "artifact", "messaging", "memory"]) {
    const handler = gadgetBindingHandler(kind);
    for (const [name, action] of Object.entries(handler.actions)) {
      const context = {
        userId: 1,
        gadgetArtifactId: "art_1",
        conversationId: 10,
        conversationPublicId: "conv_terminal",
        clusterId: null,
        surface: "dashboard_terminal",
        runtimeSessionId: 20,
        hermesSessionId: "session",
        runId: "run_one",
        binding: { name: "b", kind, purpose: "p", writable: true },
      };
      const payload = {
        key: "k",
        value: 1,
        channel: "telegram",
        text: "t",
        content: "c",
        title: "t",
      };
      const described = action.describe({ payload, context });
      if (described.implementsRevert) {
        assert.equal(
          typeof action.revert,
          "function",
          `${kind}.${name} claims revert but implements none`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

test("the gadget tools are offered on both authenticated surfaces and brokered", () => {
  for (const surface of ["garden_chat", "dashboard_terminal"]) {
    const allowed = new Set(allowedToolsForSurface(surface));
    for (const tool of GADGET_TOOLS) {
      assert.ok(allowed.has(tool), `${tool} is missing from ${surface}`);
    }
  }
  const quartz = new Set(allowedToolsForSurface("quartz_ai"));
  for (const tool of GADGET_TOOLS) {
    assert.equal(quartz.has(tool), false, `${tool} must never reach anonymous Quartz`);
  }
  for (const tool of GADGET_TOOLS) {
    assert.ok(BROKERED_TOOLS.includes(tool), `${tool} is not brokered`);
  }
});

test("the generate-gadget skill resolves as ready with its real requirements", () => {
  const skills = listFirstPartySkills("dashboard_terminal");
  const skill = skills.find((entry) => entry.name === "generate-gadget");
  assert.ok(skill, "generate-gadget is discovered as a first-party skill");
  assert.equal(skill.healthy, true, `expected healthy, got: ${JSON.stringify(skill.reasons ?? [])}`);
  assert.equal(
    skill.availability,
    "ready",
    `expected ready, got ${skill.availability}: ${JSON.stringify(skill.reasons ?? [])}`,
  );
});

// ---------------------------------------------------------------------------
// End to end through the store
// ---------------------------------------------------------------------------

test("an approved action applies, and the applied result is kept apart from the simulation", () => {
  const { root, database } = queueFixture();
  try {
    const action = submitGadgetAction({
      artifactId: "art_1",
      description: description(),
      payload: { key: "books", value: ["Dune"] },
      simulation: simulation(),
      database,
    });
    decideGadgetAction({ actionId: action.id, decision: "approved", database });
    // Stands in for the service's apply step, which calls the binding handler.
    writeGadgetStorage({ artifactId: "art_1", key: "books", value: ["Dune"], database });
    const applied = markGadgetActionApplied({
      actionId: action.id,
      result: { key: "books", stored: true },
      database,
    });

    assert.equal(applied.status, "applied");
    assert.ok(applied.appliedAt);
    assert.deepEqual(applied.appliedResult, { key: "books", stored: true });
    assert.deepEqual(
      applied.simulation.simulatedResult,
      { key: "books", stored: true },
      "the simulation is preserved next to the real result",
    );
    assert.deepEqual(
      readGadgetStorage({ artifactId: "art_1", key: "books", database }),
      ["Dune"],
      "the write took effect only after approval",
    );
    assert.equal(getGadgetAction(action.id, database).status, "applied");
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a full artifact schema carries the gadget tables", () => {
  const { root, database } = fixture();
  try {
    const tables = new Set(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    for (const table of [
      "hermes_gadgets",
      "hermes_gadget_actions",
      "hermes_gadget_observations",
      "hermes_gadget_auto_approvals",
      "hermes_gadget_storage",
    ]) {
      assert.ok(tables.has(table), `${table} is missing`);
    }
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
