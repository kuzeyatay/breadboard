"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import type { BotAvatarConfig } from "@/lib/bots/types";
import { BREAD_BOT, botHandle } from "@/lib/bots/mentions";
import { loadCachedBots, peekCachedBots } from "@/lib/bots/client-cache";
import BotAvatar from "./bot-avatar";
import DefaultAvatar, { BREAD_AVATAR_SRC } from "../default-avatar";

export interface BotMentionMenuHandle {
  handleKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
}

interface Choice { handle: string; name: string; description: string; avatar?: BotAvatarConfig; primary?: boolean }

/** The "@" picker: Bread first, then the user's bots, filtered by what follows the "@". */
const BotMentionMenu = forwardRef<BotMentionMenuHandle, {
  open: boolean;
  query: string;
  onClose: () => void;
  onSelect: (handle: string) => void;
}>(function BotMentionMenu({ open, query, onClose, onSelect }, ref) {
  const [bots, setBots] = useState(() => peekCachedBots() ?? []);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (open) void loadCachedBots().then(setBots).catch(() => {});
  }, [open]);
  useEffect(() => setActive(0), [query]);
  const choices = useMemo<Choice[]>(() => {
    const all: Choice[] = [
      { ...BREAD_BOT, primary: true },
      ...bots.map((bot) => ({ handle: botHandle(bot.name), name: bot.name, description: bot.description, avatar: bot.avatar })),
    ];
    const q = query.toLowerCase();
    return all.filter((choice) => !q || choice.handle.startsWith(q) || choice.name.toLowerCase().includes(q)).slice(0, 8);
  }, [bots, query]);
  const selected = Math.min(active, Math.max(0, choices.length - 1));

  useImperativeHandle(ref, () => ({
    handleKeyDown(event) {
      if (!open || !choices.length || event.nativeEvent.isComposing) return false;
      if (event.key === "Escape") { event.preventDefault(); onClose(); return true; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((index) => (Math.min(index, choices.length - 1) + step + choices.length) % choices.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        onSelect(choices[selected]!.handle);
        return true;
      }
      return false;
    },
  }), [choices, onClose, onSelect, open, selected]);

  if (!open || !choices.length) return null;
  return (
    <section className="neu-popover absolute inset-x-0 bottom-full z-50 mb-2 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] shadow-2xl" aria-label="Mention a bot">
      <ul role="listbox" aria-label="Bots" className="max-h-[min(22rem,48vh)] space-y-0.5 overflow-y-auto p-1.5">
        {choices.map((choice, index) => (
          <li key={choice.handle} role="option" aria-selected={index === selected}>
            <button
              type="button"
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(choice.handle)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${index === selected ? "bg-[var(--paper-strong)]" : "hover:bg-[var(--paper-surface)]"}`}
            >
              {choice.avatar ? <BotAvatar avatar={choice.avatar} name={choice.name} size={32} paused /> : <DefaultAvatar src={BREAD_AVATAR_SRC} name={choice.name} size={32} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--ink-heading)]">
                  {choice.name} <span className="font-normal text-[var(--ink-muted)]">@{choice.handle}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-[var(--ink-muted)]">{choice.description}</span>
              </span>
              {choice.primary ? <span className="shrink-0 text-[10px] text-[var(--ink-muted)]">Primary</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
});

export default BotMentionMenu;
