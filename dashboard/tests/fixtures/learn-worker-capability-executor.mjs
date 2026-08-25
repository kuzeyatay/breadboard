import fs from "node:fs";

const eventsPath = process.env.LEARN_WORKER_TEST_CAPABILITY_EVENTS;
const gatePath = process.env.LEARN_WORKER_TEST_CAPABILITY_GATE;
const mode = process.env.LEARN_WORKER_TEST_CAPABILITY_MODE;

function record(event) {
  fs.appendFileSync(eventsPath, `${JSON.stringify({ event })}\n`, "utf8");
}

function waitForGate() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30_000;
    const timer = setInterval(() => {
      if (fs.existsSync(gatePath)) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        clearInterval(timer);
        reject(new Error("The capability fixture gate was not released."));
      }
    }, 20);
  });
}

record("executor-import");

export async function executeAdmittedLearnOperation(_request, yieldToResponse) {
  record("execute");
  if (mode === "failure") {
    throw new Error("sentinel admitted executor failure");
  }
  if (mode === "handoff") {
    await yieldToResponse("learn_job_capability_handoff");
    record("handoff-published");
    await waitForGate();
    record("operation-complete");
  }
  return { mode, completed: true };
}
