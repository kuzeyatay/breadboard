"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import type {
  CommandHubItem,
  CommandHubItemKind,
} from "@/lib/hermes/commands.ts";
import type { HermesSurface } from "@/lib/hermes/config.ts";
import type { LocalWorkflowSummary } from "@/lib/workflows/types";
import {
  loadAgencyAgentsClientCatalog,
  type PublicAgencyAgent,
} from "@/lib/hermes/agency-agents-client";
import {
  AGENCY_AGENTS_DIRECTORY_COMMAND,
  agencyAgentToken,
} from "@/lib/hermes/agency-agent-command";
import {
  commandResponseUrl,
  invalidateCommandResponseCache,
  loadCachedCommandResponse,
  peekCachedCommandResponse,
} from "@/lib/hermes/command-client-cache";
import {
  loadCachedSkillsCatalog,
  skillsCatalogUrl,
} from "@/lib/hermes/skills-catalog-client-cache";
import { AGENT_TARS_SLASH_COMMAND } from "@/lib/ui-tars/identity.ts";
import { AGENT_BROWSER_SLASH_COMMAND } from "@/lib/agent-browser/identity.ts";
import { AGENT_REACH_COMMAND } from "@/lib/agent-reach/identity.ts";
import { CAREER_OPS_COMMAND } from "@/lib/career-ops/identity.ts";
import { OPENEXECUTIVE_COMMAND } from "@/lib/openexecutive/identity.ts";
import { OPEN_GYM_COMMAND } from "@/lib/open-gym/identity.ts";
import { VIBE_TRADING_COMMAND } from "@/lib/vibe-trading/identity.ts";
import { STOCK_ANALYST_COMMAND } from "@/lib/stock-analyst/identity.ts";
import { DEER_FLOW_COMMAND } from "@/lib/deer-flow/identity.ts";
import { SHORTS_COMMAND } from "@/lib/shorts/identity.ts";
import { FORMSMITH_COMMAND } from "@/lib/shaper/identity.ts";
import { DEEP_RESEARCH_SLASH_COMMAND } from "@/lib/deep-research/identity.ts";
import { GET_DOC_COMMAND } from "@/lib/get-doc/identity.ts";
import { MEETING_NOTES_COMMAND } from "@/lib/meeting-notes/identity.ts";
import { DEEP_TUTOR_COMMAND } from "@/lib/deep-tutor/identity.ts";
import { OPENPLANTER_COMMAND } from "@/lib/openplanter/identity.ts";
import { SOCIALS_MANAGER_COMMAND } from "@/lib/socials-manager/identity.ts";
import { HARDWARE_BLUEPRINT_COMMAND } from "@/lib/hardware/identity.ts";
import { PARAMETRIC_CAD_COMMAND } from "@/lib/cad/identity.ts";
import { HYPERFRAMES_COMMAND } from "@/lib/hyperframes/identity.ts";
import { RESOURCE2SKILL_COMMAND } from "@/lib/resource2skill/identity.ts";
import { MATRAIX_COMMAND } from "@/lib/matraix/identity.ts";
import { BOLT_SLIDES_COMMAND } from "@/lib/bolt-slides/identity.ts";
import { CLASSROOM_COMMAND } from "@/lib/classroom/identity.ts";
import { GODS_EYE_COMMAND } from "@/lib/gods-eye/identity.ts";
import { OPENMONTAGE_COMMAND } from "@/lib/openmontage/identity.ts";
import { OPENWORK_COMMAND } from "@/lib/openwork/identity.ts";
import { OPENSCIENCE_COMMAND } from "@/lib/openscience/identity.ts";
import { PRAXIST_COMMAND } from "@/lib/praxist/identity.ts";
import { MAX_RESEARCH_COMMAND } from "@/lib/max-research/identity.ts";
import { INBOX_ZERO_COMMAND } from "@/lib/inbox-zero/identity.ts";
import { VIMAX_COMMAND } from "@/lib/vimax/identity.ts";
import { VOX_DIRECTOR_COMMAND } from "@/lib/vox-director/identity.ts";
import { MONEY_PRINTER_COMMAND } from "@/lib/money-printer/identity.ts";
import { LEGAL_COMMAND } from "@/lib/legal/identity.ts";
import { WARDROBE_COMMAND } from "@/lib/wardrobe/identity.ts";
import { CODEX_COMMAND } from "@/lib/codex/identity.ts";
import { OPENCODE_COMMAND } from "@/lib/opencode/identity.ts";
import { RUFLO_COMMAND } from "@/lib/ruflo/identity.ts";
import {
  ARIS_AGENT_COMMAND,
  ARIS_AGENT_SLUG,
} from "@/lib/aris/identity.ts";
import {
  SPOTIFY_AGENT_COMMAND,
  SPOTIFY_AGENT_SLUG,
} from "@/lib/spotify-agent/identity.ts";
import SkillsCatalogPanel from "./skills-catalog-panel";
import WorkflowTemplatesPanel from "./workflow-templates-panel";
import ReferenceChatsPanel from "./reference-chats-panel";
import ReloadableFetchError from "@/app/components/reloadable-fetch-error";
import FavoriteBox, {
  DEFAULT_CAPABILITY_HIGHLIGHT_COLOR,
  capabilityHighlightStyle,
} from "./favorite-box";

// Loaded only when the operator is opened, so the composer stays light.
const BrowserOperatorDialog = dynamic(
  () => import("@/app/components/agents/browser-operator").then((m) => m.BrowserOperatorDialog),
  { ssr: false },
);

const SocialsManagerSettingsDialog = dynamic(
  () => import("./socials-manager-settings-dialog"),
  { ssr: false },
);

const AgentReachSettingsDialog = dynamic(
  () => import("./agent-reach-settings-dialog"),
  { ssr: false },
);

const HyperframesSettingsDialog = dynamic(
  () => import("./hyperframes-settings-dialog"),
  { ssr: false },
);

const Resource2SkillSettingsDialog = dynamic(
  () => import("./resource2skill-settings-dialog"),
  { ssr: false },
);

const BoltSlidesSettingsDialog = dynamic(() => import("./bolt-slides-settings-dialog"), {
  ssr: false,
});
const ClassroomSettingsDialog = dynamic(() => import("./classroom-settings-dialog"), {
  ssr: false,
});
const GodsEyeSettingsDialog = dynamic(() => import("./gods-eye-settings-dialog"), {
  ssr: false,
});
const MatraixSettingsDialog = dynamic(() => import("./matraix-settings-dialog"), {
  ssr: false,
});

const OpenMontageSettingsDialog = dynamic(
  () => import("./openmontage-settings-dialog"),
  { ssr: false },
);

const OpenworkSettingsDialog = dynamic(
  () => import("./openwork-settings-dialog"),
  { ssr: false },
);

const OpenscienceSettingsDialog = dynamic(
  () => import("./openscience-settings-dialog"),
  { ssr: false },
);

const WardrobeSettingsDialog = dynamic(
  () => import("./wardrobe-settings-dialog"),
  { ssr: false },
);

const InboxZeroSettingsDialog = dynamic(
  () => import("./inbox-zero-settings-dialog"),
  { ssr: false },
);

// The panel for the agents whose only settings are the defaults a run starts
// from; the agents above put those same defaults inside their own panel.
const AgentSettingsDialog = dynamic(
  () => import("./agent-settings-dialog"),
  { ssr: false },
);

const LEGACY_PROMPTS_KEY = "sb_prompts_v1";
const RECENTS_KEY = "breadboard:command-hub:recents:v1";
const FAVORITES_KEY = "breadboard:command-hub:favorites:v1";
const HIGHLIGHT_COLORS_KEY = "breadboard:command-hub:highlight-colors:v1";
const MIGRATION_KEY = "breadboard:prompt-library:server-migrated:v1";

// App connections moved to Settings → Connections: signing an account in is
// setup, done once, not something you pick mid-request.
type PaletteTab = "skill" | "workflow" | "agent" | "prompt" | "reference";
type DetailView =
  | "new-prompt"
  | "manage-prompts"
  | null;

type CommandResponse = {
  groups: {
    skills: CommandHubItem[];
    mcp: CommandHubItem[];
    prompts: CommandHubItem[];
    agents: CommandHubItem[];
  };
  capability: {
    mode: "knowledge" | "technical_read" | "scoped_implementation";
    expiresAt: string | null;
    taskScoped: boolean;
  };
  notices?: { connections?: string | null; agents?: string | null };
};

function commandItemForAgencyAgent(agent: PublicAgencyAgent): CommandHubItem {
  return {
    id: agent.id,
    kind: "agent",
    slug: agent.slug,
    token: agencyAgentToken(agent.slug),
    name: agent.name,
    description: agent.description,
    category: agent.divisionLabel,
    source: "Agency Agents",
    installed: true,
    enabled: true,
    healthy: true,
    requiredCapabilityMode: "knowledge",
    trustLabel: "Local persona",
    division: agent.division,
    divisionLabel: agent.divisionLabel,
    divisionIcon: agent.divisionIcon,
    divisionColor: agent.divisionColor,
    emoji: agent.emoji,
    vibe: agent.vibe,
    services: agent.services,
    searchTerms: [
      agent.division,
      agent.divisionLabel,
      agent.vibe,
      ...agent.services.map((service) => `${service.name} ${service.tier ?? ""}`),
    ].filter(Boolean).join(" "),
  };
}

export interface CommandHubHandle {
  handleKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
  /**
   * Open one agent's settings panel without going through the palette. The
   * request forms that replace the message field need it: they say "change the
   * defaults" inline, and the settings dialog lives here.
   */
  openAgentSettings: (agentId: string) => void;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: CommandHubItem) => void;
  /** Stages one of the user's saved automations in the chat composer. */
  onRunWorkflow?: (workflow: LocalWorkflowSummary) => void;
  /** Inserts a server-resolvable /reference:* context selector. */
  onSelectReference?: (token: string) => void;
  /** Opens Settings → MCP for server setup and management. */
  onOpenMcpSettings?: () => void;
  /**
   * When provided, selecting Agent TARS activates it for the conversation (the
   * host routes sends to a browser run) instead of opening the standalone
   * operator dialog. Hosts that omit this fall back to the dialog.
   */
  onSelectBrowserAgent?: () => void;
  /** When provided, selecting Agent Browser inserts its canonical command. */
  onSelectAgentBrowser?: () => void;
  /** When provided, selecting Agent Reach inserts its canonical command. */
  onSelectAgentReach?: () => void;
  /** When provided, selecting Get Doc inserts its canonical command. */
  onSelectGetDoc?: () => void;
  onSelectMeetingNotes?: () => void;
  /** When provided, selecting Deep Tutor inserts its canonical command. */
  onSelectDeepTutor?: () => void;
  /** When provided, selecting Career Ops inserts its canonical command. */
  onSelectCareerOps?: () => void;
  /** When provided, selecting OpenExecutive inserts its canonical command. */
  onSelectOpenExecutive?: () => void;
  /** When provided, selecting openGym inserts its canonical command. */
  onSelectOpenGym?: () => void;
  /**
   * Kept for composer compatibility with direct `/agents:trading-agent`
   * invocations. Trading Agent is intentionally not a user-selectable palette
   * entry; Super Agent can route a firm analysis to it directly.
   */
  onSelectTradingAgents?: () => void;
  /**
   * Shorts, like Trading Agent, is selected rather than typed after: it takes a
   * video and a shape, so the composer collects those instead of a message.
   */
  onSelectShorts?: () => void;
  /** Formsmith replaces the composer with one image-only picker. */
  onSelectFormsmith?: () => void;
  /** When provided, selecting Vibe Trading inserts its canonical command. */
  onSelectVibeTrading?: () => void;
  /** When provided, selecting Stock Analyst inserts its canonical command. */
  onSelectStockAnalyst?: () => void;
  /** When provided, selecting DeerFlow inserts its canonical command. */
  onSelectDeerFlow?: () => void;
  /** When provided, selecting Deep Research inserts its canonical command. */
  onSelectDeepResearch?: () => void;
  /** When provided, selecting OpenPlanter inserts its canonical command. */
  onSelectOpenPlanter?: () => void;
  /** When provided, selecting the Socials Manager inserts its canonical command. */
  onSelectSocialsManager?: () => void;
  /** When provided, selecting Hardware Blueprint inserts its canonical command. */
  onSelectHardwareBlueprint?: () => void;
  onSelectParametricCad?: () => void;
  /** When provided, selecting HyperFrames inserts its canonical command. */
  onSelectHyperframes?: () => void;
  /** When provided, selecting Resource2Skill inserts its canonical command. */
  onSelectResource2Skill?: () => void;
  /** When provided, selecting MatrAIx inserts its canonical command. */
  onSelectMatraix?: () => void;
  /** When provided, selecting Bolt Slides inserts its canonical command. */
  onSelectBoltSlides?: () => void;
  /** When provided, selecting Classroom inserts its canonical command. */
  onSelectClassroom?: () => void;
  /** When provided, selecting God's Eye inserts its canonical command. */
  onSelectGodsEye?: () => void;
  /** When provided, selecting OpenMontage inserts its canonical command. */
  onSelectOpenMontage?: () => void;
  /** When provided, selecting OpenWork inserts its canonical command. */
  onSelectOpenwork?: () => void;
  /** When provided, selecting OpenScience inserts its canonical command. */
  onSelectOpenscience?: () => void;
  /** Inserts the command for an existing Praxist task-project directory. */
  onSelectPraxist?: () => void;
  onSelectMaxResearch?: () => void;
  /** When provided, selecting Inbox Zero inserts its canonical command. */
  onSelectInboxZero?: () => void;
  onSelectVimax?: () => void;
  onSelectVoxDirector?: () => void;
  /** When provided, selecting MoneyPrinter inserts its canonical command. */
  onSelectMoneyPrinter?: () => void;
  /** When provided, selecting the Legal Agent inserts its canonical command. */
  onSelectLegal?: () => void;
  /** When provided, selecting Wardrobe inserts its canonical command. */
  onSelectWardrobe?: () => void;
  /** When provided, selecting OpenCode inserts its canonical command. */
  onSelectOpenCode?: () => void;
  /** When provided, selecting Codex inserts its canonical command. */
  onSelectCodex?: () => void;
  /** When provided, selecting Ruflo inserts its canonical command. */
  onSelectRuflo?: () => void;
  disabled?: boolean;
  compact?: boolean;
  /**
   * Where the popover opens relative to the "/" button. "above" suits a
   * composer pinned to the bottom of a chat; "below" suits a trigger near the
   * top of a narrow rail, where opening upward would put it off-screen.
   */
  placement?: "above" | "below";
  sessionId?: string | number | null;
  surface?: HermesSurface;
  /**
   * Garden the host belongs to. Kept so callers can pass their context in one
   * place; the palette itself is garden-agnostic.
   */
  gardenSlug?: string | null;
  requestedOutcome?: string;
}

