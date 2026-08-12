import { tool } from "@opencode-ai/plugin"

type Args = Record<string, unknown>

async function call(
  sessionID: string,
  toolCallId: string | undefined,
  action: string,
  args: Args,
) {
  const dashboardUrl =
    process.env.BREADBOARD_INTERNAL_URL || "http://127.0.0.1:3000"
  const serviceSecret =
    process.env.HERMES_TOOL_SECRET ||
    process.env.HERMES_PASSWORD ||
    "breadboard-local-dev"
  const response = await fetch(
    new URL("/api/hermes/tools/artifacts", dashboardUrl),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceSecret}`,
        "X-Hermes-Session-ID": sessionID,
      },
      body: JSON.stringify({ action, args, toolCallId }),
    },
  )
  const data = await response
    .json()
    .catch(() => ({ ok: false, error: "Invalid interactive visualizer response" }))
  if (!response.ok || data.ok === false) {
    return {
      title: `${action} failed`,
      output: JSON.stringify(data),
    }
  }
  return { title: action, output: JSON.stringify(data.data) }
}

const planSchema = tool.schema.object({
  schemaVersion: tool.schema.literal(1),
  title: tool.schema.string(),
  objective: tool.schema.string(),
  audience: tool.schema.string().optional(),
  mode: tool.schema.enum(["2d", "3d", "hybrid"]),
  rationale: tool.schema.string(),
  concepts: tool.schema.array(tool.schema.string()),
  assumptions: tool.schema.array(tool.schema.string()),
  controls: tool.schema.array(tool.schema.object({
    id: tool.schema.string(),
    label: tool.schema.string(),
    type: tool.schema.enum(["range", "number", "select", "toggle", "button"]),
    purpose: tool.schema.string(),
    initialValue: tool.schema.union([
      tool.schema.string(),
      tool.schema.number(),
      tool.schema.boolean(),
    ]).optional(),
    minimum: tool.schema.number().optional(),
    maximum: tool.schema.number().optional(),
    step: tool.schema.number().optional(),
    unit: tool.schema.string().optional(),
  })),
  outputs: tool.schema.array(tool.schema.object({
    id: tool.schema.string(),
    label: tool.schema.string(),
    unit: tool.schema.string().optional(),
    purpose: tool.schema.string(),
  })),
  interactions: tool.schema.array(tool.schema.string()),
  animation: tool.schema.object({
    enabled: tool.schema.boolean(),
    canPause: tool.schema.boolean(),
    canReset: tool.schema.boolean(),
    canStep: tool.schema.boolean().optional(),
    speedControl: tool.schema.boolean().optional(),
  }).optional(),
  dataRequirements: tool.schema.array(tool.schema.string()),
  assetRequirements: tool.schema.array(tool.schema.string()),
  accessibilityRequirements: tool.schema.array(tool.schema.string()),
  sourceReferences: tool.schema.array(tool.schema.string()),
})

const packageSchema = tool.schema.object({
  schemaVersion: tool.schema.literal(1),
  manifest: tool.schema.object({
    schemaVersion: tool.schema.literal(1),
    artifactType: tool.schema.literal("interactive-visualizer"),
    title: tool.schema.string(),
    description: tool.schema.string(),
    accessibilityDescription: tool.schema.string(),
    mode: tool.schema.enum(["2d", "3d", "hybrid"]),
    entry: tool.schema.literal("index.html"),
    runtime: tool.schema.object({
      id: tool.schema.literal("breadboard-interactive-visualizer"),
      version: tool.schema.literal("1.0.0"),
      threeVersion: tool.schema.string().optional(),
    }),
  }),
  assumptions: tool.schema.array(tool.schema.string()),
  limitations: tool.schema.array(tool.schema.string()),
  sourceReferences: tool.schema.array(tool.schema.object({
    label: tool.schema.string(),
    url: tool.schema.string().optional(),
    gardenSlug: tool.schema.string().optional(),
  })),
  semanticTests: tool.schema.array(tool.schema.object({
    name: tool.schema.string(),
    assertion: tool.schema.string(),
  })),
  assets: tool.schema.array(tool.schema.never()),
  files: tool.schema.object({
    "index.html": tool.schema.string(),
    "styles.css": tool.schema.string(),
    "main.ts": tool.schema.string(),
  }),
})

const customPackageSchema = tool.schema.object({
  schemaVersion: tool.schema.literal(2),
  manifest: tool.schema.object({
    schemaVersion: tool.schema.literal(2),
    artifactType: tool.schema.literal("interactive-visualizer"),
    title: tool.schema.string(),
    description: tool.schema.string(),
    accessibilityDescription: tool.schema.string(),
    mode: tool.schema.enum(["2d", "3d", "hybrid"]),
    entry: tool.schema.literal("index.html"),
    runtime: tool.schema.object({
      id: tool.schema.literal("breadboard-interactive-visualizer"),
      version: tool.schema.literal("2.0.0"),
      threeVersion: tool.schema.string().optional(),
    }),
  }),
  assumptions: tool.schema.array(tool.schema.string()),
  limitations: tool.schema.array(tool.schema.string()),
  sourceReferences: tool.schema.array(tool.schema.object({
    label: tool.schema.string(),
    url: tool.schema.string().optional(),
    gardenSlug: tool.schema.string().optional(),
  })),
  semanticTests: tool.schema.array(tool.schema.object({
    name: tool.schema.string(),
    assertion: tool.schema.string(),
  })),
  assets: tool.schema.array(tool.schema.never()),
  files: tool.schema.object({
    "index.html": tool.schema.string(),
    "styles.css": tool.schema.string(),
    "main.js": tool.schema.string(),
  }),
})

export const create = tool({
  description:
    "Create, validate, browser-test, and publish one prompt-specific interactive visualization in a single pass. Generate a bespoke flat in-chat interface with native controls and Canvas, SVG, or supplied Three.js; do not use a generic dashboard or terminal. The package is sandboxed and network-free.",
  args: {
    title: tool.schema.string(),
    plan: planSchema,
    package: customPackageSchema,
  },
  async execute(args, ctx) {
    return call(
      ctx.sessionID,
      (ctx as { callID?: string }).callID,
      "interactive_visualizer_create",
      args,
    )
  },
})

export const plan = tool({
  description:
    "Create the persistent plan record for a new conversation-scoped interactive mini-app. Call this before generating source. Use 3d only when spatial depth materially helps; otherwise use 2d.",
  args: {
    title: tool.schema.string(),
    plan: planSchema,
  },
  async execute(args, ctx) {
    return call(
      ctx.sessionID,
      (ctx as { callID?: string }).callID,
      "interactive_visualizer_plan",
      args,
    )
  },
})

export const generate = tool({
  description:
    "Publish a previously planned visualizer. Prefer schema 2: a bespoke, flat, network-free index.html/styles.css/main.js mini-app. Schema 1 declarative packages remain accepted only for compatibility. The server validates, bundles, browser-tests, and publishes atomically.",
  args: {
    artifactId: tool.schema.string(),
    package: tool.schema.union([packageSchema, customPackageSchema]),
  },
  async execute(args, ctx) {
    return call(
      ctx.sessionID,
      (ctx as { callID?: string }).callID,
      "interactive_visualizer_generate",
      args,
    )
  },
})

export const revise = tool({
  description:
    "Create a validated complete replacement of an existing interactive visualizer. Prefer a schema-2 prompt-specific mini-app. A failed revision never replaces the last working version; reuse the artifact id.",
  args: {
    artifactId: tool.schema.string(),
    revisionPrompt: tool.schema.string(),
    package: tool.schema.union([packageSchema, customPackageSchema]),
  },
  async execute(args, ctx) {
    return call(
      ctx.sessionID,
      (ctx as { callID?: string }).callID,
      "interactive_visualizer_revise",
      args,
    )
  },
})

export const rollback = tool({
  description:
    "Restore a previously validated interactive visualizer version without deleting later history.",
  args: {
    artifactId: tool.schema.string(),
    version: tool.schema.number(),
  },
  async execute(args, ctx) {
    return call(
      ctx.sessionID,
      (ctx as { callID?: string }).callID,
      "interactive_visualizer_rollback",
      args,
    )
  },
})

export const cancel = tool({
  description:
    "Cancel active interactive visualizer browser work and preserve any previously ready revision.",
  args: {
    artifactId: tool.schema.string(),
  },
  async execute(args, ctx) {
    return call(
      ctx.sessionID,
      (ctx as { callID?: string }).callID,
      "interactive_visualizer_cancel",
      args,
    )
  },
})
