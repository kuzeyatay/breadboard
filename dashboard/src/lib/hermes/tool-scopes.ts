// Per-surface tool allowlists.
//
// These are the curated Breadboard tools each surface's agent may use. They are
// enforced in two places: the Hermes agent permission config (defense at
// the runtime), and the capability token minted by the gateway (defense at the
// data boundary). A garden or Quartz agent can never be granted shell, file
// editing, git, package installation, or dynamic skill discovery — those names
// are simply absent from its allowlist, and its agent config denies them.

import type { HermesSurface } from "./config.ts";
import { isGBrainEnabled } from "../gbrain/config.ts";

// Read-only + proposal Breadboard tools for garden chat, plus two kinds of
// direct writer. `garden_save_note` adds a new note when the user asked for
// exactly that. The `GARDEN_STRUCTURE_TOOLS` below move notes and manage
// folders — they change where content lives, never what it says. Both are
// absent from QUARTZ_TOOLS, and their server implementations additionally
// require garden ownership.
export const GARDEN_TOOLS = [
  "garden_list",
  "garden_search",
  "garden_discover_sources",
  "garden_import_source",
  "garden_get_page",
  "garden_get_page_context",
  "garden_get_source_excerpt",
  "garden_get_source_figure",
  "garden_get_graph_neighbors",
  "garden_get_learning_spine",
  "garden_get_content_inventory",
  "garden_get_recent_events",
  "garden_list_files",
  "garden_save_note",
  "garden_create_folder",
  "garden_move_page",
  "garden_rename_folder",
  "garden_delete_folder",
  "garden_create_note_proposal",
  "garden_propose_page_revision",
  "garden_propose_visualization",
  "garden_run_proposal_validation",
] as const;

/**
 * Organizing a Garden — where a note sits, what the folders are called — is
 * innate Breadboard behaviour rather than a skill: the owner asking for it in
 * their own Garden is the approval, and a move is reversible by another move.
 * `garden_delete_folder` is the one exception the guidance treats as
 * irreversible; it removes the folder and every note inside it.
 */
export const GARDEN_STRUCTURE_TOOLS = [
  "garden_list_files",
  "garden_create_folder",
  "garden_move_page",
  "garden_rename_folder",
  "garden_delete_folder",
] as const;

/** Structure tools that mutate the Garden, so they need an owning writer. */
export const GARDEN_STRUCTURE_WRITE_TOOLS: readonly string[] =
  GARDEN_STRUCTURE_TOOLS.filter((tool) => tool !== "garden_list_files");

// Quartz page AI is read-only by default; write-like tools are proposal-only.
export const QUARTZ_TOOLS = [
  "garden_list",
  "garden_search",
  "garden_get_page",
  "garden_get_page_context",
  "garden_get_source_excerpt",
  "garden_get_source_figure",
  "garden_get_graph_neighbors",
  "garden_get_learning_spine",
  "garden_create_note_proposal",
  "garden_propose_page_revision",
  "garden_propose_visualization",
] as const;

// Read-only GBrain knowledge-retrieval tools. Available ONLY to authenticated
// Garden Chat and the authenticated Terminal — never anonymous/public Quartz AI.
// These never write: capture and edits route through Breadboard proposals.
export const GBRAIN_TOOLS = [
  "gbrain_status",
  "gbrain_search",
  "gbrain_retrieve",
  "gbrain_synthesize",
  "gbrain_graph_neighbors",
] as const;

export const ARTIFACT_TOOLS = [
  "artifact_create",
  "artifact_import",
  "artifact_read",
  "artifact_update",
  "artifact_append",
  "artifact_render",
  "artifact_finalize",
  "artifact_list",
  "artifact_search",
  "artifact_fork",
  "artifact_image_generate",
  "interactive_visualizer_create",
  "interactive_visualizer_plan",
  "interactive_visualizer_generate",
  "interactive_visualizer_revise",
  "interactive_visualizer_rollback",
  "interactive_visualizer_cancel",
] as const;

