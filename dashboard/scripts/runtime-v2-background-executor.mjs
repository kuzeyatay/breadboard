import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PROTOCOL_VERSION = 1;
const BACKGROUND_OPERATIONS = new Set([
  "skills-catalog-refresh",
  "hermes-abandoned-run-recovery",
  "scheduled-chats",
  "memory-autofetch",
  "email-poll",
  "review-scheduler",
  "caldav-sync",
  "ifixai-maintenance",
]);
const GATEWAYS = new Set(["telegram", "whatsapp"]);
const RECONCILABLE_SCHEDULES = new Set([
  "skills-catalog-refresh",
  "email-poll",
  "ifixai-maintenance",
]);
const DESIRED_STATES = new Set(["running", "stopped"]);
const RECONCILE_TRIGGERS = new Set(["startup", "explicit"]);
const MAX_DECISION_EPOCH = Number.MAX_SAFE_INTEGER;

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function validateUserScope(scope, required) {
  if (
    !hasExactKeys(scope, ["userId", "gardenId", "conversationId"]) ||
    scope.gardenId !== null ||
    scope.conversationId !== null ||
    (scope.userId !== null &&
      (!Number.isSafeInteger(scope.userId) || scope.userId < 1))
  ) {
    fail("The background worker execution scope is invalid.");
  }
  if (required && scope.userId === null) {
    fail("Explicit gateway reconciliation requires authenticated user authority.");
  }
  if (!required && scope.userId !== null) {
    fail("Scheduled background work requires internal Runtime authority.");
  }
  return scope.userId;
}

export function validateRuntimeV2BackgroundRequest(value, executionScope) {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION) {
    fail("The Runtime V2 background request has an unsupported protocol version.");
  }
  if (value.operation === "gateway-reconcile") {
    if (
      !hasExactKeys(value, [
        "protocolVersion",
        "operation",
        "gateway",
        "trigger",
        "desiredState",
        "decisionEpoch",
      ]) ||
      !GATEWAYS.has(value.gateway) ||
      !RECONCILE_TRIGGERS.has(value.trigger) ||
      !Number.isSafeInteger(value.decisionEpoch) ||
      value.decisionEpoch < 1 ||
      value.decisionEpoch > MAX_DECISION_EPOCH
    ) {
      fail("The Runtime V2 gateway reconciliation request is invalid.");
    }
    const explicit = value.trigger === "explicit";
    const userId = validateUserScope(executionScope, explicit);
    if (
      (explicit && !DESIRED_STATES.has(value.desiredState)) ||
      (!explicit && value.desiredState !== null)
    ) {
      fail("The Runtime V2 gateway reconciliation intent is invalid.");
    }
    return {
      protocolVersion: PROTOCOL_VERSION,
      operation: "gateway-reconcile",
      gateway: value.gateway,
      trigger: value.trigger,
      desiredState: value.desiredState,
      decisionEpoch: value.decisionEpoch,
      userId,
    };
  }
  if (value.operation === "schedule-reconcile") {
    if (
      !hasExactKeys(value, [
        "protocolVersion",
        "operation",
        "schedule",
        "trigger",
        "desiredState",
        "decisionEpoch",
      ]) ||
      !RECONCILABLE_SCHEDULES.has(value.schedule) ||
      !RECONCILE_TRIGGERS.has(value.trigger) ||
      !Number.isSafeInteger(value.decisionEpoch) ||
      value.decisionEpoch < 1 ||
      value.decisionEpoch > MAX_DECISION_EPOCH
    ) {
      fail("The Runtime V2 schedule reconciliation request is invalid.");
    }
    const explicit = value.trigger === "explicit";
    const userId = validateUserScope(executionScope, explicit);
    if (
      (explicit && value.schedule !== "email-poll") ||
      (explicit && !DESIRED_STATES.has(value.desiredState)) ||
      (!explicit && value.desiredState !== null)
    ) {
      fail("The Runtime V2 schedule reconciliation intent is invalid.");
    }
    return {
      protocolVersion: PROTOCOL_VERSION,
      operation: "schedule-reconcile",
      schedule: value.schedule,
      trigger: value.trigger,
      desiredState: value.desiredState,
      decisionEpoch: value.decisionEpoch,
      userId,
    };
  }
  if (
    !hasExactKeys(value, ["protocolVersion", "operation"]) ||
    !BACKGROUND_OPERATIONS.has(value.operation)
  ) {
    fail("The Runtime V2 background operation is invalid.");
  }
  validateUserScope(executionScope, false);
  return {
    protocolVersion: PROTOCOL_VERSION,
    operation: value.operation,
  };
}

