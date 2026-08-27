function occurrences(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function requireSource(value, label) {
  if (typeof value !== "string") {
    throw new TypeError(`Runtime V2 ${label} source is invalid.`);
  }
  return value;
}

/**
 * Proves that Electron has activated its deliberately narrow RuntimeProcess
 * adapter and no longer constructs or calls the legacy service-tree owners.
 * This is source evidence only; real Electron process-tree receipts remain a
 * separate mandatory gate.
 */
export function validateElectronRuntimeOwner(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Runtime V2 Electron-owner validation input is invalid.");
  }
  const lifecycle = requireSource(input.appLifecycleSource, "AppLifecycle");
  const adapter = requireSource(input.runtimeProcessSource, "RuntimeProcess");
  const errors = [];

  const forbiddenLifecyclePatterns = [
    ["legacy ServiceManager import", /from\s+["']\.\/service-manager["']/u],
    ["legacy service definitions import", /from\s+["']\.\/service-definitions["']/u],
    ["legacy supervisor control-plane import", /from\s+["']\.\/supervisor-control-plane["']/u],
    ["legacy service adoption import", /from\s+["']\.\/service-adoption["']/u],
    ["Electron port allocation import", /from\s+["']\.\/ports["']/u],
    ["direct Recall process cleanup import", /from\s+["']\.\/recall["']/u],
    ["direct Learn process cleanup import", /from\s+["']\.\/learn-worker-cleanup["']/u],
    ["legacy service manager member", /\bthis\.services\b/u],
    ["legacy control-plane member", /\bthis\.controlPlane\b/u],
    ["legacy service-definition construction", /\bbuildServiceDefinitions\s*\(/u],
    ["legacy service URL authority", /\bserviceUrls\s*\(/u],
    ["direct Recall shutdown", /\bstopRecallEngine\s*\(/u],
    ["direct Learn shutdown", /\bstopDetachedLearnWorker(?:Now)?\s*\(/u],
    ["Electron-owned Hermes service configuration", /\bwriteHermesRuntimeConfig\s*\(/u],
    ["Electron-owned CLIProxy preparation", /\bprepareCliproxy\s*\(/u],
    ["Electron-owned WhisperX runtime repair", /\brepairWhisperXFfmpeg\s*\(/u],
    ["Electron-owned Quartz service provisioning", /\b(?:needsQuartzProvisioning|provisionQuartzWorkspace)\s*\(/u],
  ];
  for (const [label, pattern] of forbiddenLifecyclePatterns) {
    if (pattern.test(lifecycle)) errors.push(`AppLifecycle retains ${label}.`);
  }

  if (!/from\s+["']\.\/runtime-process["']/u.test(lifecycle)) {
    errors.push("AppLifecycle does not import RuntimeProcess.");
  }
  if (occurrences(lifecycle, /\bnew\s+RuntimeProcess\s*\(/gu) !== 1) {
    errors.push("AppLifecycle must construct exactly one RuntimeProcess.");
  }
  if (occurrences(lifecycle, /\bawait\s+this\.[A-Za-z0-9_]*runtime[A-Za-z0-9_]*\.start\s*\(/giu) !== 1) {
    errors.push("AppLifecycle must await exactly one RuntimeProcess start.");
  }
  if (!/showDashboard\s*\(\s*[^)]*dashboardUrl/u.test(lifecycle)) {
    errors.push("AppLifecycle does not open the Runtime V2 dashboard URL.");
  }
  if (!/\bthis\.[A-Za-z0-9_]*runtime[A-Za-z0-9_]*\.(?:status|snapshot)\s*\(/iu.test(lifecycle)) {
    errors.push("AppLifecycle does not project Runtime V2 service status into the existing UI.");
  }
  if (!/\bawait\s+this\.[A-Za-z0-9_]*runtime[A-Za-z0-9_]*\.stop\s*\(/iu.test(lifecycle)) {
    errors.push("AppLifecycle does not await Runtime V2 shutdown.");
  }
  if (!/\bthis\.[A-Za-z0-9_]*runtime[A-Za-z0-9_]*\.terminateNow\s*\(/iu.test(lifecycle)) {
    errors.push("AppLifecycle fatal handlers do not terminate the fixed Runtime V2 root.");
  }
  if (
    !/IPC_CHANNELS\.retryService/u.test(lifecycle) ||
    !/\bawait\s+[A-Za-z0-9_.]+\.retryService\s*\(\s*serviceId\s*\)/u.test(lifecycle)
  ) {
    errors.push("AppLifecycle does not route startup retry through Runtime V2 lifecycle authority.");
  }

  const adapterRequirements = [
    ["fixed executable name", /RUNTIME_EXECUTABLE_NAME\s*=\s*["']breadboard-runtime\.exe["']/u],
    ["fixed executable resolution", /path\.join\(this\.#binDir,\s*RUNTIME_EXECUTABLE_NAME\)/u],
    ["argument-free runtime launch", /spawnRuntime\(this\.#executable,\s*\[\]/u],
    ["shell-disabled runtime launch", /shell:\s*false/u],
    ["non-detached runtime launch", /detached:\s*false/u],
    ["bounded graceful stop", /\basync\s+#stopOnce\s*\(/u],
    ["fatal fixed-root termination", /\bterminateNow\s*\(\s*\)\s*:\s*void/u],
    [
      "typed exact-service retry",
      /\basync\s+retryService\s*\(\s*serviceId\s*:\s*string\s*\)\s*:\s*Promise<RuntimeServiceRetryResult>/u,
    ],
    [
      "lifecycle-only service retry endpoint",
      /\/v1\/lifecycle\/services\/\$\{serviceId\}\/retry/u,
    ],
  ];
  for (const [label, pattern] of adapterRequirements) {
    if (!pattern.test(adapter)) errors.push(`RuntimeProcess is missing ${label}.`);
  }

  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    counts: Object.freeze({
      runtimeConstructions: occurrences(lifecycle, /\bnew\s+RuntimeProcess\s*\(/gu),
      runtimeStarts: occurrences(
        lifecycle,
        /\bawait\s+this\.[A-Za-z0-9_]*runtime[A-Za-z0-9_]*\.start\s*\(/giu,
      ),
      forbiddenLegacyOwners: forbiddenLifecyclePatterns.filter(([, pattern]) =>
        pattern.test(lifecycle),
      ).length,
    }),
  });
}
