"use client";

// The emoji popover, used both to add a reaction and to type one.
//
// A curated list rather than the full Unicode set: a room needs the emoji
// people actually reach for, and shipping ~1,800 glyphs would mean a data file
// larger than the rest of the page for a control used a few times an hour.
// Search is by name, so the list stays reachable without scrolling.

import { useMemo, useRef, useState } from "react";

import { cn } from "@/app/buzz/lib/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/app/buzz/ui/popover";

interface EmojiGroup {
  name: string;
  emoji: Array<[string, string]>;
}

const GROUPS: EmojiGroup[] = [
  {
    name: "Reactions",
    emoji: [
      ["👍", "thumbs up yes agree"],
      ["👎", "thumbs down no disagree"],
      ["❤️", "heart love"],
      ["🔥", "fire hot"],
      ["🎉", "tada party celebrate ship"],
      ["🚀", "rocket ship launch"],
      ["👀", "eyes looking watching"],
      ["✅", "check done shipped"],
      ["❌", "cross no wrong"],
      ["⚠️", "warning careful"],
      ["🙏", "pray thanks please"],
      ["🤝", "handshake deal agree"],
    ],
  },
  {
    name: "Faces",
    emoji: [
      ["😀", "grin happy smile"],
      ["😂", "joy laugh crying"],
      ["🙂", "slight smile"],
      ["😉", "wink"],
      ["😍", "heart eyes love"],
      ["🤔", "thinking hmm"],
      ["😅", "sweat nervous laugh"],
      ["😭", "sob cry"],
      ["😴", "sleep tired"],
      ["🤯", "mind blown exploding head"],
      ["😬", "grimace awkward"],
      ["🥳", "party face celebrate"],
      ["😎", "cool sunglasses"],
      ["🫠", "melting"],
      ["🙃", "upside down"],
      ["😤", "determined steam"],
    ],
  },
  {
    name: "Work",
    emoji: [
      ["💡", "idea lightbulb"],
      ["🐛", "bug"],
      ["🛠️", "tools fix build"],
      ["📦", "package release"],
      ["📈", "chart up growth"],
      ["📉", "chart down"],
      ["🧪", "test experiment"],
      ["🧹", "cleanup broom"],
      ["🔒", "lock private secure"],
      ["🔑", "key access"],
      ["⏱️", "timer speed perf"],
      ["📝", "note write docs"],
      ["🗓️", "calendar date"],
      ["🧭", "compass direction plan"],
      ["🤖", "robot agent bot"],
      ["🐝", "bee buzz"],
    ],
  },
  {
    name: "Things",
    emoji: [
      ["☕", "coffee"],
      ["🍕", "pizza food"],
      ["🌱", "seedling plant grow"],
      ["🌊", "wave water"],
      ["⭐", "star"],
      ["✨", "sparkles magic"],
      ["🎯", "target goal"],
      ["🧊", "ice cold freeze"],
      ["🪄", "wand magic"],
      ["🔔", "bell notify"],
      ["📌", "pin"],
      ["🏁", "finish flag done"],
    ],
  },
];

export function EmojiPicker({
  children,
  onPick,
  align = "start",
  side = "top",
}: {
  children: React.ReactNode;
  onPick: (emoji: string) => void;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return GROUPS;
    return GROUPS.map((group) => ({
      name: group.name,
      emoji: group.emoji.filter(
        ([glyph, keywords]) => glyph === needle || keywords.includes(needle),
      ),
    })).filter((group) => group.emoji.length > 0);
  }, [query]);

  const pick = (emoji: string) => {
    onPick(emoji);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-64 p-0"
        side={side}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="border-b border-border/60 p-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const first = groups[0]?.emoji[0];
                if (first) {
                  event.preventDefault();
                  pick(first[0]);
                }
              }
            }}
            placeholder="Search emoji…"
            className="h-7 w-full rounded-lg bg-muted/50 px-2 text-xs outline-hidden placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="buzz-content-scrollbar max-h-64 overflow-y-auto p-2">
          {groups.length === 0 ? (
            <p className="px-1 py-3 text-center text-2xs text-muted-foreground">
              Nothing matching that.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.name} className="mb-2 last:mb-0">
                <p className="px-1 pb-1 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.name}
                </p>
                <div className="grid grid-cols-8 gap-0.5">
                  {group.emoji.map(([glyph, keywords]) => (
                    <button
                      key={glyph}
                      type="button"
                      title={keywords.split(" ")[0]}
                      onClick={() => pick(glyph)}
                      className={cn(
                        "flex size-7 items-center justify-center rounded-md text-base leading-none",
                        "transition-colors hover:bg-accent",
                      )}
                    >
                      {glyph}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
