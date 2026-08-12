// Server-only configuration for the Hermes integration.
//
// Hermes is the interactive agent runtime that backs the three Breadboard
// interactive surfaces (dashboard terminal, garden chat, Quartz page AI). It is
// a separate local process that Breadboard talks to
// exclusively from the server. None of this may ever reach the browser: the
// base URL, credentials, and workspace roots stay server-side.
//
// Everything is read lazily from `process.env` so the feature flag can be
// toggled without a rebuild, and so importing this module never throws when
// Hermes is disabled.

import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

export type HermesSurface =
  | "dashboard_terminal"
  | "garden_chat"
  | "quartz_ai";

export type HermesMode = "required" | "preferred" | "legacy";

export const HERMES_SURFACES: readonly HermesSurface[] = [
  "dashboard_terminal",
  "garden_chat",
  "quartz_ai",
] as const;

export interface HermesConfig {
  enabled: boolean;
  mode: HermesMode;
  /**
   * Absolute path Hermes treats as the root under which per-session
   * workspaces are created. Defaults to `<repo>/.runtime/hermes`.
   */
  root: string;
  agents: {
    terminal: string;
    garden: string;
    quartz: string;
    capabilityScout: string;
  };
  /**
   * URL the Hermes garden/quartz tool adapter uses to call back into
   * Breadboard's internal tool endpoint. Server-to-server only; never sent to a
   * browser. Defaults to the local dashboard.
   */
  dashboardInternalUrl: string;
}

function envString(name: string, fallback: string): string {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function envFlag(name: string): boolean {
  const value = process.env[name];
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function modeFromEnvironment(): HermesMode {
  const configured = process.env.HERMES_MODE?.trim().toLowerCase();
  if (configured === "required" || configured === "preferred" || configured === "legacy") {
    return configured;
  }
  // HERMES_ENABLED is retained as a compatibility kill switch. A clean
  // checkout is Hermes-first; only an explicit false opts into legacy.
  if (process.env.HERMES_ENABLED !== undefined && !envFlag("HERMES_ENABLED")) {
    return "legacy";
  }
  return "required";
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "http://127.0.0.1:3000";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/**
 * The default workspace root. We keep runtime workspaces inside the Breadboard
 * repo (but git-ignored) so path canonicalization stays simple and predictable
 * across platforms. Callers can override with HERMES_ROOT.
 */
function defaultRoot(): string {
  // The runtime dir lives at the repo root (dev) or wherever the desktop
  // shell's BREADBOARD_REPO_ROOT points; HERMES_ROOT overrides entirely.
  return path.join(repositoryRoot(), ".runtime", "hermes");
}

export function readHermesConfig(): HermesConfig {
  const mode = modeFromEnvironment();
  return {
    enabled: mode !== "legacy",
    mode,
    root: envString("HERMES_ROOT", defaultRoot()),
    agents: {
      terminal: envString("HERMES_TERMINAL_AGENT", "breadboard-assistant"),
      garden: envString("HERMES_GARDEN_AGENT", "breadboard-garden"),
      quartz: envString("HERMES_QUARTZ_AGENT", "breadboard-quartz"),
      capabilityScout: envString(
        "HERMES_CAPABILITY_SCOUT_AGENT",
        "capability-scout",
      ),
    },
    dashboardInternalUrl: normalizeBaseUrl(
      envString("BREADBOARD_INTERNAL_URL", "http://127.0.0.1:3000"),
    ),
  };
}

/**
 * The agent Breadboard selects for a session. Browsers never choose an agent.
 *
 * Authenticated sessions on every surface use the one canonical assistant. The
 * per-surface `breadboard-garden` / `breadboard-quartz` manifests pinned
 * `"*": false` plus blanket `permission: deny`, which made the manifest a hard
 * ceiling: the server could not activate a tool the task plan justified, no
 * matter what the user had authorized. Capability is decided by the server's
 * capability broker, so the agent must be *able* to hold those tools and start
 * with them switched off — which is exactly what `breadboard-assistant` does.
 *
 * Anonymous/public sessions keep the restricted Quartz manifest, so isolation
 * is enforced by the agent definition as well as by the broker.
 */
export function agentForSurface(
  config: HermesConfig,
  surface: HermesSurface,
  options: { authenticated?: boolean } = {},
): string {
  const authenticated = options.authenticated !== false;
  if (!authenticated) {
    // Public Quartz and any other unauthenticated session.
    return surface === "quartz_ai" ? config.agents.quartz : config.agents.garden;
  }
  return config.agents.terminal;
}

export function isHermesEnabled(): boolean {
  return modeFromEnvironment() !== "legacy";
}

export function readHermesMode(): HermesMode {
  return modeFromEnvironment();
}