function sourceUrl(sourceRoot, relativePath) {
  const candidate = path.resolve(sourceRoot, ...relativePath.split("/"));
  const relative = path.relative(sourceRoot, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(candidate)) {
    fail(`The staged background source is unavailable: ${relativePath}`);
  }
  return pathToFileURL(candidate).href;
}

async function drainDetachedPumps(sourceRoot) {
  const detachedEventPump = await import(
    sourceUrl(sourceRoot, "lib/hermes/detached-event-pump.ts")
  );
  await detachedEventPump.waitForDetachedEventPumps();
}

async function runBackgroundOperation(request, sourceRoot) {
  switch (request.operation) {
    case "skills-catalog-refresh": {
      const [{ getSkillsCatalogStore }, { synchronizeSkillsCatalog }] =
        await Promise.all([
          import(sourceUrl(sourceRoot, "lib/hermes/skills-catalog-store.ts")),
          import(sourceUrl(sourceRoot, "lib/hermes/skills-catalog-sync.ts")),
        ]);
      const store = getSkillsCatalogStore();
      if (!store.status().stale) return { operation: request.operation, changed: false };
      await synchronizeSkillsCatalog({ store });
      return { operation: request.operation, changed: true };
    }
    case "hermes-abandoned-run-recovery": {
      const { resumeAbandonedRuntimeRuns } = await import(
        sourceUrl(sourceRoot, "lib/hermes/run-recovery.ts")
      );
      const resumed = resumeAbandonedRuntimeRuns();
      await drainDetachedPumps(sourceRoot);
      return { operation: request.operation, resumed };
    }
    case "scheduled-chats": {
      const { runDueScheduledChats } = await import(
        sourceUrl(sourceRoot, "lib/schedules/scheduler.ts")
      );
      const due = await runDueScheduledChats();
      await drainDetachedPumps(sourceRoot);
      return { operation: request.operation, dispatched: due.length };
    }
    case "memory-autofetch": {
      const { runMemoryAutofetch } = await import(
        sourceUrl(sourceRoot, "lib/memory-tree/autofetch.ts")
      );
      const results = runMemoryAutofetch();
      return {
        operation: request.operation,
        users: results.length,
        written: results.reduce((sum, result) => sum + result.written, 0),
      };
    }
    case "email-poll": {
      const { pollEmailOnce } = await import(
        sourceUrl(sourceRoot, "lib/email/service.ts")
      );
      const result = await pollEmailOnce();
      await drainDetachedPumps(sourceRoot);
      return {
        operation: request.operation,
        fetched: result.fetched,
        answered: result.answered,
        ignored: result.ignored,
        errors: result.errors.length,
      };
    }
    case "review-scheduler": {
      const { runDueReviews } = await import(
        sourceUrl(sourceRoot, "lib/review/scheduler.ts")
      );
      const result = await runDueReviews();
      return { operation: request.operation, ...result };
    }
    case "caldav-sync": {
      const { runDueCaldavSyncs } = await import(
        sourceUrl(sourceRoot, "lib/calendar/caldav-scheduler.ts")
      );
      const result = await runDueCaldavSyncs();
      return { operation: request.operation, ...result };
    }
    case "ifixai-maintenance": {
      const [{ readIfixAiMaintenanceConfig }, { runIfixAiMaintenanceOnce }] =
        await Promise.all([
          import(sourceUrl(sourceRoot, "lib/ifixai-maintenance/config.ts")),
          import(sourceUrl(sourceRoot, "lib/ifixai-maintenance/loop.ts")),
        ]);
      const config = readIfixAiMaintenanceConfig();
      if (!config.enabled) return { operation: request.operation, skipped: true };
      await runIfixAiMaintenanceOnce({ config, trigger: "background_interval" });
      return { operation: request.operation, skipped: false };
    }
    default:
      fail("The Runtime V2 background operation was not implemented.");
  }
}

