import fs from "node:fs";

function requiredPath(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required by the parent-death fixture.`);
  return value;
}

export async function executeAdmittedLearnOperation(_request, yieldToResponse) {
  const releasePath = requiredPath("LEARN_WORKER_TEST_RELEASE_PATH");
  const completionPath = requiredPath("LEARN_WORKER_TEST_COMPLETION_PATH");
  await yieldToResponse("learn_job_parent_death_fixture");

  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 60_000;
    const timer = setInterval(() => {
      if (fs.existsSync(releasePath)) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        clearInterval(timer);
        reject(new Error("The parent-death fixture was not released."));
      }
    }, 25);
  });

  fs.writeFileSync(
    completionPath,
    `${JSON.stringify({ pid: process.pid, completed: true })}\n`,
    "utf8",
  );
  return { completed: true };
}

export const executeLearnOperation = executeAdmittedLearnOperation;
