import assert from "node:assert/strict";
import test from "node:test";
import { formatTelegramText, latexToText, splitTelegramText, telegramImageUrls, TELEGRAM_MESSAGE_LIMIT } from "../src/lib/telegram/format.ts";

test("the screenshot's emphasis becomes formatting instead of literal asterisks", () => {
  const result = formatTelegramText("I checked Breadboard’s live chat status: **one chat is running** right now.");
  assert.equal(result.text, "I checked Breadboard’s live chat status: one chat is running right now.");
  const [bold] = result.entities;
  assert.equal(bold.type, "bold");
  assert.equal(result.text.slice(bold.offset, bold.offset + bold.length), "one chat is running");
});

test("nested emphasis uses UTF-16 offsets and leaves code contents unchanged", () => {
  const result = formatTelegramText("🌱 **Ready *now***: `a_b * 2 < 3` &amp; done.");
  assert.equal(result.text, "🌱 Ready now: a_b * 2 < 3 & done.");
  assert.deepEqual(result.entities.map((entity) => [entity.type, result.text.slice(entity.offset, entity.offset + entity.length)]), [
    ["bold", "Ready now"], ["italic", "now"], ["code", "a_b * 2 < 3"],
  ]);
  assert.equal(result.entities[0].offset, 3);
  const block = formatTelegramText("```python\n  value = '**literal**'\n  print(value)\n```");
  assert.equal(block.text, "  value = '**literal**'\n  print(value)");
  assert.equal(block.entities[0].language, "python");
  assert.equal(block.entities[0].length, block.text.length);
});

test("lists, headings and tables retain their meaning without Markdown scaffolding", () => {
  const result = formatTelegramText("## Chats\n\n- parent\n  - child\n- next\n\n| Chat | State |\n| --- | --- |\n| Plan | Replying |");
  assert.equal(result.text, "Chats\n\n• parent\n  • child\n• next\n\nChat: Plan\nState: Replying");
  assert.equal(result.entities[0].type, "bold");
  assert.equal(formatTelegramText("3. first\n4. second\n\n- [x] done\n- [ ] later").text, "3. first\n4. second\n\n☑ done\n☐ later");
});

test("malformed markup, literal HTML, masked values and non-web links remain readable", () => {
  // A stray `**` is never shown on the phone; a lone `*` is arithmetic and stays.
  assert.equal(formatTelegramText("**unfinished and 2 * 3, foo_bar, <EMAIL_ADDRESS>, <tag>").text,
    "unfinished and 2 * 3, foo_bar, <EMAIL_ADDRESS>, <tag>");
  // A relative Breadboard path means nothing on a phone, so only its label is kept.
  const result = formatTelegramText("[note](/garden/test) and [bad](javascript:alert) and [site](https://example.com/?a=1&b=2)");
  assert.equal(result.text, "note and bad (javascript:alert) and site");
  assert.equal(result.entities.length, 1);
  assert.equal(result.entities[0].url, "https://example.com/?a=1&b=2");
});

test("large replies preserve text, emoji, links and code when split", () => {
  const source = `**${"🌱".repeat(TELEGRAM_MESSAGE_LIMIT)}**\n\n[${"link ".repeat(1000)}](https://example.com)\n\n\`\`\`text\n${"  a_b **code**\n".repeat(600)}\`\`\``;
  const message = formatTelegramText(source);
  const chunks = splitTelegramText(message);
  assert.ok(chunks.length > 3);
  assert.equal(chunks.map((chunk) => chunk.text).join(""), message.text);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= TELEGRAM_MESSAGE_LIMIT);
    assert.ok(chunk.text.isWellFormed());
    for (const entity of chunk.entities) {
      assert.ok(entity.offset >= 0 && entity.length > 0);
      assert.ok(entity.offset + entity.length <= chunk.text.length);
    }
  }
  for (const type of ["bold", "text_link", "pre"]) {
    assert.equal(chunks.flatMap((chunk) => chunk.entities).filter((entity) => entity.type === type).reduce((sum, entity) => sum + entity.length, 0),
      message.entities.filter((entity) => entity.type === type).reduce((sum, entity) => sum + entity.length, 0));
  }
});

test("emphasis never overlaps code and quoted text keeps its attribution", () => {
  const result = formatTelegramText("> **Use `x_y` here.**");
  assert.equal(result.text, "Use x_y here.");
  const code = result.entities.find((entity) => entity.type === "code");
  assert.ok(result.entities.some((entity) => entity.type === "blockquote"));
  for (const entity of result.entities.filter((entity) => entity !== code)) {
    assert.ok(entity.offset >= code.offset + code.length || entity.offset + entity.length <= code.offset);
  }
});

test("emphasis CommonMark leaves literal still renders as bold, never as asterisks", () => {
  const result = formatTelegramText("**Total:**5 euros, **Note:**done");
  assert.equal(result.text, "Total:5 euros, Note:done");
  assert.deepEqual(result.entities.map((entity) => result.text.slice(entity.offset, entity.offset + entity.length)), ["Total:", "Note:"]);
});

test("LaTeX becomes readable Unicode, prices stay prices, code keeps its dollars", () => {
  assert.equal(latexToText(String.raw`\int_0^1 x\,dx = \frac{1}{2}`), "∫₀¹ x dx = 1/2");
  assert.equal(latexToText(String.raw`\omega_0 = \frac{1}{\sqrt{LC}}, x^{n+1} \le \alpha`), "ω₀ = 1/√LC, xⁿ⁺¹ ≤ α");
  assert.equal(
    formatTelegramText(String.raw`So $E = mc^2$ and \(a^2+b^2=c^2\), costs $5 and $10. Run ` + "`echo $HOME`").text,
    "So E = mc² and a²+b²=c², costs $5 and $10. Run echo $HOME",
  );
  assert.equal(formatTelegramText(String.raw`$$\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$$`).text, "∑ᵢ₌₁ⁿ i = (n(n+1))/2");
});

test("embedded images leave the text and web ones are handed to the photo sender", () => {
  const source = "Here it is:\n\n![chart](/api/hermes/artifacts/abc/file)\n\n![cat](https://example.com/cat.jpg)";
  assert.equal(formatTelegramText(source).text, "Here it is:");
  assert.deepEqual(telegramImageUrls(source), ["https://example.com/cat.jpg"]);
});

test("brace-less frac shorthand never leaks as frac12", () => {
  const bs = String.fromCharCode(92);
  assert.equal(latexToText(`${bs}frac12`), "1/2");
  assert.equal(latexToText(`${bs}frac{a}b`), "a/b");
  const live = `${bs}int_0^1 x dx = [${bs}frac{x^2}{2}]_0^1 = ${bs}frac12`;
  assert.equal(formatTelegramText(`$${live}$`).text.includes("frac"), false);
});
