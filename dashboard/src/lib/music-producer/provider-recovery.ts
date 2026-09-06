import fs from "node:fs";
import path from "node:path";
import { resolveAceStepConfig } from "../acestep/config.ts";
import { readSupervisedServiceSnapshot } from "../supervisor-control.ts";
import { musicLaunch } from "./store.ts";
import { getOuterAgentRuntimeRunByRequest } from "../runtime-v2/outer-agent-run-store.ts";
import { readOuterAgentRunView } from "../runtime-v2/outer-agent-run.ts";
async function readCollector(userId: number, id: string) {
  const launch = musicLaunch(userId, id);
  const jobId = launch.runtime_job_id ?? getOuterAgentRuntimeRunByRequest(userId, "music-producer", id)?.job_id;
  if (!jobId)
    throw Error("The owning collector's native state is unavailable. Check Runtime before resetting the generation lock.");
  // Native ownership remains inspectable after the presentation conversation is deleted.
  return readOuterAgentRunView("music-producer", userId, jobId);
}
/** An explicit recovery action, never a claim that aborting HTTP stopped inference. */
export async function clearStoppedMusicGate(userId: number, dependencies = { resolveAceStepConfig, readSupervisedServiceSnapshot, readRun: readCollector }) {
  const config = dependencies.resolveAceStepConfig(userId);
  if (!config.managed)
    throw Error("Only an owned managed provider has a generation lock.");
  const filename = path.join(config.directory, "generation-receipt.json");
  if (!fs.existsSync(filename))
    return;
  const stat = fs.lstatSync(filename);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 2048 || path.relative(path.resolve(filename), fs.realpathSync.native(filename)) !== "")
    throw Error("Invalid generation lock.");
  const original = fs.readFileSync(filename, "utf8"), gate = JSON.parse(original);
  if (typeof gate.launchId !== "string")
    throw Error("Invalid generation lock.");
  // This owner check also protects one user's receipt from another user's reset.
  const launch = musicLaunch(userId, gate.launchId);
  if (!(await dependencies.readRun(userId, launch.id)).terminal)
    throw Error("Stop the owning collector before resetting its generation lock.");
  const snapshot = await dependencies.readSupervisedServiceSnapshot("acestep");
  if (!snapshot || !["stopped", "available-but-stopped"].includes(snapshot.state))
    throw Error("Runtime must report ACE-Step stopped before its generation lock can be reset. Wait for idle shutdown and check readiness again.");
  // A concurrent collector may have installed a newer receipt while we inspected Runtime.
  if (fs.readFileSync(filename, "utf8") !== original)
    throw Error("The generation lock changed. Check readiness again.");
  fs.unlinkSync(filename);
}
