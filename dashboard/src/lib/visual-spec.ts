/**
 * Breadboard VisualSpec: the typed, data-driven contract between LLM-generated
 * visualization specs and the trusted Quartz renderer.
 *
 * The LLM only ever produces JSON matching this schema. It is validated and
 * sanitized here before anything reaches the page; the renderer builds DOM via
 * createElement/textContent only, so no spec string can ever execute.
 *
 * NOTE: this is a dependency-free mirror of quartz/quartz/util/visualSpec.ts
 * (the canonical copy, which also carries the unit tests) — keep the two in
 * sync.
 */

export const VISUAL_TYPES = [
  "function_plot",
  "linked_time_plots",
  "phase_space",
  "mass_spring",
  "pendulum",
  "energy_exchange",
  "damping_envelope",
  "resonance_curve",
  "travelling_wave",
  "standing_wave",
  "ray_diagram",
  "lif_neuron",
  "neural_coding",
  "stdp_window",
  "tradeoff_explorer",
  "source_figure_explainer",
  "formula_derivation",
  "concept_diagram",
  "comparison_table",
] as const

export type VisualType = (typeof VISUAL_TYPES)[number]

/** Visual types the Quartz renderer can draw interactively today. Everything
 * else in VISUAL_TYPES is schema-valid and degrades to a readable card. */
export const IMPLEMENTED_VISUAL_TYPES = [
  "function_plot",
  "linked_time_plots",
  "mass_spring",
  "energy_exchange",
  "resonance_curve",
  "lif_neuron",
  "neural_coding",
  "stdp_window",
  "tradeoff_explorer",
] as const

export interface SourceAnchor {
  sourceId?: string
  sourceTitle?: string
  page?: number
  figureId?: string
  tableId?: string
  equationId?: string
  questionId?: string
  description: string
}

export interface FormulaRef {
  latex: string
  explanation: string
  symbols: Record<string, string>
}

export interface VisualControl {
  name: string
  label: string
  type: "slider" | "toggle" | "select"
  min?: number
  max?: number
  step?: number
  options?: string[]
  defaultValue?: unknown
}

export interface VisualAnnotation {
  label: string
  target?: string
  explanation: string
}

export interface VisualSpec {
  id: string
  gardenId?: string
  pageId?: string
  pagePath?: string
  type: VisualType
  title: string
  subtitle?: string
  sourceAnchors: SourceAnchor[]
  sourceGroundingStatus?: "source-anchored" | "conceptual-no-direct-source-figure"
  justification?: string
  conceptTargets: string[]
  misconceptionTargets?: string[]
  learningGoal?: string
  inputs?: string[]
  outputs?: string[]
  pedagogicalPurpose: string
  formulaRefs?: FormulaRef[]
  props: Record<string, unknown>
  controls?: VisualControl[]
  annotations?: VisualAnnotation[]
  caption?: string
  regenerationPrompt: string
  createdAt: string
  updatedAt?: string
  version: number
}

const MAX_SPEC_CHARS = 40000
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/
const CONTROL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/
const CONTROL_TYPES = new Set(["slider", "toggle", "select"])

/** Anything that could smuggle executable behavior through a string field. */
const FORBIDDEN_PATTERN =
  /<\s*script|<\s*iframe|<\s*object|<\s*embed|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|srcdoc\s*=|\bon[a-z]+\s*=|\beval\s*\(|new\s+Function|import\s*\(|document\s*\.\s*(write|cookie)|window\s*\[/i

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function safeString(value: unknown, field: string, errors: string[], maxLen = 4000): string | undefined {
  if (typeof value !== "string") return undefined
  if (value.length > maxLen) {
    errors.push(`${field} is too long`)
    return undefined
  }
  if (FORBIDDEN_PATTERN.test(value)) {
    errors.push(`${field} contains forbidden content`)
    return undefined
  }
  return value
}

function safeStringArray(value: unknown, field: string, errors: string[]): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value.slice(0, 40)) {
    const str = safeString(item, field, errors, 500)
    if (str !== undefined && str.trim()) out.push(str)
  }
  return out
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/** Recursively sanitize prop values: finite numbers, booleans, safe strings,
 * arrays and shallow objects of those. Everything else is dropped. */
function sanitizeValue(value: unknown, field: string, errors: string[], depth: number): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "boolean") return value
  if (typeof value === "string") return safeString(value, field, errors, 2000)
  if (Array.isArray(value)) {
    if (depth <= 0) return undefined
    const out = value
      .slice(0, 200)
      .map((item) => sanitizeValue(item, field, errors, depth - 1))
      .filter((item) => item !== undefined)
    return out
  }
  if (isPlainObject(value)) {
    if (depth <= 0) return undefined
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value).slice(0, 60)) {
      if (!CONTROL_NAME_PATTERN.test(key) && !/^[A-Za-z0-9_ .-]{1,60}$/.test(key)) continue
      const sanitized = sanitizeValue(item, `${field}.${key}`, errors, depth - 1)
      if (sanitized !== undefined) out[key] = sanitized
    }
    return out
  }
  return undefined
}

