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
import { readOpenHarnessConfig, type OpenHarnessSurface } from "./config.ts";
import { issueCapabilityToken } from "./capability-token.ts";
import { allowedToolsForSurface } from "./tool-scopes.ts";
import { writeWorkspaceCapability } from "./workspace.ts";
import {
  createRuntimeSession,
  getRuntimeSessionById,
  setOpenHarnessSessionId,
  setRuntimeStatus,
  type RuntimeSessionRow,
} from "./runtime-store.ts";
import { ApiError } from "./route-helpers.ts";

export interface AuthorizedRuntimeSession {
  row: RuntimeSessionRow;
  openHarnessSessionId: string;
  workspaceKey: string;
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
  // sessionKey is a fresh random id so workspaces never collide across sessions.
  const sessionKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await gateway.createSession({
    surface: options.surface,
    sessionKey,
    gardenKey: gardenId ?? undefined,
    pageKey: options.pageSlug ?? undefined,
    title: options.title,
    metadata: { userId: options.userId, gardenId, pageSlug: options.pageSlug },
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
    openHarnessSessionId: created.openHarnessSessionId,
    runtimeMetadata: {
      title: options.title,
      ...(options.clientToken ? { clientToken: options.clientToken } : {}),
    },
  });

  const authorized: AuthorizedRuntimeSession = {
    row,
    openHarnessSessionId: created.openHarnessSessionId,
    workspaceKey: created.workspaceKey,
    agentName: created.agentName,
  };

  // Garden/Quartz agents call back into Breadboard for real content via a
  // capability-scoped tool. Drop the short-lived token into the session's
  // isolated workspace (never into the model prompt) so the tool adapter can
  // read it. The terminal has no such callback.
  if (options.surface === "garden_chat" || options.surface === "quartz_ai") {
    const config = readOpenHarnessConfig();
    writeWorkspaceCapability(created.directory, {
      token: mintCapabilityToken(authorized, options.userId ?? 0),
      dashboardUrl: config.dashboardInternalUrl,
      surface: options.surface,
      gardenId: gardenId ?? undefined,
      pageSlug: options.pageSlug ?? undefined,
    });
  }

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
  const row = getRuntimeSessionById(runtimeSessionId);
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
  return {
    row,
    openHarnessSessionId: row.openharness_session_id,
    workspaceKey: row.workspace_key,
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
  const row = getRuntimeSessionById(runtimeSessionId);
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
  return {
    row,
    openHarnessSessionId: row.openharness_session_id,
    workspaceKey: row.workspace_key,
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
