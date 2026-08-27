// Server-side orchestration for Hermes-backed runtime sessions.
//
// This sits between the route handlers and the gateway. It owns:
//   - authorization (session ownership, garden/page access)
//   - Breadboard-side persistence of the runtime session record
//   - deriving the Hermes session id server-side from a Breadboard id the
//     browser is allowed to reference
//   - capability-token minting for garden/quartz tool calls
//
// Authenticated browsers reference opaque Breadboard conversation ids. Numeric
// runtime ids remain only on the isolated anonymous/legacy compatibility path.
// The Hermes session id, workspace directory, and agent are never accepted from
// the client — they are derived here from the authorized DB record.

import db from "@/lib/db";
import {
  organizationClusterClause,
  organizationIdsForUser,
} from "@/lib/organizations/store";
import {
  getAgentRuntime,
  getAgentRuntimeByKind,
  getFallbackAgentRuntime,
} from "../agent-runtime/runtime.ts";
import type {
  AgentRuntime,
  RuntimeKind,
  RuntimeSession,
} from "../agent-runtime/contracts.ts";
import {
  runtimeStartupResourceFailure,
  safeRuntimeStartupDiagnostic,
  type RuntimeStartupStage,
} from "../agent-runtime/startup-error.ts";
import {
  agentForSurface,
  readHermesConfig,
  type HermesSurface,
} from "./config.ts";
import { issueCapabilityToken } from "./capability-token.ts";
import { allowedToolsForSurface } from "./tool-scopes.ts";
import { directoryForWorkspaceKey } from "./workspace.ts";
import {
  createRuntimeSession,
  getRuntimeSessionByConversation,
  getRuntimeSessionById,
  getHermesUserSettings,
  setHermesUserSettings,
  setHermesSessionId,
  setRuntimeStatus,
  updateRuntimeActiveContext,
  replaceAgentRuntimeIdentity,
  runtimeExternalSessionId,
  recordAuditEvent,
  migrateRuntimeSessionPolicy,
  type RuntimeSessionRow,
  type FilesystemAccessMode,
} from "./runtime-store.ts";
import { ApiError } from "./route-core.ts";
import { listMcpConnections, runtimeMcpConfig } from "./mcp-connections.ts";
import { composioConnectedIntegrationSlugs } from "../composio/service.ts";
import {
  getConversationForUser,
  listConversationMessages,
  type ConversationRow,
} from "../conversations/store.ts";

export interface AuthorizedRuntimeSession {
  row: RuntimeSessionRow;
  runtimeKind: RuntimeKind;
  externalSessionId: string;
  liveSessionId?: string;
  /** @deprecated Compatibility alias for existing API payloads and tokens. */
  hermesSessionId: string;
  workspaceKey: string;
  activeDirectory: string;
  filesystemMode: FilesystemAccessMode;
  agentName: string;
}

interface ClusterRow {
  id: number;
  slug: string;
  user_id: number;
  visibility: "private" | "organization" | "public";
  organization_id: number | null;
  chat_accessible: number;
}

function reportRuntimeStartupFailure(
  runtimeKind: RuntimeKind,
  stage: RuntimeStartupStage,
  error: unknown,
): void {
  console.error(
    "[agent-runtime] session creation failed",
    safeRuntimeStartupDiagnostic({ runtimeKind, stage, error }),
  );
}

function runtimeUnavailableError(error: unknown): ApiError {
  const resourceFailure = runtimeStartupResourceFailure(error);
  return resourceFailure
    ? new ApiError(503, resourceFailure.code, resourceFailure.message)
    : new ApiError(
        503,
        "runtime_unavailable",
        "The agent runtime is unavailable. Try again shortly.",
      );
}

