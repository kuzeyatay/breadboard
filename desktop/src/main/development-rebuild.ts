import { spawn } from "node:child_process";
import * as path from "node:path";

export type DevelopmentDashboardMode = "hot" | "lean";

export interface DevelopmentRebuildCommand {
  readonly label: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

interface DevelopmentRebuildOptions {
  readonly repoRoot: string;
  readonly dashboardMode: DevelopmentDashboardMode;
  readonly env?: NodeJS.ProcessEnv;
  readonly writeLog?: (line: string) => void;
  readonly runCommand?: (
    command: DevelopmentRebuildCommand,
    env: NodeJS.ProcessEnv,
    writeLog: (line: string) => void,
  ) => Promise<boolean>;
}

/**
 * The exact work a development restart must finish before Electron relaunches.
 *
 * Hot mode gets its dashboard from source and recompiles it on the clean Next
 * start, so only the Electron shell has a persistent build artifact to refresh.
 * Lean mode serves a standalone dashboard and therefore has to rebuild that
 * artifact as well.
 */
export function developmentRebuildCommands(
  repoRoot: string,
  dashboardMode: DevelopmentDashboardMode,
  env: NodeJS.ProcessEnv = process.env,
): DevelopmentRebuildCommand[] {
  const nodeExecutable = env["npm_node_execpath"]?.trim();
  const npmCli = env["npm_execpath"]?.trim();
  if (!nodeExecutable || !npmCli) {
    throw new Error(
      "Development restart needs npm's Node launcher. Start Breadboard through npm and try again.",
    );
  }

  const root = path.resolve(repoRoot);
  const desktopRoot = path.join(root, "desktop");
  const commands: DevelopmentRebuildCommand[] = [];
  if (dashboardMode === "lean") {
    commands.push({
      label: "standalone dashboard",
      executable: nodeExecutable,
      args: [path.join(desktopRoot, "scripts", "build-dashboard.mjs")],
      cwd: root,
    });
  }
  commands.push({
    label: "desktop shell",
    executable: nodeExecutable,
    args: [npmCli, "--prefix", desktopRoot, "run", "build"],
    cwd: root,
  });
  return commands;
}

function writeChunks(
  stream: NodeJS.ReadableStream | null,
  writeLog: (line: string) => void,
): void {
  stream?.on("data", (chunk: Buffer | string) => {
    const text = chunk.toString().trimEnd();
    if (text) writeLog(text);
  });
}

async function runDevelopmentRebuildCommand(
  command: DevelopmentRebuildCommand,
  env: NodeJS.ProcessEnv,
  writeLog: (line: string) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command.executable, [...command.args], {
      cwd: command.cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    writeChunks(child.stdout, writeLog);
    writeChunks(child.stderr, writeLog);
    child.once("error", (error) => {
      writeLog(`${command.label} rebuild could not start: ${error.message}`);
      resolve(false);
    });
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve(true);
        return;
      }
      writeLog(
        `${command.label} rebuild failed${signal ? ` on signal ${signal}` : ` with exit code ${code ?? "unknown"}`}.`,
      );
      resolve(false);
    });
  });
}

/** Rebuild every development artifact used by the active launch mode. */
export async function rebuildDevelopmentInstallation(
  options: DevelopmentRebuildOptions,
): Promise<boolean> {
  const env = options.env ?? process.env;
  const writeLog = options.writeLog ?? (() => undefined);
  const runCommand = options.runCommand ?? runDevelopmentRebuildCommand;
  const commands = developmentRebuildCommands(
    options.repoRoot,
    options.dashboardMode,
    env,
  );

  for (const command of commands) {
    writeLog(`rebuilding ${command.label}`);
    if (!(await runCommand(command, env, writeLog))) return false;
  }
  return true;
}
