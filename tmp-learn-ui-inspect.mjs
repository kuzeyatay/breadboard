import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { encode } from "./dashboard/node_modules/next-auth/jwt/index.js";
import { load as loadYaml } from "./dashboard/node_modules/js-yaml/dist/js-yaml.mjs";

function sanitizedError(value) {
  const text = value instanceof Error ? (value.stack ?? value.message) : String(value);
  return text.replace(/next-auth\.session-token=[^\s]+/g, "next-auth.session-token=[redacted]");
}
process.on("uncaughtException", (error) => {
  console.error(sanitizedError(error));
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  console.error(sanitizedError(error));
  process.exit(1);
});

function readEnvFile(filePath) {
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator),
          line.slice(separator + 1).replace(/^['"]|['"]$/g, ""),
        ];
      }),
  );
}

const gardenId = "electromagnetism-1";
const priorGardenDisplayName = "Electromagnetism 1";
const expectedGardenDisplayName = "Electromagnetics 1";
const expectedTeachingSourceIds = [
  "engineering-electromagnetics-9th-ed-9nbsped-compress",
];
const expectedTeachingSourceFile =
  "engineering-electromagnetics-9th-ed-9nbsped-compress-source-2.pdf";
const expectedSyllabusSourceId = "studyguide-5epf0";
const expectedSyllabusSourceFile = "studyguide-5epf0-source.pdf";
const expectedSyllabusDisplayName = "StudyGuide_5EPF0.pdf";
const defaultExpectedModel = "gpt-5.6-sol";
const expectedModelArgument = argumentValue("expected-model");
const expectedModel = expectedModelArgument ?? defaultExpectedModel;
const activeGenerationStatuses = new Set([
  "generating_learning_pages",
  "generating_textbook",
  "generating_visuals",
  "writing_quartz",
  "building_navigation",
  "paused",
  "complete",
]);

function argumentValue(name) {
  const prefix = `--${name}=`;
  const matches = process.argv.filter((argument) => argument.startsWith(prefix));
  if (matches.length > 1) throw new Error(`--${name} may be provided only once`);
  return matches[0]?.slice(prefix.length).trim() || undefined;
}

