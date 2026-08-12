// The command policy for Agent Reach runs.
//
// Agent Reach routes; the upstream tools do the fetching. So a run's only real
// power is "execute one upstream command", and this module is what keeps that
// bounded. Three rules hold everywhere:
//
//   1. No shell, ever. Commands are parsed into an argv array and spawned
//      directly, so nothing a model writes can be interpreted as shell syntax.
//   2. Executables are allowlisted, and each one has a read-only verb policy.
//      Agent Reach is an internet READER — posting, liking, logging in,
//      installing, and rewriting the user's Agent Reach config are all refused
//      even though the underlying CLIs support them.
//   3. Every file path an argument names is forced inside the run's own
//      workspace. The documented recipes write to /tmp; those are rewritten
//      rather than rejected, which is also what makes them work on Windows.

import path from "node:path";

export interface ParsedCommand {
  /** Allowlisted executable name as written by the model. */
  executable: string;
  /** argv after the executable, already workspace-normalized. */
  args: string[];
  /** Single-line rendering used for events and the transcript. */
  display: string;
}

export type CommandDecision =
  | { ok: true; command: ParsedCommand }
  | { ok: false; reason: string };

const MAX_ARGS = 60;
const MAX_ARG_LENGTH = 4_000;

const CHAINING_TOKENS = new Set(["&&", "||", ";", "|", "&", ">", ">>", "<", "2>", "2>&1"]);

interface Token {
  value: string;
  quoted: boolean;
}

/** Minimal shell-free tokenizer. Records quoting so operators can be told apart
 * from literal characters inside a quoted URL or query. */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    if (match[1] !== undefined) tokens.push({ value: match[1], quoted: true });
    else if (match[2] !== undefined) tokens.push({ value: match[2], quoted: true });
    else tokens.push({ value: match[3] ?? "", quoted: false });
  }
  return tokens;
}

// ---- per-executable policy --------------------------------------------------

interface ExecutablePolicy {
  /** Sub-verbs this run may use. Empty means "no verb layer" (e.g. curl). */
  verbs?: string[];
  /** Verbs whose FIRST argument is a site, checked against `verbs` afterwards. */
  siteFirst?: boolean;
  /** Flags that are refused outright, with the reason shown to the model. */
  bannedFlags?: Record<string, string>;
  /** Flags whose following value is a path that must land in the workspace. */
  pathFlags?: string[];
  /** Extra validation once the argv is known, given the full argv and the
   * positional-only slice (flags and their values removed). */
  check?: (args: string[], positional: string[]) => string | null;
}

const READ_ONLY_NOTE = "Agent Reach only reads the internet; write actions are refused.";

