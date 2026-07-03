import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("source document ingest path", () => {
  const repoRoot = path.resolve(process.cwd());

  test("upload source markdown is written under sources", () => {
    const knowledgeSource = fs.readFileSync(
      path.join(repoRoot, "src", "lib", "knowledge.ts"),
      "utf8",
    );
    const ingestRoute = fs.readFileSync(
      path.join(repoRoot, "src", "app", "api", "ingest", "route.ts"),
      "utf8",
    );

    assert.match(knowledgeSource, /export const SOURCE_NOTE_FOLDER = "sources"/);
    assert.match(
      knowledgeSource,
      /const sourceRelPath = `\$\{SOURCE_NOTE_FOLDER\}\/\$\{sourceSlug\}\.md`;/,
    );
    assert.match(
      knowledgeSource,
      /const sourceFilePath = path\.join\(clusterDir, sourceRelPath\);/,
    );
    assert.match(knowledgeSource, /sourceRelPath,/);
    assert.match(ingestRoute, /sourceRelPath: saved\.sourceRelPath/);
  });

  test("cluster index migrates and links source markdowns from sources", () => {
    const knowledgeSource = fs.readFileSync(
      path.join(repoRoot, "src", "lib", "knowledge.ts"),
      "utf8",
    );

    assert.match(knowledgeSource, /function migrateRootSourceDocumentsToSources/);
    assert.match(knowledgeSource, /inferKnowledgeType\(data\) === "source-document"/);
    assert.match(knowledgeSource, /fs\.renameSync\(entry\.filePath, targetPath\)/);
    // Raw source notes are internal now, so the published _index groups lessons
    // under the source TITLE as plain text and links only the lesson pages.
    assert.match(knowledgeSource, /## Reading Path\\n\\n\$\{readingPathSections/);
    assert.match(knowledgeSource, /wikilinkForRelPath\(topic\.relPath, topic\.title\)/);
    assert.match(knowledgeSource, /internal: "true"/);
  });

  test("markdown uploads go through the source ingest path", () => {
    const ingestRoute = fs.readFileSync(
      path.join(repoRoot, "src", "app", "api", "ingest", "route.ts"),
      "utf8",
    );

    assert.match(ingestRoute, /plainText = await file\.text\(\);/);
    assert.match(ingestRoute, /markdownText = plainText;/);
    assert.match(
      ingestRoute,
      /pages = \[\{ label: ext === "md" \? "Markdown" : "Text", text: plainText \}\];/,
    );
    assert.match(ingestRoute, /writeDocumentKnowledge\(\{/);
    assert.match(ingestRoute, /sourceType: ext \|\| "text"/);
  });

  test("saved links are converted into source documents", () => {
    const linksRoute = fs.readFileSync(
      path.join(repoRoot, "src", "app", "api", "gardens", "[gardenId]", "links", "route.ts"),
      "utf8",
    );
    const knowledgeSource = fs.readFileSync(
      path.join(repoRoot, "src", "lib", "knowledge.ts"),
      "utf8",
    );

    assert.match(linksRoute, /convertUrlToMarkdown/);
    assert.match(linksRoute, /writeDocumentKnowledge\(\{/);
    assert.match(linksRoute, /sourceType: "url"/);
    assert.match(linksRoute, /original_url: converted\.originalUrl/);
    assert.match(linksRoute, /content_hash: converted\.contentHash/);
    assert.match(knowledgeSource, /sourceMetadata\?: Record<string, string \| string\[\]>/);
  });

  test("snapshot-only fallback ingest does not create numbered source-snapshot lessons", () => {
    const knowledgeSource = fs.readFileSync(
      path.join(repoRoot, "src", "lib", "knowledge.ts"),
      "utf8",
    );

    assert.match(
      knowledgeSource,
      /source snapshots\?\|snapshots\?/,
      "source snapshot headings should be ignored during title detection",
    );
    assert.match(
      knowledgeSource,
      /if \(topicPlans\.length > 0\) \{/,
      "numbered lesson folders should only be created when topics exist",
    );
    assert.match(
      knowledgeSource,
      /writeTextbookSectionIndex\(/,
      "section index writer should still exist for real topic plans",
    );
  });
});
