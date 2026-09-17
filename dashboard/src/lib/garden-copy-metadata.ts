import { isMap, parseDocument } from "yaml";

const ASSET_FIELDS = ["source_pdf", "searchable_pdf", "source_media", "source_images", "image", "cover", "poster"];
const LINK_FIELDS = ["related", "learning_pages", "topics", "learning_page", "textbook_page"];
const OWNER_FIELDS = ["knowledge_type", "breadboardType", "breadboard_type", "generated_by", "generatedBy", "artifact_id", "source_document", "collection", "internal", "legacy_subtopic_page"];

/** Keep display/provenance, but a copy must not inherit ingestion/deletion ownership. */
export function rewriteGardenCopyMetadata(
  markdown: string,
  rewrite: (link: string) => string,
  copy?: { original: string; folder: string },
): string {
  const header = /^(\uFEFF?---[^\S\r\n]*\r?\n)([\s\S]*?)(\r?\n---[^\S\r\n]*(?:\r?\n|$))/.exec(markdown);
  if (!header && !copy) return markdown;
  const document = parseDocument(header?.[2] || "{}");
  if (document.errors.length || !isMap(document.contents)) {
    throw new Error("The note frontmatter is invalid; the folder was not copied.");
  }
  document.contents.flow = false;
  const fields = document.toJSON() as Record<string, unknown>;
  for (const key of [...ASSET_FIELDS, ...LINK_FIELDS]) {
    const value = fields[key];
    if (typeof value === "string") document.set(key, rewrite(value));
    else if (Array.isArray(value)) document.set(key, value.map(item => typeof item === "string" ? rewrite(item) : item));
  }
  if (copy) {
    const provenance: Record<string, unknown> = { page: copy.original };
    for (const key of OWNER_FIELDS) {
      const value = fields[key];
      if (value !== undefined) provenance[key] = value;
      document.delete(key);
    }
    document.set("garden_copy", true);
    // Keep provenance on one line: legacy readers parse top-level scalars
    // line-by-line and must never mistake an old owner for the copy's owner.
    const provenanceNode = document.createNode(provenance);
    if (isMap(provenanceNode)) provenanceNode.flow = true;
    document.set("garden_copy_of", provenanceNode);
    document.set("knowledge_type", "note");
    document.set("breadboardType", "note");
    document.set("generated_by", "garden_copy");
    document.set("collection", copy.folder);
  }
  return `---\n${document.toString({ lineWidth: 0 })}---\n${header ? markdown.slice(header[0].length) : markdown}`;
}