// Gadgets — small apps the agent writes on request. `gadget_bindings` is the
// read the model does first, so it writes code against the API that actually
// exists rather than one it remembers. Neither tool performs a gadget's writes:
// those are queued by the running gadget and approved by the user.
export const GADGET_TOOLS = [
  "gadget_bindings",
  "gadget_generate",
  "gadget_revise",
] as const;

// Durable cross-chat memory. Available only to the authenticated conversational
// surfaces (Garden Chat and Terminal); anonymous Quartz AI never writes memory.
// `memory_query` is the read half — one tool over the durable rows, the
// semantic index and the topic tree together, scoped to the same surfaces for
// the same reason: what the agent remembers about you is yours, and a surface
// that may not write it may not read it either.
export const MEMORY_TOOLS = ["save_memory", "memory_query"] as const;

// Offering an automation. Scoped like memory and for the same reasons: the
// noticing happens on ordinary turns, not only on super-agent ones, and what
// it writes is durable and personal. It is deliberately NOT in
// SUPER_AGENT_TOOLS beside `workflow_run` — running an automation and offering
// to build one are different grants, and only the first should need a
// super-agent turn.
export const WORKFLOW_PROPOSAL_TOOLS = ["workflow_propose"] as const;

// Direct authoring is a separate grant from unsolicited proposals. The route
// rechecks the active user's instruction before it writes, so Hermes can obey
// "create this workflow" while still being unable to turn its own suggestion
// into a durable automation.
export const WORKFLOW_AUTHORING_TOOLS = ["workflow_create"] as const;

// A correction learned while using one reviewed skill, kept beside it for next
// time. Scoped like memory — authenticated conversational surfaces only — and
// for the same reason: it writes something durable about the user's machine.
// It grants nothing. A lesson is prose stored against a slug; it cannot widen
// the turn's tools, roots or commands, and it is never written into the skill's
// own reviewed directory (see lib/hermes/skill-lessons.ts).
export const SKILL_LESSON_TOOLS = ["skill_lesson"] as const;

// Conversation-scoped first-party Premortem workflow. The callback executes
// only a bounded CLI allowlist inside the session's isolated runtime directory.
export const PREMORTEM_TOOLS = ["premortem_run"] as const;

// First-party video analysis. The server owns runtime resolution, workspace
// containment, process limits, and URL validation; the model supplies only the
// bounded video-analysis options.
export const WATCH_TOOLS = ["watch_run"] as const;

// The deterministic scripts of the cloned bullshit-detector pack: fetch a URL
// into normalized text, count independent origins behind a claim, and run the
// two gates over a finished report. The model picks a command from a fixed
// allowlist and a subject; it never names a script, an interpreter, or a path
// outside this conversation's workspace, and `fetch` accepts http(s) only.
export const FACTCHECK_TOOLS = ["factcheck_run"] as const;

// Read-only access to the pinned patent-disclosure pack's routed prompts,
// schemas, examples and explanatory docs. The server owns the source root and
// accepts only reviewed text paths; scripts and arbitrary filesystem paths are
// not part of this tool.
export const PATENT_DISCLOSURE_TOOLS = ["patent_disclosure_guide"] as const;

// First-party single-image 3D reconstruction on the local Stable Fast 3D
// runtime. The tool has no image argument that carries data: it names a picture
// already attached to this conversation, and the server resolves the bytes from
// a message the caller owns. Nothing it can reach reads a path, a URL, or a
// data URL the model wrote.
export const IMAGE_TO_3D_TOOLS = ["image_to_3d"] as const;

// First-party audio analysis on the local Rust analyzer. Like the 3D tool, the
// arguments name a track already attached to this conversation rather than
// carrying or pointing at a file: the server resolves the stored bytes from a
// message the caller owns, so no path the model wrote is ever opened.
export const AUDIO_ANALYSIS_TOOLS = ["audio_analyze", "audio_compare"] as const;

