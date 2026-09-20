"use client";

import { useState, useSyncExternalStore } from "react";
import { Keyboard, Search } from "lucide-react";

const groups = [
  {
    title: "Chat & editing",
    shortcuts: [
      ["Send or queue a message", ["Enter"]],
      ["New line in a message", ["Shift", "Enter"]],
      ["Copy", ["Mod", "C"]],
      ["Cut", ["Mod", "X"]],
      ["Paste", ["Mod", "V"]],
      ["Select all", ["Mod", "A"]],
      ["Undo", ["Mod", "Z"]],
    ],
  },
  {
    title: "Desktop tabs & navigation",
    shortcuts: [
      ["New tab", ["Mod", "T"]],
      ["New dashboard tab", ["Alt", "D"]],
      ["Close tab", ["Mod", "W"]],
      ["Reopen closed tab", ["Mod", "Shift", "T"]],
      ["Next tab", ["Mod", "Tab"]],
      ["Previous tab", ["Mod", "Shift", "Tab"]],
      ["Go to tab 1–8", ["Mod", "1–8"]],
      ["Go to last tab", ["Mod", "9"]],
      ["Go back", ["Alt", "←"]],
      ["Go forward", ["Alt", "→"]],
      ["Reload", ["Mod", "R"]],
      ["Find in page", ["Mod", "F"]],
      ["Toggle full screen", ["F11"]],
    ],
  },
  {
    title: "Desktop browser",
    shortcuts: [
      ["Focus address bar", ["Mod", "L"]],
      ["New window", ["Mod", "N"]],
      ["New private tab", ["Mod", "Shift", "P"]],
      ["New private window", ["Mod", "Shift", "N"]],
      ["History", ["Mod", "H"]],
      ["Bookmarks", ["Mod", "Shift", "O"]],
      ["Downloads", ["Mod", "J"]],
      ["Print page", ["Mod", "P"]],
      ["Save page", ["Mod", "S"]],
      ["Zoom in", ["Mod", "+"]],
      ["Zoom out", ["Mod", "−"]],
      ["Reset zoom", ["Mod", "0"]],
      ["Picture in picture", ["Alt", "P"]],
    ],
  },
] satisfies { title: string; shortcuts: [string, string[]][] }[];

const subscribe = () => () => {};
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);

export default function KeyboardShortcutsPanel() {
  const [query, setQuery] = useState("");
  const mac = useSyncExternalStore(subscribe, isMac, () => false);
  const keyLabel = (key: string) => key === "Mod" ? (mac ? "⌘" : "Ctrl") : key === "Alt" && mac ? "Option" : key;
  const search = query.trim().toLowerCase();
  const visible = groups.map(group => ({
    ...group,
    shortcuts: group.shortcuts.filter(([label, keys]) =>
      `${group.title} ${label} ${keys.map(keyLabel).join(" ")}`.toLowerCase().includes(search)),
  })).filter(group => group.shortcuts.length > 0);

  return (
    <section aria-labelledby="keyboard-shortcuts-title" className="neu-surface-raised rounded-2xl border border-gray-800 p-5">
      <header className="mb-4">
        <h2 id="keyboard-shortcuts-title" className="flex items-center gap-2 text-sm font-semibold text-white">
          <Keyboard size={16} aria-hidden="true" /> Keyboard shortcuts
        </h2>
        <p className="mt-0.5 text-xs text-gray-500">Everyday keys for chat, tabs, and browsing.</p>
      </header>
      <p className="mb-4 rounded-xl border border-gray-800 bg-white/[0.03] p-3 text-xs leading-relaxed text-gray-400">
        <span className="font-medium text-white">Right-click to paste.</span>{" "}
        In the desktop app, right-click an editable text field to paste from your clipboard, including chat and browser fields.
      </p>
      <label className="relative mb-3 block">
        <span className="sr-only">Search keyboard shortcuts</span>
        <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search shortcuts…"
          className="w-full rounded-lg border border-gray-700 bg-transparent py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-gray-500 focus:border-gray-400"
        />
      </label>
      <div className="max-h-80 space-y-4 overflow-y-auto pr-1" tabIndex={0} aria-label="Keyboard shortcuts list">
        {visible.map(group => (
          <div key={group.title}>
            <h3 className="mb-1 text-xs font-medium text-gray-500">{group.title}</h3>
            <dl className="divide-y divide-gray-800/70">
              {group.shortcuts.map(([label, keys]) => (
                <div key={label} className="flex items-center justify-between gap-3 py-2">
                  <dt className="text-xs text-gray-300">{label}</dt>
                  <dd className="flex shrink-0 items-center gap-1" aria-label={keys.map(keyLabel).join(" + ")}>
                    {keys.map(key => <kbd key={key} className="min-w-5 rounded border border-gray-700 bg-white/[0.04] px-1.5 py-0.5 text-center font-mono text-[11px] text-gray-300">{keyLabel(key)}</kbd>)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        {visible.length === 0 && <p role="status" className="py-5 text-center text-xs text-gray-500">No shortcuts match your search.</p>}
      </div>
    </section>
  );
}
