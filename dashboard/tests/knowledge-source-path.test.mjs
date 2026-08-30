import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("source document ingest path", () => {
  const repoRoot = path.resolve(process.cwd());
  const ingestWorker = () => fs.readFileSync(
    path.join(repoRoot, "src", "lib", "runtime-v2", "ingest-executor.ts"),
    "utf8",
  );

  test("upload source markdown is written under sources", () => {
    const knowledgeSource = fs.readFileSync(
      path.join(repoRoot, "src", "lib", "knowledge.ts"),
      "utf8",
    );
    const ingestRoute = ingestWorker();

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

  test("PDF sources keep their uploaded filename and expose the generated title as a description", () => {
    const knowledgeSource = fs.readFileSync(
      path.join(repoRoot, "src", "lib", "knowledge.ts"),
      "utf8",
    );
    const documentsRoute = fs.readFileSync(
      path.join(repoRoot, "src", "app", "api", "documents", "route.ts"),
      "utf8",
    );
    const workspace = fs.readFileSync(
      path.join(
        repoRoot,
        "src",
        "app",
        "gardens",
        "[clusterSlug]",
        "workspace-client.tsx",
      ),
      "utf8",
    );

    assert.match(knowledgeSource, /sourceType\.toLowerCase\(\) === "pdf"[\s\S]*?sourceFileName\.trim\(\)/);
    assert.match(knowledgeSource, /title: visibleSourceTitle,[\s\S]*?description: sectionTitle/);
    assert.match(documentsRoute, /description: node\.description/);
    assert.match(workspace, /isPdf \? doc\.sourceFile\?\.trim\(\) : ""/);
    assert.match(workspace, /sourceDescription/);
    assert.match(workspace, /\{sourceDescription\}/);
  });

  test("re-uploading the same source filename is idempotent", () => {
    const ingestRoute = ingestWorker();
    const dashboard = fs.readFileSync(
      path.join(repoRoot, "src", "app", "dashboard", "dashboard-client.tsx"),
      "utf8",
    );
    const workspace = fs.readFileSync(
      path.join(
        repoRoot,
        "src",
        "app",
        "gardens",
        "[clusterSlug]",
        "workspace-client.tsx",
      ),
      "utf8",
    );
    const knowledgeSource = fs.readFileSync(
      path.join(repoRoot, "src", "lib", "knowledge.ts"),
      "utf8",
    );

    assert.match(
      ingestRoute,
      /normalizeSourceFileIdentity\(node\.sourceFile\) === sourceFileName/,
    );
    assert.match(ingestRoute, /duplicate: true/);
    assert.ok(
      ingestRoute.indexOf("const existingSource = existingSourceDocument") <
        ingestRoute.indexOf('emit("Reading the uploaded file'),
      "duplicate detection must run before extraction and map generation",
    );
    assert.match(dashboard, /appendUniqueUploadFiles/);
    assert.match(workspace, /appendUniqueUploadFiles/);
    assert.match(dashboard, /duplicate upload skipped/);
    assert.match(workspace, /duplicate upload skipped/);
    assert.match(knowledgeSource, /withoutSupersededSourceIngests/);
    assert.match(
      knowledgeSource,
      /!supersededSourceSlugs\.has\(node\.sourceDocument\)/,
    );
  });

  test("cluster index migrates and links source markdowns from sources", () => {
    const knowledgeSource = fs.readFileSync(
      path.join(repoRoot, "src", "lib", "knowledge.ts"),
      "utf8",
    );

    assert.match(knowledgeSource, /function migrateRootSourceDocumentsToSources/);
    assert.match(knowledgeSource, /inferKnowledgeType\(data\) === "source-document"/);
    assert.match(
      knowledgeSource,
      /renameKnowledgeFile\(\s*entry\.filePath,[\s\S]*?uniqueMigrationPath\(migrationDir, entry\.entry\),[\s\S]*?transaction/,
    );
    // The published _index exposes the strict export contract: Learning,
    // Sources, and a numbered Reading Path built from learner pages.
    assert.match(knowledgeSource, /## Learning\\n\\n/);
    assert.match(knowledgeSource, /\[\[sources\/_index\|Sources\]\]/);
    assert.match(knowledgeSource, /readingPathLines\.length > 0 \? readingPathLines\.join/);
    assert.match(knowledgeSource, /wikilinkForRelPath\(topic\.relPath, topic\.title\)/);
    assert.match(knowledgeSource, /internal: "true"/);
  });

  test("cluster index refresh can preserve root sources and renders an honest empty Learn state", () => {
    const knowledgeSource = fs.readFileSync(
      path.join(repoRoot, "src", "lib", "knowledge.ts"),
      "utf8",
    );

    assert.match(
      knowledgeSource,
      /export function refreshClusterIndex\([\s\S]*?options: \{[\s\S]*?migrateSources\?: boolean;[\s\S]*?transaction\?: KnowledgeWriteTransaction;[\s\S]*?\} = \{\}/,
    );
    assert.match(
      knowledgeSource,
      /if \(options\.migrateSources !== false\) \{[\s\S]*?migrateRootSourceDocumentsToSources\(clusterDir\)/,
    );
    assert.match(
      knowledgeSource,
      /scanClusterKnowledge\(contentPath, clusterSlug, \{[\s\S]*?migrateSources: false/,
    );
    assert.match(
      knowledgeSource,
      /const emptyLearnState = learnerPages\.length === 0 && !hasTopicOverview/,
    );
    assert.match(
      knowledgeSource,
      /emptyLearnState \? "- No lessons yet\." : `- \$\{wikilinkForRelPath\(overviewLink, "Topic Overview"\)\}`/,
    );
  });

  test("markdown uploads go through the source ingest path", () => {
    const ingestRoute = ingestWorker();

    assert.match(ingestRoute, /plainText = await fileText\(\);/);
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
    assert.match(linksRoute, /captureUrlSourceImages/);
    assert.match(linksRoute, /sourceAssets: captured\.images\.map/);
    assert.match(linksRoute, /source_image_urls: captured\.images\.map/);
    assert.match(knowledgeSource, /sourceMetadata\?: Record<string, string \| string\[\]>/);
    assert.match(knowledgeSource, /sourceAssets\?: KnowledgeSourceAsset\[\]/);
    assert.match(knowledgeSource, /writeKnowledgeBinaryFile\(assetFilePath, asset\.bytes, transaction\)/);
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
