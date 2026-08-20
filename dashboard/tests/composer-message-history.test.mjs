// Up and Down in the composer recall what you already sent, as a terminal does.
//
// The walk itself is small enough to read, so what these tests pin down is the
// behaviour that is easy to get wrong and impossible to see in a diff: that the
// arrows still move the caret inside a draft being written, that the draft is
// handed back rather than lost when the walk comes home, and that all four
// chat surfaces feed the composer the same thing — the sentences this person
// typed, never a turn the app inserted on their behalf.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  caretOnFirstLine,
  caretOnLastLine,
  composerHistory,
  composerHistoryMove,
} from "../src/lib/hermes/composer-history.ts";

const source = (relative) =>
  fs.readFileSync(new URL(`../src/${relative}`, import.meta.url), "utf8");

test("the walkable list holds every distinct sentence, oldest first", () => {
  assert.deepEqual(
    composerHistory(["first", "second", "third"]),
    ["first", "second", "third"],
  );
  // A blank message has nothing to recall.
  assert.deepEqual(composerHistory(["", "   ", "\n", "real"]), ["real"]);
  // Asking the same thing twice in a row would otherwise cost two presses of
  // Up to move one message, which reads as a key that did not register.
  assert.deepEqual(composerHistory(["same", "same", "next", "same"]), [
    "same",
    "next",
    "same",
  ]);
});

test("Up walks back from the newest message and stops at the oldest", () => {
  const history = ["oldest", "middle", "newest"];

  const first = composerHistoryMove(history, null, "older", "draft");
  assert.deepEqual(first, { index: 2, text: "newest" });

  const second = composerHistoryMove(history, first.index, "older", "draft");
  assert.deepEqual(second, { index: 1, text: "middle" });

  const third = composerHistoryMove(history, second.index, "older", "draft");
  assert.deepEqual(third, { index: 0, text: "oldest" });

  // Past the oldest there is nowhere to go. `null` hands the key back to the
  // caret rather than swallowing it, so the arrow never feels dead.
  assert.equal(composerHistoryMove(history, 0, "older", "draft"), null);
  assert.equal(composerHistoryMove([], null, "older", "draft"), null);
});

test("Down walks forward and gives the interrupted draft back", () => {
  const history = ["oldest", "middle", "newest"];

  assert.deepEqual(composerHistoryMove(history, 0, "newer", "half-written"), {
    index: 1,
    text: "middle",
  });
  // One step past the newest message is the draft the walk interrupted — not
  // an empty field, which is what losing the sentence would look like.
  assert.deepEqual(composerHistoryMove(history, 2, "newer", "half-written"), {
    index: null,
    text: "half-written",
  });
  // Down while the field still holds that draft is an ordinary caret move.
  assert.equal(composerHistoryMove(history, null, "newer", "half-written"), null);
});

test("recall only starts from the edges of the draft", () => {
  const draft = "first line\nsecond line";

  // Caret on line one: Up is recall.
  assert.equal(caretOnFirstLine(draft, 0), true);
  assert.equal(caretOnFirstLine(draft, "first line".length), true);
  // Caret on line two: Up belongs to the caret, which has somewhere to go.
  assert.equal(caretOnFirstLine(draft, draft.length), false);

  assert.equal(caretOnLastLine(draft, draft.length), true);
  assert.equal(caretOnLastLine(draft, 0), false);
  // A single-line draft is both edges at once.
  assert.equal(caretOnFirstLine("one line", 4), true);
  assert.equal(caretOnLastLine("one line", 4), true);
});

test("the composer spends the key on the walk before anything else reads it", () => {
  const composer = source("app/components/assistant-composer.tsx");

  // The open menus still win the arrows — they are navigating a list the
  // person is looking at — and a host's own handler is asked before us.
  assert.match(
    composer,
    /if \(slashCommandMenuRef\.current\?\.handleKeyDown\(event\)\) return;\s*\n\s*if \(commandHubRef\.current\?\.handleKeyDown\(event\)\) return;\s*\n\s*onKeyDown\?\.\(event\);\s*\n\s*if \(event\.defaultPrevented\) return;\s*\n\s*if \(walkMessageHistory\(event\)\) return;/,
  );

  // A modifier makes the arrow mean selection or a jump, never recall.
  assert.match(
    composer,
    /if \(event\.shiftKey \|\| event\.altKey \|\| event\.ctrlKey \|\| event\.metaKey\) return false;/,
  );
  // An extended selection would be thrown away by a recall.
  assert.match(composer, /if \(caret !== textarea\.selectionEnd\) return false;/);
  assert.match(
    composer,
    /older \? !caretOnFirstLine\(value, caret\) : !caretOnLastLine\(value, caret\)/,
  );
  // The recalled message lands one render later; the caret goes to its end
  // then, so the next keystroke continues it rather than splitting it.
  assert.match(composer, /node\.setSelectionRange\(move\.text\.length, move\.text\.length\)/);
  // A new list is a sent message or a switched conversation — the walk is over.
  assert.match(
    composer,
    /useEffect\(\(\) => \{\s*\n\s*historyWalkRef\.current = null;\s*\n\s*\}, \[messageHistory\]\);/,
  );
});

test("all four chat surfaces hand the composer their sent messages", () => {
  for (const relative of [
    "app/components/hermes/agent-runtime-panel.tsx",
    "app/components/knowledge-terminal.tsx",
    "app/garden/garden-assistant.tsx",
    "app/gardens/[clusterSlug]/workspace-client.tsx",
  ]) {
    const surface = source(relative);
    assert.match(surface, /history=\{sentMessages\}/, relative);
    // Memoized, because a fresh array identity reads as a new conversation and
    // would drop a walk in progress on every unrelated re-render.
    assert.match(surface, /const sentMessages = useMemo\(/, relative);
  }

  // The two surfaces that fold rows out of the transcript recall off the drawn
  // rows, so a continuation or a folded correction is never handed back as
  // something the person typed.
  for (const relative of [
    "app/components/hermes/agent-runtime-panel.tsx",
    "app/gardens/[clusterSlug]/workspace-client.tsx",
  ]) {
    assert.match(
      source(relative),
      /const sentMessages = useMemo\(\s*\n\s*\(\) =>\s*\n\s*(transcriptRows|buildTranscriptRows\(messages\))\.flatMap/,
      relative,
    );
  }
});