function sanitizeSourceAnchors(value: unknown, errors: string[]): SourceAnchor[] {
  if (!Array.isArray(value)) return []
  const anchors: SourceAnchor[] = []
  for (const raw of value.slice(0, 20)) {
    if (!isPlainObject(raw)) continue
    const description = safeString(raw.description, "sourceAnchors.description", errors, 1000)
    if (!description || !description.trim()) continue
    const anchor: SourceAnchor = { description }
    const sourceId = safeString(raw.sourceId, "sourceAnchors.sourceId", errors, 200)
    const sourceTitle = safeString(raw.sourceTitle, "sourceAnchors.sourceTitle", errors, 300)
    const figureId = safeString(raw.figureId, "sourceAnchors.figureId", errors, 80)
    const tableId = safeString(raw.tableId, "sourceAnchors.tableId", errors, 80)
    const equationId = safeString(raw.equationId, "sourceAnchors.equationId", errors, 80)
    const questionId = safeString(raw.questionId, "sourceAnchors.questionId", errors, 80)
    const page = finiteNumber(raw.page)
    if (sourceId) anchor.sourceId = sourceId
    if (sourceTitle) anchor.sourceTitle = sourceTitle
    if (figureId) anchor.figureId = figureId
    if (tableId) anchor.tableId = tableId
    if (equationId) anchor.equationId = equationId
    if (questionId) anchor.questionId = questionId
    if (page !== undefined) anchor.page = page
    anchors.push(anchor)
  }
  return anchors
}

function sanitizeControls(value: unknown, errors: string[]): VisualControl[] {
  if (!Array.isArray(value)) return []
  const controls: VisualControl[] = []
  for (const raw of value.slice(0, 12)) {
    if (!isPlainObject(raw)) continue
    const name = typeof raw.name === "string" && CONTROL_NAME_PATTERN.test(raw.name) ? raw.name : null
    const label = safeString(raw.label, "controls.label", errors, 200)
    const type = typeof raw.type === "string" && CONTROL_TYPES.has(raw.type) ? raw.type : null
    if (!name || !label || !type) {
      errors.push("control entries need a valid name, label, and type")
      continue
    }
    const control: VisualControl = { name, label, type: type as VisualControl["type"] }
    const min = finiteNumber(raw.min)
    const max = finiteNumber(raw.max)
    const step = finiteNumber(raw.step)
    if (min !== undefined) control.min = min
    if (max !== undefined) control.max = max
    if (step !== undefined) control.step = step
    if (Array.isArray(raw.options)) control.options = safeStringArray(raw.options, "controls.options", errors)
    const defaultValue = sanitizeValue(raw.defaultValue, "controls.defaultValue", errors, 1)
    if (defaultValue !== undefined) control.defaultValue = defaultValue
    controls.push(control)
  }
  return controls
}

function sanitizeFormulaRefs(value: unknown, errors: string[]): FormulaRef[] | undefined {
  if (!Array.isArray(value)) return undefined
  const refs: FormulaRef[] = []
  for (const raw of value.slice(0, 12)) {
    if (!isPlainObject(raw)) continue
    const latex = safeString(raw.latex, "formulaRefs.latex", errors, 1000)
    const explanation = safeString(raw.explanation, "formulaRefs.explanation", errors, 2000)
    if (!latex || !explanation) continue
    const symbols: Record<string, string> = {}
    if (isPlainObject(raw.symbols)) {
      for (const [key, item] of Object.entries(raw.symbols).slice(0, 30)) {
        const symbolKey = safeString(key, "formulaRefs.symbols", errors, 80)
        const symbolValue = safeString(item, "formulaRefs.symbols", errors, 400)
        if (symbolKey && symbolValue) symbols[symbolKey] = symbolValue
      }
    }
    refs.push({ latex, explanation, symbols })
  }
  return refs.length > 0 ? refs : undefined
}

