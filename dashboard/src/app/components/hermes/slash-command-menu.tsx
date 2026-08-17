"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import type { KeyboardEvent } from "react";
import type { CommandHubItem } from "@/lib/hermes/commands.ts";
import type { HermesSurface } from "@/lib/hermes/config.ts";
import {
  loadAgencyAgentsClientCatalog,
  peekCachedAgencyAgentsClientCatalog,
  type PublicAgencyAgent,
} from "@/lib/hermes/agency-agents-client";
import {
  commandResponseUrl,
  loadCachedCommandResponse,
  peekCachedCommandResponse,
} from "@/lib/hermes/command-client-cache";
import {
  directSlashCommandItems,
  type DirectCommandGroups,
} from "@/lib/hermes/direct-slash-commands";
import { isWorkflowCommand } from "@/lib/hermes/omh-command";

type CommandResponse = { groups: DirectCommandGroups };

export interface SlashCommandMenuHandle {
  handleKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
}

interface Props {
  open: boolean;
  /**
   * The token being edited, without its leading slash. The owning composer
   * derives it from the caret (see slashQueryAt), so the menu filters on the
   * capability under the cursor rather than on the whole sentence.
   */
  query: string;
  sessionId?: string | number | null;
  surface: HermesSurface;
  availableRuntimeAgentIds: string[];
  placement?: "above" | "below";
  onClose: () => void;
  onSelect: (item: CommandHubItem) => void;
}

const KIND_LABELS: Record<CommandHubItem["kind"], string> = {
  skill: "Skill",
  mcp: "Connection",
  prompt: "Prompt",
  agent: "Agent",
};

/**
 * The list is ordered by section but never ruled off, so each row's own label is
 * what tells the reader which section they have reached. Workflows are skills on
 * disk and would otherwise read as one.
 */
function commandKindLabel(item: CommandHubItem): string {
  return isWorkflowCommand(item) ? "Workflow" : KIND_LABELS[item.kind];
}

const SlashCommandMenu = forwardRef<SlashCommandMenuHandle, Props>(
  function SlashCommandMenu(
    {
      open,
      query,
      sessionId,
      surface,
      availableRuntimeAgentIds,
      placement = "above",
      onClose,
      onSelect,
    },
    ref,
  ) {
    const responseUrl = commandResponseUrl({ surface, sessionId });
    const [data, setData] = useState<CommandResponse | null>(() =>
      peekCachedCommandResponse<CommandResponse>(responseUrl),
    );
    const [agencyAgents, setAgencyAgents] = useState<PublicAgencyAgent[]>(() =>
      peekCachedAgencyAgentsClientCatalog()?.agents ?? [],
    );
    const [loading, setLoading] = useState(data === null);
    const [error, setError] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const runtimeAgentIdsKey = availableRuntimeAgentIds.join("\n");
    const visibleData = data ?? peekCachedCommandResponse<CommandResponse>(responseUrl);
    const visibleAgencyAgents = agencyAgents.length
      ? agencyAgents
      : peekCachedAgencyAgentsClientCatalog()?.agents ?? [];
    const items = useMemo(
      () => directSlashCommandItems({
        groups: visibleData?.groups ?? null,
        agencyAgents: visibleAgencyAgents,
        availableRuntimeAgentIds,
        surface,
        query,
      }),
      // The stable key avoids invalidating the list just because the composer
      // produced an equivalent array of available agent ids on a new render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [query, runtimeAgentIdsKey, surface, visibleAgencyAgents, visibleData],
    );
    const selectedIndex = Math.min(activeIndex, Math.max(0, items.length - 1));

    // A new query is a new list; keeping the old row highlighted would arm
    // Enter on whatever happened to sit at that index before.
    useEffect(() => {
      setActiveIndex(0);
    }, [query]);

    useEffect(() => {
      if (!open) return;
      let cancelled = false;
      const cachedResponse = peekCachedCommandResponse<CommandResponse>(responseUrl);
      void Promise.all([
        loadCachedCommandResponse<CommandResponse>(responseUrl),
        loadAgencyAgentsClientCatalog().catch(() => null),
      ]).then(([response, agency]) => {
        if (cancelled) return;
        setError(null);
        setData(response);
        if (agency) setAgencyAgents(agency.agents);
      }).catch((cause) => {
        if (!cancelled && !cachedResponse) {
          setError(cause instanceof Error ? cause.message : "Slash commands could not be loaded.");
        }
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, [open, responseUrl]);

    useImperativeHandle(ref, () => ({
      handleKeyDown(event) {
        if (!open) return false;
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return true;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const direction = event.key === "ArrowDown" ? 1 : -1;
          setActiveIndex((index) => items.length
            ? (Math.min(index, items.length - 1) + direction + items.length) % items.length
            : 0);
          return true;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          const selected = items[selectedIndex];
          if (selected) onSelect(selected);
          return true;
        }
        return false;
      },
    }), [items, onClose, onSelect, open, selectedIndex]);

    if (!open) return null;

    return (
      <section
        id="direct-slash-command-menu"
        className={`neu-popover absolute inset-x-0 z-50 flex max-h-[min(24rem,52vh)] flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] shadow-2xl ${placement === "below" ? "top-full mt-2" : "bottom-full mb-2"}`}
        aria-label="Available capabilities"
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
          <span className="text-xs font-medium text-[var(--ink-muted)]">Available capabilities</span>
          {loading && !items.length ? (
            <span className="text-[10px] text-[var(--ink-muted)]">Loading…</span>
          ) : null}
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-1.5">
          {items.length ? (
            <ul role="listbox" aria-label="Available capabilities" className="space-y-0.5">
              {items.map((item, index) => (
                <li
                  key={`${item.kind}:${item.id}`}
                  role="option"
                  aria-selected={index === selectedIndex}
                >
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => onSelect(item)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)] ${index === selectedIndex ? "bg-[var(--paper-strong)]" : "hover:bg-[var(--paper-surface)]"}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-sm font-medium text-[var(--ink-heading)]">
                        /{item.token}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-[var(--ink-muted)]">
                        {item.name}{item.description ? ` · ${item.description}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] text-[var(--ink-muted)]">
                      {commandKindLabel(item)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-[var(--ink-muted)]" role="status">
              {error ?? (loading ? "Loading slash commands…" : "No ready commands match.")}
            </div>
          )}
        </div>
      </section>
    );
  },
);

export default SlashCommandMenu;
