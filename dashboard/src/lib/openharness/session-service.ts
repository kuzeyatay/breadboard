// Server-side orchestration for OpenHarness-backed runtime sessions.
//
// This sits between the route handlers and the gateway. It owns:
//   - authorization (session ownership, garden/page access)
//   - Breadboard-side persistence of the runtime session record
//   - deriving the OpenHarness session id server-side from a Breadboard id the
//     browser is allowed to reference
//   - capability-token minting for garden/quartz tool calls
//
// Browsers reference only Breadboard runtime-session ids (numeric). The
// OpenHarness session id, workspace directory, and agent are never accepted from
// the client — they are derived here from the authorized DB record.

import db from "@/lib/db";
import { getOpenHarnessGateway } from "./gateway.ts";
import {
  agentForSurface,
  readOpenHarnessConfig,
  type OpenHarnessSurface,
} from "./config.ts";
import { issueCapabilityToken } from "./capability-token.ts";
import { allowedToolsForSurface } from "./tool-scopes.ts";
import { directoryForWorkspaceKey, writeWorkspaceCapability } from "./workspace.ts";
import {
  createRuntimeSession,
  getRuntimeSessionById,
  getOpenHarnessUserSettings,
  setOpenHarnessUserSettings,
  setOpenHarnessSessionId,
  setRuntimeStatus,
  recordAuditEvent,
  migrateRuntimeSessionPolicy,
  type RuntimeSessionRow,
  type FilesystemAccessMode,
} from "./runtime-store.ts";
import { ApiError } from "./route-helpers.ts";
import { listMcpConnections, runtimeMcpConfig } from "./mcp-connections.ts";

export interface AuthorizedRuntimeSession {
  row: RuntimeSessionRow;
  openHarnessSessionId: string;
  workspaceKey: string;
  activeDirectory: string;
  filesystemMode: FilesystemAccessMode;
  agentName: string;
}

interface ClusterRow {
  id: number;
  slug: string;
  user_id: number;
  visibility: "private" | "public";
  chat_accessible: number;
}

function loadClusterBySlug(slug: string): ClusterRow | null {
  const row = db
    .prepare("SELECT id, slug, user_id, visibility, chat_accessible FROM clusters WHERE slug = ?")
    .get(slug) as ClusterRow | undefined;
  return row ?? null;
}

function canonicalizeRuntimePolicy(row: RuntimeSessionRow): RuntimeSessionRow {
  const config = readOpenHarnessConfig();
  // Authenticated sessions on every surface converge on the canonical
  // assistant; only anonymous sessions keep a restricted per-surface manifest.
  const expectedAgent = agentForSurface(config, row.surface, {
    authenticated: row.user_id !== null,
  });
  if (
    row.agent_name === expectedAgent &&
    (row.capability_mode === "knowledge" || Boolean(row.capability_decision_id))
  ) {
    return row;
  }
  const previousAgent = row.agent_name;
  migrateRuntimeSessionPolicy(row.id, expectedAgent);
  recordAuditEvent({
    eventType: "session.capability_policy_migrated",
    runtimeSessionId: row.id,
    userId: row.user_id,
    gardenId: row.garden_id,
    payload: {
      previousAgent,
      agent: expectedAgent,
      mode: "knowledge",
      broadPermissionsRestored: false,
    },
  });
  return getRuntimeSessionById(row.id)!;
}

/**
 * Verify a user may open an interactive session against a garden. Owners always
 * may; non-owners may only when the garden is public AND chat-accessible.
 */
export function authorizeGardenAccess(
  userId: number | null,
  gardenSlug: string,
): { clusterId: number; slug: string; isOwner: boolean } {
  const cluster = loadClusterBySlug(gardenSlug);
  if (!cluster) throw new ApiError(404, "garden_not_found", "Garden not found.");
  const isOwner = userId !== null && cluster.user_id === userId;
  if (!isOwner && !(cluster.visibility === "public" && cluster.chat_accessible === 1)) {
    // Do not disclose existence of private gardens to unauthorized users.
    throw new ApiError(404, "garden_not_found", "Garden not found.");
  }
  return { clusterId: cluster.id, slug: cluster.slug, isOwner };
}

export interface CreateSessionOptions {
  userId: number | null;
  surface: OpenHarnessSurface;
  title?: string;
  gardenSlug?: string;
  pageSlug?: string;
  /** Existing Breadboard chat_sessions id, for garden chat continuity. */
  chatSessionId?: number | null;
  /**
   * Opaque token that binds an anonymous (public Quartz) session to the browser
   * that created it, so a guessed numeric session id cannot hijack it.
   */
  clientToken?: string | null;
}

/**
 * Create a runtime session for a surface: authorize, create the OpenHarness
 * session in an isolated workspace, and persist the Breadboard record.
 */