// Provider-backed identification of one audio attachment from this exact
// conversation. The server resolves the blob reference and owns the provider
// credential; the model can neither upload raw bytes nor choose a URL/path.
export const MUSIC_RECOGNITION_TOOLS = ["music_recognize"] as const;

// Guarded Manim Community rendering. Generated source executes only inside a
// pinned, network-disabled container and the server imports the verified MP4.
export const MANIM_TOOLS = ["manim_create"] as const;

// Cloned Agent Loop Engineering Kit. The callback designs, checks and dry-runs
// a loop contract inside the session's workspace; it never executes the loop's
// real task and never creates cron, webhook or Kanban automation.
export const AGENT_LOOP_TOOLS = ["agent_loop_run"] as const;

// Cloned oh-my-hermes operating layer. The callback runs one read-only OMH
// command — routing, recommendation, catalog or health — against the clone's
// own local data with its OMH and Hermes homes pinned inside the session
// workspace. Nothing it can reach installs, mutates, or spawns an executor.
export const OMH_TOOLS = ["omh_run"] as const;

// Outbound messaging to the owner's own WhatsApp or Telegram. The server owns
// the destination — the tool has no recipient argument — so the only thing this
// scope can reach is the account that linked the messaging service.
export const MESSAGING_TOOLS = ["messaging_send"] as const;

// Recall — the user's own local screen and audio history. Reading is gated by
// the per-user `agentAccess` setting at call time, so revoking it in Settings →
// Recall takes effect on the next call rather than at the next session. Control
// is narrower still: `recall_control` only starts or stops capture, and unless
// the user set it to always-allow the runtime asks them first. Nothing here
// reaches UI automation or pipe execution — those act on the computer, and the
// tools that would are simply not offered.
export const RECALL_TOOLS = [
  "recall_status",
  "recall_search",
  "recall_activity",
  "recall_meetings",
  "recall_frame_context",
  "recall_control",
] as const;

/** The one Recall tool that changes anything; the rest are reads. */
export const RECALL_CONTROL_TOOLS: readonly string[] = ["recall_control"];

/**
 * Feature switch, read from the environment rather than through the Recall
 * config module so this file stays free of Node built-ins.
 */
export function isRecallEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = (env.RECALL_ENABLED ?? "").trim();
  if (!raw) return true;
  return /^(1|true|yes|on)$/i.test(raw);
}

// The world monitor at /worldmonitor, queried instead of read off the screen.
// Every one of these is a read over public news feeds and open observational
// archives — there is no user-owned state behind them to change, which is why
// this scope has no counterpart to `recall_control`.
export const WORLDMONITOR_TOOLS = [
  "worldmonitor_catalog",
  "worldmonitor_snapshot",
  "worldmonitor_search",
  "worldmonitor_climate",
  "weather_forecast",
] as const;

// Google image search, served by the vendored mcp-google-images-search MCP
// server. A read over Google's public image index and nothing else: the tool
// takes a query and returns links plus display metadata, so like the world
// monitor there is no user-owned state behind it to change.
export const IMAGE_SEARCH_TOOLS = ["image_search"] as const;

// Sourced product discovery. This is a read over public product pages; the
// route returns a versioned Breadboard UI resource as data, never component
// code or third-party HTML.
export const PRODUCT_SEARCH_TOOLS = ["product_search"] as const;

// Search over the signed-in user's own durable chat history. The server
// applies the active surface (and active Garden on Garden Chat), excludes
// temporary conversations, and returns navigation-only UI resources.
export const CHAT_SEARCH_TOOLS = ["chat_search"] as const;

// What Breadboard is doing for the signed-in person right now: document
// uploads, Learn runs, transcriptions, agent runs, schedules and the rest.
// A read over the same job tables the product's own panels poll, scoped to
// the user (and the active Garden on Garden Chat); it changes nothing.
export const PROCESS_STATUS_TOOLS = ["breadboard_process_status"] as const;

