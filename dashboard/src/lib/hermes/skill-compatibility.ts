import yaml from "js-yaml";
import type { HermesSurface } from "./config.ts";
import { availableArtifactRenderers } from "./artifact-renderers.ts";
import { allowedToolsForSurface } from "./tool-scopes.ts";
import type { SkillEligibility } from "./skills.ts";

export type SkillAvailability =
  | "ready"
  | "unavailable"
  | "incompatible"
  | "needs_review";

export interface SkillEnvironmentVariable {
  name: string;
  required: boolean;
  description?: string;
}

export interface SkillCapabilityContract {
  category?: string;
  surfaces: HermesSurface[];
  requiredTools: string[];
  requiredArtifactKinds: string[];
  requiredRuntimes: string[];
  requiredMcpServers: string[];
  optionalMcpServers: string[];
  requiredEnvironmentVariables: SkillEnvironmentVariable[];
  requiredBinaries: string[];
  compatibilityNotes: string[];
  allowedToolHints: string[];
}

export type SkillRequirementStatus =
  | "satisfied"
  | "action_required"
  | "unsupported"
  | "information";

export type SkillRequirementAction =
  | "connect_mcp"
  | "use_opencode"
  | "connect_repository"
  | "configure_environment"
  | "review_skill";

export interface SkillRequirement {
  id: string;
  type:
    | "surface"
    | "tool"
    | "artifact"
    | "runtime"
    | "mcp"
    | "environment"
    | "dependency"
    | "compatibility"
    | "review";
  label: string;
  detail?: string;
  required: boolean;
  status: SkillRequirementStatus;
  action?: SkillRequirementAction;
  target?: string;
}

export interface SkillCompatibility {
  availability: SkillAvailability;
  reasons: string[];
  contract: SkillCapabilityContract | null;
  requirements: SkillRequirement[];
}

const SURFACE_ALIASES: Record<string, HermesSurface> = {
  assistant: "dashboard_terminal",
  dashboard_terminal: "dashboard_terminal",
  interactive_terminal: "dashboard_terminal",
  terminal: "dashboard_terminal",
  garden: "garden_chat",
  garden_chat: "garden_chat",
  quartz: "quartz_ai",
  quartz_ai: "quartz_ai",
};

const RUNTIME_ALIASES: Record<string, string> = {
  "text-renderer": "text",
  "markdown-renderer": "markdown",
  "docx-renderer": "docx",
  // `artifactExecutionContract` derives runtime names from the inferred
  // artifact kind, and the kind for a Word document is `document` while its
  // renderer id is `docx`. Without this row every skill that produces Word
  // documents resolved to unavailable; it is the only inferable kind whose
  // `<kind>-renderer` name did not already have an entry here.
  "document-renderer": "docx",
  "pdf-renderer": "pdf",
  "html-renderer": "html",
  "code-renderer": "code",
  "data-renderer": "json",
  "presentation-renderer": "presentation-file",
  "spreadsheet-renderer": "spreadsheet-file",
  "image-renderer": "image-file",
  "audio-renderer": "audio-file",
  "video-renderer": "video-file",
  "manim-runtime": "video-file",
  "diagram-renderer": "diagram-file",
  "interactive-visualizer-runtime": "interactive-visualizer",
  "gadget-runtime": "gadget",
  // A reconstructed mesh is imported by the tool that produced it, verified
  // against the `model` kind's glTF signature on the way in. `model-renderer`
  // is spelled out too because that is the name `artifactExecutionContract`
  // derives for a skill that only declares the kind.
  "image-to-3d-runtime": "model-file",
  "model-renderer": "model-file",
};

/**
 * The tools that constitute a production path for each dedicated runtime.
 *
 * A dedicated runtime's renderer refuses raw content on purpose, so a skill
 * using one cannot satisfy the generic artifact_create/artifact_render path and
 * must name its own publisher instead.
 */
const RUNTIME_PUBLICATION_TOOLS: Record<string, readonly string[]> = {
  "interactive-visualizer-runtime": ["interactive_visualizer_create"],
  "gadget-runtime": ["gadget_generate"],
  "manim-runtime": ["manim_create"],
  // `image_to_3d` files its own mesh: the bytes are staged and imported
  // server-side, so there is nothing for `artifact_create`/`artifact_render` to
  // do and no raw model output that could bypass the import verification.
  "image-to-3d-runtime": ["image_to_3d"],
};