export async function createSessionForSurface(
  options: CreateSessionOptions,
): Promise<AuthorizedRuntimeSession> {
  let clusterId: number | null = null;
  let gardenId: string | null = null;
  if (options.surface === "garden_chat" || options.surface === "quartz_ai") {
    if (!options.gardenSlug) {
      throw new ApiError(400, "garden_required", "A garden is required for this surface.");
    }
    // Garden chat requires the standard owner/public-chat access. Quartz access
    // (which permits anonymous readers on chat-enabled public gardens) is
    // enforced by the caller before this point via authorizeQuartzAccess.
    if (options.surface === "garden_chat") {
      const access = authorizeGardenAccess(options.userId, options.gardenSlug);
      clusterId = access.clusterId;
      gardenId = access.slug;
    } else {
      const cluster = db
        .prepare("SELECT id, slug FROM clusters WHERE slug = ?")
        .get(options.gardenSlug) as { id: number; slug: string } | undefined;
      if (!cluster) throw new ApiError(404, "garden_not_found", "Garden not found.");
      clusterId = cluster.id;
      gardenId = cluster.slug;
    }
  }

  const gateway = getOpenHarnessGateway();
  const settings = options.userId === null
    ? { filesystemMode: "restricted" as const, lastActiveDirectory: null }
    : getOpenHarnessUserSettings(options.userId);
  const migratedBroadSetting =
    options.userId !== null && settings.filesystemMode === "full";
  if (migratedBroadSetting) {
    setOpenHarnessUserSettings(options.userId!, { filesystemMode: "restricted" });
  }
  // sessionKey is a fresh random id so workspaces never collide across sessions.
  const sessionKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  // The terminal starts in the server-selected authorized workspace so a
  // later task-scoped decision does not need to move an OpenHarness session
  // between instances. Runtime permissions still begin at knowledge/default
  // deny; a historical "full" setting is retained only as inactive metadata.
  const directorySelectionMode =
    options.surface === "dashboard_terminal" ? "full" : "restricted";
  const created = await gateway.createSession({
    surface: options.surface,
    sessionKey,
    gardenKey: gardenId ?? undefined,
    pageKey: options.pageSlug ?? undefined,
    title: options.title,
    metadata: { userId: options.userId, gardenId, pageSlug: options.pageSlug },
    filesystemMode: directorySelectionMode,
    authenticated: options.userId !== null,
    // Historical user-selected directories are retained only as inactive
    // metadata. New Assistant sessions always start at Breadboard's
    // server-selected root; a persisted path is never restored as authority.
    previousDirectory: null,
  });

  const row = createRuntimeSession({
    surface: options.surface,
    userId: options.userId,
    chatSessionId: options.chatSessionId ?? null,
    agentName: created.agentName,
    clusterId,
    gardenId,
    pageSlug: options.pageSlug ?? null,
    workspaceKey: created.workspaceKey,
    activeDirectory: created.directory,
    filesystemMode: "restricted",
    openHarnessSessionId: created.openHarnessSessionId,
    runtimeMetadata: {
      title: options.title,
      inactiveLegacyFilesystemMode: settings.filesystemMode,
      inactiveLegacyDirectory: settings.lastActiveDirectory,
      ...(options.clientToken ? { clientToken: options.clientToken } : {}),
    },
  });

  const authorized: AuthorizedRuntimeSession = {
    row,
    openHarnessSessionId: created.openHarnessSessionId,
    workspaceKey: created.workspaceKey,
    activeDirectory: created.directory,
    filesystemMode: "restricted",
    agentName: created.agentName,
  };
  recordAuditEvent({
    eventType: "session.created",
    runtimeSessionId: row.id,
    userId: options.userId,
    gardenId,
    payload: { surface: options.surface, agent: created.agentName, pageSlug: options.pageSlug ?? null },
  });
  if (migratedBroadSetting) {
    recordAuditEvent({
      eventType: "settings.broad_filesystem_deactivated",
      runtimeSessionId: row.id,
      userId: options.userId,
      gardenId,
      payload: {
        previousMode: "full",
        mode: "restricted",
        previousDirectoryRetainedAsInactiveHistory: Boolean(
          settings.lastActiveDirectory,
        ),
      },
    });
  }
  recordAuditEvent({
    eventType: "agent.selected",
    runtimeSessionId: row.id,
    userId: options.userId,
    gardenId,
    payload: { agent: created.agentName, allowedTools: allowedToolsForSurface(options.surface) },
  });

  // Dynamic OpenHarness MCP additions are instance-scoped, so replay the
  // user's persisted, approved connections into each new workspace instance.
  if (options.userId !== null) {
    for (const connection of listMcpConnections(options.userId, true)) {
      try {
        const status = await gateway.addMcpConnection(
          created.directory,
          connection.slug,
          runtimeMcpConfig(connection),
        );
        recordAuditEvent({
          eventType: "mcp.loaded",
          runtimeSessionId: row.id,
          userId: options.userId,
          gardenId,
          payload: { slug: connection.slug, status: status[connection.slug]?.status ?? "unknown" },
        });
      } catch {
        recordAuditEvent({
          eventType: "mcp.load_failed",
          runtimeSessionId: row.id,
          userId: options.userId,
          gardenId,
          payload: { slug: connection.slug, reason: "MCP connection failed to load; details were not persisted to avoid credential leakage." },
        });
      }
    }
  }

  // Custom tools call back through narrowly scoped Breadboard capabilities.
  // Garden/Quartz receive content tools; terminal/scout receive only structured
  // capability-gap and official skill-search callbacks.
  const config = readOpenHarnessConfig();
  writeWorkspaceCapability(created.runtimeDirectory, {
    token: mintCapabilityToken(authorized, options.userId ?? 0),
    dashboardUrl: config.dashboardInternalUrl,
    surface: options.surface,
    gardenId: gardenId ?? undefined,
    pageSlug: options.pageSlug ?? undefined,
  });

  return authorized;
}

