/**
 * The two portable file types: `.garden` and `.cluster`.
 *
 * Both are ZIP containers holding a JSON envelope, one or more manifests, and
 * the garden directories themselves. A `.garden` carries exactly one garden; a
 * `.cluster` carries a cluster path, the clusters nested under it, and every
 * garden filed anywhere inside — which is the same thing the dashboard tree
 * shows under a folder row.
 *
 * What travels is a garden's *identity and its content*: the `clusters` row's
 * own columns plus the directory under QUARTZ_CONTENT_PATH. Per-install runtime
 * state (chat sessions, Learn job history, proposals, artifacts) deliberately
 * does not — see OMITTED_STATE. That is the same line `forkCluster` already
 * draws, and it is what makes an import safe to run against a database that has
 * never seen the source machine.
 *
 * This module is pure: no fs, no db, no Next. Everything that can be decided
 * from a path or a manifest is decided here so it stays directly testable.
 */

export const TRANSFER_FORMAT_VERSION = 1;

/** Entry names inside the archive. */
export const ENVELOPE_ENTRY = "breadboard.json";
export const GARDEN_MANIFEST_ENTRY = "garden.json";
export const CLUSTER_MANIFEST_ENTRY = "cluster.json";
export const GARDEN_CONTENT_PREFIX = "content/";
export const CLUSTER_GARDENS_PREFIX = "gardens/";

export type TransferKind = "garden" | "cluster";

export interface TransferFormatDescriptor {
  kind: TransferKind;
  /** File extension, leading dot included. */
  extension: string;
  mimeType: string;
  label: string;
  /** The `format` string stamped into the envelope. */
  envelope: string;
  /** The manifest entry a well-formed archive of this kind must contain. */
  manifestEntry: string;
  summary: string;
}

/**
 * The registry both halves read from, shaped like the other attachment
 * registries in `src/lib` so a caller never has to hardcode an extension.
 */
export const TRANSFER_FILE_FORMATS: Record<
  TransferKind,
  TransferFormatDescriptor
> = {
  garden: {
    kind: "garden",
    extension: ".garden",
    mimeType: "application/vnd.breadboard.garden+zip",
    label: "Breadboard garden",
    envelope: "breadboard.garden",
    manifestEntry: GARDEN_MANIFEST_ENTRY,
    summary: "One garden: its settings and every note, asset and folder in it.",
  },
  cluster: {
    kind: "cluster",
    extension: ".cluster",
    mimeType: "application/vnd.breadboard.cluster+zip",
    label: "Breadboard cluster",
    envelope: "breadboard.cluster",
    manifestEntry: CLUSTER_MANIFEST_ENTRY,
    summary:
      "A cluster: the clusters nested inside it and every garden filed in them.",
  },
};

export const TRANSFER_EXTENSIONS: string[] = Object.values(
  TRANSFER_FILE_FORMATS,
).map((format) => format.extension);

/** For an `<input type="file">` accept attribute. */
export const TRANSFER_ACCEPT: string = TRANSFER_EXTENSIONS.join(",");

/** Matches either extension, so a drop handler can route a file without opening it. */
export const TRANSFER_FILE_RE = /\.(garden|cluster)$/i;

/** State that is intentionally left behind, reported in the envelope. */
export const OMITTED_STATE: string[] = [
  "chat sessions and messages",
  "Learn job history and versions",
  "agent proposals and audit events",
  "artifacts and CAD projects",
  "view counts",
];

export function transferKindForFilename(
  fileName: string | null | undefined,
): TransferKind | null {
  const match = TRANSFER_FILE_RE.exec((fileName ?? "").trim());
  if (!match) return null;
  return match[1].toLowerCase() as TransferKind;
}

/** A failure with the HTTP shape the transfer routes return. */
export class TransferError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "TransferError";
    this.status = status;
  }
}

/* -------------------------------------------------------------------------- */
/* Manifests                                                                   */
/* -------------------------------------------------------------------------- */