async function createWithConfiguredRuntimeFallback(
  input: Parameters<AgentRuntime["createSession"]>[0],
): Promise<{
  runtime: AgentRuntime;
  created: RuntimeSession;
  fallbackFrom: RuntimeKind | null;
}> {
  const primary = getAgentRuntime();
  try {
    return {
      runtime: primary,
      created: await primary.createSession(input),
      fallbackFrom: null,
    };
  } catch (primaryError) {
    reportRuntimeStartupFailure(primary.kind, "primary_create", primaryError);
    const fallback = getFallbackAgentRuntime();
    if (!fallback || fallback.kind === primary.kind) {
      throw runtimeUnavailableError(primaryError);
    }
    try {
      return {
        runtime: fallback,
        created: await fallback.createSession(input),
        fallbackFrom: primary.kind,
      };
    } catch (fallbackError) {
      reportRuntimeStartupFailure(fallback.kind, "fallback_create", fallbackError);
      throw runtimeUnavailableError(fallbackError);
    }
  }
}

function loadClusterBySlug(slug: string): ClusterRow | null {
  const row = db
    .prepare(
      "SELECT id, slug, user_id, visibility, organization_id, chat_accessible FROM clusters WHERE slug = ?",
    )
    .get(slug) as ClusterRow | undefined;
  return row ?? null;
}

/**
 * Gardens a non-owner may chat in: public ones, and ones shared with an
 * organization they belong to. Both still require chat to be switched on.
 */
function chatOpenToUser(cluster: ClusterRow, userId: number | null): boolean {
  if (cluster.chat_accessible !== 1) return false;
  if (cluster.visibility === "public") return true;
  if (cluster.visibility !== "organization" || userId === null) return false;
  return (
    typeof cluster.organization_id === "number" &&
    organizationIdsForUser(userId).includes(cluster.organization_id)
  );
}

