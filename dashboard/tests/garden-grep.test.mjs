import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

test("garden_grep finds every line with the term, in authorized Gardens only", async (t) => {
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    const candidate = specifier.startsWith("@/")
      ? new URL(`../src/${specifier.slice(2)}${path.extname(specifier) ? "" : ".ts"}`, import.meta.url)
      : /^\.{1,2}\//.test(specifier) && !path.extname(specifier) && context.parentURL?.startsWith("file:")
        ? new URL(`${specifier}.ts`, context.parentURL) : null;
    if (candidate && fs.existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    return nextResolve(specifier, context);
  } });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-grep-"));
  process.env.BREADBOARD_DATA_DIR = root;
  process.env.QUARTZ_CONTENT_PATH = path.join(root, "content");
  const { default: db } = await import("../src/lib/db.ts");
  const { executeGardenTool } = await import("../src/lib/hermes/garden-tools.ts");
  const { issueCapabilityToken } = await import("../src/lib/hermes/capability-token.ts");
  t.after(() => { hooks.deregister(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const userId = Number(db.prepare("INSERT INTO users (username,email,password_hash) VALUES ('g','g@example.test','x')").run().lastInsertRowid);
  const otherId = Number(db.prepare("INSERT INTO users (username,email,password_hash) VALUES ('o','o@example.test','x')").run().lastInsertRowid);
  const ids = {};
  for (const [slug, owner] of [["math", userId], ["ml", userId], ["private", otherId]]) {
    ids[slug] = Number(db.prepare("INSERT INTO clusters (user_id,name,slug) VALUES (?,?,?)").run(owner, `Garden ${slug}`, slug).lastInsertRowid);
    fs.mkdirSync(path.join(root, "content", slug, "sources"), { recursive: true });
  }
  // The definition sits on page 31 of a source; the frontmatter mentions the
  // term too, and must not count, since it lists topics rather than content.
  fs.writeFileSync(path.join(root, "content", "math", "sources", "math-1.md"), [
    "---", 'title: "Math 1.pdf"', 'topics: ["hyperplanes-and-linear-functionals"]', "---",
    "## Page 30", "The dot product of two vectors.",
    "## Page 31", "A Hyperplane is defined implicitly as the set of points with n . x = d.",
    "Definition of a field: a set with two operations.",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "content", "ml", "sources", "perceptron.md"), "# Perceptron\nThe decision boundary is a hyperplane w . x + b = 0.\n");
  fs.writeFileSync(path.join(root, "content", "private", "sources", "x.md"), "# Secret\nhyperplane in someone else's notes\n");

  const token = issueCapabilityToken({
    userId, surface: "garden_chat", hermesSessionId: "grep", gardenId: "math", activeGardenId: ids.math,
    allowedGardenIds: [ids.math, ids.ml], allowedTools: ["garden_grep"],
  });
  const grep = (args) => executeGardenTool({ rawToken: token, tool: "garden_grep", args });

  const active = await grep({ pattern: "hyperplane" });
  assert.equal(active.ok, true);
  assert.deepEqual(active.data.matches.map((match) => [match.relPath, match.line, match.under]),
    [["sources/math-1.md", 8, "Page 31"]], "case-insensitive, frontmatter skipped, page heading carried");

  const everywhere = await grep({ pattern: "hyperplane", scope: "all" });
  assert.deepEqual(everywhere.data.matches.map((match) => match.gardenId).sort(), ["math", "ml"], "never the unauthorized Garden");

  const regex = await grep({ pattern: "hyperplanes?|decision boundary", regex: true, scope: "all" });
  assert.equal(regex.data.totalMatches, 2);
  // Literal by default: regex syntax in a phrase is just characters.
  assert.equal((await grep({ pattern: "n . x" })).data.totalMatches, 1);
  assert.equal((await grep({ pattern: "w . x", scope: "all" })).data.totalMatches, 1);
  assert.equal((await grep({ pattern: "eigenvalue" })).data.totalMatches, 0);
  assert.equal((await grep({ pattern: "(", regex: true })).ok, false);
  assert.equal((await grep({ pattern: " " })).ok, false);
});