/**
 * Authorize and load an existing runtime session for a user by its Breadboard
 * id. Enforces ownership and (for garden/quartz) garden access on every call.
 */
export function authorizeRuntimeSession(
  userId: number | null,
  runtimeSessionId: number,
): AuthorizedRuntimeSession {
  let row = getRuntimeSessionById(runtimeSessionId);
  if (!row) throw new ApiError(404, "session_not_found", "Session not found.");

  // Ownership: the session's user must match. Anonymous (public Quartz) sessions
  // have a null user_id and are only reachable through the Quartz path, which
  // re-verifies garden visibility per request.
  if (row.user_id !== null && row.user_id !== userId) {
    throw new ApiError(404, "session_not_found", "Session not found.");
  }
  if (row.garden_id) {
    // Re-verify garden access on every request (visibility can change).
    authorizeGardenAccess(userId, row.garden_id);
  }
  if (!row.openharness_session_id) {
    throw new ApiError(409, "session_not_ready", "Runtime session is not initialized.");
  }
  row = canonicalizeRuntimePolicy(row);
  const config = readOpenHarnessConfig();
  return {
    row,
    openHarnessSessionId: row.openharness_session_id!,
    workspaceKey: row.workspace_key,
    activeDirectory:
      row.active_directory ?? directoryForWorkspaceKey(config, row.workspace_key),
    filesystemMode: "restricted",
    agentName: row.agent_name,
  };
}

/**
 * Authorize a Quartz runtime session. Authenticated owners are matched by user
 * id; anonymous public sessions are matched by the opaque client token issued at
 * creation (stored in runtime_metadata), so a guessed numeric session id cannot
 * hijack another reader's session. Garden visibility is re-checked every call.
 */
export function authorizeQuartzRuntimeSession(
  runtimeSessionId: number,
  auth: { userId: number | null; clientToken: string | null },
): AuthorizedRuntimeSession {
  let row = getRuntimeSessionById(runtimeSessionId);
  if (!row || row.surface !== "quartz_ai") {
    throw new ApiError(404, "session_not_found", "Session not found.");
  }
  if (row.user_id !== null) {
    if (row.user_id !== auth.userId) throw new ApiError(404, "session_not_found", "Session not found.");
  } else {
    let stored: string | undefined;
    try {
      stored = row.runtime_metadata ? JSON.parse(row.runtime_metadata).clientToken : undefined;
    } catch {
      stored = undefined;
    }
    if (!stored || !auth.clientToken || stored !== auth.clientToken) {
      throw new ApiError(404, "session_not_found", "Session not found.");
    }
  }
  if (!row.openharness_session_id) {
    throw new ApiError(409, "session_not_ready", "Runtime session is not initialized.");
  }
  row = canonicalizeRuntimePolicy(row);
  return {
    row,
    openHarnessSessionId: row.openharness_session_id!,
    workspaceKey: row.workspace_key,
    activeDirectory:
      row.active_directory ?? directoryForWorkspaceKey(readOpenHarnessConfig(), row.workspace_key),
    filesystemMode: "restricted",
    agentName: row.agent_name,
  };
}

/** Mint a capability token scoped to this session's surface + garden. */
export function mintCapabilityToken(session: AuthorizedRuntimeSession, userId: number): string {
  return issueCapabilityToken({
    userId,
    surface: session.row.surface,
    breadboardSessionId: String(session.row.id),
    openHarnessSessionId: session.openHarnessSessionId,
    gardenId: session.row.garden_id ?? undefined,
    pageSlug: session.row.page_slug ?? undefined,
    allowedTools: allowedToolsForSurface(session.row.surface),
  });
}

export function markStatus(session: AuthorizedRuntimeSession, status: string): void {
  setRuntimeStatus(session.row.id, status);
}

export { setOpenHarnessSessionId };