function sanitizeAnnotations(value: unknown, errors: string[]): VisualAnnotation[] | undefined {
  if (!Array.isArray(value)) return undefined
  const annotations: VisualAnnotation[] = []
  for (const raw of value.slice(0, 20)) {
    if (!isPlainObject(raw)) continue
    const label = safeString(raw.label, "annotations.label", errors, 200)
    const explanation = safeString(raw.explanation, "annotations.explanation", errors, 1500)
    if (!label || !explanation) continue
    const annotation: VisualAnnotation = { label, explanation }
    const target = safeString(raw.target, "annotations.target", errors, 200)
    if (target) annotation.target = target
    annotations.push(annotation)
  }
  return annotations.length > 0 ? annotations : undefined
}

export interface VisualSpecValidation {
  spec: VisualSpec | null
  errors: string[]
}

/** Validate + sanitize an untrusted VisualSpec candidate. Returns a cleaned
 * spec containing only known fields, or null with the reasons it failed. */
export function validateVisualSpec(input: unknown): VisualSpecValidation {
  const errors: string[] = []

  let candidate: unknown = input
  if (typeof input === "string") {
    if (input.length > MAX_SPEC_CHARS) return { spec: null, errors: ["spec JSON is too large"] }
    try {
      candidate = JSON.parse(input)
    } catch {
      return { spec: null, errors: ["spec is not valid JSON"] }
    }
  }
  if (!isPlainObject(candidate)) return { spec: null, errors: ["spec must be a JSON object"] }

  try {
    if (JSON.stringify(candidate).length > MAX_SPEC_CHARS) {
      return { spec: null, errors: ["spec JSON is too large"] }
    }
  } catch {
    return { spec: null, errors: ["spec is not serializable"] }
  }

  const id = typeof candidate.id === "string" && ID_PATTERN.test(candidate.id) ? candidate.id : null
  if (!id) errors.push("id is required and must match [A-Za-z0-9_-]{1,80}")

  const type =
    typeof candidate.type === "string" && (VISUAL_TYPES as readonly string[]).includes(candidate.type)
      ? (candidate.type as VisualType)
      : null
  if (!type) errors.push(`type must be one of: ${VISUAL_TYPES.join(", ")}`)

  const title = safeString(candidate.title, "title", errors, 300)
  if (!title || !title.trim()) errors.push("title is required")

  const pedagogicalPurpose = safeString(candidate.pedagogicalPurpose, "pedagogicalPurpose", errors, 2000)
  if (!pedagogicalPurpose || !pedagogicalPurpose.trim()) errors.push("pedagogicalPurpose is required")

  const regenerationPrompt = safeString(candidate.regenerationPrompt, "regenerationPrompt", errors, 2000)
  if (!regenerationPrompt || !regenerationPrompt.trim()) errors.push("regenerationPrompt is required")

  const props = isPlainObject(candidate.props)
    ? (sanitizeValue(candidate.props, "props", errors, 3) as Record<string, unknown>)
    : {}

  if (errors.length > 0) return { spec: null, errors }

  const spec: VisualSpec = {
    id: id!,
    type: type!,
    title: title!,
    sourceAnchors: sanitizeSourceAnchors(candidate.sourceAnchors, errors),
    conceptTargets: safeStringArray(candidate.conceptTargets, "conceptTargets", errors),
    pedagogicalPurpose: pedagogicalPurpose!,
    props: props ?? {},
    regenerationPrompt: regenerationPrompt!,
    createdAt:
      safeString(candidate.createdAt, "createdAt", errors, 60) || new Date().toISOString(),
    version:
      typeof candidate.version === "number" && Number.isInteger(candidate.version) && candidate.version > 0
        ? candidate.version
        : 1,
  }

  const subtitle = safeString(candidate.subtitle, "subtitle", errors, 500)
  if (subtitle) spec.subtitle = subtitle
  const caption = safeString(candidate.caption, "caption", errors, 1500)
  if (caption) spec.caption = caption
  const gardenId = safeString(candidate.gardenId, "gardenId", errors, 200)
  if (gardenId) spec.gardenId = gardenId
  const pageId = safeString(candidate.pageId, "pageId", errors, 300)
  if (pageId) spec.pageId = pageId
  const pagePath = safeString(candidate.pagePath, "pagePath", errors, 300)
  if (pagePath) spec.pagePath = pagePath
  const updatedAt = safeString(candidate.updatedAt, "updatedAt", errors, 60)
  if (updatedAt) spec.updatedAt = updatedAt

  const sourceGroundingStatus =
    candidate.sourceGroundingStatus === "source-anchored" ||
    candidate.sourceGroundingStatus === "conceptual-no-direct-source-figure"
      ? candidate.sourceGroundingStatus
      : undefined
  if (sourceGroundingStatus) spec.sourceGroundingStatus = sourceGroundingStatus
  const justification = safeString(candidate.justification, "justification", errors, 1200)
  if (justification) spec.justification = justification
  const learningGoal = safeString(candidate.learningGoal, "learningGoal", errors, 1200)
  if (learningGoal) spec.learningGoal = learningGoal
  const inputs = safeStringArray(candidate.inputs, "inputs", errors)
  if (inputs.length > 0) spec.inputs = inputs
  const outputs = safeStringArray(candidate.outputs, "outputs", errors)
  if (outputs.length > 0) spec.outputs = outputs

  const misconceptions = safeStringArray(candidate.misconceptionTargets, "misconceptionTargets", errors)
  if (misconceptions.length > 0) spec.misconceptionTargets = misconceptions
  const controls = sanitizeControls(candidate.controls, errors)
  if (controls.length > 0) spec.controls = controls
  const formulaRefs = sanitizeFormulaRefs(candidate.formulaRefs, errors)
  if (formulaRefs) spec.formulaRefs = formulaRefs
  const annotations = sanitizeAnnotations(candidate.annotations, errors)
  if (annotations) spec.annotations = annotations

  // String-level violations discovered while sanitizing optional fields are
  // fatal: a spec that tried to smuggle executable content is never rendered.
  if (errors.some((message) => message.includes("forbidden content"))) {
    return { spec: null, errors }
  }

  return { spec, errors }
}

