const MAX_ARGUMENTS = 12;
const MAX_ARGUMENT_LENGTH = 512;
const MAX_PATH_ARGUMENTS = 6;

interface CommandContract {
  paths: { min: number; max: number };
  booleanFlags?: readonly string[];
  valueFlags?: Readonly<Record<string, "path" | "score">>;
  requiredFlags?: readonly string[];
}

const ALLOWED_COMMANDS: Readonly<Record<string, CommandContract>> = {
  init: { paths: { min: 1, max: 1 }, booleanFlags: ["--force"] },
  validate: { paths: { min: 1, max: MAX_PATH_ARGUMENTS }, booleanFlags: ["--json"] },
  score: { paths: { min: 1, max: MAX_PATH_ARGUMENTS }, booleanFlags: ["--json"] },
  evaluate: { paths: { min: 1, max: MAX_PATH_ARGUMENTS }, booleanFlags: ["--json"] },
  "dry-run": {
    paths: { min: 1, max: 1 },
    booleanFlags: ["--json"],
    valueFlags: { "--out": "path", "--min-score": "score" },
    requiredFlags: ["--out"],
  },
  "render-receipt": { paths: { min: 1, max: 1 } },
  "privacy-scan": { paths: { min: 0, max: 1 }, booleanFlags: ["--json"] },
};

export const AGENT_LOOP_COMMANDS = Object.freeze(Object.keys(ALLOWED_COMMANDS));

export class AgentLoopServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AgentLoopServiceError";
    this.code = code;
  }
}

function assertPlainArgument(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > MAX_ARGUMENT_LENGTH ||
    value.split("").some((character) =>
      character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f
    )
  ) {
    throw new AgentLoopServiceError(
      "agent_loop_invalid_arguments",
      "Loop kit arguments must be non-empty, bounded, single-line strings.",
    );
  }
  return value;
}

/** Reject path syntax which could escape before any filesystem access occurs. */
export function lexicalAgentLoopWorkspacePath(value: string): string {
  const candidate = value.replace(/\\/g, "/").trim();
  if (
    !candidate ||
    candidate.startsWith("/") ||
    candidate.startsWith("~") ||
    /^[A-Za-z]:/u.test(candidate) ||
    candidate.split("/").some((segment) => segment === "..")
  ) {
    throw new AgentLoopServiceError(
      "agent_loop_path_denied",
      `Loop kit paths must stay inside this conversation's workspace: ${value}`,
    );
  }
  const normalized = candidate.replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
  return normalized || ".";
}

/**
 * Validate the complete public command against one exact allowlist. A worker
 * supplies a realpath-aware resolver so the same parser also rejects symlinks.
 */
export function validateAgentLoopRequestArguments(
  input: unknown,
  resolvePath: (value: string) => string = lexicalAgentLoopWorkspacePath,
): { command: string; args: string[] } {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ARGUMENTS) {
    throw new AgentLoopServiceError(
      "agent_loop_invalid_arguments",
      `The loop kit accepts between 1 and ${MAX_ARGUMENTS} arguments.`,
    );
  }
  const raw = input.map(assertPlainArgument);
  const command = raw[0];
  const contract = ALLOWED_COMMANDS[command];
  if (!contract) {
    throw new AgentLoopServiceError(
      "agent_loop_command_denied",
      `"${command}" is not available. Use one of: ${AGENT_LOOP_COMMANDS.join(", ")}.`,
    );
  }

  const args: string[] = [command];
  const seenFlags = new Set<string>();
  const paths: string[] = [];
  for (let index = 1; index < raw.length; index += 1) {
    const token = raw[index];
    if (!token.startsWith("-")) {
      paths.push(resolvePath(token));
      continue;
    }
    const separator = token.indexOf("=");
    const name = separator > 0 ? token.slice(0, separator) : token;
    const inlineValue = separator > 0 ? token.slice(separator + 1) : null;
    if (contract.booleanFlags?.includes(name)) {
      if (inlineValue !== null) {
        throw new AgentLoopServiceError(
          "agent_loop_flag_denied",
          `${name} does not take a value.`,
        );
      }
      if (!seenFlags.has(name)) {
        seenFlags.add(name);
        args.push(name);
      }
      continue;
    }
    const valueKind = contract.valueFlags?.[name];
    if (!valueKind) {
      throw new AgentLoopServiceError(
        "agent_loop_flag_denied",
        `${name} is not available through Breadboard's loop kit tool.`,
      );
    }
    if (seenFlags.has(name)) {
      throw new AgentLoopServiceError(
        "agent_loop_flag_denied",
        `${name} was supplied more than once.`,
      );
    }
    const value = inlineValue ?? raw[index + 1];
    if (inlineValue === null) index += 1;
    if (typeof value !== "string" || !value.trim()) {
      throw new AgentLoopServiceError(
        "agent_loop_flag_denied",
        `${name} requires a value.`,
      );
    }
    seenFlags.add(name);
    if (valueKind === "score") {
      if (!/^\d{1,3}$/u.test(value) || Number(value) > 100) {
        throw new AgentLoopServiceError(
          "agent_loop_flag_denied",
          "--min-score must be an integer between 0 and 100.",
        );
      }
      args.push(name, value);
      continue;
    }
    args.push(name, resolvePath(value));
  }

  for (const required of contract.requiredFlags ?? []) {
    if (!seenFlags.has(required)) {
      throw new AgentLoopServiceError(
        "agent_loop_invalid_arguments",
        `${command} requires ${required}.`,
      );
    }
  }
  if (paths.length < contract.paths.min || paths.length > contract.paths.max) {
    throw new AgentLoopServiceError(
      "agent_loop_invalid_arguments",
      contract.paths.max === contract.paths.min
        ? `${command} takes exactly ${contract.paths.min} workspace path(s).`
        : `${command} takes between ${contract.paths.min} and ${contract.paths.max} workspace paths.`,
    );
  }
  return { command, args: [...args, ...paths] };
}