export interface TransferEnvelope {
  format: string;
  version: number;
  exportedAt: string;
  generator: string;
  /** Named so an importer can say what it is dropping on the floor. */
  omitted: string[];
}

export type TransferSkipReason = "disposable" | "symlink" | "unreadable";

export interface TransferSkip {
  path: string;
  reason: TransferSkipReason;
}

export interface GardenContentSummary {
  files: number;
  bytes: number;
  skipped: TransferSkip[];
}

/** One garden's `clusters` row, minus everything install-local. */
export interface GardenManifest {
  /** The slug it had where it was exported; a hint only, never reused as-is. */
  slug: string;
  name: string;
  description: string;
  visibility: "private" | "public";
  borderColor: string;
  cardWidth: number;
  cardHeight: number;
  chatAccessible: boolean;
  forkAllowed: boolean;
  /** Cluster path it was filed under, relative to the archive's root. */
  folder: string;
  createdAt: string;
  content: GardenContentSummary;
}

export interface ClusterGardenEntry {
  /** Directory under `gardens/` holding this garden's manifest and content. */
  directory: string;
  /** Cluster path relative to the exported root ("" means the root itself). */
  folder: string;
}

export interface ClusterManifest {
  /** The exported cluster's own path on the source install. */
  path: string;
  label: string;
  /** Every cluster in the subtree, relative to `path`; "" is the root itself. */
  folders: string[];
  gardens: ClusterGardenEntry[];
}

/**
 * What an import did. Declared here rather than beside the importer so the
 * browser can name the type without pulling the server module in behind it.
 */
export interface ImportedGarden {
  slug: string;
  name: string;
  folder: string | null;
  files: number;
  bytes: number;
}

export interface TransferImportResult {
  kind: TransferKind;
  /** For a cluster import, the path it landed at. */
  clusterPath: string | null;
  gardens: ImportedGarden[];
  exportedAt: string;
  /** What the archive says it left behind, so the UI can repeat it. */
  omitted: string[];
}

/* -------------------------------------------------------------------------- */
/* Archive paths                                                               */
/* -------------------------------------------------------------------------- */

/** Windows separators and duplicate slashes collapse; nothing else changes. */
export function normalizeArchivePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+/, "");
}

/**
 * Reject anything that could escape the directory it is extracted into: an
 * absolute path, a drive letter, a `..` segment, or a NUL byte.
 */