// ---------------------------------------------------------------------------
// Markdown block + legacy placeholder helpers
// ---------------------------------------------------------------------------

export const VISUAL_BLOCK_LANG = "breadboard-visual"

/** Legacy bracket placeholders emitted by earlier generations. */
export const PLACEHOLDER_PATTERN =
  /\[(?:Interactive visual|Visual|Generated visual)\s*:\s*([^\[\]]+)\]/gi

export interface VisualPlaceholder {
  fullMatch: string
  /** Text after the colon: "title — what it teaches". */
  body: string
  title: string
  description: string
  index: number
}

export function findVisualPlaceholders(markdown: string): VisualPlaceholder[] {
  const placeholders: VisualPlaceholder[] = []
  const pattern = new RegExp(PLACEHOLDER_PATTERN.source, PLACEHOLDER_PATTERN.flags)
  let match: RegExpExecArray | null
  while ((match = pattern.exec(markdown)) !== null) {
    const body = match[1].trim()
    const separator = body.search(/\s+[—–-]\s+|\s+—\s*|\s*—\s+/)
    const emDash = body.indexOf("—")
    let title = body
    let description = ""
    if (emDash > 0) {
      title = body.slice(0, emDash).trim()
      description = body.slice(emDash + 1).trim()
    } else if (separator > 0) {
      title = body.slice(0, separator).trim()
      description = body.slice(separator).replace(/^\s*[—–-]\s*/, "").trim()
    }
    placeholders.push({
      fullMatch: match[0],
      body,
      title: title || "Interactive visual",
      description,
      index: match.index,
    })
  }
  return placeholders
}

/** Serialize a VisualSpec into the fenced block embedded in Markdown. */
export function buildVisualBlock(spec: VisualSpec): string {
  return "```" + VISUAL_BLOCK_LANG + "\n" + JSON.stringify(spec, null, 2) + "\n```"
}

/** Replace one placeholder occurrence with a visual block. */
export function replacePlaceholderWithBlock(
  markdown: string,
  placeholder: VisualPlaceholder,
  spec: VisualSpec,
): string {
  return (
    markdown.slice(0, placeholder.index) +
    buildVisualBlock(spec) +
    markdown.slice(placeholder.index + placeholder.fullMatch.length)
  )
}

