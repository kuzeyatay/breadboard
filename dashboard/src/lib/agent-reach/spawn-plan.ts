// Turning "run this executable with these arguments" into something Node can
// actually spawn on Windows, without ever enabling `shell: true`.
//
// Two constraints meet here:
//   - Node 18.20+/20.12+/22+ refuse to spawn a .cmd or .bat file unless a shell
//     is involved (the CVE-2024-27980 mitigation), and npm-installed tools
//     (mcporter, opencli, npm itself) are exactly that.
//   - `shell: true` would hand the JOINED argv back to cmd.exe with no escaping,
//     so an `&` inside a URL query string would become a command separator. For
//     the run manager, where a model proposes the arguments, that would undo the
//     entire command policy.
//
// So: resolve the executable to a concrete file ourselves, and when it turns out
// to be a shim, invoke cmd.exe with arguments WE quote and
// `windowsVerbatimArguments` on, so Node does not re-quote on top.

import path from "node:path";
import {
  externalRuntimeLstat,
  externalRuntimeRealpath,
} from "../external-runtime-filesystem.ts";

export interface SpawnPlan {
  command: string;
  argv: string[];
  /** Pass as `windowsVerbatimArguments` to child_process.spawn. */
  verbatim: boolean;
}

function sameResolvedPath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.normalize(path.resolve(value));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function directExecutable(candidate: string): string | null {
  const resolved = path.resolve(candidate);
  try {
    const metadata = externalRuntimeLstat(resolved);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      !sameResolvedPath(externalRuntimeRealpath(resolved), resolved)
    ) return null;
    return resolved;
  } catch {
    return null;
  }
}

/** Find a direct executable file on the closed PATH, honoring PATHEXT on Windows. */
export function resolveOnPath(
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (path.isAbsolute(executable)) return directExecutable(executable);
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const directories = (env[pathKey] ?? "")
    .split(path.delimiter)
    .filter((directory) => path.isAbsolute(directory));
  const extensions =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${executable}${extension}`);
      const direct = directExecutable(candidate);
      if (direct) return direct;
    }
  }
  return null;
}

/**
 * Quote one argument for cmd.exe. Inside double quotes cmd stops treating `&`,
 * `|`, `<`, and `>` as operators, which is what keeps a URL's query string from
 * being read as a command separator.
 */
export function quoteForCmd(value: string): string {
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

/** True when an argument would be subject to cmd.exe environment expansion. */
export function expandsEnvironment(value: string): boolean {
  return /%[A-Za-z_][A-Za-z0-9_]*%/.test(value);
}

export type SpawnPlanResult = SpawnPlan | { error: string };

/**
 * Plan the spawn for an already-validated executable + argv.
 * `notFound` builds the message used when the executable is not on PATH.
 */
export function planSpawn(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  notFound: (executable: string) => string,
): SpawnPlanResult {
  const resolved = resolveOnPath(executable, env);
  if (!resolved) return { error: notFound(executable) };
  if (/\.(cmd|bat)$/i.test(resolved)) {
    if (args.some(expandsEnvironment)) {
      return { error: "Environment-variable syntax is not allowed in this command." };
    }
    const commandProcessor = resolveOnPath(env.ComSpec ?? env.COMSPEC ?? "cmd.exe", env);
    if (!commandProcessor) return { error: "The trusted Windows command processor is unavailable." };
    return {
      command: commandProcessor,
      // The outer quote pair is required: with /s, cmd.exe strips exactly the
      // first and last quote of the string after /c and runs the rest verbatim.
      // Without it, a shim path containing spaces ("Program Files") is split and
      // cmd answers "not recognized as an internal or external command".
      // This is the same envelope Node's own `shell: true` builds — the
      // difference is that we quote each argument first, which is what keeps a
      // URL's `&` from being read as an operator.
      argv: ["/d", "/s", "/c", `"${[resolved, ...args].map(quoteForCmd).join(" ")}"`],
      verbatim: true,
    };
  }
  return { command: resolved, argv: args, verbatim: false };
}
