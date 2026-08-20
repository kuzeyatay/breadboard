"use client";

// The right-hand panel: who is in the room, and how each of them behaves.
//
// The one control that matters here is "when does this agent speak". A room
// with several always-on agents answers every message several times, so the
// setting is on the member card rather than buried in a dialog — it is the
// difference between a useful room and an unreadable one.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Plus, UserMinus, X } from "lucide-react";

import { cn } from "@/app/buzz/lib/cn";
import type { BuzzMember, BuzzPersona, BuzzRespondTo } from "../types.ts";

/*
 * Short chips, long titles.
 *
 * The panel is 264px wide and these three sit on one row; spelled out ("Only
 * when asked directly") they wrapped to three lines and turned the quietest
 * setting in the room into its loudest element. The sentence is kept as the
 * title, so the meaning is one hover away.
 */
const RESPOND_LABELS: Record<BuzzRespondTo, string> = {
  always: "Always",
  mention: "Mentions",
  never: "Never",
};

const RESPOND_TITLES: Record<BuzzRespondTo, string> = {
  always: "Answers every message in this room",
  mention: "Answers when someone names it by handle",
  never: "Stays quiet unless asked directly",
};

export function MembersPanel({
  members,
  personas,
  roomPublicId,
  rosterReady,
  onClose,
  onAddPersona,
  onAddPerson,
  onRemove,
  onRespondToChange,
}: {
  members: BuzzMember[];
  personas: BuzzPersona[];
  /** Scopes the people search, so it never offers someone already seated. */
  roomPublicId: string | null;
  rosterReady: boolean;
  onClose: () => void;
  onAddPersona: (slug: string) => void;
  onAddPerson: (userId: number) => void;
  onRemove: (memberId: number) => void;
  onRespondToChange: (memberId: number, respondTo: BuzzRespondTo) => void;
}) {
  // Two pickers, not one. People are real accounts and are searched on the
  // server; specialists are the local roster. Mixing them into a single list
  // meant "add a person" mostly returned agents.
  const [picker, setPicker] = useState<"none" | "people" | "agents">("none");
  const [query, setQuery] = useState("");
  const [people_, setPeople] = useState<
    Array<{ userId: number; username: string }>
  >([]);
  const [searching, setSearching] = useState(false);

  const people = members.filter((member) => member.kind === "human");
  const agents = members.filter((member) => member.kind === "agent");

  const inRoom = useMemo(
    () => new Set(members.map((member) => member.personaSlug).filter(Boolean)),
    [members],
  );

  const availablePersonas = personas
    .filter((persona) => !inRoom.has(persona.slug))
    .filter((persona) =>
      query.trim() === ""
        ? true
        : `${persona.name} ${persona.division} ${persona.description}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
    )
    .slice(0, 40);

  const openPicker = useCallback((next: "people" | "agents") => {
    setPicker((current) => (current === next ? "none" : next));
    setQuery("");
  }, []);

  /*
   * People come from the account table, debounced, and every answer is checked
   * against the query current when it lands — typing fast used to paint the
   * results of a prefix.
   */
  useEffect(() => {
    if (picker !== "people") return;
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/buzz/people?q=${encodeURIComponent(query)}` +
            (roomPublicId ? `&roomId=${encodeURIComponent(roomPublicId)}` : ""),
          { cache: "no-store" },
        );
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as {
          query: string;
          people: Array<{ userId: number; username: string }>;
        };
        if (cancelled || body.query !== query.trim()) return;
        setPeople(body.people);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, query === "" ? 0 : 160);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [picker, query, roomPublicId, members.length]);

  return (
    <aside
      className="flex w-[264px] shrink-0 flex-col border-l border-border/40"
      aria-label="Members"
    >
      <header className="flex h-14 shrink-0 items-center justify-between px-4">
        <h2 className="text-sm font-semibold">
          Members{" "}
          <span className="text-muted-foreground tabular-nums">{members.length}</span>
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => openPicker("people")}
            data-testid="add-person"
            className={cn(
              "flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
              picker === "people" && "bg-muted text-foreground",
            )}
            aria-label="Add someone"
            aria-pressed={picker === "people"}
            title="Add someone"
          >
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close members panel"
          >
            <X className="size-4" />
          </button>
        </div>
      </header>

      {picker === "people" ? (
        <div className="border-b border-border/60 px-3 pb-3">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search people…"
            className="mb-2 w-full rounded-lg border border-input/50 bg-muted/40 px-2.5 py-1.5 text-xs outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="buzz-content-scrollbar max-h-72 overflow-y-auto">
            {people_.length === 0 ? (
              <p className="px-1 py-2 text-2xs text-muted-foreground">
                {searching
                  ? "Looking…"
                  : query.trim() === ""
                    ? "No other accounts to add."
                    : `Nobody matching “${query.trim()}”.`}
              </p>
            ) : (
              people_.map((person) => (
                <button
                  key={person.userId}
                  type="button"
                  onClick={() => {
                    onAddPerson(person.userId);
                    setPicker("none");
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-accent"
                >
                  <span className="truncate text-xs font-medium">
                    {person.username}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}

      {picker === "agents" ? (
        <div className="border-b border-border/60 px-3 pb-3">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search specialists…"
            className="mb-2 w-full rounded-lg border border-input/50 bg-muted/40 px-2.5 py-1.5 text-xs outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="buzz-content-scrollbar max-h-72 overflow-y-auto">
            {!rosterReady ? (
              <p className="px-1 py-2 text-2xs text-muted-foreground">
                The agent roster is not loaded, so there is nobody to bring in yet.
              </p>
            ) : availablePersonas.length === 0 ? (
              <p className="px-1 py-2 text-2xs text-muted-foreground">
                Nobody left matching that.
              </p>
            ) : (
              availablePersonas.map((persona) => (
                <button
                  key={persona.slug}
                  type="button"
                  onClick={() => {
                    onAddPersona(persona.slug);
                    setPicker("none");
                    setQuery("");
                  }}
                  className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-accent"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {persona.name}
                    </span>
                    <span className="block truncate text-3xs text-muted-foreground">
                      {persona.division}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}

      <div className="buzz-content-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <Section title={`People — ${people.length}`}>
          {people.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-2 rounded-lg px-1.5 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                {member.displayName}
              </span>
            </div>
          ))}
        </Section>

        <Section
          title={`Agents — ${agents.length}`}
          action={{
            label: "Add a specialist",
            active: picker === "agents",
            onClick: () => openPicker("agents"),
          }}
        >
          {agents.length === 0 ? (
            <p className="px-1.5 py-2 text-2xs leading-relaxed text-muted-foreground">
              No agents in this room. Add one and mention it by handle to bring it
              into the conversation.
            </p>
          ) : (
            agents.map((member) => (
              <div key={member.id} className="group rounded-lg px-1.5 py-1.5 hover:bg-muted/50">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {member.displayName}
                    </span>
                    <span className="block truncate text-3xs text-muted-foreground">
                      @{member.handle}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(member.id)}
                    className="hidden size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive group-hover:flex"
                    aria-label={`Remove ${member.displayName}`}
                  >
                    <UserMinus className="size-3.5" />
                  </button>
                </div>

                <div className="mt-1 flex flex-wrap gap-1 pl-9">
                  {(Object.keys(RESPOND_LABELS) as BuzzRespondTo[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => onRespondToChange(member.id, option)}
                      title={RESPOND_TITLES[option]}
                      className={cn(
                        "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-3xs transition-colors",
                        member.respondTo === option
                          ? "border-primary/60 bg-primary/15 text-foreground"
                          : "border-border/50 text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {member.respondTo === option ? (
                        <Check className="size-2.5" />
                      ) : null}
                      {RESPOND_LABELS[option]}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </Section>
      </div>
    </aside>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  /** The section's own way of adding to itself, if it has one. */
  action?: { label: string; active: boolean; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-1 px-1.5 pb-1">
        <p className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            aria-label={action.label}
            aria-pressed={action.active}
            title={action.label}
            className={cn(
              "ml-auto flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              action.active && "bg-muted text-foreground",
            )}
          >
            <Plus className="size-3.5" />
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}
