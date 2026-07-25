import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveVerifiedCrossChatFilesystemReferences,
  resolveVerifiedFilesystemReferences,
} from
  "../src/lib/conversations/reference-resolution.ts";

const TARGET = "C:\\Users\\example\\Downloads\\WPILib_Windows-2026.2.1.iso";
const DOWNLOADS = "C:\\Users\\example\\Downloads";
const LISTED_FILES = [
  "one.iso",
  "Video Project 1.mp4",
  "Docker Desktop Installer(1).exe",
  "Demo_Team14.mp4",
].map((name) => `${DOWNLOADS}\\${name}`);

function message(overrides = {}) {
  return {
    id: 1,
    conversation_id: 1,
    client_message_id: "turn-1",
    role: "assistant",
    surface: "dashboard_terminal",
    content: `The largest file is:\n\n- **File:** \`WPILib_Windows-2026.2.1.iso\`\n- **Path:** \`${TARGET}\``,
    status: "complete",
    order_index: 1,
    metadata: JSON.stringify({
      toolCalls: [{ toolName: "terminal_execute_command", success: true }],
    }),
    sources: null,
    token_usage: null,
    created_at: "2026-07-25 13:35:59",
    updated_at: "2026-07-25 13:36:44",
    ...overrides,
  };
}

function listMessage(overrides = {}) {
  return message({
    content: [
      `The largest files in \`${DOWNLOADS}\` are:`,
      "",
      "1. `one.iso` — 400 bytes",
      "2. `Video Project 1.mp4` — 300 bytes",
      "3. `Docker Desktop Installer(1).exe` — 200 bytes",
      "4. `Demo_Team14.mp4` — 100 bytes",
    ].join("\n"),
    ...overrides,
  });
}

test("a singular follow-up resolves the exact path from verified tool output", () => {
  assert.deepEqual(
    resolveVerifiedFilesystemReferences("please delete that file", [message()]),
    [{ kind: "path", value: TARGET, absolute: true, resourceType: "file" }],
  );
});

test("unverified assistant prose never becomes a filesystem resource", () => {
  const unverified = message({ metadata: JSON.stringify({ toolCalls: [] }) });
  assert.deepEqual(
    resolveVerifiedFilesystemReferences("please delete that file", [unverified]),
    [],
  );
});

test("ambiguous verified paths still require clarification", () => {
  const ambiguous = message({
    content: `Two candidates: \`${TARGET}\` and \`C:\\Users\\example\\Downloads\\other.iso\``,
  });
  assert.deepEqual(
    resolveVerifiedFilesystemReferences("please delete that file", [ambiguous]),
    [],
  );
});

test("only the immediately preceding assistant message can resolve a reference", () => {
  const laterUser = message({
    id: 2,
    client_message_id: "turn-2",
    role: "user",
    content: "A different request intervened.",
    order_index: 2,
    metadata: null,
  });
  assert.deepEqual(
    resolveVerifiedFilesystemReferences(
      "please delete that file",
      [message(), laterUser],
    ),
    [],
  );
});

test("ordinary prompts do not inherit filesystem targets", () => {
  assert.deepEqual(
    resolveVerifiedFilesystemReferences("Tell me a joke", [message()]),
    [],
  );
});

test("a plural follow-up resolves a verified list and applies an exact exclusion", () => {
  assert.deepEqual(
    resolveVerifiedFilesystemReferences(
      "please delete them except Demo_Team14.mp4",
      [listMessage()],
    ),
    LISTED_FILES.slice(0, 3).map((value) => ({
      kind: "path",
      value,
      absolute: true,
      resourceType: "file",
    })),
  );
});

test("an unknown exclusion fails shut instead of deleting the whole list", () => {
  assert.deepEqual(
    resolveVerifiedFilesystemReferences(
      "delete them except keep-this-one.mp4",
      [listMessage()],
    ),
    [],
  );
});

test("named and ordinal references select only matching verified list entries", () => {
  assert.deepEqual(
    resolveVerifiedFilesystemReferences(
      "delete Video Project 1.mp4 and the third file",
      [listMessage()],
    ).map((resource) => resource.value),
    [LISTED_FILES[1], LISTED_FILES[2]],
  );
});

test("cross-chat targets require an explicit reference and one matching verified result", () => {
  assert.deepEqual(
    resolveVerifiedCrossChatFilesystemReferences(
      "from the previous chat, delete them except Demo_Team14.mp4",
      [listMessage()],
    ).map((resource) => resource.value),
    LISTED_FILES.slice(0, 3),
  );
  assert.deepEqual(
    resolveVerifiedCrossChatFilesystemReferences(
      "delete them except Demo_Team14.mp4",
      [listMessage()],
    ),
    [],
  );
  assert.deepEqual(
    resolveVerifiedCrossChatFilesystemReferences(
      "from the previous chat, delete them except Demo_Team14.mp4",
      [listMessage(), listMessage({ id: 22 })],
    ),
    [],
  );
});
