#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dashboardDir = path.resolve(scriptDir, "..");
const repositoryDir = path.resolve(dashboardDir, "..");

function argument(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function frontmatterDocument(markdown) {
  const match = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n)/.exec(markdown);
  if (!match) throw new Error("Source Markdown has no YAML frontmatter.");
  return {
    prefix: match[1],
    header: match[2],
    suffix: match[3],
    body: markdown.slice(match[0].length),
    newline: match[1].includes("\r\n") ? "\r\n" : "\n",
  };
}

function scalarField(header, key) {
  const match = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(header);
  if (!match) return "";
  const raw = match[1].trim();
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

function setScalarField(header, key, value, newline) {
  const line = `${key}: ${JSON.stringify(value)}`;
  const field = new RegExp(`^${key}:.*$`, "m");
  return field.test(header)
    ? header.replace(field, line)
    : `${header}${header.endsWith(newline) ? "" : newline}${line}`;
}

function writeAtomic(filePath, contents) {
  const temporary = `${filePath}.pending-media-backfill-${process.pid}`;
  fs.writeFileSync(temporary, contents, "utf8");
  fs.renameSync(temporary, filePath);
}

async function ensureAsset(sourcePath, targetPath, expectedHash) {
  if ((await sha256File(sourcePath)) !== expectedHash) {
    throw new Error(`Integrity mismatch for ${path.basename(sourcePath)}`);
  }
  if (fs.existsSync(targetPath)) {
    if ((await sha256File(targetPath)) !== expectedHash) {
      throw new Error(`Existing media asset has the wrong hash: ${targetPath}`);
    }
    return false;
  }

  const temporary = `${targetPath}.pending-${process.pid}`;
  try {
    fs.copyFileSync(sourcePath, temporary, fs.constants.COPYFILE_EXCL);
    if ((await sha256File(temporary)) !== expectedHash) {
      throw new Error(`Copied media failed verification: ${targetPath}`);
    }
    fs.renameSync(temporary, targetPath);
    return true;
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

const gardenSlug = argument("garden");
const sourceDirectory = path.resolve(argument("source-dir"));
const contentPath = path.resolve(
  argument("content-path", path.join(repositoryDir, "quartz", "content")),
);
const databasePath = path.resolve(
  argument("database", path.join(dashboardDir, "db", "brain.db")),
);

if (!gardenSlug || !argument("source-dir")) {
  throw new Error(
    "Usage: backfill-garden-media.mjs --garden <slug> --source-dir <directory>",
  );
}
if (!fs.statSync(sourceDirectory, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error(`Media source directory does not exist: ${sourceDirectory}`);
}

const gardenDirectory = path.resolve(contentPath, gardenSlug);
if (!inside(contentPath, gardenDirectory)) {
  throw new Error("Garden path escapes the configured content directory.");
}
const assetsDirectory = path.join(gardenDirectory, "assets");
fs.mkdirSync(assetsDirectory, { recursive: true });

const database = new Database(databasePath, { readonly: true });
const rows = database
  .prepare(
    `SELECT j.original_filename, j.media_sha256, j.output_relative_path,
            j.source_slug
       FROM video_transcription_jobs AS j
       JOIN clusters AS c ON c.id = j.cluster_id
      WHERE c.slug = ?
        AND j.status = 'completed'
        AND j.input_kind = 'upload'
        AND j.original_filename IS NOT NULL
        AND j.media_sha256 IS NOT NULL
        AND j.output_relative_path IS NOT NULL
        AND j.source_slug IS NOT NULL
      ORDER BY j.created_at ASC`,
  )
  .all(gardenSlug);
database.close();

let copied = 0;
let updated = 0;
for (const row of rows) {
  const originalFilename = path.basename(row.original_filename);
  const sourcePath = path.resolve(sourceDirectory, originalFilename);
  if (!inside(sourceDirectory, sourcePath)) {
    throw new Error(`Media source escapes its directory: ${originalFilename}`);
  }
  if (!fs.statSync(sourcePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Original media is missing: ${sourcePath}`);
  }

  const extension = path.extname(originalFilename).toLowerCase();
  const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : ".bin";
  const assetName = `${row.source_slug}-media-${row.media_sha256.slice(0, 12)}${safeExtension}`;
  const assetPath = path.join(assetsDirectory, assetName);
  if (await ensureAsset(sourcePath, assetPath, row.media_sha256)) copied += 1;

  const markdownPath = path.resolve(gardenDirectory, row.output_relative_path);
  if (!inside(gardenDirectory, markdownPath)) {
    throw new Error(`Transcript path escapes its Garden: ${row.output_relative_path}`);
  }
  const markdown = fs.readFileSync(markdownPath, "utf8");
  const parsed = frontmatterDocument(markdown);
  const previousTitle = scalarField(parsed.header, "title");
  const previousDescription = scalarField(parsed.header, "description");
  const description =
    previousDescription && previousDescription !== originalFilename
      ? previousDescription
      : previousTitle && previousTitle !== originalFilename
        ? previousTitle
        : `Transcript of ${originalFilename}`;
  const mediaUrl = `/${gardenSlug}/assets/${assetName}`;
  let header = setScalarField(
    parsed.header,
    "title",
    originalFilename,
    parsed.newline,
  );
  header = setScalarField(header, "description", description, parsed.newline);
  header = setScalarField(header, "source_media", mediaUrl, parsed.newline);
  const next = `${parsed.prefix}${header}${parsed.suffix}${parsed.body}`;
  if (next !== markdown) {
    writeAtomic(markdownPath, next);
    updated += 1;
  }
  process.stdout.write(`retained ${originalFilename}\n`);
}

process.stdout.write(
  `Backfill complete: ${rows.length} recordings, ${copied} assets copied, ${updated} transcripts updated.\n`,
);