const POLICIES: Record<string, ExecutablePolicy> = {
  // The router itself. Diagnostics and transcription only — never the commands
  // that rewrite the user's stored config, cookies, or installed tools.
  "agent-reach": {
    verbs: ["doctor", "check-update", "watch", "version", "transcribe", "format"],
    pathFlags: ["-o", "--output"],
  },

  // Jina Reader, V2EX, and the Bilibili search fallback are all plain GETs.
  curl: {
    bannedFlags: {
      "-d": "curl may only issue GET requests.",
      "--data": "curl may only issue GET requests.",
      "--data-raw": "curl may only issue GET requests.",
      "--data-binary": "curl may only issue GET requests.",
      "--data-urlencode": "curl may only issue GET requests.",
      "-F": "curl may only issue GET requests.",
      "--form": "curl may only issue GET requests.",
      "-T": "curl may not upload files.",
      "--upload-file": "curl may not upload files.",
      "-X": "curl may only issue GET requests.",
      "--request": "curl may only issue GET requests.",
      "-K": "curl config files are not allowed.",
      "--config": "curl config files are not allowed.",
      "-k": "TLS verification may not be disabled.",
      "--insecure": "TLS verification may not be disabled.",
      "-x": "Proxy overrides are not allowed.",
      "--proxy": "Proxy overrides are not allowed.",
    },
    pathFlags: ["-o", "--output", "-c", "--cookie-jar"],
    check: (args) =>
      args.some((arg) => /^https?:\/\//i.test(arg))
        ? null
        : "curl needs one http(s) URL to read.",
  },

  // Metadata, subtitles, and search only — never a media download, and never
  // the flags that would turn yt-dlp into a process launcher.
  "yt-dlp": {
    bannedFlags: {
      "--exec": "yt-dlp may not run other programs.",
      "--exec-before-download": "yt-dlp may not run other programs.",
      "--postprocessor-args": "yt-dlp post-processors are not allowed.",
      "--downloader": "External downloaders are not allowed.",
      "--external-downloader": "External downloaders are not allowed.",
      "--config-location": "yt-dlp config files are not allowed.",
      "--config-locations": "yt-dlp config files are not allowed.",
      "-a": "Batch files are not allowed.",
      "--batch-file": "Batch files are not allowed.",
      "--cookies": "Reading cookie files is not allowed.",
      "--cookies-from-browser": "Reading browser cookies is not allowed.",
      "--load-info-json": "Loading info JSON from disk is not allowed.",
    },
    pathFlags: ["-o", "--output", "--paths", "-P"],
    check: (args) =>
      args.some((arg) =>
        [
          "--skip-download",
          "--dump-json",
          "-j",
          "-J",
          "--dump-single-json",
          "--print",
          "--list-subs",
          "--flat-playlist",
          "--get-url",
        ].includes(arg),
      )
        ? null
        : "yt-dlp must run in a metadata/subtitle mode (--skip-download, --dump-json, --print, or --list-subs).",
  },

  gh: {
    verbs: [
      "search",
      "api",
      "repo",
      "issue",
      "pr",
      "run",
      "workflow",
      "release",
      "label",
      "gist",
      "auth",
    ],
    bannedFlags: {
      "-X": "Only GET requests are allowed through gh api.",
      "--method": "Only GET requests are allowed through gh api.",
      "-f": "Sending fields would make this a write request.",
      "-F": "Sending fields would make this a write request.",
      "--field": "Sending fields would make this a write request.",
      "--raw-field": "Sending fields would make this a write request.",
      "--input": "Sending a request body is not allowed.",
    },
    check: (_args, positional) => {
      const [verb, sub] = positional;
      // gh's second word decides read vs. write for every namespaced command.
      const readOnly: Record<string, string[]> = {
        repo: ["view", "list"],
        issue: ["list", "view", "status"],
        pr: ["list", "view", "checks", "diff", "status"],
        run: ["list", "view"],
        workflow: ["list", "view"],
        release: ["list", "view"],
        label: ["list"],
        gist: ["list", "view"],
        auth: ["status"],
      };
      const allowed = readOnly[verb ?? ""];
      if (!allowed) return null;
      return allowed.includes(sub ?? "")
        ? null
        : `gh ${verb} ${sub ?? ""} is not a read-only command. ${READ_ONLY_NOTE}`;
    },
  },

  // MCP calls (Exa search, LinkedIn, xiaohongshu-mcp). Config edits are the
  // user's decision, not a run's.
  mcporter: {
    verbs: ["call", "list", "tools", "config"],
    check: (_args, positional) =>
      positional[0] === "config" && positional[1] !== "list"
        ? "mcporter config may only be listed, not changed."
        : null,
  },

  twitter: {
    verbs: ["feed", "tweet", "article", "user", "user-posts", "search", "likes", "status"],
  },

  bili: {
    verbs: ["video", "search", "hot", "rank", "audio", "subtitle", "user", "info"],
  },

  // OpenCLI is `opencli <site> <verb>`, so the verb policy applies one position
  // later than everywhere else.
  opencli: {
    siteFirst: true,
    verbs: [
      "search",
      "read",
      "note",
      "comments",
      "feed",
      "user",
      "profile",
      "subreddit",
      "subreddit-info",
      "hot",
      "popular",
      "explore",
      "saved",
      "groups",
      "video",
      "subtitle",
      "doctor",
      "status",
    ],
  },

  rdt: {
    verbs: ["search", "read", "sub", "popular", "all", "status"],
  },

  xhs: {
    verbs: ["search", "read", "comments", "hot", "feed", "user", "user-posts"],
  },
};

export const ALLOWED_EXECUTABLES = Object.keys(POLICIES);

// ---- workspace path confinement ---------------------------------------------

const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";

/**
 * Force a path argument inside the run workspace. The published recipes write to
 * `/tmp/...`; rather than refuse them, rewrite them — the run then behaves the
 * same on Windows, and nothing it writes can escape its own directory.
 */
export function confinePath(value: string, workspace: string): string | null {
  if (/^(\/dev\/null|NUL)$/i.test(value)) return NULL_DEVICE;
  const base = path.resolve(workspace);
  // A path already inside the workspace is taken as-is. Commands echo their
  // rewritten absolute output path back to the model, so this is the form it
  // naturally uses to read a file it just wrote.
  if (path.isAbsolute(value)) {
    const absolute = path.resolve(value);
    if (absolute === base || absolute.startsWith(`${base}${path.sep}`)) return absolute;
  }
  // Keep yt-dlp/curl output templates (%(id)s etc.) intact while relocating them.
  const stripped = value
    .replace(/^\/tmp\//i, "")
    .replace(/^~\/?/, "")
    .replace(/^[A-Za-z]:[\\/]/, "");
  const relative = stripped.replace(/^[\\/]+/, "");
  if (!relative) return null;
  const resolved = path.resolve(workspace, relative);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) return null;
  return resolved;
}

// ---- parsing ----------------------------------------------------------------

/**
 * Turn one model-proposed command line into a bounded argv, or explain why it
 * was refused. The explanation is fed back as the tool result so the model can
 * correct itself instead of silently retrying.
 */
export function parseCommand(raw: string, workspace: string): CommandDecision {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "No command was provided." };
  if (trimmed.length > 8_000) return { ok: false, reason: "That command is too long." };
  if (/[\r\n]/.test(trimmed)) {
    return { ok: false, reason: "Run one single-line command per tool call." };
  }

  const tokens = tokenize(trimmed);
  if (!tokens.length) return { ok: false, reason: "No command was provided." };
  for (const token of tokens) {
    if (token.quoted) continue;
    if (CHAINING_TOKENS.has(token.value)) {
      return {
        ok: false,
        reason: "Chaining and redirection are not available. Run one command per tool call.",
      };
    }
    if (token.value.includes("$(") || token.value.includes("`")) {
      return { ok: false, reason: "Command substitution is not available." };
    }
  }

  const executable = tokens[0].value.replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
  const policy = POLICIES[executable];
  if (!policy) {
    return {
      ok: false,
      reason: `${tokens[0].value} is not one of the tools Agent Reach routes to. Available: ${ALLOWED_EXECUTABLES.join(", ")}.`,
    };
  }

  const rest = tokens.slice(1);
  if (rest.length > MAX_ARGS) return { ok: false, reason: "That command has too many arguments." };
  if (rest.some((token) => token.value.length > MAX_ARG_LENGTH)) {
    return { ok: false, reason: "One of those arguments is too long." };
  }

  const positional = rest.filter((token) => !token.value.startsWith("-")).map((token) => token.value);
  if (policy.verbs?.length) {
    const verbIndex = policy.siteFirst ? 1 : 0;
    const verb = positional[verbIndex];
    if (!verb) {
      return {
        ok: false,
        reason: `${executable} needs one of these commands: ${policy.verbs.join(", ")}.`,
      };
    }
    if (!policy.verbs.includes(verb.toLowerCase())) {
      return {
        ok: false,
        reason: `${executable} ${verb} is not available here. Allowed: ${policy.verbs.join(", ")}. ${READ_ONLY_NOTE}`,
      };
    }
  }

  const args: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const flag = token.value;
    const banned = policy.bannedFlags?.[flag] ?? policy.bannedFlags?.[flag.split("=")[0]];
    if (banned && !token.quoted) return { ok: false, reason: banned };

    if (policy.pathFlags?.includes(flag)) {
      const next = rest[index + 1];
      if (!next) return { ok: false, reason: `${flag} needs a path.` };
      const confined = confinePath(next.value, workspace);
      if (!confined) return { ok: false, reason: `${flag} must name a file this run may write.` };
      args.push(flag, confined);
      index += 1;
      continue;
    }
    args.push(flag);
  }

  const failure = policy.check?.(args, positional);
  if (failure) return { ok: false, reason: failure };

  return {
    ok: true,
    command: {
      executable,
      args,
      display: [executable, ...args].join(" ").slice(0, 400),
    },
  };
}
