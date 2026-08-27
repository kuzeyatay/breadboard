const MAX_ARGUMENTS = 40;
const MAX_ARGUMENT_LENGTH = 8_192;
const MAX_ARGUMENT_BYTES = 32 * 1024;

const ALLOWED_COMMANDS: Readonly<Record<string, ReadonlySet<string> | null>> = {
  "agent-start": null,
  "agent-end": null,
  status: null,
  init: null,
  project: new Set(["update"]),
  persona: new Set(["add", "list", "show", "edit", "rename"]),
  reason: new Set(["add", "list", "show", "edit"]),
  graph: new Set(["add-node", "add-edge", "list", "show", "export"]),
  score: new Set(["set", "list", "show"]),
  mitigate: new Set(["add", "list", "show", "edit"]),
  workflow: new Set([
    "validate",
    "checklist",
    "guide",
    "phase",
    "next",
    "artifacts",
  ]),
  report: new Set(["context", "generate", "html"]),
};

const DENIED_FLAGS = new Set([
  "--force",
  "--confirm",
  "--project-dir",
  "--output",
  "-o",
  "--from",
  "--human",
  "--quiet",
  "--replace",
]);

export class PremortemServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PremortemServiceError";
    this.code = code;
  }
}

/** Validate the public command without importing any process authority. */
export function validatePremortemArguments(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ARGUMENTS) {
    throw new PremortemServiceError(
      "premortem_invalid_arguments",
      `Premortem requires between 1 and ${MAX_ARGUMENTS} command arguments.`,
    );
  }
  const args = input.map((value) => {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > MAX_ARGUMENT_LENGTH ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
      /[\r\n]/.test(value)
    ) {
      throw new PremortemServiceError(
        "premortem_invalid_arguments",
        "Premortem arguments must be non-empty, bounded, single-line strings.",
      );
    }
    return value;
  });
  if (Buffer.byteLength(args.join("\u0000"), "utf8") > MAX_ARGUMENT_BYTES) {
    throw new PremortemServiceError(
      "premortem_invalid_arguments",
      "Premortem command arguments exceed the size limit.",
    );
  }

  const subcommands = ALLOWED_COMMANDS[args[0]];
  if (subcommands === undefined) {
    throw new PremortemServiceError(
      "premortem_command_denied",
      "That Premortem command is not available in Breadboard.",
    );
  }
  if (subcommands && (args.length < 2 || !subcommands.has(args[1]))) {
    throw new PremortemServiceError(
      "premortem_command_denied",
      "That Premortem subcommand is not available in Breadboard.",
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
    throw new PremortemServiceError(
      "premortem_flag_denied",
      `${deniedFlag} is not available through Breadboard's Premortem skill.`,
    );
  }
  return args;
}