// The map at /map, and the geographic state behind it. Every one of these is a
// read of an external open-data service (Photon, Nominatim, Valhalla, Overpass)
// plus a write to Breadboard's own conversation-scoped geographic state — the
// selected place, the active route, the last POI answer. That state is not user
// data in the sense the Garden or the calendar are: it is the working memory of
// the map, it is rebuilt by the next lookup, and nothing here can delete
// anything. The tools exist so geographic facts come from map data instead of
// from the model, which is why the scope is offered on every authenticated
// conversational surface and never to anonymous Quartz.
export const MAP_TOOLS = [
  "map_search",
  "map_reverse",
  "map_route",
  "map_nearby",
  "map_place_details",
  "map_get_current_location",
  "map_get_viewport",
  "map_get_selected_place",
] as const;

// Spotify's first-party connected-app tools. Search is read-only; play can
// start or control Breadboard's inline player (or a phone explicitly requested
// by the user) and records queues for the conversation's player.
export const SPOTIFY_TOOLS = [
  "spotify_search",
  "spotify_play",
  "spotify_create_playlist",
] as const;

// The calendar at /calendar. Hermes can read and manage events, including
// turning "remind me" requests into real calendar entries. The user id comes
// from the verified session, never from an argument, and the CalendarStore
// still enforces ownership and read-only subscription boundaries.
export const CALENDAR_TOOLS = [
  "calendar_list_calendars",
  "calendar_agenda",
  "calendar_search_events",
  "calendar_get_event",
  "calendar_create_event",
  "calendar_update_event",
  "calendar_delete_event",
] as const;

/** Calendar operations that persist a change, for audit and UI descriptions. */
export const CALENDAR_WRITE_TOOLS: readonly string[] = [
  "calendar_create_event",
  "calendar_update_event",
  "calendar_delete_event",
];

// The Plan board at /plan. Unlike the calendar this scope writes: the board is
// meant to be kept by the assistant as well as by the user, which is the whole
// point of having one. What it cannot do is destroy — there is no tool here that
// deletes a card, a column or a project, so the worst an agent can do is put
// something in the wrong column, which costs one drag to undo. The user id comes
// from the verified session, never from an argument.
export const PLAN_TOOLS = [
  "plan_list_projects",
  "plan_board",
  "plan_search_tasks",
  "plan_upcoming",
  "plan_get_task",
  "plan_create_task",
  "plan_update_task",
  "plan_move_task",
  "plan_comment_task",
] as const;

/** The Plan tools that change something, for auditing and for the UI's copy. */
export const PLAN_WRITE_TOOLS: readonly string[] = [
  "plan_create_task",
  "plan_update_task",
  "plan_move_task",
  "plan_comment_task",
];

// OfficeCLI document authoring. `office_run` executes one command of the
// pinned OfficeCLI binary against .docx/.xlsx/.pptx files confined to the
// turn's workspace — the binary's own path containment is the gate, mirroring
// the agent-loop kit. `office_export` registers a finished document as an
// artifact, with an OfficeCLI-rendered HTML snapshot as its preview.
export const OFFICE_TOOLS = [
  "office_run",
  "office_export",
] as const;

/** Both Office tools can change something, for auditing and the UI's copy. */
export const OFFICE_WRITE_TOOLS: readonly string[] = [
  "office_run",
  "office_export",
];

// In-process editing of existing OOXML files plus local PDF → DOCX. Unlike
// OfficeCLI, this surface never authors a new document from commands: it opens
// bytes already in the workspace, applies anchored patches, and publishes the
// resulting file through the artifact importer.
export const DOCUMENT_TOOLS = ["document_edit", "pdf_to_docx"] as const;

/** Inspection is a mode of document_edit, but both tool families may write. */
export const DOCUMENT_WRITE_TOOLS: readonly string[] = ["document_edit", "pdf_to_docx"];

// watermarks-remover: report and strip AI provenance marks — invisible Unicode
// carriers, C2PA/Content Credentials, EXIF/XMP, document container properties.
// The vendored scripts are stdlib Python, and every path they are handed is
// confined to the turn's workspace; an attached file is addressed by the name
// the user attached it under, never by a path the model composed.
export const WATERMARK_TOOLS = [
  "watermark_inspect",
  "watermark_clean",
  "watermark_audit",
] as const;

