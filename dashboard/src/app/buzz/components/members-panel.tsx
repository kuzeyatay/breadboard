"use client";

// The right-hand panel: who is in the room, and how each of them behaves.
//
// The one control that matters here is "when does this agent speak". A room
// with several always-on agents answers every message several times, so the
// setting is on the member card rather than buried in a dialog — it is the
// difference between a useful room and an unreadable one.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Plus, UserMinus, X } from "lucide-react";

import { cn } from "@/app/buzz/lib/cn";
import { BREAD_PERSONA, BREAD_SLUG } from "@/lib/buzz/bread.ts";
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

/**
 * How much has to be typed before the people search runs.
 *
 * Not a performance guard — the query is one indexed LIKE over a small table.
 * It is about what a one-letter search *means*: "a" matched most of the
 * account table, so the picker's first useful state was a list of strangers
 * with a click target on each, and adding the wrong person is not a mistake
 * the clicker can undo. Three characters is roughly where the list stops being
 * everybody and starts being a search.
 */
const PEOPLE_SEARCH_MINIMUM = 3;

/** What the agents picker is currently showing. */
type AgentPickerGroup = "top" | "agency";

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
  /**
   * Offer someone a place in the room. Answers what happened, because the two
   * outcomes are different events: a colleague is seated at once, while
   * somebody outside the community is only *invited* to it and appears here if
   * and when they accept.
   */
  onAddPerson: (userId: number) => Promise<AddPersonOutcome> | AddPersonOutcome;
  onRemove: (memberId: number) => void;
  onRespondToChange: (memberId: number, respondTo: BuzzRespondTo) => void;
}) {
  // Two pickers, not one. People are real accounts and are searched on the
  // server; specialists are the local roster. Mixing them into a single list
  // meant "add a person" mostly returned agents.
  const [picker, setPicker] = useState<"none" | "people" | "agents">("none");
  const [agentGroup, setAgentGroup] = useState<AgentPickerGroup>("top");
  const [query, setQuery] = useState("");
  const [people_, setPeople] = useState<
    Array<{ userId: number; username: string }>
  >([]);
  const [searching, setSearching] = useState(false);
  /** What the last add attempt did, in the picker's own words. */
  const [notice, setNotice] = useState<string | null>(null);

  const people = members.filter((member) => member.kind === "human");
  const agents = members.filter((member) => member.kind === "agent");

  const inRoom = useMemo(
    () => new Set(members.map((member) => member.personaSlug).filter(Boolean)),
    [members],
  );

  const trimmed = query.trim();
  const searchable = trimmed.length >= PEOPLE_SEARCH_MINIMUM;

  const availablePersonas = personas
    .filter((persona) => !inRoom.has(persona.slug))
    .filter((persona) =>
      trimmed === ""
        ? true
        : `${persona.name} ${persona.division} ${persona.description}`
            .toLowerCase()
            .includes(trimmed.toLowerCase()),
    )
    .slice(0, 40);

  const openPicker = useCallback((next: "people" | "agents") => {
    setPicker((current) => (current === next ? "none" : next));
    setAgentGroup("top");
    setQuery("");
    setNotice(null);
  }, []);

  const closePicker = useCallback(() => {
    setPicker("none");
    setAgentGroup("top");
    setQuery("");
  }, []);

  /*
   * People come from the account table, debounced, and every answer is checked
   * against the query current when it lands — typing fast used to paint the
   * results of a prefix.
   *
   * Below the minimum nothing is requested and the last results are dropped,
   * so deleting back to two characters cannot leave a stale list on screen
   * that looks like an answer to what is now in the box.
   */
  useEffect(() => {
    if (picker !== "people") return;
    if (!searchable) {
      setPeople([]);
      setSearching(false);
      return;
    }
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
        if (cancelled || body.query !== trimmed) return;
        setPeople(body.people);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [picker, query, trimmed, searchable, roomPublicId, members.length]);

  const invite = async (person: { userId: number; username: string }) => {
    const outcome = await onAddPerson(person.userId);
    if (outcome.kind === "invited") {
      // The picker stays open and the search is cleared rather than closing:
      // inviting is the kind of thing done to two or three people at once, and
      // an invitation produces no visible member row, so closing the panel
      // would read as nothing having happened.
      setQuery("");
      setPeople([]);
      setNotice(
        `Invited ${outcome.username} to ${outcome.community}. They join when they accept.`,
      );
      return;
    }
    if (outcome.kind === "failed") {
      setNotice(outcome.message);
      return;
    }
    closePicker();
    setNotice(null);
  };

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
            onChange={(event) => {
              setQuery(event.target.value);
              setNotice(null);
            }}
            placeholder="Search people…"
            className="mb-2 w-full rounded-lg border border-input/50 bg-muted/40 px-2.5 py-1.5 text-xs outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          />
          {notice ? (
            <p className="px-1 pb-1.5 text-2xs leading-relaxed text-primary">
              {notice}
            </p>
          ) : null}
          <div className="buzz-content-scrollbar max-h-72 overflow-y-auto">
            {!searchable ? (
              <p className="px-1 py-2 text-2xs leading-relaxed text-muted-foreground">
                Type at least {PEOPLE_SEARCH_MINIMUM} letters of a name or email
                address to find someone.
              </p>
            ) : people_.length === 0 ? (
              <p className="px-1 py-2 text-2xs text-muted-foreground">
                {searching ? "Looking…" : `Nobody matching “${trimmed}”.`}
              </p>
            ) : (
              people_.map((person) => (
                <button
                  key={person.userId}
                  type="button"
                  onClick={() => void invite(person)}
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
          {agentGroup === "top" ? (
            /*
             * The top level is Breadboard's own agents. The agency roster is
             * behind one row rather than poured in beside them: it is a
             * catalog of a few hundred personas, and mixed into this list it
             * buried everything else under whichever specialist sorted first.
             */
            <div className="buzz-content-scrollbar max-h-72 overflow-y-auto pt-1">
              {inRoom.has(BREAD_SLUG) ? null : (
                <button
                  type="button"
                  onClick={() => {
                    onAddPersona(BREAD_SLUG);
                    closePicker();
                  }}
                  className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-accent"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {BREAD_PERSONA.name}
                    </span>
                    <span className="block text-3xs leading-relaxed text-muted-foreground">
                      {BREAD_PERSONA.description}
                    </span>
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setAgentGroup("agency");
                  setQuery("");
                }}
                className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-accent"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    Agency Agents
                  </span>
                  <span className="block truncate text-3xs text-muted-foreground">
                    {rosterReady
                      ? `${personas.length} specialists, by division`
                      : "Roster not loaded"}
                  </span>
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setAgentGroup("top");
                  setQuery("");
                }}
                className="mb-1.5 mt-1 flex items-center gap-1 rounded-md px-1 py-0.5 text-3xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="size-3" />
                Agency Agents
              </button>
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
                    The agent roster is not loaded, so there is nobody to bring in
                    yet.
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
                        closePicker();
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
            </>
          )}
        </div>
      ) : null}

      <div className="buzz-content-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <Section label="People" count={people.length}>
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
          label="Agents"
          count={agents.length}
          action={{
            label: "Add an agent",
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

/** What adding a person turned out to mean. */
export type AddPersonOutcome =
  | { kind: "seated" }
  | { kind: "invited"; username: string; community: string }
  | { kind: "failed"; message: string };

function Section({
  label,
  count,
  action,
  children,
}: {
  label: string;
  count: number;
  /** The section's own way of adding to itself, if it has one. */
  action?: { label: string; active: boolean; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-1 px-1.5 pb-1">
        {/*
         * `buzz-panel-label` is Breadboard's display face, set in
         * `buzz-host.css`. These headings used to be tracked-out micro-caps in
         * Inter, which at this size read as a row of loose letters rather than
         * a word — and the count hung off an em dash, which is punctuation for
         * an aside, not for a label and its value.
         */}
        <p className="buzz-panel-label text-2xs font-semibold text-muted-foreground">
          {label}
          <span className="tabular-nums">: {count}</span>
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
