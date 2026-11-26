// Bots as teammates: Bread is primary, "@name" pulls a bot in, several names
// make Bread coordinate. See src/lib/bots/mentions.ts and team.ts.

import assert from "node:assert/strict";
import test from "node:test";
import {
  botHandle,
  mentionQueryAt,
  mentionedHandles,
  routeTurn,
} from "../src/lib/bots/mentions.ts";

const bot = (id, name) => ({ id, name, description: "", personality: "", avatar: {}, prebuilt: true, archived: false, updatedAt: "" });
const sage = bot("sage", "Sage");
const byte = bot("byte", "Byte");
const tutor = bot("bot_1", "Math Tutor");
const roster = [sage, byte, tutor];

test("handles come from names", () => {
  assert.equal(botHandle("Math Tutor"), "math-tutor");
  assert.equal(botHandle("  Zoë!! "), "zoe");
  assert.equal(botHandle("研究助手"),"研究助手");
  assert.deepEqual(mentionedHandles("Ask @研究助手 about this",["研究助手"]),["研究助手"]);
  assert.equal(mentionQueryAt("@研究",3).query,"研究");
});

test("a mention stands apart from addresses, links and code", () => {
  const known = ["sage", "byte", "math-tutor"];
  assert.deepEqual(mentionedHandles("@Sage and @math-tutor, then @sage again", known), ["sage", "math-tutor"]);
  assert.deepEqual(mentionedHandles("mail a@sage.com or see x.com/@byte", known), []);
  assert.deepEqual(mentionedHandles("run `@sage` ```\n@byte\n```", known), []);
  assert.deepEqual(mentionedHandles("@sagely @nobody", known), []);
});

test("routing: Bread by default, one name answers, several make Bread coordinate", () => {
  assert.deepEqual(routeTurn("hello", roster, null), { respondent: null, coordinate: [] });
  assert.equal(routeTurn("hello", roster, sage).respondent, sage, "a bot's own chat stays its own");
  assert.equal(routeTurn("hey @byte look", roster, null).respondent, byte);
  assert.equal(routeTurn("@bread take this", roster, sage).respondent, null, "@bread always reaches Bread");
  assert.deepEqual(routeTurn("@sage @byte compare", roster, null), { respondent: null, coordinate: [sage, byte] });
});

test("composer picker finds the @token under the caret", () => {
  assert.deepEqual(mentionQueryAt("ask @sa", 7), { query: "sa", start: 4, end: 7 });
  assert.deepEqual(mentionQueryAt("ask @", 5), { query: "", start: 4, end: 5 });
  assert.equal(mentionQueryAt("me@x.com", 8), null);
  assert.equal(mentionQueryAt("@sage ", 6), null);
});

test("splitMentions cuts out each @handle for the blue transcript styling, and leaves emails alone", async () => {
  const { splitMentions } = await import("../src/lib/bots/mentions.ts");
  assert.deepEqual(splitMentions("@sage and @byte-2, mail me@x.com"), [
    { value: "@sage", mention: true }, { value: " and ", mention: false },
    { value: "@byte-2", mention: true }, { value: ", mail me@x.com", mention: false },
  ]);
  assert.deepEqual(splitMentions("no mentions"), [{ value: "no mentions", mention: false }]);
});