const OPENCODE_RUNTIME = "opencode";
const DEFAULT_SURFACES: HermesSurface[] = [
  "garden_chat",
  "dashboard_terminal",
];
const IMPORT_ARTIFACT_KINDS = new Set([
  "audio",
  "image",
  "presentation",
  "spreadsheet",
  "video",
]);

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function unique(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))];
}

function normalizeList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const source =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : trimmed;
  return source
    .split(",")
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") {
    if (value.includes(",")) return normalizeList(value);
    return value
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    typeof entry === "string" ? [entry.trim()] : [],
  ).filter(Boolean);
}

function noteList(value: unknown): string[] {
  if (typeof value === "string") {
    const note = value.trim();
    return note ? [note] : [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    typeof entry === "string" && entry.trim() ? [entry.trim()] : [],
  );
}

function frontmatter(markdown: string): UnknownRecord {
  const source =
    markdown.match(/^---\s*[\r\n]([\s\S]*?)[\r\n]---(?:\s*[\r\n]|$)/)?.[1] ??
    "";
  if (!source) return {};
  try {
    return (
      record(
        yaml.load(source, {
          schema: yaml.JSON_SCHEMA,
          json: true,
        }),
      ) ?? {}
    );
  } catch {
    // Some otherwise valid public skills leave a colon in an unquoted
    // top-level description. Retry after quoting only plain top-level scalar
    // values; nested metadata and block/list syntax remain untouched.
    const repaired = source
      .split(/\r?\n/)
      .map((line) => {
        const scalar = line.match(
          /^([A-Za-z][A-Za-z0-9_-]*):[ \t]+(.+)$/,
        );
        if (!scalar) return line;
        const value = scalar[2].trim();
        if (
          !value ||
          ["{", "[", ">", "|", "'", '"'].some((prefix) =>
            value.startsWith(prefix),
          )
        ) {
          return line;
        }
        return `${scalar[1]}: ${JSON.stringify(value)}`;
      })
      .join("\n");
    try {
      return (
        record(
          yaml.load(repaired, {
            schema: yaml.JSON_SCHEMA,
            json: true,
          }),
        ) ?? {}
      );
    } catch {
      return {};
    }
  }
}

function environmentVariables(value: unknown): SkillEnvironmentVariable[] {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  const variables = entries.flatMap((entry): SkillEnvironmentVariable[] => {
    if (typeof entry === "string") {
      const name = entry.trim();
      return /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)
        ? [{ name, required: true }]
        : [];
    }
    const item = record(entry);
    if (!item) return [];
    const nameValue = item.name ?? item.key ?? item.variable;
    const name = typeof nameValue === "string" ? nameValue.trim() : "";
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) return [];
    const description =
      typeof item.description === "string"
        ? item.description.trim().slice(0, 500)
        : typeof item.help === "string"
          ? item.help.trim().slice(0, 500)
          : undefined;
    return [
      {
        name,
        required:
          typeof item.required === "boolean"
            ? item.required
            : item.optional === true ||
                (typeof item.required_for === "string" &&
                  /\boptional\b/i.test(item.required_for))
              ? false
              : true,
        ...(description ? { description } : {}),
      },
    ];
  });
  const byName = new Map<string, SkillEnvironmentVariable>();
  for (const variable of variables) {
    const current = byName.get(variable.name);
    byName.set(variable.name, {
      name: variable.name,
      required: variable.required,
      description: variable.description ?? current?.description,
    });
  }
  return [...byName.values()];
}

function manifestRequirements(markdown: string): Pick<
  SkillCapabilityContract,
  | "requiredEnvironmentVariables"
  | "requiredBinaries"
  | "requiredMcpServers"
  | "optionalMcpServers"
  | "compatibilityNotes"
  | "allowedToolHints"
