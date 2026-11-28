/**
 * Every Office document kept in a Garden's Files gets a Quartz note beside it:
 * the document as markdown, regenerated whenever the file gets a new version
 * (Office editors, the Garden file editor, Bread's garden_save_file, uploads,
 * restores), moved with it and removed when it is trashed. The note is derived
 * output: the original file stays the source of truth.
 */
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import db from "../db.ts";
import type { GardenFileEntry } from "../garden-files/types.ts";
import type { GardenFileScope, GardenFileStore } from "../garden-files/store.ts";
import { spacesKindForPath } from "./types.ts";

const MIRRORED = new Set(["docx", "xlsx", "pptx", "odt", "ods", "odp", "pdf", "html", "htm", "md", "markdown", "affine"]);
const MAX_BYTES = 64 * 1024 * 1024;
const DEBOUNCE_MS = 4000;

interface MirrorRow { file_id: string; rel_path: string; version: number; format: number }
const MIRROR_FORMAT = 3;

let schemaReady = false;
function ensureSchema(): void {
  if (schemaReady) return;
  db.exec(`CREATE TABLE IF NOT EXISTS office_quartz_mirrors (
    file_id TEXT PRIMARY KEY,
    cluster_id INTEGER NOT NULL,
    rel_path TEXT NOT NULL,
    version INTEGER NOT NULL
  )`);
  // Format 3 links figures by their full content path; notes written before it are rendered again once.
  const columns = db.prepare("PRAGMA table_info(office_quartz_mirrors)").all() as { name: string }[];
  if (!columns.some(column => column.name === "format")) db.exec("ALTER TABLE office_quartz_mirrors ADD COLUMN format INTEGER NOT NULL DEFAULT 1");
  schemaReady = true;
}

const extension = (name: string) => name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
const slug = (value: string) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "document";

/** Where a file's note lives: same folder, "<name>-<ext>.md" so Plan.docx and Plan.pdf never collide. */
export function officeMirrorPath(entry: Pick<GardenFileEntry, "name" | "folder">): string {
  const ext = extension(entry.name), base = entry.name.slice(0, entry.name.length - ext.length - 1) || entry.name;
  return `${entry.folder ? `${entry.folder}/` : ""}${slug(base)}-${ext}.md`;
}
const assetDir = (fileId: string) => `assets/office/${fileId}`;

async function replaceAsync(text: string, pattern: RegExp, replace: (...match: string[]) => Promise<string>): Promise<string> {
  const parts = await Promise.all([...text.matchAll(pattern)].map(match => replace(...match)));
  let i = 0;
  return text.replace(pattern, () => parts[i++]);
}