function whatsAppCredentialsPresent(sourceRoot) {
  return import(sourceUrl(sourceRoot, "lib/whatsapp/config.ts")).then(
    ({ whatsAppSessionDir }) =>
      fs.existsSync(path.join(whatsAppSessionDir(), "creds.json")),
  );
}

async function gatewayStartupDecision(gateway, sourceRoot) {
  if (gateway === "telegram") {
    const [{ telegramFeatureEnabled }, { hasBotToken }, { getTelegramStore }] =
      await Promise.all([
        import(sourceUrl(sourceRoot, "lib/telegram/config.ts")),
        import(sourceUrl(sourceRoot, "lib/telegram/credentials.ts")),
        import(sourceUrl(sourceRoot, "lib/telegram/instance.ts")),
      ]);
    const settings = getTelegramStore().settings();
    const running =
      telegramFeatureEnabled() &&
      settings.autostart &&
      settings.ownerUserId !== null &&
      hasBotToken();
    return {
      desiredState: running ? "running" : "stopped",
      ownerUserId: settings.ownerUserId,
      reason: running ? "autostart-enabled" : "autostart-disabled-or-unconfigured",
    };
  }
  const [{ whatsAppFeatureEnabled }, { getWhatsAppStore }, paired] =
    await Promise.all([
      import(sourceUrl(sourceRoot, "lib/whatsapp/config.ts")),
      import(sourceUrl(sourceRoot, "lib/whatsapp/instance.ts")),
      whatsAppCredentialsPresent(sourceRoot),
    ]);
  const settings = getWhatsAppStore().settings();
  const running =
    whatsAppFeatureEnabled() &&
    settings.autostart &&
    settings.ownerUserId !== null &&
    paired;
  return {
    desiredState: running ? "running" : "stopped",
    ownerUserId: settings.ownerUserId,
    reason: running ? "autostart-enabled" : "autostart-disabled-or-unconfigured",
  };
}

async function gatewayExplicitDecision(request, sourceRoot) {
  if (request.gateway === "telegram") {
    const [{ telegramFeatureEnabled }, { getTelegramStore }] = await Promise.all([
      import(sourceUrl(sourceRoot, "lib/telegram/config.ts")),
      import(sourceUrl(sourceRoot, "lib/telegram/instance.ts")),
    ]);
    if (!telegramFeatureEnabled()) fail("Telegram is disabled for this installation.");
    const store = getTelegramStore();
    store.requireOwner(request.userId);
    return {
      desiredState: request.desiredState,
      ownerUserId: request.userId,
      reason: "authenticated-explicit-intent",
    };
  }
  const [{ whatsAppFeatureEnabled }, { getWhatsAppStore }] = await Promise.all([
    import(sourceUrl(sourceRoot, "lib/whatsapp/config.ts")),
    import(sourceUrl(sourceRoot, "lib/whatsapp/instance.ts")),
  ]);
  if (!whatsAppFeatureEnabled()) fail("WhatsApp is disabled for this installation.");
  const store = getWhatsAppStore();
  store.requireOwner(request.userId);
  return {
    desiredState: request.desiredState,
    ownerUserId: request.userId,
    reason: "authenticated-explicit-intent",
  };
}