> {
  const metadata = frontmatter(markdown);
  const openclaw = record(record(metadata.metadata)?.openclaw);
  const requires = record(openclaw?.requires);
  const compatibilityNotes = [
    ...noteList(metadata.compatibility),
    ...noteList(openclaw?.compatibility),
  ];
  const inferredRequiredMcpServers = compatibilityNotes.flatMap((note) => {
    const match = note.match(
      /\brequires?\s+(?:an?\s+|the\s+)?([a-z][a-z0-9_.-]*)\s+MCP\s+server\b/i,
    );
    return match?.[1] ? [match[1].toLowerCase()] : [];
  });
  const declaredEnvironment = [
    ...environmentVariables(metadata.required_environment_variables),
    ...environmentVariables(openclaw?.envVars),
  ];
  const inferredEnvironment =
    declaredEnvironment.length === 0 &&
    compatibilityNotes.some((note) => /\brequires?\b/i.test(note))
      ? unique(
          markdown.match(
            /\b[A-Z][A-Z0-9_]{1,100}(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|PASSWORD|BASE_URL|SERVER_URL)\b/g,
          ) ?? [],
        ).map((name) => ({
          name,
          required: true,
          description: compatibilityNotes.join(" "),
        }))
      : [];
  const env = [...declaredEnvironment, ...inferredEnvironment];
  const primaryEnv =
    typeof openclaw?.primaryEnv === "string" &&
    !env.some((variable) => variable.name === openclaw.primaryEnv)
      ? [{
          name: openclaw.primaryEnv,
          required: false,
          description: "Primary credential variable named by the publisher.",
        }]
      : [];
  return {
    requiredEnvironmentVariables: environmentVariables([...env, ...primaryEnv]),
    requiredBinaries: unique([
      ...stringList(requires?.bins),
      ...stringList(metadata.required_binaries),
    ]),
    requiredMcpServers: unique([
      ...stringList(metadata.required_mcp_servers),
      ...stringList(requires?.mcp),
      ...inferredRequiredMcpServers,
    ]),
    optionalMcpServers: unique([
      ...stringList(metadata.optional_mcp_servers),
    ]),
    compatibilityNotes: unique(compatibilityNotes),
    allowedToolHints: unique([
      ...stringList(metadata["allowed-tools"]),
      ...stringList(metadata.allowed_tools),
    ]),
  };
}

function emptyMetadataContract(): Pick<
  SkillCapabilityContract,
  | "requiredEnvironmentVariables"
  | "requiredBinaries"
  | "requiredMcpServers"
  | "optionalMcpServers"
  | "compatibilityNotes"
  | "allowedToolHints"
> {
  return {
    requiredEnvironmentVariables: [],
    requiredBinaries: [],
    requiredMcpServers: [],
    optionalMcpServers: [],
    compatibilityNotes: [],
    allowedToolHints: [],
  };
}

/**
 * Read the deliberately small, data-only `breadboard:` capability contract.
 * This is not a general YAML executor. The standard skill frontmatter is
 * parsed separately with js-yaml's JSON-only schema.
 */
export function parseSkillCapabilityContract(
  markdown: string,
): SkillCapabilityContract | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    /^\s*breadboard\s*:\s*$/i.test(line),
  );
  if (start < 0) return null;
  const baseIndent = lines[start].match(/^\s*/)?.[0].length ?? 0;
  const values = new Map<string, string[]>();
  let activeKey: string | null = null;
  for (let index = start + 1; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= baseIndent) break;
    const keyValue = raw
      .trim()
      .match(/^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*)$/);
    if (keyValue) {
      activeKey = keyValue[1].toLowerCase();
      values.set(activeKey, normalizeList(keyValue[2]));
      continue;
    }
    const item = raw.trim().match(/^[-*]\s+(.+)$/)?.[1];
    if (item && activeKey) {
      values.set(activeKey, [
        ...(values.get(activeKey) ?? []),
        item.trim().replace(/^['"]|['"]$/g, ""),
      ]);
    }
  }
  const surfaces = (values.get("surfaces") ?? [])
    .map((surface) => SURFACE_ALIASES[surface.toLowerCase()])
    .filter((surface): surface is HermesSurface => Boolean(surface));
  const standard = manifestRequirements(markdown);
  return {
    category: values.get("category")?.[0],
    surfaces,
    requiredTools: values.get("requiredtools") ?? [],
    requiredArtifactKinds: values.get("requiredartifactkinds") ?? [],
    requiredRuntimes: values.get("requiredruntimes") ?? [],
    ...standard,
    requiredBinaries: unique([
      ...(values.get("requiredbinaries") ?? []),
      ...standard.requiredBinaries,
    ]),
    requiredMcpServers: unique([
      ...(values.get("requiredmcpservers") ?? []),
      ...standard.requiredMcpServers,
    ]),
    optionalMcpServers: unique([
      ...(values.get("optionalmcpservers") ?? []),
      ...standard.optionalMcpServers,
    ]),
  };
}