/** Document bytes to markdown, plus figures referenced as figure-N.ext. Designs and videos are named by their Garden path. */
export async function officeMarkdown(name: string, bytes: Buffer): Promise<{ markdown: string; figures: { name: string; bytes: Buffer }[] }> {
  const ext = extension(name);
  if (ext === "affine") {
    // The page editor stores its own markdown beside the AFFiNE snapshot; images are under assets/.
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(bytes);
    const markdown = await zip.file("breadboard.md")?.async("string") ?? "";
    const figures: { name: string; bytes: Buffer }[] = [];
    let index = 0;
    const linked = await replaceAsync(markdown, /\]\((?:\.\/)?assets\/([^)\s]+)\)/g, async (_match, asset: string) => {
      const entry = zip.file(`assets/${decodeURIComponent(asset)}`);
      if (!entry) return "]()";
      const name = `figure-${++index}.${asset.split(".").pop()?.toLowerCase() || "png"}`;
      figures.push({ name, bytes: await entry.async("nodebuffer") });
      return `](${name})`;
    });
    return { markdown: linked, figures };
  }
  if (spacesKindForPath(name)?.tab === "designs") return { markdown: `![${name.split("/").pop()}](figure-1.${ext})`, figures: [{ name: `figure-1.${ext}`, bytes }] };
  if (spacesKindForPath(name)?.tab === "videos") return { markdown: `<video controls preload="metadata" src="figure-1.${ext}" style="max-width:100%"></video>`, figures: [{ name: `figure-1.${ext}`, bytes }] };
  if (ext === "md" || ext === "markdown") return { markdown: bytes.toString("utf8").replace(/^---\n[\s\S]*?\n---\n/, ""), figures: [] };
  if (ext === "html" || ext === "htm") {
    const { convert } = await import("html-to-text");
    type Builder = { openBlock(o: object): void; addLiteral(text: string): void; closeBlock(o: object): void };
    const markdown = convert(bytes.toString("utf8"), {
      wordwrap: false,
      formatters: {
        mdHeading: (element: { name: string; children: unknown[] }, walk: (nodes: unknown[], builder: Builder) => void, builder: Builder) => {
          builder.openBlock({ leadingLineBreaks: 2 });
          builder.addLiteral(`${"#".repeat(Number(element.name.slice(1)) || 1)} `);
          walk(element.children, builder);
          builder.closeBlock({ trailingLineBreaks: 1 });
        },
      } as never,
      selectors: [1, 2, 3, 4, 5, 6].map(level => ({ selector: `h${level}`, format: "mdHeading" })),
    });
    return { markdown, figures: [] };
  }
  if (ext === "pdf") {
    // Text layer only: OCR on every save would spend model calls; scanned PDFs keep "Add to knowledge".
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(bytes) });
    try {
      const result = await parser.getText();
      const pages = result.pages.map(page => `## Page ${page.num}\n\n${page.text.trim()}`).filter(page => !/^## Page \d+\n\n$/.test(page));
      return { markdown: pages.join("\n\n") || "_This PDF has no text layer. Use Add to knowledge to read it with OCR._", figures: [] };
    } finally { await parser.destroy(); }
  }
  if (ext === "odt" || ext === "ods" || ext === "odp") {
    const { readOpenDocument } = await import("../document-structure/opendocument.ts");
    return { markdown: (await readOpenDocument(bytes)).markdown, figures: [] };
  }
  const { readDocument } = await import("../document-structure/index.ts");
  const structure = readDocument(ext as "docx" | "xlsx" | "pptx", bytes);
  return { markdown: structure.markdown, figures: structure.figures.map(figure => ({ name: `figure-${figure.index}.${figure.extension}`, bytes: figure.bytes })) };
}

function noteText(entry: GardenFileEntry, markdown: string): string {
  const title = entry.name.replace(/\.[^.]+$/, "") || entry.name;
  return [
    "---",
    `title: ${JSON.stringify(title)}`,
    `date: ${JSON.stringify(entry.updatedAt)}`,
    'source: "office-file"',
    'knowledge_type: "source-document"',
    `source_type: ${JSON.stringify(extension(entry.name))}`,
    `source_file: ${JSON.stringify(entry.path)}`,
    `garden_file_id: ${JSON.stringify(entry.id)}`,
    `garden_file_version: ${entry.version}`,
    "---",
    "",
    `> Generated from the Garden file **${entry.name}**. Edit the document itself; this page updates when it changes.`,
    "",
    markdown.trim() || "_This document is empty._",
    "",
  ].join("\n");
}

/** A note may never widen who can read a file: in a public Garden only shared files are mirrored. */
function mirrorable(entry: GardenFileEntry, gardenPublic: boolean): boolean {
  // sources/ holds editable copies of uploads (a Word document's original); their source note already exists.
  return entry.kind === "file" && !entry.deletedAt && !/^sources\//i.test(entry.path) && (MIRRORED.has(extension(entry.name)) || Boolean(spacesKindForPath(entry.path)?.spacesFolderOnly)) && entry.size <= MAX_BYTES && (!gardenPublic || entry.visibility === "garden");
}