function sameOrderedStrings(actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function assertExpectedConfirmation(status, expectedJobId, expectedMapId) {
  const problems = [];
  if (status?.job?.id !== expectedJobId) {
    problems.push(`latest job is ${status?.job?.id ?? "none"}, expected ${expectedJobId}`);
  }
  if (status?.job?.status !== "awaiting_confirmation" || status?.job?.mode !== "plan") {
    problems.push(
      `job is ${status?.job?.status ?? "none"}/${status?.job?.mode ?? "none"}, expected awaiting_confirmation/plan`,
    );
  }
  if (status?.job?.proposedLearningMapId !== expectedMapId) {
    problems.push(
      `job proposes ${status?.job?.proposedLearningMapId ?? "none"}, expected ${expectedMapId}`,
    );
  }
  if (
    !status?.proposedLearningMap ||
    typeof status.proposedLearningMap !== "object" ||
    typeof status.proposedLearningMap.title !== "string" ||
    !status.proposedLearningMap.title.trim() ||
    !Array.isArray(status.proposedLearningMap.sections) ||
    status.proposedLearningMap.sections.length === 0 ||
    status.proposedLearningMap.sections.some(
      (section) =>
        !section ||
        typeof section.title !== "string" ||
        !section.title.trim() ||
        !Array.isArray(section.subsections),
    )
  ) {
    problems.push("the exact proposed Learning Map is not available for review");
  }
  if (status?.job?.model !== expectedModel) {
    problems.push(`planning model is ${status?.job?.model ?? "none"}, expected ${expectedModel}`);
  }
  if (!sameOrderedStrings(status?.job?.sourceIds, expectedTeachingSourceIds)) {
    problems.push(
      `planning-job sources are ${JSON.stringify(status?.job?.sourceIds ?? null)}`,
    );
  }
  if (status?.job?.syllabusSourceId !== expectedSyllabusSourceId) {
    problems.push(`planning-job syllabus is ${status?.job?.syllabusSourceId ?? "none"}`);
  }
  if (status?.job?.sourceOnly !== true) {
    problems.push("the planning job is not source-only");
  }
  if (status?.job?.includeSourceSnapshots !== false) {
    problems.push("the planning job unexpectedly includes source snapshots");
  }
  if (!sameOrderedStrings(status?.selectedSourceIds, expectedTeachingSourceIds)) {
    problems.push(
      `teaching-source selection is ${JSON.stringify(status?.selectedSourceIds ?? null)}`,
    );
  }
  if (status?.syllabusSourceId !== expectedSyllabusSourceId) {
    problems.push(`syllabus is ${status?.syllabusSourceId ?? "none"}`);
  }
  if (
    !status?.syllabusCoverage ||
    !Number.isInteger(status.syllabusCoverage.unitCount) ||
    status.syllabusCoverage.unitCount <= 0 ||
    !Array.isArray(status.syllabusCoverage.missingCitations)
  ) {
    problems.push("syllabus coverage is missing or incomplete for the proposal owner");
  }
  if (status?.sourceSetChanged !== false) {
    problems.push("the selected source set is changed or unresolved after planning");
  }
  if (status?.hasTextbook !== false || status?.latestTextbookVersionId) {
    problems.push("learner content or a published Learn version already exists");
  }
  if (problems.length > 0) {
    throw new Error(`Refusing confirmation audit: ${problems.join("; ")}`);
  }
}

function assertExpectedCompletion(status, expectedJobId, expectedMapId) {
  const problems = [];
  if (status?.job?.id !== expectedJobId) {
    problems.push(`latest job is ${status?.job?.id ?? "none"}, expected ${expectedJobId}`);
  }
  if (status?.job?.status !== "complete" || status?.job?.mode !== "generate") {
    problems.push(
      `job is ${status?.job?.status ?? "none"}/${status?.job?.mode ?? "none"}, expected complete/generate`,
    );
  }
  if (status?.job?.model !== expectedModel) {
    problems.push(`generation model is ${status?.job?.model ?? "none"}, expected ${expectedModel}`);
  }
  if (!sameOrderedStrings(status?.job?.sourceIds, expectedTeachingSourceIds)) {
    problems.push(
      `generation-job sources are ${JSON.stringify(status?.job?.sourceIds ?? null)}`,
    );
  }
  if (status?.job?.syllabusSourceId !== expectedSyllabusSourceId) {
    problems.push(`generation-job syllabus is ${status?.job?.syllabusSourceId ?? "none"}`);
  }
  if (status?.job?.sourceOnly !== true) {
    problems.push("the generation job is not source-only");
  }
  if (status?.job?.includeSourceSnapshots !== false) {
    problems.push("the generation job unexpectedly includes source snapshots");
  }
  if (status?.confirmedLearningMapId !== expectedMapId) {
    problems.push(
      `confirmed map is ${status?.confirmedLearningMapId ?? "none"}, expected ${expectedMapId}`,
    );
  }
  if (typeof status?.latestTextbookVersionId !== "string" || !status.latestTextbookVersionId.trim()) {
    problems.push("the completed job has no published Learn version");
  }
  if (status?.job?.confirmedLearningMapId !== expectedMapId) {
    problems.push(
      `generation job owns map ${status?.job?.confirmedLearningMapId ?? "none"}, expected ${expectedMapId}`,
    );
  }
  if (status?.job?.latestTextbookVersionId !== status?.latestTextbookVersionId) {
    problems.push("the generation job and status snapshot disagree on the published version");
  }
  if (status?.hasTextbook !== true) {
    problems.push("the completed job has no learner pages");
  }
  if (status?.sourceSetChanged !== false) {
    problems.push("the published version has a changed or unresolved source set");
  }
  if (status?.proposedLearningMap !== null) {
    problems.push("a proposed Learning Map is still visible after completion");
  }
  if (!sameOrderedStrings(status?.selectedSourceIds, expectedTeachingSourceIds)) {
    problems.push(
      `published teaching-source selection is ${JSON.stringify(status?.selectedSourceIds ?? null)}`,
    );
  }
  if (status?.syllabusSourceId !== expectedSyllabusSourceId) {
    problems.push(`published syllabus is ${status?.syllabusSourceId ?? "none"}`);
  }
  if (
    !status?.syllabusCoverage ||
    !Number.isInteger(status.syllabusCoverage.unitCount) ||
    status.syllabusCoverage.unitCount <= 0 ||
    !Array.isArray(status.syllabusCoverage.missingCitations)
  ) {
    problems.push("published syllabus coverage is missing or incomplete");
  }
  if (problems.length > 0) {
    throw new Error(`Refusing completion verification: ${problems.join("; ")}`);
  }
}

function assertExpectedFailedGeneration(
  status,
  expectedJobId,
  expectedMapId,
  expectedModelValue,
) {
  const problems = [];
  if (status?.job?.id !== expectedJobId) {
    problems.push(`latest job is ${status?.job?.id ?? "none"}, expected ${expectedJobId}`);
  }
  if (status?.job?.status !== "failed" || status?.job?.mode !== "generate") {
    problems.push(
      `job is ${status?.job?.status ?? "none"}/${status?.job?.mode ?? "none"}, expected failed/generate`,
    );
  }
  if (status?.job?.model !== expectedModelValue) {
    problems.push(
      `failed generation model is ${status?.job?.model ?? "none"}, expected ${expectedModelValue}`,
    );
  }
  if (status?.job?.requiresReplan !== false) {
    problems.push("the failed generation requires replanning");
  }
  if (status?.job?.confirmedLearningMapId !== expectedMapId) {
    problems.push(
      `failed generation owns map ${status?.job?.confirmedLearningMapId ?? "none"}, expected ${expectedMapId}`,
    );
  }
  if (status?.confirmedLearningMapId !== expectedMapId) {
    problems.push(
      `confirmed map is ${status?.confirmedLearningMapId ?? "none"}, expected ${expectedMapId}`,
    );
  }
  if (!sameOrderedStrings(status?.job?.sourceIds, expectedTeachingSourceIds)) {
    problems.push(
      `failed-generation sources are ${JSON.stringify(status?.job?.sourceIds ?? null)}`,
    );
  }
  if (!sameOrderedStrings(status?.selectedSourceIds, expectedTeachingSourceIds)) {
    problems.push(
      `persisted teaching-source selection is ${JSON.stringify(status?.selectedSourceIds ?? null)}`,
    );
  }
  if (status?.job?.syllabusSourceId !== expectedSyllabusSourceId) {
    problems.push(`failed-generation syllabus is ${status?.job?.syllabusSourceId ?? "none"}`);
  }
  if (status?.syllabusSourceId !== expectedSyllabusSourceId) {
    problems.push(`persisted syllabus is ${status?.syllabusSourceId ?? "none"}`);
  }
  if (status?.job?.sourceOnly !== true) {
    problems.push("the failed generation is not source-only");
  }
  if (status?.job?.includeSourceSnapshots !== false) {
    problems.push("the failed generation unexpectedly includes source snapshots");
  }
  if (status?.sourceSetChanged !== false) {
    problems.push("the failed generation's source binding is changed or unresolved");
  }
  if (status?.proposedLearningMap !== null) {
    problems.push("a proposed Learning Map is still visible for the failed generation");
  }
  if (
    status?.latestTextbookVersionId !== undefined &&
    status?.latestTextbookVersionId !== null
  ) {
    problems.push("a committed Learn version already exists");
  }
  // A generation job allocates its candidate version ID before writing pages.
  // Only the snapshot's top-level latestTextbookVersionId is backed by a
  // committed learn_versions row; the job-local field is provisional and may
  // remain populated after an isolated pre-publication failure.
  if (status?.hasTextbook !== false) {
    problems.push("published learner pages already exist");
  }
  if (typeof status?.job?.error !== "string" || !status.job.error.trim()) {
    problems.push("the failed generation has no durable error receipt");
  }
  if (problems.length > 0) {
    throw new Error(`Refusing generation retry: ${problems.join("; ")}`);
  }
}

function assertExpectedRetriedGeneration(
  status,
  expectedJobId,
  expectedMapId,
  expectedModelValue,
) {
  if (status?.job?.status === "complete") {
    assertExpectedCompletion(status, expectedJobId, expectedMapId);
    return;
  }
  const problems = [];
  if (status?.job?.id !== expectedJobId) {
    problems.push(`latest job is ${status?.job?.id ?? "none"}, expected ${expectedJobId}`);
  }
  if (
    status?.job?.mode !== "generate" ||
    !activeGenerationStatuses.has(status?.job?.status)
  ) {
    problems.push(
      `job is ${status?.job?.status ?? "none"}/${status?.job?.mode ?? "none"}, expected an active generation`,
    );
  }
  if (status?.job?.model !== expectedModelValue) {
    problems.push(
      `retried generation model is ${status?.job?.model ?? "none"}, expected ${expectedModelValue}`,
    );
  }
  if (status?.job?.requiresReplan !== false) {
    problems.push("the retried generation unexpectedly requires replanning");
  }
  if (
    status?.job?.confirmedLearningMapId !== expectedMapId ||
    status?.confirmedLearningMapId !== expectedMapId
  ) {
    problems.push(
      `retried generation map binding is ${status?.job?.confirmedLearningMapId ?? "none"}/${status?.confirmedLearningMapId ?? "none"}, expected ${expectedMapId}`,
    );
  }
  if (
    !sameOrderedStrings(status?.job?.sourceIds, expectedTeachingSourceIds) ||
    !sameOrderedStrings(status?.selectedSourceIds, expectedTeachingSourceIds)
  ) {
    problems.push(
      `retried generation source binding is ${JSON.stringify({
        job: status?.job?.sourceIds ?? null,
        selected: status?.selectedSourceIds ?? null,
      })}`,
    );
  }
  if (
    status?.job?.syllabusSourceId !== expectedSyllabusSourceId ||
    status?.syllabusSourceId !== expectedSyllabusSourceId
  ) {
    problems.push(
      `retried generation syllabus binding is ${status?.job?.syllabusSourceId ?? "none"}/${status?.syllabusSourceId ?? "none"}`,
    );
  }
  if (status?.job?.sourceOnly !== true) {
    problems.push("the retried generation is not source-only");
  }
  if (status?.job?.includeSourceSnapshots !== false) {
    problems.push("the retried generation unexpectedly includes source snapshots");
  }
  if (status?.sourceSetChanged !== false) {
    problems.push("the retried generation's source binding is changed or unresolved");
  }
  if (status?.proposedLearningMap !== null) {
    problems.push("a proposed Learning Map is visible during the retried generation");
  }
  if (
    !status?.syllabusCoverage ||
    !Number.isInteger(status.syllabusCoverage.unitCount) ||
    status.syllabusCoverage.unitCount <= 0 ||
    !Array.isArray(status.syllabusCoverage.missingCitations)
  ) {
    problems.push("the exact job-bound syllabus coverage is missing or incomplete");
  }
  if (
    status?.latestTextbookVersionId !== undefined &&
    status?.latestTextbookVersionId !== null
  ) {
    problems.push("an active retry already exposes a committed Learn version");
  }
  if (status?.hasTextbook !== false) {
    problems.push("an active retry already exposes published learner pages");
  }
  if (problems.length > 0) {
    throw new Error(
      `Accepted generation retry did not reconcile to the audited contract: ${problems.join("; ")}`,
    );
  }
}

function normalizedLessonInventory(data) {
  if (!Array.isArray(data?.documents)) {
    throw new Error("Document inventory response has no documents array");
  }
  const lessons = data.documents
    .filter((document) => ["learning-page", "textbook-page"].includes(document?.type))
    .map((document) => ({
      slug: typeof document.slug === "string" ? document.slug : "",
      relPath:
        typeof document.relPath === "string"
          ? document.relPath.replace(/\\/g, "/")
          : "",
      title: typeof document.title === "string" ? document.title : "",
      type: document.type,
      wordCount: Number(document.wordCount ?? 0),
      linkCount: Number(document.linkCount ?? 0),
    }))
    .sort((left, right) =>
      `${left.relPath}\0${left.slug}`.localeCompare(`${right.relPath}\0${right.slug}`),
    );
  if (lessons.length === 0) throw new Error("Document inventory contains no learner pages");
  const invalid = lessons.find(
    (lesson) => !lesson.slug || !lesson.relPath || !lesson.title || lesson.wordCount <= 0,
  );
  if (invalid) {
    throw new Error(`Document inventory contains an incomplete learner page: ${JSON.stringify(invalid)}`);
  }
  return lessons;
}

function normalizedUiText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function safeLearnFileSegment(value, fallback) {
  const cleaned = String(value ?? "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/g, "");
  return (cleaned || fallback).slice(0, 96).trim() || fallback;
}

// Mirror quartz/quartz/util/path.ts slugifyFilePath for Markdown paths. The
// documents API's `slug` is only a raw basename, so it cannot address nested
// lesson pages or prove the Quartz body identity.
function quartzCanonicalSlugFromRelPath(relPath) {
  const withoutExtension = String(relPath ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.md$/i, "");
  let slug = withoutExtension
    .split("/")
    .map((segment) =>
      segment
        .replace(/\s/g, "-")
        .replace(/&/g, "-and-")
        .replace(/%/g, "-percent")
        .replace(/\?/g, "")
        .replace(/#/g, ""),
    )
    .join("/")
    .replace(/\/$/, "");
  if (slug === "_index" || slug.endsWith("/_index")) {
    slug = slug.replace(/_index$/, "index");
  }
  if (!slug || slug.startsWith(".") || slug.startsWith("/")) {
    throw new Error(`Cannot derive a canonical Quartz slug from ${JSON.stringify(relPath)}`);
  }
  return slug;
}

function publicLearningVersionId(versionId) {
  return versionId.replace(/^textbook_/i, "learning_");
}

function readYamlFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`Learner page has no YAML frontmatter: ${filePath}`);
  const parsed = loadYaml(match[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Learner page has invalid YAML frontmatter: ${filePath}`);
  }
  return { frontmatter: parsed, content };
}

function exactLessonPlan(learningMap) {
  if (
    !learningMap ||
    typeof learningMap !== "object" ||
    !Array.isArray(learningMap.sections) ||
    learningMap.sections.length === 0
  ) {
    throw new Error("Confirmed Learning Map has no ordered sections");
  }
  const lessons = [];
  for (const [sectionIndex, section] of learningMap.sections.entries()) {
    if (
      !section ||
      typeof section.title !== "string" ||
      !section.title.trim() ||
      !Array.isArray(section.subsections) ||
      section.subsections.length === 0
    ) {
      throw new Error(`Confirmed Learning Map section ${sectionIndex + 1} is incomplete`);
    }
    const sectionNumber = sectionIndex + 1;
    const sectionFolder = `${sectionNumber}. ${safeLearnFileSegment(section.title, "Section")}`;
    for (const [subsectionIndex, subsection] of section.subsections.entries()) {
      if (
        !subsection ||
        typeof subsection.title !== "string" ||
        !subsection.title.trim() ||
        typeof subsection.learningUnitId !== "string" ||
        !subsection.learningUnitId.trim()
      ) {
        throw new Error(
          `Confirmed Learning Map subsection ${sectionNumber}.${subsectionIndex + 1} has no exact title/unit identity`,
        );
      }
      const subsectionNumber = subsectionIndex + 1;
      lessons.push({
        sectionNumber,
        subsectionNumber,
        learningUnitId: subsection.learningUnitId,
        title: `${sectionNumber}.${subsectionNumber} ${subsection.title}`,
        relPath: `learning/${sectionFolder}/${sectionNumber}.${subsectionNumber} ${safeLearnFileSegment(subsection.title, "Subsection")}.md`,
      });
    }
  }
  return lessons;
}

function readCompletionProvenance({
  expectedJobId,
  expectedMapId,
  expectedVersionId,
  contentPath,
}) {
  const provenanceDb = new DatabaseSync(path.join("dashboard", "db", "brain.db"), {
    readOnly: true,
  });
  let versionRows;
  let mapRows;
  try {
    versionRows = provenanceDb.prepare(
      `SELECT id, garden_id, job_id, learning_map_id, source_set_hash,
              source_artifact_inventory_hash, page_count
       FROM learn_versions
       WHERE id = ? AND garden_id = ? AND job_id = ? AND learning_map_id = ?`,
    ).all(expectedVersionId, gardenId, expectedJobId, expectedMapId);
    mapRows = provenanceDb.prepare(
      `SELECT id, garden_id, job_id, status, learning_map_json, source_set_hash,
              source_artifact_inventory_hash, source_ids_json, syllabus_source_id
       FROM learn_maps
       WHERE id = ? AND garden_id = ? AND status = 'confirmed'`,
    ).all(expectedMapId, gardenId);
  } finally {
    provenanceDb.close();
  }
  if (versionRows.length !== 1) {
    throw new Error(
      `Expected one learn_versions row for the exact version/job/map tuple; found ${versionRows.length}`,
    );
  }
  if (mapRows.length !== 1) {
    throw new Error(`Expected one confirmed learn_maps row; found ${mapRows.length}`);
  }
  const version = versionRows[0];
  const map = mapRows[0];
  if (map.source_set_hash !== version.source_set_hash) {
    throw new Error("Confirmed map and Learn version have different source-set hashes");
  }
  if (
    map.source_artifact_inventory_hash !== version.source_artifact_inventory_hash
  ) {
    throw new Error("Confirmed map and Learn version have different artifact-inventory hashes");
  }
  let sourceIds;
  let learningMap;
  try {
    sourceIds = JSON.parse(map.source_ids_json ?? "[]");
    learningMap = JSON.parse(map.learning_map_json);
  } catch (error) {
    throw new Error(`Confirmed Learning Map provenance JSON is invalid: ${sanitizedError(error)}`);
  }
  if (!sameOrderedStrings(sourceIds, expectedTeachingSourceIds)) {
    throw new Error(`Confirmed map sources are ${JSON.stringify(sourceIds)}`);
  }
  if (map.syllabus_source_id !== expectedSyllabusSourceId) {
    throw new Error(`Confirmed map syllabus is ${map.syllabus_source_id ?? "none"}`);
  }
  const lessons = exactLessonPlan(learningMap);
  // The durable counter covers the exact lesson set plus the published garden
  // root, Learning index, Topic Overview, and Learning Map pages. Section index
  // files are navigation projections and are intentionally not counted by the
  // current Learn commit contract.
  const expectedPublishedPageCount = lessons.length + 4;
  if (Number(version.page_count) !== expectedPublishedPageCount) {
    throw new Error(
      `Learn version records ${version.page_count} pages; the exact map/version contract requires ${expectedPublishedPageCount}`,
    );
  }

  const contentRoot = path.resolve("dashboard", contentPath);
  const gardenRoot = path.resolve(contentRoot, gardenId);
  const visibleVersionId = publicLearningVersionId(expectedVersionId);
  for (const lesson of lessons) {
    const filePath = path.resolve(gardenRoot, ...lesson.relPath.split("/"));
    const relativeCheck = path.relative(gardenRoot, filePath);
    if (
      !relativeCheck ||
      relativeCheck.startsWith("..") ||
      path.isAbsolute(relativeCheck)
    ) {
      throw new Error(`Learner path escaped its garden: ${lesson.relPath}`);
    }
    if (!fs.existsSync(filePath)) {
      throw new Error(`Expected learner page is missing: ${lesson.relPath}`);
    }
    const { frontmatter, content } = readYamlFrontmatter(filePath);
    const checks = {
      title: lesson.title,
      knowledge_type: "learning-page",
      breadboardType: "learning_page",
      gardenId,
      sectionNumber: lesson.sectionNumber,
      subsectionNumber: `${lesson.sectionNumber}.${lesson.subsectionNumber}`,
      learningUnitId: lesson.learningUnitId,
      generatedBy: "learn_button",
      learningVersion: visibleVersionId,
      learningVersionId: visibleVersionId,
      sourceSetHash: version.source_set_hash,
    };
    for (const [key, expected] of Object.entries(checks)) {
      if (String(frontmatter[key] ?? "") !== String(expected)) {
        throw new Error(
          `${lesson.relPath} frontmatter ${key} is ${JSON.stringify(frontmatter[key])}, expected ${JSON.stringify(expected)}`,
        );
      }
    }
    if (content.slice(content.indexOf("---", 3) + 3).trim().length < 200) {
      throw new Error(`Learner page has no substantive Markdown body: ${lesson.relPath}`);
    }
  }
  return { version, map, learningMap, lessons };
}

function assertExactLessonInventory(inventory, lessons) {
  if (inventory.length !== lessons.length) {
    throw new Error(
      `Document inventory has ${inventory.length} learner pages; exact map requires ${lessons.length}`,
    );
  }
  const inventoryByRelPath = new Map();
  const inventorySlugs = new Set();
  for (const actual of inventory) {
    if (inventoryByRelPath.has(actual.relPath)) {
      throw new Error(`Document inventory repeats learner path ${actual.relPath}`);
    }
    if (inventorySlugs.has(actual.slug)) {
      throw new Error(`Document inventory repeats learner slug ${actual.slug}`);
    }
    const expectedApiSlug = path.posix.basename(actual.relPath).replace(/\.md$/i, "");
    if (actual.slug !== expectedApiSlug) {
      throw new Error(
        `Document inventory slug ${JSON.stringify(actual.slug)} does not match basename ${JSON.stringify(expectedApiSlug)} for ${actual.relPath}`,
      );
    }
    inventoryByRelPath.set(actual.relPath, actual);
    inventorySlugs.add(actual.slug);
  }
  const relativeCanonicalSlugs = new Set();
  const fullCanonicalSlugs = new Set();
  return lessons.map((lesson) => {
    const required = { ...lesson, type: "learning-page" };
    const actual = inventoryByRelPath.get(required.relPath);
    if (!actual) {
      throw new Error(`Document inventory is missing exact map path ${required.relPath}`);
    }
    if (
      actual.title !== required.title ||
      actual.type !== required.type
    ) {
      throw new Error(
        `Document inventory diverges from exact map at ${required.relPath}: ${JSON.stringify(actual)}`,
      );
    }
    const canonicalSlug = quartzCanonicalSlugFromRelPath(actual.relPath);
    const fullCanonicalSlug = quartzCanonicalSlugFromRelPath(
      `${gardenId}/${actual.relPath}`,
    );
    if (relativeCanonicalSlugs.has(canonicalSlug)) {
      throw new Error(`Canonical Quartz lesson route is duplicated: ${canonicalSlug}`);
    }
    if (fullCanonicalSlugs.has(fullCanonicalSlug)) {
      throw new Error(`Full canonical Quartz lesson route is duplicated: ${fullCanonicalSlug}`);
    }
    relativeCanonicalSlugs.add(canonicalSlug);
    fullCanonicalSlugs.add(fullCanonicalSlug);
    return {
      ...required,
      inventorySlug: actual.slug,
      canonicalSlug,
      fullCanonicalSlug,
    };
  });
}

function quartzArtifactUrl(quartzRootSource, fullCanonicalSlug) {
  const root = new URL(quartzRootSource);
  const encodedPath = fullCanonicalSlug
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${root.origin}/${encodedPath}/`;
}

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const env = readEnvFile(path.join("dashboard", ".env.local"));
const desktopConfigPath = path.join(
  ".runtime",
  "desktop-config",
  "desktop-config.json",
);
const desktopConfig = fs.existsSync(desktopConfigPath)
  ? JSON.parse(fs.readFileSync(desktopConfigPath, "utf8"))
  : null;
const authCandidates = [
  { source: "dashboard-env", secret: env.NEXTAUTH_SECRET },
  { source: "desktop-config", secret: desktopConfig?.nextAuthSecret },
].filter(
  (candidate, index, candidates) =>
    typeof candidate.secret === "string" &&
    candidate.secret.trim().length > 0 &&
    candidates.findIndex((other) => other.secret === candidate.secret) === index,
);
if (authCandidates.length === 0) throw new Error("NEXTAUTH_SECRET is unavailable");
const dashboardBaseUrl = "http://127.0.0.1:3000";
const gardenWorkspaceUrl = `${dashboardBaseUrl}/gardens/${gardenId}`;
const learnStatusUrl = `${dashboardBaseUrl}/api/gardens/${gardenId}/learn/status`;
const documentInventoryUrl = `${dashboardBaseUrl}/api/documents?clusterSlug=${encodeURIComponent(gardenId)}`;
const appDb = new DatabaseSync(path.join("dashboard", "db", "brain.db"), { readOnly: true });
const user = appDb.prepare("SELECT id, username, email FROM users WHERE id = 1").get();
appDb.close();
if (!user) throw new Error("Breadboard user 1 is unavailable");
const authAttempts = [];
let acceptedAuthSource = null;
let acceptedSession = null;
let acceptedSessionStatus = null;
for (const candidate of authCandidates) {
  const value = await encode({
    secret: candidate.secret,
    token: {
      id: String(user.id),
      sub: String(user.id),
      name: user.username ?? user.email,
      email: user.email,
    },
    maxAge: 10 * 60,
  });
  await context.addCookies([{
    name: "next-auth.session-token",
    value,
    url: dashboardBaseUrl,
    httpOnly: true,
    sameSite: "Lax",
  }]);
  const response = await context.request.get(`${dashboardBaseUrl}/api/auth/session`);
  const session = await response.json().catch(() => ({}));
  const userId = String(session?.user?.id ?? "");
  authAttempts.push({ source: candidate.source, httpStatus: response.status(), userId });
  if (response.ok() && userId === "1") {
    acceptedAuthSource = candidate.source;
    acceptedSession = session;
    acceptedSessionStatus = response.status();
    break;
  }
}
if (!acceptedAuthSource) {
  throw new Error(
    `Authenticated user-1 session was not accepted: ${JSON.stringify(authAttempts)}`,
  );
}
const shouldStatusOnly = process.argv.includes("--status-only");
const shouldStart = process.argv.includes("--start");
const shouldCancel = process.argv.includes("--cancel");
const shouldCancelActiveGeneration = process.argv.includes("--cancel-active-generation");
const shouldReplanStaleCancelledGeneration = process.argv.includes(
  "--replan-stale-cancelled-generation",
);
const shouldPrepareSelection = process.argv.includes("--prepare-selection");
const shouldValidateInvalidPlan = process.argv.includes("--validate-invalid-plan");
const shouldDiagnoseUi = process.argv.includes("--diagnose-ui");
const shouldDiagnoseSettings = process.argv.includes("--diagnose-settings");
const shouldDiagnoseSelection = process.argv.includes("--diagnose-selection");
const shouldAuditConfirmation = process.argv.includes("--audit-confirmation");
const shouldConfirmOnce = process.argv.includes("--confirm-once");
const shouldVerifyComplete = process.argv.includes("--verify-complete");
const shouldRetryGenerationOnce = process.argv.includes("--retry-generation-once");
const expectedJobId = argumentValue("expected-job-id");
const expectedMapId = argumentValue("expected-map-id");
const primaryModes = [
  shouldStatusOnly,
  shouldStart,
  shouldCancel,
  shouldCancelActiveGeneration,
  shouldReplanStaleCancelledGeneration,
  shouldValidateInvalidPlan,
  shouldDiagnoseUi,
  shouldDiagnoseSettings,
  shouldDiagnoseSelection,
  shouldAuditConfirmation,
  shouldConfirmOnce,
  shouldVerifyComplete,
  shouldRetryGenerationOnce,
].filter(Boolean).length;
if (primaryModes > 1) throw new Error("Choose only one Learn runner mode");
if (shouldStart && (!expectedJobId || !expectedModelArgument)) {
  throw new Error(
    "--start requires --expected-job-id=<rolled-back predecessor> and --expected-model=<exact model>",
  );
}
if (shouldStart && expectedModelArgument !== defaultExpectedModel) {
  throw new Error(
    `--start is sealed to ${defaultExpectedModel}; received ${expectedModelArgument}`,
  );
}
if (shouldCancel && !expectedJobId) {
  throw new Error("--cancel requires --expected-job-id=<current durable job id>");
}
if (
  shouldCancelActiveGeneration &&
  (!expectedJobId || !expectedMapId || !expectedModelArgument)
) {
  throw new Error(
    "--cancel-active-generation requires --expected-job-id, --expected-map-id, and --expected-model",
  );
}
if (
  shouldReplanStaleCancelledGeneration &&
  (!expectedJobId || !expectedMapId || !expectedModelArgument)
) {
  throw new Error(
    "--replan-stale-cancelled-generation requires --expected-job-id, --expected-map-id, and --expected-model",
  );
}
if (
  (shouldAuditConfirmation || shouldConfirmOnce || shouldVerifyComplete) &&
  (!expectedJobId || !expectedMapId)
) {
  throw new Error(
    "Confirmation audit, confirmation, and completion verification require both --expected-job-id and --expected-map-id",
  );
}
if (
  shouldRetryGenerationOnce &&
  (!expectedJobId || !expectedMapId || !expectedModelArgument)
) {
  throw new Error(
    "--retry-generation-once requires --expected-job-id, --expected-map-id, and --expected-model",
  );
}
if (shouldStatusOnly) {
  const response = await context.request.get(learnStatusUrl);
  const data = await response.json().catch(() => ({}));
  console.log(JSON.stringify({ httpStatus: response.status(), data }, null, 2));
  await browser.close();
  process.exit(response.ok() ? 0 : 1);
}
const consoleEntries = [];
const requestFailures = [];
const responseEntries = [];
const requestEntries = [];
page.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) {
    consoleEntries.push({ type: message.type(), text: message.text() });
  }
});
page.on("pageerror", (error) => {
  consoleEntries.push({ type: "pageerror", text: error.message });
});
page.on("requestfailed", (request) => {
  const url = new URL(request.url());
  requestFailures.push({
    method: request.method(),
    url: `${url.origin}${url.pathname}`,
    error: request.failure()?.errorText ?? "request failed",
  });
});
page.on("request", (request) => {
  const url = new URL(request.url());
  if (url.pathname.includes(`/api/gardens/${gardenId}/learn/`)) {
    requestEntries.push({ method: request.method(), path: url.pathname });
  }
});
page.on("response", (response) => {
  const url = new URL(response.url());
  if (url.pathname.includes(`/api/gardens/${gardenId}`)) {
    responseEntries.push({
      method: response.request().method(),
      path: url.pathname,
      status: response.status(),
    });
  }
});
page.setDefaultNavigationTimeout(90_000);
page.setDefaultTimeout(120_000);