/** Mutates an mdast `code` node in place so the trusted client renderer can
 * hydrate it. Only specs with a truly interactive renderer are hydrated;
 * schema-valid-but-non-interactive and invalid blocks are tagged for removal
 * (interactive or nothing — there is no static explainer card). Returns
 * whether the node carries a renderable spec. Kept here (dependency-free) so
 * it is unit-testable without loading the transformer's bundled imports. */
export function tagVisualCodeNode(node: {
  lang?: string | null
  value: string
  data?: unknown
}): boolean {
  const { spec, errors } = validateVisualSpec(node.value)
  if (spec && (IMPLEMENTED_VISUAL_TYPES as readonly string[]).includes(spec.type)) {
    node.data = {
      hProperties: {
        className: ["breadboard-visual-block"],
        "data-visual-spec": JSON.stringify(spec),
      },
    }
    // No-JS / pre-hydration fallback stays readable.
    node.value = `Interactive visual: ${spec.title}${spec.caption ? ` — ${spec.caption}` : ""}`
    return true
  }
  if (spec) {
    node.data = {
      hProperties: {
        className: ["breadboard-visual-block", "breadboard-visual-noninteractive"],
        "data-visual-error": `type "${spec.type}" has no interactive renderer`,
      },
    }
    node.value = ""
    return false
  }
  node.data = {
    hProperties: {
      className: ["breadboard-visual-block", "breadboard-visual-invalid"],
      "data-visual-error": errors.slice(0, 3).join("; ") || "invalid visual spec",
    },
  }
  node.value = ""
  return false
}

// ---------------------------------------------------------------------------
// Source figure labeling: S{sourceIndex}.P{page}.{F|T|G}{n}
// ---------------------------------------------------------------------------

export type SourceFigureKind = "graph" | "diagram" | "table" | "photo" | "formula" | "unknown"

export interface SourceFigure {
  figureId: string
  sourceId?: string
  page?: number
  kind: SourceFigureKind
  caption?: string
  ocrText?: string
  relevanceNotes?: string
  suggestedVisualUse?: string
}

// ---------------------------------------------------------------------------
// Deterministic interactive visual builders
//
// The hard dynamic concepts (LIF dynamics, spike coding, STDP, metric
// tradeoffs) must never be left without a visual just because a model call
// declined or failed. Each builder returns a valid VisualSpec for an
// IMPLEMENTED renderer type with sensible, non-empty props and teaching
// controls, so the pipeline can guarantee a working interactive visual without
// depending on the LLM. IDs are derived from the page slug so they are stable
// across regenerations and always match ID_PATTERN. Dependency-free so they can
// be unit-tested in isolation.
// ---------------------------------------------------------------------------

export type HardConceptKind =
  | "lif_neuron"
  | "neural_coding"
  | "stdp_window"
  | "tradeoff_explorer"

/**
 * Build a clean, readable, deterministic visual id from a page path and a
 * purpose suffix. The id reads front-to-back — `vis-4-2-normalized-energy-
 * efficiency-calculator` — instead of a tail-sliced garble like
 * `vis-vations-Dense-Computation-...`. It is derived from the subsection's
 * `N.M` number and its concept words (with the number prefix stripped), so it
 * is stable across regenerations and collision-safe within a garden.
 */
