import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { planTask } from "../src/lib/hermes/task-plan.ts";
import { brokerCapabilities } from "../src/lib/hermes/capability-broker.ts";
import { ensureArtifactSchema } from "../src/lib/hermes/artifact-schema.ts";
import {
  getArtifactInAgentScope,
  listArtifactsInAgentScope,
} from "../src/lib/hermes/artifact-agent-scope.ts";
import { searchArtifactsForAgent } from "../src/lib/hermes/artifact-agent-search.ts";
import { artifactAiEditMatchesScope } from "../src/app/components/hermes/artifact-ai-edit.ts";
import {
  createArtifact,
  readArtifactSource,
  renderArtifact,
  updateArtifactContent,
} from "../src/lib/hermes/artifact-store.ts";

function artifactFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-artifact-search-"));
  const database = new Database(path.join(root, "artifacts.sqlite"));
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY, slug TEXT NOT NULL, user_id INTEGER);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT UNIQUE, user_id INTEGER, surface TEXT, default_garden_id INTEGER);
    CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY);
    CREATE TABLE hermes_runs(id TEXT PRIMARY KEY, runtime_session_id INTEGER);
    CREATE TABLE conversation_messages(
      id INTEGER PRIMARY KEY,
      conversation_id INTEGER,
      client_message_id TEXT,
      role TEXT NOT NULL DEFAULT 'assistant',
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00.000Z'
    );
    CREATE TABLE chat_sessions(id INTEGER PRIMARY KEY, conversation_id INTEGER);
    CREATE TABLE chat_messages(
      id INTEGER PRIMARY KEY,
      session_id INTEGER,
      role TEXT,
      content TEXT,
      created_at TEXT,
      canonical_message_id INTEGER
    );
    INSERT INTO users VALUES (1), (2);
    INSERT INTO clusters VALUES (7, 'physics', 1), (8, 'chemistry', 1);
    INSERT INTO conversations VALUES
      (10, 'garden-one', 1, 'garden_chat', 7),
      (11, 'garden-two', 1, 'garden_chat', 7),
      (12, 'other-garden', 1, 'garden_chat', 8),
      (13, 'terminal-one', 1, 'dashboard_terminal', NULL),
      (14, 'terminal-two', 1, 'dashboard_terminal', NULL),
      (15, 'other-user', 2, 'dashboard_terminal', NULL);
    INSERT INTO hermes_runtime_sessions VALUES (20);
    INSERT INTO hermes_runs VALUES ('run-one', 20), ('run-two', 20);
  `);
  ensureArtifactSchema(database);
  return { root, storage: path.join(root, "storage"), database };
}

function createInput(fixture, overrides = {}) {
  return {
    userId: 1,
    runtimeSessionId: 20,
    hermesSessionId: "hermes-session",
    conversationId: 10,
    clusterId: 7,
    runId: "run-one",
    assistantMessageId: null,
    surface: "garden_chat",
    kind: "markdown",
    rendererId: "markdown",
    title: "Study notes",
    filename: "study-notes.md",
    content: "# Notes\n\nGrounded material.",
    database: fixture.database,
    storageRoot: fixture.storage,
    ...overrides,
  };
}

test("Hermes artifact scope mirrors the visible Terminal and Garden archives", () => {
  const fixture = artifactFixture();
  try {
    const gardenOne = createArtifact(createInput(fixture));
    const gardenTwo = createArtifact(createInput(fixture, {
      conversationId: 11,
      title: "Second physics chat",
    }));
    const otherGarden = createArtifact(createInput(fixture, {
      conversationId: 12,
      clusterId: 8,
      title: "Chemistry chat",
    }));
    const terminalOne = createArtifact(createInput(fixture, {
      conversationId: 13,
      clusterId: null,
      surface: "dashboard_terminal",
      title: "Terminal one",
    }));
    const terminalTwo = createArtifact(createInput(fixture, {
      conversationId: 14,
      clusterId: null,
      surface: "dashboard_terminal",
      title: "Terminal two",
    }));
    const otherUser = createArtifact(createInput(fixture, {
      userId: 2,
      conversationId: 15,
      clusterId: null,
      surface: "dashboard_terminal",
      title: "Other user",
    }));

    const gardenScope = {
      userId: 1,
      surface: "garden_chat",
      clusterId: 7,
      gardenSlug: "physics",
    };
    assert.deepEqual(
      new Set(listArtifactsInAgentScope(gardenScope, fixture.database).map((item) => item.id)),
      new Set([gardenOne.id, gardenTwo.id]),
    );
    assert.equal(getArtifactInAgentScope(gardenTwo.id, gardenScope, fixture.database).id, gardenTwo.id);
    assert.throws(
      () => getArtifactInAgentScope(otherGarden.id, gardenScope, fixture.database),
      /Artifact not found/,
    );

    const terminalScope = {
      userId: 1,
      surface: "dashboard_terminal",
      clusterId: null,
      gardenSlug: null,
    };
    assert.deepEqual(
      new Set(listArtifactsInAgentScope(terminalScope, fixture.database).map((item) => item.id)),
      new Set([terminalOne.id, terminalTwo.id]),
    );
    assert.throws(
      () => getArtifactInAgentScope(otherUser.id, terminalScope, fixture.database),
      /Artifact not found/,
    );
    assert.throws(
      () => getArtifactInAgentScope(gardenOne.id, terminalScope, fixture.database),
      /Artifact not found/,
    );
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Hermes can search and revise an artifact from another chat in its active scope", async () => {
  const fixture = artifactFixture();
  try {
    const unrelated = createArtifact(createInput(fixture, {
      title: "Unrelated catalog entry",
      content: "No matching phrase here.",
    }));
    let artifact = createArtifact(createInput(fixture, {
      conversationId: 11,
      runId: "run-two",
      title: "Circuit derivation",
      filename: "derivation.md",
      content: "# Derivation\n\nThe hidden phrase is characteristic impedance matrix.",
    }));
    artifact = await renderArtifact({
      artifact,
      runId: "run-two",
      assistantMessageId: null,
      database: fixture.database,
      storageRoot: fixture.storage,
    });
    const scope = {
      userId: 1,
      surface: "garden_chat",
      clusterId: 7,
      gardenSlug: "physics",
    };
    const artifacts = listArtifactsInAgentScope(scope, fixture.database);

    const byContent = await searchArtifactsForAgent({
      artifacts,
      query: "characteristic impedance",
      database: fixture.database,
      storageRoot: fixture.storage,
    });
    assert.equal(byContent.matches.length, 1);
    assert.equal(byContent.matches[0].artifact.id, artifact.id);
    assert.equal(byContent.matches[0].matchedIn, "content");
    assert.match(byContent.matches[0].snippet, /characteristic impedance matrix/i);

    const firstPage = await searchArtifactsForAgent({
      artifacts: [unrelated, artifact],
      query: "characteristic impedance",
      maxContentArtifacts: 1,
      database: fixture.database,
      storageRoot: fixture.storage,
    });
    assert.equal(firstPage.matches.length, 0);
    assert.equal(firstPage.contentSearchTruncated, true);
    assert.equal(firstPage.nextContentOffset, 1);
    const secondPage = await searchArtifactsForAgent({
      artifacts: [unrelated, artifact],
      query: "characteristic impedance",
      contentOffset: firstPage.nextContentOffset,
      maxContentArtifacts: 1,
      database: fixture.database,
      storageRoot: fixture.storage,
    });
    assert.equal(secondPage.matches[0].artifact.id, artifact.id);
    assert.equal(secondPage.nextContentOffset, null);

    const byCatalog = await searchArtifactsForAgent({
      artifacts,
      query: artifact.id,
      includeContent: false,
      database: fixture.database,
      storageRoot: fixture.storage,
    });
    assert.equal(byCatalog.matches[0].artifact.id, artifact.id);
    assert.equal(byCatalog.matches[0].matchedIn, "catalog");

    const scopedArtifact = getArtifactInAgentScope(artifact.id, scope, fixture.database);
    const updated = updateArtifactContent({
      artifact: scopedArtifact,
      content: "# Derivation\n\nRevised from a different chat in the same Garden.",
      mode: "replace",
      runId: "run-one",
      assistantMessageId: null,
      database: fixture.database,
      storageRoot: fixture.storage,
    });
    assert.equal(updated.current_version, 2);
    assert.match(
      readArtifactSource(updated, 2, fixture.storage, fixture.database),
      /Revised from a different chat/,
    );
  } finally {
    fixture.database.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("artifact_search is brokered to authenticated Hermes surfaces and registered in both runtimes", () => {
  const grant = (surface, authenticated = true) => brokerCapabilities({
    plan: planTask({ request: "Find and revise my report", authenticated }),
    surface,
    userId: authenticated ? 1 : null,
    grants: [],
    workspaceRoot: "/runtime/session",
    isolated: !authenticated,
  }).allowedTools;
  assert.equal(grant("dashboard_terminal").artifact_search, true);
  assert.equal(grant("garden_chat").artifact_search, true);
  assert.equal(grant("quartz_ai", false).artifact_search, false);

  const opencodeTool = fs.readFileSync(
    new URL("../../hermes-config/tool/artifact.ts", import.meta.url),
    "utf8",
  );
  const pythonPlugin = fs.readFileSync(
    new URL("../../hermes-agent/plugins/breadboard/__init__.py", import.meta.url),
    "utf8",
  );
  const adapter = fs.readFileSync(
    new URL("../src/lib/agent-runtime/adapters/hermes.ts", import.meta.url),
    "utf8",
  );
  assert.match(opencodeTool, /export const search = tool\(/);
  assert.match(opencodeTool, /"artifact_search"/);
  assert.match(pythonPlugin, /"artifact_search"/);
  assert.match(adapter, /"artifact_search"/);
});

test("Ask AI hands an archived artifact to the matching surface instead of its originating chat", () => {
  const terminalArtifact = {
    id: "artifact-one",
    title: "Old Terminal report",
    conversationId: "an-older-terminal-chat",
    gardenId: null,
    renderer: "markdown",
    sourceSkill: null,
  };
  const gardenArtifact = {
    ...terminalArtifact,
    id: "artifact-two",
    gardenId: "physics",
  };
  assert.equal(
    artifactAiEditMatchesScope(terminalArtifact, { surface: "dashboard_terminal" }),
    true,
  );
  assert.equal(
    artifactAiEditMatchesScope(gardenArtifact, { surface: "dashboard_terminal" }),
    false,
  );
  assert.equal(
    artifactAiEditMatchesScope(gardenArtifact, { surface: "garden_chat", gardenId: "physics" }),
    true,
  );
  assert.equal(
    artifactAiEditMatchesScope(gardenArtifact, { surface: "garden_chat", gardenId: "chemistry" }),
    false,
  );
});