/** The one that writes a file, for auditing and the UI's copy. */
export const WATERMARK_WRITE_TOOLS: readonly string[] = ["watermark_clean"];

// The local humanizer: rewrite prose through the loopback BART service behind
// its preservation gates. Read-only in every sense that matters — the tools
// return text and never touch a message, a note or a file, so there is no write
// list here. The response action regenerates a normal conversation branch; it
// does not grant the tool a write capability.
export const HUMANIZER_TOOLS = ["humanize_text", "humanize_status"] as const;

// Hermes Agent's own cross-platform, background-only cua-driver surface. It is
// listed here so the first-party skill has a declared executable path; the
// immutable Hermes session toolset and the computer-use guidance provide the
// runtime and last-resort gates.
export const COMPUTER_USE_TOOLS = ["computer_use"] as const;
export const BREADBOARD_USE_TOOLS = ["breadboard_use"] as const;

// The build loop: read a file, change it, look for the next thing to change.
// Hermes ships its own `file` toolset and it stays off — those tools take
// absolute paths and enforce no root, so they would reach the whole filesystem
// outside the capability decision. These are the same four verbs confined to
// the session's own workspace, the root `agent_loop_run` already works in.
export const WORKSPACE_TOOLS = [
  "workspace_read",
  "workspace_write",
  "workspace_patch",
  "workspace_list",
  "workspace_search",
] as const;

/** The two that change the workspace, for auditing and the UI's copy. */
export const WORKSPACE_WRITE_TOOLS: readonly string[] = [
  "workspace_write",
  "workspace_patch",
];

// The coverage-driven research pipeline. Super agent only, and for a reason
// beyond cost: these tools hold a conversation-scoped research state whose whole
// value is that the stopping decision is taken away from the model. Offering
// them on an ordinary turn would put a multi-round protocol in front of a
// question that wants one search and an answer. See lib/research/.
export const RESEARCH_TOOLS = [
  "research_begin",
  "research_record",
  "research_status",
] as const;

// Super agent only. `skill_open` returns the guidance of one reviewed skill the
// user already has installed — the same text typing `/its-slug` would inject —
// so the agent can pick its own instrument instead of waiting to be handed one.
// `workflow_run` runs one of the user's own saved automations and returns its
// result. `agent_launch` queues one of the runtime agents for the chat surface to
// start, which is the only way an agent that owns its own turn can be chosen by
// anything but the user. All three are inert outside a super-agent turn: the
// capability decision the tool route revalidates does not list them.
export const SUPER_AGENT_TOOLS = [
  "skill_open",
  "workflow_run",
  "agent_launch",
  ...RESEARCH_TOOLS,
] as const;

// Documents distilled into book-to-skill skills. Read-only, and scoped by the
// session's own user: the model can open a chapter of a document the user put
// in front of it, and nothing else. Available wherever a user can attach a file
// or select a garden document — which is every authenticated chat surface.
export const DOCUMENT_SKILL_TOOLS = ["document_skill_read"] as const;

export type GardenToolName = (typeof GARDEN_TOOLS)[number];

/** Tools whose invocation produces a typed proposal rather than a mutation. */
export const PROPOSAL_TOOLS: readonly string[] = [
  "garden_create_note_proposal",
  "garden_propose_page_revision",
  "garden_propose_visualization",
];

