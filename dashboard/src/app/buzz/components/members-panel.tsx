"use client";



import { useEffect, useMemo, useState } from "react";

import { ChevronLeft, ChevronRight, Plus, UserMinus, X } from "lucide-react";

import { cn } from "@/app/buzz/lib/cn";

import { BREAD_PERSONA, BREAD_SLUG } from "@/lib/buzz/bread.ts";

import { ROOM_RUNTIME_AGENTS, runtimeSlug } from "@/lib/buzz/runtime-catalog.ts";

import { requestJson } from "../lib/message-state";

import type { BuzzMember, BuzzPersona, BuzzRespondTo } from "../types";



export type AddPersonOutcome = { kind: "seated" } | { kind: "invited"; username: string; community: string } | { kind: "failed"; message: string };

const RESPONSES: Array<{ value: BuzzRespondTo; label: string; title: string }> = [

  { value: "always", label: "Always", title: "Respond to every message unless another agent is addressed" },

  { value: "mention", label: "Mentions", title: "Respond when mentioned by handle" },

  { value: "never", label: "Off", title: "Do not respond, including to mentions" },

];



export function MembersPanel({ members, personas, roomPublicId, rosterReady, selfMemberId, canManage = false, onClose, onAddPersona, onAddPerson, onRemove, onRespondToChange }: {

  members: BuzzMember[]; personas: BuzzPersona[]; roomPublicId: string | null; rosterReady: boolean; selfMemberId?: number | null; canManage?: boolean;

  onClose: () => void;

  onAddPersona: (slug: string) => Promise<AddPersonOutcome> | AddPersonOutcome | void;

  onAddPerson: (userId: number) => Promise<AddPersonOutcome> | AddPersonOutcome;

  onRemove: (memberId: number) => Promise<void> | void;

  onRespondToChange: (memberId: number, respondTo: BuzzRespondTo) => Promise<void> | void;

}) {

  const [picker, setPicker] = useState<"none" | "people" | "agents">("none");

  const [agency, setAgency] = useState(false);

  const [query, setQuery] = useState("");

  const [results, setResults] = useState<Array<{ userId: number; username: string }>>([]);

  const [notice, setNotice] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);

  const [searching, setSearching] = useState(false);

  const people = members.filter(member => member.kind === "human");

  const agents = members.filter(member => member.kind === "agent");

  const seated = useMemo(() => new Set(agents.map(member => member.personaSlug)), [agents]);

  const native = [

    { slug: BREAD_SLUG, name: BREAD_PERSONA.name, description: BREAD_PERSONA.description },

    ...ROOM_RUNTIME_AGENTS.map(agent => ({ slug: runtimeSlug(agent.id), name: agent.name, description: agent.command })),

  ];

  const choices = (agency ? personas : native).filter(agent => !seated.has(agent.slug) && `${agent.name} ${agent.description}`.toLowerCase().includes(query.toLowerCase()));

  const openPicker = (next: "people" | "agents") => { setPicker(picker === next ? "none" : next); setAgency(false); setQuery(""); setNotice(null); };



  useEffect(() => {

    if (picker !== "people" || query.trim().length < 3) { setResults([]); return; }

    const controller = new AbortController();

    const timer = setTimeout(async () => {

      setSearching(true);

      try {

        const body = await requestJson<{ people: typeof results }>(`/api/buzz/people?q=${encodeURIComponent(query.trim())}&roomId=${encodeURIComponent(roomPublicId ?? "")}`, { signal: controller.signal });

        if (!controller.signal.aborted) { setResults(body.people); setNotice(null); }

      } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "People could not be found."); }

      finally { if (!controller.signal.aborted) setSearching(false); }

    }, 160);

    return () => { controller.abort(); clearTimeout(timer); };

  }, [picker, query, roomPublicId]);



  const action = async (work: () => Promise<void> | void) => {

    if (busy) return;

    setBusy(true); setNotice(null);

    try { await work(); } catch (error) { setNotice(error instanceof Error ? error.message : "That change could not be saved."); }

    finally { setBusy(false); }

  };

  const add = (work: () => Promise<AddPersonOutcome> | AddPersonOutcome | void) => action(async () => {

    const outcome = await work();

    if (outcome?.kind === "failed") { setNotice(outcome.message); return; }

    if (outcome?.kind === "invited") { setNotice(`Invited ${outcome.username} to ${outcome.community}. They join when they accept.`); setQuery(""); setResults([]); return; }

    setPicker("none"); setQuery("");

  });



  return (

    <aside className="buzz-aux-panel buzz-members-panel flex w-[264px] shrink-0 flex-col border-l border-border/40" aria-label="Members">

      <header className="flex h-14 shrink-0 items-center justify-between px-4">

        <h2 className="text-sm font-semibold">Members <span className="ml-1 text-muted-foreground tabular-nums">{members.length}</span></h2>

        <div className="flex gap-1">

          {canManage ? <button className="neu-button flex size-8 items-center justify-center rounded-full" aria-label="Add someone" data-testid="add-person" aria-pressed={picker === "people"} onClick={() => openPicker("people")}><Plus className="size-4" /></button> : null}

          <button className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted" aria-label="Close members panel" onClick={onClose}><X className="size-4" /></button>

        </div>

      </header>

      {notice ? <p role="status" className="mx-3 mb-3 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed">{notice}</p> : null}

      {picker !== "none" && canManage ? <div className="border-b border-border/40 px-3 pb-3">

        {picker === "agents" && agency ? <button className="mb-2 flex items-center gap-1 text-xs text-muted-foreground" onClick={() => { setAgency(false); setQuery(""); }}><ChevronLeft className="size-3.5" />Breadboard agents</button> : null}

        <input autoFocus aria-label={picker === "people" ? "Search people" : "Search agents"} value={query} onChange={event => setQuery(event.target.value)} placeholder={picker === "people" ? "Search people…" : agency ? "Search Agency Agents…" : "Search Breadboard agents…"} className="neu-control mb-2 w-full rounded-xl px-3 py-2 text-xs outline-hidden" />

        <div className="buzz-content-scrollbar max-h-72 overflow-y-auto">

          {picker === "people" ? query.trim().length < 3 ? <p className="px-1 py-2 text-xs leading-relaxed text-muted-foreground">Type at least 3 letters of a name or email address.</p> : searching ? null : results.length ? results.map(person => <button key={person.userId} disabled={busy} onClick={() => void add(() => onAddPerson(person.userId))} className="w-full rounded-lg px-2 py-2 text-left text-xs hover:bg-muted">{person.username}</button>) : <p className="p-2 text-xs text-muted-foreground">Nobody matching “{query.trim()}”.</p> : <>

            {choices.map(agent => <button key={agent.slug} disabled={busy} onClick={() => void add(() => onAddPersona(agent.slug))} className="block w-full rounded-xl px-2 py-2.5 text-left hover:bg-muted">

              <span className="block text-xs font-medium">{agent.name}</span><span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{agent.description}</span>

            </button>)}

            {!agency ? <button className="mt-1 flex w-full items-center justify-between rounded-xl border-t border-border/40 px-2 py-3 text-left text-xs" onClick={() => { setAgency(true); setQuery(""); }}><span>Agency Agents<span className="mt-1 block text-[11px] text-muted-foreground">{rosterReady ? `${personas.length} specialists, by division` : "Roster unavailable"}</span></span><ChevronRight className="size-4" /></button> : null}

            {agency && choices.length === 0 ? <p className="p-2 text-xs text-muted-foreground">No matching specialists.</p> : null}

          </>}

        </div>

      </div> : null}

      <div className="buzz-content-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3">

        <section aria-label="People" className="mb-5">

          <p className="buzz-panel-label mb-2 px-1 text-xs font-semibold text-muted-foreground">People<span className="tabular-nums">: {people.length}</span></p>

          {people.map(member => <div key={member.id} className="group flex min-h-9 items-center justify-between rounded-lg px-1"><span className="truncate text-xs">{member.displayName}</span>{canManage && member.id !== selfMemberId ? <button disabled={busy} onClick={() => void action(() => onRemove(member.id))} className="flex size-7 items-center justify-center rounded-lg text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-muted hover:text-destructive" aria-label={`Remove ${member.displayName}`}><UserMinus className="size-3.5" /></button> : null}</div>)}

        </section>

        <section aria-label="Agents">

          <div className="mb-2 flex items-center justify-between px-1"><p className="buzz-panel-label text-xs font-semibold text-muted-foreground">Agents<span className="tabular-nums">: {agents.length}</span></p>{canManage ? <button className="neu-button flex size-7 items-center justify-center rounded-full" aria-label="Add an agent" aria-pressed={picker === "agents"} onClick={() => openPicker("agents")}><Plus className="size-3.5" /></button> : null}</div>

          {!agents.length ? <p className="px-1 py-2 text-xs leading-relaxed text-muted-foreground">{canManage ? "Add Bread or a specialist to work with your team." : "No agents in this room yet."}</p> : null}

          {agents.map(member => <div key={member.id} className="buzz-member-card mb-3 rounded-2xl p-3">

            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs font-semibold">{member.displayName}</p><p className="mt-0.5 truncate text-[11px] text-muted-foreground">@{member.handle}</p></div>{canManage ? <button disabled={busy} aria-label={`Remove ${member.displayName}`} onClick={() => void action(() => onRemove(member.id))} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"><UserMinus className="size-3.5" /></button> : null}</div>

            <p className="mb-1.5 mt-3 text-[11px] text-muted-foreground">Replies</p>

            <div className="neu-segmented flex gap-0.5 rounded-xl p-1" role="group" aria-label={`${member.displayName} replies`}>

              {RESPONSES.map(option => <button key={option.value} disabled={!canManage || busy} aria-pressed={member.respondTo === option.value} title={option.title} onClick={() => void action(() => onRespondToChange(member.id, option.value))} className={cn("buzz-response-option min-h-7 flex-1 rounded-lg px-1 text-[11px] font-medium", member.respondTo === option.value && "is-selected")}>{option.label}</button>)}

            </div>

          </div>)}

        </section>

      </div>

    </aside>

  );

}