function canonicalizeRuntimePolicy(row: RuntimeSessionRow): RuntimeSessionRow {
  const config = readHermesConfig();
  // Authenticated sessions on every surface converge on the canonical
  // assistant; only anonymous sessions keep a restricted per-surface manifest.
  const expectedAgent =
    row.runtime_kind === "hermes"
      ? "breadboard"
      : agentForSurface(config, row.surface, {
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
 * may; non-owners only when the garden is chat-accessible and either public or
 * shared with an organization they are in.
 */
export function authorizeGardenAccess(
  userId: number | null,
  gardenSlug: string,
): { clusterId: number; slug: string; isOwner: boolean } {
  const cluster = loadClusterBySlug(gardenSlug);
  if (!cluster) throw new ApiError(404, "garden_not_found", "Garden not found.");
  const isOwner = userId !== null && cluster.user_id === userId;
  if (!isOwner && !chatOpenToUser(cluster, userId)) {
    // Do not disclose existence of private gardens to unauthorized users.
    throw new ApiError(404, "garden_not_found", "Garden not found.");
  }
  return { clusterId: cluster.id, slug: cluster.slug, isOwner };
}

export interface CreateSessionOptions {
  userId: number | null;
  surface: HermesSurface;
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
 * Create a runtime session for a surface: authorize, create the Hermes
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

  const settings = options.userId === null
    ? { filesystemMode: "restricted" as const, lastActiveDirectory: null }
    : getHermesUserSettings(options.userId);
  const migratedBroadSetting =
    options.userId !== null && settings.filesystemMode === "full";
  if (migratedBroadSetting) {
    setHermesUserSettings(options.userId!, { filesystemMode: "restricted" });
  }
  // sessionKey is a fresh random id so workspaces never collide across sessions.
  const sessionKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  // The terminal starts in the server-selected authorized workspace so a
  // later task-scoped decision does not need to move an Hermes session
  // between instances. Runtime permissions still begin at knowledge/default
  // deny; a historical "full" setting is retained only as inactive metadata.
  const directorySelectionMode =
    options.surface === "dashboard_terminal" ? "full" : "restricted";
  const selected = await createWithConfiguredRuntimeFallback({
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
  const { runtime, created } = selected;

  const row = createRuntimeSession({
    surface: options.surface,
    userId: options.userId,
    chatSessionId: options.chatSessionId ?? null,
    agentName: created.agentName,
    clusterId,
    gardenId,
    pageSlug: options.pageSlug ?? null,
    allowedGardenIds: clusterId === null ? [] : [clusterId],
    workspaceKey: created.workspaceKey,
    activeDirectory: created.directory,
    filesystemMode: "restricted" as const,
    hermesSessionId:
      runtime.kind === "hermes" ? created.externalSessionId : null,
    runtimeKind: runtime.kind,
    externalSessionId: created.externalSessionId,
    liveSessionId: created.liveSessionId,
    runtimeMetadata: {
      title: options.title,
      inactiveLegacyFilesystemMode: settings.filesystemMode,
      inactiveLegacyDirectory: settings.lastActiveDirectory,
      ...(options.clientToken ? { clientToken: options.clientToken } : {}),
    },
  });

  const authorized: AuthorizedRuntimeSession = {
    row,
    runtimeKind: runtime.kind,
    externalSessionId: created.externalSessionId,
    liveSessionId: created.liveSessionId,
    hermesSessionId: created.externalSessionId,
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
    payload: {
      surface: options.surface,
      agent: created.agentName,
      pageSlug: options.pageSlug ?? null,
      fallbackFrom: selected.fallbackFrom,
    },
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

  await loadUnifiedToolRegistryForRuntime(row, created.directory, runtime);

  // Custom tools authenticate the runtime process and Breadboard mints their
  // narrow capability from this server-owned session row on every request.
  // No capability secret is written into the model-writable workspace.

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
  if (!runtimeExternalSessionId(row)) {
    throw new ApiError(409, "session_not_ready", "Runtime session is not initialized.");
  }
  row = canonicalizeRuntimePolicy(row);
  const config = readHermesConfig();
  return {
    row,
    ...runtimeReference(row, config),
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
  if (!runtimeExternalSessionId(row)) {
    throw new ApiError(409, "session_not_ready", "Runtime session is not initialized.");
  }
  row = canonicalizeRuntimePolicy(row);
  return {
    row,
    ...runtimeReference(row, readHermesConfig()),
  };
}

/** Mint a capability token scoped to this session's surface + garden. */
export function mintCapabilityToken(session: AuthorizedRuntimeSession, userId: number): string {
  const allowedGardenIds = parseAllowedGardenIds(session.row.allowed_garden_ids);
  return issueCapabilityToken({
    userId,
    conversationId: session.row.conversation_id ?? undefined,
    surface: session.row.surface,
    breadboardSessionId: String(session.row.id),
    hermesSessionId: session.hermesSessionId,
    gardenId: session.row.garden_id ?? undefined,
    allowedGardenIds,
    activeGardenId: session.row.cluster_id ?? undefined,
    pageSlug: session.row.page_slug ?? undefined,
    allowedTools: allowedToolsForSurface(session.row.surface),
  });
}

export interface AuthorizedGardenSummary {
  id: number;
  slug: string;
  name: string;
  isOwner: boolean;
}

/** Server-derived workspace authorization; no client list participates. */
export function listAuthorizedGardens(userId: number): AuthorizedGardenSummary[] {
  const rows = db.prepare(`
    SELECT id, slug, name, CASE WHEN user_id = ? THEN 1 ELSE 0 END AS is_owner
    FROM clusters c
    WHERE c.user_id = ?
       OR (c.chat_accessible = 1
           AND (c.visibility = 'public' OR ${organizationClusterClause(userId, "c")}))
    ORDER BY is_owner DESC, lower(name), id
  `).all(userId, userId) as Array<{
    id: number;
    slug: string;
    name: string;
    is_owner: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    isOwner: row.is_owner === 1,
  }));
}

/**
 * Resolve the one runtime owned by an authenticated conversation and replace
 * its temporary surface/garden/page context for this turn.
 */
export async function resolveConversationRuntime(input: {
  conversation: ConversationRow;
  surface: HermesSurface;
  activeGardenSlug?: string | null;
  activePageSlug?: string | null;
  forceRecreate?: boolean;
  historyOverride?: Array<{ role: "user" | "assistant"; content: string }>;
  branchContextId?: string;
}): Promise<AuthorizedRuntimeSession> {
  if (input.surface !== input.conversation.surface) {
    throw new ApiError(
      403,
      "surface_scope_mismatch",
      "This conversation is bound to a different assistant surface.",
    );
  }
  const gardens = normalizedAuthorizedGardens(input.conversation.user_id);
  let active: { clusterId: number; slug: string } | null = null;
  if (input.activeGardenSlug) {
    const access = authorizeGardenAccess(input.conversation.user_id, input.activeGardenSlug);
    if (!gardens.some((garden) => garden.id === access.clusterId)) {
      throw new ApiError(404, "garden_not_found", "Garden not found.");
    }
    active = { clusterId: access.clusterId, slug: access.slug };
  }
  if (input.activePageSlug && !active) {
    throw new ApiError(400, "garden_required", "An active page requires an active garden.");
  }

  let row = getRuntimeSessionByConversation(input.conversation.id);
  if (row && row.user_id !== input.conversation.user_id) {
    throw new ApiError(404, "session_not_found", "Session not found.");
  }
  if (!row) {
    row = await createConversationRuntime(input.conversation, input.surface, active, input.activePageSlug ?? null, gardens);
  } else {
    row = updateRuntimeActiveContext({
      runtimeSessionId: row.id,
      surface: input.conversation.surface,
      clusterId: active?.clusterId ?? null,
      gardenId: active?.slug ?? null,
      pageSlug: input.activePageSlug ?? null,
      allowedGardenIds: gardens.map((garden) => garden.id),
    });
    if (input.forceRecreate || !runtimeExternalSessionId(row)) {
      row = await recreateConversationRuntime(
        row,
        input.conversation,
        input.surface,
        input.historyOverride,
        input.branchContextId,
      );
    }
  }
  if (!runtimeExternalSessionId(row)) {
    throw new ApiError(409, "session_not_ready", "Runtime session is not initialized.");
  }
  row = canonicalizeRuntimePolicy(row);
  const authorized = authorizedRuntime(row);
  return authorized;
}

/**
 * Re-read the durable runtime identity for a session row.
 *
 * `recreateConversationRuntime` replaces `external_session_id`/`live_session_id`
 * in place when a turn is re-dispatched onto a fresh runtime session, so any
 * long-lived consumer that captured those ids earlier is holding a reference to
 * a session that will never speak again. SQLite is the only channel that
 * carries the replacement across Next.js module contexts.
 */
export function currentRuntimeIdentity(
  runtimeSessionId: number,
): AuthorizedRuntimeSession | null {
  const row = getRuntimeSessionById(runtimeSessionId);
  if (!row || !runtimeExternalSessionId(row)) return null;
  return authorizedRuntime(row);
}

export function authorizeConversationRuntime(
  conversation: ConversationRow,
): AuthorizedRuntimeSession {
  let row = getRuntimeSessionByConversation(conversation.id);
  if (
    !row ||
    row.user_id !== conversation.user_id ||
    !runtimeExternalSessionId(row)
  ) {
    throw new ApiError(404, "session_not_found", "Session not found.");
  }
  if (row.garden_id) authorizeGardenAccess(conversation.user_id, row.garden_id);
  row = canonicalizeRuntimePolicy(row);
  return authorizedRuntime(row);
}

/** Compatibility resolver while non-chat controls move from numeric runtimes. */
export function authorizeRuntimeReference(
  userId: number,
  reference: unknown,
): AuthorizedRuntimeSession {
  if (typeof reference === "string" && reference.startsWith("conv_")) {
    return authorizeConversationRuntime(getConversationForUser(reference, userId));
  }
  const numeric = typeof reference === "number" ? reference : Number(reference);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new ApiError(400, "invalid_session_id", "A valid conversation id is required.");
  }
  return authorizeRuntimeSession(userId, numeric);
}

async function createConversationRuntime(
  conversation: ConversationRow,
  surface: HermesSurface,
  active: { clusterId: number; slug: string } | null,
  pageSlug: string | null,
  gardens: AuthorizedGardenSummary[],
): Promise<RuntimeSessionRow> {
  const settings = getHermesUserSettings(conversation.user_id);
  const selected = await createWithConfiguredRuntimeFallback({
    surface,
    sessionKey: conversation.public_id,
    conversationKey: conversation.public_id,
    title: conversation.title,
    metadata: { conversationPublicId: conversation.public_id },
    filesystemMode: "restricted",
    authenticated: true,
    model: settings.defaultModel,
    reasoningEffort: settings.reasoningEffort,
  });
  const { runtime, created } = selected;
  const row = createRuntimeSession({
    conversationId: conversation.id,
    surface,
    userId: conversation.user_id,
    chatSessionId: conversation.legacy_chat_session_id,
    agentName: created.agentName,
    clusterId: active?.clusterId ?? null,
    gardenId: active?.slug ?? null,
    pageSlug,
    allowedGardenIds: gardens.map((garden) => garden.id),
    workspaceKey: created.workspaceKey,
    activeDirectory: created.directory,
    filesystemMode: "restricted",
    hermesSessionId:
      runtime.kind === "hermes" ? created.externalSessionId : null,
    runtimeKind: runtime.kind,
    externalSessionId: created.externalSessionId,
    liveSessionId: created.liveSessionId,
    runtimeMetadata: { title: conversation.title, conversationPublicId: conversation.public_id },
  });
  await loadUnifiedToolRegistryForRuntime(row, created.directory, runtime);
  recordAuditEvent({
    eventType: "conversation.runtime_created",
    runtimeSessionId: row.id,
    userId: conversation.user_id,
    gardenId: active?.slug ?? null,
    payload: {
      conversationPublicId: conversation.public_id,
      allowedGardenCount: gardens.length,
      fallbackFrom: selected.fallbackFrom,
    },
  });
  return row;
}

async function recreateConversationRuntime(
  row: RuntimeSessionRow,
  conversation: ConversationRow,
  surface: HermesSurface,
  historyOverride?: Array<{ role: "user" | "assistant"; content: string }>,
  branchContextId?: string,
): Promise<RuntimeSessionRow> {
  const runtime = getAgentRuntimeByKind(row.runtime_kind);
  const settings = getHermesUserSettings(conversation.user_id);
  const previousExternalSessionId = runtimeExternalSessionId(row);
  const restoreInput = {
    surface,
    sessionKey: `${conversation.public_id}-${Date.now().toString(36)}`,
    conversationKey: conversation.public_id,
    title: conversation.title,
    metadata: {
      conversationPublicId: conversation.public_id,
      rehydrated: true,
      ...(branchContextId ? { branchContextId } : {}),
    },
    filesystemMode: "restricted" as const,
    authenticated: true,
    externalSessionId: previousExternalSessionId ?? "",
    messages: historyOverride ?? canonicalRuntimeMessages(conversation.id),
    model: settings.defaultModel,
    reasoningEffort: settings.reasoningEffort,
  };
  const created =
    runtime.kind === "hermes"
      ? await runtime.restoreSession(restoreInput)
      : await runtime.createSession(restoreInput);
  const replaced = replaceAgentRuntimeIdentity({
    runtimeSessionId: row.id,
    runtimeKind: runtime.kind,
    externalSessionId: created.externalSessionId,
    liveSessionId: created.liveSessionId,
    workspaceKey: created.workspaceKey,
    activeDirectory: created.directory,
    agentName: created.agentName,
    runtimeMetadata: {
      title: conversation.title,
      conversationPublicId: conversation.public_id,
      rehydrated: true,
      ...(branchContextId ? { branchContextId } : {}),
    },
  });
  await loadUnifiedToolRegistryForRuntime(replaced, created.directory, runtime);
  recordAuditEvent({
    eventType: "conversation.runtime_recreated",
    runtimeSessionId: row.id,
    userId: conversation.user_id,
    gardenId: row.garden_id,
    payload: {
      conversationPublicId: conversation.public_id,
      branchContextId: branchContextId ?? null,
      restoredMessageCount:
        historyOverride?.length ?? canonicalRuntimeMessages(conversation.id).length,
    },
  });
  return replaced;
}

async function loadUnifiedToolRegistryForRuntime(
  row: RuntimeSessionRow,
  directory: string,
  runtime: AgentRuntime,
): Promise<void> {
  if (row.user_id === null) return;
  let installedMcpCount = 0;
  let composioConnectionCount = 0;

  // Local terminal, filesystem, and browser tools are registered by the
  // runtime when createSession/restoreSession returns. Instance-scoped MCP
  // sources are then added here, producing the one registry exposed to the LLM.
  for (const connection of listMcpConnections(row.user_id, true).filter(
    (candidate) => candidate.slug !== "spotify",
  )) {
    try {
      const status = await runtime.addMcpConnection(
        directory,
        connection.slug,
        runtimeMcpConfig(connection),
        row.user_id,
      );
      installedMcpCount += 1;
      recordAuditEvent({
        eventType: "mcp.loaded",
        runtimeSessionId: row.id,
        userId: row.user_id,
        gardenId: row.garden_id,
        payload: {
          slug: connection.slug,
          status:
            typeof status === "object" &&
            status !== null &&
            connection.slug in status
              ? (
                  status as Record<string, { status?: string }>
                )[connection.slug]?.status ?? "unknown"
              : "unknown",
        },
      });
    } catch {
      recordAuditEvent({
        eventType: "mcp.load_failed",
        runtimeSessionId: row.id,
        userId: row.user_id,
        gardenId: row.garden_id,
        payload: { slug: connection.slug, reason: "MCP connection failed to load." },
      });
    }
  }

  try {
    composioConnectionCount = (
      await composioConnectedIntegrationSlugs(row.user_id, false)
    ).length;
  } catch {
    // Local connected-app metadata is diagnostic here; per-turn policy remains the
    // authoritative exposure gate.
  }

  try {
    const capabilities = await runtime.listCapabilities(directory, row.user_id);
    recordAuditEvent({
      eventType: "tool_registry.loaded",
      runtimeSessionId: row.id,
      userId: row.user_id,
      gardenId: row.garden_id,
      payload: {
        // Connected-app actions are merged per turn by
        // connectedAppRegistryForTurn; they are not runtime MCP servers.
        sources: ["local", "mcp", "connected-apps"],
        exposedToolCount: capabilities.tools.length,
        registeredMcpServerCount: Object.keys(capabilities.mcp).length,
        installedMcpCount,
        composioConnectionCount,
      },
    });
  } catch {
    // Tool discovery is diagnostic. The runtime still owns and exposes the
    // successfully registered tools even if this count cannot be collected.
  }
}

function authorizedRuntime(row: RuntimeSessionRow): AuthorizedRuntimeSession {
  return {
    row,
    ...runtimeReference(row, readHermesConfig()),
  };
}

function runtimeReference(
  row: RuntimeSessionRow,
  config: ReturnType<typeof readHermesConfig>,
): Omit<AuthorizedRuntimeSession, "row"> {
  const externalSessionId = runtimeExternalSessionId(row);
  if (!externalSessionId) {
    throw new ApiError(
      409,
      "session_not_ready",
      "Runtime session is not initialized.",
    );
  }
  return {
    runtimeKind: row.runtime_kind,
    externalSessionId,
    liveSessionId: row.live_session_id ?? undefined,
    hermesSessionId: externalSessionId,
    workspaceKey: row.workspace_key,
    activeDirectory:
      row.active_directory ??
      directoryForWorkspaceKey(config, row.workspace_key),
    filesystemMode: "restricted",
    agentName: row.agent_name,
  };
}

function canonicalRuntimeMessages(
  conversationId: number,
): Array<{ role: "user" | "assistant"; content: string }> {
  return listConversationMessages(
    conversationId,
    { limit: 500, includePending: false },
  )
    .filter(
      (
        message,
      ): message is typeof message & { role: "user" | "assistant" } =>
        message.role === "user" || message.role === "assistant",
    )
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function normalizedAuthorizedGardens(userId: number): AuthorizedGardenSummary[] {
  const rows = db.prepare(`
    SELECT id, slug, name, user_id FROM clusters c
    WHERE c.user_id = ?
       OR (c.chat_accessible = 1
           AND (c.visibility = 'public' OR ${organizationClusterClause(userId, "c")}))
    ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END, lower(name), id
  `).all(userId, userId) as Array<{ id: number; slug: string; name: string; user_id: number }>;
  return rows.map((row) => ({ ...row, isOwner: row.user_id === userId }));
}

function parseAllowedGardenIds(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is number => Number.isInteger(item) && item > 0)
      : [];
  } catch {
    return [];
  }
}

export function markStatus(session: AuthorizedRuntimeSession, status: string): void {
  setRuntimeStatus(session.row.id, status);
}

export { setHermesSessionId };
