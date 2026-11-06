"use client";

import { buildLearnMarkdownFolders, type LearnMarkdownFolder, type LearnSelectableDocument } from "@/lib/learn-source-selection";

interface MarkdownSource extends LearnSelectableDocument {
  title: string;
}

export function LearnMarkdownSources({ documents, selectedIds, syllabusId, locked, onToggle }: {
  documents: readonly MarkdownSource[];
  selectedIds: ReadonlySet<string>;
  syllabusId: string | null;
  locked: boolean;
  onToggle: (ids: string[]) => void;
}) {
  const tree = buildLearnMarkdownFolders(documents);
  if (tree.sourceIds.length === 0) return null;

  function renderContents(folder: LearnMarkdownFolder<MarkdownSource>) {
    return <>
      {folder.folders.map((child) => {
        const ids = child.sourceIds.filter((id) => id !== syllabusId);
        const selectedCount = ids.filter((id) => selectedIds.has(id)).length;
        const checked = ids.length > 0 && selectedCount === ids.length;
        const partial = selectedCount > 0 && !checked;
        return (
          <div key={child.path} className="relative pl-6">
            <input
              type="checkbox"
              aria-label={`Select folder ${child.path}`}
              aria-checked={partial ? "mixed" : checked}
              ref={(input) => { if (input) input.indeterminate = partial; }}
              checked={checked}
              disabled={locked || ids.length === 0}
              onChange={() => onToggle(ids)}
              className="absolute left-2 top-2 h-3.5 w-3.5 accent-white disabled:opacity-40"
            />
            <details open>
              <summary className="cursor-pointer rounded-md px-2 py-1.5 text-xs text-gray-300 hover:bg-gray-900">
                {child.name} <span className="text-gray-500">{selectedCount}/{ids.length}</span>
              </summary>
              {renderContents(child)}
            </details>
          </div>
        );
      })}
      {folder.documents.map((document) => {
        const isSyllabus = document.slug === syllabusId;
        return (
          <label key={document.relPath} title={document.relPath}
            className={`flex items-start gap-2 rounded-md px-2 py-1.5 ${locked || isSyllabus ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-gray-900"}`}>
            <input type="checkbox" checked={!isSyllabus && selectedIds.has(document.slug)}
              disabled={locked || isSyllabus} onChange={() => onToggle([document.slug])}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-white disabled:opacity-40" />
            <span className="min-w-0">
              <span className="block truncate text-xs text-gray-300">{document.title}</span>
              <span className="block truncate text-[10px] text-gray-500">
                {isSyllabus ? "Used as syllabus — not teaching material" : document.relPath}
              </span>
            </span>
          </label>
        );
      })}
    </>;
  }

  return <div>
    <p className="px-2 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-600">Markdown &amp; folders</p>
    {renderContents(tree)}
  </div>;
}
