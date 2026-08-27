const MAX_ARGUMENTS = 24;
const MAX_ARGUMENT_LENGTH = 8_192;
const MAX_ARGUMENT_BYTES = 32 * 1024;

const ALLOWED_COMMANDS: Readonly<Record<string, ReadonlySet<string> | null>> = {
  chat: new Set(["route", "route-hint", "interact"]),
  recommend: null,
  quickstart: null,
  doctor: null,
  probe: null,
  list: null,
  snippet: null,
  harness: new Set(["list", "inspect", "validate"]),
  cases: new Set(["list", "inspect", "recommend", "readiness", "validate"]),
  profile: new Set(["list", "inspect"]),
  playbook: new Set(["list", "inspect", "recommend"]),
  docs: new Set(["workflows", "roles", "capability-families", "skill-context-cost"]),
  "skill-profile": new Set(["status"]),
  "capability-policy": new Set(["status"]),
};

const DENIED_FLAGS = new Set([
  "--omh-home",
  "--hermes-home",
  "--scope",
  "--output",
  "-o",
  "--write",
  "--apply",
  "--reconcile",
  "--force",
  "--yes",
  "--live",
  "--install-path",
  "--target-confirmed",
]);

export class OmhServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OmhServiceError";
    this.code = code;
  }
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Validate the exact read-only public OMH command without process authority. */
export function validateOmhArguments(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ARGUMENTS) {
    throw new OmhServiceError(
      "omh_invalid_arguments",
      `OMH requires between 1 and ${MAX_ARGUMENTS} command arguments.`,
    );
  }
  const args = input.map((value) => {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > MAX_ARGUMENT_LENGTH ||
      hasControlCharacters(value)
    ) {
      throw new OmhServiceError(
        "omh_invalid_arguments",
        "OMH arguments must be non-empty, bounded, single-line strings.",
      );
    }
    return value;
  });
  const totalBytes = args.reduce(
    (sum, value) => sum + Buffer.byteLength(value, "utf8"),
    0,
  );
  if (totalBytes > MAX_ARGUMENT_BYTES) {
    throw new OmhServiceError(
      "omh_invalid_arguments",
      "OMH command arguments exceed the size limit.",
    );
  }

  const subcommands = ALLOWED_COMMANDS[args[0]];
  if (subcommands === undefined) {
    throw new OmhServiceError(
      "omh_command_denied",
      "That OMH command is not available in Breadboard. Only read-only routing, recommendation, catalog and health commands are offered.",
    );
  }
  if (subcommands && (args.length < 2 || !subcommands.has(args[1]))) {
    throw new OmhServiceError(
      "omh_command_denied",
      "That OMH subcommand is not available in Breadboard.",
    );
  }
  const deniedFlag = args.find((value) =>
    [...DENIED_FLAGS].some((flag) =>
      value === flag ||
      (flag.startsWith("--") && value.startsWith(`${flag}=`)) ||
      (flag === "-o" && value.startsWith("-o="))
    )
  );
  if (deniedFlag) {
    throw new OmhServiceError(
      "omh_flag_denied",
      `${deniedFlag} is not available through Breadboard's oh-my-hermes skill.`,
    );
  }
  return args;
}
