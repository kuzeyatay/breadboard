import { externalRuntimePathExists } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";

/**
 * Locating the graft CLI (`@nanonets/graft`).
 *
 * graft ships as a global npm install, so it is never a dependency of this app.
 * What it does leave behind is a predictable layout: the `graft` shim and a
 * `node_modules/@nanonets/graft/dist/cli.js` beside it. Resolving that entry
 * point and running it with this process's own Node is what keeps the launch
 * identical on Windows and Unix — spawning the `.cmd` shim directly is refused
 * by modern Node without a shell, and going through a shell would put the
 * repository path through cmd.exe quoting.
 */

export interface GraftLauncher {
  command: string;
  /** Prefix arguments — every graft invocation appends its own after these. */
  args: readonly string[];
  /** Where it was found, for the run event and for diagnosing a missing CLI. */
  source: string;
}

const PACKAGE_ENTRY = path.join(
  "@nanonets",
  "graft",
  "dist",
  "cli.js",
);

function pathEntries(env: NodeJS.ProcessEnv): string[] {
  const raw = env.PATH ?? env.Path ?? "";
  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function candidateEntries(env: NodeJS.ProcessEnv): string[] {
  const roots = [
    env.npm_config_prefix ? path.join(env.npm_config_prefix, "node_modules") : "",
    env.npm_config_prefix
      ? path.join(env.npm_config_prefix, "lib", "node_modules")
      : "",
    env.APPDATA ? path.join(env.APPDATA, "npm", "node_modules") : "",
    env.HOME ? path.join(env.HOME, ".npm-global", "lib", "node_modules") : "",
    // Breadboard's own trees first, so a vendored copy wins over a stale global.
    path.resolve(process.cwd(), "node_modules"),
    path.resolve(process.cwd(), "..", "node_modules"),
    // The npm bin directory keeps its packages in a sibling node_modules, which
    // makes PATH itself the most reliable index of every Node version manager.
    ...pathEntries(env).map((entry) => path.join(entry, "node_modules")),
    "/usr/local/lib/node_modules",
    "/usr/lib/node_modules",
  ];
  return roots.filter(Boolean).map((root) => path.join(root, PACKAGE_ENTRY));
}

export function resolveGraftLauncher(
  env: NodeJS.ProcessEnv = process.env,
): GraftLauncher | null {
  const explicit = env.BREADBOARD_GRAFT_CLI?.trim();
  const candidates = [
    ...(explicit ? [explicit] : []),
    ...candidateEntries(env),
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (externalRuntimePathExists(resolved)) {
      return {
        command: process.execPath,
        args: [resolved],
        source: resolved,
      };
    }
  }
  return null;
}

export function graftAvailability(env: NodeJS.ProcessEnv = process.env): {
  available: boolean;
  reason?: string;
  source?: string;
} {
  const launcher = resolveGraftLauncher(env);
  if (!launcher) {
    return {
      available: false,
      reason:
        "graft is not installed — run `npm install -g @nanonets/graft`, or point BREADBOARD_GRAFT_CLI at its dist/cli.js.",
    };
  }
  return { available: true, source: launcher.source };
}