async function readLearnStatus() {
  const response = await context.request.get(learnStatusUrl, {
    headers: { "Cache-Control": "no-cache" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok()) {
    throw new Error(`Learn status failed: HTTP ${response.status()} ${JSON.stringify(data)}`);
  }
  return { response, data };
}

async function readLessonInventory() {
  const separator = documentInventoryUrl.includes("?") ? "&" : "?";
  const response = await context.request.get(
    `${documentInventoryUrl}${separator}audit=${Date.now()}`,
    { headers: { "Cache-Control": "no-cache" } },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok()) {
    throw new Error(
      `Document inventory failed: HTTP ${response.status()} ${JSON.stringify(data)}`,
    );
  }
  return normalizedLessonInventory(data);
}

async function openGardenSettingsDialog(timeoutMs = 120_000) {
  const settingsButton = page.getByRole("button", {
    name: "Garden settings",
    exact: true,
  });
  await settingsButton.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll('button[aria-label="Garden settings"]')];
    if (buttons.length !== 1) return false;
    const button = buttons[0];
    const reactPropsKey = Object.getOwnPropertyNames(button).find((key) =>
      key.startsWith("__reactProps$"),
    );
    return Boolean(reactPropsKey) && typeof button[reactPropsKey]?.onClick === "function";
  }, null, { timeout: timeoutMs });
  const dialog = page.getByRole("dialog", {
    name: "Garden settings",
    exact: true,
  });
  await settingsButton.click({ timeout: timeoutMs });
  await dialog.waitFor({ state: "visible", timeout: timeoutMs });
  return dialog;
}

function waitForWorkspaceHydration(timeoutMs = 120_000) {
  // WorkspaceClient requests Learn status from a React effect. A successful
  // response is therefore a public readiness signal that hydration committed
  // and event handlers own the server-rendered controls. Merely seeing the
  // always-enabled settings gear is insufficient and can discard its click.
  return page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return response.request().method() === "GET" &&
        url.pathname === `/api/gardens/${gardenId}/learn/status` &&
        response.ok();
    },
    { timeout: timeoutMs },
  ).catch((error) => {
    throw new Error(
      `Workspace hydration signal failed at ${page.url()}: ${error instanceof Error ? error.message : String(error)}; ` +
      `responses=${JSON.stringify(responseEntries)}; requestFailures=${JSON.stringify(requestFailures)}; ` +
      `console=${JSON.stringify(consoleEntries)}`,
    );
  });
}

async function gardenNameInput(dialog) {
  // GardenSettingsDialog's visual label is not associated with the input, so
  // scope structurally from that label inside the exact dialog. Do not depend
  // on a course-specific placeholder.
  const input = dialog
    .getByText("Garden name", { exact: true })
    .locator("..")
    .locator("input");
  const count = await input.count();
  if (count !== 1) {
    throw new Error(`Expected one scoped garden-name input, found ${count}`);
  }
  await input.waitFor({ state: "visible" });
  await input.click();
  return input;
}

async function ensureExpectedGardenDisplayName() {
  const initialDialog = await openGardenSettingsDialog();
  const initialInput = await gardenNameInput(initialDialog);
  const initialName = (await initialInput.inputValue()).trim();
  if (
    initialName !== priorGardenDisplayName &&
    initialName !== expectedGardenDisplayName
  ) {
    throw new Error(
      `Refusing to rename unexpected garden ${JSON.stringify(initialName)}`,
    );
  }

  let renamed = false;
  if (initialName === priorGardenDisplayName) {
    await initialInput.fill(expectedGardenDisplayName);
    const saveButton = initialDialog.getByRole("button", {
      name: "Save name and description",
      exact: true,
    });
    await saveButton.waitFor({ state: "visible" });
    if (!(await saveButton.isEnabled())) {
      throw new Error("Garden-name save control is disabled");
    }
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname ===
          `/api/gardens/${gardenId}/settings`,
    );
    await saveButton.click();
    const response = await responsePromise;
    const data = await response.json().catch(() => ({}));
    if (
      !response.ok() ||
      data?.settings?.slug !== gardenId ||
      data?.settings?.name !== expectedGardenDisplayName
    ) {
      throw new Error(
        `Garden rename was not durably accepted: HTTP ${response.status()} ${JSON.stringify(data)}`,
      );
    }
    await initialDialog
      .getByText("Saved", { exact: true })
      .waitFor({ state: "visible" });
    renamed = true;
  }
  await initialDialog
    .getByRole("button", { name: "Close garden settings", exact: true })
    .click();
  await initialDialog.waitFor({ state: "hidden" });

  const rehydrated = waitForWorkspaceHydration();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("body").waitFor({ state: "visible" });
  await rehydrated;
  await page
    .getByRole("link", { name: expectedGardenDisplayName, exact: true })
    .first()
    .waitFor({ state: "visible" });

  const persistedDialog = await openGardenSettingsDialog();
  const persistedInput = await gardenNameInput(persistedDialog);
  const persistedName = (await persistedInput.inputValue()).trim();
  if (persistedName !== expectedGardenDisplayName) {
    throw new Error(
      `Garden name did not survive reload/reopen: ${JSON.stringify(persistedName)}`,
    );
  }
  await persistedDialog
    .getByRole("button", { name: "Close garden settings", exact: true })
    .click();
  await persistedDialog.waitFor({ state: "hidden" });

  return {
    initialName,
    expectedName: expectedGardenDisplayName,
    renamed,
    persistedAcrossReloadAndReopen: true,
  };
}

async function readAssistantPreferences() {
  const response = await context.request.get(
    `${dashboardBaseUrl}/api/assistant-preferences`,
    { headers: { "Cache-Control": "no-cache" } },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok()) {
    throw new Error(
      `Assistant preferences failed: HTTP ${response.status()} ${JSON.stringify(data)}`,
    );
  }
  return data;
}