function productKinds(input: {
  name?: string;
  description?: string;
}): string[] {
  const name = input.name?.toLowerCase().trim() ?? "";
  const description = input.description?.toLowerCase().trim() ?? "";
  const primary = `${name}\n${description}`;
  const outputVerb =
    /\b(create|generate|render|produce|export|build|design|compose|write|make|edit|revise|convert|transform)\w*\b/;
  const exactProductName =
    /^(?:video|audio|image|diagram|presentation|slides?|pptx|spreadsheet|xlsx|pdf|docx|document|report|markdown|html|web[- ]?page|code|data)$/;
  if (!outputVerb.test(primary) && !exactProductName.test(name)) return [];
  const patterns: Array<[string, RegExp]> = [
    ["video", /\b(?:videos?|mp4|webm)\b/],
    ["audio", /\b(?:audio|podcast|voiceover|speech|mp3|wav)\b/],
    ["presentation", /\b(?:presentations?|slide decks?|slides?|pptx|powerpoint)\b/],
    ["spreadsheet", /\b(?:spreadsheets?|workbooks?|xlsx|excel|csv)\b/],
    ["image", /\b(?:images?|illustrations?|graphics?|png|jpe?g|webp)\b/],
    ["diagram", /\b(?:diagrams?|schematics?|flowcharts?|svg)\b/],
    ["html", /\b(?:html|web prototypes?|interactive prototypes?|web pages?)\b/],
    ["pdf", /\bpdfs?\b/],
    ["document", /\b(?:docx|word documents?|document artifacts?)\b/],
    ["code", /\b(?:source code|code files?|scripts?)\b/],
    ["data", /\b(?:json|datasets?|data files?)\b/],
    [
      "markdown",
      /\b(?:reports?|essays?|structured plans?|markdown|summar(?:y|ies)|translations?|flashcards?|quizzes?|study guides?)\b/,
    ],
  ];
  return unique(
    patterns.flatMap(([kind, pattern]) => (pattern.test(primary) ? [kind] : [])),
  );
}

function artifactExecutionContract(kinds: string[]): Pick<
  SkillCapabilityContract,
  "requiredTools" | "requiredArtifactKinds" | "requiredRuntimes"
> {
  const importKinds = kinds.filter((kind) => IMPORT_ARTIFACT_KINDS.has(kind));
  const renderedKinds = kinds.filter((kind) => !IMPORT_ARTIFACT_KINDS.has(kind));
  return {
    requiredTools: unique([
      "artifact_list",
      ...(importKinds.length ? ["artifact_import"] : []),
      ...(renderedKinds.length ? ["artifact_create", "artifact_render"] : []),
    ]),
    requiredArtifactKinds: kinds,
    requiredRuntimes: kinds.map((kind) => `${kind}-renderer`),
  };
}

function mergeContract(
  base: SkillCapabilityContract,
  patch: Partial<SkillCapabilityContract>,
): SkillCapabilityContract {
  return {
    category: patch.category ?? base.category,
    surfaces: patch.surfaces?.length ? patch.surfaces : base.surfaces,
    requiredTools: unique([
      ...base.requiredTools,
      ...(patch.requiredTools ?? []),
    ]),
    requiredArtifactKinds: unique([
      ...base.requiredArtifactKinds,
      ...(patch.requiredArtifactKinds ?? []),
    ]),
    requiredRuntimes: unique([
      ...base.requiredRuntimes,
      ...(patch.requiredRuntimes ?? []),
    ]),
    requiredMcpServers: unique([
      ...base.requiredMcpServers,
      ...(patch.requiredMcpServers ?? []),
    ]),
    optionalMcpServers: unique([
      ...base.optionalMcpServers,
      ...(patch.optionalMcpServers ?? []),
    ]),
    requiredEnvironmentVariables: environmentVariables([
      ...base.requiredEnvironmentVariables,
      ...(patch.requiredEnvironmentVariables ?? []),
    ]),
    requiredBinaries: unique([
      ...base.requiredBinaries,
      ...(patch.requiredBinaries ?? []),
    ]),
    compatibilityNotes: unique([
      ...base.compatibilityNotes,
      ...(patch.compatibilityNotes ?? []),
    ]),
    allowedToolHints: unique([
      ...base.allowedToolHints,
      ...(patch.allowedToolHints ?? []),
    ]),
  };
}