export function isSafeArchivePath(value: string): boolean {
  const normalized = normalizeArchivePath(value);
  if (!normalized || normalized.includes("\0")) return false;
  if (/^[a-zA-Z]:/.test(value) || value.startsWith("/") || value.startsWith("\\")) {
    return false;
  }
  return normalized
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/* -------------------------------------------------------------------------- */
/* What a garden export carries                                                */
/* -------------------------------------------------------------------------- */

export const BREADBOARD_STATE_DIR = ".breadboard";

/** Build scratch and version control: never anyone's content. */
export const EXCLUDED_TOP_LEVEL: Set<string> = new Set([
  "node_modules",
  ".git",
  ".tmp",
  ".previous-builds",
]);

/**
 * `.breadboard/` holds both the garden's durable analysis state (small JSON the
 * garden needs to keep working) and its rebuild scratch (whole copies of the
 * garden, repeatedly). The scratch is what would make a `.garden` file ten
 * times larger than the garden.
 */
export const EXCLUDED_BREADBOARD_ENTRIES: Set<string> = new Set([
  "backups",
  "learn-run-snapshots",
  "canonical-shadow",
  "quarantine",
  ".previous-builds",
]);

/** Non-null when this path should be left out of the archive, and why. */
export function gardenExportSkipReason(
  relPath: string,
): TransferSkipReason | null {
  const segments = normalizeArchivePath(relPath).split("/").filter(Boolean);
  if (!segments.length) return null;
  if (EXCLUDED_TOP_LEVEL.has(segments[0])) return "disposable";
  if (
    segments[0] === BREADBOARD_STATE_DIR &&
    segments.length > 1 &&
    EXCLUDED_BREADBOARD_ENTRIES.has(segments[1])
  ) {
    return "disposable";
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Names                                                                       */
/* -------------------------------------------------------------------------- */

/** The download filename for an export, extension included. */
export function transferFileName(kind: TransferKind, label: string): string {
  const base =
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || kind;
  return `${base}${TRANSFER_FILE_FORMATS[kind].extension}`;
}

/* -------------------------------------------------------------------------- */
/* Reading a manifest back                                                     */
/* -------------------------------------------------------------------------- */

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TransferError(`This file's ${what} is missing or malformed.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Validate the envelope and report which of the two file types this is. A
 * version from the future is refused rather than guessed at.
 */
export function parseEnvelope(raw: unknown): {
  kind: TransferKind;
  envelope: TransferEnvelope;
} {
  const record = asRecord(raw, ENVELOPE_ENTRY);
  const format = asString(record.format);
  const kind = (Object.keys(TRANSFER_FILE_FORMATS) as TransferKind[]).find(
    (candidate) => TRANSFER_FILE_FORMATS[candidate].envelope === format,
  );
  if (!kind) {
    throw new TransferError(
      "This is not a Breadboard garden or cluster file.",
      415,
    );
  }

  const version = asNumber(record.version, 0);
  if (version < 1 || !Number.isInteger(version)) {
    throw new TransferError("This file's version is missing or malformed.");
  }
  if (version > TRANSFER_FORMAT_VERSION) {
    throw new TransferError(
      `This ${TRANSFER_FILE_FORMATS[kind].label} file was written by a newer version of Breadboard (format ${version}). Update before importing it.`,
    );
  }

  return {
    kind,
    envelope: {
      format,
      version,
      exportedAt: asString(record.exportedAt),
      generator: asString(record.generator),
      omitted: asStringArray(record.omitted),
    },
  };
}

export function parseGardenManifest(raw: unknown): GardenManifest {
  const record = asRecord(raw, GARDEN_MANIFEST_ENTRY);
  const name = asString(record.name).trim();
  if (!name) throw new TransferError("This garden file has no garden name.");

  const content = asRecord(record.content ?? {}, GARDEN_MANIFEST_ENTRY);
  return {
    slug: asString(record.slug).trim(),
    name: name.slice(0, 120),
    description: asString(record.description).slice(0, 2000),
    visibility: record.visibility === "public" ? "public" : "private",
    borderColor: /^#[0-9a-fA-F]{6}$/.test(asString(record.borderColor))
      ? asString(record.borderColor)
      : "#a9c1b1",
    cardWidth: asNumber(record.cardWidth, 392),
    cardHeight: asNumber(record.cardHeight, 244),
    chatAccessible: asBoolean(record.chatAccessible),
    forkAllowed: asBoolean(record.forkAllowed),
    folder: asString(record.folder),
    createdAt: asString(record.createdAt),
    content: {
      files: asNumber(content.files, 0),
      bytes: asNumber(content.bytes, 0),
      skipped: [],
    },
  };
}

export function parseClusterManifest(raw: unknown): ClusterManifest {
  const record = asRecord(raw, CLUSTER_MANIFEST_ENTRY);
  const label = asString(record.label).trim() || asString(record.path).trim();
  if (!label) throw new TransferError("This cluster file has no cluster name.");

  const gardens: ClusterGardenEntry[] = Array.isArray(record.gardens)
    ? record.gardens.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const row = entry as Record<string, unknown>;
        const directory = asString(row.directory).trim();
        if (!directory || !isSafeArchivePath(directory)) return [];
        return [{ directory, folder: asString(row.folder) }];
      })
    : [];

  return {
    path: asString(record.path),
    label,
    folders: asStringArray(record.folders),
    gardens,
  };
}
