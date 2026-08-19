"use client";

// Left-side palette: drag a block type onto the canvas. Blocks are grouped by
// sim's own category field (blocks/tools/triggers); "starter" is excluded
// once already placed via the store's singleInstance rule, but stays visible
// here since a fresh workflow needs to be able to add it back if deleted.

import { useMemo, useState } from "react";
import { listPaletteBlocks, type CanvasBlockConfig } from "../lib/registry";

const CATEGORY_LABELS: Record<string, string> = {
  blocks: "Blocks",
  tools: "Tools",
  triggers: "Triggers",
};

export const PALETTE_DRAG_MIME = "application/breadboard-workflow-block";

export function BlockPalette() {
  const [query, setQuery] = useState("");
  const blocks = useMemo(() => listPaletteBlocks(), []);
  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return blocks;
    return blocks.filter(
      (block) => block.name.toLowerCase().includes(trimmed) || block.type.toLowerCase().includes(trimmed),
    );
  }, [blocks, query]);

  const grouped = useMemo(() => {
    const groups = new Map<string, CanvasBlockConfig[]>();
    for (const block of filtered) {
      const list = groups.get(block.category) ?? [];
      list.push(block);
      groups.set(block.category, list);
    }
    return groups;
  }, [filtered]);

  function onDragStart(event: React.DragEvent, type: string) {
    event.dataTransfer.setData(PALETTE_DRAG_MIME, type);
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-[var(--line)] bg-[var(--paper-surface)]">
      <div className="shrink-0 border-b border-[var(--line)] p-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search blocks…"
          className="neu-control w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {blocks.length === 0 ? (
          <p className="px-1 py-4 text-xs leading-5 text-[var(--ink-muted)]">
            Block definitions are loading. If this stays empty, the engine's block registry has not landed yet.
          </p>
        ) : null}
        {["blocks", "tools", "triggers"].map((category) => {
          const items = grouped.get(category);
          if (!items?.length) return null;
          return (
            <div key={category} className="mb-4">
              <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                {CATEGORY_LABELS[category] ?? category}
              </h3>
              <div className="space-y-1">
                {items.map((block) => (
                  <div
                    key={block.type}
                    draggable
                    onDragStart={(event) => onDragStart(event, block.type)}
                    className="neu-button flex cursor-grab items-center gap-2.5 rounded-xl border border-[var(--line)] px-2.5 py-2 text-left active:cursor-grabbing"
                    title={block.description}
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white"
                      style={{ backgroundColor: block.bgColor }}
                    >
                      <block.icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--ink)]">{block.name}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