async function runGatewayReconciliation(request, sourceRoot) {
  const decision = request.trigger === "startup"
    ? await gatewayStartupDecision(request.gateway, sourceRoot)
    : await gatewayExplicitDecision(request, sourceRoot);
  return {
    kind: "runtime-service-reconciliation",
    serviceId: `${request.gateway}-gateway`,
    gateway: request.gateway,
    decisionEpoch: request.decisionEpoch,
    desiredState: decision.desiredState,
    ownerUserId: decision.ownerUserId,
    reason: decision.reason,
  };
}

async function runScheduleReconciliation(request, sourceRoot) {
  if (request.schedule === "skills-catalog-refresh") {
    const { configuredStaleMs } = await import(
      sourceUrl(sourceRoot, "lib/hermes/skills-catalog-store.ts")
    );
    const intervalMs = configuredStaleMs();
    return {
      kind: "runtime-schedule-reconciliation",
      scheduleId: request.schedule,
      decisionEpoch: request.decisionEpoch,
      desiredState: "running",
      ownerUserId: null,
      // The skills route already performs a bounded cold fill and
      // stale-while-revalidate refresh. Starting the periodic copy at boot
      // duplicates that work and can occupy the single disposable-worker slot
      // before an authenticated request arrives.
      initialDelayMs: intervalMs,
      intervalMs,
      reason: "configured-catalog-interval",
    };
  }
  if (request.schedule === "ifixai-maintenance") {
    const { readIfixAiMaintenanceConfig } = await import(
      sourceUrl(sourceRoot, "lib/ifixai-maintenance/config.ts")
    );
    const config = readIfixAiMaintenanceConfig();
    return {
      kind: "runtime-schedule-reconciliation",
      scheduleId: request.schedule,
      decisionEpoch: request.decisionEpoch,
      desiredState: config.enabled ? "running" : "stopped",
      ownerUserId: null,
      initialDelayMs: config.startupDelayMs,
      intervalMs: config.intervalMs,
      reason: config.enabled ? "operator-enabled" : "operator-disabled",
    };
  }
  const [{ emailFeatureEnabled, emailTimings }, { hasAccount }, { readSettings }] =
    await Promise.all([
      import(sourceUrl(sourceRoot, "lib/email/config.ts")),
      import(sourceUrl(sourceRoot, "lib/email/credentials.ts")),
      import(sourceUrl(sourceRoot, "lib/email/store.ts")),
    ]);
  const settings = readSettings();
  if (
    request.trigger === "explicit" &&
    settings.ownerUserId !== null &&
    settings.ownerUserId !== request.userId
  ) {
    fail("Email is linked to a different Breadboard account.");
  }
  const configured =
    emailFeatureEnabled() && settings.ownerUserId !== null && hasAccount();
  const running = request.trigger === "explicit"
    ? request.desiredState === "running" && configured
    : configured && settings.autostart;
  if (
    request.trigger === "explicit" &&
    request.desiredState === "running" &&
    !configured
  ) {
    fail("Link a mailbox before starting the channel.");
  }
  const intervalMs = emailTimings().pollIntervalMs;
  return {
    kind: "runtime-schedule-reconciliation",
    scheduleId: request.schedule,
    decisionEpoch: request.decisionEpoch,
    desiredState: running ? "running" : "stopped",
    ownerUserId: settings.ownerUserId,
    initialDelayMs: intervalMs,
    intervalMs,
    reason: running ? "email-poll-enabled" : "email-poll-disabled-or-unconfigured",
  };
}

export async function executeRuntimeV2BackgroundRequest({
  request,
  executionScope,
  sourceRoot,
}) {
  const validated = validateRuntimeV2BackgroundRequest(request, executionScope);
  if (validated.operation === "gateway-reconcile") {
    return runGatewayReconciliation(validated, sourceRoot);
  }
  if (validated.operation === "schedule-reconcile") {
    return runScheduleReconciliation(validated, sourceRoot);
  }
  return runBackgroundOperation(validated, sourceRoot);
}
