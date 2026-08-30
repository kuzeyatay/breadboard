import type { RuntimeJobSnapshot } from "../supervisor-control.ts";
import type { OuterAgentKind } from "./outer-agent-run-store.ts";

const SANITIZED_RUNTIME_FAILURE_MESSAGE = "Runtime job execution failed.";

type FailedRuntimeJob = Pick<
  RuntimeJobSnapshot,
  "state" | "failureCode" | "failureMessage" | "resourceExhaustion"
>;

/**
 * The local Runtime services each durable outer agent leases before its
 * worker starts, mirrored from desktop/runtime-v2/manifests/workers.json so a
 * dependency failure can say what to set up. ChatMock is left out: it is the
 * eager local model service every agent shares, and when it is down nothing
 * else in the product works either.
 */
const OUTER_AGENT_SERVICE_LABELS: Partial<Record<OuterAgentKind, readonly string[]>> = {
  "agent-tars": ["Agent TARS"],
  "deep-research": ["Deep Research"],
  "deer-flow": ["DeerFlow"],
  "inbox-zero": ["Inbox Zero"],
  "max-research": ["Deep Research", "OpenScience"],
  "meeting-notes": ["Scriberr", "Voicebox"],
  "money-printer": ["MoneyPrinter"],
  openscience: ["OpenScience"],
  openwork: ["OpenWork"],
  "parametric-cad": ["Parametric CAD"],
  "socials-manager": ["Postiz"],
  "stock-analyst": ["Stock Analyst"],
  "vibe-trading": ["Vibe Trading"],
  "video-use": ["Scriberr"],
  wardrobe: ["Wardrobe"],
};

function formatHeadroom(megabytes: number): string {
  const gigabytes = megabytes / 1024;
  return `${gigabytes.toFixed(gigabytes >= 10 ? 0 : 1)} GB`;
}

function serviceList(kind: OuterAgentKind | undefined): string {
  const services = kind ? OUTER_AGENT_SERVICE_LABELS[kind] : undefined;
  if (!services || services.length === 0) return "";
  if (services.length === 1) return ` (${services[0]})`;
  return ` (${services.slice(0, -1).join(", ")} or ${services.at(-1)})`;
}

/**
 * Turn Runtime's deliberately sanitized terminal state into something a person
 * can act on. This stays shared by every durable outer agent so one card cannot
 * regress to the opaque control-plane message while the others remain useful.
 */
export function outerAgentFailureMessage(
  job: FailedRuntimeJob | null,
  kind?: OuterAgentKind,
): string {
  if (!job) {
    return "This agent's Runtime job could not be recovered. Retry the request.";
  }

  if (job.state === "resource_exhausted") {
    const evidence = job.resourceExhaustion;
    if (evidence) {
      return (
        "Windows could not reserve enough memory to start this agent " +
        `(${formatHeadroom(evidence.requiredHeadroomMb)} required, ` +
        `${formatHeadroom(evidence.availableHeadroomMb)} available). ` +
        "Close memory-heavy work or increase the Windows paging file, then retry."
      );
    }
    return (
      "The Runtime could not reserve enough memory or execution capacity to start " +
      "this agent or one of its local services. Close memory-heavy work, then retry."
    );
  }

  // Runtime refused the job before any worker existed because a local service
  // the agent leases could not be started. The worker never ran, so "the
  // worker stopped" would send the user to the wrong place.
  if (job.failureCode === "SERVICE_DEPENDENCY_UNAVAILABLE") {
    return (
      `A local service this agent needs${serviceList(kind)} could not be started, ` +
      "usually because its setup is incomplete or its install is missing. " +
      "Open the agent's settings, finish that service's setup, then retry."
    );
  }

  if (
    job.failureMessage &&
    job.failureMessage !== SANITIZED_RUNTIME_FAILURE_MESSAGE
  ) {
    return job.failureMessage;
  }

  if (job.state === "interrupted") {
    return "This agent was interrupted before it returned a result. Retry the request.";
  }
  if (job.state === "uncertain") {
    return (
      "This agent stopped without a confirmed result. Check for any partial output " +
      "before retrying."
    );
  }
  return (
    "This agent's Runtime worker stopped before it returned a result. " +
    "Check the agent's setup, then retry."
  );
}
