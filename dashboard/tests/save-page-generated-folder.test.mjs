import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const dashboardRoot = path.resolve(import.meta.dirname, "..");

test("Save page creates new chat pages inside the Generated folder", () => {
  const source = fs.readFileSync(
    path.join(dashboardRoot, "src/app/api/generate-notes/route.ts"),
    "utf8",
  );
  const chatNoteBranch = source.match(
    /if \(mode === "chat-note"\) \{([\s\S]*?)\n    const client = new OpenAI/,
  )?.[1];

  assert.ok(chatNoteBranch, "expected to find the chat-note save branch");
  assert.match(source, /const SAVE_PAGE_FOLDER = "Generated";/);
  assert.match(
    chatNoteBranch,
    /const generatedDir = path\.join\(clusterDir, SAVE_PAGE_FOLDER\);/,
  );
  assert.match(
    chatNoteBranch,
    /const newNotePath = path\.join\(generatedDir, `\$\{finalSlug\}\.md`\);/,
  );
  assert.match(chatNoteBranch, /fs\.mkdirSync\(generatedDir, \{ recursive: true \}\);/);
});