export function allowedToolsForSurface(surface: HermesSurface): string[] {
  // GBrain knowledge tools are added ONLY for authenticated Garden Chat and
  // Terminal, and only when GBrain is enabled. Quartz AI never receives them.
  const gbrain = isGBrainEnabled() ? [...GBRAIN_TOOLS] : [];
  // Recall reaches the user's own machine history, so it follows the same rule
  // as GBrain: authenticated conversational surfaces only, never Quartz.
  const recall = isRecallEnabled() ? [...RECALL_TOOLS] : [];
  if (surface === "garden_chat") {
    return [
      ...GARDEN_TOOLS,
      ...ARTIFACT_TOOLS,
      ...GADGET_TOOLS,
      ...MEMORY_TOOLS,
      ...WORKFLOW_PROPOSAL_TOOLS,
      ...WORKFLOW_AUTHORING_TOOLS,
      ...DOCUMENT_SKILL_TOOLS,
      ...PREMORTEM_TOOLS,
      ...FACTCHECK_TOOLS,
      ...PATENT_DISCLOSURE_TOOLS,
      ...WATCH_TOOLS,
      ...IMAGE_TO_3D_TOOLS,
      ...AUDIO_ANALYSIS_TOOLS,
      ...MUSIC_RECOGNITION_TOOLS,
      ...MANIM_TOOLS,
      ...AGENT_LOOP_TOOLS,
      ...OMH_TOOLS,
      ...MESSAGING_TOOLS,
      ...WORLDMONITOR_TOOLS,
      ...IMAGE_SEARCH_TOOLS,
      ...PRODUCT_SEARCH_TOOLS,
      ...CHAT_SEARCH_TOOLS,
      ...PROCESS_STATUS_TOOLS,
      ...MAP_TOOLS,
      ...SPOTIFY_TOOLS,
      ...CALENDAR_TOOLS,
      ...PLAN_TOOLS,
      ...OFFICE_TOOLS,
      ...DOCUMENT_TOOLS,
      ...WATERMARK_TOOLS,
    ...HUMANIZER_TOOLS,
      ...HUMANIZER_TOOLS,
      ...COMPUTER_USE_TOOLS,
      ...BREADBOARD_USE_TOOLS,
      ...WORKSPACE_TOOLS,
      ...SUPER_AGENT_TOOLS,
      ...gbrain,
      ...recall,
      "mcp_call",
    ];
  }
  if (surface === "quartz_ai") return [...QUARTZ_TOOLS];
  // The dashboard terminal's tools are governed by the Hermes agent config
  // and per-action permission prompts, not by a fixed Breadboard allowlist.
  return [
    ...GARDEN_TOOLS,
    ...ARTIFACT_TOOLS,
    ...GADGET_TOOLS,
    ...MEMORY_TOOLS,
    ...WORKFLOW_PROPOSAL_TOOLS,
    ...WORKFLOW_AUTHORING_TOOLS,
    ...DOCUMENT_SKILL_TOOLS,
    ...PREMORTEM_TOOLS,
    ...FACTCHECK_TOOLS,
    ...PATENT_DISCLOSURE_TOOLS,
    ...WATCH_TOOLS,
    ...IMAGE_TO_3D_TOOLS,
    ...AUDIO_ANALYSIS_TOOLS,
    ...MUSIC_RECOGNITION_TOOLS,
    ...MANIM_TOOLS,
    ...AGENT_LOOP_TOOLS,
    ...OMH_TOOLS,
    ...MESSAGING_TOOLS,
    ...WORLDMONITOR_TOOLS,
    ...IMAGE_SEARCH_TOOLS,
    ...PRODUCT_SEARCH_TOOLS,
    ...CHAT_SEARCH_TOOLS,
    ...PROCESS_STATUS_TOOLS,
    ...MAP_TOOLS,
    ...SPOTIFY_TOOLS,
    ...CALENDAR_TOOLS,
    ...PLAN_TOOLS,
    ...OFFICE_TOOLS,
    ...DOCUMENT_TOOLS,
    ...WATERMARK_TOOLS,
    ...HUMANIZER_TOOLS,
    ...COMPUTER_USE_TOOLS,
    ...BREADBOARD_USE_TOOLS,
    ...WORKSPACE_TOOLS,
    ...SUPER_AGENT_TOOLS,
    ...gbrain,
    ...recall,
    "terminal_execute_command",
    "browser_terminal",
    "capability_gap",
    "capability_search",
    "mcp_call",
  ];
}

export function isProposalTool(tool: string): boolean {
  return PROPOSAL_TOOLS.includes(tool);
}
