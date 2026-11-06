import type { AgentManagerEntry } from "./catalog.ts";

export interface AgentManagerStatus {
  state: "ready" | "needs-setup" | "needs-configuration" | "included" | "unknown";
  label: string;
  message: string;
  installed: boolean | null;
  sourcePresent: boolean | null;
  storagePath: string | null;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (...values: unknown[]) => values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.slice(0, 1200) ?? "";
const boolean = (...values: unknown[]) => values.find((value): value is boolean => typeof value === "boolean") ?? null;

/** Accept only known public fields, never spread a health response into the UI. */
export function agentManagerStatus(entry: AgentManagerEntry, value?: unknown, httpOk = true): AgentManagerStatus {
  const data = record(value), nested = record(data.status), setup = record(data.setup), health = record(data.health);
  const clone = record(nested.clone), setupClone = record(setup.clone), deps = record(nested.dependencies), setupDeps = record(setup.dependencies), runtime = record(nested.runtime);
  const installationChecks = [data.environmentReady, data.packageInstalled, data.dependenciesInstalled, data.installed, deps.installed, setupDeps.installed,
    ...(entry.id === "classroom" ? [runtime.installed, runtime.built] : []),
    ...(entry.id === "resource2skill" ? [runtime.found] : []),
    ...(["matraix", "openmontage"].includes(entry.id) ? [record(nested.python).found, record(nested.python).dependencies] : []),
  ].filter((item): item is boolean => typeof item === "boolean");
  const base = {
    message: text(data.reason, nested.reason, setup.reason, health.reason, setup.message, data.message, data.detail),
    installed: installationChecks.length ? installationChecks.every(Boolean) : null,
    sourcePresent: boolean(data.cloned, health.cloned, clone.found, setupClone.found, setup.cloned),
    storagePath: text(data.root, data.runtimeRoot, health.root, nested.runtimeRoot, nested.root, runtime.path, clone.path, setupClone.path, setup.clonePath) || null,
  };
  if (value === undefined && !entry.healthUrl) return {
    ...base, state: entry.distribution === "included" ? "included" : "unknown",
    label: entry.distribution === "included" ? "Included" : "Check in settings",
    message: entry.requirements,
  };
  if (httpOk && entry.id === "parametric-cad" && data.ok === false && data.configured === true && data.status === "stopped" && data.error === "cad_service_stopped") {
    const solidworks = record(record(data.engines).solidworks);
    const solidworksInstalled = solidworks.available === true && solidworks.code === "available";
    return { ...base, state: "included", label: "Starts on demand", installed: solidworksInstalled ? true : null,
      message: [base.message || "The CAD service starts on demand when you create a design.", solidworksInstalled ? "SolidWorks is installed; it starts when a design needs it." : ""].filter(Boolean).join(" "),
    };
  }
  if (!httpOk || data.ok === false) return { ...base, state: "unknown", label: "Check failed", message: text(data.reason, data.message, data.error) || "Status could not be checked. Retry or open settings." };
  if (entry.id === "inbox-zero" && data.runtimeState === "stopping") {
    return { ...base, state: "unknown", label: "Stopping · retry shortly", installed: null,
      message: base.message || "Inbox Zero's controller is finishing its idle shutdown. Retry the status check shortly.",
    };
  }
  // A cached aggregate availability flag must not conceal an explicit missing
  // dependency. External music providers do not require a local environment.
  const externalMusic = entry.id === "music-producer" && record(data.settings).mode === "external";
  if ((entry.distribution === "managed" || entry.id === "classroom") && base.installed === false && !externalMusic) {
    return { ...base, state: "needs-setup", label: "Needs installation", message: base.message || "Install or repair the required tools before using this agent." };
  }
  // These two services deliberately distinguish a running health probe from
  // native runtime availability. Deep Research may be installed and stopped.
  const runtimeState = ["agent-tars", "deep-research"].includes(entry.id) ? text(data.runtimeState) : "";
  const runtimeAvailable = runtimeState === "available" ? true : ["unavailable", "misconfigured", "disabled", "starting"].includes(runtimeState) ? false : null;
  const cadAvailable = entry.id === "parametric-cad" && data.status === "ok" ? boolean(record(record(data.engines).cadquery).available) : null;
  const availabilityChecks = [data.available, data.ready, nested.ready, setup.ready, health.available, runtimeAvailable, cadAvailable].filter((item): item is boolean => typeof item === "boolean");
  const available = availabilityChecks.length ? availabilityChecks.every(Boolean) : null;
  if (available === false || ["missing-models", "unavailable", "resource-blocked", "degraded", "unsupported", "failed", "installation-unavailable"].includes(String(data.state))) {
    const needsSetup = base.installed === false || base.sourcePresent === false || data.state === "missing-models";
    return { ...base, state: needsSetup ? "needs-setup" : "needs-configuration", label: needsSetup ? "Needs installation" : "Needs attention", message: base.message || entry.requirements };
  }
  if (available === true || ["ready", "healthy", "busy", "stopped", "available-but-stopped"].includes(String(data.state))) {
    const onDemand = ["stopped", "available-but-stopped"].includes(String(data.state)) || (["deep-research", "agent-tars"].includes(entry.id) && runtimeAvailable === true && health.status === "unavailable");
    return { ...base, installed: base.installed ?? true, state: "ready",
      label: onDemand ? "Installed · starts on demand" : entry.id === "agent-tars" ? "Runtime available" : "Ready",
      message: base.message || (entry.id === "agent-tars" ? entry.requirements : ""),
    };
  }
  return { ...base, state: "unknown", label: "Status unavailable", message: base.message || (entry.hasSettings ? "Open settings to check this agent's requirements." : entry.requirements) };
}

export interface AgentManagerOperation {
  agentId: string;
  actionId: string;
  jobId: string | null;
  state: string;
  message: string;
  finished: boolean;
}

export const TERMINAL_SETUP_STATES = new Set(["succeeded", "failed", "cancelled", "resource_exhausted", "interrupted", "uncertain"]);
