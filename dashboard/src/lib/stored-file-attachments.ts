// Plain files that are useful to a model as text but whose original bytes also
// matter to the user. Keeping this registry client-safe lets the picker, upload
// path, transcript validator and artifact importer agree on one format list.

export type StoredFileAttachmentFormat =
  | "txt" | "md" | "markdown" | "html" | "htm"
  | "csv" | "tsv" | "json" | "xml" | "svg"
  | "js" | "jsx" | "mjs" | "cjs" | "ts" | "tsx"
  | "py" | "java" | "c" | "h" | "cpp" | "hpp" | "cc" | "cxx"
  | "css" | "yaml" | "yml" | "toml" | "ini" | "sql" | "sh" | "ps1"
  | "rs" | "go" | "rb" | "php" | "swift" | "kt" | "kts" | "scala"
  | "lua" | "r" | "vue" | "svelte" | "zip";

export type StoredFileArtifactKind =
  | "text"
  | "markdown"
  | "html"
  | "spreadsheet"
  | "data"
  | "diagram"
  | "code"
  | "unknown";

export interface StoredFileFormatDescriptor {
  mimeType: string;
  artifactKind: StoredFileArtifactKind;
  textual: boolean;
}

const CODE = (mimeType = "text/plain; charset=utf-8"): StoredFileFormatDescriptor => ({
  mimeType,
  artifactKind: "code",
  textual: true,
});

export const STORED_FILE_ATTACHMENT_FORMATS: Record<
  StoredFileAttachmentFormat,
  StoredFileFormatDescriptor
> = {
  txt: { mimeType: "text/plain; charset=utf-8", artifactKind: "text", textual: true },
  md: { mimeType: "text/markdown; charset=utf-8", artifactKind: "markdown", textual: true },
  markdown: { mimeType: "text/markdown; charset=utf-8", artifactKind: "markdown", textual: true },
  html: { mimeType: "text/html; charset=utf-8", artifactKind: "html", textual: true },
  htm: { mimeType: "text/html; charset=utf-8", artifactKind: "html", textual: true },
  csv: { mimeType: "text/csv; charset=utf-8", artifactKind: "spreadsheet", textual: true },
  tsv: { mimeType: "text/tab-separated-values; charset=utf-8", artifactKind: "spreadsheet", textual: true },
  json: { mimeType: "application/json; charset=utf-8", artifactKind: "data", textual: true },
  xml: CODE("application/xml; charset=utf-8"),
  svg: { mimeType: "image/svg+xml", artifactKind: "diagram", textual: true },
  js: CODE("text/javascript; charset=utf-8"),
  jsx: CODE("text/jsx; charset=utf-8"),
  mjs: CODE("text/javascript; charset=utf-8"),
  cjs: CODE("text/javascript; charset=utf-8"),
  ts: CODE("text/typescript; charset=utf-8"),
  tsx: CODE("text/tsx; charset=utf-8"),
  py: CODE("text/x-python; charset=utf-8"),
  java: CODE("text/x-java-source; charset=utf-8"),
  c: CODE("text/x-c; charset=utf-8"),
  h: CODE("text/x-c; charset=utf-8"),
  cpp: CODE("text/x-c++; charset=utf-8"),
  hpp: CODE("text/x-c++; charset=utf-8"),
  cc: CODE("text/x-c++; charset=utf-8"),
  cxx: CODE("text/x-c++; charset=utf-8"),
  css: CODE("text/css; charset=utf-8"),
  yaml: CODE("application/yaml; charset=utf-8"),
  yml: CODE("application/yaml; charset=utf-8"),
  toml: CODE("application/toml; charset=utf-8"),
  ini: CODE(),
  sql: CODE("application/sql; charset=utf-8"),
  sh: CODE("application/x-sh; charset=utf-8"),
  ps1: CODE(),
  rs: CODE("text/x-rust; charset=utf-8"),
  go: CODE("text/x-go; charset=utf-8"),
  rb: CODE("text/x-ruby; charset=utf-8"),
  php: CODE("application/x-httpd-php; charset=utf-8"),
  swift: CODE("text/x-swift; charset=utf-8"),
  kt: CODE("text/x-kotlin; charset=utf-8"),
  kts: CODE("text/x-kotlin; charset=utf-8"),
  scala: CODE("text/x-scala; charset=utf-8"),
  lua: CODE("text/x-lua; charset=utf-8"),
  r: CODE("text/x-r; charset=utf-8"),
  vue: CODE("text/x-vue; charset=utf-8"),
  svelte: CODE("text/x-svelte; charset=utf-8"),
  zip: { mimeType: "application/zip", artifactKind: "unknown", textual: false },
};

export const STORED_FILE_ATTACHMENT_EXTENSIONS = Object.keys(
  STORED_FILE_ATTACHMENT_FORMATS,
) as StoredFileAttachmentFormat[];

export const STORED_FILE_ATTACHMENT_ACCEPT = STORED_FILE_ATTACHMENT_EXTENSIONS.map(
  (format) => `.${format}`,
).join(",");

export const MAX_STORED_TEXT_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_STORED_FILE_ATTACHMENT_BYTES = 128 * 1024 * 1024;
export const STORED_FILE_FILENAME_HEADER = "x-stored-file-filename";

export function isStoredFileAttachmentFormat(
  value: unknown,
): value is StoredFileAttachmentFormat {
  return typeof value === "string" && value in STORED_FILE_ATTACHMENT_FORMATS;
}

export function storedFileAttachmentFormat(
  filename: string,
): StoredFileAttachmentFormat | null {
  const base = filename.trim().toLowerCase().split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const extension = dot > 0 ? base.slice(dot + 1) : "";
  return isStoredFileAttachmentFormat(extension) ? extension : null;
}

export function isStoredFileBlobId(value: unknown): value is string {
  return typeof value === "string" && /^fil_[0-9a-f]{32}$/.test(value);
}

export function storedFileIsText(format: StoredFileAttachmentFormat): boolean {
  return STORED_FILE_ATTACHMENT_FORMATS[format].textual;
}