function storedList(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").slice(0, 30)
      : [];
  } catch {
    return [];
  }
}

function storedColorMap(key: string): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([identity, color]) => identity.length <= 300 && typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color))
        .slice(0, 30),
    );
  } catch {
    return {};
  }
}

function itemIdentity(item: Pick<CommandHubItem, "kind" | "id">): string {
  return `${item.kind}:${item.id}`;
}

function storedIncludes(values: string[], item: Pick<CommandHubItem, "kind" | "id">): boolean {
  return values.includes(itemIdentity(item)) || values.includes(item.id);
}

async function migrateLegacyPrompts(): Promise<void> {
  if (localStorage.getItem(MIGRATION_KEY) === "complete") return;
  const raw = localStorage.getItem(LEGACY_PROMPTS_KEY);
  if (!raw) {
    localStorage.setItem(MIGRATION_KEY, "complete");
    return;
  }
  try {
    const prompts = JSON.parse(raw) as unknown;
    if (!Array.isArray(prompts)) return;
    const response = await fetch("/api/hermes/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "import_legacy", prompts }),
    });
    if (response.ok) localStorage.setItem(MIGRATION_KEY, "complete");
  } catch {
    // The recovery copy remains in localStorage and migration retries later.
  }
}

function CapabilityIcon({ kind }: { kind: CommandHubItemKind }) {
  if (kind === "agent") {
    return (
      <svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="12" cy="8" r="3.25" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.75 19c.7-3.1 3-5 6.25-5s5.55 1.9 6.25 5M18.4 7.1l.8.3.3.8-.3.8-.8.3-.8-.3-.3-.8.3-.8.8-.3Z" />
      </svg>
    );
  }
  if (kind === "mcp") {
    return (
      <svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 12a3.5 3.5 0 0 1 3.5-3.5h3.5a3.5 3.5 0 1 1 0 7H14m1.5-3.5A3.5 3.5 0 0 1 12 15.5H8.5a3.5 3.5 0 1 1 0-7H10" />
      </svg>
    );
  }
  if (kind === "prompt") {
    return (
      <svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 4.75h10A2.25 2.25 0 0 1 19.25 7v7A2.25 2.25 0 0 1 17 16.25h-5.5L7 19.5v-3.25A2.25 2.25 0 0 1 4.75 14V7A2.25 2.25 0 0 1 7 4.75Z" />
        <path strokeLinecap="round" d="M8.25 9h7.5M8.25 12h4.5" />
      </svg>
    );
  }
  return null;
}

