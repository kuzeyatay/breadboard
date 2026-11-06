import { isLegacySubtopicRelPath, LEARNING_PAGE_TYPES } from "./learning-garden.ts";

export interface LearnSelectableDocument {
  slug: string;
  type: string;
  relPath: string;
}

/** Material a user can explicitly choose, shared by the picker and Learn readers. */
export function isLearnSelectableSource(document: LearnSelectableDocument): boolean {
  if (isLegacySubtopicRelPath(document.relPath, document.type)) return false;
  if (["source-document", "artifact", "user-note", "generated-note", "note"].includes(document.type)) {
    return true;
  }
  // Save page stores chat Markdown as learning pages in generated/. The actual
  // Learn output in learning/ must not become its own teaching input.
  return LEARNING_PAGE_TYPES.has(document.type) &&
    document.relPath.replace(/\\/g, "/").toLowerCase().startsWith("generated/");
}

export interface LearnMarkdownFolder<T> {
  path: string;
  name: string;
  documents: T[];
  folders: LearnMarkdownFolder<T>[];
  sourceIds: string[];
}

export function buildLearnMarkdownFolders<T extends LearnSelectableDocument>(
  documents: readonly T[],
): LearnMarkdownFolder<T> {
  const root: LearnMarkdownFolder<T> = { path: "", name: "Markdown", documents: [], folders: [], sourceIds: [] };
  for (const document of documents) {
    if (document.type === "source-document" || !isLearnSelectableSource(document)) continue;
    const folders = document.relPath.replace(/\\/g, "/").split("/").slice(0, -1);
    let node = root;
    node.sourceIds.push(document.slug);
    for (const name of folders) {
      let child = node.folders.find((folder) => folder.name === name);
      if (!child) {
        child = { path: node.path ? `${node.path}/${name}` : name, name, documents: [], folders: [], sourceIds: [] };
        node.folders.push(child);
      }
      node = child;
      node.sourceIds.push(document.slug);
    }
    node.documents.push(document);
  }
  const sort = (node: LearnMarkdownFolder<T>) => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name));
    node.folders.forEach(sort);
  };
  sort(root);
  return root;
}

/** Toggle a file or entire folder, keeping the syllabus out of teaching input. */
export function toggleLearnSourceSelection(
  available: readonly LearnSelectableDocument[],
  current: readonly string[] | null,
  toggledIds: readonly string[],
  syllabusId: string | null,
): string[] {
  const eligible = available.filter((doc) => isLearnSelectableSource(doc) && doc.slug !== syllabusId);
  const eligibleIds = new Set(eligible.map((doc) => doc.slug));
  const selected = new Set(current ?? eligible.filter((doc) => doc.type === "source-document").map((doc) => doc.slug));
  const toggled = toggledIds.filter((id) => eligibleIds.has(id));
  const remove = toggled.every((id) => selected.has(id));
  for (const id of toggled) {
    if (remove) selected.delete(id);
    else selected.add(id);
  }
  return [...new Set(eligible.map((doc) => doc.slug))].filter((id) => selected.has(id));
}