export async function syncOfficeMirrors(store: GardenFileStore, scope: GardenFileScope): Promise<void> {
  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  if (!contentPath) return;
  ensureSchema();
  const gardenDir = path.resolve(contentPath, scope.gardenId);
  if (!fs.existsSync(gardenDir)) return; // A Garden without Quartz content has nowhere to show notes.
  const cluster = db.prepare("SELECT visibility FROM clusters WHERE id = ?").get(scope.clusterId) as { visibility?: string } | undefined;
  if (!cluster) return;
  const owner = { ...scope, userId: scope.ownerId };
  const wanted = new Map(store.list(owner).filter(entry => mirrorable(entry, cluster.visibility === "public")).map(entry => [entry.id, entry]));
  const existing = db.prepare("SELECT file_id, rel_path, version, format FROM office_quartz_mirrors WHERE cluster_id = ?").all(scope.clusterId) as MirrorRow[];
  const current = new Map(existing.map(row => [row.file_id, row]));
  const removals = existing.filter(row => {
    const entry = wanted.get(row.file_id);
    return !entry || officeMirrorPath(entry) !== row.rel_path;
  });
  const writes = [...wanted.values()].filter(entry => {
    const row = current.get(entry.id);
    return !row || row.version !== entry.version || row.format !== MIRROR_FORMAT || officeMirrorPath(entry) !== row.rel_path;
  });
  if (!removals.length && !writes.length) return;

  // Convert outside the Garden lease; only the file writes hold it.
  const rendered: { entry: GardenFileEntry; relPath: string; text: string; figures: { name: string; bytes: Buffer }[] }[] = [];
  for (const entry of writes) {
    try {
      const content = store.content(owner, entry.id);
      const { markdown, figures } = await officeMarkdown(spacesKindForPath(entry.path)?.spacesFolderOnly ? entry.path : entry.name, await fs.promises.readFile(content.path));
      const relPath = officeMirrorPath(entry);
      // Quartz resolves these links from the content root. "../assets" from a folder lost the Garden folder,
      // and a bare "assets/..." is only scoped to the Garden when Quartz knows the asset, which the Garden
      // reader (it lists Markdown pages only) does not. The full path resolves the same in both.
      const toAsset = (name: string) => `${scope.gardenId}/${assetDir(entry.id)}/${name}`;
      const linked = markdown.replace(/\]\((figure-\d+\.[a-z0-9]+)\)/gi, (_match, name: string) => `](${toAsset(name)})`)
        .replace(/src="(figure-\d+\.[a-z0-9]+)"/gi, (_match, name: string) => `src="${toAsset(name)}"`);
      rendered.push({ entry, relPath, text: noteText(entry, linked), figures });
    } catch (error) {
      console.warn(`[office] Could not mirror ${entry.path} into Quartz:`, error instanceof Error ? error.message : error);
    }
  }

  const { withGardenMutationLease } = await import("../garden-mutation-lease.ts");
  const { refreshClusterIndex } = await import("../knowledge.ts");
  const paths = [...removals.map(row => row.rel_path), ...rendered.map(item => item.relPath)];
  await withGardenMutationLease(gardenDir, "office-quartz-mirror", () => {
    for (const row of removals) {
      fs.rmSync(path.join(gardenDir, row.rel_path), { force: true });
      if (!wanted.has(row.file_id)) fs.rmSync(path.join(gardenDir, assetDir(row.file_id)), { recursive: true, force: true });
      db.prepare("DELETE FROM office_quartz_mirrors WHERE file_id = ?").run(row.file_id);
    }
    for (const item of rendered) {
      const target = path.join(gardenDir, item.relPath), assets = path.join(gardenDir, assetDir(item.entry.id));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.rmSync(assets, { recursive: true, force: true });
      if (item.figures.length) fs.mkdirSync(assets, { recursive: true });
      for (const figure of item.figures) fs.writeFileSync(path.join(assets, figure.name), figure.bytes);
      fs.writeFileSync(target, item.text, "utf8");
      db.prepare("INSERT INTO office_quartz_mirrors (file_id, cluster_id, rel_path, version, format) VALUES (?, ?, ?, ?, ?) ON CONFLICT(file_id) DO UPDATE SET rel_path = excluded.rel_path, version = excluded.version, format = excluded.format")
        .run(item.entry.id, scope.clusterId, item.relPath, item.entry.version, MIRROR_FORMAT);
    }
    refreshClusterIndex(contentPath, scope.gardenId, { migrateSources: false });
  }, { paths });

  const { publishQuartzAfterMutation } = await import("../quartz-publish.ts");
  void publishQuartzAfterMutation(`office documents ${scope.gardenId}`, { userId: scope.ownerId, gardenSlug: scope.gardenId })
    .catch(error => console.error("[office] Quartz notes saved; publication failed:", error));
}

const timers = new Map<number, ReturnType<typeof setTimeout>>();
const running = new Map<number, Promise<void>>();

/** Debounced per Garden: Docs autosaves every few seconds and folder moves touch many files at once. */
export function scheduleOfficeMirrors(store: GardenFileStore, scope: GardenFileScope): void {
  clearTimeout(timers.get(scope.clusterId));
  timers.set(scope.clusterId, setTimeout(() => {
    timers.delete(scope.clusterId);
    const previous = running.get(scope.clusterId) ?? Promise.resolve();
    const next = previous.then(() => syncOfficeMirrors(store, scope)).catch(error => {
      console.error(`[office] Quartz mirror for ${scope.gardenId} failed:`, error instanceof Error ? error.message : error);
    });
    running.set(scope.clusterId, next);
  }, DEBOUNCE_MS));
}
