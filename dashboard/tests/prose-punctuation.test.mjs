import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmDashFilter,
  stripEmDashes,
} from "../src/lib/prose-punctuation.ts";
import {
  createHermesEventNormalizationState,
  normalizeHermesEvent,
} from "../src/lib/agent-runtime/hermes-events.ts";

const EM = "—";

function streamed(chunks) {
  const filter = createEmDashFilter();
  return chunks.map((chunk) => filter.push(chunk)).join("") + filter.flush();
}

test("an em dash becomes the punctuation the sentence actually needed", () => {
  assert.equal(
    stripEmDashes(`Bread answers ${EM} then stops.`),
    "Bread answers, then stops.",
  );
  assert.equal(stripEmDashes(`tight${EM}coupling`), "tight, coupling");
  // Already punctuated: no doubling.
  assert.equal(stripEmDashes(`Wait, ${EM} then go`), "Wait, then go");
  // Ranges keep their meaning.
  assert.equal(stripEmDashes(`pages 10${EM}12`), "pages 10 to 12");
  // Nothing to join at a line edge.
  assert.equal(stripEmDashes(`${EM} leading aside`), "leading aside");
  assert.equal(stripEmDashes(`trailing ${EM}`), "trailing");
  assert.equal(stripEmDashes(`(${EM}an aside)`), "(an aside)");
});

test("text without an em dash is returned untouched", () => {
  const text = "A plain sentence with a hyphen-joined word and $x - y$ math.";
  assert.equal(stripEmDashes(text), text);
});

test("fenced code is content, not prose, and survives intact", () => {
  const text = [
    `Run this ${EM} carefully:`,
    "```bash",
    `echo "a ${EM} b"`,
    "```",
    `then read it ${EM} slowly.`,
  ].join("\n");
  const out = stripEmDashes(text);
  assert.match(out, /Run this, carefully:/);
  assert.match(out, /echo "a — b"/, "code block was rewritten");
  assert.match(out, /then read it, slowly\./);
});

test("chunking cannot change the result", () => {
  const text = [
    `Bread answers ${EM} then stops.`,
    "",
    "```py",
    `x = "keep ${EM} this"`,
    "```",
    "",
    `Pages 10${EM}12, and a trailing dash ${EM}`,
  ].join("\n");
  const whole = stripEmDashes(text);

  for (const size of [1, 2, 3, 5, 7, 13, 64]) {
    const chunks = [];
    for (let index = 0; index < text.length; index += size) {
      chunks.push(text.slice(index, index + size));
    }
    assert.equal(streamed(chunks), whole, `chunk size ${size} diverged`);
  }

  // A split landing exactly on the dash and on a fence marker.
  assert.equal(streamed([`Bread answers ${EM}`, " then stops."]), "Bread answers, then stops.");
  assert.equal(streamed(["``", "`js\n", `a ${EM} b\n`, "```"]), `\`\`\`js\na ${EM} b\n\`\`\``);
});

test("the Hermes stream and the completed message agree", () => {
  const state = createHermesEventNormalizationState();
  const session = "live-1";
  const emit = (type, payload) =>
    normalizeHermesEvent({ type, session_id: session, payload }, session, "pub-1", state);

  emit("message.start", {});
  const first = emit("message.delta", { text: `Bread answers ${EM}` });
  // The dash is held until its right-hand side arrives, so nothing leaks.
  assert.equal(first.map((event) => event.payload.text ?? "").join(""), "Bread answers");
  const second = emit("message.delta", { text: " then stops." });
  assert.equal(second[0].payload.text, ", then stops.");

  const completed = emit("message.complete", {
    status: "complete",
    text: `Bread answers ${EM} then stops.`,
    turn_id: "turn-1",
  });
  // No duplicated residual: the completion sanitizes to exactly what streamed.
  const residual = completed
    .filter((event) => event.type === "assistant.delta")
    .map((event) => event.payload.text)
    .join("");
  assert.equal(residual, "");
  assert.equal(state.assistantText, "Bread answers, then stops.");
  assert.ok(completed.some((event) => event.type === "assistant.completed"));
});

test("a completion that was never streamed is still cleaned", () => {
  const state = createHermesEventNormalizationState();
  const session = "live-2";
  const events = normalizeHermesEvent(
    {
      type: "message.complete",
      session_id: session,
      payload: { status: "complete", text: `Recovered ${EM} in full.`, turn_id: "t" },
    },
    session,
    "pub-2",
    state,
  );
  const text = events
    .filter((event) => event.type === "assistant.delta")
    .map((event) => event.payload.text)
    .join("");
  assert.equal(text, "Recovered, in full.");
  assert.doesNotMatch(state.assistantText, /—/);
});