function SettingsSlidersIcon() {
  return (
    <svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path strokeLinecap="round" d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

/**
 * The one settings button an agent gets. Whatever an agent needs set up —
 * accounts, channels, an environment, the defaults a run starts from — opens
 * from here, in one panel, so no agent ever grows a second settings button.
 */
function AgentSettingsButton({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="neu-button-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:text-[var(--botanical)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
      aria-label={`${name} settings`}
      title={`${name} settings`}
    >
      <SettingsSlidersIcon />
    </button>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-2 p-2" aria-label="Loading capabilities">
      {[0, 1, 2].map((item) => (
        <div key={item} className="animate-pulse rounded-xl px-3 py-3 motion-reduce:animate-none">
          <span className="block min-w-0 space-y-2">
            <span className="block h-3 w-2/5 rounded bg-[var(--paper-strong)]" />
            <span className="block h-2.5 w-4/5 rounded bg-[var(--paper-strong)]" />
          </span>
        </div>
      ))}
    </div>
  );
}

export const CommandHub = forwardRef<CommandHubHandle, Props>(
  function CommandHub(
    {
      open,
      onOpenChange,
      onSelect,
      onRunWorkflow,
      onSelectReference,
      onOpenMcpSettings,
      onSelectBrowserAgent,
      onSelectAgentBrowser,
      onSelectAgentReach,
      onSelectGetDoc,
      onSelectMeetingNotes,
      onSelectDeepTutor,
      onSelectCareerOps,
      onSelectOpenExecutive,
      onSelectOpenGym,
      onSelectShorts,
      onSelectFormsmith,
      onSelectVibeTrading,
      onSelectStockAnalyst,
      onSelectDeerFlow,
      onSelectDeepResearch,
      onSelectOpenPlanter,
      onSelectSocialsManager,
      onSelectHardwareBlueprint,
      onSelectParametricCad,
      onSelectHyperframes,
      onSelectResource2Skill,
      onSelectMatraix,
      onSelectBoltSlides,
      onSelectClassroom,
      onSelectGodsEye,
      onSelectOpenMontage,
      onSelectOpenwork,
      onSelectOpenscience,
      onSelectPraxist,
      onSelectMaxResearch,
      onSelectInboxZero,
      onSelectVimax,
      onSelectVoxDirector,
      onSelectMoneyPrinter,
      onSelectLegal,
      onSelectWardrobe,
      onSelectOpenCode,
      onSelectCodex,
      onSelectRuflo,
      disabled = false,
      compact = false,
      placement = "above",
      sessionId,
      surface = "dashboard_terminal",
      gardenSlug = null,
      requestedOutcome = "",
    },
    ref,
  ) {
    const paletteUrl = commandResponseUrl({
      surface,
      sessionId,
      requestedOutcome,
    });
    const [data, setData] = useState<CommandResponse | null>(() =>
      peekCachedCommandResponse<CommandResponse>(paletteUrl),
    );
    const [tab, setTab] = useState<PaletteTab>("skill");
    const [detail, setDetail] = useState<DetailView>(null);
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [agentDirectoryOpen, setAgentDirectoryOpen] = useState(false);
    const [agencyAgents, setAgencyAgents] = useState<CommandHubItem[]>([]);
    const [agencyAgentsLoading, setAgencyAgentsLoading] = useState(false);
    const [agencyAgentsLoaded, setAgencyAgentsLoaded] = useState(false);
    const [agencyAgentsNotice, setAgencyAgentsNotice] = useState<string | null>(null);
    const [browserOperatorOpen, setBrowserOperatorOpen] = useState(false);
    const [socialsManagerSettingsOpen, setSocialsManagerSettingsOpen] = useState(false);
    const [agentReachSettingsOpen, setAgentReachSettingsOpen] = useState(false);
    const [hyperframesSettingsOpen, setHyperframesSettingsOpen] = useState(false);
    const [resource2SkillSettingsOpen, setResource2SkillSettingsOpen] = useState(false);
    const [matraixSettingsOpen, setMatraixSettingsOpen] = useState(false);
    const [boltSlidesSettingsOpen, setBoltSlidesSettingsOpen] = useState(false);
    const [classroomSettingsOpen, setClassroomSettingsOpen] = useState(false);
    const [godsEyeSettingsOpen, setGodsEyeSettingsOpen] = useState(false);
    const [openMontageSettingsOpen, setOpenMontageSettingsOpen] = useState(false);
    const [openworkSettingsOpen, setOpenworkSettingsOpen] = useState(false);
    const [openscienceSettingsOpen, setOpenscienceSettingsOpen] = useState(false);
    const [wardrobeSettingsOpen, setWardrobeSettingsOpen] = useState(false);
    const [inboxZeroSettingsOpen, setInboxZeroSettingsOpen] = useState(false);
    // The agent whose generic settings panel is open, if any.
    const [agentSettingsFor, setAgentSettingsFor] = useState<string | null>(null);
    const [recents, setRecents] = useState<string[]>([]);
    const [favorites, setFavorites] = useState<string[]>([]);
    const [highlightColors, setHighlightColors] = useState<Record<string, string>>({});
    const [detailMessage, setDetailMessage] = useState<string | null>(null);
    const [promptTitle, setPromptTitle] = useState("");
    const [promptCategory, setPromptCategory] = useState("Custom");
    const [promptContent, setPromptContent] = useState("");
    const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const agentSearchRef = useRef<HTMLInputElement>(null);
    async function loadPalette(force = false) {
      const cached = force
        ? null
        : peekCachedCommandResponse<CommandResponse>(paletteUrl);
      if (cached) {
        setData(cached);
        setError(null);
        setLoading(false);
        // Paint from the renderer cache now, then refresh without replacing the
        // usable page with loading rows. Capability decisions can change while
        // a chat stays open even though the catalog itself is mostly stable.
        void migrateLegacyPrompts()
          .then(() => loadCachedCommandResponse<CommandResponse>(paletteUrl, { force: true }))
          .then(setData)
          .catch(() => undefined);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        await migrateLegacyPrompts();
        setData(await loadCachedCommandResponse<CommandResponse>(paletteUrl, { force }));
      } catch (cause) {
        const status = Number((cause as { status?: unknown })?.status);
        setError(status === 401
          ? "Sign in to use capabilities."
          : cause instanceof Error ? cause.message : "Capabilities could not be loaded.");
      } finally {
        setLoading(false);
      }
    }

    useEffect(() => {
      setRecents(storedList(RECENTS_KEY));
      setFavorites(storedList(FAVORITES_KEY));
      setHighlightColors(storedColorMap(HIGHLIGHT_COLORS_KEY));
    }, []);

    // Match Settings' warm-cache behavior: once the composer is interactive,
    // prepare the stable capability catalog and the large Agency roster. A
    // first click then paints from memory while open-time revalidation runs in
    // the background.
    useEffect(() => {
      const preloadUrl = commandResponseUrl({ surface, sessionId });
      const timer = window.setTimeout(() => {
        void migrateLegacyPrompts()
          .then(() => loadCachedCommandResponse<CommandResponse>(preloadUrl))
          .then((value) => setData((current) => current ?? value))
          .catch(() => undefined);
        void loadCachedSkillsCatalog(skillsCatalogUrl({ surface })).catch(() => undefined);
        void loadAgencyAgents();
      }, 1_000);
      return () => window.clearTimeout(timer);
      // `loadAgencyAgents` deliberately reads the load flags from this render;
      // the module cache deduplicates if a manual tab click wins the race.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, surface]);

    // Opening the palette is what resets it — never a keystroke in the chat
    // field. Palette state intentionally refreshes each time it opens so
    // expired task-scoped implementation skills disappear immediately.
    useEffect(() => {
      if (!open) return;
      setDetail(null);
      setAgentDirectoryOpen(false);
      setQuery("");
      setActiveIndex(0);
      void loadPalette();
      if (tab === "agent") void loadAgencyAgents();
      window.setTimeout(() => searchRef.current?.focus(), 0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, sessionId, surface]);

    useEffect(() => {
      if (!data) return;
      const allItems = [
        ...data.groups.skills,
        ...data.groups.mcp,
        ...data.groups.prompts,
        ...(data.groups.agents ?? []),
      ];
      const migrate = (values: string[]) => {
        const migrated = values.map((value) => {
          if (value.includes(":") && allItems.some((item) => itemIdentity(item) === value)) {
            return value;
          }
          const matches = allItems.filter((item) => item.id === value);
          return matches.length === 1 ? itemIdentity(matches[0]) : value;
        });
        return [...new Set(migrated)].slice(0, 30);
      };
      setRecents((current) => {
        const next = migrate(current);
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
        return next;
      });
      setFavorites((current) => {
        const next = migrate(current);
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
        return next;
      });
      setHighlightColors((current) => {
        const next = Object.fromEntries(
          Object.entries(current).map(([identity, color]) => {
            if (identity.includes(":") && allItems.some((item) => itemIdentity(item) === identity)) {
              return [identity, color];
            }
            const matches = allItems.filter((item) => item.id === identity);
            return [matches.length === 1 ? itemIdentity(matches[0]) : identity, color];
          }),
        );
        localStorage.setItem(HIGHLIGHT_COLORS_KEY, JSON.stringify(next));
        return next;
      });
    }, [data]);

    const tabItems = useMemo(() => {
      if (!data) return [];
      const source =
        tab === "skill"
          ? data.groups.skills
          : tab === "agent"
            ? [...(data.groups.agents ?? []), ...agencyAgents]
            : tab === "prompt"
                ? data.groups.prompts
                : [];
      const normalized = query.trim().toLowerCase();
      const filtered = normalized
        ? source.filter((item) =>
            `${item.token} ${item.name} ${item.description} ${item.category ?? ""} ${item.source ?? ""} ${item.searchTerms ?? ""}`
              .toLowerCase()
              .includes(normalized),
          )
        : source;
      return [...filtered].sort((left, right) => {
        // Pin the Chief of Staff "company" orchestrator to the very top of the
        // agency-agent list so it's an obvious, purposeful pick (it's opt-in:
        // selecting it applies the orchestrator persona to this conversation).
        if (tab === "agent") {
          const isCoo = (item: CommandHubItem) => {
            const haystack = `${item.name ?? ""} ${item.id ?? ""}`.toLowerCase();
            return haystack.includes("chief of staff") || haystack.includes("chief-of-staff");
          };
          const cooDifference = Number(isCoo(right)) - Number(isCoo(left));
          if (cooDifference) return cooDifference;
        }
        const favoriteDifference =
          Number(storedIncludes(favorites, right)) -
          Number(storedIncludes(favorites, left));
        if (favoriteDifference) return favoriteDifference;
        const leftRecent = recents.findIndex((value) =>
          value === itemIdentity(left) || value === left.id,
        );
        const rightRecent = recents.findIndex((value) =>
          value === itemIdentity(right) || value === right.id,
        );
        return (leftRecent < 0 ? 999 : leftRecent) - (rightRecent < 0 ? 999 : rightRecent);
      });
    }, [agencyAgents, data, favorites, query, recents, tab]);

    const recentSkillIds = useMemo(() => {
      const registeredSkillIds = new Set(data?.groups.skills.map((item) => item.id) ?? []);
      return recents.flatMap((identity) => {
        if (identity.startsWith("skill:")) return [identity.slice("skill:".length)];
        return registeredSkillIds.has(identity) ? [identity] : [];
      });
    }, [data, recents]);

    const arisAgent = useMemo(
      () => tab === "agent"
        ? tabItems.find((item) => item.slug === ARIS_AGENT_SLUG) ?? null
        : null,
      [tab, tabItems],
    );
    const spotifyAgent = useMemo(
      () => tab === "agent"
        ? tabItems.find((item) => item.slug === SPOTIFY_AGENT_SLUG) ?? null
        : null,
      [tab, tabItems],
    );
    const agencyDirectoryItems = useMemo(
      () => tab === "agent"
        ? tabItems.filter(
            (item) => item.slug !== ARIS_AGENT_SLUG && item.slug !== SPOTIFY_AGENT_SLUG,
          )
        : tabItems,
      [tab, tabItems],
    );
    const agencyDirectoryGroups = useMemo(() => {
      const grouped = new Map<string, Array<{ item: CommandHubItem; index: number }>>();
      agencyDirectoryItems.forEach((item, index) => {
        const label = item.divisionLabel ?? item.category ?? "Other";
        grouped.set(label, [...(grouped.get(label) ?? []), { item, index }]);
      });
      return [...grouped.entries()]
        .sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: "base" }))
        .map(([label, items]) => ({ label, items }));
    }, [agencyDirectoryItems]);

    const normalizedAgentQuery =
      tab === "agent" ? query.trim().toLowerCase() : "";
    const matchesAgentSearch = (...values: string[]) =>
      !normalizedAgentQuery ||
      values.some((value) => value.toLowerCase().includes(normalizedAgentQuery));
    const showAgentTars =
      surface !== "quartz_ai" &&
      matchesAgentSearch(
        "Agent TARS",
        AGENT_TARS_SLASH_COMMAND,
        "browser desktop isolated browser",
      );
    const showAgentBrowser =
      surface !== "quartz_ai" &&
      Boolean(onSelectAgentBrowser) &&
      matchesAgentSearch(
        "Agent Browser",
        AGENT_BROWSER_SLASH_COMMAND,
        "real browser web",
      );
    const showAgentReach =
      surface !== "quartz_ai" &&
      Boolean(onSelectAgentReach) &&
      matchesAgentSearch(
        "Agent Reach",
        AGENT_REACH_COMMAND,
        "internet twitter reddit youtube github bilibili xiaohongshu linkedin rss v2ex web page transcript",
      );
    const showCareerOps =
      surface !== "quartz_ai" &&
      Boolean(onSelectCareerOps) &&
      matchesAgentSearch(
        "Career Ops",
        CAREER_OPS_COMMAND,
        "job search offer evaluation cv resume cover letter application tracker interview salary recruiter ats portal scan",
      );
    const showShorts =
      surface !== "quartz_ai" &&
      Boolean(onSelectShorts) &&
      matchesAgentSearch(
        "Shorts",
        SHORTS_COMMAND,
        "shorts clip clips reel reels tiktok youtube vertical crop video highlight viral cut trim podcast interview transcript subtitle repurpose",
      );
    const showFormsmith =
      surface !== "quartz_ai" &&
      Boolean(onSelectFormsmith) &&
      matchesAgentSearch(
        "Formsmith",
        FORMSMITH_COMMAND,
        "shaper shape 3d model mesh glb reconstruct reconstruction picture photo image object geometry scan",
      );
    const showVibeTrading =
      surface !== "quartz_ai" &&
      Boolean(onSelectVibeTrading) &&
      matchesAgentSearch(
        "Vibe Trading",
        VIBE_TRADING_COMMAND,
        "vibe trading quant backtest strategy factor alpha signal indicator momentum portfolio sharpe drawdown crypto equity a-share macro hypothesis shadow account paper research finance",
      );
    const showStockAnalyst =
      surface !== "quartz_ai" &&
      Boolean(onSelectStockAnalyst) &&
      matchesAgentSearch(
        "Stock Analyst",
        STOCK_ANALYST_COMMAND,
        "stock analyst share ticker quote price chart candle kline ma moving average trend support resistance buy sell hold target entry exit valuation earnings fundamentals news sentiment sector rotation a-share hong kong us japan korea taiwan etf watchlist portfolio chan wave momentum breakout",
      );
    const showDeerFlow =
      surface !== "quartz_ai" &&
      Boolean(onSelectDeerFlow) &&
      matchesAgentSearch(
        "DeerFlow",
        DEER_FLOW_COMMAND,
        "deerflow deer flow super agent harness sandbox subagent delegate skills memory research report document workspace bytedance langgraph general purpose",
      );
    const showMeetingNotes =
      surface !== "quartz_ai" &&
      Boolean(onSelectMeetingNotes) &&
      matchesAgentSearch(
        "Meeting Notes",
        MEETING_NOTES_COMMAND,
        "meeting meetings transcribe transcript transcription notes minutes recording record call standup stand-up sync retro review interview zoom teams webex google meet action items decisions attendees speakers diarize summary summarise summarize audio voice meetily",
      );
    const showGetDoc =
      surface !== "quartz_ai" &&
      Boolean(onSelectGetDoc) &&
      matchesAgentSearch(
        "Get Doc",
        GET_DOC_COMMAND,
        "paper papers article journal academic scholar literature pdf download doi arxiv pubmed citation study publication research reference bibliography",
      );
    const showDeepTutor =
      surface !== "quartz_ai" &&
      Boolean(onSelectDeepTutor) &&
      matchesAgentSearch(
        "Deep Tutor",
        DEEP_TUTOR_COMMAND,
        "tutor teach learn study explain lesson lecture homework exercise problem solve quiz question exam revise revision flashcard notes garden course subject understand mastery practice",
      );
    const showDeepResearch =
      surface !== "quartz_ai" &&
      Boolean(onSelectDeepResearch) &&
      matchesAgentSearch(
        "Deep Research",
        DEEP_RESEARCH_SLASH_COMMAND,
        "web research sourced report",
      );
    const showOpenPlanter =
      surface !== "quartz_ai" &&
      Boolean(onSelectOpenPlanter) &&
      matchesAgentSearch(
        "OpenPlanter",
        OPENPLANTER_COMMAND,
        "knowledge graph investigation reports patches",
      );
    const showSocialsManager =
      surface !== "quartz_ai" &&
      Boolean(onSelectSocialsManager) &&
      matchesAgentSearch(
        "Socials Manager",
        SOCIALS_MANAGER_COMMAND,
        "social media posts scheduling calendar x linkedin threads instagram",
      );
    const showHardwareBlueprint =
      surface !== "quartz_ai" &&
      Boolean(onSelectHardwareBlueprint) &&
      matchesAgentSearch(
        "Hardware Blueprint",
        HARDWARE_BLUEPRINT_COMMAND,
        "circuit electronics wiring schematic breadboard arduino esp32 pico sensor firmware bom",
      );
    const showParametricCad =
      surface !== "quartz_ai" &&
      Boolean(onSelectParametricCad) &&
      matchesAgentSearch(
        "Parametric CAD",
        PARAMETRIC_CAD_COMMAND,
        "cad 3d print stl step glb cadquery enclosure bracket mount adapter spacer bushing knob printable model mm millimetre",
      );
    const showHyperframes =
      surface !== "quartz_ai" &&
      Boolean(onSelectHyperframes) &&
      matchesAgentSearch(
        "HyperFrames",
        HYPERFRAMES_COMMAND,
        "video animation motion graphics mp4 render explainer promo clip title card slideshow",
      );
    const showOpenMontage =
      surface !== "quartz_ai" &&
      Boolean(onSelectOpenMontage) &&
      matchesAgentSearch(
        "OpenMontage",
        OPENMONTAGE_COMMAND,
        "video production pipeline documentary montage cinematic trailer explainer animation script scene plan storyboard stock footage narration voiceover music subtitles remotion render mp4",
      );
    const showOpenwork =
      surface !== "quartz_ai" &&
      Boolean(onSelectOpenwork) &&
      matchesAgentSearch(
        "OpenWork",
        OPENWORK_COMMAND,
        "workspace skills mcp connections document spreadsheet report office google drive share capability",
      );
    const showOpenscience =
      surface !== "quartz_ai" &&
      Boolean(onSelectOpenscience) &&
      matchesAgentSearch(
        "OpenScience",
        OPENSCIENCE_COMMAND,
        "research science experiment hypothesis literature paper arxiv pubmed uniprot pdb ensembl chembl pubchem openalex biology physics chemistry machine learning training dataset simulation analysis plot figure notebook python",
      );
    const showOpenExecutive =
      surface !== "quartz_ai" &&
      Boolean(onSelectOpenExecutive) &&
      matchesAgentSearch(
        "OpenExecutive",
        OPENEXECUTIVE_COMMAND,
        "executive strategy chief of staff leadership decision analysis committee specialist operations finance legal marketing sales engineering research",
      );
    const showPraxist =
      surface !== "quartz_ai" &&
      Boolean(onSelectPraxist) &&
      matchesAgentSearch(
        "Praxist",
        PRAXIST_COMMAND,
        "autonomous research development experiment measurable task project multi agent generations findings frontier",
      );

    const showMaxResearch =
      Boolean(onSelectMaxResearch) &&
      matchesAgentSearch(
        "Max Research",
        MAX_RESEARCH_COMMAND,
        "research everything exhaustive all six agents deep web internet papers literature workspace experiment reconcile one answer long thorough max",
      );
    const showInboxZero =
      surface !== "quartz_ai" &&
      Boolean(onSelectInboxZero) &&
      matchesAgentSearch(
        "Inbox Zero",
        INBOX_ZERO_COMMAND,
        "email inbox mailbox mail gmail outlook message thread reply respond draft forward send archive label unread unsubscribe newsletter spam snooze follow up cleanup rules filter sort",
      );
    const showVimax =
      surface !== "quartz_ai" &&
      Boolean(onSelectVimax) &&
      matchesAgentSearch(
        "ViMax",
        VIMAX_COMMAND,
        "film movie story screenplay script storyboard shots scenes characters animatic cinematic director screenwriter video",
      );
    const showVoxDirector =
      surface !== "quartz_ai" &&
      Boolean(onSelectVoxDirector) &&
      matchesAgentSearch(
        "Vox Director",
        VOX_DIRECTOR_COMMAND,
        "explainer explain vox collage paper torn cutout poster narrated narration voiceover editorial motion graphics short video beats headline scrapbook",
      );
    const showMoneyPrinter =
      surface !== "quartz_ai" &&
      Boolean(onSelectMoneyPrinter) &&
      matchesAgentSearch(
        "MoneyPrinter",
        MONEY_PRINTER_COMMAND,
        "short video shorts reel tiktok youtube stock footage pexels pixabay coverr voiceover narration subtitles captions vertical faceless clip montage",
      );
    const showLegal =
      surface !== "quartz_ai" &&
      Boolean(onSelectLegal) &&
      matchesAgentSearch(
        "Legal Agent",
        LEGAL_COMMAND,
        "legal lawyer law contract agreement nda spa clause review redline markup diligence memo counsel litigation corporate compliance regulation privacy employment tax real estate ip antitrust arbitration",
      );
    const showWardrobe =
      surface !== "quartz_ai" &&
      Boolean(onSelectWardrobe) &&
      matchesAgentSearch(
        "Wardrobe",
        WARDROBE_COMMAND,
        "wardrobe clothes clothing garment outfit fashion closet cutout catalog lookbook shirt jacket trousers shoes accessories photo import style",
      );
    const showOpenCode =
      surface !== "quartz_ai" &&
      Boolean(onSelectOpenCode) &&
      matchesAgentSearch(
        "OpenCode",
        OPENCODE_COMMAND,
        "code coding local project repository garden",
      );
    const showCodex =
      surface !== "quartz_ai" &&
      Boolean(onSelectCodex) &&
      matchesAgentSearch(
        "Codex",
        CODEX_COMMAND,
        "code coding local project repository garden openai",
      );
    const showRuflo =
      surface !== "quartz_ai" &&
      Boolean(onSelectRuflo) &&
      matchesAgentSearch(
        "Ruflo",
        RUFLO_COMMAND,
        "swarm hive mind queen workers consensus orchestration claude flow",
      );
    const showAris =
      surface !== "quartz_ai" &&
      Boolean(arisAgent);
    const showSpotifyAgent =
      surface !== "quartz_ai" &&
      Boolean(spotifyAgent) &&
      matchesAgentSearch(
        "Spotify",
        SPOTIFY_AGENT_COMMAND,
        "music playback song track artist album playlist library queue pause resume skip volume now playing spotify connect",
      );
    const showOpenGym =
      surface !== "quartz_ai" &&
      Boolean(onSelectOpenGym) &&
      matchesAgentSearch(
        "openGym",
        OPEN_GYM_COMMAND,
        "fitness exercise workout gym training program routine plan strength calisthenics form technique animation demonstration",
      );
    const showAgencyDirectory =
      agencyDirectoryItems.length > 0 ||
      matchesAgentSearch(
        "Agency agents",
        AGENCY_AGENTS_DIRECTORY_COMMAND,
        "specialist personas design engineering marketing strategy",
      );
    const showResource2Skill =
      surface !== "quartz_ai" &&
      Boolean(onSelectResource2Skill) &&
      matchesAgentSearch(
        "Resource2Skill",
        RESOURCE2SKILL_COMMAND,
        "website web deck slides powerpoint excel workbook spreadsheet blender 3d music audio artifact distilled skills",
      );
    const showMatraix =
      surface !== "quartz_ai" &&
      Boolean(onSelectMatraix) &&
      matchesAgentSearch(
        "MatrAIx",
        MATRAIX_COMMAND,
        "survey population personas simulated users respondents cohort market research focus group willingness to pay audience",
      );
    const showBoltSlides =
      surface !== "quartz_ai" &&
      Boolean(onSelectBoltSlides) &&
      matchesAgentSearch(
        "Bolt Slides",
        BOLT_SLIDES_COMMAND,
        "deck slides presentation pitch keynote talk slideshow present presenter interactive web react animated builds",
      );
    const showClassroom =
      surface !== "quartz_ai" &&
      Boolean(onSelectClassroom) &&
      matchesAgentSearch(
        "Classroom",
        CLASSROOM_COMMAND,
        "classroom lesson teach course class lecture tutor learn quiz simulation openmaic students teacher education",
      );
    const showGodsEye =
      surface !== "quartz_ai" &&
      Boolean(onSelectGodsEye) &&
      matchesAgentSearch(
        "God's Eye",
        GODS_EYE_COMMAND,
        "globe earth satellite satellites aircraft flights ships vessels earthquakes fires cameras cctv osint world map live tracking thermal night vision spy view",
      );
    const hasVisibleAgents =
      showGodsEye ||
      showAgentTars ||
      showAgentBrowser ||
      showAgentReach ||
      showGetDoc ||
      showCareerOps ||
      showOpenExecutive ||
      showOpenGym ||
      showVibeTrading ||
      showStockAnalyst ||
      showDeerFlow ||
      showMeetingNotes ||
      showShorts ||
      showFormsmith ||
      showDeepResearch ||
      showDeepTutor ||
      showOpenPlanter ||
      showSocialsManager ||
      showHardwareBlueprint ||
      showParametricCad ||
      showHyperframes ||
      showResource2Skill ||
      showMatraix ||
      showBoltSlides ||
      showClassroom ||
      showOpenMontage ||
      showOpenwork ||
      showOpenscience ||
      showMaxResearch ||
      showInboxZero ||
      showVimax ||
      showVoxDirector ||
      showMoneyPrinter ||
      showLegal ||
      showWardrobe ||
      showCodex ||
      showOpenCode ||
      showRuflo ||
      showAris ||
      showSpotifyAgent ||
      showAgencyDirectory;
    useEffect(() => {
      setActiveIndex((index) => Math.min(index, Math.max(0, agencyDirectoryItems.length - 1)));
    }, [agencyDirectoryItems.length]);

    function choose(item: CommandHubItem) {
      if (!item.enabled || !item.healthy) return;
      const identity = itemIdentity(item);
      rememberRecent(identity, item.id);
      onSelect(item);
      setQuery("");
      onOpenChange(false);
    }

    function chooseCatalogSkill(skill: {
      upstreamId: string;
      slashCommand: string;
      command: string;
      name: string;
      description: string;
      source: string;
      approvedHash: string | null;
      requiresOpenCode?: boolean;
      classification?: {
        classification: string;
      };
    }) {
      const registered = data?.groups.skills.find((item) => item.id === skill.upstreamId);
      if (registered) {
        choose(registered);
        return;
      }
      rememberRecent(`skill:${skill.upstreamId}`, skill.upstreamId);
      onSelect({
        id: skill.upstreamId,
        kind: "skill",
        slug: skill.slashCommand,
        token: skill.slashCommand,
        name: skill.name,
        description: skill.description,
        source: skill.source,
        installed: true,
        enabled: true,
        healthy: true,
        contentHash: skill.approvedHash ?? undefined,
        classification:
          skill.classification?.classification ===
          "eligible_coding_conditional"
            ? "eligible_coding_conditional"
            : "eligible_general",
        requiredCapabilityMode:
          skill.requiresOpenCode ||
          skill.classification?.classification ===
            "eligible_coding_conditional"
            ? "scoped_implementation"
            : "knowledge",
        requiresOpenCode:
          skill.requiresOpenCode ||
          skill.classification?.classification ===
            "eligible_coding_conditional",
        trustLabel: "Reviewed and pinned",
      });
      onOpenChange(false);
    }

    function rememberRecent(identity: string, legacyId: string) {
      setRecents((current) => {
        const next = [
          identity,
          ...current.filter((value) => value !== identity && value !== legacyId),
        ].slice(0, 20);
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
        return next;
      });
    }

    function handleKeyDown(event: KeyboardEvent<HTMLElement>): boolean {
      if (!open) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        if (agentDirectoryOpen) {
          setAgentDirectoryOpen(false);
          setQuery("");
          setActiveIndex(0);
          window.setTimeout(
            () => document.getElementById("agency-agents-directory")?.focus(),
            0,
          );
        } else if (detail) {
          setDetail(null);
          window.setTimeout(() => searchRef.current?.focus(), 0);
        } else onOpenChange(false);
        return true;
      }
      if (
        detail ||
        tab === "skill" ||
        tab === "workflow" ||
        tab === "reference" ||
        (tab === "agent" && !agentDirectoryOpen)
      ) {
        return false;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((index) => agencyDirectoryItems.length ? (index + direction + agencyDirectoryItems.length) % agencyDirectoryItems.length : 0);
        return true;
      }
      if (event.key === "Enter" && agencyDirectoryItems[activeIndex]) {
        event.preventDefault();
        choose(agencyDirectoryItems[activeIndex]);
        return true;
      }
      return false;
    }

    useImperativeHandle(ref, () => ({
      handleKeyDown,
      openAgentSettings: (agentId: string) => setAgentSettingsFor(agentId),
    }));

    function highlightColorForId(identity: string): string | null {
      return highlightColors[identity]
        ?? (favorites.includes(identity) ? DEFAULT_CAPABILITY_HIGHLIGHT_COLOR : null);
    }

    function highlightColorForItem(item: CommandHubItem): string | null {
      const identity = itemIdentity(item);
      return highlightColors[identity]
        ?? highlightColors[item.id]
        ?? (storedIncludes(favorites, item) || item.favorite ? DEFAULT_CAPABILITY_HIGHLIGHT_COLOR : null);
    }

    function setHighlight(item: CommandHubItem, color: string | null, taskScoped = false) {
      const conditional = data?.groups.skills.some(
        (candidate) =>
          candidate.id === item.id &&
          candidate.requiredCapabilityMode === "scoped_implementation",
      );
      if (taskScoped || conditional) return;
      const identity = itemIdentity(item);
      const nextFavorites = color
        ? [identity, ...favorites.filter((value) => value !== identity && value !== item.id)].slice(0, 30)
        : favorites.filter((value) => value !== identity && value !== item.id);
      setFavorites(nextFavorites);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(nextFavorites));
      setHighlightColors((current) => {
        const next = { ...current };
        delete next[item.id];
        if (color) next[identity] = color;
        else delete next[identity];
        localStorage.setItem(HIGHLIGHT_COLORS_KEY, JSON.stringify(next));
        return next;
      });
    }

    function setHighlightId(id: string, color: string | null) {
      const nextFavorites = color
        ? [id, ...favorites.filter((value) => value !== id)].slice(0, 30)
        : favorites.filter((value) => value !== id);
      setFavorites(nextFavorites);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(nextFavorites));
      setHighlightColors((current) => {
        const next = { ...current };
        if (color) next[id] = color;
        else delete next[id];
        localStorage.setItem(HIGHLIGHT_COLORS_KEY, JSON.stringify(next));
        return next;
      });
    }

    async function savePrompt() {
      setDetailMessage("Saving prompt…");
      try {
        const response = await fetch(
          editingPromptId
            ? `/api/hermes/prompts/${encodeURIComponent(editingPromptId)}`
            : "/api/hermes/prompts",
          {
            method: editingPromptId ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: promptTitle, category: promptCategory, content: promptContent }),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
        if (!response.ok) throw new Error(payload.message ?? payload.error ?? "The prompt could not be saved.");
        setPromptTitle("");
        setPromptCategory("Custom");
        setPromptContent("");
        setEditingPromptId(null);
        invalidateCommandResponseCache();
        await loadPalette(true);
        setTab("prompt");
        setDetail("manage-prompts");
        setDetailMessage("Prompt saved.");
      } catch (cause) {
        setDetailMessage(cause instanceof Error ? cause.message : "The prompt could not be saved.");
      }
    }

    function editPrompt(item: CommandHubItem) {
      setEditingPromptId(item.isDefault ? null : item.id);
      setPromptTitle(item.name);
      setPromptCategory(item.category ?? "Custom");
      setPromptContent(item.content ?? item.description);
      setDetail("new-prompt");
      setDetailMessage(
        item.isDefault
          ? "This Breadboard prompt will be duplicated as a custom prompt."
          : null,
      );
    }

    function duplicatePrompt(item: CommandHubItem) {
      setEditingPromptId(null);
      setPromptTitle(`${item.name} copy`);
      setPromptCategory(item.category ?? "Custom");
      setPromptContent(item.content ?? item.description);
      setDetail("new-prompt");
      setDetailMessage("Review the copy, then save it as a new prompt.");
    }

    async function deleteSavedPrompt(item: CommandHubItem) {
      if (item.isDefault || !item.id.startsWith("user-")) return;
      setDetailMessage("Deleting prompt…");
      try {
        const response = await fetch(
          `/api/hermes/prompts/${encodeURIComponent(item.id)}`,
          { method: "DELETE" },
        );
        if (!response.ok) throw new Error("The prompt could not be deleted.");
        invalidateCommandResponseCache();
        await loadPalette(true);
        setTab("prompt");
        setDetail("manage-prompts");
        setDetailMessage("Prompt deleted.");
      } catch (cause) {
        setDetailMessage(
          cause instanceof Error ? cause.message : "The prompt could not be deleted.",
        );
      }
    }

    // Scheduling is a place, not a form in here: the Scheduled panel owns it and
    // reaches back into this palette through its own "/" button.
    const tabs: Array<{ id: PaletteTab; label: string }> = [
      { id: "skill", label: "Skills" },
      { id: "workflow", label: "Workflows" },
      { id: "agent", label: "Agents" },
      { id: "prompt", label: "Prompts" },
      { id: "reference", label: "Reference" },
    ];

    async function loadAgencyAgents(force = false) {
      if ((!force && agencyAgentsLoaded) || agencyAgentsLoading) return;
      setAgencyAgentsLoading(true);
      setAgencyAgentsNotice(null);
      try {
        const catalog = await loadAgencyAgentsClientCatalog({ force });
        setAgencyAgents(catalog.agents.map(commandItemForAgencyAgent));
        setAgencyAgentsNotice(catalog.configuration?.message ?? null);
      } catch (cause) {
        setAgencyAgents([]);
        setAgencyAgentsNotice(
          cause instanceof Error ? cause.message : "Agency agents could not be loaded.",
        );
      } finally {
        setAgencyAgentsLoaded(true);
        setAgencyAgentsLoading(false);
      }
    }

    function selectTab(nextTab: PaletteTab) {
      setTab(nextTab);
      setAgentDirectoryOpen(false);
      setQuery("");
      setActiveIndex(0);
      if (nextTab === "agent") void loadAgencyAgents();
    }

    async function toggleAgentDirectory() {
      if (agentDirectoryOpen) {
        setAgentDirectoryOpen(false);
        setQuery("");
        setActiveIndex(0);
        return;
      }
      if (!agencyAgentsLoaded || agencyAgentsNotice) {
        await loadAgencyAgents(Boolean(agencyAgentsNotice));
      }
      setQuery("");
      setAgentDirectoryOpen(true);
      setActiveIndex(0);
    }

    function moveTabFocus(current: PaletteTab, direction: -1 | 1) {
      const index = tabs.findIndex((item) => item.id === current);
      const next = tabs[(index + direction + tabs.length) % tabs.length];
      selectTab(next.id);
      window.setTimeout(
        () => document.getElementById(`command-hub-tab-${next.id}`)?.focus(),
        0,
      );
    }

    // Below a mobile breakpoint the palette is a sheet pinned to the bottom of
    // the viewport either way; only the anchored desktop form has a side to
    // open towards.
    const placementClasses =
      placement === "below"
        ? "sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:h-[min(520px,58vh)] sm:w-[min(440px,calc(100vw-2rem))]"
        : "sm:absolute sm:inset-x-auto sm:bottom-full sm:left-0 sm:mb-3 sm:h-[min(620px,72vh)] sm:w-[min(600px,calc(100vw-2rem))]";

    function warmPalette() {
      void loadCachedCommandResponse<CommandResponse>(paletteUrl).catch(() => undefined);
      void loadCachedSkillsCatalog(skillsCatalogUrl({ surface })).catch(() => undefined);
      if (!agencyAgentsLoaded && !agencyAgentsLoading) void loadAgencyAgents();
    }

    return (
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          onPointerEnter={warmPalette}
          onFocus={warmPalette}
          disabled={disabled}
          className={`neu-button-icon flex items-center justify-center rounded-full font-mono text-lg text-[var(--ink)] transition hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)] disabled:opacity-40 ${compact ? "h-9 w-9" : "h-11 w-11"}`}
          title="Use a capability"
          aria-label="Open capabilities"
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          /
        </button>
        {open ? (
          <>
            <button type="button" className="fixed inset-0 z-30 cursor-default bg-transparent" onClick={() => onOpenChange(false)} aria-label="Close capabilities" />
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="capability-palette-title"
              className={`neu-popover fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-40 flex max-h-[min(82dvh,680px)] flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] ${placementClasses}`}
              onKeyDown={handleKeyDown}
            >
              <header className="border-b border-[var(--line)] px-4 pb-3 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 id="capability-palette-title" className="text-base font-semibold text-[var(--ink-heading)]">Use a capability</h2>
                    {data?.capability.taskScoped ? <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">Implementation capabilities shown here are task-scoped.</p> : null}
                  </div>
                  <button type="button" onClick={() => onOpenChange(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]" aria-label="Close capabilities">×</button>
                </div>
              </header>

              {!detail ? (
                <nav className="flex items-center gap-1 overflow-x-auto border-b border-[var(--line)] px-3 pt-2" role="tablist" aria-label="Capability types">
                  {tabs.map((item) => (
                    <button
                      id={`command-hub-tab-${item.id}`}
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={tab === item.id}
                      tabIndex={tab === item.id ? 0 : -1}
                      onClick={() => selectTab(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                          event.preventDefault();
                          moveTabFocus(item.id, event.key === "ArrowLeft" ? -1 : 1);
                        }
                      }}
                      className={`relative px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-[var(--botanical)] ${tab === item.id ? "font-medium text-[var(--ink-heading)] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--botanical)]" : "text-[var(--ink-muted)] hover:text-[var(--ink)]"}`}
                    >
                      {item.label}
                    </button>
                  ))}
                  <span className="flex-1" />
                  {tab === "prompt" ? <button type="button" onClick={() => { setEditingPromptId(null); setPromptTitle(""); setPromptCategory("Custom"); setPromptContent(""); setDetail("new-prompt"); setDetailMessage(null); }} className="mb-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--botanical)] hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]">New prompt</button> : null}
                </nav>
              ) : null}

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
                {(tab === "agent" || tab === "prompt") && !detail ? (
                  <div className="relative mb-3">
                    <svg
                      aria-hidden
                      className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <circle cx="11" cy="11" r="6.5" />
                      <path strokeLinecap="round" d="m16 16 4 4" />
                    </svg>
                    <input
                      ref={searchRef}
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setActiveIndex(0);
                      }}
                      placeholder={
                        tab === "agent" ? "Search agents" : "Search prompts"
                      }
                      className="neu-control w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] py-2.5 pl-9 pr-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--botanical)]"
                      aria-label={
                        tab === "agent" ? "Search agents" : "Search prompts"
                      }
                    />
                  </div>
                ) : null}
                {tab === "skill" && !detail ? (
                  <SkillsCatalogPanel
                    runtimeSessionId={sessionId ?? null}
                    surface={surface}
                    onUse={chooseCatalogSkill}
                    onPrepareWithOpenCode={
                      onSelectOpenCode
                        ? (skill) => {
                            onSelectOpenCode();
                            chooseCatalogSkill(skill);
                          }
                        : undefined
                    }
                    onOpenConnections={onOpenMcpSettings ? () => {
                      onOpenChange(false);
                      onOpenMcpSettings();
                    } : undefined}
                    onInstalledChange={loadPalette}
                    favoriteIds={favorites}
                    recentSkillIds={recentSkillIds}
                    highlightColors={highlightColors}
                    onHighlightChange={(upstreamId, color) => setHighlightId(`skill:${upstreamId}`, color)}
                  />
                ) : tab === "workflow" && !detail ? (
                  <WorkflowTemplatesPanel
                    onRunWorkflow={onRunWorkflow ? (workflow) => {
                      onRunWorkflow(workflow);
                      onOpenChange(false);
                    } : undefined}
                    onNavigate={() => onOpenChange(false)}
                    disabled={disabled}
                  />
                ) : tab === "reference" && !detail ? (
                  <ReferenceChatsPanel
                    sessionId={sessionId}
                    surface={surface}
                    onSelect={(token) => {
                      onSelectReference?.(token);
                      onOpenChange(false);
                    }}
                  />
                ) : loading ? <LoadingRows /> : error ? (
                  <ReloadableFetchError
                    message={error}
                    onReload={() => void loadPalette(true)}
                    label="Reload capabilities"
                    className="min-h-48 px-6 py-8 text-center text-sm"
                  />
                ) : tab === "agent" && !detail ? (
                  <>
                    <ul role="listbox" aria-label="Agents" className="divide-y divide-[var(--line)]">
                    {[
                    ...(showSpotifyAgent && spotifyAgent
                      ? [{ name: "Spotify", node: (
                      <li key="agent-spotify"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForItem(spotifyAgent))}
                      >
                        <button
                          id="agent-spotify-entry"
                          type="button"
                          onClick={() => choose(spotifyAgent)}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">
                            {SPOTIFY_AGENT_COMMAND}
                          </span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Finds music, manages playlists and the library, and controls Spotify Connect playback.
                          </span>
                        </button>
                        <FavoriteBox
                          color={highlightColorForItem(spotifyAgent)}
                          onColorChange={(color) => setHighlight(spotifyAgent, color)}
                          label="Choose Spotify highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showAris && arisAgent
                      ? [{ name: "ARIS", node: (
                      <li key="aris"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForItem(arisAgent))}
                      >
                        <button
                          id="aris-entry"
                          type="button"
                          onClick={() => choose(arisAgent)}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="flex items-center gap-2">
                            <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">
                              {ARIS_AGENT_COMMAND}
                            </span>
                          </span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Takes a research project from idea to report: finds papers, plans experiments, checks conclusions, and produces work you can review.
                          </span>
                        </button>
                        <FavoriteBox
                          color={highlightColorForItem(arisAgent)}
                          onColorChange={(color) => setHighlight(arisAgent, color)}
                          label="Choose ARIS highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showAgentTars
                      ? [{ name: "Agent TARS", node: (
                      <li key="agent-tars"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:agent-tars"))}
                      >
                        <button
                          id="browser-operator-entry"
                          type="button"
                          onClick={() => {
                            if (onSelectBrowserAgent) onSelectBrowserAgent();
                            else setBrowserOperatorOpen(true);
                            onOpenChange(false);
                          }}
                          aria-haspopup={onSelectBrowserAgent ? undefined : "dialog"}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{AGENT_TARS_SLASH_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            {onSelectBrowserAgent
                              ? "Clicks, types, and completes visual tasks in a browser or on your desktop when you approve access. Every step appears in chat."
                              : "Set up a browser or approved desktop, then use Agent TARS to click, type, and complete visual tasks for you."}
                          </span>
                        </button>
                        <FavoriteBox
                          color={highlightColorForId("agent:agent-tars")}
                          onColorChange={(color) => setHighlightId("agent:agent-tars", color)}
                          label="Choose Agent TARS highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showAgentBrowser
                      ? [{ name: "Agent Browser", node: (
                      <li key="agent-browser"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:agent-browser"))}
                      >
                        <button
                          id="agent-browser-entry"
                          type="button"
                          onClick={() => {
                            onSelectAgentBrowser?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{AGENT_BROWSER_SLASH_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Opens a real browser to visit sites, click buttons, fill forms, and gather information while showing each step in chat.
                          </span>
                        </button>
                        <FavoriteBox
                          color={highlightColorForId("agent:agent-browser")}
                          onColorChange={(color) => setHighlightId("agent:agent-browser", color)}
                          label="Choose Agent Browser highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showAgentReach
                      ? [{ name: "Agent Reach", node: (
                      <li key="agent-reach"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:agent-reach"))}
                      >
                        <button
                          id="agent-reach-entry"
                          type="button"
                          onClick={() => {
                            onSelectAgentReach?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{AGENT_REACH_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Finds current information across social platforms, video sites, GitHub, RSS, and the open web, then answers with links to its sources.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Agent Reach"
                          onOpen={() => {
                            setAgentReachSettingsOpen(true);
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:agent-reach")}
                          onColorChange={(color) => setHighlightId("agent:agent-reach", color)}
                          label="Choose Agent Reach highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showMeetingNotes
                      ? [{ name: "Meeting Notes", node: (
                      <li key="meeting-notes"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:meeting-notes"))}
                      >
                        <button
                          id="meeting-notes-entry"
                          type="button"
                          onClick={() => {
                            onSelectMeetingNotes?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{MEETING_NOTES_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Turns a meeting recording into who was there, what was decided, what is due and what happens next. Attach a recording, record one here, or paste a transcript.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Meeting Notes"
                          onOpen={() => {
                            setAgentSettingsFor("meeting-notes");
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:meeting-notes")}
                          onColorChange={(color) => setHighlightId("agent:meeting-notes", color)}
                          label="Choose Meeting Notes highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showGetDoc
                      ? [{ name: "Get Doc", node: (
                      <li key="get-doc"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:get-doc"))}
                      >
                        <button
                          id="get-doc-entry"
                          type="button"
                          onClick={() => {
                            onSelectGetDoc?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{GET_DOC_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Finds academic papers from a title or a description, lists what each one is, and saves the free PDFs to your artifacts with one click.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Get Doc"
                          onOpen={() => {
                            setAgentSettingsFor("get-doc");
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:get-doc")}
                          onColorChange={(color) => setHighlightId("agent:get-doc", color)}
                          label="Choose Get Doc highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showDeepTutor
                      ? [{ name: "Deep Tutor", node: (
                      <li key="deep-tutor"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:deep-tutor"))}
                      >
                        <button
                          id="deep-tutor-entry"
                          type="button"
                          onClick={() => {
                            onSelectDeepTutor?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{DEEP_TUTOR_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            {surface === "garden_chat"
                              ? "Teaches from this Garden \u2014 explains, works problems, and writes quizzes from its own notes, remembering what you have covered."
                              : "Teaches from your own files \u2014 explains, works problems, and writes quizzes from anything in your workspace, remembering what you have covered."}
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Deep Tutor"
                          onOpen={() => {
                            setAgentSettingsFor("deep-tutor");
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:deep-tutor")}
                          onColorChange={(color) => setHighlightId("agent:deep-tutor", color)}
                          label="Choose Deep Tutor highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showCareerOps
                      ? [{ name: "Career Ops", node: (
                      <li key="career-ops"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:career-ops"))}
                      >
                        <button
                          id="career-ops-entry"
                          type="button"
                          onClick={() => {
                            onSelectCareerOps?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{CAREER_OPS_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Paste a job posting to get it scored against your CV, or ask for a tailored CV, a cover letter, interview prep, or where every application stands.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Career Ops"
                          onOpen={() => {
                            setAgentSettingsFor("career-ops");
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:career-ops")}
                          onColorChange={(color) => setHighlightId("agent:career-ops", color)}
                          label="Choose Career Ops highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showOpenExecutive
                      ? [{ name: "OpenExecutive", node: (
                      <li key="openexecutive"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:openexecutive"))}
                      >
                        <button
                          id="openexecutive-entry"
                          type="button"
                          onClick={() => {
                            onSelectOpenExecutive?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{OPENEXECUTIVE_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Runs an executive team of specialists to analyze complex decisions, challenge assumptions, and turn the result into an actionable recommendation.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="OpenExecutive"
                          onOpen={() => {
                            setAgentSettingsFor("openexecutive");
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:openexecutive")}
                          onColorChange={(color) => setHighlightId("agent:openexecutive", color)}
                          label="Choose OpenExecutive highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showOpenGym
                      ? [{ name: "openGym", node: (
                      <li key="open-gym"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:open-gym"))}
                      >
                        <button
                          id="open-gym-entry"
                          type="button"
                          onClick={() => {
                            onSelectOpenGym?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{OPEN_GYM_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Builds and remembers training programs from openGym&apos;s 1,324-exercise library. Ask how to perform a registered exercise and its animation plays right in chat.
                          </span>
                        </button>
                        <FavoriteBox
                          color={highlightColorForId("agent:open-gym")}
                          onColorChange={(color) => setHighlightId("agent:open-gym", color)}
                          label="Choose openGym highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showShorts
                      ? [{ name: "Shorts", node: (
                      <li key="shorts"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:shorts"))}
                      >
                        <button
                          id="shorts-entry"
                          type="button"
                          onClick={() => {
                            onSelectShorts?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{SHORTS_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Turns a long video into short vertical clips of its best moments — it listens to the whole thing, picks the parts worth posting, and crops each one to follow the speaker. Asks for a video instead of a message.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Shorts"
                          onOpen={() => {
                            setAgentSettingsFor("shorts");
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:shorts")}
                          onColorChange={(color) => setHighlightId("agent:shorts", color)}
                          label="Choose Shorts highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showFormsmith
                      ? [{ name: "Formsmith", node: (
                      <li key="formsmith"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:formsmith"))}
                      >
                        <button
                          id="formsmith-entry"
                          type="button"
                          onClick={() => {
                            onSelectFormsmith?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{FORMSMITH_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Turns one JPEG, PNG, or WebP picture into a rotatable 3D GLB with the local ShapeR model. Accepts a picture instead of a message.
                          </span>
                        </button>
                        <FavoriteBox
                          color={highlightColorForId("agent:formsmith")}
                          onColorChange={(color) => setHighlightId("agent:formsmith", color)}
                          label="Choose Formsmith highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showVibeTrading
                      ? [{ name: "Vibe Trading", node: (
                      <li key="vibe-trading"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:vibe-trading"))}
                      >
                        <button
                          id="vibe-trading-entry"
                          type="button"
                          onClick={() => {
                            onSelectVibeTrading?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{VIBE_TRADING_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Ask a finance question in plain words and it does the work: pulls market data, builds and backtests a strategy, tests a factor, or checks a thesis — and shows the numbers behind the answer.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Vibe Trading"
                          onOpen={() => {
                            setAgentSettingsFor("vibe-trading");
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:vibe-trading")}
                          onColorChange={(color) => setHighlightId("agent:vibe-trading", color)}
                          label="Choose Vibe Trading highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showStockAnalyst
                      ? [{ name: "Stock Analyst", node: (
                      <li key="stock-analyst"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:stock-analyst"))}
                      >
                        <button
                          id="stock-analyst-entry"
                          type="button"
                          onClick={() => {
                            onSelectStockAnalyst?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{STOCK_ANALYST_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Answers a question about a named stock with live prices, charts, news and its own strategy playbooks — across mainland China, Hong Kong, the US, Japan, Korea and Taiwan.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Stock Analyst"
                          onOpen={() => {
                            setAgentSettingsFor("stock-analyst");
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:stock-analyst")}
                          onColorChange={(color) => setHighlightId("agent:stock-analyst", color)}
                          label="Choose Stock Analyst highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showDeerFlow
                      ? [{ name: "DeerFlow", node: (
                      <li key="deer-flow"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:deer-flow"))}
                      >
                        <button
                          id="deer-flow-entry"
                          type="button"
                          onClick={() => {
                            onSelectDeerFlow?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{DEER_FLOW_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Give it a job rather than a question: it plans, searches, writes files in its own workspace, hands parts off to helper agents, and comes back with the work and the documents it produced.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="DeerFlow"
                          onOpen={() => {
                            setAgentSettingsFor("deer-flow");
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:deer-flow")}
                          onColorChange={(color) => setHighlightId("agent:deer-flow", color)}
                          label="Choose DeerFlow highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showDeepResearch
                      ? [{ name: "Deep Research", node: (
                      <li key="deep-research"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:deep-research"))}
                      >
                        <button
                          id="deep-research-entry"
                          type="button"
                          onClick={() => {
                            if (!onSelectDeepResearch) return;
                            onSelectDeepResearch();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{DEEP_RESEARCH_SLASH_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Investigates a question through several rounds of web research, compares the evidence, and returns a detailed report with sources.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Deep Research"
                          onOpen={() => {
                            setAgentSettingsFor("deep-research");
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:deep-research")}
                          onColorChange={(color) => setHighlightId("agent:deep-research", color)}
                          label="Choose Deep Research highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showOpenPlanter
                      ? [{ name: "OpenPlanter", node: (
                      <li key="openplanter"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:openplanter"))}
                      >
                        <button
                          id="openplanter-entry"
                          type="button"
                          onClick={() => {
                            onSelectOpenPlanter?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{OPENPLANTER_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Breaks a complex problem into connected questions, investigates each one, and shows a visual map, findings, and suggested changes in chat.
                          </span>
                        </button>
                        <FavoriteBox
                          color={highlightColorForId("agent:openplanter")}
                          onColorChange={(color) => setHighlightId("agent:openplanter", color)}
                          label="Choose OpenPlanter highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showSocialsManager
                      ? [{ name: "Socials Manager", node: (
                      <li key="socials-manager"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:socials-manager"))}
                      >
                        <button
                          id="socials-manager-entry"
                          type="button"
                          onClick={() => {
                            onSelectSocialsManager?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{SOCIALS_MANAGER_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Drafts a tailored post for each connected social platform and saves every version for review. You decide which drafts to schedule.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Socials Manager"
                          onOpen={() => {
                            setSocialsManagerSettingsOpen(true);
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:socials-manager")}
                          onColorChange={(color) => setHighlightId("agent:socials-manager", color)}
                          label="Choose Socials Manager highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showHardwareBlueprint
                      ? [{ name: "Hardware Blueprint", node: (
                      <li key="hardware-blueprint"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:hardware-blueprint"))}
                      >
                        <button
                          id="hardware-blueprint-entry"
                          type="button"
                          onClick={() => {
                            onSelectHardwareBlueprint?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{HARDWARE_BLUEPRINT_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Turns a hardware idea into a checked circuit: a wiring diagram, a schematic, a parts list, step-by-step assembly, and firmware that uses the same pins.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Hardware Blueprint"
                          onOpen={() => {
                            setAgentSettingsFor("hardware-blueprint");
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:hardware-blueprint")}
                          onColorChange={(color) => setHighlightId("agent:hardware-blueprint", color)}
                          label="Choose Hardware Blueprint highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showParametricCad
                      ? [{ name: "Parametric CAD", node: (
                      <li key="parametric-cad"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:parametric-cad"))}
                      >
                        <button
                          id="parametric-cad-entry"
                          type="button"
                          onClick={() => {
                            onSelectParametricCad?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{PARAMETRIC_CAD_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Designs a dimensioned, 3D-printable part: parametric CAD source built through a real kernel, checked geometry, an interactive preview, and STEP, STL, GLB and 3MF to download.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Parametric CAD"
                          onOpen={() => {
                            setAgentSettingsFor("parametric-cad");
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:parametric-cad")}
                          onColorChange={(color) => setHighlightId("agent:parametric-cad", color)}
                          label="Choose Parametric CAD highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showHyperframes
                      ? [{ name: "HyperFrames", node: (
                      <li key="hyperframes"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:hyperframes"))}
                      >
                        <button
                          id="hyperframes-entry"
                          type="button"
                          onClick={() => {
                            onSelectHyperframes?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{HYPERFRAMES_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Makes a short video from a description — writes the animation, checks it in a browser, renders an MP4, and plays it in chat.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="HyperFrames"
                          onOpen={() => {
                            setHyperframesSettingsOpen(true);
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:hyperframes")}
                          onColorChange={(color) => setHighlightId("agent:hyperframes", color)}
                          label="Choose HyperFrames highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showResource2Skill
                      ? [{ name: "Resource2Skill", node: (
                      <li key="resource2skill"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:resource2skill"))}
                      >
                        <button
                          id="resource2skill-entry"
                          type="button"
                          onClick={() => {
                            onSelectResource2Skill?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{RESOURCE2SKILL_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Builds polished Web, PowerPoint, Excel, Blender, or audio artifacts with Microsoft&apos;s distilled multimodal skill libraries.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Resource2Skill"
                          onOpen={() => {
                            setResource2SkillSettingsOpen(true);
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:resource2skill")}
                          onColorChange={(color) => setHighlightId("agent:resource2skill", color)}
                          label="Choose Resource2Skill highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showBoltSlides
                      ? [{ name: "Bolt Slides", node: (
                      <li key="bolt-slides"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:bolt-slides"))}
                      >
                        <button
                          id="bolt-slides-entry"
                          type="button"
                          onClick={() => {
                            onSelectBoltSlides?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{BOLT_SLIDES_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Builds a presentation you can actually present &mdash; every slide a live web page, with click-builds, annotation, and a presenter view.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Bolt Slides"
                          onOpen={() => {
                            setBoltSlidesSettingsOpen(true);
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:bolt-slides")}
                          onColorChange={(color) => setHighlightId("agent:bolt-slides", color)}
                          label="Choose Bolt Slides highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showGodsEye
                      ? [{ name: "God's Eye", node: (
                      <li key="gods-eye"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:gods-eye"))}
                      >
                        <button
                          id="gods-eye-entry"
                          type="button"
                          onClick={() => {
                            onSelectGodsEye?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{GODS_EYE_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Aims a photorealistic live globe &mdash; aircraft, ships, satellites, quakes, cameras &mdash; at whatever you name, framed right in the chat.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="God's Eye"
                          onOpen={() => {
                            setGodsEyeSettingsOpen(true);
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:gods-eye")}
                          onColorChange={(color) => setHighlightId("agent:gods-eye", color)}
                          label="Choose God's Eye highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showClassroom
                      ? [{ name: "Classroom", node: (
                      <li key="classroom"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:classroom"))}
                      >
                        <button
                          id="classroom-entry"
                          type="button"
                          onClick={() => {
                            onSelectClassroom?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{CLASSROOM_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Teaches a topic or your attached documents as an interactive classroom &mdash; slides with an AI teacher, quizzes, simulations, and project work.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Classroom"
                          onOpen={() => {
                            setClassroomSettingsOpen(true);
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:classroom")}
                          onColorChange={(color) => setHighlightId("agent:classroom", color)}
                          label="Choose Classroom highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showMatraix
                      ? [{ name: "MatrAIx", node: (
                      <li key="matraix"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:matraix"))}
                      >
                        <button
                          id="matraix-entry"
                          type="button"
                          onClick={() => {
                            onSelectMatraix?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{MATRAIX_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Puts your idea, wording, or price to a sampled population of simulated people and reports how they split, and why.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="MatrAIx"
                          onOpen={() => {
                            setMatraixSettingsOpen(true);
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:matraix")}
                          onColorChange={(color) => setHighlightId("agent:matraix", color)}
                          label="Choose MatrAIx highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showOpenMontage
                      ? [{ name: "OpenMontage", node: (
                      <li key="openmontage"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:openmontage"))}
                      >
                        <button
                          id="openmontage-entry"
                          type="button"
                          onClick={() => {
                            onSelectOpenMontage?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{OPENMONTAGE_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Runs a full video production from one brief — picks a pipeline, writes the script and scene plan, sources or generates the assets, cuts the edit, and renders the film.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="OpenMontage"
                          onOpen={() => {
                            setOpenMontageSettingsOpen(true);
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:openmontage")}
                          onColorChange={(color) => setHighlightId("agent:openmontage", color)}
                          label="Choose OpenMontage highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showOpenwork
                      ? [{ name: "OpenWork", node: (
                      <li key="openwork"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:openwork"))}
                      >
                        <button
                          id="openwork-entry"
                          type="button"
                          onClick={() => {
                            onSelectOpenwork?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{OPENWORK_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Does the work inside your OpenWork workspace — its skills and connected services — and hands back anything it made.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="OpenWork"
                          onOpen={() => {
                            setOpenworkSettingsOpen(true);
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:openwork")}
                          onColorChange={(color) => setHighlightId("agent:openwork", color)}
                          label="Choose OpenWork highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showInboxZero
                      ? [{ name: "Inbox Zero", node: (
                      <li key="inbox-zero"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:inbox-zero"))}
                      >
                        <button
                          id="inbox-zero-entry"
                          type="button"
                          onClick={() => {
                            onSelectInboxZero?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{INBOX_ZERO_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Works through your real email — finds and summarizes threads, drafts and sends replies, archives, labels and unsubscribes, and sets up rules that sort mail for you. Asks before it sends anything.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Inbox Zero"
                          onOpen={() => {
                            setInboxZeroSettingsOpen(true);
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:inbox-zero")}
                          onColorChange={(color) => setHighlightId("agent:inbox-zero", color)}
                          label="Choose Inbox Zero highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showMaxResearch
                      ? [{ name: "Max Research", node: (
                      <li key="max-research"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:max-research"))}
                      >
                        <button
                          id="max-research-entry"
                          type="button"
                          onClick={() => {
                            onSelectMaxResearch?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{MAX_RESEARCH_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Puts all six research agents on one question — the indexed web, the open internet, the papers, a workspace that runs things, and an autonomous R&amp;D project — then reconciles what they found into one answer. Long.
                          </span>
                        </button>
                        <FavoriteBox
                          color={highlightColorForId("agent:max-research")}
                          onColorChange={(color) => setHighlightId("agent:max-research", color)}
                          label="Choose Max Research highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showOpenscience
                      ? [{ name: "OpenScience", node: (
                      <li key="openscience"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:openscience"))}
                      >
                        <button
                          id="openscience-entry"
                          type="button"
                          onClick={() => {
                            onSelectOpenscience?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{OPENSCIENCE_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Takes a research question and works it through — reads the literature, writes and runs the code, and tells you what it found.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="OpenScience"
                          onOpen={() => {
                            setOpenscienceSettingsOpen(true);
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:openscience")}
                          onColorChange={(color) => setHighlightId("agent:openscience", color)}
                          label="Choose OpenScience highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showPraxist
                      ? [{ name: "Praxist", node: (
                      <li key="praxist"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:praxist"))}
                      >
                        <button
                          id="praxist-entry"
                          type="button"
                          onClick={() => {
                            onSelectPraxist?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{PRAXIST_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Runs an existing measurable Praxist task project through its multi-agent, multi-generation research loop. Add the absolute task directory after the command.
                          </span>
                        </button>
                        <FavoriteBox
                          color={highlightColorForId("agent:praxist")}
                          onColorChange={(color) => setHighlightId("agent:praxist", color)}
                          label="Choose Praxist highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showVimax
                      ? [{ name: "ViMax", node: (
                      <li key="vimax"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:vimax"))}
                      >
                        <button
                          id="vimax-entry"
                          type="button"
                          onClick={() => {
                            onSelectVimax?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{VIMAX_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Turns an idea into a film — writes the story and screenplay, casts and draws the characters, storyboards every shot, and plays the result back as an animatic.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="ViMax"
                          onOpen={() => {
                            setAgentSettingsFor("vimax");
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:vimax")}
                          onColorChange={(color) => setHighlightId("agent:vimax", color)}
                          label="Choose ViMax highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showVoxDirector
                      ? [{ name: "Vox Director", node: (
                      <li key="vox-director"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:vox-director"))}
                      >
                        <button
                          id="vox-director-entry"
                          type="button"
                          onClick={() => {
                            onSelectVoxDirector?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{VOX_DIRECTOR_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Explains a topic in a short narrated video — a torn-paper collage poster for each beat, its pieces flying into place, read aloud and rendered on this machine.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Vox Director"
                          onOpen={() => {
                            setAgentSettingsFor("vox-director");
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:vox-director")}
                          onColorChange={(color) => setHighlightId("agent:vox-director", color)}
                          label="Choose Vox Director highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showMoneyPrinter
                      ? [{ name: "MoneyPrinter", node: (
                      <li key="money-printer"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:money-printer"))}
                      >
                        <button
                          id="money-printer-entry"
                          type="button"
                          onClick={() => {
                            onSelectMoneyPrinter?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{MONEY_PRINTER_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Turns a topic into a finished short video — writes the script, reads it aloud, finds stock footage to match, adds subtitles and music, and hands you an MP4.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="MoneyPrinter"
                          onOpen={() => {
                            setAgentSettingsFor("money-printer");
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:money-printer")}
                          onColorChange={(color) => setHighlightId("agent:money-printer", color)}
                          label="Choose MoneyPrinter highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showLegal
                      ? [{ name: "Legal Agent", node: (
                      <li key="legal"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:legal"))}
                      >
                        <button
                          id="legal-entry"
                          type="button"
                          onClick={() => {
                            onSelectLegal?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{LEGAL_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Attach contracts, filings or a data room and say what you need — a review, an issues list, a memo, a draft. Reads every document, cites where each point comes from, and hands back the finished Word, Excel or PowerPoint file. A draft for a lawyer to check, not legal advice.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Legal Agent"
                          onOpen={() => {
                            setAgentSettingsFor("legal");
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:legal")}
                          onColorChange={(color) => setHighlightId("agent:legal", color)}
                          label="Choose Legal Agent highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showWardrobe
                      ? [{ name: "Wardrobe", node: (
                      <li key="wardrobe"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:wardrobe"))}
                      >
                        <button
                          id="wardrobe-entry"
                          type="button"
                          onClick={() => {
                            onSelectWardrobe?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{WARDROBE_COMMAND}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Attach photos of your clothes — worn, hung up or laid out. Finds each garment, cuts it out on its own, makes a photo of you wearing it, and files the piece in a wardrobe you can browse.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Wardrobe"
                          onOpen={() => {
                            setWardrobeSettingsOpen(true);
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:wardrobe")}
                          onColorChange={(color) => setHighlightId("agent:wardrobe", color)}
                          label="Choose Wardrobe highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showOpenCode
                      ? [{ name: "OpenCode", node: (
                      <li key="opencode"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:opencode"))}
                      >
                        <button
                          id="opencode-entry"
                          type="button"
                          onClick={() => {
                            onSelectOpenCode?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">
                            {OPENCODE_COMMAND}
                          </span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Reads, edits, and tests the local project linked to this Garden to build features, fix bugs, or explain the code.
                          </span>
                        </button>
                        <FavoriteBox
                          color={highlightColorForId("agent:opencode")}
                          onColorChange={(color) => setHighlightId("agent:opencode", color)}
                          label="Choose OpenCode highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showCodex
                      ? [{ name: "Codex", node: (
                      <li key="codex"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:codex"))}
                      >
                        <button
                          id="codex-entry"
                          type="button"
                          onClick={() => {
                            onSelectCodex?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">
                            {CODEX_COMMAND}
                          </span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Uses Codex to read, edit, and test the local project linked to this Garden, with its progress and result shown in chat.
                          </span>
                        </button>
                        <FavoriteBox
                          color={highlightColorForId("agent:codex")}
                          onColorChange={(color) => setHighlightId("agent:codex", color)}
                          label="Choose Codex highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showRuflo
                      ? [{ name: "Ruflo", node: (
                      <li key="ruflo"
                        className="group flex items-center gap-2 hover:bg-[var(--paper-surface)]"
                        style={capabilityHighlightStyle(highlightColorForId("agent:ruflo"))}
                      >
                        <button
                          id="ruflo-entry"
                          type="button"
                          onClick={() => {
                            onSelectRuflo?.();
                            onOpenChange(false);
                          }}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                        >
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">
                            {RUFLO_COMMAND}
                          </span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Coordinates several coding workers on larger changes in the linked project, covering planning, implementation, and review in one run.
                          </span>
                        </button>
                        <AgentSettingsButton
                          name="Ruflo"
                          onOpen={() => {
                            setAgentSettingsFor("ruflo");
                            onOpenChange(false);
                          }}
                        />
                        <FavoriteBox
                          color={highlightColorForId("agent:ruflo")}
                          onColorChange={(color) => setHighlightId("agent:ruflo", color)}
                          label="Choose Ruflo highlight color"
                        />
                      </li>
                      ) }]
                      : []),
                    ...(showAgencyDirectory
                      ? [{ name: "Agency agents", node: (
                    <li key="agency-agents" className={agentDirectoryOpen ? "bg-[var(--paper-surface)]" : "hover:bg-[var(--paper-surface)]"}>
                      <button
                        id="agency-agents-directory"
                        type="button"
                        onClick={() => void toggleAgentDirectory()}
                        aria-expanded={agentDirectoryOpen}
                        aria-controls="agency-agents-directory-panel"
                        className="group flex w-full items-center gap-2 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">
                            {AGENCY_AGENTS_DIRECTORY_COMMAND}
                          </span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">
                            Browse specialist personas for design, engineering, marketing, strategy, and more.
                          </span>
                        </span>
                        <svg aria-hidden className={`h-4 w-4 shrink-0 text-[var(--ink-muted)] transition ${agentDirectoryOpen ? "rotate-180" : "group-hover:translate-x-0.5"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
                        </svg>
                      </button>
                    </li>
                      ) }]
                      : []),
                    ]
                      .sort((left, right) => left.name.localeCompare(right.name))
                      .map((row) => row.node)}
                  </ul>
                    {!hasVisibleAgents ? (
                      <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center">
                        <span className="text-[var(--botanical)]">
                          <CapabilityIcon kind="agent" />
                        </span>
                        <p className="mt-3 text-sm font-medium text-[var(--ink-heading)]">
                          No matching agents
                        </p>
                        <p className="mt-1 text-xs text-[var(--ink-muted)]">
                          Try a different search.
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : detail === "manage-prompts" ? (
                  <div className="p-3">
                    <div className="flex items-center gap-3"><button type="button" onClick={() => setDetail(null)} className="text-xs text-[var(--botanical)]">← Back</button><h3 className="font-semibold text-[var(--ink-heading)]">Manage prompts</h3><button type="button" onClick={() => { setEditingPromptId(null); setPromptTitle(""); setPromptCategory("Custom"); setPromptContent(""); setDetail("new-prompt"); setDetailMessage(null); }} className="ml-auto text-xs font-medium text-[var(--botanical)]">New prompt</button></div>
                    {detailMessage ? <p role="status" className="mt-3 text-xs text-[#8a6f00]">{detailMessage}</p> : null}
                    <ul className="mt-3 space-y-2">{data?.groups.prompts.map((item) => <li key={item.id} className="rounded-xl bg-[var(--paper-surface)] p-3"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-[var(--ink-heading)]">{item.name}</p><p className="mt-1 line-clamp-3 text-xs text-[var(--ink-muted)]">{item.content ?? item.description}</p><p className="mt-2 text-[10px] text-[var(--ink-muted)]">{item.category ?? "Custom"} · {item.isDefault ? "Breadboard default" : "Your prompt"}</p></div><div className="flex shrink-0 gap-1"><button type="button" onClick={() => editPrompt(item)} className="rounded-lg px-2 py-1 text-xs text-[var(--botanical)]">{item.isDefault ? "Use as copy" : "Edit"}</button><button type="button" onClick={() => duplicatePrompt(item)} className="rounded-lg px-2 py-1 text-xs text-[var(--botanical)]">Duplicate</button>{item.isDefault ? null : <button type="button" onClick={() => void deleteSavedPrompt(item)} className="rounded-lg px-2 py-1 text-xs text-[#9a4438]">Delete</button>}</div></div></li>)}</ul>
                  </div>
                ) : detail === "new-prompt" ? (
                  <div className="p-3">
                    <div className="flex items-center gap-3"><button type="button" onClick={() => setDetail("manage-prompts")} className="text-xs text-[var(--botanical)]">← Back</button><h3 className="font-semibold text-[var(--ink-heading)]">{editingPromptId ? "Edit prompt" : "Create a prompt"}</h3><button type="button" onClick={() => setDetail("manage-prompts")} className="ml-auto text-xs text-[var(--botanical)]">Manage prompts</button></div>
                    <label className="mt-4 block text-xs font-medium">Title<input autoFocus value={promptTitle} onChange={(event) => setPromptTitle(event.target.value)} className="neu-control mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--botanical)]" placeholder="Research synthesis" /></label>
                    <label className="mt-3 block text-xs font-medium">Category<input value={promptCategory} onChange={(event) => setPromptCategory(event.target.value)} className="neu-control mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm" /></label>
                    <label className="mt-3 block text-xs font-medium">Prompt<textarea value={promptContent} onChange={(event) => setPromptContent(event.target.value)} rows={7} className="mt-1.5 w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--botanical)]" placeholder="Describe the reusable instruction…" /></label>
                    <p className="mt-2 text-[11px] text-[var(--ink-muted)]">Prompts organize instructions but never grant tools, connections, or implementation capability.</p>
                    {detailMessage ? <p role="status" className="mt-3 text-xs text-[#8a6f00]">{detailMessage}</p> : null}
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button type="button" disabled={!promptTitle.trim() || !promptContent.trim()} onClick={() => void savePrompt()} className="neu-button-accent rounded-xl bg-[var(--botanical)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40">Save prompt</button>
                    </div>
                  </div>
                ) : tabItems.length ? (
                  <ul
                    role="listbox"
                    aria-label={tabs.find((item) => item.id === tab)?.label}
                    className="space-y-0.5"
                  >
                    {tabItems.map((item, index) => {
                      const enabled = Boolean(item.enabled && item.healthy);
                      const highlightColor = highlightColorForItem(item);
                      return (
                        <li key={itemIdentity(item)} role="option" aria-selected={index === activeIndex}>
                          <div
                            className={`group flex items-center gap-2 rounded-xl ${index === activeIndex ? "bg-[var(--paper-surface)]" : "hover:bg-[var(--paper-surface)]"}`}
                            style={capabilityHighlightStyle(highlightColor)}
                          >
                            <button
                              type="button"
                              disabled={!enabled}
                              onMouseEnter={() => setActiveIndex(index)}
                              onClick={() => choose(item)}
                              className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)] disabled:cursor-not-allowed disabled:opacity-55"
                            >
                              {item.kind === "prompt" ? null : (
                                <span
                                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--paper-strong)] text-[var(--botanical)]"
                                  style={item.kind === "agent" && item.divisionColor ? { color: item.divisionColor } : undefined}
                                >
                                  {item.kind === "agent" && item.emoji
                                    ? <span aria-hidden className="text-base">{item.emoji}</span>
                                    : <CapabilityIcon kind={item.kind} />}
                                </span>
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                  {item.kind === "prompt" ? (
                                    <span className="block truncate break-all font-mono text-sm font-medium text-[var(--ink-heading)]">
                                      /{item.token ?? item.slug ?? item.name}
                                    </span>
                                  ) : (
                                    <span className="truncate text-sm font-medium text-[var(--ink-heading)]">{item.name}</span>
                                  )}
                                </span>
                                <span className={`mt-0.5 block text-xs text-[var(--ink-muted)] ${item.kind === "agent" ? "line-clamp-2" : "truncate"}`}>{item.description}</span>
                                {item.kind === "agent" && item.vibe ? (
                                  <span className="mt-1 block truncate text-[10px] italic text-[var(--ink-muted)]">{item.vibe}</span>
                                ) : null}
                                {item.kind === "agent" && item.services?.length ? (
                                  <span className="mt-1.5 flex flex-wrap gap-1">
                                    {item.services.slice(0, 3).map((service) => (
                                      <span key={`${item.id}:${service.name}`} className="rounded-full bg-[var(--paper-strong)] px-1.5 py-0.5 text-[9px] text-[var(--ink-muted)]">
                                        {service.name}
                                      </span>
                                    ))}
                                    {item.services.length > 3 ? <span className="text-[9px] text-[var(--ink-muted)]">+{item.services.length - 3}</span> : null}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                            <FavoriteBox
                              color={highlightColor}
                              onColorChange={(color) => setHighlight(item, color)}
                              label={`Choose ${item.name} highlight color`}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center">
                    <span className="text-[var(--botanical)]">
                      {tab === "workflow"
                        ? <span aria-hidden>↝</span>
                        : tab === "reference"
                          ? <CapabilityIcon kind="mcp" />
                          : <CapabilityIcon kind={tab} />}
                    </span>
                    <p className="mt-3 text-sm font-medium text-[var(--ink-heading)]">
                      {query
                        ? "No matching capabilities"
                        : tab === "agent"
                          ? "No agents available"
                          : "No prompts yet"}
                    </p>
                    <p className="mt-1 max-w-xs text-xs text-[var(--ink-muted)]">
                      {query
                        ? "Try a different search."
                        : tab === "agent"
                          ? agencyAgentsNotice ?? data?.notices?.agents ?? "Open Agency agents to load specialist personas."
                          : "Create a reusable instruction for your work."}
                    </p>
                  </div>
                )}
              </div>
              {(agencyAgentsNotice ?? data?.notices?.agents) && tab === "agent" && !detail && !agentDirectoryOpen ? <p className="border-t border-[var(--line)] px-4 py-2 text-[11px] text-[#8a6f00]">{agencyAgentsNotice ?? data?.notices?.agents}</p> : null}
            </section>
            {agentDirectoryOpen && tab === "agent" && !detail ? (
              <aside
                id="agency-agents-directory-panel"
                aria-labelledby="agency-agents-directory-title"
                onKeyDown={handleKeyDown}
                className="neu-popover fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-50 flex max-h-[min(82dvh,680px)] flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-full sm:left-[calc(min(600px,calc(100vw-2rem))+0.5rem)] sm:mb-3 sm:h-[min(620px,72vh)] sm:w-[min(380px,calc(100vw-2rem))]"
              >
                <header className="border-b border-[var(--line)] px-4 pb-3 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 id="agency-agents-directory-title" className="text-sm font-semibold text-[var(--ink-heading)]">
                        Agency agents
                      </h3>
                      <p className="mt-1 text-[11px] leading-4 text-[var(--ink-muted)]">
                        Choose a specialist persona for this conversation.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAgentDirectoryOpen(false);
                        setQuery("");
                        setActiveIndex(0);
                        window.setTimeout(
                          () => document.getElementById("agency-agents-directory")?.focus(),
                          0,
                        );
                      }}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                      aria-label="Close Agency agents"
                    >
                      ×
                    </button>
                  </div>
                  <div className="relative mt-3">
                    <svg aria-hidden className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="11" cy="11" r="6.5" />
                      <path strokeLinecap="round" d="m16 16 4 4" />
                    </svg>
                    <input
                      ref={agentSearchRef}
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setActiveIndex(0);
                      }}
                      placeholder="Search Agency agents"
                      className="neu-control w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] py-2.5 pl-9 pr-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--botanical)]"
                      aria-label="Search Agency agents"
                    />
                  </div>
                  <p className="mt-2 text-[10px] text-[var(--ink-muted)]" role="status">
                    {agencyAgentsLoading
                      ? "Loading Agency agents…"
                      : agencyAgentsNotice
                        ? agencyAgentsNotice
                        : `${agencyDirectoryItems.length.toLocaleString()} Agency agents in ${agencyDirectoryGroups.length.toLocaleString()} divisions`}
                  </p>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                  {agencyDirectoryItems.length ? (
                    <ul role="listbox" aria-label="Agency agents" className="divide-y divide-[var(--line)]">
                      {agencyDirectoryGroups.flatMap((group) => [
                        <li
                          key={`division:${group.label}`}
                          role="presentation"
                          className="sticky top-0 z-10 flex items-center gap-2 bg-[var(--paper-raised)] px-3 py-2 text-xs font-medium text-[var(--ink-muted)]"
                        >
                          <span
                            aria-hidden
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: group.items[0]?.item.divisionColor ?? "var(--botanical)" }}
                          />
                          <span className="min-w-0 flex-1 truncate">{group.label}</span>
                          <span className="tabular-nums">{group.items.length}</span>
                        </li>,
                        ...group.items.map(({ item, index }) => {
                          const enabled = Boolean(item.enabled && item.healthy);
                          const highlightColor = highlightColorForItem(item);
                          return (
                            <li key={itemIdentity(item)} role="option" aria-selected={index === activeIndex}>
                              <div
                                className={`group flex items-center gap-2 rounded-xl ${index === activeIndex ? "bg-[var(--paper-surface)]" : "hover:bg-[var(--paper-surface)]"}`}
                                style={capabilityHighlightStyle(highlightColor)}
                              >
                                <button
                                  type="button"
                                  disabled={!enabled}
                                  onMouseEnter={() => setActiveIndex(index)}
                                  onFocus={() => setActiveIndex(index)}
                                  onClick={() => choose(item)}
                                  className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)] disabled:cursor-not-allowed disabled:opacity-55"
                                >
                                  <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-2">
                                      <span className="truncate font-mono text-sm font-medium text-[var(--ink-heading)]">/{item.token}</span>
                                    </span>
                                      <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink-muted)]">{item.description}</span>
                                      {item.vibe ? (
                                        <span className="mt-1 block truncate text-[10px] italic text-[var(--ink-muted)]">{item.vibe}</span>
                                      ) : null}
                                      {item.services?.length ? (
                                        <span className="mt-1 block truncate text-[10px] text-[var(--ink-muted)]">
                                          {item.services.map((service) => service.name).join(", ")}
                                        </span>
                                      ) : null}
                                  </span>
                                </button>
                                <FavoriteBox
                                  color={highlightColor}
                                  onColorChange={(color) => setHighlight(item, color)}
                                  label={`Choose ${item.name} highlight color`}
                                />
                              </div>
                            </li>
                          );
                        }),
                      ])}
                    </ul>
                  ) : (
                    <p className="px-4 py-10 text-center text-sm text-[var(--ink-muted)]">
                      {query
                        ? "No Agency agents matched this search."
                        : agencyAgentsNotice ?? data?.notices?.agents ?? "No Agency agents are available."}
                    </p>
                  )}
                </div>
                <p className="border-t border-[var(--line)] px-4 py-3 text-[10px] leading-4 text-[var(--ink-muted)]">
                  Selecting an agent applies its persona to this conversation. It does not grant extra tools or permissions.
                </p>
              </aside>
            ) : null}
          </>
        ) : null}
        {surface === "quartz_ai" ? null : browserOperatorOpen ? (
          <BrowserOperatorDialog onClose={() => setBrowserOperatorOpen(false)} />
        ) : null}
        {surface === "quartz_ai" ? null : socialsManagerSettingsOpen ? (
          <SocialsManagerSettingsDialog onClose={() => setSocialsManagerSettingsOpen(false)} />
        ) : null}
        {surface === "quartz_ai" ? null : agentReachSettingsOpen ? (
          <AgentReachSettingsDialog onClose={() => setAgentReachSettingsOpen(false)} />
        ) : null}
        {surface === "quartz_ai" ? null : hyperframesSettingsOpen ? (
          <HyperframesSettingsDialog onClose={() => setHyperframesSettingsOpen(false)} />
        ) : null}
        {surface === "quartz_ai" ? null : resource2SkillSettingsOpen ? (
          <Resource2SkillSettingsDialog onClose={() => setResource2SkillSettingsOpen(false)} />
        ) : null}
        {surface === "quartz_ai" ? null : boltSlidesSettingsOpen ? (
          <BoltSlidesSettingsDialog onClose={() => setBoltSlidesSettingsOpen(false)} />
        ) : null}
        {surface === "quartz_ai" ? null : classroomSettingsOpen ? (
          <ClassroomSettingsDialog onClose={() => setClassroomSettingsOpen(false)} />
        ) : null}
        {surface === "quartz_ai" ? null : godsEyeSettingsOpen ? (
          <GodsEyeSettingsDialog onClose={() => setGodsEyeSettingsOpen(false)} />
        ) : null}
        {surface === "quartz_ai" ? null : matraixSettingsOpen ? (
          <MatraixSettingsDialog onClose={() => setMatraixSettingsOpen(false)} />
        ) : null}
        {surface === "quartz_ai" ? null : openMontageSettingsOpen ? (
          <OpenMontageSettingsDialog onClose={() => setOpenMontageSettingsOpen(false)} />
        ) : null}
        {surface === "quartz_ai" ? null : openscienceSettingsOpen ? (
          <OpenscienceSettingsDialog onClose={() => setOpenscienceSettingsOpen(false)} />
        ) : null}
        {surface === "quartz_ai" ? null : wardrobeSettingsOpen ? (
          <WardrobeSettingsDialog onClose={() => setWardrobeSettingsOpen(false)} />
        ) : null}
        {surface === "quartz_ai" ? null : inboxZeroSettingsOpen ? (
          <InboxZeroSettingsDialog onClose={() => setInboxZeroSettingsOpen(false)} />
        ) : null}
        {surface === "quartz_ai" ? null : openworkSettingsOpen ? (
          <OpenworkSettingsDialog onClose={() => setOpenworkSettingsOpen(false)} />
        ) : null}
        {surface === "quartz_ai" ? null : agentSettingsFor ? (
          <AgentSettingsDialog
            agentId={agentSettingsFor}
            gardenSlug={gardenSlug}
            onClose={() => setAgentSettingsFor(null)}
          />
        ) : null}
      </div>
    );
  },
);