async function auditFreshPlanningUi(status) {
  const problems = [];
  const preferences = await readAssistantPreferences();
  if (preferences?.model !== expectedModel) {
    problems.push(
      `active model is ${preferences?.model ?? "none"}, expected ${expectedModel}`,
    );
  }
  if (preferences?.reasoningEffort !== "max") {
    problems.push(
      `active reasoning is ${preferences?.reasoningEffort ?? "none"}, expected max/Ultra`,
    );
  }
  if (preferences?.reasoningEffortByModel?.[expectedModel] !== "max") {
    problems.push(`remembered ${expectedModel} reasoning is not max/Ultra`);
  }
  if (!sameOrderedStrings(status?.selectedSourceIds, expectedTeachingSourceIds)) {
    problems.push(
      `durable teaching-source selection is ${JSON.stringify(status?.selectedSourceIds ?? null)}`,
    );
  }
  if (status?.syllabusSourceId !== expectedSyllabusSourceId) {
    problems.push(
      `durable syllabus is ${status?.syllabusSourceId ?? "none"}, expected ${expectedSyllabusSourceId}`,
    );
  }

  const intelligenceTitle = `Ultra reasoning · GPT-5.6 Sol`;
  const intelligenceButton = page.getByTitle(intelligenceTitle, { exact: true });
  await intelligenceButton.first().waitFor({ state: "visible" });
  if ((await intelligenceButton.count()) !== 1) {
    problems.push(
      `expected one exact ${JSON.stringify(intelligenceTitle)} picker`,
    );
  }

  const learnPanel = page.locator("section.bb-neu-learn-tray").first();
  await learnPanel.waitFor({ state: "visible" });
  const sourceOnlyCheckbox = learnPanel.getByRole("checkbox", {
    name: "Source-only",
    exact: true,
  });
  const skipReviewCheckbox = learnPanel.getByRole("checkbox", {
    name: "Skip review",
    exact: true,
  });
  if (!(await sourceOnlyCheckbox.isChecked())) {
    problems.push("Source-only is not checked");
  }
  if (!(await sourceOnlyCheckbox.isEnabled())) {
    problems.push("Source-only is disabled before planning");
  }
  if (await skipReviewCheckbox.isChecked()) {
    problems.push("Skip review is checked");
  }
  if (!(await skipReviewCheckbox.isEnabled())) {
    problems.push("Skip review is disabled before planning");
  }

  const documentsButton = learnPanel.getByTitle(
    "Choose which source documents Learn may use",
    { exact: true },
  );
  await documentsButton.waitFor({ state: "visible" });
  if (normalizedUiText(await documentsButton.innerText()) !== "Documents 1/1") {
    problems.push(
      `document control is ${JSON.stringify(normalizedUiText(await documentsButton.innerText()))}, expected Documents 1/1`,
    );
  }
  await documentsButton.click();
  const documentsMenu = page.locator(
    '[aria-label="Documents included in Learn"]',
  );
  await documentsMenu.waitFor({ state: "visible" });
  const documentOptions = await documentsMenu.locator("label").evaluateAll(
    (labels) =>
      labels
        .map((label) => {
          const input = label.querySelector('input[type="checkbox"]');
          return input instanceof HTMLInputElement
            ? {
                label: (label.textContent ?? "").replace(/\s+/g, " ").trim(),
                checked: input.checked,
                disabled: input.disabled,
              }
            : null;
        })
        .filter(Boolean),
  );
  const teachingMatches = documentOptions.filter((option) =>
    option.label.includes(expectedTeachingSourceFile),
  );
  const syllabusDocumentMatches = documentOptions.filter((option) =>
    option.label.includes(expectedSyllabusSourceFile),
  );
  if (teachingMatches.length !== 1) {
    problems.push(
      `expected one ${expectedTeachingSourceFile} checkbox, found ${teachingMatches.length}`,
    );
  } else if (
    teachingMatches[0].checked !== true ||
    teachingMatches[0].disabled !== false
  ) {
    problems.push("the exact teaching-source checkbox is not enabled and checked");
  }
  if (syllabusDocumentMatches.length !== 1) {
    problems.push(
      `expected one ${expectedSyllabusSourceFile} document checkbox, found ${syllabusDocumentMatches.length}`,
    );
  } else if (
    syllabusDocumentMatches[0].checked !== false ||
    syllabusDocumentMatches[0].disabled !== true
  ) {
    problems.push("the selected syllabus is not excluded and locked as teaching material");
  }
  const unexpectedCheckedDocuments = documentOptions.filter(
    (option) =>
      !option.disabled &&
      option.checked &&
      !option.label.includes(expectedTeachingSourceFile),
  );
  if (unexpectedCheckedDocuments.length > 0) {
    problems.push(
      `unexpected teaching documents are checked: ${JSON.stringify(unexpectedCheckedDocuments.map((option) => option.label))}`,
    );
  }
  await documentsButton.click();
  await documentsMenu.waitFor({ state: "hidden" });

  const expectedSyllabusText = `Syllabus: ${expectedSyllabusDisplayName}`;
  await learnPanel
    .getByText(expectedSyllabusText, { exact: true })
    .waitFor({ state: "visible" });
  const syllabusButton = learnPanel.getByTitle(
    "Choose a syllabus or study guide for Learn to plan against",
    { exact: true },
  );
  await syllabusButton.click();
  const syllabusMenu = page.locator('[aria-label="Syllabus for Learn"]');
  await syllabusMenu.waitFor({ state: "visible" });
  const syllabusOptions = await syllabusMenu.locator("label").evaluateAll(
    (labels) =>
      labels
        .map((label) => {
          const input = label.querySelector('input[type="radio"]');
          return input instanceof HTMLInputElement
            ? {
                label: (label.textContent ?? "").replace(/\s+/g, " ").trim(),
                checked: input.checked,
                disabled: input.disabled,
              }
            : null;
        })
        .filter(Boolean),
  );
  const syllabusMatches = syllabusOptions.filter((option) =>
    option.label.includes(expectedSyllabusSourceFile),
  );
  if (syllabusMatches.length !== 1) {
    problems.push(
      `expected one ${expectedSyllabusSourceFile} syllabus radio, found ${syllabusMatches.length}`,
    );
  } else if (
    syllabusMatches[0].checked !== true ||
    syllabusMatches[0].disabled !== false
  ) {
    problems.push("the exact syllabus radio is not enabled and checked");
  }
  const unexpectedCheckedSyllabi = syllabusOptions.filter(
    (option) =>
      option.checked && !option.label.includes(expectedSyllabusSourceFile),
  );
  if (unexpectedCheckedSyllabi.length > 0) {
    problems.push(
      `unexpected syllabus choices are checked: ${JSON.stringify(unexpectedCheckedSyllabi.map((option) => option.label))}`,
    );
  }
  await syllabusButton.click();
  await syllabusMenu.waitFor({ state: "hidden" });

  const learnModelIndicator = learnPanel.locator(
    `[title="Model the next Learn run will use: ${expectedModel}"]`,
  );
  if ((await learnModelIndicator.count()) !== 1) {
    problems.push("Learn does not show the exact model for the next run");
  } else if (
    normalizedUiText(await learnModelIndicator.innerText()) !== "GPT-5.6 Sol"
  ) {
    problems.push("Learn's next-run model label is not GPT-5.6 Sol");
  }

  if (problems.length > 0) {
    throw new Error(`Refusing fresh Learn start: ${problems.join("; ")}`);
  }
  return {
    model: expectedModel,
    reasoningEffort: "max",
    reasoningLabel: "Ultra",
    selectedSourceIds: [...expectedTeachingSourceIds],
    teachingSourceFile: expectedTeachingSourceFile,
    syllabusSourceId: expectedSyllabusSourceId,
    syllabusSourceFile: expectedSyllabusSourceFile,
    sourceOnly: true,
    skipManualReview: false,
    exactUiControls: true,
  };
}

async function openLearnPanel() {
  const openLearnButton = page.getByRole("button", { name: "Open Learn panel" });
  await openLearnButton.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === "Open Learn panel",
    );
    return button instanceof HTMLButtonElement && !button.disabled;
  }, null, { timeout: 90_000 });
  await openLearnButton.click();
  await page
    .getByTitle("Choose a syllabus or study guide for Learn to plan against")
    .waitFor({ state: "visible" });
}

async function auditConfirmationUi(status, expectedJobId, expectedMapId) {
  assertExpectedConfirmation(status, expectedJobId, expectedMapId);
  const proposedMap = status.proposedLearningMap;
  const learnPanel = page.locator("section.bb-neu-learn-tray").first();
  await learnPanel.waitFor({ state: "visible" });
  const confirmButton = learnPanel.getByRole("button", {
    name: "Confirm and Learn",
    exact: true,
  });
  await confirmButton.waitFor({ state: "visible" });
  const proposalRegion = confirmButton.locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' mt-4 ')][1]",
  );
  await proposalRegion.waitFor({ state: "visible" });
  const renderedMapTitle = proposalRegion.locator(":scope > div > div > p").first();
  if (normalizedUiText(await renderedMapTitle.innerText()) !== proposedMap.title) {
    throw new Error("Refusing confirmation: the scoped proposal title does not match status");
  }
  const renderedSections = proposalRegion.locator(":scope > ol > li");
  if ((await renderedSections.count()) !== proposedMap.sections.length) {
    throw new Error("Refusing confirmation: proposal section count/order is incomplete in the Learn panel");
  }
  for (const [sectionIndex, section] of proposedMap.sections.entries()) {
    const renderedSection = renderedSections.nth(sectionIndex);
    const renderedSectionTitle = renderedSection
      .locator(":scope > div > div > p")
      .first();
    if (normalizedUiText(await renderedSectionTitle.innerText()) !== section.title) {
      throw new Error(
        `Refusing confirmation: section ${sectionIndex + 1} is not the expected ordered title`,
      );
    }
    const renderedSubsections = renderedSection.locator(
      ":scope > div > div > ul > li",
    );
    if ((await renderedSubsections.count()) !== section.subsections.length) {
      throw new Error(
        `Refusing confirmation: section ${sectionIndex + 1} has the wrong subsection count`,
      );
    }
    for (const [subsectionIndex, subsection] of section.subsections.entries()) {
      const renderedSubsection = renderedSubsections.nth(subsectionIndex);
      const visualCount = Array.isArray(subsection.visualOpportunities)
        ? subsection.visualOpportunities.length
        : 0;
      const directSpans = renderedSubsection.locator(":scope > span");
      const expectedDirectSpanCount = visualCount > 0 ? 2 : 1;
      if ((await directSpans.count()) !== expectedDirectSpanCount) {
        throw new Error(
          `Refusing confirmation: subsection ${sectionIndex + 1}.${subsectionIndex + 1} has an unexpected direct-span structure`,
        );
      }
      const expectedNumber = `${sectionIndex + 1}.${subsectionIndex + 1}`;
      const actualNumber = normalizedUiText(await directSpans.first().innerText());
      if (actualNumber !== expectedNumber) {
        throw new Error(
          `Refusing confirmation: subsection number is ${JSON.stringify(actualNumber)}, expected ${JSON.stringify(expectedNumber)}`,
        );
      }
      const actualTitle = normalizedUiText(
        await renderedSubsection.evaluate((element) =>
          Array.from(element.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent ?? "")
            .join(" "),
        ),
      );
      const expectedTitle = normalizedUiText(subsection.title);
      if (actualTitle !== expectedTitle) {
        throw new Error(
          `Refusing confirmation: subsection ${expectedNumber} title is ${JSON.stringify(actualTitle)}, expected ${JSON.stringify(expectedTitle)}`,
        );
      }
      const visualBadges = renderedSubsection.locator(":scope > span.text-cyan-500");
      const expectedBadgeCount = visualCount > 0 ? 1 : 0;
      if ((await visualBadges.count()) !== expectedBadgeCount) {
        throw new Error(
          `Refusing confirmation: subsection ${expectedNumber} has the wrong visual-badge structure`,
        );
      }
      if (visualCount > 0) {
        const expectedBadge = `${visualCount} visual${visualCount === 1 ? "" : "s"}`;
        const actualBadge = normalizedUiText(await visualBadges.first().innerText());
        if (actualBadge !== expectedBadge) {
          throw new Error(
            `Refusing confirmation: subsection ${expectedNumber} visual badge is ${JSON.stringify(actualBadge)}, expected ${JSON.stringify(expectedBadge)}`,
          );
        }
      }
    }
  }
  await learnPanel
    .getByText("Syllabus: StudyGuide_5EPF0.pdf", { exact: true })
    .first()
    .waitFor({ state: "visible" });
  await learnPanel
    .getByRole("button", { name: /Documents 1\/1/ })
    .waitFor({ state: "visible" });

  const sourceOnlyCheckbox = learnPanel.getByRole("checkbox", { name: "Source-only" });
  const skipReviewCheckbox = learnPanel.getByRole("checkbox", { name: "Skip review" });
  if (!(await sourceOnlyCheckbox.isChecked())) {
    throw new Error("Refusing confirmation: Source-only is not checked");
  }
  if (await skipReviewCheckbox.isChecked()) {
    throw new Error("Refusing confirmation: Skip review is still checked");
  }
  if (!(await skipReviewCheckbox.isDisabled())) {
    throw new Error("Refusing confirmation: Skip review is not locked at the review boundary");
  }

  if (!(await confirmButton.isEnabled())) {
    throw new Error("Refusing confirmation: Confirm and Learn is disabled");
  }

  return {
    confirmButton,
    summary: {
      job: {
        id: status.job.id,
        status: status.job.status,
        mode: status.job.mode,
        model: status.job.model,
      },
      learningMap: {
        id: expectedMapId,
        title: proposedMap.title,
        sections: proposedMap.sections.map((section) => ({
          title: section.title,
          subsectionCount: section.subsections.length,
        })),
        warningCount: Array.isArray(proposedMap.warnings) ? proposedMap.warnings.length : 0,
      },
      selectedSourceIds: [...status.selectedSourceIds],
      syllabusSourceId: status.syllabusSourceId,
      syllabusCoverage: {
        unitCount: status.syllabusCoverage.unitCount,
        materialCount: status.syllabusCoverage.materialCount,
        availableCount: status.syllabusCoverage.availableCount,
        missingCount: status.syllabusCoverage.missingCount,
        genericCount: status.syllabusCoverage.genericCount,
        missingCitationCount: status.syllabusCoverage.missingCitations.length,
      },
      controls: {
        sourceOnly: true,
        skipReview: false,
        skipReviewLocked: true,
        confirmEnabled: true,
      },
    },
  };
}