function deterministicVisualId(pageSlug: string | undefined, suffix: string): string {
  const basename = (pageSlug ?? "page")
    .replace(/\.md$/i, "")
    .split(/[\\/]/)
    .pop() ?? "page"
  // Leading "N" / "N.M" / "N.M.K" number label -> "n-m-k".
  const numberMatch = basename.match(/^(\d+(?:\.\d+)*)\.?\s+(.*)$/)
  const numberPart = numberMatch ? numberMatch[1].replace(/\./g, "-") : ""
  const conceptSource = (numberMatch ? numberMatch[2] : basename)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
  // Front-to-back words, capped so the id stays short and readable.
  const conceptPart = conceptSource.split(/\s+/).filter(Boolean).slice(0, 6).join("-")
  const cleanSuffix = suffix.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  const id = ["vis", numberPart, conceptPart, cleanSuffix]
    .filter(Boolean)
    .join("-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  return (id || `vis-${cleanSuffix || "visual"}`).slice(0, 80).replace(/-+$/g, "")
}

function baseSpec(id: string, type: VisualType, fields: Partial<VisualSpec>): VisualSpec {
  return {
    title: "Interactive visual",
    sourceAnchors: [],
    conceptTargets: [],
    pedagogicalPurpose: "",
    props: {},
    regenerationPrompt: "Regenerate this interactive visual with clearer pedagogy.",
    ...fields,
    id,
    type,
    createdAt: new Date().toISOString(),
    version: 1,
  }
}

/** Leaky integrate-and-fire membrane simulator: accumulate, leak, cross
 * threshold, spike, reset, refractory. */
export function buildLifThresholdResetVisual(pageSlug?: string): VisualSpec {
  return baseSpec(deterministicVisualId(pageSlug, "lif"), "lif_neuron", {
    title: "Leaky integrate-and-fire membrane simulator",
    conceptTargets: ["membrane potential", "firing threshold", "reset", "refractory period", "leak"],
    pedagogicalPurpose:
      "Let the learner drive input current and leak and watch the membrane potential accumulate, cross threshold, spike, reset, and stay refractory over time.",
    props: {
      restPotential: 0,
      threshold: 1,
      resetPotential: 0,
      inputCurrent: 1.2,
      leak: 0.15,
      refractory: 2,
      duration: 40,
    },
    controls: [
      { name: "inputCurrent", label: "Input current", type: "slider", min: 0, max: 3, step: 0.05, defaultValue: 1.2 },
      { name: "leak", label: "Leak rate", type: "slider", min: 0, max: 0.6, step: 0.01, defaultValue: 0.15 },
      { name: "threshold", label: "Firing threshold", type: "slider", min: 0.4, max: 2, step: 0.05, defaultValue: 1 },
      { name: "refractory", label: "Refractory steps", type: "slider", min: 0, max: 8, step: 1, defaultValue: 2 },
    ],
    caption:
      "Raise the input current until the potential reaches threshold and fires; increase the leak to see firing slow or stop.",
    regenerationPrompt:
      "Improve the LIF simulator: clarify the leak-vs-input balance and label the threshold crossing and reset.",
  })
}

/** Rate coding vs temporal coding for the same stimulus. */
export function buildRateVsTemporalCodingVisual(pageSlug?: string): VisualSpec {
  return baseSpec(deterministicVisualId(pageSlug, "coding"), "neural_coding", {
    title: "Rate coding vs temporal coding",
    conceptTargets: ["rate coding", "temporal coding", "spike timing", "spike count"],
    pedagogicalPurpose:
      "Let the learner change the stimulus strength and compare how a rate code (spike count) and a temporal code (spike timing) represent the same input.",
    props: { strength: 0.6, mode: "both" },
    controls: [
      { name: "strength", label: "Stimulus strength", type: "slider", min: 0, max: 1, step: 0.02, defaultValue: 0.6 },
      { name: "mode", label: "Coding scheme", type: "select", options: ["rate", "temporal", "both"], defaultValue: "both" },
    ],
    caption:
      "Increase the stimulus and watch the rate code add spikes while the temporal code shifts the first-spike timing.",
    regenerationPrompt:
      "Improve the coding comparison: make the contrast between spike count and spike timing more legible.",
  })
}

/** STDP Δw vs Δt timing window. */
export function buildStdpTimingWindowVisual(pageSlug?: string): VisualSpec {
  return baseSpec(deterministicVisualId(pageSlug, "stdp"), "stdp_window", {
    title: "Spike-timing dependent plasticity window",
    conceptTargets: ["STDP", "spike timing", "synaptic plasticity", "pre-before-post", "post-before-pre"],
    pedagogicalPurpose:
      "Let the learner drag the pre/post spike time difference and watch the synaptic weight change flip sign across the STDP window.",
    props: { aPlus: 1, aMinus: 1, tauPlus: 20, tauMinus: 20, deltaT: 8 },
    controls: [
      { name: "deltaT", label: "Δt (pre − post, ms)", type: "slider", min: -60, max: 60, step: 1, defaultValue: 8 },
      { name: "aPlus", label: "Potentiation amplitude", type: "slider", min: 0, max: 2, step: 0.05, defaultValue: 1 },
      { name: "aMinus", label: "Depression amplitude", type: "slider", min: 0, max: 2, step: 0.05, defaultValue: 1 },
    ],
    caption: "Drag Δt through zero to see potentiation when the pre-spike leads and depression when it lags.",
    regenerationPrompt:
      "Improve the STDP window: emphasize the sign change at Δt = 0 and the exponential decay of each side.",
  })
}

/** Accuracy / latency / energy / spike-count tradeoff across model families. */
export function buildMetricTradeoffExplorerVisual(pageSlug?: string): VisualSpec {
  return baseSpec(deterministicVisualId(pageSlug, "tradeoff"), "tradeoff_explorer", {
    title: "Accuracy, latency, energy, and spike-count tradeoff explorer",
    conceptTargets: ["accuracy", "latency", "energy", "spike count", "model comparison"],
    pedagogicalPurpose:
      "Let the learner change the deployment priority and see which model family wins across accuracy, latency, and energy.",
    props: {
      models: [
        { label: "ANN", accuracy: 0.99, latency: 0.9, energy: 0.95 },
        { label: "Converted SNN", accuracy: 0.95, latency: 0.6, energy: 0.45 },
        { label: "Surrogate-gradient SNN", accuracy: 0.96, latency: 0.45, energy: 0.4 },
        { label: "STDP SNN", accuracy: 0.86, latency: 0.35, energy: 0.2 },
      ],
      priority: "balanced",
    },
    controls: [
      {
        name: "priority",
        label: "Deployment priority",
        type: "select",
        options: ["accuracy", "latency", "energy", "balanced"],
        defaultValue: "balanced",
      },
    ],
    caption:
      "Switch the priority between accuracy, latency, and energy to see the recommended model family change.",
    regenerationPrompt:
      "Improve the tradeoff explorer: keep accuracy higher-better and latency/energy lower-better, and make the winner obvious per priority.",
  })
}

const HARD_CONCEPT_BUILDERS: Record<HardConceptKind, (pageSlug?: string) => VisualSpec> = {
  lif_neuron: buildLifThresholdResetVisual,
  neural_coding: buildRateVsTemporalCodingVisual,
  stdp_window: buildStdpTimingWindowVisual,
  tradeoff_explorer: buildMetricTradeoffExplorerVisual,
}

/** Deterministic builder for a hard-concept renderer type, or null if the type
 * has no builder. The returned spec is re-validated so callers always get a
 * sanitized VisualSpec (or null if, impossibly, it failed validation). */
export function buildDeterministicVisual(
  visualType: string,
  context: { gardenId?: string; pageSlug?: string },
): VisualSpec | null {
  const builder = HARD_CONCEPT_BUILDERS[visualType as HardConceptKind]
  if (!builder) return null
  const spec = builder(context.pageSlug)
  if (context.gardenId) spec.gardenId = context.gardenId
  if (context.pageSlug) spec.pageId = context.pageSlug
  const { spec: validated } = validateVisualSpec(spec)
  return validated
}

// ---------------------------------------------------------------------------
// Source figure labeling: S{sourceIndex}.P{page}.{F|T|G}{n}  (helpers below)
// ---------------------------------------------------------------------------

const FIGURE_KIND_LETTER: Record<SourceFigureKind, string> = {
  graph: "G",
  diagram: "F",
  table: "T",
  photo: "F",
  formula: "F",
  unknown: "F",
}

/** Assign stable internal ids (S1.P7.F2 style) to source figures that do not
 * already carry one. Numbering restarts per page per kind letter. */
export function assignSourceFigureIds(
  sourceIndex: number,
  figures: Array<Partial<SourceFigure> & { page?: number }>,
): SourceFigure[] {
  const counters = new Map<string, number>()
  return figures.map((figure) => {
    const kind: SourceFigureKind = figure.kind ?? "unknown"
    const page = typeof figure.page === "number" && Number.isFinite(figure.page) ? figure.page : 0
    const letter = FIGURE_KIND_LETTER[kind] ?? "F"
    const counterKey = `${page}:${letter}`
    const next = (counters.get(counterKey) ?? 0) + 1
    counters.set(counterKey, next)
    const figureId =
      typeof figure.figureId === "string" && figure.figureId.trim()
        ? figure.figureId
        : `S${sourceIndex}.P${page}.${letter}${next}`
    return {
      ...figure,
      figureId,
      kind,
      page: figure.page,
    }
  })
}
