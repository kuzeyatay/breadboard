import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { praxistDockerCommand, PRAXIST_CONTAINER_IMAGE } from "./container-config.ts";
import { praxistEnv, type PraxistRuntime } from "./runtime.ts";

function docker(args: string[], env: NodeJS.ProcessEnv = process.env, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    // Finite workers use an isolated home and PATH. Address Desktop's local
    // Linux engine explicitly instead of depending on the operator's context.
    const executable = praxistDockerCommand();
    const child = spawn(executable.command, [...executable.args,...args], {env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    let output = "", error = "";
    child.stdout.on("data", chunk => { output = (output + chunk).slice(-128_000); });
    child.stderr.on("data", chunk => { error = (error + chunk).slice(-16_000); });
    const timer = setTimeout(() => { child.kill(); reject(new Error("The Praxist container command timed out.")); }, timeoutMs);
    child.once("error", err => { clearTimeout(timer); reject(err); });
    child.once("close", code => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error(error.trim() || `Docker returned ${code}`)); });
  });
}

export function containerProviderUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (["127.0.0.1","localhost","[::1]"].includes(url.hostname)) url.hostname = "host.docker.internal";
  return url.toString().replace(/\/$/, "");
}

export async function startPraxistContainer(input: {
  runtime: PraxistRuntime; workspace: string; taskPath: string; model: string; baseUrl: string; apiKey: string;
  onCreated: (name: string) => void; signal: AbortSignal;
}): Promise<Record<string, unknown>> {
  await docker(["image","inspect",PRAXIST_CONTAINER_IMAGE]).catch((error: Error) => {
    throw new Error(`Praxist needs its Linux runtime on Windows. Run node dashboard/scripts/prepare-praxist-container.mjs with Docker Desktop running. ${error.message}`);
  });
  const name = `breadboard-praxist-${randomUUID().replaceAll("-", "")}`;
  const env = praxistEnv(input.runtime, {OPENAI_API_KEY:input.apiKey,OPENAI_BASE_URL:containerProviderUrl(input.baseUrl),PRAXIST_MODEL:input.model});
  const mounts = [
    [input.runtime.root,"/opt/praxist",true], [input.workspace,"/work",false], [input.taskPath,"/task",false],
    [path.join(env.XDG_CONFIG_HOME!,"praxist","user-agreement.json"),"/operator-config/praxist/user-agreement.json",true],
    [fileURLToPath(new URL("./container-runner.py",import.meta.url)),"/runner.py",true],
  ] as const;
  if (input.signal.aborted) throw input.signal.reason;
  // Set ownership before creation, so cancellation can always stop this name.
  input.onCreated(name);
  try {
    await docker(["run","--detach","--rm","--init","--name",name,"--label","breadboard.agent=praxist",
      "--memory","3g","--pids-limit","256","--stop-timeout","30",
      ...mounts.flatMap(([src,dst,readonly]) => ["--mount",`type=bind,source=${path.resolve(src).replace(/^\\\\\?\\/, "")},target=${dst}${readonly?",readonly":""}`]),
      "--workdir","/task","--env","OPENAI_API_KEY","--env","OPENAI_BASE_URL","--env","PRAXIST_MODEL",
      "--env","XDG_CONFIG_HOME=/operator-config","--env","PRAXIST_STATE_DIR=/work/praxist-state",
      PRAXIST_CONTAINER_IMAGE,"python","/runner.py"],env);
    const deadline = Date.now() + 80_000;
    while (Date.now() < deadline) {
      if (input.signal.aborted) throw input.signal.reason;
      const error = await readFile(path.join(input.workspace,"container-error.json"),"utf8").catch(() => "");
      if (error) throw new Error(JSON.parse(error).error);
      const receipt = await readFile(path.join(input.workspace,"container-start.json"),"utf8").catch(() => "");
      if (receipt) return JSON.parse(receipt);
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
    throw new Error("Praxist did not produce its Linux startup receipt in time.");
  } catch (error) {
    // Cancellation can race Docker's create request: the outer abort may
    // already have cleared its name before the daemon finishes creating it.
    // Reconcile ownership here after creation settles, so that run cannot leak.
    await stopPraxistContainer(name).catch(() => undefined);
    throw error;
  }
}

export async function stopPraxistContainer(name: string): Promise<void> {
  if (!/^breadboard-praxist-[a-f0-9]{32}$/.test(name)) throw new Error("Invalid Praxist container identity.");
  await docker(["stop","--time","30",name],process.env,40_000).catch(async error => {
    if (/No such container/.test(error.message)) return;
    await docker(["kill",name],process.env,10_000);
  });
}