const workspaceHydrated = waitForWorkspaceHydration();
await page.goto(gardenWorkspaceUrl, { waitUntil: "domcontentloaded" });
await page.locator("body").waitFor({ state: "visible" });
await workspaceHydrated;
if (shouldDiagnoseSettings) {
  try {
    const dialog = await openGardenSettingsDialog(20_000);
    const input = await gardenNameInput(dialog);
    console.log(JSON.stringify({
      settingsDialog: {
        visible: await dialog.isVisible(),
        currentGardenName: (await input.inputValue()).trim(),
        settingsGetResponses: responseEntries.filter(
          (entry) =>
            entry.method === "GET" &&
            entry.path === `/api/gardens/${gardenId}/settings`,
        ),
        learnMutations: requestEntries.filter((entry) => entry.method === "POST"),
      },
      consoleEntries,
      requestFailures,
    }, null, 2));
    await browser.close();
    process.exit(0);
  } catch (error) {
    const settingsButton = page.getByRole("button", {
      name: "Garden settings",
      exact: true,
    });
    const buttonDiagnostics = await settingsButton.evaluate((button) => {
      const reactPropsKey = Object.getOwnPropertyNames(button).find((key) =>
        key.startsWith("__reactProps$"),
      );
      const reactProps = reactPropsKey ? button[reactPropsKey] : null;
      const rect = button.getBoundingClientRect();
      return {
        disabled: button.disabled,
        connected: button.isConnected,
        outerHTML: button.outerHTML.slice(0, 2_000),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        reactPropsPresent: Boolean(reactPropsKey),
        reactOnClickPresent: typeof reactProps?.onClick === "function",
      };
    }).catch((cause) => ({ evaluationError: String(cause) }));
    console.log(JSON.stringify({
      settingsDialogFailure: error instanceof Error ? error.message : String(error),
      url: page.url(),
      buttonDiagnostics,
      visibleDialogs: await page.getByRole("dialog").allInnerTexts().catch(() => []),
      body: (await page.locator("body").innerText().catch(() => "")).slice(0, 8_000),
      consoleEntries,
      requestFailures,
      responseEntries,
      learnMutations: requestEntries.filter((entry) => entry.method === "POST"),
    }, null, 2));
    await browser.close();
    process.exit(1);
  }
}
let gardenNamePreparation = null;
if (shouldStart) {
  gardenNamePreparation = await ensureExpectedGardenDisplayName();
}
const { response: preStatusResponse, data: preStatus } = await readLearnStatus();
if (shouldValidateInvalidPlan) {
  const invalidResponse = await context.request.post(
    `${dashboardBaseUrl}/api/gardens/electromagnetism-1/learn/plan`,
    { data: {} },
  );
  const invalidData = await invalidResponse.json().catch(() => ({}));
  if (
    invalidResponse.status() !== 400 ||
    !/explicit includedSourceIds selection/.test(invalidData?.error ?? "")
  ) {
    throw new Error(
      `Incomplete Learn plan was not rejected: HTTP ${invalidResponse.status()} ${JSON.stringify(invalidData)}`,
    );
  }
  const postStatusResponse = await context.request.get(learnStatusUrl);
  const postStatus = await postStatusResponse.json().catch(() => ({}));
  if (
    !postStatusResponse.ok() ||
    postStatus?.job?.id !== preStatus?.job?.id ||
    postStatus?.job?.updatedAt !== preStatus?.job?.updatedAt
  ) {
    throw new Error(
      `Rejected Learn plan changed durable state: ${JSON.stringify({ before: preStatus?.job, after: postStatus?.job })}`,
    );
  }
  console.log(JSON.stringify({
    invalidPlan: {
      httpStatus: invalidResponse.status(),
      error: invalidData.error,
      durableJobUnchanged: true,
      jobId: postStatus?.job?.id ?? null,
    },
  }, null, 2));
  await browser.close();
  process.exit(0);
}
if (shouldDiagnoseUi) {
  const openButton = page.getByRole("button", { name: "Open Learn panel" });
  await openButton.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === "Open Learn panel",
    );
    return button instanceof HTMLButtonElement && !button.disabled;
  }, null, { timeout: 30_000 }).catch(() => null);
  console.log(JSON.stringify({
    button: await openButton.evaluate((button) => ({
      disabled: button.disabled,
      title: button.getAttribute("title"),
      outerHTML: button.outerHTML.slice(0, 1500),
    })),
    responseEntries,
    consoleEntries,
    requestFailures,
    body: (await page.locator("body").innerText()).slice(0, 6000),
  }, null, 2));
  await browser.close();
  process.exit(0);
}
if (!shouldCancel) await openLearnPanel();
if (shouldReplanStaleCancelledGeneration) {
  if (
    preStatus?.job?.id !== expectedJobId ||
    preStatus?.job?.status !== "cancelled" ||
    preStatus?.job?.mode !== "generate"
  ) {
    throw new Error(
      `Refusing stale-map replanning outside the expected cancelled generation: ${preStatus?.job?.id ?? "none"} ${preStatus?.job?.status ?? "none"}/${preStatus?.job?.mode ?? "none"}`,
    );
  }
  if (
    preStatus.confirmedLearningMapId !== expectedMapId ||
    !preStatus.confirmedLearningMapModel?.trim()
  ) {
    throw new Error(
      `Refusing stale-map replanning for unexpected fallback map ${preStatus.confirmedLearningMapId ?? "none"}/${preStatus.confirmedLearningMapModel ?? "no model"}`,
    );
  }
  if (
    preStatus.sourceSetChanged !== true ||
    preStatus.hasTextbook === true ||
    preStatus.latestTextbookVersionId ||
    preStatus.proposedLearningMap !== null
  ) {
    throw new Error(
      `Refusing stale-map replanning outside a rolled-back, source-stale checkpoint: ${JSON.stringify({
        sourceSetChanged: preStatus.sourceSetChanged,
        hasTextbook: preStatus.hasTextbook,
        latestTextbookVersionId: preStatus.latestTextbookVersionId ?? null,
        proposedLearningMap: preStatus.proposedLearningMap,
      })}`,
    );
  }
  if (
    !sameOrderedStrings(preStatus.selectedSourceIds, expectedTeachingSourceIds) ||
    preStatus.syllabusSourceId !== expectedSyllabusSourceId
  ) {
    throw new Error(
      `Refusing stale-map replanning with unexpected selection: ${JSON.stringify({
        selectedSourceIds: preStatus.selectedSourceIds,
        syllabusSourceId: preStatus.syllabusSourceId,
      })}`,
    );
  }
  const earlierPosts = requestEntries.filter((entry) => entry.method === "POST");
  if (earlierPosts.length > 0) {
    throw new Error(
      `Refusing stale-map replanning because the page already issued Learn POSTs: ${JSON.stringify(earlierPosts)}`,
    );
  }

  let guardedPostCount = 0;
  let resolveGuardFailure;
  const guardFailure = new Promise((resolve) => {
    resolveGuardFailure = resolve;
  });
  const actionPattern = new RegExp(
    `/api/gardens/${gardenId}/learn/[^/?]+(?:\\?.*)?$`,
  );
  await page.route(actionPattern, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    guardedPostCount += 1;
    const pathname = new URL(request.url()).pathname;
    const body = request.postDataJSON();
    const exactSelection =
      sameOrderedStrings(body?.includedSourceIds, expectedTeachingSourceIds) &&
      body?.syllabusSourceId === expectedSyllabusSourceId &&
      body?.sourceOnly === true &&
      body?.includeSourceSnapshots === false &&
      body?.skipManualReview === false;
    const issue =
      guardedPostCount === 1 && pathname.endsWith("/learn/plan")
        ? !exactSelection
          ? `replacement planning selection changed: ${JSON.stringify(body)}`
          : body?.confirmedLearningMapId || body?.expectedModel
            ? `replacement planning was contaminated by the stale map binding: ${JSON.stringify(body)}`
            : null
        : `unexpected Learn mutation ${guardedPostCount}: ${pathname}`;
    if (issue) {
      resolveGuardFailure(new Error(issue));
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  const planResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith(`/api/gardens/${gardenId}/learn/plan`),
    { timeout: 4 * 60_000 },
  );
  const learnPanel = page.locator("section.bb-neu-learn-tray").first();
  const restartPlanningButton = learnPanel.getByRole("button", {
    name: "Restart planning",
    exact: true,
  });
  await restartPlanningButton.waitFor({ state: "visible" });
  if (!(await restartPlanningButton.isEnabled())) {
    throw new Error(
      "Refusing stale-map replanning because Restart planning is disabled",
    );
  }
  await restartPlanningButton.click();
  const guardedOutcome = await Promise.race([
    planResponsePromise.then((planResponse) => ({ planResponse })),
    guardFailure.then((error) => ({ error })),
  ]);
  if (guardedOutcome.error) throw guardedOutcome.error;
  const planData = await guardedOutcome.planResponse.json().catch(() => ({}));
  if (
    guardedOutcome.planResponse.status() !== 202 ||
    planData?.accepted !== true ||
    typeof planData?.jobId !== "string" ||
    !planData.jobId.trim()
  ) {
    throw new Error(
      `Replacement planning was not accepted: HTTP ${guardedOutcome.planResponse.status()} ${JSON.stringify(planData)}`,
    );
  }
  const { data: postStatus } = await readLearnStatus();
  if (
    postStatus?.job?.id !== planData.jobId ||
    postStatus.job.mode !== "plan" ||
    postStatus.job.model !== expectedModelArgument ||
    !sameOrderedStrings(postStatus.job.sourceIds, expectedTeachingSourceIds) ||
    postStatus.job.syllabusSourceId !== expectedSyllabusSourceId
  ) {
    throw new Error(
      `Replacement planning durable binding mismatch: ${JSON.stringify(postStatus?.job ?? null)}`,
    );
  }
  const learnPosts = requestEntries.filter((entry) => entry.method === "POST");
  if (
    guardedPostCount !== 1 ||
    learnPosts.length !== 1 ||
    !learnPosts[0].path.endsWith("/learn/plan")
  ) {
    throw new Error(`Expected exactly one direct replacement plan POST: ${JSON.stringify(learnPosts)}`);
  }
  console.log(JSON.stringify({
    replacementPlan: {
      endpoint: new URL(guardedOutcome.planResponse.url()).pathname,
      httpStatus: guardedOutcome.planResponse.status(),
      accepted: planData.accepted,
      jobId: planData.jobId,
      model: postStatus.job.model,
      sourceIds: postStatus.job.sourceIds,
      syllabusSourceId: postStatus.job.syllabusSourceId,
      status: postStatus.job.status,
      staleGenerationSkipped: true,
      priorJobId: expectedJobId,
      priorMapId: expectedMapId,
    },
    learnPosts,
  }, null, 2));
  await browser.close();
  process.exit(0);
}
if (shouldRetryGenerationOnce) {
  assertExpectedFailedGeneration(
    preStatus,
    expectedJobId,
    expectedMapId,
    expectedModelArgument,
  );
  const earlierLearnActionPosts = requestEntries.filter(
    (entry) => entry.method === "POST",
  );
  if (earlierLearnActionPosts.length > 0) {
    throw new Error(
      `Refusing generation retry because the page already issued Learn action POSTs: ${JSON.stringify(earlierLearnActionPosts)}`,
    );
  }

  let { data: clickStatus } = await readLearnStatus();
  assertExpectedFailedGeneration(
    clickStatus,
    expectedJobId,
    expectedMapId,
    expectedModelArgument,
  );
  if (clickStatus.job.updatedAt !== preStatus.job.updatedAt) {
    throw new Error(
      `Refusing generation retry because the audited job changed at ${preStatus.job.updatedAt ?? "unknown"} -> ${clickStatus.job.updatedAt ?? "unknown"}`,
    );
  }

  let learnPanel = page.locator("section.bb-neu-learn-tray").first();
  // Next development compilation can finish with a full navigation after the
  // panel was opened, clearing its client-local open state. Reacquire the same
  // panel once, then repeat the durable audit before permitting any mutation.
  if (!(await learnPanel.isVisible())) {
    await openLearnPanel();
    learnPanel = page.locator("section.bb-neu-learn-tray").first();
    ({ data: clickStatus } = await readLearnStatus());
    assertExpectedFailedGeneration(
      clickStatus,
      expectedJobId,
      expectedMapId,
      expectedModelArgument,
    );
    if (clickStatus.job.updatedAt !== preStatus.job.updatedAt) {
      throw new Error(
        `Refusing generation retry because the job changed during UI reload at ${preStatus.job.updatedAt ?? "unknown"} -> ${clickStatus.job.updatedAt ?? "unknown"}`,
      );
    }
    const reloadLearnActionPosts = requestEntries.filter(
      (entry) => entry.method === "POST",
    );
    if (reloadLearnActionPosts.length > 0) {
      throw new Error(
        `Refusing generation retry because the UI reload issued Learn action POSTs: ${JSON.stringify(reloadLearnActionPosts)}`,
      );
    }
  }
  await learnPanel.waitFor({ state: "visible" });
  const retryButton = learnPanel.getByRole("button", {
    name: "Retry Learn",
    exact: true,
  });
  const retryButtonCount = await retryButton.count();
  if (retryButtonCount !== 1) {
    throw new Error(
      `Refusing generation retry because exactly one visible Retry Learn control was expected, found ${retryButtonCount}`,
    );
  }
  await retryButton.waitFor({ state: "visible" });
  if (!(await retryButton.isEnabled())) {
    throw new Error("Refusing generation retry because Retry Learn is disabled");
  }

  let retryGeneratePostCount = 0;
  let capturedRetryBody = null;
  let resolveGuardedRetryFailure;
  const guardedRetryFailure = new Promise((resolve) => {
    resolveGuardedRetryFailure = resolve;
  });
  const retryRoutePattern = new RegExp(
    `/api/gardens/${gardenId}/learn/[^/?]+(?:\\?.*)?$`,
  );
  const retryRouteHandler = async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    const requestPath = new URL(request.url()).pathname;
    const generatePath = `/api/gardens/${gardenId}/learn/generate`;
    if (requestPath !== generatePath) {
      resolveGuardedRetryFailure(
        new Error(`Blocked unexpected Learn action POST during retry: ${requestPath}`),
      );
      await route.abort("blockedbyclient");
      return;
    }
    retryGeneratePostCount += 1;
    if (retryGeneratePostCount > 1) {
      resolveGuardedRetryFailure(new Error("Blocked a duplicate Learn generation retry POST"));
      await route.abort("blockedbyclient");
      return;
    }
    let body;
    try {
      body = request.postDataJSON();
    } catch {
      resolveGuardedRetryFailure(
        new Error("Blocked a Learn generation retry POST with unreadable JSON"),
      );
      await route.abort("blockedbyclient");
      return;
    }
    const expectedBodyKeys = [
      "confirmedLearningMapId",
      "expectedModel",
      "includeSourceSnapshots",
      "includedSourceIds",
      "skipManualReview",
      "sourceOnly",
      "syllabusSourceId",
    ];
    const actualBodyKeys =
      body && typeof body === "object" && !Array.isArray(body)
        ? Object.keys(body).sort()
        : [];
    const issue =
      JSON.stringify(actualBodyKeys) !== JSON.stringify(expectedBodyKeys)
        ? `generation retry body keys are ${JSON.stringify(actualBodyKeys)}, expected ${JSON.stringify(expectedBodyKeys)}`
        : body.expectedModel !== expectedModelArgument
          ? `generation retry model is ${body.expectedModel ?? "none"}, expected ${expectedModelArgument}`
          : body.confirmedLearningMapId !== expectedMapId
            ? `generation retry map is ${body.confirmedLearningMapId ?? "none"}, expected ${expectedMapId}`
            : !sameOrderedStrings(body.includedSourceIds, expectedTeachingSourceIds)
              ? `generation retry sources are ${JSON.stringify(body.includedSourceIds ?? null)}`
              : body.syllabusSourceId !== expectedSyllabusSourceId
                ? `generation retry syllabus is ${body.syllabusSourceId ?? "none"}`
                : body.sourceOnly !== true
                  ? "generation retry is not source-only"
                  : body.includeSourceSnapshots !== false
                    ? "generation retry unexpectedly requested source snapshots"
                    : body.skipManualReview !== false
                      ? "generation retry unexpectedly skipped manual review"
                      : null;
    if (issue) {
      resolveGuardedRetryFailure(new Error(`Blocked Learn generation retry: ${issue}`));
      await route.abort("blockedbyclient");
      return;
    }
    capturedRetryBody = body;
    await route.continue();
  };

  await page.route(retryRoutePattern, retryRouteHandler);
  let retryResponse;
  let generationJobId;
  let generationStatus;
  try {
    const raceRetryGuard = async (promise) => {
      const outcome = await Promise.race([
        promise.then((value) => ({ value })),
        guardedRetryFailure.then((error) => ({ error })),
      ]);
      if (outcome.error) throw outcome.error;
      return outcome.value;
    };
    const retryResponsePromise = page.waitForResponse((response) => {
      const request = response.request();
      return request.method() === "POST" &&
        new URL(response.url()).pathname === `/api/gardens/${gardenId}/learn/generate`;
    }, { timeout: 4 * 60_000 });
    await retryButton.click({ clickCount: 1 });
    retryResponse = await raceRetryGuard(retryResponsePromise);
    const retryData = await raceRetryGuard(
      retryResponse.json().catch(() => ({})),
    );
    if (
      retryResponse.status() !== 202 ||
      retryData?.success !== true ||
      retryData?.accepted !== true ||
      typeof retryData?.jobId !== "string" ||
      !retryData.jobId.trim()
    ) {
      throw new Error(
        `Learn generation retry was not accepted unambiguously: HTTP ${retryResponse.status()} ${JSON.stringify(retryData)}`,
      );
    }
    generationJobId = retryData.jobId.trim();
    if (generationJobId === expectedJobId) {
      throw new Error("Learn generation retry reused the failed job id");
    }

    await raceRetryGuard(page.waitForTimeout(1_000));
    if (retryGeneratePostCount !== 1 || !capturedRetryBody) {
      throw new Error(
        `Expected exactly one guarded generation retry POST, observed ${retryGeneratePostCount}`,
      );
    }

    const reconciliationDeadline = Date.now() + 30_000;
    while (Date.now() < reconciliationDeadline) {
      const { data } = await raceRetryGuard(readLearnStatus());
      if (data?.job?.id === generationJobId) {
        generationStatus = data;
        break;
      }
      if (data?.job?.id && data.job.id !== expectedJobId) {
        throw new Error(
          `Expected retried generation job ${generationJobId}; latest job became ${data.job.id}`,
        );
      }
      await raceRetryGuard(page.waitForTimeout(500));
    }
    if (!generationStatus) {
      throw new Error(
        `Retried generation job ${generationJobId} did not become the durable latest job`,
      );
    }
    if (["failed", "cancelled"].includes(generationStatus.job.status)) {
      throw new Error(
        `Accepted generation retry ${generationJobId} immediately settled as ${generationStatus.job.status}: ${generationStatus.job.error ?? "no durable error"}`,
      );
    }
    assertExpectedRetriedGeneration(
      generationStatus,
      generationJobId,
      expectedMapId,
      expectedModelArgument,
    );
    if (generationStatus.job.status === "complete") {
      const versionId = generationStatus.latestTextbookVersionId.trim();
      const provenance = readCompletionProvenance({
        expectedJobId: generationJobId,
        expectedMapId,
        expectedVersionId: versionId,
        contentPath: env.QUARTZ_CONTENT_PATH,
      });
      const inventory = await raceRetryGuard(readLessonInventory());
      assertExactLessonInventory(inventory, provenance.lessons);
    }
    if (retryGeneratePostCount !== 1 || !capturedRetryBody) {
      throw new Error(
        `Expected exactly one guarded generation retry POST, observed ${retryGeneratePostCount}`,
      );
    }
  } catch (error) {
    // Keep every Learn POST guarded until the page is gone. In particular, a
    // 409 response must not let handleLearnPrimary fall through to /learn/plan.
    await browser.close().catch(() => {});
    throw error;
  } finally {
    if (browser.isConnected()) {
      await page.unroute(retryRoutePattern, retryRouteHandler);
    }
  }

  console.log(JSON.stringify({
    generationRetry: {
      postCount: retryGeneratePostCount,
      httpStatus: retryResponse.status(),
      accepted: true,
      failedJobId: expectedJobId,
      generationJobId,
      learningMapId: expectedMapId,
      model: expectedModelArgument,
      durableStatus: generationStatus.job.status,
      request: capturedRetryBody,
    },
  }, null, 2));
  await browser.close();
  process.exit(0);
}
if (shouldAuditConfirmation) {
  const { summary } = await auditConfirmationUi(preStatus, expectedJobId, expectedMapId);
  console.log(JSON.stringify({ confirmationAudit: summary }, null, 2));
  await browser.close();
  process.exit(0);
}
if (shouldConfirmOnce) {
  const { data: clickStatus } = await readLearnStatus();
  assertExpectedConfirmation(clickStatus, expectedJobId, expectedMapId);
  if (clickStatus.job.updatedAt !== preStatus.job.updatedAt) {
    throw new Error(
      `Refusing confirmation because the audited job changed at ${preStatus.job.updatedAt ?? "unknown"} -> ${clickStatus.job.updatedAt ?? "unknown"}`,
    );
  }
  const { confirmButton, summary } = await auditConfirmationUi(
    clickStatus,
    expectedJobId,
    expectedMapId,
  );
  let confirmPostCount = 0;
  let capturedConfirmBody = null;
  let resolveGuardedRequestFailure;
  const guardedRequestFailure = new Promise((resolve) => {
    resolveGuardedRequestFailure = resolve;
  });
  const confirmRoutePattern = new RegExp(
    `/api/gardens/${gardenId}/learn/confirm$`,
  );
  const confirmRouteHandler = async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    confirmPostCount += 1;
    if (confirmPostCount > 1) {
      resolveGuardedRequestFailure(
        new Error("Blocked a duplicate Learn confirmation POST"),
      );
      await route.abort("blockedbyclient");
      return;
    }
    let body;
    try {
      body = request.postDataJSON();
    } catch {
      resolveGuardedRequestFailure(
        new Error("Blocked a Learn confirmation POST with unreadable JSON"),
      );
      await route.abort("blockedbyclient");
      return;
    }
    const issue =
      body?.learningMapId !== expectedMapId
        ? `confirmation map is ${body?.learningMapId ?? "none"}, expected ${expectedMapId}`
        : body?.expectedModel !== expectedModel
          ? `confirmation model is ${body?.expectedModel ?? "none"}, expected ${expectedModel}`
        : body?.generate !== true
          ? "confirmation did not request generation"
          : !sameOrderedStrings(body?.includedSourceIds, expectedTeachingSourceIds)
            ? `confirmation sources are ${JSON.stringify(body?.includedSourceIds ?? null)}`
            : body?.syllabusSourceId !== expectedSyllabusSourceId
              ? `confirmation syllabus is ${body?.syllabusSourceId ?? "none"}`
              : body?.sourceOnly !== true
                ? "confirmation is not source-only"
                : body?.includeSourceSnapshots !== false
                  ? "confirmation unexpectedly requested source snapshots"
                  : body?.skipManualReview !== false
                    ? "confirmation unexpectedly skipped manual review"
                    : null;
    if (issue) {
      resolveGuardedRequestFailure(new Error(`Blocked Learn confirmation: ${issue}`));
      await route.abort("blockedbyclient");
      return;
    }
    capturedConfirmBody = body;
    await route.continue();
  };
  await page.route(confirmRoutePattern, confirmRouteHandler);
  let confirmResponse;
  let generationJobId;
  let generationStatus;
  try {
    const raceGuard = async (promise) => {
      const outcome = await Promise.race([
        promise.then((value) => ({ value })),
        guardedRequestFailure.then((error) => ({ error })),
      ]);
      if (outcome.error) throw outcome.error;
      return outcome.value;
    };
    const confirmResponsePromise = page.waitForResponse((response) => {
      const request = response.request();
      return request.method() === "POST" &&
        new URL(response.url()).pathname === `/api/gardens/${gardenId}/learn/confirm`;
    }, { timeout: 4 * 60_000 });
    await confirmButton.click({ clickCount: 1 });
    confirmResponse = await raceGuard(confirmResponsePromise);
    const confirmData = await confirmResponse.json().catch(() => ({}));
    if (
      confirmResponse.status() !== 202 ||
      confirmData?.success !== true ||
      confirmData?.accepted !== true ||
      typeof confirmData?.jobId !== "string" ||
      !confirmData.jobId.trim()
    ) {
      throw new Error(
        `Learn confirmation was not accepted: HTTP ${confirmResponse.status()} ${JSON.stringify(confirmData)}`,
      );
    }
    generationJobId = confirmData.jobId.trim();
    if (generationJobId === expectedJobId) {
      throw new Error("Learn confirmation reused the planning job instead of creating a generation job");
    }

    await raceGuard(page.waitForTimeout(1_000));
    if (confirmPostCount !== 1 || !capturedConfirmBody) {
      throw new Error(`Expected exactly one guarded confirmation POST, observed ${confirmPostCount}`);
    }

    const reconciliationDeadline = Date.now() + 30_000;
    while (Date.now() < reconciliationDeadline) {
      const { data } = await raceGuard(readLearnStatus());
      if (data?.job?.id === generationJobId) {
        generationStatus = data;
        break;
      }
      if (data?.job?.id && data.job.id !== expectedJobId) {
        throw new Error(
          `Expected generation job ${generationJobId}; latest job became ${data.job.id}`,
        );
      }
      await raceGuard(page.waitForTimeout(500));
    }
    if (!generationStatus) {
      throw new Error(`Generation job ${generationJobId} did not become the durable latest job`);
    }
    if (["failed", "cancelled"].includes(generationStatus.job.status)) {
      throw new Error(
        `Accepted generation ${generationJobId} immediately settled as ${generationStatus.job.status}: ${generationStatus.job.error ?? "no durable error"}`,
      );
    }
    if (generationStatus.job.status === "complete") {
      assertExpectedCompletion(generationStatus, generationJobId, expectedMapId);
      const versionId = generationStatus.latestTextbookVersionId.trim();
      const provenance = readCompletionProvenance({
        expectedJobId: generationJobId,
        expectedMapId,
        expectedVersionId: versionId,
        contentPath: env.QUARTZ_CONTENT_PATH,
      });
      const inventory = await raceGuard(readLessonInventory());
      assertExactLessonInventory(inventory, provenance.lessons);
    } else if (
      generationStatus.job.mode !== "generate" ||
      generationStatus.job.model !== expectedModel ||
      !activeGenerationStatuses.has(generationStatus.job.status) ||
      generationStatus.job.confirmedLearningMapId !== expectedMapId ||
      !sameOrderedStrings(generationStatus.job.sourceIds, expectedTeachingSourceIds) ||
      generationStatus.job.syllabusSourceId !== expectedSyllabusSourceId ||
      generationStatus.job.sourceOnly !== true ||
      generationStatus.job.includeSourceSnapshots !== false ||
      generationStatus.confirmedLearningMapId !== expectedMapId ||
      generationStatus.proposedLearningMap !== null ||
      !sameOrderedStrings(
        generationStatus.selectedSourceIds,
        expectedTeachingSourceIds,
      ) ||
      generationStatus.syllabusSourceId !== expectedSyllabusSourceId ||
      !generationStatus.syllabusCoverage ||
      !Number.isInteger(generationStatus.syllabusCoverage.unitCount) ||
      generationStatus.syllabusCoverage.unitCount <= 0 ||
      !Array.isArray(generationStatus.syllabusCoverage.missingCitations)
    ) {
      throw new Error(
        `Accepted generation did not reconcile to the audited contract: ${JSON.stringify({
          job: generationStatus.job,
          confirmedLearningMapId: generationStatus.confirmedLearningMapId ?? null,
          proposedLearningMap: generationStatus.proposedLearningMap ?? null,
          selectedSourceIds: generationStatus.selectedSourceIds ?? null,
          syllabusSourceId: generationStatus.syllabusSourceId ?? null,
          syllabusCoverage: generationStatus.syllabusCoverage
            ? {
                unitCount: generationStatus.syllabusCoverage.unitCount,
                materialCount: generationStatus.syllabusCoverage.materialCount,
                availableCount: generationStatus.syllabusCoverage.availableCount,
                missingCount: generationStatus.syllabusCoverage.missingCount,
                genericCount: generationStatus.syllabusCoverage.genericCount,
                missingCitationCount: Array.isArray(
                  generationStatus.syllabusCoverage.missingCitations,
                )
                  ? generationStatus.syllabusCoverage.missingCitations.length
                  : null,
              }
            : null,
        })}`,
      );
    }
    if (confirmPostCount !== 1 || !capturedConfirmBody) {
      throw new Error(`Expected exactly one guarded confirmation POST, observed ${confirmPostCount}`);
    }
  } finally {
    await page.unroute(confirmRoutePattern, confirmRouteHandler);
  }
  console.log(JSON.stringify({
    confirmationAudit: summary,
    confirmation: {
      postCount: confirmPostCount,
      httpStatus: confirmResponse.status(),
      accepted: true,
      planningJobId: expectedJobId,
      generationJobId,
      learningMapId: expectedMapId,
      durableStatus: generationStatus.job.status,
      request: {
        expectedModel: capturedConfirmBody.expectedModel,
        includedSourceIds: capturedConfirmBody.includedSourceIds,
        syllabusSourceId: capturedConfirmBody.syllabusSourceId,
        sourceOnly: capturedConfirmBody.sourceOnly,
        includeSourceSnapshots: capturedConfirmBody.includeSourceSnapshots,
        skipManualReview: capturedConfirmBody.skipManualReview,
        generate: capturedConfirmBody.generate,
      },
    },
  }, null, 2));
  await browser.close();
  process.exit(0);
}
if (shouldVerifyComplete) {
  assertExpectedCompletion(preStatus, expectedJobId, expectedMapId);
  const versionId = preStatus.latestTextbookVersionId.trim();
  if (!env.QUARTZ_CONTENT_PATH?.trim()) {
    throw new Error("QUARTZ_CONTENT_PATH is unavailable for persisted completion verification");
  }
  const provenance = readCompletionProvenance({
    expectedJobId,
    expectedMapId,
    expectedVersionId: versionId,
    contentPath: env.QUARTZ_CONTENT_PATH,
  });
  if (preStatus.job.sourceSetHash !== provenance.version.source_set_hash) {
    throw new Error("Completed job and exact Learn version have different source-set hashes");
  }
  const learnPanel = page.locator("section.bb-neu-learn-tray").first();
  await learnPanel
    .getByText("Finished generating lessons. The garden has been refreshed.", {
      exact: true,
    })
    .waitFor({ state: "visible" });
  await learnPanel.getByText(versionId, { exact: true }).first().waitFor({ state: "visible" });
  await learnPanel.getByRole("link", { name: "Open lessons", exact: true }).waitFor({
    state: "visible",
  });
  const inventoryBeforeRefresh = await readLessonInventory();
  const lessonArtifactsBeforeRefresh = assertExactLessonInventory(
    inventoryBeforeRefresh,
    provenance.lessons,
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("body").waitFor({ state: "visible" });
  await openLearnPanel();
  const { data: refreshedStatus } = await readLearnStatus();
  assertExpectedCompletion(refreshedStatus, expectedJobId, expectedMapId);
  if (refreshedStatus.latestTextbookVersionId !== versionId) {
    throw new Error(
      `Published version changed across refresh: ${versionId} -> ${refreshedStatus.latestTextbookVersionId ?? "none"}`,
    );
  }
  if (refreshedStatus.job.sourceSetHash !== provenance.version.source_set_hash) {
    throw new Error("Refreshed job and exact Learn version have different source-set hashes");
  }
  const refreshedLearnPanel = page.locator("section.bb-neu-learn-tray").first();
  await refreshedLearnPanel
    .getByText("Finished generating lessons. The garden has been refreshed.", {
      exact: true,
    })
    .waitFor({ state: "visible" });
  await refreshedLearnPanel
    .getByText(versionId, { exact: true })
    .first()
    .waitFor({ state: "visible" });
  const inventoryAfterRefresh = await readLessonInventory();
  const lessonArtifacts = assertExactLessonInventory(
    inventoryAfterRefresh,
    provenance.lessons,
  );
  if (
    JSON.stringify(inventoryAfterRefresh) !== JSON.stringify(inventoryBeforeRefresh)
  ) {
    throw new Error("Learner-page inventory changed across a no-store status refresh");
  }
  if (
    JSON.stringify(lessonArtifacts) !== JSON.stringify(lessonArtifactsBeforeRefresh)
  ) {
    throw new Error("Canonical learner routes changed across refresh");
  }

  const openLessonsLink = refreshedLearnPanel.getByRole("link", {
    name: "Open lessons",
    exact: true,
  });
  const openLessonsHref = await openLessonsLink.getAttribute("href");
  if (openLessonsHref !== `/garden/${gardenId}`) {
    throw new Error(`Open lessons points to ${openLessonsHref ?? "nothing"}`);
  }
  await Promise.all([
    page.waitForURL((url) => url.pathname === `/garden/${gardenId}`),
    openLessonsLink.click(),
  ]);
  const rootFrame = page.locator('iframe[title$=" garden"]').first();
  await rootFrame.waitFor({ state: "visible" });
  const quartzRootSource = await rootFrame.getAttribute("src");
  if (!quartzRootSource) throw new Error("Open lessons did not load the real Quartz frame");

  const httpArtifacts = [];
  for (const lesson of lessonArtifacts) {
    const requestedUrl = quartzArtifactUrl(
      quartzRootSource,
      lesson.fullCanonicalSlug,
    );
    const response = await context.request.get(requestedUrl, {
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok()) {
      throw new Error(`${lesson.relPath} returned HTTP ${response.status()}`);
    }
    const finalHttpPath = decodeURIComponent(new URL(response.url()).pathname)
      .replace(/^\/+|\/+$/g, "");
    if (finalHttpPath !== lesson.fullCanonicalSlug) {
      throw new Error(
        `${lesson.relPath} resolved to ${finalHttpPath}, expected ${lesson.fullCanonicalSlug}`,
      );
    }
    httpArtifacts.push({
      relPath: lesson.relPath,
      status: response.status(),
      finalUrl: response.url(),
    });
  }

  const renderedArtifacts = [];
  for (const [artifactIndex, lesson] of lessonArtifacts.entries()) {
    const artifactUiUrl = `${dashboardBaseUrl}/garden/${encodeURIComponent(gardenId)}?note=${encodeURIComponent(lesson.canonicalSlug)}`;
    await page.goto(artifactUiUrl, { waitUntil: "domcontentloaded" });
    const artifactFrame = page.locator('iframe[title$=" garden"]').first();
    await artifactFrame.waitFor({ state: "visible" });
    const artifactFrameHandle = await artifactFrame.elementHandle();
    if (!artifactFrameHandle) throw new Error(`No Quartz frame handle for ${lesson.relPath}`);
    const contentFrame = await artifactFrameHandle.contentFrame();
    if (!contentFrame) throw new Error(`No Quartz content frame for ${lesson.relPath}`);
    await contentFrame.waitForLoadState("domcontentloaded");
    const artifactBody = contentFrame.locator("body");
    await artifactBody.waitFor({ state: "visible" });
    const finalUrl = contentFrame.url();
    const dataSlug = await artifactBody.getAttribute("data-slug");
    if (!dataSlug) throw new Error(`Quartz body has no data-slug for ${lesson.relPath}`);
    let finalPath;
    try {
      finalPath = decodeURIComponent(new URL(finalUrl).pathname)
        .replace(/^\/+|\/+$/g, "");
    } catch (error) {
      throw new Error(`Quartz final URL is invalid for ${lesson.relPath}: ${sanitizedError(error)}`);
    }
    if (
      finalPath !== lesson.fullCanonicalSlug ||
      dataSlug !== lesson.fullCanonicalSlug
    ) {
      throw new Error(
        `Quartz final URL/body provenance mismatch for ${lesson.relPath}: URL=${finalPath}, body=${dataSlug}, expected=${lesson.fullCanonicalSlug}`,
      );
    }
    const renderedTitle = normalizedUiText(
      await contentFrame.locator("h1.article-title").innerText(),
    );
    if (renderedTitle !== lesson.title) {
      throw new Error(
        `Quartz title is ${JSON.stringify(renderedTitle)}, expected ${JSON.stringify(lesson.title)}`,
      );
    }
    const articleText = normalizedUiText(
      await contentFrame.locator(".center article").innerText(),
    );
    if (articleText.length < 200) {
      throw new Error(`Quartz rendered no substantive lesson article for ${lesson.relPath}`);
    }
    renderedArtifacts.push({
      artifactIndex,
      relPath: lesson.relPath,
      title: renderedTitle,
      finalUrl,
      dataSlug,
    });
  }
  if (renderedArtifacts.length !== lessonArtifacts.length) {
    throw new Error(
      `Rendered ${renderedArtifacts.length} exact lesson artifacts; expected ${lessonArtifacts.length}`,
    );
  }

  console.log(JSON.stringify({
    completionVerification: {
      jobId: expectedJobId,
      learningMapId: expectedMapId,
      versionId,
      durableStatus: refreshedStatus.job.status,
      sourceSetChanged: refreshedStatus.sourceSetChanged,
      lessonCount: inventoryAfterRefresh.length,
      inventoryStableAcrossRefresh: true,
      everyLessonRendered: true,
      provenance: {
        learnVersionTuple: {
          id: provenance.version.id,
          jobId: provenance.version.job_id,
          learningMapId: provenance.version.learning_map_id,
          pageCount: provenance.version.page_count,
        },
        exactLessonSet: true,
        exactLessonVersions: true,
      },
      openLessonsHref,
      httpArtifacts,
      renderedArtifacts,
    },
  }, null, 2));
  await browser.close();
  process.exit(0);
}
if (shouldDiagnoseSelection) {
  await page
    .getByTitle("Choose a syllabus or study guide for Learn to plan against")
    .click();
  const menu = page.locator('[aria-label="Syllabus for Learn"]');
  await menu.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const popover = document.querySelector('[aria-label="Syllabus for Learn"]');
    return (popover?.querySelectorAll('input[name="learn-syllabus"]')?.length ?? 0) > 1;
  }, null, { timeout: 30_000 }).catch(() => null);
  console.log(JSON.stringify({
    menuText: await menu.innerText(),
    labels: await menu.locator("label").allTextContents(),
    radios: await menu.getByRole("radio").evaluateAll((radios) =>
      radios.map((radio) => ({ checked: radio.checked, disabled: radio.disabled })),
    ),
    menuHtml: (await menu.innerHTML()).slice(0, 8000),
    responseEntries,
    consoleEntries,
    requestFailures,
  }, null, 2));
  await browser.close();
  process.exit(0);
}
if (shouldPrepareSelection) {
  const syllabusButton = page.getByTitle(
    "Choose a syllabus or study guide for Learn to plan against",
  );
  await syllabusButton.click();
  const syllabusMenu = page.locator('[aria-label="Syllabus for Learn"]');
  await syllabusMenu.waitFor({ state: "visible" });
  const studyGuideChoice = syllabusMenu
    .locator("label")
    .filter({ hasText: "studyguide-5epf0-source.pdf" })
    .first();
  const studyGuideRadio = studyGuideChoice.getByRole("radio");
  await studyGuideRadio.check();
  if (!(await studyGuideRadio.isChecked())) {
    throw new Error("The Study Guide radio did not remain selected");
  }
  await page
    .getByText("Syllabus: StudyGuide_5EPF0.pdf", { exact: true })
    .waitFor({ state: "visible" });
  await page
    .getByRole("button", { name: /Documents 1\/1/ })
    .waitFor({ state: "visible" });
}
let startResult = null;
let cancelResult = null;
if (shouldStart) {
  const activeStatuses = new Set([
    "planning",
    "generating_learning_pages",
    "generating_textbook",
    "generating_visuals",
    "writing_quartz",
    "building_navigation",
    "analyzing_issues",
    "repairing",
    "revalidating",
    "publishing_repair",
    "paused",
    "awaiting_confirmation",
  ]);
  if (activeStatuses.has(preStatus?.job?.status)) {
    throw new Error(`Refusing duplicate Learn start while ${preStatus.job.status}`);
  }
  if (preStatus?.job?.id !== expectedJobId) {
    throw new Error(
      `Refusing fresh Learn start from ${preStatus?.job?.id ?? "no job"}; expected rolled-back predecessor ${expectedJobId}`,
    );
  }
  if (preStatus.job.model !== expectedModel) {
    throw new Error(
      `Refusing fresh Learn start after unexpected predecessor model ${preStatus.job.model ?? "none"}`,
    );
  }
  const isCancelledPlan =
    preStatus?.job?.status === "cancelled" && preStatus.job.mode === "plan";
  const isRolledBackFailedPlan =
    preStatus?.job?.status === "failed" &&
    preStatus.job.mode === "plan";
  const isRequiredReplanFailure =
    preStatus?.job?.status === "failed" &&
    preStatus.job.requiresReplan === true;
  if (
    (!isCancelledPlan && !isRolledBackFailedPlan && !isRequiredReplanFailure) ||
    preStatus.proposedLearningMap !== null ||
    preStatus.hasTextbook === true ||
    preStatus.latestTextbookVersionId
  ) {
    throw new Error(
      "Refusing Learn start outside a rolled-back planning safe checkpoint",
    );
  }
  if (!gardenNamePreparation?.persistedAcrossReloadAndReopen) {
    throw new Error("Garden-name persistence was not proven before Learn start");
  }
  const freshPlanningUiAudit = await auditFreshPlanningUi(preStatus);

  const { data: clickStatus } = await readLearnStatus();
  if (
    clickStatus?.job?.id !== preStatus.job.id ||
    clickStatus.job.updatedAt !== preStatus.job.updatedAt ||
    clickStatus.job.status !== preStatus.job.status ||
    clickStatus.job.mode !== preStatus.job.mode
  ) {
    throw new Error(
      `Refusing fresh Learn start because the predecessor changed during UI audit: ${JSON.stringify({
        before: {
          id: preStatus.job.id,
          status: preStatus.job.status,
          mode: preStatus.job.mode,
          updatedAt: preStatus.job.updatedAt,
        },
        after: clickStatus?.job
          ? {
              id: clickStatus.job.id,
              status: clickStatus.job.status,
              mode: clickStatus.job.mode,
              updatedAt: clickStatus.job.updatedAt,
            }
          : null,
      })}`,
    );
  }
  const earlierLearnPosts = requestEntries.filter(
    (entry) => entry.method === "POST",
  );
  if (earlierLearnPosts.length > 0) {
    throw new Error(
      `Refusing fresh Learn start because the page already issued Learn POSTs: ${JSON.stringify(earlierLearnPosts)}`,
    );
  }

  let guardedPostCount = 0;
  let capturedPlanBody = null;
  let resolveGuardedRequestFailure;
  const guardedRequestFailure = new Promise((resolve) => {
    resolveGuardedRequestFailure = resolve;
  });
  const learnActionPattern = new RegExp(
    `/api/gardens/${gardenId}/learn(?:/[^/?]+)?(?:\\?.*)?$`,
  );
  const guardedPlanRoute = async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    guardedPostCount += 1;
    const endpoint = new URL(request.url()).pathname;
    let body = null;
    try {
      body = request.postDataJSON();
    } catch {
      // The closed-schema check below rejects missing or non-JSON bodies.
    }
    const expectedKeys = [
      "includeSourceSnapshots",
      "includedSourceIds",
      "skipManualReview",
      "sourceOnly",
      "syllabusSourceId",
    ].sort();
    const actualKeys =
      body && typeof body === "object" && !Array.isArray(body)
        ? Object.keys(body).sort()
        : [];
    const expectedEndpoint = `/api/gardens/${gardenId}/learn/plan`;
    const issue =
      guardedPostCount !== 1
        ? `Unexpected Learn mutation ${guardedPostCount}: ${endpoint}`
        : endpoint !== expectedEndpoint
          ? `Expected one direct planning recovery, got ${endpoint}`
          : !sameOrderedStrings(actualKeys, expectedKeys)
            ? `Learn planning body is not closed-schema: ${JSON.stringify(actualKeys)}`
            : !sameOrderedStrings(
                  body?.includedSourceIds,
                  expectedTeachingSourceIds,
                )
              ? `Unexpected teaching-source payload: ${JSON.stringify(body?.includedSourceIds ?? null)}`
              : body?.syllabusSourceId !== expectedSyllabusSourceId
                ? `Unexpected syllabus payload: ${JSON.stringify(body?.syllabusSourceId ?? null)}`
                : body?.sourceOnly !== true ||
                    body?.includeSourceSnapshots !== false ||
                    body?.skipManualReview !== false
                  ? `Unexpected Learn planning flags: ${JSON.stringify(body)}`
                  : null;
    if (issue) {
      resolveGuardedRequestFailure(new Error(issue));
      await route.abort("blockedbyclient");
      return;
    }
    capturedPlanBody = body;
    await route.continue();
  };
  await page.route(learnActionPattern, guardedPlanRoute);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/api/gardens/${gardenId}/learn/plan`,
    {
      // A cold development route compile plus the worker's heavy-module import
      // can legitimately precede its durable receipt. The production UI does
      // not impose a shorter timeout, so align this harness with the 3-minute
      // worker startup contract and leave one minute for route compilation.
      timeout: 4 * 60_000,
    },
  );
  let acceptedPlanResponseSeen = false;
  const postPlanUiStatusResponsePromise = page.waitForResponse(
    (candidate) => {
      const request = candidate.request();
      const pathname = new URL(candidate.url()).pathname;
      if (
        request.method() === "POST" &&
        pathname === `/api/gardens/${gardenId}/learn/plan`
      ) {
        acceptedPlanResponseSeen = candidate.status() === 202;
        return false;
      }
      return (
        acceptedPlanResponseSeen &&
        request.method() === "GET" &&
        pathname === `/api/gardens/${gardenId}/learn/status`
      );
    },
    { timeout: 5 * 60_000 },
  );
  const learnPanel = page.locator("section.bb-neu-learn-tray").first();
  const startButton = learnPanel.getByRole("button", {
    name: "Restart planning",
    exact: true,
  });
  await startButton.waitFor({ state: "visible" });
  if (!(await startButton.isEnabled())) {
    throw new Error("Refusing fresh Learn start because Restart planning is disabled");
  }
  await startButton.click();
  const guardedOutcome = await Promise.race([
    responsePromise.then((response) => ({ response })),
    guardedRequestFailure.then((error) => ({ error })),
  ]);
  if (guardedOutcome.error) throw guardedOutcome.error;
  const response = guardedOutcome.response;
  const data = await response.json().catch(() => ({}));
  if (
    response.status() !== 202 ||
    data?.accepted !== true ||
    typeof data?.jobId !== "string" ||
    !data.jobId.trim() ||
    data.jobId === expectedJobId
  ) {
    throw new Error(`Learn start was not accepted: HTTP ${response.status()} ${JSON.stringify(data)}`);
  }
  const postPlanUiStatusResponse = await postPlanUiStatusResponsePromise;
  if (!postPlanUiStatusResponse.ok()) {
    throw new Error(
      `Post-plan UI status refresh failed: HTTP ${postPlanUiStatusResponse.status()}`,
    );
  }
  // The UI consumes the accepted response and performs its own status refresh.
  // Read the same durable status before counting so any accidental follow-up
  // mutation dispatched by that response handler is also seen by the route
  // guard instead of escaping between the response and this proof.
  const { data: postStatus } = await readLearnStatus();
  if (
    postStatus?.job?.id !== data.jobId ||
    postStatus.job.id === expectedJobId ||
    postStatus.job.mode !== "plan" ||
    postStatus.job.model !== expectedModel ||
    !sameOrderedStrings(postStatus.job.sourceIds, expectedTeachingSourceIds) ||
    postStatus.job.syllabusSourceId !== expectedSyllabusSourceId ||
    postStatus.job.sourceOnly !== true ||
    postStatus.job.includeSourceSnapshots !== false
  ) {
    throw new Error(
      `Fresh planning durable binding mismatch: ${JSON.stringify(postStatus?.job ?? null)}`,
    );
  }
  const learnPosts = requestEntries.filter((entry) => entry.method === "POST");
  if (
    guardedPostCount !== 1 ||
    learnPosts.length !== 1 ||
    learnPosts[0].path !== `/api/gardens/${gardenId}/learn/plan`
  ) {
    throw new Error(
      `Expected exactly one direct Learn plan POST: ${JSON.stringify({ guardedPostCount, learnPosts })}`,
    );
  }
  startResult = {
    endpoint: new URL(response.url()).pathname,
    request: capturedPlanBody,
    httpStatus: response.status(),
    accepted: data.accepted,
    predecessorJobId: expectedJobId,
    job: {
      id: data.jobId,
      status: postStatus.job.status,
      mode: postStatus.job.mode,
      model: postStatus.job.model,
      sourceIds: postStatus.job.sourceIds,
      syllabusSourceId: postStatus.job.syllabusSourceId,
    },
    exactlyOneLearnPost: true,
    learnPosts,
    gardenNamePreparation,
    freshPlanningUiAudit,
  };
}
if (shouldCancel) {
  if (preStatus?.job?.id !== expectedJobId) {
    throw new Error(`Refusing to cancel unexpected Learn job ${preStatus?.job?.id ?? "none"}`);
  }
  if (preStatus.job.status !== "planning" || preStatus.job.mode !== "plan") {
    throw new Error(`Refusing to cancel Learn job in ${preStatus.job.status}/${preStatus.job.mode}`);
  }
  if (preStatus.job.model !== "gpt-5.6-sol") {
    throw new Error(`Refusing to cancel unexpected model ${preStatus.job.model ?? "none"}`);
  }
  const cancelUrl = `${dashboardBaseUrl}/api/gardens/electromagnetism-1/learn/cancel`;
  const response = await context.request.post(cancelUrl, {
    data: { expectedJobId: preStatus.job.id },
  });
  const data = await response.json().catch(() => ({}));
  if (response.status() !== 200 || data?.success !== true || data?.job?.id !== preStatus.job.id) {
    throw new Error(`Learn cancellation was not accepted: HTTP ${response.status()} ${JSON.stringify(data)}`);
  }
  cancelResult = {
    endpoint: new URL(response.url()).pathname,
    request: { expectedJobId: preStatus.job.id },
    httpStatus: response.status(),
    success: data.success,
    job: {
      id: data.job.id,
      status: data.job.status,
      currentStep: data.job.currentStep,
    },
  };
}
if (shouldCancelActiveGeneration) {
  if (preStatus?.job?.id !== expectedJobId) {
    throw new Error(`Refusing to cancel unexpected Learn job ${preStatus?.job?.id ?? "none"}`);
  }
  if (preStatus.job.mode !== "generate" || ![
    "generating_learning_pages",
    "generating_textbook",
    "generating_visuals",
    "writing_quartz",
    "building_navigation",
  ].includes(preStatus.job.status)) {
    throw new Error(`Refusing to cancel Learn job in ${preStatus.job.status}/${preStatus.job.mode}`);
  }
  if (preStatus.job.confirmedLearningMapId !== expectedMapId) {
    throw new Error(
      `Refusing to cancel unexpected learning map ${preStatus.job.confirmedLearningMapId ?? "none"}`,
    );
  }
  if (preStatus.job.model !== expectedModelArgument) {
    throw new Error(`Refusing to cancel unexpected model ${preStatus.job.model ?? "none"}`);
  }
  const cancelUrl = `${dashboardBaseUrl}/api/gardens/electromagnetism-1/learn/cancel`;
  const response = await context.request.post(cancelUrl, {
    data: { expectedJobId: preStatus.job.id },
  });
  const data = await response.json().catch(() => ({}));
  if (response.status() !== 200 || data?.success !== true || data?.job?.id !== preStatus.job.id) {
    throw new Error(`Learn cancellation was not accepted: HTTP ${response.status()} ${JSON.stringify(data)}`);
  }
  cancelResult = {
    endpoint: new URL(response.url()).pathname,
    request: { expectedJobId: preStatus.job.id },
    httpStatus: response.status(),
    success: data.success,
    job: {
      id: data.job.id,
      status: data.job.status,
      currentStep: data.job.currentStep,
    },
  };
}
if (startResult || cancelResult) {
  console.log(JSON.stringify({
    session: {
      status: acceptedSessionStatus,
      authenticated: Boolean(acceptedSession?.user),
      userId: acceptedSession?.user?.id ?? null,
      bootstrap: desktopConfig ? "desktop-persistent-user-1" : "env-signed-user-1",
    },
    preLearnState: {
      job: preStatus?.job ? {
        id: preStatus.job.id,
        status: preStatus.job.status,
        mode: preStatus.job.mode,
        proposedLearningMapId: preStatus.job.proposedLearningMapId ?? null,
      } : null,
      selectedSourceIds: preStatus?.selectedSourceIds ?? null,
      syllabusSourceId: preStatus?.syllabusSourceId ?? null,
    },
    startResult,
    cancelResult,
  }, null, 2));
  await browser.close();
  process.exit(0);
}
console.log(JSON.stringify({
  url: page.url(),
  title: await page.title(),
  session: {
    status: acceptedSessionStatus,
    authenticated: Boolean(acceptedSession?.user),
    userId: acceptedSession?.user?.id ?? null,
    bootstrap: desktopConfig ? "desktop-persistent-user-1" : "env-signed-user-1",
  },
  preLearnState: {
    httpStatus: preStatusResponse.status(),
    job: preStatus?.job ? {
      id: preStatus.job.id,
      status: preStatus.job.status,
      mode: preStatus.job.mode,
      progressPercent: preStatus.job.progressPercent,
      proposedLearningMapId: preStatus.job.proposedLearningMapId ?? null,
    } : null,
    selectedSourceIds: preStatus?.selectedSourceIds ?? null,
    syllabusSourceId: preStatus?.syllabusSourceId ?? null,
    confirmedLearningMapId: preStatus?.confirmedLearningMapId ?? null,
  },
  startResult,
  cancelResult,
  primaryGenerateButton: await page.getByRole("button", { name: /^(Retry Learn|Restart planning|Generate)$/, exact: true }).evaluate((button) => ({
    disabled: button.disabled,
    ariaDisabled: button.getAttribute("aria-disabled"),
    title: button.getAttribute("title"),
    outerHTML: button.outerHTML.slice(0, 1200),
  })).catch(() => null),
  headings: (await page.getByRole("heading").allTextContents()).slice(0, 30),
  buttons: (await page.getByRole("button").allTextContents()).slice(0, 50),
  links: (await page.getByRole("link").evaluateAll((links) => links.slice(0, 50).map((link) => ({ text: link.textContent?.trim() ?? "", href: link.getAttribute("href") })))).slice(0, 50),
  body: (await page.locator("body").innerText()).slice(0, 5000),
  consoleEntries: consoleEntries.slice(0, 30),
  requestFailures: requestFailures.slice(0, 30),
}, null, 2));
await browser.close();
