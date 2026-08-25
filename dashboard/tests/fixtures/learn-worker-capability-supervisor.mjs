import fs from "node:fs";

const eventsPath = process.env.LEARN_WORKER_TEST_CAPABILITY_EVENTS;
const mode = process.env.LEARN_WORKER_TEST_CAPABILITY_MODE;

function record(event, details = {}) {
  fs.appendFileSync(
    eventsPath,
    `${JSON.stringify({ event, ...details })}\n`,
    "utf8",
  );
}

export async function acquireCapabilityLease(capabilityId, reason) {
  record("acquire", { capabilityId, reason });
  if (mode === "deny") {
    const error = new Error("sentinel capability denial before executor import");
    error.name = "SupervisorResourceExhaustedError";
    throw error;
  }
  return { id: "learn-worker-fixture-lease", targetId: capabilityId };
}

export async function releaseSupervisorLease(lease, _env, options) {
  record("release", {
    leaseId: lease?.id ?? null,
    afterOwnerPidExit: options?.afterOwnerPidExit ?? null,
  });
}