export function normalizeSkillCapabilityContract(input: {
  name?: string;
  description?: string;
  manifest: string;
}): SkillCapabilityContract {
  const declared = parseSkillCapabilityContract(input.manifest);
  const standard = manifestRequirements(input.manifest);
  const inferredKinds = productKinds(input);
  const inferred = artifactExecutionContract(inferredKinds);
  const guidance: SkillCapabilityContract = {
    category: "reviewed-guidance",
    surfaces: DEFAULT_SURFACES,
    requiredTools: [],
    requiredArtifactKinds: [],
    requiredRuntimes: [],
    ...emptyMetadataContract(),
  };
  const base = declared ?? guidance;
  return mergeContract(base, {
    ...standard,
    ...(declared || inferredKinds.length === 0 ? {} : inferred),
  });
}

function requirement(
  value: SkillRequirement,
  requirements: SkillRequirement[],
): void {
  if (!requirements.some((item) => item.id === value.id)) {
    requirements.push(value);
  }
}

export function resolveSkillCompatibility(input: {
  classification: SkillEligibility;
  manifest: string;
  name?: string;
  description?: string;
  surface: HermesSurface;
  connectedMcpServers?: Iterable<string>;
  configuredEnvironmentVariables?: Iterable<string>;
  /** True only for the locally mirrored, immutable K-Dense scientific source. */
  reviewedScientificSource?: boolean;
  /** True only for the locally mirrored, operator-vendored reverse-skill source. */
  reviewedReverseSource?: boolean;
  /**
   * True for any reviewed, operator-vendored local clone. Callers that resolve
   * the source through `local-skills-sources` pass this instead of naming one
   * clone, so a newly vendored pack is trusted without another flag.
   */
  reviewedLocalSource?: boolean;
}): SkillCompatibility {
  // Operator-vendored local clones are trusted the way first-party skills are:
  // their keyword classification (which false-positives on legitimate security
  // and reverse-engineering guidance) does not gate visibility or usability;
  // explicit human review and runtime permissions remain the real controls.
  const reviewedLocalSource =
    input.reviewedScientificSource === true ||
    input.reviewedReverseSource === true ||
    input.reviewedLocalSource === true;
  const conditional =
    input.classification === "eligible_coding_conditional";
  let contract = normalizeSkillCapabilityContract(input);
  if (conditional) {
    contract = mergeContract(contract, {
      category: "opencode-implementation",
      surfaces: ["dashboard_terminal", "garden_chat"],
      requiredRuntimes: [OPENCODE_RUNTIME],
    });
  } else if (reviewedLocalSource && !contract.category) {
    contract = mergeContract(contract, {
      category: input.reviewedScientificSource ? "scientific-guidance" : "reviewed-guidance",
    });
  }

  if (
    input.classification !== "eligible_general" &&
    !conditional &&
    !reviewedLocalSource
  ) {
    return {
      availability: input.classification.startsWith("blocked_")
        ? "incompatible"
        : "needs_review",
      reasons: [
        "The skill has not yet passed Breadboard's eligibility review.",
      ],
      contract,
      requirements: [
        {
          id: "review",
          type: "review",
          label: "Breadboard review",
          detail:
            "Inspect the pinned files, permissions, scripts, and compatibility before installing.",
          required: true,
          status: "action_required",
          action: "review_skill",
        },
      ],
    };
  }

  const reasons: string[] = [];
  const requirements: SkillRequirement[] = [];
  const surfaceAllowed = contract.surfaces.includes(input.surface);
  requirement(
    {
      id: `surface:${input.surface}`,
      type: "surface",
      label:
        input.surface === "garden_chat"
          ? "Garden Chat"
          : input.surface === "quartz_ai"
            ? "Quartz AI"
            : "Terminal",
      detail: surfaceAllowed
        ? "This skill is allowed on the current surface."
        : "This skill is not allowed on the current surface.",
      required: true,
      status: surfaceAllowed ? "satisfied" : "unsupported",
    },
    requirements,
  );
  if (!contract.surfaces.length) {
    reasons.push(
      "The contract declares no recognized Breadboard surface.",
    );
  } else if (!surfaceAllowed) {
    reasons.push(`The skill is not permitted on ${input.surface}.`);
  }

  const surfaceTools = new Set(allowedToolsForSurface(input.surface));
  for (const tool of contract.requiredTools) {
    const available = surfaceTools.has(tool);
    requirement(
      {
        id: `tool:${tool}`,
        type: "tool",
        label: tool.replaceAll("_", " "),
        detail: available
          ? "Breadboard authorizes this tool on the current surface."
          : `This tool is unavailable on ${input.surface}.`,
        required: true,
        status: available ? "satisfied" : "unsupported",
      },
      requirements,
    );
    if (!available) {
      reasons.push(
        `Required tool ${tool} is unavailable on ${input.surface}.`,
      );
    }
  }

  const renderers = availableArtifactRenderers();
  const rendererIds = new Set(
    renderers.map((renderer) => renderer.id),
  );
  const rendererKinds = new Set(
    renderers.map((renderer) => renderer.kind),
  );
  for (const kind of contract.requiredArtifactKinds) {
    const available = rendererKinds.has(kind as never);
    requirement(
      {
        id: `artifact:${kind}`,
        type: "artifact",
        label: `${kindLabel(kind)} artifact`,
        detail: available
          ? IMPORT_ARTIFACT_KINDS.has(kind)
            ? "The finished file will be imported from the authorized workspace and attached to the originating chat."
            : "The finished product will be rendered and attached to the originating chat."
          : "Breadboard has no production renderer or import profile for this output.",
        required: true,
        status: available ? "satisfied" : "unsupported",
      },
      requirements,
    );
    if (!available) {
      reasons.push(`Artifact kind ${kind} has no production renderer.`);
    }
  }
  for (const runtime of contract.requiredRuntimes) {
    if (runtime.toLowerCase() === OPENCODE_RUNTIME) {
      const allowed =
        input.surface === "dashboard_terminal" ||
        input.surface === "garden_chat";
      requirement(
        {
          id: "runtime:opencode",
          type: "runtime",
          label: "OpenCode",
          detail:
            input.surface === "garden_chat"
              ? "Runs in the repository connected to this Garden."
              : "Runs in the repository selected for this Terminal task.",
          required: true,
          status: allowed ? "satisfied" : "unsupported",
          action: allowed ? "use_opencode" : undefined,
        },
        requirements,
      );
      if (!allowed) {
        reasons.push(
          "Software and coding skills require OpenCode in Terminal or a repository-connected Garden.",
        );
      }
      continue;
    }
    const renderer = RUNTIME_ALIASES[runtime.toLowerCase()];
    const available =
      Boolean(renderer) && rendererIds.has(renderer as never);
    requirement(
      {
        id: `runtime:${runtime}`,
        type: "runtime",
        label: runtime.replaceAll("-", " "),
        detail: available
          ? "Production delivery path available."
          : "The required production runtime is unavailable.",
        required: true,
        status: available ? "satisfied" : "unsupported",
      },
      requirements,
    );
    if (!available) {
      reasons.push(`Required runtime ${runtime} is unavailable.`);
    }
  }

  const connected = new Set(
    [...(input.connectedMcpServers ?? [])].map((server) =>
      server.toLowerCase(),
    ),
  );
  for (const server of contract.requiredMcpServers) {
    const isConnected = connected.has(server.toLowerCase());
    requirement(
      {
        id: `mcp:${server}`,
        type: "mcp",
        label: `${server} connection`,
        detail: isConnected
          ? "Connected and enabled for this user."
          : "Add or enable this connection before using the skill.",
        required: true,
        status: isConnected ? "satisfied" : "action_required",
        action: isConnected ? undefined : "connect_mcp",
        target: server,
      },
      requirements,
    );
    if (!isConnected) {
      reasons.push(
        `Required MCP server ${server} is not connected and authorized.`,
      );
    }
  }
  for (const server of contract.optionalMcpServers) {
    const isConnected = connected.has(server.toLowerCase());
    requirement(
      {
        id: `mcp-optional:${server}`,
        type: "mcp",
        label: `${server} connection`,
        detail: isConnected
          ? "Optional connection is enabled."
          : "Optional; connect it to expand this skill.",
        required: false,
        status: isConnected ? "satisfied" : "information",
        action: isConnected ? undefined : "connect_mcp",
        target: server,
      },
      requirements,
    );
  }

  const configuredEnvironment = new Set(
    [
      ...(input.configuredEnvironmentVariables ??
        Object.keys(process.env)),
    ].map((name) => name.toUpperCase()),
  );
  for (const variable of contract.requiredEnvironmentVariables) {
    const configured = configuredEnvironment.has(
      variable.name.toUpperCase(),
    );
    const blocks = variable.required && !configured;
    requirement(
      {
        id: `environment:${variable.name}`,
        type: "environment",
        label: variable.name,
        detail:
          variable.description ??
          (configured
            ? "Configured for the local Breadboard runtime."
            : variable.required
              ? "Configure this environment variable, then refresh compatibility."
              : "Optional environment variable."),
        required: variable.required,
        status: configured
          ? "satisfied"
          : variable.required
            ? "action_required"
            : "information",
        action: configured
          ? undefined
          : "configure_environment",
        target: variable.name,
      },
      requirements,
    );
    if (blocks) {
      reasons.push(
        `Required environment variable ${variable.name} is not configured.`,
      );
    }
  }

  for (const binary of contract.requiredBinaries) {
    requirement(
      {
        id: `dependency:${binary}`,
        type: "dependency",
        label: binary,
        detail:
          "Breadboard will ask OpenCode to verify this dependency inside the authorized workspace; it is never installed silently.",
        required: true,
        status: "information",
        action: "use_opencode",
        target: binary,
      },
      requirements,
    );
  }
  for (const note of contract.compatibilityNotes) {
    const canPrepareLocally =
      /\brequires?\b/i.test(note) &&
      /\b(?:python|node(?:\.js)?|npm|pnpm|yarn|uv|package|sdk|library|toolkit|cli|docker|java|rust|cuda|compiler|libreoffice|imagemagick|latex|matlab|rdkit|pytorch|tensorflow|jax)\b/i.test(
        note,
      );
    requirement(
      {
        id: `compatibility:${note.toLowerCase().replace(/\W+/g, "-").slice(0, 80)}`,
        type: "compatibility",
        label: "Publisher compatibility note",
        detail: note,
        required: false,
        status: "information",
        action: canPrepareLocally ? "use_opencode" : undefined,
        target: canPrepareLocally ? note : undefined,
      },
      requirements,
    );
  }
  for (const tool of contract.allowedToolHints) {
    requirement(
      {
        id: `tool-hint:${tool}`,
        type: "tool",
        label: tool,
        detail:
          "Declared by the publisher. Breadboard's own runtime policy still decides whether it can be used.",
        required: false,
        status: "information",
      },
      requirements,
    );
  }

  const hasExecutionPath =
    conditional ||
    reviewedLocalSource ||
    contract.category === "reviewed-guidance" ||
    contract.category === "scientific-guidance" ||
    contract.requiredTools.length > 0 ||
    contract.requiredRuntimes.length > 0 ||
    contract.requiredMcpServers.length > 0;
  if (!hasExecutionPath) {
    reasons.push(
      "The capability contract does not declare an executable path.",
    );
  }
  if (contract.requiredArtifactKinds.length > 0) {
    const publicationTools = new Set(contract.requiredTools);
    // A skill with a dedicated runtime publishes through that runtime's own
    // tools, not through the generic artifact_create/artifact_render pair —
    // those renderers deliberately refuse raw model output so validation cannot
    // be bypassed. Each dedicated runtime therefore names the tools that
    // constitute its production path.
    const dedicated = contract.requiredRuntimes
      .map((runtime) => RUNTIME_PUBLICATION_TOOLS[runtime.toLowerCase()])
      .find(Boolean);
    const canPublish = dedicated
      ? dedicated.every((tool) => publicationTools.has(tool))
      : publicationTools.has("artifact_import") ||
        (publicationTools.has("artifact_create") &&
          publicationTools.has("artifact_render"));
    if (!canPublish) {
      reasons.push(
        "Artifact-producing skills must declare a production render or import path.",
      );
    }
  }
  return {
    availability: reasons.length ? "unavailable" : "ready",
    reasons: unique(reasons),
    contract,
    requirements,
  };
}

function kindLabel(kind: string): string {
  if (kind === "html") return "Web page";
  if (kind === "document") return "Word document";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
