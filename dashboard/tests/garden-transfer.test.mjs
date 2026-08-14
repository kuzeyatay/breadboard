import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";
import AdmZip from "adm-zip";

import {
  ENVELOPE_ENTRY,
  GARDEN_CONTENT_PREFIX,
  TRANSFER_ACCEPT,
  TRANSFER_FILE_FORMATS,
  TRANSFER_FORMAT_VERSION,
  TransferError,
  gardenExportSkipReason,
  isSafeArchivePath,
  normalizeArchivePath,
  parseClusterManifest,
  parseEnvelope,
  parseGardenManifest,
  transferFileName,
  transferKindForFilename,
} from "../src/lib/garden-transfer/format.ts";
import {
  addJsonEntry,
  createBudget,
  openArchive,
  packDirectory,
  readJsonEntry,
  unpackPrefix,
} from "../src/lib/garden-transfer/archive.ts";

const temporaries = [];

function tempDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bb-${name}-`));
  temporaries.push(dir);
  return dir;
}

after(() => {
  for (const dir of temporaries) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeFile(root, relPath, contents) {
  const target = path.join(root, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

/** A garden with content worth keeping and scratch worth dropping. */
function makeGarden() {
  const dir = tempDir("garden");
  writeFile(dir, "_index.md", "---\ntitle: Signals\n---\n");
  writeFile(dir, "learning/1. sampling.md", "# Sampling\n");
  writeFile(dir, "assets/diagram.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFile(dir, ".breadboard/source-anchors.json", "{}\n");
  writeFile(dir, ".breadboard/backups/learning_1/old.md", "stale\n");
  writeFile(dir, ".breadboard/learn-run-snapshots/run/a.md", "stale\n");
  writeFile(dir, "node_modules/pkg/index.js", "module.exports = 1\n");
  return dir;
}

describe("the two file types", () => {
  test("each declares an extension, a mime type and an envelope", () => {
    assert.equal(TRANSFER_FILE_FORMATS.garden.extension, ".garden");
    assert.equal(TRANSFER_FILE_FORMATS.cluster.extension, ".cluster");
    assert.equal(
      TRANSFER_FILE_FORMATS.garden.mimeType,
      "application/vnd.breadboard.garden+zip",
    );
    assert.equal(TRANSFER_ACCEPT, ".garden,.cluster");
  });

  test("a filename routes to its kind, and anything else to none", () => {
    assert.equal(transferKindForFilename("signals.garden"), "garden");
    assert.equal(transferKindForFilename("EE Year 1.CLUSTER"), "cluster");
    assert.equal(transferKindForFilename("notes.zip"), null);
    assert.equal(transferKindForFilename(""), null);
    assert.equal(transferKindForFilename(null), null);
  });

  test("download names are slugified and carry the extension", () => {
    assert.equal(transferFileName("garden", "Signals & Systems"), "signals-systems.garden");
    assert.equal(transferFileName("cluster", "EE Year 1"), "ee-year-1.cluster");
    assert.equal(transferFileName("garden", "///"), "garden.garden");
  });
});

describe("archive paths", () => {
  test("separators normalize without changing meaning", () => {
    assert.equal(normalizeArchivePath("content\\a\\b.md"), "content/a/b.md");
    assert.equal(normalizeArchivePath("content//a.md"), "content/a.md");
    assert.equal(normalizeArchivePath("/content/a.md"), "content/a.md");
  });

  test("anything that could escape the target is refused", () => {
    assert.ok(isSafeArchivePath("content/notes/a.md"));
    assert.ok(!isSafeArchivePath("../evil.md"));
    assert.ok(!isSafeArchivePath("content/../../evil.md"));
    assert.ok(!isSafeArchivePath("/etc/passwd"));
    assert.ok(!isSafeArchivePath("C:\\Windows\\system32"));
    assert.ok(!isSafeArchivePath("a\0b"));
    assert.ok(!isSafeArchivePath(""));
  });
});

describe("what a garden export carries", () => {
  test("content is kept and rebuild scratch is dropped", () => {
    assert.equal(gardenExportSkipReason("_index.md"), null);
    assert.equal(gardenExportSkipReason("learning/1. sampling.md"), null);
    assert.equal(gardenExportSkipReason(".breadboard/source-anchors.json"), null);
    assert.equal(gardenExportSkipReason("node_modules/pkg/index.js"), "disposable");
    assert.equal(gardenExportSkipReason(".breadboard/backups/x/old.md"), "disposable");
    assert.equal(
      gardenExportSkipReason(".breadboard/learn-run-snapshots/run/a.md"),
      "disposable",
    );
  });

  test("a directory named like a skipped one deeper down is still kept", () => {
    assert.equal(gardenExportSkipReason("assets/backups/photo.png"), null);
    assert.equal(gardenExportSkipReason("learning/node_modules"), null);
  });
});

describe("packing and unpacking a garden", () => {
  test("a round trip reproduces the content and leaves the scratch behind", () => {
    const source = makeGarden();
    const zip = new AdmZip();
    const summary = packDirectory(
      zip,
      source,
      GARDEN_CONTENT_PREFIX,
      createBudget(),
      gardenExportSkipReason,
    );

    assert.equal(summary.files, 4);
    assert.ok(summary.bytes > 0);
    assert.deepEqual(
      summary.skipped.map((entry) => entry.path).sort(),
      [".breadboard/backups", ".breadboard/learn-run-snapshots", "node_modules"],
    );

    const target = tempDir("restored");
    const written = unpackPrefix(openArchive(zip.toBuffer()), GARDEN_CONTENT_PREFIX, target);

    assert.equal(written.files, 4);
    assert.equal(
      fs.readFileSync(path.join(target, "learning/1. sampling.md"), "utf-8"),
      "# Sampling\n",
    );
    assert.equal(fs.readFileSync(path.join(target, ".breadboard/source-anchors.json"), "utf-8"), "{}\n");
    assert.ok(fs.existsSync(path.join(target, "assets/diagram.png")));
    assert.ok(!fs.existsSync(path.join(target, ".breadboard/backups")));
    assert.ok(!fs.existsSync(path.join(target, "node_modules")));
  });

  test("an empty garden still produces a readable archive", () => {
    const zip = new AdmZip();
    const summary = packDirectory(
      zip,
      tempDir("empty"),
      GARDEN_CONTENT_PREFIX,
      createBudget(),
      gardenExportSkipReason,
    );
    assert.equal(summary.files, 0);

    const target = tempDir("empty-restored");
    assert.deepEqual(
      unpackPrefix(openArchive(zip.toBuffer()), GARDEN_CONTENT_PREFIX, target),
      { files: 0, bytes: 0 },
    );
  });

  test("entries outside the prefix are ignored", () => {
    const zip = new AdmZip();
    zip.addFile("content/keep.md", Buffer.from("keep"));
    zip.addFile("gardens/other/content/skip.md", Buffer.from("skip"));

    const target = tempDir("prefixed");
    assert.equal(unpackPrefix(zip, GARDEN_CONTENT_PREFIX, target).files, 1);
    assert.ok(fs.existsSync(path.join(target, "keep.md")));
    assert.ok(!fs.existsSync(path.join(target, "skip.md")));
  });

  test("a traversing entry aborts the extraction instead of writing", () => {
    const target = tempDir("slip");
    const escaped = path.join(target, "..", "bb-slip-escaped.txt");
    // adm-zip canonicalizes `..` on write, so the hostile archive is presented
    // the way a hand-built one would arrive.
    const hostile = {
      getEntries: () => [
        {
          entryName: "content/../../bb-slip-escaped.txt",
          isDirectory: false,
          getData: () => Buffer.from("escaped"),
        },
      ],
    };

    assert.throws(
      () => unpackPrefix(hostile, GARDEN_CONTENT_PREFIX, target),
      (error) => error instanceof TransferError && /unsafe path/.test(error.message),
    );
    assert.ok(!fs.existsSync(escaped));
  });
});

describe("reading manifests back", () => {
  function envelopeFor(kind, overrides = {}) {
    const zip = new AdmZip();
    addJsonEntry(zip, ENVELOPE_ENTRY, {
      format: TRANSFER_FILE_FORMATS[kind]?.envelope ?? kind,
      version: TRANSFER_FORMAT_VERSION,
      exportedAt: "2026-08-13T00:00:00.000Z",
      generator: "Breadboard",
      omitted: [],
      ...overrides,
    });
    return readJsonEntry(openArchive(zip.toBuffer()), ENVELOPE_ENTRY);
  }

  test("both envelopes identify their kind", () => {
    assert.equal(parseEnvelope(envelopeFor("garden")).kind, "garden");
    assert.equal(parseEnvelope(envelopeFor("cluster")).kind, "cluster");
  });

  test("a foreign or future file is refused, not guessed at", () => {
    assert.throws(() => parseEnvelope(envelopeFor("something-else")), TransferError);
    assert.throws(
      () => parseEnvelope(envelopeFor("garden", { version: TRANSFER_FORMAT_VERSION + 1 })),
      /newer version of Breadboard/,
    );
    assert.throws(() => parseEnvelope(null), TransferError);
  });

  test("a missing entry reads as a malformed file rather than a crash", () => {
    assert.throws(
      () => readJsonEntry(new AdmZip(), ENVELOPE_ENTRY),
      /missing its breadboard.json/,
    );
    assert.throws(() => openArchive(Buffer.from("not a zip")), TransferError);
  });

  test("a garden manifest fills its own defaults and insists on a name", () => {
    const manifest = parseGardenManifest({ name: "Signals", folder: "EE/Year 1" });
    assert.equal(manifest.visibility, "private");
    assert.equal(manifest.borderColor, "#a9c1b1");
    assert.equal(manifest.cardWidth, 392);
    assert.equal(manifest.chatAccessible, false);
    assert.equal(manifest.folder, "EE/Year 1");
    assert.throws(() => parseGardenManifest({ name: "   " }), /no garden name/);
  });

  test("a cluster manifest drops garden entries with an unsafe directory", () => {
    const manifest = parseClusterManifest({
      path: "EE/Year 1",
      label: "Year 1",
      folders: ["", "Semester 2"],
      gardens: [
        { directory: "signals", folder: "" },
        { directory: "../escape", folder: "" },
        { directory: "", folder: "Semester 2" },
        "nonsense",
      ],
    });
    assert.deepEqual(
      manifest.gardens.map((entry) => entry.directory),
      ["signals"],
    );
    assert.deepEqual(manifest.folders, ["", "Semester 2"]);
  });
});
